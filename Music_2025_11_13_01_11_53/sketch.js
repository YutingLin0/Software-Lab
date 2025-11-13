/* Neon Expanding Polygons 
 * - Tap: spawns expanding neon pads + short pluck
 * - Drag: continuous trail with throttling for smoothness
 */

let polys = [];

// p5.sound detection
const hasSound = typeof window.p5 !== "undefined"
  && typeof p5.Oscillator === "function"
  && typeof p5.Envelope === "function";

// audio unlock once on first interaction
let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked || !hasSound) return;
  try {
    if (typeof userStartAudio === 'function') userStartAudio().catch(()=>{});
    const ctx = (typeof getAudioContext === 'function') ? getAudioContext() : null;
    if (ctx && ctx.state !== 'running') ctx.resume();
    if (!ctx || ctx.state === 'running') {
      audioUnlocked = true;
      ['pointerdown','touchstart','mousedown','visibilitychange'].forEach(type => {
        window.removeEventListener(type, unlockAudioOnce, true);
        document.removeEventListener(type, unlockAudioOnce, true);
      });
    }
  } catch(_) {}
}
['pointerdown','touchstart','mousedown','visibilitychange'].forEach(t=>{
  window.addEventListener(t, unlockAudioOnce, {capture:true, passive:false});
  document.addEventListener(t, unlockAudioOnce, {capture:true, passive:false});
});
function ensureAudio(){ unlockAudioOnce(); }

// simple pluck on touch-down
function playPluck(freq, amp=0.7) {
  if (!hasSound || !audioUnlocked) return;
  const osc = new p5.Oscillator('triangle');
  const env = new p5.Envelope(0.005, 1.0, 0.12, 0.0); // quick pluck
  osc.start(); osc.freq(freq, 0); osc.amp(env);
  env.mult(amp); env.play(osc);
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
  push(); blendMode(ADD); noStroke();
  for (const e of echoMap) {
    const age = (millis() - e.time)/20000; // 20s horizon
    const a = constrain(echoAlpha * (1 - age*0.25), 0, 0.5);
    fill(hsla(e.hue, 80, 30, a));
    circle(e.x, e.y, 22);
  }
  pop();
}

/* p5 lifecycle */
function setup() {
  const cnv = createCanvas(windowWidth, windowHeight);
  frameRate(60);
  blendMode(ADD);
  background(10,11,16);

  // Prevent page scroll/zoom over the canvas and enable multi-touch
  cnv.elt.style.touchAction = 'none';
  cnv.elt.addEventListener('pointerdown', onPointerDown, {passive:false});
  cnv.elt.addEventListener('pointermove', onPointerMove, {passive:false});
  cnv.elt.addEventListener('pointerup', onPointerUp, {passive:false});
  cnv.elt.addEventListener('pointercancel', onPointerUp, {passive:false});

  unlockAudioOnce();
}
function windowResized(){ resizeCanvas(windowWidth, windowHeight); }

function draw(){
  // soft fade for trails
  push(); blendMode(BLEND); noStroke(); fill(10,11,16,32); rect(0,0,width,height); pop();
  drawEchoLayer();

  for (const p of polys) p.update();
  polys = polys.filter(p => !p.done);
}

/* Pointer (multi-touch + trails) */
const activePointers = new Map(); // id -> {x,y,lastX,lastY,lastTime}

// trail density controls
const TRAIL_MIN_DIST = 20; 
const TRAIL_MIN_DT   = 28; 

function canvasXY(e){
  // Map element-relative coords to p5 canvas coords
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

  spawnAt(x, y);
  playPluck(map(y, height, 0, 180, 880, true), 0.7);
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
    spawnAt(x, y);
    p.lastX = x; p.lastY = y; p.lastTime = now;
  }

  p.x = x; p.y = y;
}

function onPointerUp(e){
  e.preventDefault();
  activePointers.delete(e.pointerId);
}

/* Visuals */
function spawnAt(x,y){
  // polygon sides randomized for variety (tri–oct)
  const sides = random([3,4,5,6,7,8]);
  const hue   = map(y, height, 0, 200, 330);
  const baseGrow  = random(4, 7);
  const baseLife  = random(1.0, 1.6);
  const baseSize  = random(40, 75);
  const baseThick = random(10, 18);

  logEcho(x,y,hue);

  polys.push(new ExpandingPoly({x,y,sides,hue,size:baseSize,grow:baseGrow,thick:baseThick,life:baseLife,alpha:0.85,blur:26}));
  polys.push(new ExpandingPoly({x,y,sides,hue,size:baseSize*0.6,grow:baseGrow*1.2,thick:baseThick*0.8,life:baseLife*0.9,alpha:0.75,blur:22,spin:random(-0.02,0.02)}));
  polys.push(new ExpandingPoly({x,y,sides,hue,size:baseSize*1.2,grow:baseGrow*0.9,thick:baseThick*0.6,life:baseLife*1.2,alpha:0.5,blur:34}));
  polys.push(new Crosshair(x,y,hue));
}

class ExpandingPoly{
  constructor(o){
    this.x=o.x; this.y=o.y;
    this.sides=max(3, floor(o.sides||6));
    this.hue=o.hue||260;

    this.size=o.size||50;   // diameter
    this.grow=o.grow||5;    // px/frame
    this.thick=o.thick||12;

    this.life=o.life||1.2;  // sec
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
    this.life=0.8; this.age=0; this.done=false;
  }
  update(){
    const dt=deltaTime/1000;
    this.age+=dt;
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
