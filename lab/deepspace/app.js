/* Deep Space Network live monitor — TexFlow Lab
   Fetches the NASA DSN Now feed directly from the browser (it serves CORS
   headers) and shows which dish is talking to which spacecraft right now.
   Fully static — no server, no keys, no build step. */

const STATIONS = {
  gdscc: { name: 'Goldstone', loc: 'California, USA' },
  mdscc: { name: 'Madrid',    loc: 'Spain' },
  cdscc: { name: 'Canberra',  loc: 'Australia' }
};

// Friendly names + one-line stories for common DSN spacecraft codes.
// (The feed uses short mission codes; anything unknown falls back to its code.)
const CRAFT = {
  VGR1:{n:'Voyager 1',t:'Interstellar · launched 1977',d:'The most distant human-made object, now over 24 billion km away in interstellar space. Still returning data on the space between the stars.',k:{Launched:'5 Sep 1977',Region:'Interstellar space',Power:'Plutonium RTG'},hi:1},
  VGR2:{n:'Voyager 2',t:'Interstellar · launched 1977',d:'The only spacecraft to visit all four giant planets. Crossed into interstellar space in 2018 and is still calling home.',k:{Launched:'20 Aug 1977',Region:'Interstellar space',Power:'Plutonium RTG'},hi:1},
  NHPC:{n:'New Horizons',t:'Kuiper Belt',d:'Flew past Pluto in 2015 and the Kuiper Belt object Arrokoth in 2019. Now exploring the outer solar system.',k:{Launched:'19 Jan 2006',Flyby:'Pluto 2015'}},
  JNO:{n:'Juno',t:'Jupiter orbiter',d:'Orbiting Jupiter since 2016, peering beneath the cloud tops to study the giant planet’s interior and auroras.',k:{Launched:'5 Aug 2011',Orbiting:'Jupiter'}},
  LCY:{n:'Lucy',t:'Jupiter Trojan asteroids',d:'On a 12-year tour of the Trojan asteroids that share Jupiter’s orbit — fossils of the early solar system.',k:{Launched:'16 Oct 2021'}},
  PSYC:{n:'Psyche',t:'Metal asteroid mission',d:'En route to 16 Psyche, a rare metal-rich asteroid that may be the exposed core of an early planet.',k:{Launched:'13 Oct 2023'}},
  M01O:{n:'Mars Odyssey',t:'Mars orbiter',d:'The longest-working spacecraft at Mars, mapping minerals and relaying data from surface rovers since 2001.',k:{Launched:'7 Apr 2001',Orbiting:'Mars'}},
  MRO:{n:'Mars Reconnaissance Orbiter',t:'Mars orbiter',d:'Carries the most powerful camera ever sent to another planet and relays rover data home.',k:{Launched:'12 Aug 2005',Orbiting:'Mars'}},
  MSL:{n:'Curiosity (MSL)',t:'Mars rover',d:'A car-sized nuclear-powered rover exploring Gale Crater since 2012, searching for past habitability.',k:{Landed:'6 Aug 2012',On:'Mars'}},
  M20:{n:'Perseverance (Mars 2020)',t:'Mars rover',d:'Caching samples in Jezero Crater for a future return to Earth, and carried the Ingenuity helicopter.',k:{Landed:'18 Feb 2021',On:'Mars'}},
  MVN:{n:'MAVEN',t:'Mars orbiter',d:'Studies how Mars lost its atmosphere to space over billions of years.',k:{Launched:'18 Nov 2013',Orbiting:'Mars'}},
  EMM:{n:'Hope (EMM)',t:'Mars orbiter · UAE',d:'The United Arab Emirates’ first interplanetary mission, studying the Martian weather and climate.',k:{Launched:'19 Jul 2020',Orbiting:'Mars'}},
  TGO:{n:'ExoMars TGO',t:'Mars orbiter · ESA',d:'Sniffs trace gases like methane in the Martian atmosphere and relays rover data.',k:{Agency:'ESA',Orbiting:'Mars'}},
  MEX:{n:'Mars Express',t:'Mars orbiter · ESA',d:'ESA’s long-lived Mars orbiter, mapping the surface and subsurface since 2003.',k:{Agency:'ESA',Orbiting:'Mars'}},
  JWST:{n:'James Webb (JWST)',t:'L2 observatory',d:'The largest space telescope ever built, observing the earliest galaxies from a million km away at L2.',k:{Launched:'25 Dec 2021',Orbit:'Sun–Earth L2'}},
  SPP:{n:'Parker Solar Probe',t:'Solar mission',d:'The fastest object ever built, repeatedly diving through the Sun’s outer atmosphere.',k:{Launched:'12 Aug 2018'}},
  PSP:{n:'Parker Solar Probe',t:'Solar mission',d:'The fastest object ever built, repeatedly diving through the Sun’s outer atmosphere.',k:{Launched:'12 Aug 2018'}},
  BEP:{n:'BepiColombo',t:'Mercury mission · ESA/JAXA',d:'A joint European–Japanese mission cruising to orbit Mercury, the innermost planet.',k:{Launched:'20 Oct 2018'}},
  GAIA:{n:'Gaia',t:'Star-mapper · ESA',d:'Charted the precise positions of nearly two billion stars to build a 3D map of the Milky Way.',k:{Agency:'ESA',Orbit:'L2'}},
  SOHO:{n:'SOHO',t:'Sun observatory',d:'Watches the Sun around the clock from L1 and has discovered thousands of comets.',k:{Launched:'2 Dec 1995',Orbit:'Sun–Earth L1'}},
  ACE:{n:'ACE',t:'Solar wind monitor',d:'Measures the solar wind from L1, giving ~1 hour of warning before space-weather storms hit Earth.',k:{Orbit:'Sun–Earth L1'}},
  DSCOVR:{n:'DSCOVR',t:'Earth/solar wind · L1',d:'Watches the sunlit face of Earth and monitors the solar wind from the L1 point.',k:{Orbit:'Sun–Earth L1'}},
  WIND:{n:'Wind',t:'Solar wind monitor',d:'A veteran spacecraft studying the solar wind and its impact on near-Earth space.',k:{Orbit:'Sun–Earth L1'}},
  STA:{n:'STEREO-A',t:'Solar observatory',d:'Images the Sun from a different vantage point than Earth to see space weather in 3D.',k:{}},
  KPLO:{n:'Danuri (KPLO)',t:'Lunar orbiter · Korea',d:'South Korea’s first Moon mission, scouting future landing sites from lunar orbit.',k:{Launched:'4 Aug 2022',Orbiting:'Moon'}},
  CH2:{n:'Chandrayaan-2',t:'Lunar orbiter · India',d:'India’s orbiter mapping the Moon in high resolution.',k:{Agency:'ISRO',Orbiting:'Moon'}},
  EURC:{n:'Europa Clipper',t:'Jupiter’s moon Europa',d:'On its way to study Europa’s icy shell and the global ocean believed to lie beneath it.',k:{Launched:'14 Oct 2024'}},
  HYB2:{n:'Hayabusa2',t:'Asteroid mission · JAXA',d:'Returned asteroid samples in 2020 and is now cruising to a second small asteroid.',k:{Agency:'JAXA'}},
  DSN:{n:'Test / Engineering',t:'Calibration',d:'The dish is running engineering, calibration or maintenance activity rather than tracking a mission.',k:{}},
  TEST:{n:'Test / Engineering',t:'Calibration',d:'Engineering or calibration activity.',k:{}}
};

function craftInfo(code){
  if(!code) return null;
  const c = code.toUpperCase();
  if (CRAFT[c]) return CRAFT[c];
  // loose matches for arrayed / suffixed codes
  for (const key in CRAFT){ if (c.startsWith(key)) return CRAFT[key]; }
  return { n: code, t:'Spacecraft', d:'A spacecraft currently in contact with the Deep Space Network. We don’t have a profile for this one yet.', k:{Code:code} };
}

function fmtRate(bps){
  const v = Number(bps);
  if(!isFinite(v) || v<=0) return null;
  if(v>=1e6) return (v/1e6).toFixed(1)+' Mb/s';
  if(v>=1e3) return (v/1e3).toFixed(1)+' kb/s';
  return v.toFixed(0)+' b/s';
}
function fmtRange(km){
  const v = Number(km);
  if(!isFinite(v) || v<=0) return null;
  if(v>=1e6) return (v/1e6).toFixed(1)+'M km';
  return Math.round(v).toLocaleString()+' km';
}
function fmtRtlt(sec){
  const v = Number(sec);
  if(!isFinite(v) || v<=0) return null;
  if(v<60) return v.toFixed(0)+'s';
  if(v<3600) return (v/60).toFixed(1)+' min';
  return (v/3600).toFixed(2)+' h';
}

const el = id => document.getElementById(id);
const stationsEl = el('stations');
const errEl = el('error');

async function load(){
  try{
    const res = await fetch('https://eyes.nasa.gov/dsn/data/dsn.xml?r='+Date.now(), { cache:'no-store' });
    if(!res.ok) throw new Error('feed '+res.status);
    const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
    if(xml.querySelector('parsererror')) throw new Error('bad feed');
    render(xml);
    errEl.classList.add('hidden');
  }catch(e){
    errEl.textContent = 'Could not reach the DSN feed right now — it will retry automatically. ('+e.message+')';
    errEl.classList.remove('hidden');
    el('live-label').textContent = 'reconnecting…';
  }
}

function render(xml){
  // group dishes under their station (feed lists <station> then its <dish>es)
  const children = Array.from(xml.documentElement.children);
  const groups = {}; let current = null; let activeLinks = 0;
  for(const node of children){
    if(node.tagName === 'station'){
      current = node.getAttribute('name');
      groups[current] = { info: node, dishes: [] };
    } else if(node.tagName === 'dish' && current){
      groups[current].dishes.push(node);
    }
  }

  let html = '';
  let voyagerActive = false;
  for(const key of ['gdscc','mdscc','cdscc']){
    const g = groups[key]; if(!g) continue;
    const meta = STATIONS[key] || { name:key, loc:'' };
    const utc = Number(g.info.getAttribute('timeUTC'));
    const t = isFinite(utc) ? new Date(utc) : null;
    const timeStr = t ? t.toUTCString().slice(17,25)+' UTC' : '';

    let dishHtml = '';
    for(const dish of g.dishes){
      const dname = dish.getAttribute('name');
      const activity = dish.getAttribute('activity') || '';
      // collect active signals, pair with a target for range/rtlt
      const targets = {};
      dish.querySelectorAll('target').forEach(tg=>{
        targets[tg.getAttribute('name')] = {
          range: tg.getAttribute('downlegRange'),
          rtlt: tg.getAttribute('rtlt')
        };
      });
      const sigs = [];
      dish.querySelectorAll('downSignal, upSignal').forEach(s=>{
        if(s.getAttribute('active') !== 'true') return;
        const sc = s.getAttribute('spacecraft');
        if(!sc) return;
        sigs.push({
          dir: s.tagName === 'upSignal' ? 'up' : 'down',
          sc, band: s.getAttribute('band'),
          rate: s.getAttribute('dataRate'),
          tgt: targets[sc] || {}
        });
      });
      // de-dup: one row per spacecraft+direction
      const seen = new Set(); const rows = [];
      for(const s of sigs){
        const id = s.dir+':'+s.sc; if(seen.has(id)) continue; seen.add(id); rows.push(s);
      }

      let rowsHtml = '';
      if(rows.length === 0){
        rowsHtml = `<div class="idle">${activity ? escapeHtml(activity) : 'Idle'}</div>`;
      } else {
        activeLinks += rows.length;
        for(const s of rows){
          const info = craftInfo(s.sc);
          if(info.hi) voyagerActive = true;
          const bits = [];
          if(s.band) bits.push(s.band+'-band');
          const r = fmtRate(s.rate); if(r) bits.push(r);
          const rng = fmtRange(s.tgt.range); if(rng) bits.push(rng);
          const lt = fmtRtlt(s.tgt.rtlt); if(lt) bits.push('⟲ '+lt);
          rowsHtml += `<div class="link" data-sc="${escapeHtml(s.sc)}">
            <span class="arrow ${s.dir}">${s.dir==='up'?'↑':'↓'}</span>
            <div class="link-body">
              <div class="sc-name"${info.hi?' style="color:var(--up)"':''}>${escapeHtml(info.n)}</div>
              <div class="sc-meta">${s.dir==='up'?'uplink':'downlink'}${bits.length?' · '+bits.join(' · '):''}</div>
            </div>
          </div>`;
        }
      }
      dishHtml += `<div class="dish">
        <div class="dish-h"><span class="dish-name">${escapeHtml(dname)}</span>
        <span class="dish-act">${escapeHtml(activity)}</span></div>
        <div class="links">${rowsHtml}</div>
      </div>`;
    }

    html += `<div class="station">
      <div class="station-h">
        <div><h2>${meta.name}</h2><div class="loc">${meta.loc}</div></div>
        <div class="station-time">${timeStr}</div>
      </div>
      ${dishHtml || '<div class="dish"><div class="idle">No dishes reporting</div></div>'}
    </div>`;
  }

  stationsEl.innerHTML = html;
  el('live-label').textContent = 'LIVE';
  el('count-label').textContent = activeLinks + ' active link' + (activeLinks===1?'':'s');
  el('updated-label').textContent = 'updated ' + new Date().toLocaleTimeString();

  // spotlight nudge when a Voyager is active
  const spot = el('spotlight');
  spot.style.borderColor = voyagerActive ? 'var(--up)' : '';
  spot.style.boxShadow = voyagerActive ? '0 0 30px -10px rgba(245,158,11,.6)' : '';

  // wire modals
  stationsEl.querySelectorAll('.link').forEach(l=>{
    l.addEventListener('click', ()=> openModal(l.dataset.sc));
  });
}

function openModal(code){
  const info = craftInfo(code);
  el('m-name').textContent = info.n;
  el('m-tag').textContent = info.t || '';
  el('m-desc').textContent = info.d || '';
  const kv = el('m-kv'); kv.innerHTML = '';
  for(const k in (info.k||{})){
    kv.innerHTML += `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(info.k[k])}</dd>`;
  }
  el('modal').classList.remove('hidden');
}
function closeModal(){ el('modal').classList.add('hidden'); }
el('modal-close').addEventListener('click', closeModal);
el('modal').addEventListener('click', e=>{ if(e.target.id==='modal') closeModal(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

load();
setInterval(load, 10000);
