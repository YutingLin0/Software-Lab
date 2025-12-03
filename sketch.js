/* Neon Expanding Polygons + Trails & Sparks + Pulse + Mic + Text labels
   + Sessions (music composition) + Auto Mood Tracking + Instrument Modes + Save-as-image
*/

let polys = [];
let sparks = [];
let links  = [];
let labels = [];
let lastKeyPos = null;
let activityLevel = 0;

// microphone
let mic = null;
let micLevel = 0;
let micLevelSmooth = 0;

// base words
const WORDS = ["echo", "spark", "drift", "pulse", "glow", "loop", "trail", "bloom"];

const MOOD_WORDS = {
  calm:    ["drift","float","hush","still","breathe"],
  anxious: ["static","flicker","scatter","buzz","tangle"],
  tired:   ["fade","slow","dim","heavy","exhale"],
  hopeful: ["bloom","rise","gleam","open","reach"],
  excited: ["flare","spark","burst","rush","shine"],
  heavy:   ["sink","weight","dense","cloud","press"],
  unlabeled: WORDS
};

const MOOD_HUE_SHIFT = {
  calm: -20,
  anxious: 10,
  tired: -10,
  hopeful: 20,
  excited: 30,
  heavy: -30,
  unlabeled: 0
};

/* Instrument modes: sound + aesthetic tweaks */

const INSTRUMENTS = {
  piano: {
    id: "piano",
    label: "Piano",
    wave: "triangle",
    attack: 0.005,
    decay: 0.18,
    freqMul: 1.0,
    ampMul: 1.0,
    stopTime: 0.3,
    hueShift: 0,
    polySides: [4,5,6,7],
    polyGrowMul: 1.0,
    sparkShapeBias: 0.45,
    pulseAmpMul: 1.0,
    bgFadeAlpha: 32
  },
  drum: {
    id: "drum",
    label: "Drums",
    wave: "square",
    attack: 0.001,
    decay: 0.12,
    freqMul: 0.35,
    ampMul: 1.25,
    stopTime: 0.22,
    hueShift: -40,
    polySides: [3,4,5],
    polyGrowMul: 1.4,
    sparkShapeBias: 0.85,
    pulseAmpMul: 1.4,
    bgFadeAlpha: 60
  },
  flute: {
    id: "flute",
    label: "Flute",
    wave: "sine",
    attack: 0.02,
    decay: 0.38,
    freqMul: 0.9,
    ampMul: 0.9,
    stopTime: 0.45,
    hueShift: 25,
    polySides: [5,6,7,8],
    polyGrowMul: 0.85,
    sparkShapeBias: 0.2,
    pulseAmpMul: 0.95,
    bgFadeAlpha: 20
  },
  guitar: {
    id: "guitar",
    label: "Guitar",
    wave: "sawtooth",
    attack: 0.003,
    decay: 0.24,
    freqMul: 1.1,
    ampMul: 1.15,
    stopTime: 0.35,
    hueShift: -10,
    polySides: [3,5,6],
    polyGrowMul: 1.15,
    sparkShapeBias: 0.6,
    pulseAmpMul: 1.1,
    bgFadeAlpha: 40
  },
  chimes: {
    id: "chimes",
    label: "Chimes",
    wave: "sine",
    attack: 0.01,
    decay: 0.45,
    freqMul: 1.4,
    ampMul: 1.2,
    stopTime: 0.6,
    hueShift: 45,
    polySides: [6,8],
    polyGrowMul: 0.95,
    sparkShapeBias: 0.3,
    pulseAmpMul: 1.25,
    bgFadeAlpha: 22
  }
};

let currentInstrument = "piano";
let instrumentNotice = null;
let instrumentNoticeTime = 0;
let instrumentCommandBuffer = "";

/* Session state */

let sessionActive = false;
let sessionEnded  = false;
let sessionDurationMs = 0;
let sessionStartTime  = 0;
let sessionSummary = null;

// auto mood
let selectedMood = null; 
let recentKeyTimes = [];

// stats
let keyCounts = {};
let totalKeys = 0;
let clickCount = 0;
let dragSpawnCount = 0;
let firstKeyTime = null;
let lastKeyTime  = null;

/* Key layout */

const KEY_LAYOUT = "1234567890qwertyuiopasdfghjklzxcvbnm";

function keyToPos(k){
  const idx = KEY_LAYOUT.indexOf(k.toLowerCase());
  if (idx === -1) return null;
  const cols = 10;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const x = map(col, 0, cols - 1, width * 0.1, width * 0.9);
  const y = map(row, 0, Math.ceil(KEY_LAYOUT.length / cols) - 1, height * 0.2, height * 0.8);
  return { x, y };
}

/* p5.sound unlock */

const hasSound = typeof window.p5 !== "undefined"
  && typeof p5.Oscillator === "function"
  && typeof p5.Envelope === "function";

let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked || !hasSound) return;
  try {
    if (typeof userStartAudio === 'function') userStartAudio().catch(()=>{});
    const ctx = (typeof getAudioContext === 'function') ? getAudioContext() : null;
    if (ctx && ctx.state !== 'running') ctx.resume();
    if (!ctx || ctx.state === 'running') {
      audioUnlocked = true;
      ['pointerdown','touchstart','mousedown','keydown','visibilitychange'].forEach(type => {
        window.removeEventListener(type, unlockAudioOnce, true);
        document.removeEventListener(type, unlockAudioOnce, true);
      });
    }
  } catch(_) {}
}

['pointerdown','touchstart','mousedown','keydown','visibilitychange'].forEach(t=>{
  window.addEventListener(t, unlockAudioOnce, {capture:true, passive:false});
  document.addEventListener(t, unlockAudioOnce, {capture:true, passive:false});
});
const ensureAudio = () => unlockAudioOnce();

/* Instrument helpers */

function getInstrumentConfig() {
  return INSTRUMENTS[currentInstrument] || INSTRUMENTS.piano;
}

function setInstrument(name) {
  if (!INSTRUMENTS[name]) return;
  currentInstrument = name;
  instrumentNotice = `Instrument: ${INSTRUMENTS[name].label}`;
  instrumentNoticeTime = millis();
}

function handleInstrumentTyping(ch){
  const lower = ch.toLowerCase();
  if (!/[a-z]/.test(lower)) return;
  instrumentCommandBuffer += lower;
  if (instrumentCommandBuffer.length > 12) {
    instrumentCommandBuffer = instrumentCommandBuffer.slice(-12);
  }
  const words = ["piano","drum","flute","guitar","chimes"];
  for (const w of words) {
    if (instrumentCommandBuffer.endsWith(w)) {
      setInstrument(w);
      instrumentCommandBuffer = "";
      break;
    }
  }
}

function playPluck(freq, amp=0.7) {
  if (!hasSound || !audioUnlocked) return;
  const cfg = getInstrumentConfig();

  const osc = new p5.Oscillator(cfg.wave || "triangle");
  const env = new p5.Envelope(cfg.attack || 0.005, 1.0, cfg.decay || 0.12, 0.0);

  const f = constrain(freq * (cfg.freqMul || 1.0), 80, 3000);
  const a = amp * (cfg.ampMul || 1.0);

  osc.start();
  osc.freq(f, 0);
  osc.amp(env);
  env.mult(a);
  env.play(osc);

  const ctx = (typeof getAudioContext === 'function') ? getAudioContext() : null;
  const stopTime = (cfg.stopTime || 0.3);
  if (ctx) {
    osc.stop(ctx.currentTime + stopTime);
  } else {
    osc.stop();
  }
}

/* Echo layer */

const echoMap = [];
let echoAlpha = 0;
function logEcho(x,y,hue){
  echoMap.push({x,y,hue,time:millis()});
  if (echoMap.length > 800) echoMap.shift();
  echoAlpha = min(1, echoAlpha + 0.05);
}
function drawEchoLayer(){
  if (echoAlpha <= 0 || echoMap.length === 0) return;
  push();
  blendMode(ADD);
  noStroke();
  for (const e of echoMap) {
    const age = (millis() - e.time)/20000;
    const a = constrain(echoAlpha * (1 - age*0.25), 0, 0.5);
    fill(hsla(e.hue, 80, 30, a));
    circle(e.x, e.y, 22);
  }
  pop();
}

/* Setup / draw */

let cnv;
function setup() {
  cnv = createCanvas(windowWidth, windowHeight);
  frameRate(60);
  blendMode(ADD);
  background(10,11,16);

  cnv.elt.style.touchAction = 'none';
  cnv.elt.addEventListener('pointerdown', onPointerDown, {passive:false});
  cnv.elt.addEventListener('pointermove', onPointerMove, {passive:false});
  cnv.elt.addEventListener('pointerup', onPointerUp, {passive:false});
  cnv.elt.addEventListener('pointercancel', onPointerUp, {passive:false});

  cnv.elt.setAttribute('tabindex','0');
  cnv.elt.addEventListener('mousedown', () => cnv.elt.focus());
  cnv.elt.addEventListener('touchstart', () => cnv.elt.focus());
  setTimeout(() => cnv.elt.focus(), 0);

  cnv.elt.addEventListener('focus', () => {
    const hint = document.getElementById('hint');
    if (hint) hint.style.opacity = '0';
  });

  if (hasSound) {
    mic = new p5.AudioIn();
    mic.start();
  }

  unlockAudioOnce();
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
}

function updateEntities(list){
  for (const e of list) e.update();
  return list.filter(e => !e.done);
}

function drawInstrumentOverlay(){
  push();
  blendMode(BLEND);
  textAlign(CENTER, BOTTOM);
  textSize(14);
  fill(230, 220);
  const cfg = getInstrumentConfig();
  const info = `Instrument: ${cfg.label}   ·   type piano / drum / flute / guitar / chimes   ·   Spacebar saves a snapshot`;
  text(info, width * 0.5, height - 16);

  if (instrumentNotice && millis() - instrumentNoticeTime < 1800) {
    const t = (millis() - instrumentNoticeTime) / 1800;
    const a = (1 - t) * 220;
    textSize(18);
    fill(255, 255, 255, a);
    text(instrumentNotice, width * 0.5, height * 0.18);
  }
  pop();
}

function updateInferredMood(){
  const now = millis();
  const windowMs = 8000;
  recentKeyTimes = recentKeyTimes.filter(t => now - t <= windowMs);

  const windowSec = windowMs / 1000;
  const speedNow = recentKeyTimes.length / windowSec;

  if (recentKeyTimes.length === 0 && (clickCount + dragSpawnCount) === 0) {
    selectedMood = "unlabeled";
    return;
  }

  if (speedNow < 0.5) {
    selectedMood = "tired";
  } else if (speedNow < 1.2) {
    selectedMood = "calm";
  } else if (speedNow < 2.5) {
    selectedMood = "hopeful";
  } else if (speedNow < 4.0) {
    selectedMood = "anxious";
  } else {
    selectedMood = "excited";
  }
}

function draw(){
  const cfgBg = getInstrumentConfig();
  const bgAlpha = cfgBg.bgFadeAlpha ?? 32;

  // soft fade
  push();
  blendMode(BLEND);
  noStroke();
  fill(10,11,16,bgAlpha);
  rect(0,0,width,height);
  pop();

  // mic
  if (mic) {
    micLevel = mic.getLevel();
    micLevelSmooth = lerp(micLevelSmooth, micLevel, 0.05);
  }

  if (sessionActive) {
    updateInferredMood();
  }

  if (sessionActive && sessionDurationMs > 0 &&
      millis() - sessionStartTime >= sessionDurationMs) {
    endSession();
  }

  activityLevel *= 0.97;
  drawPulse(activityLevel, micLevelSmooth);

  drawEchoLayer();

  polys  = updateEntities(polys);
  links  = updateEntities(links);
  sparks = updateEntities(sparks);
  labels = updateEntities(labels);

  if (!sessionActive && !sessionEnded) {
    drawSessionIntro();
  } else if (sessionEnded && sessionSummary) {
    drawSessionSummary();
  }

  // instrument hint shown only once a session has been chosen / finished
  if (sessionActive || sessionEnded) {
    drawInstrumentOverlay();
  }
}

/* Session helpers */

function clearVisuals(){
  polys = [];
  sparks = [];
  links  = [];
  labels = [];
  echoMap.length = 0;
  echoAlpha = 0;
  activityLevel = 0;
}

function resetStats(){
  keyCounts = {};
  totalKeys = clickCount = dragSpawnCount = 0;
  firstKeyTime = lastKeyTime = null;
  lastKeyPos = null;
  recentKeyTimes = [];
}

function startSession(durationSec){
  sessionDurationMs = durationSec * 1000;
  sessionStartTime  = millis();
  sessionActive = true;
  sessionEnded  = false;
  sessionSummary = null;

  selectedMood = "unlabeled";
  resetStats();
  clearVisuals();
}

function endSession(){
  sessionActive = false;
  sessionEnded  = true;

  const durationSec = sessionDurationMs / 1000;
  const keyEntries = Object.entries(keyCounts).sort((a,b) => b[1] - a[1]);
  const topLetters = keyEntries.slice(0, 5);

  let avgSpeed = 0;
  if (firstKeyTime && lastKeyTime && lastKeyTime > firstKeyTime) {
    const spanSec = (lastKeyTime - firstKeyTime) / 1000;
    if (spanSec > 0) avgSpeed = totalKeys / spanSec;
  }

  const baseSummary = {
    durationSec,
    totalKeys,
    clickCount,
    dragSpawnCount,
    topLetters,
    avgSpeed
  };

  const mood = selectedMood || "unlabeled";
  const instrument = currentInstrument;
  const reflection = buildMoodReflection(mood, instrument, baseSummary);

  sessionSummary = {
    ...baseSummary,
    mood,
    instrument,
    reflection
  };

  console.log("Session summary:", sessionSummary);
}

function resetSessionToSelect(){
  sessionActive = false;
  sessionEnded  = false;
  sessionDurationMs = 0;
  sessionSummary = null;
  selectedMood = "unlabeled";
  clearVisuals();
  resetStats();
}

/* Overlays */

function drawSessionIntro(){
  push();
  blendMode(BLEND);

  const padX = width * 0.08;
  const padY = height * 0.12;
  const boxW = width  - padX*2;

  fill(220);
  textAlign(LEFT, TOP);
  textSize(22);
  text("Touch, Light, Echo", padX + 20, padY + 18);

  textSize(16);
  const lines = [
    "Step 1 · Session length:",
    "  Press 1 → 30 seconds",
    "  Press 2 → 1 minute",
    "  Press 3 → 2 minutes",
    "  Press 4 → 5 minutes",
    "",
    "Step 2 · Play:",
    "• Type letters/numbers to place notes & draw the score",
    "• Click / drag to paint with neon trails",
    "• The center pulse listens to your room through the mic",
    "",
    "Instruments & saving controls appear once a session starts.",
    "Your mood is inferred automatically from how fast you play.",
    "",
    "After time runs out, you'll see a composition analysis.",
    "Press R on the summary screen for a new session,",
    "or press Space to save this score as an image."
  ];

  let y = padY + 54;
  for (const line of lines){
    text(line, padX + 20, y, boxW - 40, height);
    y += 20;
  }

  pop();
}

function drawSessionSummary(){
  const s = sessionSummary;
  if (!s) return;

  push();
  blendMode(BLEND);
  const padX = width * 0.08;
  const padY = height * 0.12;

  fill(230);
  textAlign(LEFT, TOP);
  textSize(22);
  text("Composition analysis", padX + 20, padY + 18);

  textSize(16);
  let y = padY + 52;

  const moodLabel = s.mood && s.mood !== "unlabeled"
    ? capitalize(s.mood)
    : "Not clearly inferred yet";
  const instrLabel = (INSTRUMENTS[s.instrument]?.label) || "Unknown";

  text(`Inferred mood: ${moodLabel}`, padX + 20, y); y += 20;
  text(`Instrument: ${instrLabel}`, padX + 20, y); y += 24;

  if (s.reflection) {
    text("Listening back:", padX + 20, y); y += 20;
    text(s.reflection, padX + 36, y, width - padX*2 - 56, height);
    y += 60;
  }

  const durStr = nf(s.durationSec, 0, 1);
  text(`Length: ${durStr} seconds`, padX + 20, y); y += 20;
  text(`Keys pressed: ${s.totalKeys}`, padX + 20, y); y += 20;
  text(`Mouse taps: ${s.clickCount}`, padX + 20, y); y += 20;
  text(`Drag spawns: ${s.dragSpawnCount}`, padX + 20, y); y += 20;

  const speedStr = s.avgSpeed ? nf(s.avgSpeed, 0, 2) : "0.00";
  text(`Average tempo: ${speedStr} keys/sec`, padX + 20, y); y += 26;

  text("Most-used letters:", padX + 20, y); y += 20;
  if (s.topLetters.length === 0){
    text("  (none)", padX + 36, y); y += 20;
  } else {
    for (const [ch, count] of s.topLetters){
      text(`  ${ch.toUpperCase()} : ${count}`, padX + 36, y);
      y += 20;
    }
  }

  y += 30;
  text("Press R to start a new session · Press Space to save this score.", padX + 20, y);
  pop();
}

/* Pointer handlers */

const activePointers = new Map();
const TRAIL_MIN_DIST = 20;
const TRAIL_MIN_DT   = 28;

function canvasXY(e){
  const px = e.offsetX * (width / e.target.clientWidth);
  const py = e.offsetY * (height / e.target.clientHeight);
  return {x: px, y: py};
}

function onPointerDown(e){
  ensureAudio();
  const {x, y} = canvasXY(e);

  if (!sessionActive) {
    if (!sessionEnded) {
      handleSessionTap(x, y);
    }
    return;
  }

  e.preventDefault();
  e.target.setPointerCapture?.(e.pointerId);

  const now = performance.now();
  activePointers.set(e.pointerId, {x, y, lastX:x, lastY:y, lastTime:now});

  const hueBase = map(y, height, 0, 200, 330);
  const hue = applyMoodHue(hueBase);

  spawnAt(x, y, hue);
  spawnSparks(x, y, hue, 1.0);

  activityLevel = min(1, activityLevel + 0.2);
  clickCount++;

  const f = map(y, height, 0, 180, 880, true);
  playPluck(f, 0.7);
}

function onPointerMove(e){
  if (!sessionActive || !activePointers.has(e.pointerId)) return;
  e.preventDefault();

  const p = activePointers.get(e.pointerId);
  const {x, y} = canvasXY(e);
  const now = performance.now();

  const dx = x - p.lastX;
  const dy = y - p.lastY;
  const dist = Math.hypot(dx, dy);
  const dt = now - p.lastTime;

  if (dist >= TRAIL_MIN_DIST || dt >= TRAIL_MIN_DT){
    const hueBase = map(y, height, 0, 200, 330);
    const hue = applyMoodHue(hueBase);

    spawnAt(x, y, hue);
    spawnSparks(x, y, hue, 0.7);

    activityLevel = min(1, activityLevel + 0.05);
    dragSpawnCount++;

    p.lastX = x; p.lastY = y; p.lastTime = now;
  }

  p.x = x; p.y = y;
}

function onPointerUp(e){
  e.preventDefault();
  activePointers.delete(e.pointerId);
}

/* Keyboard support */

function saveCurrentScore(){
  const cfg = getInstrumentConfig();
  const name = `touch_light_echo_${cfg.id}_${Date.now()}`;
  saveCanvas(name, 'png');
}

function keyPressed(){
  // instrument typing buffer (only letters)
  handleInstrumentTyping(key);

  // spacebar: save snapshot 
  if (keyCode === 32) {
    saveCurrentScore();
    return false;
  }

  if (!sessionActive && !sessionEnded) {
    handleSessionSelection(key);
    return false;
  }

  if (!sessionActive && sessionEnded) {
    if (key === 'r' || key === 'R') resetSessionToSelect();
    return false;
  }

  if (sessionActive) {
    handleKey(key);
  }
  return false;
}

function handleSessionSelection(k){
  const durations = { '1':30, '2':60, '3':120, '4':300 };
  const chosen = durations[k];
  if (chosen) startSession(chosen);
}

function handleSessionTap(x, y){
  if (sessionActive || sessionEnded) return;
  const band = height / 4;
  if (y < band) {
    startSession(30);
  } else if (y < 2 * band) {
    startSession(60);
  } else if (y < 3 * band) {
    startSession(120);
  } else {
    startSession(300);
  }
}

function handleKey(k){
  ensureAudio();
  if (!/^[a-z0-9]$/i.test(k)) return;

  const center = keyToPos(k);
  if (!center) return;

  let x = center.x + random(-width * 0.03,  width * 0.03);
  let y = center.y + random(-height * 0.05, height * 0.05);
  x = constrain(x, width * 0.08, width * 0.92);
  y = constrain(y, height * 0.18, height * 0.82);

  const hueBase = map(y, height, 0, 200, 330);
  const hue = applyMoodHue(hueBase);

  const ch = k.toLowerCase();
  keyCounts[ch] = (keyCounts[ch] || 0) + 1;
  totalKeys++;

  const now = millis();
  if (firstKeyTime === null) firstKeyTime = now;
  lastKeyTime = now;
  recentKeyTimes.push(now);

  if (lastKeyPos){
    const dx = x - lastKeyPos.x;
    const dy = y - lastKeyPos.y;
    links.push(new KeyLink(lastKeyPos.x, lastKeyPos.y, x, y, (lastKeyPos.hue + hue)/2));
  }
  lastKeyPos = {x,y,hue};

  spawnAt(x, y, hue);
  spawnSparks(x, y, hue, 1.0);
  spawnLabel(x, y, hue, k);

  activityLevel = min(1, activityLevel + 0.2);

  const f = map(y, height, 0, 180, 880, true);
  playPluck(f, 0.7);
}

/* Visuals */

function spawnAt(x,y,hue){
  const cfg = getInstrumentConfig();
  const sidesOptions = cfg.polySides || [3,4,5,6,7,8];
  const sides = random(sidesOptions);
  const growMul = cfg.polyGrowMul || 1.0;

  const baseGrow  = random(4, 7) * growMul;
  const baseLife  = random(1.0, 1.6);
  const baseSize  = random(40, 75);
  const baseThick = random(10, 18);

  logEcho(x,y,hue);

  // alternate filled / outline / filled
  const fills = [true, false, true];

  polys.push(new ExpandingPoly({
    x,y,sides,hue,
    size:baseSize,
    grow:baseGrow,
    thick:baseThick,
    life:baseLife,
    alpha:0.85,
    blur:26,
    filled:fills[0]
  }));
  polys.push(new ExpandingPoly({
    x,y,sides,hue,
    size:baseSize*0.6,
    grow:baseGrow*1.2,
    thick:baseThick*0.8,
    life:baseLife*0.9,
    alpha:0.75,
    blur:22,
    spin:random(-0.03,0.03),
    filled:fills[1]
  }));
  polys.push(new ExpandingPoly({
    x,y,sides,hue,
    size:baseSize*1.2,
    grow:baseGrow*0.9,
    thick:baseThick*0.6,
    life:baseLife*1.2,
    alpha:0.5,
    blur:34,
    filled:fills[2]
  }));
  polys.push(new Crosshair(x,y,hue));
}

function spawnSparks(x,y,hue,scale){
  const cfg = getInstrumentConfig();
  const count = floor(random(7, 14) * scale);
  const plusBias = cfg.sparkShapeBias ?? 0.5;

  for (let i=0;i<count;i++){
    const ang = random(TWO_PI);
    const speed = random(0.4, 1.7) * scale;
    const shape = random() < plusBias ? "plus" : "dot";
    sparks.push(new Spark({
      x, y,
      vx: cos(ang) * speed,
      vy: sin(ang) * speed,
      r:  random(3, 7) * scale,
      life: random(0.6, 1.4),
      hue: (hue + random(-20,20)) % 360,
      shape
    }));
  }
}

function getCurrentWordPool(){
  const pool = MOOD_WORDS[selectedMood];
  return pool && pool.length ? pool : WORDS;
}

function spawnLabel(x,y,hue, keyChar){
  const pool = getCurrentWordPool();
  const txt = random() < 0.3 ? random(pool) : keyChar.toUpperCase();
  labels.push(new Label({
    x: x + random(-15, 15),
    y: y + random(-10, 10),
    text: txt,
    hue
  }));
}

/* Classes */

class ExpandingPoly{
  constructor(o){
    this.x=o.x; this.y=o.y;
    this.sides=max(3, floor(o.sides||6));
    this.hue=o.hue||260;
    this.size=o.size||50;
    this.grow=o.grow||5;
    this.thick=o.thick||12;
    this.life=o.life||1.2;
    this.age=0;
    this.alpha=(o.alpha??0.85);
    this.blur=(o.blur??28);
    this.rot=0;
    this.spin=o.spin||random(-0.01,0.01);
    this.filled = !!o.filled;  // track filled vs outline
    this.done=false;
  }
  update(){
    this.age+=deltaTime/1000;
    if (this.age>=this.life){ this.done=true; return; }
    this.size+=this.grow;
    this.thick*=0.985;
    this.alpha*=0.96;
    this.rot+=this.spin;

    const strokeCol = hsla(this.hue,100,80,this.alpha);
    const fillCol   = hsla(this.hue,80,30,this.alpha * 1); // subtle neon fill

    push();
    translate(this.x,this.y);
    rotate(this.rot);
    drawingContext.shadowColor = hsla(this.hue,100,60,this.alpha);
    drawingContext.shadowBlur  = this.blur;
    if (this.filled){
      fill(fillCol);
      stroke(strokeCol);
    } else {
      noFill();
      stroke(strokeCol);
    }
    strokeWeight(this.thick);
    polygon(0,0,this.size*0.5,this.sides);
    pop();
  }
}

class Crosshair{
  constructor(x,y,h){
    this.x=x; this.y=y; this.h=h;
    this.life=0.8;
    this.age=0;
    this.done=false;
  }
  update(){
    this.age+=deltaTime/1000;
    if (this.age>=this.life){ this.done=true; return; }
    const a = pow(1 - this.age/this.life, 1.5) * 0.9;

    push();
    translate(this.x,this.y);
    stroke(hsla(this.h,90,85,a));
    strokeWeight(2);
    line(-14, 0, 14, 0);
    line(0, -14, 0, 14);
    pop();
  }
}

class Spark{
  constructor(o){
    Object.assign(this, o);
    this.life = this.life || 1.0;
    this.age = 0;
    this.done = false;
  }
  update(){
    const dt = deltaTime/1000;
    this.age += dt;
    if (this.age >= this.life){ this.done = true; return; }
    const t = this.age / this.life;
    const alpha = pow(1 - t, 1.5);

    this.x += this.vx * (deltaTime/16.6);
    this.y += this.vy * (deltaTime/16.6);
    this.vx *= 0.99;
    this.vy *= 0.99;

    push();
    translate(this.x, this.y);
    stroke(hsla(this.hue, 90, 85, alpha));
    if (this.shape === "plus"){
      strokeWeight(1.8);
      line(-this.r, 0, this.r, 0);
      line(0, -this.r, 0, this.r);
    } else {
      noFill();
      strokeWeight(1.5);
      circle(0,0,this.r*2);
    }
    pop();
  }
}

class Label{
  constructor(o){
    this.x = o.x;
    this.y = o.y;
    this.text = o.text || "";
    this.hue = o.hue || 260;
    this.life = 1.4;
    this.age = 0;
    this.size = random(18, 28);
    this.vx = random(-0.15, 0.15);
    this.vy = random(-0.6, -1.0);
    this.done = false;
  }
  update(){
    const dt = deltaTime/1000;
    this.age += dt;
    if (this.age >= this.life){ this.done = true; return; }
    const t = this.age / this.life;
    const alpha = pow(1 - t, 1.4);

    this.x += this.vx * (deltaTime/16.6) + sin(this.age*4.0) * 0.4;
    this.y += this.vy * (deltaTime/16.6);

    const sz = this.size * (1 + t*0.25);

    push();
    translate(this.x, this.y);
    blendMode(ADD);
    textAlign(CENTER, CENTER);
    textSize(sz);
    fill(hsla(this.hue, 80, 25, alpha * 0.7));
    text(this.text, 1.5, 1.5);
    fill(hsla(this.hue, 90, 90, alpha));
    text(this.text, 0, 0);
    pop();
  }
}

class KeyLink{
  constructor(x1,y1,x2,y2,hue){
    this.x1=x1; this.y1=y1;
    this.x2=x2; this.y2=y2;
    this.hue=hue||260;
    this.life=0.9;
    this.age=0;
    this.done=false;
    this.steps = max(6, floor(dist(x1,y1,x2,y2)/40));
  }
  update(){
    const dt = deltaTime/1000;
    this.age += dt;
    if (this.age >= this.life){ this.done = true; return; }

    const t = this.age / this.life;
    const alpha = pow(1 - t, 1.6);
    const shown = floor(this.steps * min(1, t*1.4));

    push();
    blendMode(ADD);
    noStroke();
    for (let i=0;i<shown;i++){
      const f = this.steps === 1 ? 0.5 : i/(this.steps-1);
      const px = lerp(this.x1, this.x2, f);
      const py = lerp(this.y1, this.y2, f);
      const r  = 5 + 2*sin((t + f)*PI);
      const a = alpha * (0.9 + 0.5*f);
      fill(hsla(this.hue + f*20, 90, 90, a));
      circle(px, py, r*2);
    }
    pop();
  }
}

/* Pulse */

function getPulseSettings(){
  const m = selectedMood;
  let base = {amp:1.0, jitter:0.2, speed:1.0};
  if (m === 'calm')    base = {amp:1.0, jitter:0.1, speed:0.7};
  else if (m === 'anxious') base = {amp:1.2, jitter:0.4, speed:1.3};
  else if (m === 'tired')   base = {amp:0.8, jitter:0.05, speed:0.5};
  else if (m === 'hopeful') base = {amp:1.1, jitter:0.2, speed:1.0};
  else if (m === 'excited') base = {amp:1.3, jitter:0.35, speed:1.5};
  else if (m === 'heavy')   base = {amp:0.9, jitter:0.15, speed:0.6};

  const cfg = getInstrumentConfig();
  const ampMul = cfg.pulseAmpMul || 1.0;
  return {
    amp: base.amp * ampMul,
    jitter: base.jitter,
    speed: base.speed
  };
}

function drawPulse(level, micLevelSmooth){
  if (level < 0.02 && micLevelSmooth < 0.01) return;

  const settings = getPulseSettings();

  const micBoost = constrain(map(micLevelSmooth, 0, 0.2, 0, 1, true), 0, 1);
  const combinedBase = constrain(level + micBoost * 0.8, 0, 1);
  const combined = constrain(combinedBase * settings.amp, 0, 1);

  const baseR = min(width, height) * 0.15;
  const rBase = map(combined, 0, 1, baseR, baseR * 2.6);
  const jitterFactor = (noise(frameCount * 0.05) - 0.5) * 2;
  const r = rBase * (1 + settings.jitter * jitterFactor);

  // neon pink-ish hue
  const huePink = 320; // you can tweak this (300–340 range) if you want

  const alphaOuter = 0.25 * combined;
  const alphaInner = 0.18 * combined;

  push();
  translate(width / 2, height / 2);
  blendMode(ADD);

  // Outer amoeba ring
  noFill();
  stroke(hsla(huePink, 100, 70, alphaOuter));
  strokeWeight(8);
  beginShape();
  for (let i = 0; i < TWO_PI; i += TWO_PI / 120) {
    const n = noise(
      cos(i) * 0.8 + frameCount * 0.01,
      sin(i) * 0.8 + frameCount * 0.01
    );
    const rr = r * (0.85 + n * 0.4);
    const x = cos(i) * rr;
    const y = sin(i) * rr;
    vertex(x, y);
  }
  endShape(CLOSE);

  // Inner amoeba ring
  stroke(hsla(huePink + 15, 100, 80, alphaInner)); // slightly lighter pink
  strokeWeight(3);
  beginShape();
  for (let i = 0; i < TWO_PI; i += TWO_PI / 120) {
    const n = noise(
      cos(i) * 0.8 + 100 + frameCount * 0.012,
      sin(i) * 0.8 + 50  + frameCount * 0.012
    );
    const rr = r * 0.6 * (0.9 + n * 0.3);
    const x = cos(i) * rr;
    const y = sin(i) * rr;
    vertex(x, y);
  }
  endShape(CLOSE);

  pop();
}

/* Helpers */

function polygon(x,y,r,n){
  beginShape();
  for (let i=0;i<n;i++){
    const a = i/n * TWO_PI;
    vertex(x + cos(a)*r, y + sin(a)*r);
  }
  endShape(CLOSE);
}

function hsla(h,s,l,a){
  colorMode(HSB,360,100,100,1);
  const c=color(h,s,l,a);
  colorMode(RGB,255,255,255,1);
  return c;
}

function applyMoodHue(baseHue){
  const shiftMood = getMoodHueShift();
  const shiftInst = getInstrumentHueShift();
  let h = (baseHue + shiftMood + shiftInst) % 360;
  if (h < 0) h += 360;
  return h;
}

function getMoodHueShift(){
  if (!selectedMood) return 0;
  return MOOD_HUE_SHIFT[selectedMood] || 0;
}

function getInstrumentHueShift(){
  const cfg = getInstrumentConfig();
  return cfg.hueShift || 0;
}

function capitalize(s){
  if (!s || typeof s !== "string") return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* Reflection */

function buildMoodReflection(mood, instrument, stats){
  const name = (mood && mood !== 'unlabeled') ? mood : null;
  const speed = stats.avgSpeed || 0;
  const keys = stats.totalKeys || 0;
  const drags = stats.dragSpawnCount || 0;
  const clicks = stats.clickCount || 0;
  const totalPointer = drags + clicks;
  const instrCfg = INSTRUMENTS[instrument] || INSTRUMENTS.piano;
  const instrName = instrCfg.label;

  let movementDescriptor;
  if (keys === 0 && totalPointer === 0) {
    movementDescriptor = "almost completely still, like a held rest.";
  } else if (speed < 1.2 && totalPointer < 20) {
    movementDescriptor = "slow and minimal, like a sparse melody.";
  } else if (speed < 3) {
    movementDescriptor = "measured and steady, as if keeping a gentle tempo.";
  } else {
    movementDescriptor = "quick and restless, full of jumps and syncopation.";
  }

  let moodPhrase;
  switch(name){
    case 'calm':
      if (speed > 3) {
        moodPhrase = "Your gestures started calm but became quick and wide. Maybe more was buzzing underneath than it first felt.";
      } else {
        moodPhrase = "Your piece stayed gentle and spacious, with plenty of room between notes.";
      }
      break;
    case 'anxious':
      if (speed < 1.5) {
        moodPhrase = "You carried some tension in, but your score moved slowly and softly. This space may have given your nerves room to breathe.";
      } else {
        moodPhrase = "Your patterns darted around the staff, mirroring a restless, anxious energy.";
      }
      break;
    case 'tired':
      if (speed > 2.5) {
        moodPhrase = "Even if you felt a bit drained, your gestures still sparked bursts of activity. There's more energy in you than you think.";
      } else {
        moodPhrase = "Your composition stayed small and soft, like a low, steady pulse.";
      }
      break;
    case 'hopeful':
      moodPhrase = "Your notes kept reaching outward. Small phrases of light stepping across the space.";
      break;
    case 'excited':
      if (speed > 2) {
        moodPhrase = "Your score stayed bright, busy, and alive with motion.";
      } else {
        moodPhrase = "The excitement came through in short bursts, then settled into something more focused.";
      }
      break;
    default:
      if (keys === 0 && totalPointer === 0) {
        moodPhrase = "The score stayed almost empty reflecting a quiet pause.";
      } else {
        moodPhrase = "You didn't label a mood, but the way you moved has its own rhythm.";
      }
  }

  return `${moodPhrase} In this session your ${instrName.toLowerCase()} phrases felt ${movementDescriptor}`;
}
