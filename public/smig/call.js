// Voice and video calls, peer to peer.
//
// The media never touches the server — only the handshake does, relayed as
// events on the live feed. That keeps calls free to run, with one honest
// limitation: with public STUN and no TURN relay, two peers on strict
// symmetric NATs (some mobile carriers, locked-down office wifi) can't find a
// direct path and the call will fail to connect. The server exposes a TURN
// entry through SMIG_TURN_* if one is ever available.
//
// Handshake order, so both ends stay in step:
//
//   caller  ─ ring ─────▶  callee rings
//   caller  ◀──── accept ─  callee picks up
//   caller  ─ offer ────▶
//   caller  ◀──── answer ─
//   both    ◀─── ice ───▶  (trickled until connected)

const noop = () => {};

export class Call {
  constructor({ api, onState, onRemoteStream, onLocalStream }) {
    this.api = api;
    this.onState = onState || noop;
    this.onRemoteStream = onRemoteStream || noop;
    this.onLocalStream = onLocalStream || noop;
    this.reset();
  }

  reset() {
    this.pc = null;
    this.local = null;
    this.threadId = null;
    this.peerId = null;
    this.video = false;
    this.role = null;         // 'caller' | 'callee'
    this.state = 'idle';      // idle | ringing | incoming | connecting | live
    this.pendingIce = [];
    this.muted = false;
    this.cameraOff = false;
  }

  get active() { return this.state !== 'idle'; }

  setState(state, detail) {
    this.state = state;
    this.onState(state, detail);
  }

  async getIceServers() {
    if (this._ice) return this._ice;
    try {
      const res = await this.api('/api/ice');
      this._ice = res.iceServers;
    } catch {
      this._ice = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    return this._ice;
  }

  async makePeer() {
    const pc = new RTCPeerConnection({ iceServers: await this.getIceServers() });

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal('ice', e.candidate.toJSON());
    };

    pc.ontrack = (e) => {
      this.onRemoteStream(e.streams[0]);
      if (this.state !== 'live') this.setState('live');
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this.setState('live');
      if (pc.connectionState === 'failed') {
        // Nothing to retry against without a relay — say so rather than hang.
        this.setState('failed', 'Could not find a route between you two.');
        this.hangUp(false);
      }
      if (pc.connectionState === 'disconnected' && this.state === 'live') {
        this.setState('live', 'reconnecting');
      }
    };

    this.pc = pc;
    return pc;
  }

  async openMedia(video) {
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: video ? { facingMode: 'user', width: { ideal: 640 } } : false
    });
    this.onLocalStream(this.local);
    return this.local;
  }

  signal(type, payload) {
    if (!this.threadId) return Promise.resolve();
    return this.api(`/api/call/${encodeURIComponent(this.threadId)}/signal`, {
      method: 'POST',
      body: { type, payload, video: this.video }
    }).catch(() => {});
  }

  // ------------------------------------------------------------- outgoing ---

  async place(threadId, peerId, video) {
    this.reset();
    this.threadId = threadId;
    this.peerId = peerId;
    this.video = video;
    this.role = 'caller';
    this.setState('ringing');

    await this.openMedia(video);
    await this.api(`/api/call/${encodeURIComponent(threadId)}/signal`, {
      method: 'POST',
      body: { type: 'ring', video }
    });
  }

  // ------------------------------------------------------------- incoming ---

  arrive(threadId, peerId, video) {
    this.reset();
    this.threadId = threadId;
    this.peerId = peerId;
    this.video = video;
    this.role = 'callee';
    this.setState('incoming');
  }

  async accept() {
    if (this.role !== 'callee') return;
    this.setState('connecting');
    await this.openMedia(this.video);
    await this.makePeer();
    for (const track of this.local.getTracks()) this.pc.addTrack(track, this.local);
    await this.signal('accept');
  }

  decline() {
    this.signal('decline');
    this.hangUp(false);
  }

  // -------------------------------------------------------------- signals ---

  /** Everything arriving on the feed for this call funnels through here. */
  async handle(msg) {
    const { type, payload } = msg;

    if (type === 'accept' && this.role === 'caller') {
      this.setState('connecting');
      await this.makePeer();
      for (const track of this.local.getTracks()) this.pc.addTrack(track, this.local);
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.signal('offer', offer);
      return;
    }

    if (type === 'offer' && this.role === 'callee') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload));
      await this.drainIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.signal('answer', answer);
      return;
    }

    if (type === 'answer' && this.role === 'caller') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload));
      await this.drainIce();
      return;
    }

    if (type === 'ice') {
      // Candidates routinely beat the description they belong to.
      if (!this.pc || !this.pc.remoteDescription) this.pendingIce.push(payload);
      else await this.pc.addIceCandidate(new RTCIceCandidate(payload)).catch(() => {});
      return;
    }

    if (type === 'decline') {
      this.setState('declined');
      this.hangUp(false);
      return;
    }

    if (type === 'hangup') {
      this.setState('ended');
      this.hangUp(false);
    }
  }

  async drainIce() {
    const queued = this.pendingIce.splice(0);
    for (const c of queued) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
  }

  // ----------------------------------------------------------- teardown ---

  hangUp(tell = true) {
    if (tell && this.threadId) this.signal('hangup');
    this.local?.getTracks().forEach((t) => t.stop());
    try { this.pc?.close(); } catch { /* already closed */ }
    const was = this.state;
    this.reset();
    this.onState('idle', was);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.local?.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    return this.muted;
  }

  toggleCamera() {
    this.cameraOff = !this.cameraOff;
    this.local?.getVideoTracks().forEach((t) => { t.enabled = !this.cameraOff; });
    return this.cameraOff;
  }
}
