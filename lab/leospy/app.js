/* LEO Spy — live satellite tracker on a 3D globe.
   Pure three.js (single instance) + satellite.js SGP4. Orbital data is fetched
   directly from CelesTrak in the browser (it serves CORS headers) and the TLE
   text is parsed here — fully static, no server, no keys. */

// Parse CelesTrak 3-line TLE text into {name,l1,l2,id} records. Resyncs by
// skipping a line if a block is malformed, so one bad entry can't derail the set.
function parseTLE(text){
  const lines = text.split(/\r?\n/).map(s=>s.replace(/\s+$/,'')).filter(s=>s.length);
  const out = [];
  for(let i=0; i+2 < lines.length; ){
    const name = lines[i], l1 = lines[i+1], l2 = lines[i+2];
    if(l1 && l1[0]==='1' && l2 && l2[0]==='2'){
      out.push({ name:name.trim(), l1, l2, id:l1.substring(2,7).trim() });
      i += 3;
    } else { i += 1; }
  }
  return out;
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_R = 100;               // scene units for Earth's radius
const KM_PER_R = 6371;             // Earth radius in km
const sat = window.satellite;

// Catalogue groups offered in the panel. `g` is the CelesTrak GROUP id.
const GROUPS = [
  { g:'stations', label:'Space stations', color:0x4ade80, on:true  },
  { g:'visual',   label:'Brightest / visual', color:0xfbbf24, on:true },
  { g:'starlink', label:'Starlink', color:0x38bdf8, on:false },
  { g:'gps-ops',  label:'GPS', color:0xf472b6, on:false },
  { g:'galileo',  label:'Galileo', color:0xa78bfa, on:false },
  { g:'weather',  label:'Weather', color:0x34d399, on:false },
  { g:'science',  label:'Science', color:0xf87171, on:false },
  { g:'geo',      label:'Geostationary', color:0xe879f9, on:false },
  { g:'last-30-days', label:'New launches (30d)', color:0xffffff, on:false }
];
const MAX_SATS = 9000; // safety cap for performance

const el = id => document.getElementById(id);

// ---------- scene ----------
const container = el('globe');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 5000);
camera.position.set(0, 90, 320);
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.5;
controls.minDistance = 130;
controls.maxDistance = 900;
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;

// lights
scene.add(new THREE.AmbientLight(0x4a5066, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-1, 0.35, 0.8).multiplyScalar(500);
scene.add(sun);

const texLoader = new THREE.TextureLoader();
texLoader.crossOrigin = 'anonymous';

// starfield background sphere
texLoader.load('https://unpkg.com/three-globe@2.31.0/example/img/night-sky.png', t=>{
  t.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2500, 32, 32),
    new THREE.MeshBasicMaterial({ map:t, side:THREE.BackSide })
  );
  scene.add(sky);
}, undefined, ()=>{ scene.background = new THREE.Color(0x05060a); });

// Earth
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_R, 96, 96),
  new THREE.MeshPhongMaterial({ color:0x2233aa, shininess:8, specular:0x223344 })
);
scene.add(earth);
texLoader.load('https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg', t=>{
  t.colorSpace = THREE.SRGBColorSpace;
  earth.material.map = t; earth.material.color.set(0xffffff); earth.material.needsUpdate = true;
});
// faint atmosphere
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_R*1.025, 64, 64),
  new THREE.ShaderMaterial({
    transparent:true, side:THREE.BackSide, blending:THREE.AdditiveBlending,
    uniforms:{ c:{value:new THREE.Color(0x3b82f6)} },
    vertexShader:`varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 vN; uniform vec3 c;
      void main(){ float i=pow(0.72-dot(vN,vec3(0,0,1.0)),3.0);
      gl_FragColor=vec4(c,1.0)*clamp(i,0.0,1.0);}`
  })
);
scene.add(atmo);

// ---------- satellite point cloud ----------
function dotTexture(){
  const c = document.createElement('canvas'); c.width=c.height=64;
  const x=c.getContext('2d'); const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.4,'rgba(255,255,255,.9)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g; x.beginPath(); x.arc(32,32,32,0,7); x.fill();
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}
const DOT = dotTexture();

let sats = [];              // [{name,id,satrec,groupColor}]
let points = null;         // THREE.Points
let posAttr = null, colAttr = null;

// highlight marker for the selected satellite
const hi = new THREE.Sprite(new THREE.SpriteMaterial({
  map:DOT, color:0xffffff, transparent:true, depthWrite:false, sizeAttenuation:true
}));
hi.scale.setScalar(9); hi.visible=false; scene.add(hi);

function rebuildPoints(){
  if(points){ scene.remove(points); points.geometry.dispose(); points.material.dispose(); }
  const n = sats.length;
  const pos = new Float32Array(n*3);
  const col = new Float32Array(n*3);
  const col3 = new THREE.Color();
  for(let i=0;i<n;i++){ col3.setHex(sats[i].groupColor);
    col[i*3]=col3.r; col[i*3+1]=col3.g; col[i*3+2]=col3.b; }
  const geo = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(pos,3); posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr = new THREE.BufferAttribute(col,3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  const mat = new THREE.PointsMaterial({
    size:3.1, map:DOT, vertexColors:true, transparent:true, depthWrite:false,
    blending:THREE.AdditiveBlending, sizeAttenuation:true
  });
  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  el('sat-count').textContent = n.toLocaleString() + ' sats';
}

// ---------- orbital math ----------
const tmp = new THREE.Vector3();
function lla(lat, lng, altKm, out){
  const r = EARTH_R * (1 + altKm/KM_PER_R);
  const phi = (90 - lat) * Math.PI/180;
  const theta = (lng + 180) * Math.PI/180;
  const s = Math.sin(phi);
  out.set(-r*s*Math.cos(theta), r*Math.cos(phi), r*s*Math.sin(theta));
  return out;
}

function updatePositions(){
  if(!sats.length) return;
  const now = new Date();
  const gmst = sat.gstime(now);
  const arr = posAttr.array;
  for(let i=0;i<sats.length;i++){
    const s = sats[i];
    let ok=false;
    try{
      const pv = sat.propagate(s.satrec, now);
      if(pv && pv.position){
        const gd = sat.eciToGeodetic(pv.position, gmst);
        const lat = sat.degreesLat(gd.latitude);
        const lng = sat.degreesLong(gd.longitude);
        lla(lat, lng, gd.height, tmp);
        arr[i*3]=tmp.x; arr[i*3+1]=tmp.y; arr[i*3+2]=tmp.z;
        s.lat=lat; s.lng=lng; s.alt=gd.height;
        s.vel = pv.velocity ? Math.hypot(pv.velocity.x,pv.velocity.y,pv.velocity.z) : null;
        ok=true;
      }
    }catch(e){}
    if(!ok){ arr[i*3]=arr[i*3+1]=arr[i*3+2]=1e6; } // park decayed/bad sats far away
  }
  posAttr.needsUpdate = true;

  if(selected){
    const s = sats[selIndex];
    if(s && s.lat!=null){ lla(s.lat,s.lng,s.alt,hi.position); hi.visible=true; updateInfoLive(s); }
  }
  el('upd').textContent = now.toLocaleTimeString();
}

// ---------- data loading ----------
const loaded = {};   // group -> array of sats
let loadingCount = 0;

async function loadGroup(group){
  if(loaded[group]) return loaded[group];
  const row = document.querySelector(`[data-grp="${group}"]`);
  if(row) row.classList.add('loading-g');
  loadingCount++;
  try{
    const url = 'https://celestrak.org/NORAD/elements/gp.php?GROUP='+encodeURIComponent(group)+'&FORMAT=tle';
    const res = await fetch(url, { cache:'no-store' });
    if(!res.ok) throw new Error('feed '+res.status);
    const sats = parseTLE(await res.text());
    const cfg = GROUPS.find(x=>x.g===group);
    const out = [];
    for(const r of sats){
      try{
        const satrec = sat.twoline2satrec(r.l1, r.l2);
        if(satrec.error) continue;
        out.push({ name:r.name, id:r.id, satrec, groupColor:cfg.color, group });
      }catch(e){}
    }
    loaded[group] = out;
    const cntEl = document.querySelector(`[data-grp="${group}"] .cnt`);
    if(cntEl) cntEl.textContent = out.length;
    return out;
  }catch(e){
    const cntEl = document.querySelector(`[data-grp="${group}"] .cnt`);
    if(cntEl) cntEl.textContent = 'err';
    console.warn('LEO Spy: group failed', group, e.message);
    return [];
  }finally{
    loadingCount--;
    if(row) row.classList.remove('loading-g');
  }
}

async function rebuildFromSelection(){
  const active = GROUPS.filter(g=>g.on).map(g=>g.g);
  const lists = await Promise.all(active.map(loadGroup));
  // merge, de-dup by NORAD id (first group wins the colour)
  const byId = new Map();
  for(const list of lists) for(const s of list) if(!byId.has(s.id)) byId.set(s.id, s);
  sats = Array.from(byId.values()).slice(0, MAX_SATS);
  selected = false; selIndex = -1; hi.visible=false; el('info').classList.remove('show');
  rebuildPoints();
  updatePositions();
}

// ---------- UI: groups ----------
const groupsEl = el('groups');
for(const g of GROUPS){
  const lab = document.createElement('label');
  lab.className='grp'; lab.dataset.grp=g.g;
  lab.innerHTML = `<input type="checkbox" ${g.on?'checked':''}>
    <span class="chk">${g.on?'✓':''}</span>
    <span class="swatch" style="background:#${g.color.toString(16).padStart(6,'0')}"></span>
    <span>${g.label}</span><span class="cnt"></span>`;
  const cb = lab.querySelector('input');
  cb.addEventListener('change', async ()=>{
    g.on = cb.checked;
    lab.querySelector('.chk').textContent = cb.checked?'✓':'';
    await rebuildFromSelection();
  });
  groupsEl.appendChild(lab);
}

// ---------- UI: search ----------
const searchEl = el('search'), resultsEl = el('results');
searchEl.addEventListener('input', ()=>{
  const q = searchEl.value.trim().toLowerCase();
  resultsEl.innerHTML='';
  if(q.length<2) return;
  const hits=[];
  for(let i=0;i<sats.length && hits.length<8;i++){
    if(sats[i].name.toLowerCase().includes(q)) hits.push(i);
  }
  for(const i of hits){
    const b=document.createElement('button');
    b.textContent = sats[i].name;
    b.addEventListener('click', ()=>{ selectIndex(i); resultsEl.innerHTML=''; searchEl.value=sats[i].name; });
    resultsEl.appendChild(b);
  }
  if(!hits.length) resultsEl.innerHTML = '<button disabled style="opacity:.5">No matches loaded</button>';
});

// ---------- selection + info ----------
let selected=false, selIndex=-1;
function selectIndex(i){
  if(i<0||i>=sats.length) return;
  selIndex=i; selected=true;
  const s=sats[i];
  el('i-name').textContent = s.name;
  el('i-cat').textContent = (GROUPS.find(g=>g.g===s.group)||{}).label || s.group;
  el('i-id').textContent = s.id;
  const inc = s.satrec.inclo*180/Math.PI;
  const per = (2*Math.PI)/s.satrec.no; // minutes
  el('i-inc').textContent = inc.toFixed(2);
  el('i-per').textContent = per.toFixed(1);
  el('info').classList.add('show');
  controls.autoRotate=false;
  flyTo(i);
  updatePositions();
}
function updateInfoLive(s){
  if(s.alt!=null) el('i-alt').textContent = s.alt.toFixed(0);
  if(s.vel!=null) el('i-vel').textContent = s.vel.toFixed(2);
  if(s.lat!=null) el('i-lat').textContent = s.lat.toFixed(2);
  if(s.lng!=null) el('i-lon').textContent = s.lng.toFixed(2);
}
el('info-close').addEventListener('click', ()=>{
  selected=false; selIndex=-1; hi.visible=false; el('info').classList.remove('show');
});

// camera fly-to a satellite's current direction
let flyFrom=null, flyTo_=null, flyT=1;
function flyTo(i){
  const s=sats[i]; if(s.lat==null) return;
  lla(s.lat,s.lng,s.alt,tmp);
  const dist = camera.position.length();
  flyTo_ = tmp.clone().normalize().multiplyScalar(Math.max(dist, 180));
  flyFrom = camera.position.clone(); flyT=0;
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
ray.params.Points.threshold = 2.2;
const mouse = new THREE.Vector2();
const tip = el('tip');
let hoverIndex=-1;
function pick(clientX, clientY){
  if(!points) return -1;
  mouse.x = (clientX/innerWidth)*2-1;
  mouse.y = -(clientY/innerHeight)*2+1;
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObject(points);
  // prefer the closest to camera that's in front of the globe (not occluded by Earth)
  for(const h of hits){
    // skip points on the far side of the Earth (occluded)
    const p = h.point;
    const toCam = camera.position.clone().sub(p).normalize();
    const nrm = p.clone().normalize();
    // if the point sits very close to globe surface and faces away, it's hidden
    if(p.length() < EARTH_R*1.004 && nrm.dot(camera.position.clone().normalize())<0) continue;
    return h.index;
  }
  return hits.length?hits[0].index:-1;
}
renderer.domElement.addEventListener('pointermove', e=>{
  const i = pick(e.clientX, e.clientY);
  hoverIndex=i;
  if(i>=0 && sats[i]){
    tip.style.display='block'; tip.style.left=e.clientX+'px'; tip.style.top=e.clientY+'px';
    tip.textContent = sats[i].name;
    renderer.domElement.style.cursor='pointer';
  } else { tip.style.display='none'; renderer.domElement.style.cursor='grab'; }
});
renderer.domElement.addEventListener('pointerleave', ()=>{ tip.style.display='none'; });
renderer.domElement.addEventListener('pointerdown', ()=>{ controls.autoRotate=false; });
renderer.domElement.addEventListener('click', e=>{
  const i = pick(e.clientX, e.clientY);
  if(i>=0) selectIndex(i);
});

// mobile panel drag toggle
el('panel-toggle').addEventListener('click', ()=> el('panel').classList.toggle('open'));

// ---------- render loop ----------
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
function animate(){
  requestAnimationFrame(animate);
  if(flyT<1 && flyFrom && flyTo_){
    flyT=Math.min(1,flyT+0.03);
    camera.position.lerpVectors(flyFrom, flyTo_, flyT<0.5?2*flyT*flyT:1-Math.pow(-2*flyT+2,2)/2);
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

// position refresh (adaptive rate)
let lastUpdate=0;
function tickLoop(ts){
  requestAnimationFrame(tickLoop);
  const rate = sats.length>1500 ? 1000 : 400;
  if(ts-lastUpdate >= rate){ lastUpdate=ts; updatePositions(); }
}
requestAnimationFrame(tickLoop);

// ---------- boot ----------
(async function boot(){
  try{
    await rebuildFromSelection();
  }catch(e){ console.error(e); }
  el('loading').classList.add('gone');
  setTimeout(()=>el('loading').remove(), 700);
})();
