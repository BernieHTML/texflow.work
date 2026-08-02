// Voice notes, in a format everyone can actually play.
//
// The bug this exists to fix: MediaRecorder gives you whatever the browser
// feels like. Chrome and Firefox record WebM/Opus; iOS Safari records MP4/AAC.
// Safari cannot play WebM at all, so a note recorded on Android was silence on
// an iPhone, and vice versa — each person could only hear their own.
//
// There is no ffmpeg on the box, so the conversion happens here: whatever was
// recorded gets decoded by the browser (every browser can decode what it just
// produced), downmixed to mono, resampled, and re-encoded as MP3 with lamejs.
// MP3 is the one audio format that plays everywhere, Safari included.
//
// 32 kbps mono at 22.05 kHz is about 4 kB/s, so the 60 s cap lands near 240 kB
// — comfortably inside nginx's default 1 MB body limit.

const LAME_URL = '/smig/vendor/lame.min.js';
const SAMPLE_RATE = 22050;
const BITRATE = 32;
const FRAME = 1152;          // lamejs wants whole MPEG frames

let lamePromise = null;

/** lamejs is a classic script, not a module — load it on first use. */
function loadLame() {
  if (window.lamejs) return Promise.resolve(window.lamejs);
  if (lamePromise) return lamePromise;

  lamePromise = new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = LAME_URL;
    tag.onload = () => (window.lamejs
      ? resolve(window.lamejs)
      : reject(new Error('The audio encoder did not load.')));
    tag.onerror = () => reject(new Error('The audio encoder did not load.'));
    document.head.append(tag);
  });
  return lamePromise;
}

/** Pick whatever this browser is willing to record; we re-encode it anyway. */
export function recordingMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',                 // iOS Safari lands here
    'audio/ogg;codecs=opus',
    'audio/mpeg'
  ];
  return candidates.find((type) => {
    try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
  }) || '';
}

/** Average the channels down to one, so a stereo mic doesn't double the size. */
function toMono(buffer) {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0);

  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / channels;
  }
  return out;
}

/** Linear resample. Voice at 22 kHz is plenty and keeps the file small. */
function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    const low = Math.floor(at);
    const high = Math.min(low + 1, samples.length - 1);
    out[i] = samples[low] + (samples[high] - samples[low]) * (at - low);
  }
  return out;
}

function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}

/**
 * Recording (any container) → MP3 blob.
 * Throws with something sayable if the browser can't decode its own output.
 */
export async function toMp3(blob) {
  const lame = await loadLame();

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('This browser cannot process audio.');

  const ctx = new AudioCtx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('That recording could not be read.');
  } finally {
    ctx.close?.();
  }

  const pcm = toInt16(resample(toMono(decoded), decoded.sampleRate, SAMPLE_RATE));
  const encoder = new lame.Mp3Encoder(1, SAMPLE_RATE, BITRATE);
  const parts = [];

  for (let i = 0; i < pcm.length; i += FRAME) {
    const chunk = encoder.encodeBuffer(pcm.subarray(i, i + FRAME));
    if (chunk.length) parts.push(new Uint8Array(chunk));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));

  return {
    blob: new Blob(parts, { type: 'audio/mpeg' }),
    seconds: decoded.duration
  };
}
