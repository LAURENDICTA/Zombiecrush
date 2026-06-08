/* ═══════════════════════════════════════════════════════════════
   ZOMBIE SMASH: NIGHTFALL  —  game.js  (complete build)
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ───────────────────────────────────────────────
   CONSTANTS
─────────────────────────────────────────────── */
const ZOMBIE_DEFS = {
  // size      = hit-radius in pixels (used for collision & spawning margin)
  // spriteW/H = natural dimensions of the SVG sprite
  // draw renders at (size*2 x size*2.5) — aspect-ratio-aware
  walker: { hp:1, speed:0.55, points:10, size:28, spriteW:64, spriteH:80, color:'#4caf50', eyeColor:'#ffee58', unlockScore:0,   dmg:10 },
  runner: { hp:1, speed:1.4,  points:20, size:22, spriteW:56, spriteH:76, color:'#2e7d32', eyeColor:'#ffee58', unlockScore:20,  dmg:15 },
  tank:   { hp:3, speed:0.38, points:50, size:42, spriteW:80, spriteH:96, color:'#7b1fa2', eyeColor:'#ff1744', unlockScore:50,  dmg:25 },
  ghost:  { hp:1, speed:0.82, points:40, size:26, spriteW:60, spriteH:80, color:'#9c27b0', eyeColor:'#e040fb', unlockScore:75,  dmg:20 },
  toxic:  { hp:2, speed:0.68, points:60, size:32, spriteW:68, spriteH:84, color:'#558b2f', eyeColor:'#c6ff00', unlockScore:100, dmg:20 },
};

// ── SPRITE ASSET REGISTRY ──────────────────────────────────────────────────
// Maps each zombie type to its SVG/PNG path.
// The asset loader (preloadAssets) loads these; if a file is missing the game
// falls back to the procedural canvas drawing. Never crashes on missing assets.
// ── ZOMBIE SPRITE PATHS ──────────────────────────────────────────────────
// Paths are relative to index.html (repo root).
// PNGs live at root level: walker.png, runner.png, tank.png, ghost.png, toxic.png
// If any file is missing, the game falls back to procedural canvas drawing.
const ZOMBIE_SPRITE_PATHS = {
  walker: 'walker.png',
  runner: 'runner.png',
  tank:   'tank.png',
  ghost:  'ghost.png',
  toxic:  'toxic.png',
};

const POWERUP_TYPES  = ['holyBomb','freeze','lightning','health'];
const POWERUP_ICONS  = { holyBomb:'✝', freeze:'\u{1F550}', lightning:'⚡', health:'\u{1F49A}' };
const POWERUP_LABELS = { holyBomb:'HOLY BOMB!', freeze:'FREEZE TIME!', lightning:'LIGHTNING STRIKE!', health:'+25 HP!' };
const POWERUP_COLORS = { holyBomb:'#ffffff', freeze:'#64b5f6', lightning:'#ffd54f', health:'#81c784' };
const BASE_HP        = 100;
const COMBO_WINDOW   = 2.2;   // seconds between kills to maintain combo
const WAVE_INTERVAL  = 30;    // seconds between difficulty steps
const POWERUP_SPAWN_INTERVAL = 30;

/* ───────────────────────────────────────────────
   STATE
─────────────────────────────────────────────── */
const state = {
  screen:'loading', score:0,
  highScore: +( localStorage.getItem('zs_hs') || 0 ),
  hp:BASE_HP, wave:1, timeAlive:0, difficulty:1,
  paused:false, gameRunning:false, lastTime:0,
  comboCount:0, comboTimer:0,
  spawnTimer:0, difficultyTimer:0, powerupTimer:0,
  freezeTimer:0, frozen:false,
  muted:false, sfxOn:true, musicOn:true,
  // settings persisted
  get settingsMusicOn(){ return JSON.parse(localStorage.getItem('zs_music') ?? 'true'); },
  get settingsSfxOn(){   return JSON.parse(localStorage.getItem('zs_sfx')   ?? 'true'); },
};

// Load persisted settings on startup
state.sfxOn   = state.settingsSfxOn;
state.musicOn = state.settingsMusicOn;

let zombies   = [];
let particles = [];
let powerups  = [];
let flashEffects = [];  // screen-level flash rings
let scorePopQueue = [];

// Background scene elements
let stars = [], bats = [], fogLayers = [];
let lightningFx = { active:false, alpha:0, nextFlash:4 };

/* ───────────────────────────────────────────────
   CANVAS
─────────────────────────────────────────────── */
const gameCanvas = document.getElementById('game-canvas');
const gctx       = gameCanvas.getContext('2d');
const bgCanvas   = document.getElementById('bg-canvas');
const bctx       = bgCanvas.getContext('2d');

let W=0, H=0, CX=0, CY=0;

function resize(){
  W  = gameCanvas.width  = bgCanvas.width  = window.innerWidth;
  H  = gameCanvas.height = bgCanvas.height = window.innerHeight;
  CX = W/2; CY = H/2;
  initSceneElements();
}
window.addEventListener('resize', resize);
resize();

/* ───────────────────────────────────────────────
   ASSET LOADER  (graceful fallback on missing files)
─────────────────────────────────────────────── */
const assetCache = {};
// ── AUDIO ASSET PATHS ────────────────────────────────────────────────────
// These .mp3 files are OPTIONAL. If missing, the game uses the Web Audio API
// synthesizer for all sound effects and ambient music automatically.
// To add real audio: place .mp3 files at repo root and update paths below.
// Current status: no audio files in repo → 100% synthesized audio.
const ASSET_PATHS = {
  bgMusic:      'bg-music.mp3',
  sfxHit:       'zombie-hit.mp3',
  sfxDeath:     'zombie-death.mp3',
  sfxClick:     'button-click.mp3',
  sfxGameover:  'game-over.mp3',
};

function loadImage(key, src){
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => {
      assetCache[key] = img;
      resolve(img);
    };
    img.onerror = () => {
      // Asset missing — log for DevTools debugging, then fall back gracefully.
      // The game continues with procedural canvas rendering for zombies,
      // or simply skips the image for non-critical assets.
      console.warn(`[ZombieSmash] Asset not found: ${src} (key: ${key}) — using fallback`);
      resolve(null);
    };
    img.src = src;
  });
}

function loadAudioBuffer(key, src){
  return new Promise(resolve => {
    fetch(src)
      .then(r => { if(!r.ok) throw new Error(); return r.arrayBuffer(); })
      .then(buf => audioCtx.decodeAudioData(buf))
      .then(decoded => { assetCache[key] = decoded; resolve(decoded); })
      .catch(() => resolve(null));
  });
}

async function preloadAssets(onProgress){
  // Build image jobs from ZOMBIE_SPRITE_PATHS so adding a new zombie type
  // automatically includes it in preloading — no need to touch this function.
  const zombieJobs = Object.entries(ZOMBIE_SPRITE_PATHS)
    .map(([key, path]) => ['zombie_' + key, path]);

  // All paths are relative to index.html (repo root).
  // Background and powerups are SVGs; zombies are PNGs.
  // Any missing file resolves to null — game never crashes.
  const imageJobs = [
    ['bg',        'graveyard-bg.svg'],
    ...zombieJobs,
    ['holyBomb',  'holy-bomb.svg'],
    ['freeze',    'freeze-time.svg'],
    ['lightning', 'lightning.svg'],
    ['health',    'health.svg'],
  ];

  const audioJobs = Object.entries(ASSET_PATHS);
  const total = imageJobs.length + audioJobs.length;
  let done = 0;

  const tick = () => { done++; onProgress(done/total); };

  await Promise.all([
    ...imageJobs.map(([k,s])  => loadImage(k,s).then(tick)),
    ...audioJobs.map(([k,s])  => loadAudioBuffer(k,s).then(tick)),
  ]);
}

/* ───────────────────────────────────────────────
   AUDIO ENGINE  (Web Audio + optional file assets)
─────────────────────────────────────────────── */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let bgGain, sfxGain, musicNode = null, musicScheduled = false;

function initAudio(){
  bgGain  = audioCtx.createGain(); bgGain.gain.value  = 0.22; bgGain.connect(audioCtx.destination);
  sfxGain = audioCtx.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(audioCtx.destination);
  applyAudioSettings();
  startAmbientMusic();
}

function resumeAudio(){
  if(audioCtx.state === 'suspended') audioCtx.resume();
}

function applyAudioSettings(){
  if(!bgGain || !sfxGain) return;
  bgGain.gain.value  = (state.muted || !state.musicOn) ? 0 : 0.22;
  sfxGain.gain.value = (state.muted || !state.sfxOn)   ? 0 : 0.55;
}

function startAmbientMusic(){
  if(!state.musicOn || musicScheduled) return;
  musicScheduled = true;

  // Try file asset first, fall back to procedural
  if(assetCache.bgMusic){
    const playFileMusic = () => {
      if(!state.musicOn) { musicScheduled = false; return; }
      const src = audioCtx.createBufferSource();
      src.buffer = assetCache.bgMusic;
      src.loop   = true;
      src.connect(bgGain);
      src.start();
      musicNode = src;
    };
    playFileMusic();
    return;
  }

  // Procedural horror ambient
  const schedule = () => {
    if(!state.musicOn){ musicScheduled = false; return; }
    const t    = audioCtx.currentTime;
    const freqs = [55, 58.27, 61.74, 65.41, 73.42, 49, 52];
    const f    = freqs[Math.floor(Math.random()*freqs.length)];

    // Low drone
    const osc1 = audioCtx.createOscillator();
    const g1   = audioCtx.createGain();
    osc1.type  = 'sawtooth'; osc1.frequency.value = f;
    osc1.connect(g1); g1.connect(bgGain);
    g1.gain.setValueAtTime(0,t);
    g1.gain.linearRampToValueAtTime(0.07, t+1.2);
    g1.gain.linearRampToValueAtTime(0,    t+4.5);
    osc1.start(t); osc1.stop(t+5);

    // Harmonic shimmer
    if(Math.random() > 0.5){
      const osc2 = audioCtx.createOscillator();
      const g2   = audioCtx.createGain();
      osc2.type  = 'sine'; osc2.frequency.value = f*3.01;
      osc2.connect(g2); g2.connect(bgGain);
      g2.gain.setValueAtTime(0,t+0.3);
      g2.gain.linearRampToValueAtTime(0.025, t+1.5);
      g2.gain.linearRampToValueAtTime(0,     t+4);
      osc2.start(t+0.3); osc2.stop(t+5);
    }
    setTimeout(schedule, (2200 + Math.random()*3500));
  };
  schedule();
}

function stopMusic(){
  if(musicNode){ try{ musicNode.stop(); }catch(e){} musicNode=null; }
  musicScheduled = false;
}

/* SFX synthesizer — uses file buffers when available, else synth */
function playSfx(type){
  if(!state.sfxOn || !sfxGain) return;
  const now = audioCtx.currentTime;

  // Play file-based SFX if loaded
  const fileMap = { hit:'sfxHit', death:'sfxDeath', click:'sfxClick', gameover:'sfxGameover' };
  if(fileMap[type] && assetCache[fileMap[type]]){
    const src = audioCtx.createBufferSource();
    src.buffer = assetCache[fileMap[type]];
    src.connect(sfxGain);
    src.start();
    return;
  }

  // Synthesized fallback
  try{
    switch(type){
      case 'hit':{
        const o=audioCtx.createOscillator(), g=audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type='square';
        o.frequency.setValueAtTime(240,now);
        o.frequency.exponentialRampToValueAtTime(70,now+0.13);
        g.gain.setValueAtTime(0.28,now);
        g.gain.linearRampToValueAtTime(0,now+0.13);
        o.start(now); o.stop(now+0.15);
        break;
      }
      case 'death':{
        // Noise burst
        const len = audioCtx.sampleRate*0.28;
        const buf = audioCtx.createBuffer(1,len,audioCtx.sampleRate);
        const d   = buf.getChannelData(0);
        for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len)*0.9;
        const src = audioCtx.createBufferSource();
        const flt = audioCtx.createBiquadFilter();
        const g   = audioCtx.createGain();
        flt.type='bandpass'; flt.frequency.value=300; flt.Q.value=2;
        src.buffer=buf;
        src.connect(flt); flt.connect(g); g.connect(sfxGain);
        g.gain.value=0.45;
        src.start(now);
        break;
      }
      case 'powerup':{
        [0,0.1,0.2,0.3].forEach((delay,i)=>{
          const o=audioCtx.createOscillator(), g=audioCtx.createGain();
          o.connect(g); g.connect(sfxGain);
          o.type='sine'; o.frequency.value=330+i*220;
          g.gain.setValueAtTime(0.18,now+delay);
          g.gain.linearRampToValueAtTime(0,now+delay+0.18);
          o.start(now+delay); o.stop(now+delay+0.2);
        });
        break;
      }
      case 'gameover':{
        [220,196,174.6,155.6,130.8].forEach((freq,i)=>{
          const o=audioCtx.createOscillator(), g=audioCtx.createGain();
          o.connect(g); g.connect(sfxGain);
          o.type='sawtooth'; o.frequency.value=freq;
          g.gain.setValueAtTime(0.28,now+i*0.22);
          g.gain.linearRampToValueAtTime(0,now+i*0.22+0.5);
          o.start(now+i*0.22); o.stop(now+i*0.22+0.55);
        });
        break;
      }
      case 'wave':{
        const o=audioCtx.createOscillator(), g=audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type='square'; o.frequency.value=880;
        o.frequency.exponentialRampToValueAtTime(440,now+0.35);
        g.gain.setValueAtTime(0.18,now);
        g.gain.linearRampToValueAtTime(0,now+0.45);
        o.start(now); o.stop(now+0.5);
        break;
      }
      case 'click':{
        const o=audioCtx.createOscillator(), g=audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type='sine'; o.frequency.value=680;
        g.gain.setValueAtTime(0.12,now);
        g.gain.linearRampToValueAtTime(0,now+0.07);
        o.start(now); o.stop(now+0.09);
        break;
      }
      case 'combo':{
        const o=audioCtx.createOscillator(), g=audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type='sine'; o.frequency.value=1100;
        o.frequency.linearRampToValueAtTime(1600,now+0.12);
        g.gain.setValueAtTime(0.15,now);
        g.gain.linearRampToValueAtTime(0,now+0.2);
        o.start(now); o.stop(now+0.22);
        break;
      }
      case 'damage':{
        const o=audioCtx.createOscillator(), g=audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type='sawtooth'; o.frequency.value=180;
        o.frequency.exponentialRampToValueAtTime(60,now+0.2);
        g.gain.setValueAtTime(0.35,now);
        g.gain.linearRampToValueAtTime(0,now+0.25);
        o.start(now); o.stop(now+0.28);
        break;
      }
    }
  }catch(e){}
}

/* ───────────────────────────────────────────────
   BACKGROUND / SCENE
─────────────────────────────────────────────── */
function initSceneElements(){
  // Stars
  stars = [];
  for(let i=0;i<80;i++){
    stars.push({
      x:Math.random()*W, y:Math.random()*H,
      r:Math.random()*1.4+0.2,
      twinkleOff:Math.random()*Math.PI*2,
      twinkleSpeed:Math.random()*0.8+0.3,
      opacity:Math.random()*0.6+0.15,
    });
  }
  // Bats
  bats = [];
  for(let i=0;i<6;i++){
    bats.push({
      x:Math.random()*W, y:Math.random()*H*0.38,
      vx:(Math.random()-0.5)*2.2, vy:(Math.random()-0.5)*0.6,
      wing:0, wingDir:1, size:Math.random()*9+5,
    });
  }
  // Fog
  fogLayers = [];
  for(let i=0;i<4;i++){
    fogLayers.push({
      x:Math.random()*W,
      y:H*0.48+Math.random()*H*0.45,
      w:W*(1.6+Math.random()*0.8),
      h:70+Math.random()*90,
      speed:0.08+Math.random()*0.18,
      opacity:0.035+Math.random()*0.055,
    });
  }
}

const GRAVESTONES = [
  {rx:0.05,ry:0.85,rw:22,rh:32},{rx:0.14,ry:0.88,rw:18,rh:26},
  {rx:0.25,ry:0.92,rw:14,rh:20},{rx:0.38,ry:0.91,rw:20,rh:28},
  {rx:0.55,ry:0.90,rw:16,rh:23},{rx:0.68,ry:0.93,rw:17,rh:22},
  {rx:0.80,ry:0.86,rw:24,rh:34},{rx:0.91,ry:0.89,rw:19,rh:27},
];

function drawScene(ctx,w,h,t){
  // Sky
  const sky=ctx.createLinearGradient(0,0,0,h);
  sky.addColorStop(0,'#010508');
  sky.addColorStop(0.55,'#050d0a');
  sky.addColorStop(1,'#091405');
  ctx.fillStyle=sky; ctx.fillRect(0,0,w,h);

  // Stars
  stars.forEach(s=>{
    const tw=0.4+0.6*Math.sin(t*s.twinkleSpeed*0.001+s.twinkleOff);
    ctx.beginPath();
    ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
    ctx.fillStyle=`rgba(180,255,200,${s.opacity*tw})`;
    ctx.fill();
  });

  // Moon
  const mx=w*0.76, my=h*0.12, mr=38;
  const mg=ctx.createRadialGradient(mx,my,mr*0.5,mx,my,mr*3);
  mg.addColorStop(0,'rgba(180,255,210,0.1)');
  mg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=mg;
  ctx.beginPath(); ctx.arc(mx,my,mr*3,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(mx,my,mr,0,Math.PI*2);
  ctx.fillStyle='#d8f5e0';
  ctx.shadowColor='#b3ffc6'; ctx.shadowBlur=22;
  ctx.fill(); ctx.shadowBlur=0;
  // Moon craters
  ctx.fillStyle='rgba(0,30,10,0.12)';
  [[mx-10,my-8,6],[mx+12,my+5,4],[mx-4,my+14,5]].forEach(([cx,cy,cr])=>{
    ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill();
  });

  // Fog
  fogLayers.forEach(f=>{
    f.x-=f.speed;
    if(f.x+f.w<0) f.x=w;
    const fg=ctx.createLinearGradient(f.x,f.y,f.x,f.y+f.h);
    fg.addColorStop(0,'rgba(0,0,0,0)');
    fg.addColorStop(0.4,`rgba(20,45,28,${f.opacity})`);
    fg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=fg;
    ctx.beginPath();
    ctx.ellipse(f.x+f.w/2,f.y+f.h/2,f.w/2,f.h/2,0,0,Math.PI*2);
    ctx.fill();
  });

  // Bats
  bats.forEach(b=>{
    b.x+=b.vx; b.y+=b.vy;
    b.wing+=0.22*b.wingDir;
    if(Math.abs(b.wing)>1) b.wingDir*=-1;
    if(b.x<-40){b.x=w+40; b.y=Math.random()*h*0.4;}
    if(b.x>w+40){b.x=-40; b.y=Math.random()*h*0.4;}
    if(b.y<0) b.vy=Math.abs(b.vy);
    if(b.y>h*0.45) b.vy=-Math.abs(b.vy);
    ctx.save(); ctx.translate(b.x,b.y);
    ctx.fillStyle='#080808';
    const wy=b.wing*b.size*0.75;
    [-1,1].forEach(side=>{
      ctx.beginPath();
      ctx.moveTo(0,0);
      ctx.bezierCurveTo(side*b.size,wy,side*b.size*2.2,wy*0.4,side*b.size*2.8,0);
      ctx.bezierCurveTo(side*b.size*2.2,-wy*0.25,side*b.size,0,0,0);
      ctx.fill();
    });
    ctx.restore();
  });

  // Gravestones
  ctx.fillStyle='#060e07';
  GRAVESTONES.forEach(g=>{
    const gx=w*g.rx, gy=h*g.ry, gw=g.rw, gh=g.rh;
    ctx.beginPath();
    ctx.roundRect(gx-gw/2,gy-gh,gw,gh*0.7,[gw/2,gw/2,0,0]);
    ctx.rect(gx-gw*0.3,gy-gh*0.3,gw*0.6,gh*0.3);
    ctx.fill();
    ctx.fillRect(gx-1,gy-gh+6,2,gh*0.5);
    ctx.fillRect(gx-gw*0.3,gy-gh+gh*0.25,gw*0.6,2);
  });

  // Ground
  const grd=ctx.createLinearGradient(0,h*0.88,0,h);
  grd.addColorStop(0,'#0a1a0a'); grd.addColorStop(1,'#040a04');
  ctx.fillStyle=grd; ctx.fillRect(0,h*0.88,w,h*0.12);

  // Lightning flash overlay
  if(lightningFx.active && lightningFx.alpha>0){
    ctx.fillStyle=`rgba(180,255,210,${lightningFx.alpha*0.18})`;
    ctx.fillRect(0,0,w,h);
  }
}

/* ───────────────────────────────────────────────
   ZOMBIE CLASS
─────────────────────────────────────────────── */
class Zombie {
  constructor(type, speedMult=1){
    const def     = ZOMBIE_DEFS[type];
    this.type     = type;
    this.hp       = def.hp;
    this.maxHp    = def.hp;
    this.speed    = def.speed * speedMult;
    this.points   = def.points;
    this.size     = def.size;
    this.color    = def.color;
    this.eyeColor = def.eyeColor;
    this.dmg      = def.dmg;
    this.dead     = false;
    this.reached  = false;
    this.wobble   = Math.random()*Math.PI*2;
    this.wobbleSpeed = 2.5+Math.random()*1.5;
    this.hitFlash = 0;  // white flash on damage

    // Ghost-specific
    this.ghostAlpha   = 1;
    this.ghostFadeDir = -1;
    this.ghostTimer   = 0;
    this.ghostFadeable= false; // becomes true after first cycle

    // Spawn from random edge with small margin randomisation
    const edge   = Math.floor(Math.random()*4);
    const margin = this.size + 10;
    if(edge===0){this.x=Math.random()*W;    this.y=-margin;}
    else if(edge===1){this.x=W+margin;      this.y=Math.random()*H;}
    else if(edge===2){this.x=Math.random()*W; this.y=H+margin;}
    else{this.x=-margin;                    this.y=Math.random()*H;}
  }

  update(dt){
    if(this.dead||this.reached) return;

    // Frozen by powerup
    if(state.frozen) return;

    // Ghost alpha cycle (becomes harder to hit)
    if(this.type==='ghost'){
      this.ghostTimer+=dt;
      if(this.ghostTimer>0.8){
        this.ghostFadeable=true;
        this.ghostAlpha+=this.ghostFadeDir*dt*1.8;
        if(this.ghostAlpha<=0.12){this.ghostAlpha=0.12; this.ghostFadeDir=1;}
        if(this.ghostAlpha>=1){this.ghostAlpha=1; this.ghostFadeDir=-1; this.ghostTimer=0;}
      }
    }

    // Hit flash decay
    if(this.hitFlash>0) this.hitFlash=Math.max(0,this.hitFlash-dt*6);

    this.wobble+=dt*this.wobbleSpeed;

    // Move toward center
    const dx=CX-this.x, dy=CY-this.y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    if(dist < this.size*0.55){ this.reached=true; return; }
    const nx=dx/dist, ny=dy/dist;
    this.x+=nx*this.speed*dt*60;
    this.y+=ny*this.speed*dt*60;
  }

  /* ─────────────────────────────────────────────────────────────────
     draw()  —  Image-sprite renderer with procedural fallback.

     Strategy:
       1. Look up assetCache['zombie_' + this.type] (loaded in preloadAssets)
       2. If found → drawImage() with wobble transform, ghost alpha, hit flash
       3. If missing (file not found / still loading) → draw procedural shape
          so the game always works, even without asset files.

     The sprite is drawn centred on (this.x, this.y) and scaled so the
     sprite height equals size * 2.8.  This keeps visual size consistent
     with the hit-radius used by hitTest().
  ───────────────────────────────────────────────────────────────── */
  draw(ctx){
    if(this.dead) return;

    const s      = this.size;
    const sprite = assetCache['zombie_' + this.type];

    ctx.save();

    // ── Ghost: set global alpha for the whole zombie (sprite or fallback) ──
    if(this.type === 'ghost') ctx.globalAlpha = this.ghostAlpha;

    // ── Shared transform: centre on zombie position + wobble lean ──────────
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.sin(this.wobble) * 0.1);

    // ── Drop shadow (always drawn, adds depth behind sprite) ───────────────
    ctx.beginPath();
    ctx.ellipse(0, s * 0.7, s * 0.65, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fill();

    if(sprite){
      // ── SPRITE PATH ──────────────────────────────────────────────────────
      const def    = ZOMBIE_DEFS[this.type];
      // Scale sprite so its height = s * 2.8, preserving aspect ratio
      const drawH  = s * 2.8;
      const drawW  = drawH * (def.spriteW / def.spriteH);
      const drawX  = -drawW / 2;
      const drawY  = -drawH * 0.75;   // anchor: feet at +s*0.7 (matches shadow)

      // ── Hit-flash overlay: draw tinted white rect over sprite ─────────────
      if(this.hitFlash > 0){
        // Draw sprite first at reduced opacity
        ctx.globalAlpha = (this.type === 'ghost' ? this.ghostAlpha : 1) * (1 - this.hitFlash * 0.5);
        ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
        // Overlay white flash composited on top
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = this.hitFlash * 0.85;
        ctx.fillStyle   = '#ffffff';
        ctx.fillRect(drawX, drawY, drawW, drawH);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = (this.type === 'ghost') ? this.ghostAlpha : 1;
      } else {
        ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
      }

      // ── Ghost: extra ethereal pulse rings around sprite ────────────────
      if(this.type === 'ghost'){
        const pulseR = s * 1.1 + Math.sin(this.wobble * 0.5) * s * 0.15;
        ctx.beginPath();
        ctx.arc(0, -s * 0.1, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(224,64,251,0.18)';
        ctx.lineWidth   = 3;
        ctx.stroke();
      }

      // ── Toxic: orbiting fume bubbles overlaid on sprite ───────────────
      if(this.type === 'toxic'){
        for(let i = 0; i < 3; i++){
          const ta  = this.wobble * 0.8 + i * (Math.PI * 2 / 3);
          const bx  = Math.cos(ta) * s * 0.9;
          const by  = Math.sin(ta) * s * 0.6 - s * 0.3;
          const br  = s * 0.14 + Math.sin(this.wobble + i) * 0.04;
          ctx.beginPath();
          ctx.arc(bx, by, s * br, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(198,255,0,0.45)';
          ctx.shadowColor = '#c6ff00';
          ctx.shadowBlur  = 6;
          ctx.fill();
          ctx.shadowBlur  = 0;
        }
      }

    } else {
      // ── PROCEDURAL FALLBACK ───────────────────────────────────────────────
      // Renders a recognisable zombie shape when sprite file is missing.
      // Identical to the original canvas drawing so gameplay is unaffected.
      const bodyColor = this.hitFlash > 0
        ? `rgba(255,255,255,${this.hitFlash})`
        : this.color;

      // Body
      ctx.beginPath();
      ctx.roundRect(-s*0.33, -s*0.18, s*0.66, s*0.78, s*0.14);
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // Head
      ctx.beginPath();
      ctx.arc(0, -s*0.36, s*0.31, 0, Math.PI*2);
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // Eyes
      [-s*0.12, s*0.12].forEach(ex => {
        ctx.beginPath();
        ctx.arc(ex, -s*0.36, s*0.085, 0, Math.PI*2);
        ctx.fillStyle   = this.eyeColor;
        ctx.shadowColor = this.eyeColor;
        ctx.shadowBlur  = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Arms
      ctx.lineWidth   = s * 0.13;
      ctx.lineCap     = 'round';
      ctx.strokeStyle = bodyColor;
      [[-s*0.33, -s*0.5],[s*0.33, s*0.5]].forEach(([ax, tx]) => {
        ctx.beginPath();
        ctx.moveTo(ax, s*0.05);
        ctx.lineTo(tx * 0.55 + (ax > 0 ? s*0.12 : -s*0.12), s*0.32);
        ctx.stroke();
      });

      // Legs
      ctx.lineWidth = s * 0.14;
      [-s*0.18, s*0.18].forEach(lx => {
        ctx.beginPath();
        ctx.moveTo(lx, s*0.58);
        ctx.lineTo(lx + Math.sin(this.wobble) * s*0.1, s*0.78);
        ctx.stroke();
      });

      // Tank helmet
      if(this.type === 'tank'){
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(0, -s*0.6, s*0.24, Math.PI, 0);
        ctx.fill();
      }
      // Ghost aura
      if(this.type === 'ghost'){
        ctx.beginPath();
        ctx.arc(0, -s*0.1, s*0.75, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(156,39,176,0.08)';
        ctx.fill();
      }
      // Toxic fumes
      if(this.type === 'toxic'){
        for(let i = 0; i < 3; i++){
          const ta = this.wobble + i * (Math.PI*2/3);
          ctx.beginPath();
          ctx.arc(Math.cos(ta)*s*0.5, Math.sin(ta)*s*0.4 - s*0.15, s*0.1, 0, Math.PI*2);
          ctx.fillStyle = 'rgba(197,255,0,0.3)';
          ctx.fill();
        }
      }
    }

    // ── HP bar: always drawn on top of sprite, for multi-hit zombies ──────
    if(this.maxHp > 1){
      const bw = s * 1.4, bh = 5;
      const bx = -bw / 2, by = -s * 1.0;
      // Background
      ctx.fillStyle = '#1a0000';
      ctx.fillRect(bx, by, bw, bh);
      // Fill
      const pct    = this.hp / this.maxHp;
      ctx.fillStyle = pct > 0.6 ? '#4caf50' : pct > 0.3 ? '#ff9800' : '#f44336';
      ctx.fillRect(bx, by, bw * pct, bh);
      // Border
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(bx, by, bw, bh);
    }

    ctx.restore();
  }

  hitTest(tx,ty){
    const dx=tx-this.x, dy=ty-this.y;
    const r=this.size*(this.type==='ghost' ? 0.75 : 1.15);
    return dx*dx+dy*dy < r*r;
  }
}

/* ───────────────────────────────────────────────
   PARTICLE CLASS
─────────────────────────────────────────────── */
class Particle {
  constructor(x,y,color,opts={}){
    this.x=x; this.y=y;
    const angle=Math.random()*Math.PI*2;
    const spd=(opts.speed||1)*(Math.random()*3.5+1);
    this.vx=Math.cos(angle)*spd;
    this.vy=Math.sin(angle)*spd-(opts.upBias||2);
    this.life=1;
    this.decay=opts.decay||1.8;
    this.color=color;
    this.r=Math.random()*(opts.maxR||5)+(opts.minR||1.5);
    this.gravity=opts.gravity||0.14;
    this.glow=opts.glow||false;
  }
  update(dt){
    this.x+=this.vx*dt*60;
    this.vy+=this.gravity;
    this.y+=this.vy*dt*60;
    this.life-=dt*this.decay;
    this.vx*=0.98;
  }
  draw(ctx){
    if(this.life<=0) return;
    ctx.save();
    ctx.globalAlpha=Math.max(0,this.life);
    if(this.glow){ ctx.shadowColor=this.color; ctx.shadowBlur=10; }
    ctx.beginPath();
    ctx.arc(this.x,this.y,this.r,0,Math.PI*2);
    ctx.fillStyle=this.color;
    ctx.fill();
    ctx.restore();
  }
}

function spawnParticles(x,y,color,count=12,opts={}){
  for(let i=0;i<count;i++) particles.push(new Particle(x,y,color,opts));
}

/* ───────────────────────────────────────────────
   POWERUP CLASS
─────────────────────────────────────────────── */
class Powerup {
  constructor(){
    this.type      = POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
    this.size      = 28;
    this.life      = 12; // seconds before despawn
    this.pulse     = 0;
    this.collected = false;
    // Spawn away from center and edges
    const pad=80;
    this.x=pad+Math.random()*(W-pad*2);
    this.y=pad+Math.random()*(H-pad*2);
    // Keep away from center base
    const dx=this.x-CX, dy=this.y-CY;
    if(Math.sqrt(dx*dx+dy*dy)<80){
      this.x+=dx>0?80:-80;
      this.y+=dy>0?60:-60;
    }
  }
  update(dt){
    this.life-=dt;
    this.pulse+=dt*4;
    if(this.life<=0) this.collected=true;
  }
  draw(ctx){
    if(this.collected) return;
    const urgency=this.life<3;
    const alpha=urgency
      ? (0.5+0.5*Math.sin(this.pulse*6))*(this.life/3)
      : 1;
    ctx.save();
    ctx.globalAlpha=alpha;
    const s=this.size+Math.sin(this.pulse)*3.5;
    const col=POWERUP_COLORS[this.type];
    // Outer glow
    ctx.beginPath(); ctx.arc(this.x,this.y,s*1.5,0,Math.PI*2);
    ctx.fillStyle=col+'18'; ctx.fill();
    // Ring
    ctx.beginPath(); ctx.arc(this.x,this.y,s*1.1,0,Math.PI*2);
    ctx.strokeStyle=col+'66'; ctx.lineWidth=2; ctx.stroke();
    // Background disc
    ctx.beginPath(); ctx.arc(this.x,this.y,s,0,Math.PI*2);
    ctx.fillStyle='#0c1a10';
    ctx.strokeStyle=col;
    ctx.lineWidth=2.5;
    ctx.shadowColor=col; ctx.shadowBlur=12;
    ctx.fill(); ctx.stroke(); ctx.shadowBlur=0;
    // Icon
    ctx.font=`${s*1.1}px serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(POWERUP_ICONS[this.type],this.x,this.y);
    // Time ring
    const timePct=this.life/12;
    ctx.beginPath();
    ctx.arc(this.x,this.y,s+6,-Math.PI/2,-Math.PI/2+Math.PI*2*timePct);
    ctx.strokeStyle=col; ctx.lineWidth=2; ctx.stroke();
    ctx.restore();
  }
  hitTest(tx,ty){
    const dx=tx-this.x, dy=ty-this.y;
    return dx*dx+dy*dy < (this.size*1.4)*(this.size*1.4);
  }
}

/* ───────────────────────────────────────────────
   SPAWN SYSTEM
─────────────────────────────────────────────── */
function getSpawnInterval(){
  // Starts at 2.2s, decreases with difficulty, floor 0.5s
  return Math.max(0.5, 2.2-(state.difficulty-1)*0.14);
}

function getUnlockedTypes(){
  const t=['walker'];
  if(state.score>=20)  t.push('runner');
  if(state.score>=50)  t.push('tank');
  if(state.score>=75)  t.push('ghost');
  if(state.score>=100) t.push('toxic');
  return t;
}

function pickZombieType(){
  const types=getUnlockedTypes();
  // Weight table: common zombies spawn more often
  const weights={walker:5,runner:4,tank:2,ghost:2,toxic:2};
  const pool=[];
  types.forEach(t=>{ for(let i=0;i<(weights[t]||1);i++) pool.push(t); });
  return pool[Math.floor(Math.random()*pool.length)];
}

function spawnZombie(){
  const type     = pickZombieType();
  const speedMult= 1+(state.difficulty-1)*0.10; // +10% per wave
  zombies.push(new Zombie(type,speedMult));
}

/* ───────────────────────────────────────────────
   POWERUP EFFECTS
─────────────────────────────────────────────── */
function applyPowerup(type){
  playSfx('powerup');
  showPowerupLabel(type);

  switch(type){
    case 'holyBomb':{
      let pts=0;
      zombies.forEach(z=>{
        if(z.dead) return;
        spawnParticles(z.x,z.y,z.color,14,{glow:true,speed:1.5});
        z.dead=true;
        pts+=z.points;
      });
      if(pts>0) addScore(pts, CX, CY*0.6, 1, '✝ HOLY BOMB +'+pts);
      // Screen white flash
      lightningFx.active=true; lightningFx.alpha=1.5;
      break;
    }
    case 'freeze':{
      state.frozen=true;
      state.freezeTimer=5;
      // Ice particles across screen
      for(let i=0;i<20;i++){
        spawnParticles(
          Math.random()*W, Math.random()*H,
          '#64b5f6', 1,
          {gravity:-0.05,speed:0.5,decay:0.8,glow:true}
        );
      }
      break;
    }
    case 'lightning':{
      const nearest=zombies
        .filter(z=>!z.dead)
        .sort((a,b)=>{
          const da=(a.x-CX)**2+(a.y-CY)**2;
          const db=(b.x-CX)**2+(b.y-CY)**2;
          return da-db;
        })
        .slice(0,10);
      let pts=0;
      nearest.forEach(z=>{
        spawnParticles(z.x,z.y,'#ffd54f',10,{glow:true,speed:2});
        z.dead=true;
        pts+=z.points;
      });
      if(pts>0) addScore(pts,CX,CY*0.6,1,'⚡ +'+pts);
      lightningFx.active=true; lightningFx.alpha=1;
      break;
    }
    case 'health':{
      const gained=Math.min(25, BASE_HP-state.hp);
      state.hp=Math.min(BASE_HP,state.hp+25);
      updateHPBar();
      spawnParticles(CX,CY,'#81c784',16,{gravity:-0.08,speed:1.2,glow:true});
      break;
    }
  }
}

function showPowerupLabel(type){
  const el=document.createElement('div');
  el.className='powerup-indicator';
  el.style.color=POWERUP_COLORS[type];
  el.textContent=POWERUP_LABELS[type];
  document.getElementById('screen-game').appendChild(el);
  setTimeout(()=>el.remove(),2200);
}

/* ───────────────────────────────────────────────
   SCORE / COMBO / HUD
─────────────────────────────────────────────── */
function getComboMult(){
  if(state.comboCount>=10) return 5;
  if(state.comboCount>=5)  return 3;
  if(state.comboCount>=3)  return 2;
  return 1;
}

function addScore(base, x, y, mult=1, label=null){
  const final=base*mult;
  state.score+=final;
  document.getElementById('hud-score').textContent=state.score.toLocaleString();
  if(state.score>state.highScore){
    state.highScore=state.score;
    document.getElementById('hud-highscore').textContent=state.highScore.toLocaleString();
  }
  if(x!==undefined) showScorePop(x,y,label||(mult>1?`+${final} x${mult}`:`+${final}`),mult>1);
}

function showScorePop(x,y,text,isCombo=false){
  const el=document.createElement('div');
  el.className='score-pop'+(isCombo?' combo':'');
  el.style.left=(x-30)+'px';
  el.style.top=(y-50)+'px';
  el.textContent=text;
  document.getElementById('screen-game').appendChild(el);
  setTimeout(()=>{ if(el.parentNode) el.remove(); },750);
}

function updateComboDisplay(){
  const el=document.getElementById('combo-display');
  if(state.comboCount<3){ el.classList.add('hidden'); return; }
  const mult=getComboMult();
  el.textContent=`COMBO ×${mult}`;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.add('hidden'),1400);
}

function updateHPBar(){
  const pct=Math.max(0,state.hp/BASE_HP*100);
  const bar=document.getElementById('hp-bar');
  bar.style.width=pct+'%';
  document.getElementById('hp-value').textContent=Math.max(0,state.hp);
  if(pct<25)      bar.style.background='linear-gradient(90deg,#ff1744,#ff4444)';
  else if(pct<50) bar.style.background='linear-gradient(90deg,#ff6f00,#ff9800)';
  else            bar.style.background='linear-gradient(90deg,#ff2222,#ff6644)';
}

/* ───────────────────────────────────────────────
   SCREEN SHAKE
─────────────────────────────────────────────── */
let shakeTimer=0;
function triggerShake(dur=0.4){
  shakeTimer=dur;
  const el=document.getElementById('screen-game');
  el.classList.remove('shaking');
  void el.offsetWidth;
  el.classList.add('shaking');
  setTimeout(()=>el.classList.remove('shaking'),(dur*1000)|0);
}

/* ───────────────────────────────────────────────
   INPUT / TOUCH
─────────────────────────────────────────────── */
function handleTap(cx,cy){
  if(!state.gameRunning||state.paused) return;
  resumeAudio();

  // Check powerups first (highest priority)
  for(let i=powerups.length-1;i>=0;i--){
    if(!powerups[i].collected && powerups[i].hitTest(cx,cy)){
      powerups[i].collected=true;
      applyPowerup(powerups[i].type);
      return;
    }
  }

  let hitZombie=false;
  // Iterate in reverse so topmost (last drawn) gets priority
  for(let i=zombies.length-1;i>=0;i--){
    const z=zombies[i];
    if(z.dead||z.reached) continue;
    if(z.type==='ghost' && z.ghostFadeable && z.ghostAlpha<0.45) continue;
    if(!z.hitTest(cx,cy)) continue;

    hitZombie=true;
    playSfx('hit');
    z.hp--;
    z.hitFlash=1;

    if(z.hp<=0){
      z.dead=true;
      playSfx('death');
      spawnParticles(z.x,z.y,z.color,14,{speed:1.3,glow:true});
      // Small secondary colour burst
      spawnParticles(z.x,z.y,'#b3ffc6',6,{speed:0.8,decay:2.5,minR:1,maxR:3});

      // Toxic chain explosion
      if(z.type==='toxic'){
        const blastR=90;
        zombies.forEach(other=>{
          if(other===z||other.dead) return;
          const ddx=other.x-z.x, ddy=other.y-z.y;
          if(ddx*ddx+ddy*ddy<blastR*blastR){
            other.dead=true;
            spawnParticles(other.x,other.y,'#c6ff00',10,{speed:1.2,glow:true});
            addScore(other.points,other.x,other.y,getComboMult());
          }
        });
        // Toxic ring visual
        flashEffects.push({x:z.x,y:z.y,r:0,maxR:blastR,color:'#c6ff00',life:1});
      }

      // Combo
      state.comboCount++;
      state.comboTimer=COMBO_WINDOW;
      const mult=getComboMult();
      if(state.comboCount>=3){ playSfx('combo'); updateComboDisplay(); }
      addScore(z.points,z.x,z.y,mult);
    }
    break; // only one zombie per tap
  }

  if(!hitZombie){
    // Miss — only reset combo if we tapped on non-zombie area
    // (don't reset on powerup taps, handled above)
    state.comboCount=0;
    state.comboTimer=0;
    document.getElementById('combo-display').classList.add('hidden');
    // Tiny miss indicator
    spawnParticles(cx,cy,'#ff1744',3,{speed:0.6,gravity:0.3,decay:4,minR:1,maxR:2});
  }
}

// Mouse
gameCanvas.addEventListener('click', e=>{ e.preventDefault(); handleTap(e.clientX,e.clientY); });
// Touch (multi-touch support)
gameCanvas.addEventListener('touchstart', e=>{
  e.preventDefault();
  Array.from(e.changedTouches).forEach(t=>handleTap(t.clientX,t.clientY));
},{passive:false});
gameCanvas.addEventListener('touchmove', e=>e.preventDefault(),{passive:false});

/* ───────────────────────────────────────────────
   DRAW BASE
─────────────────────────────────────────────── */
function drawBase(){
  const r=38;
  const hpRatio=state.hp/BASE_HP;
  const baseColor= hpRatio>0.5?'#4cff7e': hpRatio>0.25?'#ff9800':'#ff1744';

  // Outer danger ring pulses when low HP
  if(hpRatio<0.35){
    const pulseAlpha=0.3+0.3*Math.sin(Date.now()*0.006);
    const dangerGlow=gctx.createRadialGradient(CX,CY,r,CX,CY,r*3);
    dangerGlow.addColorStop(0,`rgba(255,23,68,${pulseAlpha})`);
    dangerGlow.addColorStop(1,'rgba(0,0,0,0)');
    gctx.fillStyle=dangerGlow;
    gctx.beginPath(); gctx.arc(CX,CY,r*3,0,Math.PI*2); gctx.fill();
  }

  // Glow ring
  const glow=gctx.createRadialGradient(CX,CY,r*0.4,CX,CY,r*2.8);
  glow.addColorStop(0,baseColor+'28');
  glow.addColorStop(1,'rgba(0,0,0,0)');
  gctx.fillStyle=glow;
  gctx.beginPath(); gctx.arc(CX,CY,r*2.8,0,Math.PI*2); gctx.fill();

  // Base disc
  gctx.beginPath(); gctx.arc(CX,CY,r,0,Math.PI*2);
  gctx.fillStyle='#091508';
  gctx.strokeStyle=baseColor;
  gctx.lineWidth=3;
  gctx.shadowColor=baseColor; gctx.shadowBlur=14;
  gctx.fill(); gctx.stroke();
  gctx.shadowBlur=0;

  // HP arc overlay
  gctx.beginPath();
  gctx.arc(CX,CY,r+5,-Math.PI/2,-Math.PI/2+Math.PI*2*hpRatio);
  gctx.strokeStyle=baseColor+'88'; gctx.lineWidth=4; gctx.stroke();

  // Icon
  gctx.font=`${r*0.9}px serif`;
  gctx.textAlign='center'; gctx.textBaseline='middle';
  gctx.fillText('\u{1F3E0}',CX,CY+2);

  // Freeze ice overlay on base
  if(state.frozen){
    gctx.beginPath(); gctx.arc(CX,CY,r,0,Math.PI*2);
    gctx.fillStyle='rgba(100,181,246,0.15)'; gctx.fill();
  }
}

/* ───────────────────────────────────────────────
   DRAW FLASH RING EFFECTS
─────────────────────────────────────────────── */
function updateFlashEffects(dt){
  flashEffects=flashEffects.filter(f=>{
    f.r+=dt*200;
    f.life-=dt*3;
    if(f.life>0){
      gctx.beginPath();
      gctx.arc(f.x,f.y,f.r,0,Math.PI*2);
      gctx.strokeStyle=f.color;
      gctx.lineWidth=3;
      gctx.globalAlpha=f.life*0.7;
      gctx.stroke();
      gctx.globalAlpha=1;
    }
    return f.life>0;
  });
}

/* ───────────────────────────────────────────────
   DRAW FREEZE OVERLAY
─────────────────────────────────────────────── */
function drawFreezeOverlay(){
  const t=state.freezeTimer/5;
  gctx.fillStyle=`rgba(100,181,246,${0.04+t*0.04})`;
  gctx.fillRect(0,0,W,H);
  gctx.strokeStyle=`rgba(100,181,246,${0.2+t*0.2})`;
  gctx.lineWidth=4;
  gctx.setLineDash([12,10]);
  gctx.strokeRect(5,5,W-10,H-10);
  gctx.setLineDash([]);
  // Freeze timer text
  gctx.fillStyle=`rgba(100,181,246,0.7)`;
  gctx.font='bold 14px Oswald,sans-serif';
  gctx.textAlign='center';
  gctx.fillText(`❄ FROZEN ${Math.ceil(state.freezeTimer)}s`,CX,H-80);
}

/* ───────────────────────────────────────────────
   WAVE ANNOUNCEMENT
─────────────────────────────────────────────── */
function announceWave(){
  const el=document.getElementById('wave-announce');
  el.textContent=`⚠ WAVE ${state.wave}`;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.add('hidden'),2200);
  document.getElementById('hud-wave').textContent=state.wave;
}

/* ───────────────────────────────────────────────
   MAIN GAME LOOP
─────────────────────────────────────────────── */
let rafId=null;
let bgRafId=null;

function gameLoop(ts){
  if(!state.gameRunning) return;
  const dt=Math.min((ts-state.lastTime)/1000,0.05);
  state.lastTime=ts;

  if(!state.paused){
    /* ─── Update timers ─── */
    state.timeAlive+=dt;

    // Combo decay
    if(state.comboTimer>0){
      state.comboTimer-=dt;
      if(state.comboTimer<=0){
        state.comboCount=0;
        document.getElementById('combo-display').classList.add('hidden');
      }
    }

    // Freeze decay
    if(state.frozen){
      state.freezeTimer-=dt;
      if(state.freezeTimer<=0){ state.frozen=false; state.freezeTimer=0; }
    }

    /* ─── Difficulty / Wave Progression ─── */
    state.difficultyTimer+=dt;
    if(state.difficultyTimer>=WAVE_INTERVAL){
      state.difficultyTimer=0;
      state.difficulty++;
      state.wave++;
      playSfx('wave');
      triggerShake(0.5);
      announceWave();
    }

    /* ─── Zombie Spawning ─── */
    state.spawnTimer+=dt;
    const interval=getSpawnInterval();
    if(state.spawnTimer>=interval){
      state.spawnTimer=0;
      spawnZombie();
      // Extra spawns at higher waves
      if(state.wave>=3 && Math.random()<0.4) spawnZombie();
      if(state.wave>=5 && Math.random()<0.35) spawnZombie();
      if(state.wave>=8 && Math.random()<0.3)  spawnZombie();
    }

    /* ─── Powerup Spawning ─── */
    state.powerupTimer+=dt;
    if(state.powerupTimer>=POWERUP_SPAWN_INTERVAL){
      state.powerupTimer=0;
      powerups.push(new Powerup());
    }

    /* ─── Lightning ambient effect ─── */
    lightningFx.nextFlash-=dt;
    if(lightningFx.nextFlash<=0){
      lightningFx.active=true;
      lightningFx.alpha=0.8+Math.random()*0.4;
      lightningFx.nextFlash=6+Math.random()*14;
    }
    if(lightningFx.active){
      lightningFx.alpha-=dt*3.5;
      if(lightningFx.alpha<=0){ lightningFx.active=false; lightningFx.alpha=0; }
    }

    /* ─── Update entities ─── */
    zombies.forEach(z=>z.update(dt));
    particles=particles.filter(p=>{ p.update(dt); return p.life>0; });
    powerups.forEach(p=>p.update(dt));
    powerups=powerups.filter(p=>!p.collected);

    /* ─── Zombie reached center ─── */
    for(let i=zombies.length-1;i>=0;i--){
      const z=zombies[i];
      if(!z.reached) continue;
      state.hp-=z.dmg;
      playSfx('damage');
      triggerShake(0.35);
      spawnParticles(CX,CY,'#ff1744',8,{speed:1.5,gravity:0.2,glow:true});
      zombies.splice(i,1);
      updateHPBar();
      if(state.hp<=0){ endGame(); return; }
    }

    // Remove dead zombies
    zombies=zombies.filter(z=>!z.dead);
  }

  /* ─── RENDER ─── */
  gctx.clearRect(0,0,W,H);
  drawScene(gctx,W,H,ts);
  drawBase();
  powerups.forEach(p=>p.draw(gctx));
  zombies.forEach(z=>z.draw(gctx));
  particles.forEach(p=>p.draw(gctx));
  updateFlashEffects(dt);
  if(state.frozen) drawFreezeOverlay();

  rafId=requestAnimationFrame(gameLoop);
}

/* ───────────────────────────────────────────────
   BACKGROUND MENU LOOP
─────────────────────────────────────────────── */
function bgLoop(ts){
  drawScene(bctx,W,H,ts);
  bgRafId=requestAnimationFrame(bgLoop);
}

/* ───────────────────────────────────────────────
   SAFE BACKGROUND LOOP STARTER
   Always cancels any existing bgLoop before starting a new one.
   Call this every time you want the animated menu background.
─────────────────────────────────────────────── */
function startBgLoop(){
  cancelAnimationFrame(bgRafId);
  bgRafId=null;
  bgRafId=requestAnimationFrame(bgLoop);
}

/* ───────────────────────────────────────────────
   RESET GAME  — single source of truth for full reset
   Call before every startGame(). Clears ALL mutable state:
   arrays, timers, DOM leftovers, RAF ids, HUD.
─────────────────────────────────────────────── */
function resetGame(){
  /* 1. Kill every RAF loop */
  cancelAnimationFrame(rafId);   rafId=null;
  cancelAnimationFrame(bgRafId); bgRafId=null;

  /* 2. Clear all game-object arrays */
  zombies      = [];
  particles    = [];
  powerups     = [];
  flashEffects = [];
  scorePopQueue= [];

  /* 3. Reset lightning ambient effect */
  lightningFx.active   = false;
  lightningFx.alpha    = 0;
  lightningFx.nextFlash= 4 + Math.random()*4;

  /* 4. Reset shakeTimer */
  shakeTimer = 0;
  const gameEl = document.getElementById('screen-game');
  if(gameEl) gameEl.classList.remove('shaking');

  /* 5. Cancel any pending wave/combo announce timeouts */
  const waveEl  = document.getElementById('wave-announce');
  const comboEl = document.getElementById('combo-display');
  if(waveEl._t)  { clearTimeout(waveEl._t);  waveEl._t=null; }
  if(comboEl._t) { clearTimeout(comboEl._t); comboEl._t=null; }

  /* 6. Remove any orphaned score-pop DOM nodes from previous game */
  document.querySelectorAll('.score-pop, .powerup-indicator').forEach(el=>el.remove());

  /* 7. Reset full game state object (preserves highScore, muted, sfxOn, musicOn) */
  Object.assign(state, {
    score:          0,
    hp:             BASE_HP,
    wave:           1,
    timeAlive:      0,
    difficulty:     1,
    paused:         false,
    gameRunning:    false,        // startGame() sets this true after reset
    lastTime:       0,
    comboCount:     0,
    comboTimer:     0,
    spawnTimer:     0,
    difficultyTimer:0,
    powerupTimer:   POWERUP_SPAWN_INTERVAL * 0.5,
    freezeTimer:    0,
    frozen:         false,
  });

  /* 8. Reset HUD to clean initial values */
  document.getElementById('hud-score').textContent    = '0';
  document.getElementById('hud-highscore').textContent= state.highScore.toLocaleString();
  document.getElementById('hud-wave').textContent     = '1';
  document.getElementById('hp-bar').style.width       = '100%';
  document.getElementById('hp-bar').style.background  = 'linear-gradient(90deg,#ff2222,#ff6644)';
  document.getElementById('hp-value').textContent     = '100';
  document.getElementById('btn-pause').textContent    = '⏸';

  /* 9. Hide all in-game overlays */
  document.getElementById('screen-pause').style.display    = 'none';
  document.getElementById('screen-gameover').style.display = 'none';

  /* 10. Hide transient HUD elements */
  waveEl.classList.add('hidden');
  comboEl.classList.add('hidden');

  /* 11. Clear canvas so previous frame doesn't ghost */
  gctx.clearRect(0, 0, W, H);
}

/* ───────────────────────────────────────────────
   GAME START
─────────────────────────────────────────────── */
function startGame(){
  playSfx('click');

  // resetGame() is the single source of truth — clears EVERYTHING
  resetGame();

  // Now mark running and show screen
  state.gameRunning = true;
  state.highScore   = +( localStorage.getItem('zs_hs')||0 );
  document.getElementById('hud-highscore').textContent = state.highScore.toLocaleString();

  showScreen('game');
  state.lastTime = performance.now();
  rafId = requestAnimationFrame(gameLoop);
}

/* ───────────────────────────────────────────────
   GAME OVER
─────────────────────────────────────────────── */
function endGame(){
  // Stop the loop first — prevents any more frames from running
  state.gameRunning = false;
  cancelAnimationFrame(rafId);
  rafId = null;

  state.hp = 0;
  playSfx('gameover');
  updateHPBar();

  const prevBest=+( localStorage.getItem('zs_hs')||0 );
  const isRecord=state.score>prevBest;

  if(isRecord){
    localStorage.setItem('zs_hs', state.score);
    document.getElementById('new-record-banner').classList.remove('hidden');
  } else {
    document.getElementById('new-record-banner').classList.add('hidden');
  }

  saveLeaderboard(state.score);

  document.getElementById('go-score').textContent=state.score.toLocaleString();
  document.getElementById('go-time').textContent=formatTime(Math.floor(state.timeAlive));
  document.getElementById('go-wave').textContent=state.wave;
  document.getElementById('go-best').textContent=Math.max(state.score,prevBest).toLocaleString();

  // Show game over overlay on top of game canvas
  const go=document.getElementById('screen-gameover');
  go.style.display='flex';
  go.classList.remove('hidden-overlay');
}

function formatTime(s){
  if(s<60) return s+'s';
  const m=Math.floor(s/60), sec=s%60;
  return `${m}m ${sec}s`;
}

/* ───────────────────────────────────────────────
   LEADERBOARD  (LocalStorage top-10)
─────────────────────────────────────────────── */
function saveLeaderboard(score){
  let lb=JSON.parse(localStorage.getItem('zs_lb')||'[]');
  lb.push({ score, date:new Date().toLocaleDateString(), time:formatTime(Math.floor(state.timeAlive)), wave:state.wave });
  lb.sort((a,b)=>b.score-a.score);
  lb=lb.slice(0,10);
  localStorage.setItem('zs_lb',JSON.stringify(lb));
}

function renderLeaderboard(){
  const lb=JSON.parse(localStorage.getItem('zs_lb')||'[]');
  const el=document.getElementById('leaderboard-list');
  if(!lb.length){
    el.innerHTML='<div class="lb-empty">No scores yet — play to get on the board!</div>';
    return;
  }
  const medals=['\u{1F947}','\u{1F948}','\u{1F949}'];
  el.innerHTML=lb.map((e,i)=>`
    <div class="lb-row ${i===0?'gold':''}">
      <div class="lb-rank">${medals[i]||(i+1)}</div>
      <div class="lb-info">
        <div class="lb-score">${e.score.toLocaleString()}</div>
        <div class="lb-meta">Wave ${e.wave} · ${e.time} · ${e.date}</div>
      </div>
    </div>
  `).join('');
}

/* ───────────────────────────────────────────────
   SCREEN MANAGER
─────────────────────────────────────────────── */
const ALL_SCREENS=['loading','menu','instructions','leaderboard','settings','game','pause','gameover'];

function showScreen(name){
  ALL_SCREENS.forEach(s=>{
    const el=document.getElementById(`screen-${s}`);
    if(!el) return;
    const isOverlay=(s==='pause'||s==='gameover');
    if(isOverlay) return; // overlays are managed independently
    if(s===name){
      el.style.display='flex';
      el.style.pointerEvents='auto';
      el.classList.add('active');
    } else {
      el.style.display='none';       // explicit none — never falls back to CSS
      el.style.pointerEvents='none'; // belt-and-suspenders: block all clicks
      el.classList.remove('active');
    }
  });
  state.screen=name;
}

/* ───────────────────────────────────────────────
   SETTINGS & AUDIO TOGGLES
─────────────────────────────────────────────── */
function syncAllMuteButtons(){
  document.querySelectorAll('.mute-btn').forEach(b=>{
    b.textContent=state.muted?'\u{1F507}':'\u{1F50A}';
    b.classList.toggle('muted',state.muted);
  });
  applyAudioSettings();
}

function toggleMusic(){
  state.musicOn=!state.musicOn;
  localStorage.setItem('zs_music',state.musicOn);
  const btn=document.getElementById('toggle-music');
  btn.textContent=state.musicOn?'ON':'OFF';
  btn.classList.toggle('off',!state.musicOn);
  applyAudioSettings();
  if(state.musicOn){ musicScheduled=false; startAmbientMusic(); }
  else stopMusic();
}

function toggleSfx(){
  state.sfxOn=!state.sfxOn;
  localStorage.setItem('zs_sfx',state.sfxOn);
  const btn=document.getElementById('toggle-sfx');
  btn.textContent=state.sfxOn?'ON':'OFF';
  btn.classList.toggle('off',!state.sfxOn);
  applyAudioSettings();
}

/* Sync UI state on load */
function initSettingsUI(){
  const mBtn=document.getElementById('toggle-music');
  const sBtn=document.getElementById('toggle-sfx');
  mBtn.textContent=state.musicOn?'ON':'OFF';
  mBtn.classList.toggle('off',!state.musicOn);
  sBtn.textContent=state.sfxOn?'ON':'OFF';
  sBtn.classList.toggle('off',!state.sfxOn);
}

/* ───────────────────────────────────────────────
   EVENT WIRING
─────────────────────────────────────────────── */
function wire(id,fn){ document.getElementById(id)?.addEventListener('click',fn); }

wire('btn-play',          ()=>{ resumeAudio(); startGame(); });
wire('btn-instructions',  ()=>{ playSfx('click'); showScreen('instructions'); });
wire('btn-leaderboard',   ()=>{ playSfx('click'); renderLeaderboard(); showScreen('leaderboard'); });
wire('btn-settings',      ()=>{ playSfx('click'); showScreen('settings'); });
wire('btn-back-instructions',()=>{ playSfx('click'); showScreen('menu'); });
wire('btn-back-leaderboard',()=>{ playSfx('click'); showScreen('menu'); });
wire('btn-back-settings',  ()=>{ playSfx('click'); showScreen('menu'); });
wire('toggle-music',       ()=>{ resumeAudio(); toggleMusic(); });
wire('toggle-sfx',         ()=>{ resumeAudio(); toggleSfx(); });

wire('btn-reset-score',()=>{
  if(!confirm('Reset all scores and leaderboard?')) return;
  localStorage.removeItem('zs_hs');
  localStorage.removeItem('zs_lb');
  state.highScore=0;
  playSfx('click');
  alert('Scores reset!');
});

wire('btn-mute-menu',()=>{ resumeAudio(); state.muted=!state.muted; syncAllMuteButtons(); });
wire('btn-mute-game',()=>{ state.muted=!state.muted; syncAllMuteButtons(); });

wire('btn-pause',()=>{
  state.paused=!state.paused;
  document.getElementById('btn-pause').textContent=state.paused?'▶':'⏸';
  const po=document.getElementById('screen-pause');
  po.style.display=state.paused?'flex':'none';
  if(state.paused) playSfx('click');
});

wire('btn-resume',()=>{
  playSfx('click');
  state.paused=false;
  document.getElementById('btn-pause').textContent='⏸';
  document.getElementById('screen-pause').style.display='none';
  state.lastTime=performance.now();
});

wire('btn-menu-from-pause',()=>{
  playSfx('click');
  // Full reset so no state leaks if player returns to play again
  resetGame();
  showScreen('menu');
  initSceneElements();
  startBgLoop();
});

wire('btn-play-again',()=>{
  playSfx('click');
  // startGame() internally calls resetGame() which hides gameover overlay
  startGame();
});

wire('btn-main-menu',()=>{
  playSfx('click');
  resetGame();          // clears everything, hides gameover overlay
  showScreen('menu');
  initSceneElements();
  startBgLoop();
});

/* Keyboard: P = pause, M = mute, Esc = menu from pause */
document.addEventListener('keydown',e=>{
  if(e.key==='p'||e.key==='P'){
    if(state.gameRunning) document.getElementById('btn-pause').click();
  }
  if(e.key==='m'||e.key==='M'){
    state.muted=!state.muted; syncAllMuteButtons();
  }
  if(e.key==='Escape'){
    if(state.paused) document.getElementById('btn-menu-from-pause').click();
  }
});

/* ───────────────────────────────────────────────
   BOOT  — Loading screen → preload → menu
─────────────────────────────────────────────── */
async function boot(){
  const bar=document.getElementById('loading-bar');

  // ── Explicitly hide every screen, then show only loading ──────────────
  // This is the single source of truth for initial visibility.
  // CSS must NOT have display:flex on any screen — JS owns display state.
  ALL_SCREENS.forEach(s=>{
    const el=document.getElementById(`screen-${s}`);
    if(!el) return;
    el.style.display='none';
    el.style.pointerEvents='none';
    el.classList.remove('active');
  });
  const loadEl=document.getElementById('screen-loading');
  loadEl.style.display='flex';
  loadEl.style.pointerEvents='auto';
  loadEl.classList.add('active');
  // ──────────────────────────────────────────────────────────────────────

  initAudio();
  initSettingsUI();

  // Preload assets with progress
  await preloadAssets(pct=>{
    bar.style.width=(pct*100).toFixed(1)+'%';
  });

  // Small dramatic pause
  await new Promise(r=>setTimeout(r,400));

  // Transition to menu — showScreen() will hide loading, show menu
  showScreen('menu');
  initSceneElements();
  startBgLoop();

  state.highScore=+( localStorage.getItem('zs_hs')||0 );
}

boot();
