/* Neon Expanding Polygons + Trails & Sparks
 * - Tap: expanding neon pads + pluck + sparks
 * - Drag: continuous trail of pads and sparks
 * - Keyboard: each key has its own area, with random jitter in that region
 *            and a connecting trail between successive key presses
 */

let polys = [];
let sparks = [];   // small moving particles (+ and dots)
let links  = [];   // trails between consecutive key presses
let lastKeyPos = null;

/* -------- Fixed key layout → position mapping -------- */

// approximate QWERTY rows flattened
const KEY_LAYOUT = "1234567890qwertyuiopasdfghjklzxcvbnm";

function keyToPos(k){
  const idx = KEY_LAYOUT.indexOf(k.toLowerCase());
  if (idx === -1) return null;

  const cols = 10; // arrange keys into 10 columns
  const rows = Math.ceil(KEY_LAYOUT.length / cols);

  const col = idx % cols;
  const row = Math.floor(idx / cols);

  // map column & row into canvas region
  const x = map(col, 0, cols - 1, width * 0.1, width * 0.9);
  const y = map(row, 0, rows - 1, height * 0.2, height * 0.8);

  return { x, y };
}

/* -------- p5.sound detection & audio unlock -------- */

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
function ensureAudio(){ unlockAudioOnce(); }

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

/* -------- Echo Map (soft memory dots) -------- */

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

/* -------- p5 lifecycle -------- */

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

  // auto-focus shortly after load
  setTimeout(() => cnv.elt.focus(), 0);

  // hide hint once focused
  cnv.elt.addEventListener('focus', () => {
    const hint = document.getElementById('hint');
    if (hint) hint.style.opacity = '0';
  });

  unlockAudioOnce();
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
}

function draw(){
  // soft fade for trails
  push();
  blendMode(BLEND);
  noStroke();
  fill(10,11,16,32);
  rect(0,0,width,height);
  pop();

  drawEchoLayer();

  // main neon polys
  for (const p of polys) p.update();
  polys = polys.filter(p => !p.done);

  // connecting key trails
  for (const l of links) l.update();
  links = links.filter(l => !l.done);

  // small sparks
  for (const s of sparks) s.update();
  sparks = sparks.filter(s => !s.done);
}

/* -------- Pointer (click/touch/drag) -------- */

const activePointers = new Map(); // id -> {x,y,lastX,lastY,lastTime}

const TRAIL_MIN_DIST = 20; 
const TRAIL_MIN_DT   = 28; 

function canvasXY(e){
  const px = e.offsetX * (width / e.target.clientWidth);
  const py = e.offsetY * (height / e.target.clientHeight);
  return {x: px, y: py};
}

function onPointerDown(e){
  ensureAudio();
  e.preventDefault();
  e.target.setPointerCapture?.(e.pointerId);

  const {x, y} = canvasXY(e);
  const now = performance.now();
  activePointers.set(e.pointerId, {x, y, lastX:x, lastY:y, lastTime:now});

  const hue = map(y, height, 0, 200, 330);
  spawnAt(x, y, hue);
  spawnSparks(x, y, hue, 1.0);

  const f = map(y, height, 0, 180, 880, true);
  playPluck(f, 0.7);
}

function onPointerMove(e){
  if (!activePointers.has(e.pointerId)) return;
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
    p.lastX = x; p.lastY = y; p.lastTime = now;
  }

  p.x = x; p.y = y;
}

function onPointerUp(e){
  e.preventDefault();
  activePointers.delete(e.pointerId);
}

/* -------- Keyboard support (region + jitter + linking trail) -------- */

function keyPressed(){
  handleKey(key);
  return false; // prevent default browser behavior on some keys
}

function handleKey(k){
  ensureAudio();

  // letters/numbers only
  if (!/^[a-z0-9]$/i.test(k)) return;

  const center = keyToPos(k);
  if (!center) return;

  const jitterX = random(-width * 0.03, width * 0.03);   // ±3% of canvas width
  const jitterY = random(-height * 0.05, height * 0.05); // ±5% of canvas height

  let x = center.x + jitterX;
  let y = center.y + jitterY;

  x = constrain(x, width * 0.08, width * 0.92);
  y = constrain(y, height * 0.18, height * 0.82);

  const hue = map(y, height, 0, 200, 330);

  // link to previous key press
  if (lastKeyPos){
    links.push(new KeyLink(lastKeyPos.x, lastKeyPos.y, x, y, (lastKeyPos.hue + hue)/2));
  }
  lastKeyPos = {x,y,hue};

  spawnAt(x, y, hue);
  spawnSparks(x, y, hue, 1.0);

  const f = map(y, height, 0, 180, 880, true);
  playPluck(f, 0.7);
}

/* -------- Visuals: polys + sparks + key trails -------- */

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

/* small moving sparks (dots and plus signs) */
function spawnSparks(x,y,hue,scale){
  const count = floor(random(7, 14) * scale);
  for (let i=0;i<count;i++){
    const ang = random(TWO_PI);
    const speed = random(0.4, 1.7) * scale;
    const vx = cos(ang) * speed;
    const vy = sin(ang) * speed;
    const r  = random(3, 7) * scale;
    const life = random(0.6, 1.4);
    const shape = random() < 0.4 ? "plus" : "dot"; // more "+" shapes
    sparks.push(new Spark({
      x, y, vx, vy, r, life,
      hue: (hue + random(-20,20)) % 360,
      shape
    }));
  }
}

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
    const dt=deltaTime/1000;
    this.age+=dt;
    if (this.age>=this.life){
      this.done=true;
      return;
    }

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
    const dt=deltaTime/1000;
    this.age+=dt;
    if (this.age>=this.life){
      this.done=true;
      return;
    }
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

/* particles / sparks */
class Spark{
  constructor(o){
    this.x = o.x;
    this.y = o.y;
    this.vx = o.vx;
    this.vy = o.vy;
    this.r  = o.r;
    this.hue = o.hue || 260;
    this.life = o.life || 1.0;
    this.age = 0;
    this.shape = o.shape || "dot";
    this.done = false;
  }
  update(){
    const dt = deltaTime/1000;
    this.age += dt;
    if (this.age >= this.life){
      this.done = true;
      return;
    }
    const t = this.age / this.life;
    const alpha = pow(1 - t, 1.5);

    // motion
    this.x += this.vx * (deltaTime/16.6);
    this.y += this.vy * (deltaTime/16.6);
    this.vx *= 0.99;
    this.vy *= 0.99;

    push();
    translate(this.x, this.y);
    stroke(hsla(this.hue, 90, 85, alpha));
    if (this.shape === "plus"){
      // little "+" spark
      strokeWeight(1.8);
      line(-this.r, 0, this.r, 0);
      line(0, -this.r, 0, this.r);
    } else {
      // dot spark
      noFill();
      strokeWeight(1.5);
      circle(0,0,this.r*2);
    }
    pop();
  }
}

/* connecting trail between two key hits */
class KeyLink{
  constructor(x1,y1,x2,y2,hue){
    this.x1=x1; this.y1=y1;
    this.x2=x2; this.y2=y2;
    this.hue=hue||260;
    this.life=0.9;
    this.age=0;
    this.done=false;
    this.steps = max(6, floor(dist(x1,y1,x2,y2)/40)); // more dots for longer jumps
  }
  update(){
    const dt = deltaTime/1000;
    this.age += dt;
    if (this.age >= this.life){
      this.done = true;
      return;
    }

    const t = this.age / this.life;
    const alpha = pow(1 - t, 1.6);

    const shown = floor(this.steps * min(1, t*1.4)); // grow along the line

    push();
    blendMode(ADD);
    strokeWeight(0); // we only draw small shapes
    for (let i=0;i<shown;i++){
      const f = this.steps === 1 ? 0.5 : i/(this.steps-1);
      const px = lerp(this.x1, this.x2, f);
      const py = lerp(this.y1, this.y2, f);
      const r  = 5 + 2*sin((t + f)*PI);

      const a = alpha * (0.9 + 0.5*f); // brighter toward the new key
      fill(hsla(this.hue + f*20, 90, 90, a));
      circle(px, py, r*2);
    }
    pop();
  }
}

/* -------- Helpers -------- */

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
