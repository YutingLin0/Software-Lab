/* Neon Expanding Polygons + Trails & Sparks + Pulse + Mic + Text labels + Sessions */

let polys = [];
let sparks = [];   // small moving particles (+ and dots)
let links  = [];   // trails between consecutive key presses
let labels = [];   // floating text labels
let lastKeyPos = null;
let activityLevel = 0; // global "energy" of the system

// microphone input (real-world connection)
let mic = null;
let micLevel = 0;
let micLevelSmooth = 0;

// small vocabulary of mood words for labels
const WORDS = ["echo", "spark", "drift", "pulse", "glow", "loop", "trail", "bloom"];

/* Session state & statistics */

let sessionActive = false;
let sessionEnded  = false;
let sessionDurationMs = 0;
let sessionStartTime  = 0;
let sessionSummary = null;

// stats
let keyCounts = {};     // char -> count
let totalKeys = 0;
let clickCount = 0;
let dragSpawnCount = 0;
let trajectoryLength = 0; // total distance between consecutive key points
let keyPositions = [];  // {x,y}
let firstKeyTime = null;
let lastKeyTime  = null;

/* Fixed key layout → position mapping */

// approximate QWERTY rows flattened
const KEY_LAYOUT = "1234567890qwertyuiopasdfghjklzxcvbnm";

function keyToPos(k){
  const idx = KEY_LAYOUT.indexOf(k.toLowerCase());
  if (idx === -1) return null;

  const cols = 10; // arrange keys into 10 columns
  const col = idx % cols;
  const row = Math.floor(idx / cols);

  const x = map(col, 0, cols - 1, width * 0.1, width * 0.9);
  const y = map(row, 0, Math.ceil(KEY_LAYOUT.length / cols) - 1, height * 0.2, height * 0.8);
  return { x, y };
}

/* p5.sound detection & audio unlock */

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

// global listeners only used to unlock audio
['pointerdown','touchstart','mousedown','keydown','visibilitychange'].forEach(t=>{
  window.addEventListener(t, unlockAudioOnce, {capture:true, passive:false});
  document.addEventListener(t, unlockAudioOnce, {capture:true, passive:false});
});
const ensureAudio = () => unlockAudioOnce();

function playPluck(freq, amp=0.7) {
  if (!hasSound || !audioUnlocked) return;
  const osc = new p5.Oscillator('triangle');
  const env = new p5.Envelope(0.005, 1.0, 0.12, 0.0);
  osc.start();
  osc.freq(freq, 0);
  osc.amp(env);
  env.mult(amp);
  env.play(osc);
  osc.stop(getAudioContext().currentTime + 0.2);
}

/* Echo Map (soft memory dots) */

const echoMap = []; // {x,y,hue,time}
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
    const age = (millis() - e.time)/20000; // 20s horizon
    const a = constrain(echoAlpha * (1 - age*0.25), 0, 0.5);
    fill(hsla(e.hue, 80, 30, a));
    circle(e.x, e.y, 22);
  }
  pop();
}

/* Setup / Draw */

let cnv;
function setup() {
  cnv = createCanvas(windowWidth, windowHeight);
  frameRate(60);
  blendMode(ADD);
  background(10,11,16);

  // pointer events + no scroll
  cnv.elt.style.touchAction = 'none';
  cnv.elt.addEventListener('pointerdown', onPointerDown, {passive:false});
  cnv.elt.addEventListener('pointermove', onPointerMove, {passive:false});
  cnv.elt.addEventListener('pointerup', onPointerUp, {passive:false});
  cnv.elt.addEventListener('pointercancel', onPointerUp, {passive:false});

  // make canvas focusable for keyboard
  cnv.elt.setAttribute('tabindex','0');
  cnv.elt.addEventListener('mousedown', () => cnv.elt.focus());
  cnv.elt.addEventListener('touchstart', () => cnv.elt.focus());
  setTimeout(() => cnv.elt.focus(), 0);

  cnv.elt.addEventListener('focus', () => {
    const hint = document.getElementById('hint');
    if (hint) hint.style.opacity = '0';
  });

  // microphone
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

function draw(){
  // soft fade
  push();
  blendMode(BLEND);
  noStroke();
  fill(10,11,16,32);
  rect(0,0,width,height);
  pop();

  // mic
  if (mic) {
    micLevel = mic.getLevel();
    micLevelSmooth = lerp(micLevelSmooth, micLevel, 0.05);
  }

  // sessions
  if (sessionActive && sessionDurationMs > 0 &&
      millis() - sessionStartTime >= sessionDurationMs) {
    endSession();
  }

  // global energy
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
  trajectoryLength = 0;
  keyPositions = [];
  firstKeyTime = lastKeyTime = null;
  lastKeyPos = null;
}

function startSession(durationSec){
  sessionDurationMs = durationSec * 1000;
  sessionStartTime  = millis();
  sessionActive = true;
  sessionEnded  = false;
  sessionSummary = null;

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

  const imageDesc = analyzeImageShape();

  sessionSummary = {
    durationSec,
    totalKeys,
    clickCount,
    dragSpawnCount,
    topLetters,
    avgSpeed,
    trajectoryLength,
    imageDesc
  };

  console.log("Session summary:", sessionSummary);
}

function resetSessionToSelect(){
  sessionActive = false;
  sessionEnded  = false;
  sessionDurationMs = 0;
  sessionSummary = null;
  clearVisuals();
  resetStats();
}

function analyzeImageShape(){
  if (keyPositions.length === 0) {
    return "a quiet field with almost no key strokes.";
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let sumX = 0, sumY = 0;

  for (const p of keyPositions){
    minX = min(minX, p.x);
    maxX = max(maxX, p.x);
    minY = min(minY, p.y);
    maxY = max(maxY, p.y);
    sumX += p.x;
    sumY += p.y;
  }

  const n = keyPositions.length;
  const cx = sumX / n;
  const cy = sumY / n;
  const spanX = (maxX - minX) / width;
  const spanY = (maxY - minY) / height;

  let spread;
  const areaNorm = spanX * spanY;
  if (areaNorm > 0.5) spread = "filled most of the space";
  else if (areaNorm > 0.2) spread = "spread across a medium patch";
  else spread = "clustered into a small constellation";

  let horiz;
  if (cx < width * 0.35) horiz = "leaning to the left";
  else if (cx > width * 0.65) horiz = "leaning to the right";
  else horiz = "balanced near the center";

  let vert;
  if (cy < height * 0.35) vert = "floating in the upper sky";
  else if (cy > height * 0.65) vert = "anchored near the bottom";
  else vert = "hovering around the middle";

  return `a ${spread}, ${horiz}, ${vert}.`;
}

/* Overlays: intro & summary */

function drawSessionIntro(){
  push();
  blendMode(BLEND);

  const padX = width * 0.08;
  const padY = height * 0.12;
  const boxW = width  - padX*2;

  fill(220);
  textAlign(LEFT, TOP);
  textSize(22);
  text("Choose a session to record your sound drawing:", padX + 20, padY + 18);

  textSize(16);
  const lines = [
    "Press 1 → 30 seconds",
    "Press 2 → 1 minute",
    "Press 3 → 2 minutes",
    "Press 4 → 5 minutes",
    "",
    "During the session:",
    "• Type letters/numbers to play notes & draw shapes",
    "• Click / drag to paint with neon trails",
    "• The center pulse listens to your room through the mic",
    "",
    "After time runs out, you'll see a summary of your session.",
    "Press R at any time on the summary screen to start a new session."
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
  text("Session summary", padX + 20, padY + 18);

  textSize(16);
  let y = padY + 52;

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
  text("Press R to start a new session.", padX + 20, y);
  pop();
}

/* Pointer (click/touch/drag)  */

const activePointers = new Map(); // id -> {x,y,lastX,lastY,lastTime}
const TRAIL_MIN_DIST = 20; 
const TRAIL_MIN_DT   = 28; 

function canvasXY(e){
  const px = e.offsetX * (width / e.target.clientWidth);
  const py = e.offsetY * (height / e.target.clientHeight);
  return {x: px, y: py};
}

function onPointerDown(e){
  if (!sessionActive) {
    ensureAudio();
    return;
  }
  ensureAudio();
  e.preventDefault();
  e.target.setPointerCapture?.(e.pointerId);

  const {x, y} = canvasXY(e);
  const now = performance.now();
  activePointers.set(e.pointerId, {x, y, lastX:x, lastY:y, lastTime:now});

  const hue = map(y, height, 0, 200, 330);
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
    const hue = map(y, height, 0, 200, 330);
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

function keyPressed(){
  if (!sessionActive && !sessionEnded) {
    handleSessionSelection(key);
    return false;
  }
  if (!sessionActive && sessionEnded) {
    if (key === 'r' || key === 'R') resetSessionToSelect();
    return false;
  }
  if (sessionActive) handleKey(key);
  return false;
}

function handleSessionSelection(k){
  const durations = { '1':30, '2':60, '3':120, '4':300 };
  const chosen = durations[k];
  if (chosen) startSession(chosen);
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

  const hue = map(y, height, 0, 200, 330);

  // stats
  const ch = k.toLowerCase();
  keyCounts[ch] = (keyCounts[ch] || 0) + 1;
  totalKeys++;
  keyPositions.push({x,y});

  const now = millis();
  if (firstKeyTime === null) firstKeyTime = now;
  lastKeyTime = now;
  if (lastKeyPos){
    const dx = x - lastKeyPos.x;
    const dy = y - lastKeyPos.y;
    trajectoryLength += Math.hypot(dx, dy);
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

/* Visuals: polys + sparks + key trails */

function spawnAt(x,y,hue){
  const sides = random([3,4,5,6,7,8]);
  const baseGrow  = random(4, 7);
  const baseLife  = random(1.0, 1.6);
  const baseSize  = random(40, 75);
  const baseThick = random(10, 18);

  logEcho(x,y,hue);

  polys.push(new ExpandingPoly({
    x,y,sides,hue,
    size:baseSize,
    grow:baseGrow,
    thick:baseThick,
    life:baseLife,
    alpha:0.85,
    blur:26
  }));
  polys.push(new ExpandingPoly({
    x,y,sides,hue,
    size:baseSize*0.6,
    grow:baseGrow*1.2,
    thick:baseThick*0.8,
    life:baseLife*0.9,
    alpha:0.75,
    blur:22,
    spin:random(-0.02,0.02)
  }));
  polys.push(new ExpandingPoly({
    x,y,sides,hue,
    size:baseSize*1.2,
    grow:baseGrow*0.9,
    thick:baseThick*0.6,
    life:baseLife*1.2,
    alpha:0.5,
    blur:34
  }));
  polys.push(new Crosshair(x,y,hue));
}

function spawnSparks(x,y,hue,scale){
  const count = floor(random(7, 14) * scale);
  for (let i=0;i<count;i++){
    const ang = random(TWO_PI);
    const speed = random(0.4, 1.7) * scale;
    sparks.push(new Spark({
      x, y,
      vx: cos(ang) * speed,
      vy: sin(ang) * speed,
      r:  random(3, 7) * scale,
      life: random(0.6, 1.4),
      hue: (hue + random(-20,20)) % 360,
      shape: random() < 0.4 ? "plus" : "dot"
    }));
  }
}

function spawnLabel(x,y,hue, keyChar){
  const txt = random() < 0.3 ? random(WORDS) : keyChar.toUpperCase();
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
    this.done=false;
  }
  update(){
    this.age+=deltaTime/1000;
    if (this.age>=this.life){ this.done=true; return; }
    this.size+=this.grow;
    this.thick*=0.985;
    this.alpha*=0.96;
    this.rot+=this.spin;

    push();
    translate(this.x,this.y);
    rotate(this.rot);
    drawingContext.shadowColor = hsla(this.hue,100,60,this.alpha);
    drawingContext.shadowBlur  = this.blur;
    noFill();
    stroke(hsla(this.hue,100,80,this.alpha));
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

/* Global pulse (reacts to mic + activity) */

function drawPulse(level, micLevelSmooth){
  if (level < 0.02 && micLevelSmooth < 0.01) return;

  const micBoost = constrain(map(micLevelSmooth, 0, 0.2, 0, 1, true), 0, 1);
  const combined = constrain(level + micBoost * 0.8, 0, 1);

  const baseR = min(width, height) * 0.15;
  const r = map(combined, 0, 1, baseR, baseR * 2.6);
  const hue = (260 + frameCount * 0.25 + micBoost*40) % 360;
  const alphaOuter = 0.25 * combined;
  const alphaInner = 0.18 * combined;

  push();
  translate(width/2, height/2);
  blendMode(ADD);

  noFill();
  stroke(hsla(hue, 80, 60, alphaOuter));
  strokeWeight(10);
  circle(0, 0, r*2);

  stroke(hsla(hue + 30, 90, 80, alphaInner));
  strokeWeight(3);
  circle(0, 0, r*1.4);

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
