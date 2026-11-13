/* ORBIT — interactive 3D solar system
   Raw WebGL, no external libraries.
   Sun + 9 planets with orbital motion, labels, and per-planet moon systems. */
(() => {
'use strict';

const canvas = document.getElementById('universe');
const hero = document.getElementById('top');
const loadingEl = document.getElementById('loading');
const heroCopy = document.getElementById('heroCopy');
const modeLabel = document.getElementById('modeLabel');
const backHint = document.getElementById('backHint');
const detailEl = document.getElementById('detail');
const detailKicker = document.getElementById('detailKicker');
const detailTitle = document.getElementById('detailTitle');
const detailDesc = document.getElementById('detailDesc');
const detailMeta = document.getElementById('detailMeta');
const hudState = document.getElementById('hudState');
const hintEl = document.getElementById('hint');

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
const qp = new URLSearchParams(location.search);
const TIER_NAME = qp.get('q') || (coarse ? 'mobile' : 'desktop');
const TIERS = {
  desktop: { stars: 9000, dpr: 2 },
  mobile:  { stars: 4500, dpr: 1.6 },
  low:     { stars: 2200, dpr: 1 }
};
const TIER = TIERS[TIER_NAME] || TIERS.desktop;

const FOV = 42 * Math.PI / 180;
const TAN = Math.tan(FOV / 2);
const NEAR = 0.4, FAR = 400;

function fail(err) {
  console.warn('3D scene unavailable', err);
  loadingEl.textContent = 'The cosmos awaits';
  setTimeout(() => loadingEl.classList.add('done'), 2200);
}

const gl = canvas.getContext('webgl', {
  alpha: false, antialias: false, depth: true, stencil: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: false
}) || canvas.getContext('experimental-webgl');
if (!gl) { fail('no webgl'); return; }

/* ───────── math ───────── */
const v3 = {
  sub: (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
  add: (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
  mul: (a, s) => [a[0]*s, a[1]*s, a[2]*s],
  dot: (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2],
  cross: (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l, a[1]/l, a[2]/l]; }
};
function m4perspective(o, fovy, aspect, near, far) {
  const f = 1/Math.tan(fovy/2), nf = 1/(near-far);
  o[0]=f/aspect; o[1]=0; o[2]=0; o[3]=0;
  o[4]=0; o[5]=f; o[6]=0; o[7]=0;
  o[8]=0; o[9]=0; o[10]=(far+near)*nf; o[11]=-1;
  o[12]=0; o[13]=0; o[14]=2*far*near*nf; o[15]=0;
}
function m4lookAt(o, eye, target, up) {
  const z = v3.norm(v3.sub(eye, target));
  const x = v3.norm(v3.cross(up, z));
  const y = v3.cross(z, x);
  o[0]=x[0]; o[1]=y[0]; o[2]=z[0]; o[3]=0;
  o[4]=x[1]; o[5]=y[1]; o[6]=z[1]; o[7]=0;
  o[8]=x[2]; o[9]=y[2]; o[10]=z[2]; o[11]=0;
  o[12]=-v3.dot(x,eye); o[13]=-v3.dot(y,eye); o[14]=-v3.dot(z,eye); o[15]=1;
}
function m4mul(o, a, b) {
  for (let i=0;i<4;i++) for (let j=0;j<4;j++) {
    o[i*4+j] = a[i*4]*b[j] + a[i*4+1]*b[4+j] + a[i*4+2]*b[8+j] + a[i*4+3]*b[12+j];
  }
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function mulberry(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ───────── planet data ───────── */
const PLANETS = [
  {
    name: 'Mercury', radius: 0.48, dist: 6.2, speed: 0.38, color: [0.78,0.74,0.68],
    tilt: 0.03, moons: [],
    info: {
      type: 'Terrestrial',
      diameter: '4,880 km',
      day: '59 Earth days',
      year: '88 Earth days',
      moons: '0',
      desc: 'The smallest planet and closest to the Sun. A heavily cratered world of extremes, with scorching days and freezing nights.'
    }
  },
  {
    name: 'Venus', radius: 1.05, dist: 8.8, speed: 0.29, color: [0.95,0.82,0.5],
    tilt: 3.1, moons: [],
    info: {
      type: 'Terrestrial',
      diameter: '12,104 km',
      day: '243 Earth days',
      year: '225 Earth days',
      moons: '0',
      desc: 'Earth’s twin in size, yet a furnace of runaway greenhouse gases. Thick clouds of sulfuric acid hide a surface hot enough to melt lead.'
    }
  },
  {
    name: 'Earth', radius: 1.1, dist: 11.5, speed: 0.24, color: [0.32,0.55,0.92],
    tilt: 0.41, moons: [
      { name: 'Moon', radius: 0.27, dist: 2.4, speed: 0.55, color: [0.75,0.75,0.72] }
    ],
    info: {
      type: 'Terrestrial',
      diameter: '12,742 km',
      day: '24 hours',
      year: '365.25 days',
      moons: '1',
      desc: 'Our home. The only world known to host life, with liquid oceans, a protective atmosphere, and a dynamic climate system.'
    }
  },
  {
    name: 'Mars', radius: 0.68, dist: 14.8, speed: 0.20, color: [0.88,0.48,0.32],
    tilt: 0.44, moons: [
      { name: 'Phobos', radius: 0.08, dist: 1.6, speed: 0.95, color: [0.55,0.5,0.45] },
      { name: 'Deimos', radius: 0.05, dist: 2.3, speed: 0.60, color: [0.5,0.48,0.42] }
    ],
    info: {
      type: 'Terrestrial',
      diameter: '6,779 km',
      day: '24.6 hours',
      year: '687 Earth days',
      moons: '2',
      desc: 'The Red Planet. Home to the tallest volcano and deepest canyon in the solar system, with polar ice and signs of ancient water.'
    }
  },
  {
    name: 'Jupiter', radius: 2.8, dist: 22.0, speed: 0.11, color: [0.82,0.68,0.48],
    tilt: 0.05, hasRing: false, moons: [
      { name: 'Io', radius: 0.22, dist: 4.2, speed: 0.72, color: [0.9,0.75,0.35] },
      { name: 'Europa', radius: 0.19, dist: 5.1, speed: 0.58, color: [0.85,0.88,0.92] },
      { name: 'Ganymede', radius: 0.26, dist: 6.2, speed: 0.42, color: [0.65,0.62,0.58] },
      { name: 'Callisto', radius: 0.24, dist: 7.4, speed: 0.31, color: [0.5,0.48,0.45] }
    ],
    info: {
      type: 'Gas Giant',
      diameter: '139,820 km',
      day: '10 hours',
      year: '12 Earth years',
      moons: '95+',
      desc: 'The largest planet. A swirling giant of hydrogen and helium, famous for the Great Red Spot — a storm larger than Earth that has raged for centuries.'
    }
  },
  {
    name: 'Saturn', radius: 2.35, dist: 29.5, speed: 0.08, color: [0.9,0.8,0.55],
    tilt: 0.47, hasRing: true, moons: [
      { name: 'Titan', radius: 0.25, dist: 5.8, speed: 0.40, color: [0.85,0.7,0.4] },
      { name: 'Rhea', radius: 0.12, dist: 4.4, speed: 0.55, color: [0.75,0.75,0.72] },
      { name: 'Enceladus', radius: 0.09, dist: 3.6, speed: 0.70, color: [0.9,0.92,0.95] }
    ],
    info: {
      type: 'Gas Giant',
      diameter: '116,460 km',
      day: '10.7 hours',
      year: '29 Earth years',
      moons: '146+',
      desc: 'Lord of the rings. Its magnificent icy ring system and methane-rich moon Titan make Saturn one of the most beautiful worlds in the solar system.'
    }
  },
  {
    name: 'Uranus', radius: 1.55, dist: 36.5, speed: 0.055, color: [0.55,0.82,0.88],
    tilt: 1.71, hasRing: true, moons: [
      { name: 'Titania', radius: 0.12, dist: 3.8, speed: 0.48, color: [0.7,0.72,0.75] },
      { name: 'Oberon', radius: 0.11, dist: 4.5, speed: 0.38, color: [0.65,0.65,0.68] }
    ],
    info: {
      type: 'Ice Giant',
      diameter: '50,724 km',
      day: '17 hours',
      year: '84 Earth years',
      moons: '28',
      desc: 'The sideways planet. Tilted nearly 98 degrees, Uranus rolls around the Sun on its side. A cold world of ice and faint rings.'
    }
  },
  {
    name: 'Neptune', radius: 1.5, dist: 42.5, speed: 0.045, color: [0.28,0.42,0.85],
    tilt: 0.49, hasRing: false, moons: [
      { name: 'Triton', radius: 0.18, dist: 4.2, speed: 0.42, color: [0.75,0.8,0.85] }
    ],
    info: {
      type: 'Ice Giant',
      diameter: '49,244 km',
      day: '16 hours',
      year: '165 Earth years',
      moons: '16',
      desc: 'The farthest giant. Deep blue and whipped by the fastest winds in the solar system. Its largest moon, Triton, orbits backward.'
    }
  },
  {
    name: 'Pluto', radius: 0.28, dist: 49.0, speed: 0.03, color: [0.72,0.62,0.55],
    tilt: 1.05, moons: [
      { name: 'Charon', radius: 0.14, dist: 2.0, speed: 0.48, color: [0.6,0.58,0.55] }
    ],
    info: {
      type: 'Dwarf Planet',
      diameter: '2,377 km',
      day: '6.4 Earth days',
      year: '248 Earth years',
      moons: '5',
      desc: 'The distant wanderer. Once the ninth planet, now a dwarf planet in the Kuiper Belt. A world of nitrogen ice, mountains, and a surprisingly complex surface.'
    }
  }
];

/* ───────── shaders ───────── */
const VS_FULL = `attribute vec2 aP;varying vec2 vUv;void main(){vUv=aP*.5+.5;gl_Position=vec4(aP,0.,1.);}`;
const FSP = `precision mediump float;`;

const VS_SPHERE = `
attribute vec3 aPos;
uniform mat4 uVP,uModel;
varying vec3 vP;varying vec3 vN;
void main(){
  vP = aPos;
  vN = normalize((uModel * vec4(aPos,0.)).xyz);
  gl_Position = uVP * uModel * vec4(aPos,1.);
}`;

const FS_SUN = FSP + `
uniform float uTime;
varying vec3 vP;varying vec3 vN;
void main(){
  float t = uTime;
  vec3 n = normalize(vP);
  float noise = sin(n.x*8.+t*.7)*sin(n.y*9.+t*.5)*sin(n.z*7.+t*.9)*.5+.5;
  noise += sin(n.x*15.-t)*sin(n.y*14.+t*.8)*.25;
  vec3 col = mix(vec3(1.0,.42,.06), vec3(1.0,.93,.48), noise);
  col += vec3(1.0,.98,.8) * pow(max(0., 1.0 - length(n.xy)*0.9), 2.5) * 1.4;
  float rim = pow(1.0 - max(dot(n, vec3(0.,0.,1.)), 0.), 1.6);
  col += vec3(1.0,.55,.12) * rim * 1.6;
  col *= 1.5;
  gl_FragColor = vec4(col, 1.);
}`;

const FS_PLANET = FSP + `
uniform vec3 uColor;uniform float uTime;uniform float uIsGas;
uniform vec3 uLightDir;uniform vec3 uCamDir;
varying vec3 vP;varying vec3 vN;
void main(){
  vec3 n = normalize(vN);
  vec3 lightDir = normalize(uLightDir);
  float ndl = max(dot(n, lightDir), 0.0);

  // high ambient so nothing looks black
  float ambient = 0.48;
  float diff = ndl * 0.9;

  // cinematic specular shine
  vec3 viewDir = normalize(uCamDir);
  vec3 halfV = normalize(lightDir + viewDir);
  float spec = pow(max(dot(n, halfV), 0.0), 28.0) * 0.65;

  vec3 col = uColor;

  if(uIsGas > 0.5){
    float bands = sin(n.y * 11. + uTime * 0.25) * 0.15 + sin(n.y * 4.5) * 0.1;
    col *= 1.0 + bands;
    col = mix(col, col * vec3(1.18,1.06,0.88), 0.3);
  } else {
    float var = sin(n.x*8.+n.z*6.) * sin(n.y*7.) * 0.11;
    col *= 1.0 + var;
  }

  float term = smoothstep(-0.3, 0.45, ndl);
  col *= mix(0.5, 1.2, term);

  // bright rim / atmosphere
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.6);
  col += uColor * rim * 0.7;
  col += vec3(0.55, 0.75, 1.0) * rim * 0.25;

  col = col * (ambient + diff) + vec3(1.0, 0.98, 0.9) * spec;
  col = pow(max(col, 0.0), vec3(0.9));
  gl_FragColor = vec4(col, 1.);
}`;

const VS_RING = `
attribute vec2 aRT;
uniform mat4 uVP,uModel;
varying float vR;
void main(){
  float r = aRT.x, th = aRT.y;
  vR = r;
  gl_Position = uVP * uModel * vec4(r*cos(th), 0., r*sin(th), 1.);
}`;
const FS_RING = FSP + `
uniform vec3 uColor;
varying float vR;
void main(){
  float a = smoothstep(1.3, 1.45, vR) * smoothstep(2.35, 2.15, vR);
  a *= 0.55 + 0.45 * sin(vR * 40.);
  gl_FragColor = vec4(uColor, a * 0.75);
}`;

const VS_CORONA = `
attribute vec2 aP;
uniform mat4 uVP;uniform vec3 uR,uU;uniform float uS;
varying vec2 vQ;
void main(){
  vQ = aP * uS;
  gl_Position = uVP * vec4(uR*aP.x*uS + uU*aP.y*uS, 1.);
}`;
const FS_CORONA = FSP + `
uniform float uTime;
varying vec2 vQ;
void main(){
  float r = length(vQ);
  float a = atan(vQ.y, vQ.x);
  float tend = sin(a*5. + uTime*.8 + r*3.) * .5 + .5;
  float e = exp(-(r-1.)*1.8) * (.55 + tend * 1.1);
  float halo = exp(-(r-1.)*0.9) * .4;
  vec3 col = vec3(1., .72, .22) * (e + halo) + vec3(1., .95, .55) * pow(e, 2.) * .8;
  col *= smoothstep(3.2, 1.0, r) * 1.3;
  gl_FragColor = vec4(col, 1.);
}`;

const STAR_PAL = `
vec3 pal(float t){
  vec3 b=vec3(.55,.7,1.), w=vec3(1.), wm=vec3(1.,.85,.65);
  return t<.6 ? mix(b,w,t/.6) : mix(w,wm,(t-.6)/.4);
}`;
const VS_STARS = STAR_PAL + `
attribute vec3 aPos;attribute vec4 aData;
uniform mat4 uVP;uniform float uTime,uPx,uMaxPt;
varying vec3 vC;
void main(){
  gl_Position = uVP * vec4(aPos,1.);
  float tw = .75 + .25*sin(uTime*(.4+aData.z)+aData.z*50.);
  gl_PointSize = clamp(aData.x * uPx, 1., uMaxPt);
  vC = pal(aData.y) * aData.w * tw;
}`;
const FS_STARS = FSP + `
varying vec3 vC;
void main(){
  float d = length(gl_PointCoord-.5)*2.;
  float a = 1. - smoothstep(0.,1.,d); a*=a;
  gl_FragColor = vec4(vC*a, 1.);
}`;

const VS_LABEL = `
attribute vec2 aP;
uniform mat4 uVP;uniform vec3 uPos;uniform vec3 uR,uU;uniform float uScale;
varying vec2 vUv;
void main(){
  vUv = aP * .5 + .5;
  vec3 pos = uPos + uR * aP.x * uScale + uU * aP.y * uScale;
  gl_Position = uVP * vec4(pos, 1.);
}`;
const FS_LABEL = FSP + `
uniform sampler2D uTex;uniform float uAlpha;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(uTex, vUv);
  gl_FragColor = vec4(c.rgb, c.a * uAlpha);
}`;

/* ───────── GL helpers ───────── */
function compile(type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs, name) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, name+' vs'));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, name+' fs'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name+' link: '+gl.getProgramInfoLog(p));
  const u = {}, a = {};
  for (let i=0,n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i<n;i++){
    const info = gl.getActiveUniform(p,i);
    u[info.name.replace(/\[0\]$/,'')] = gl.getUniformLocation(p, info.name);
  }
  for (let i=0,n=gl.getProgramParameter(p,gl.ACTIVE_ATTRIBUTES);i<n;i++){
    const info = gl.getActiveAttrib(p,i);
    a[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { p, u, a };
}
function buf(data, target) {
  const b = gl.createBuffer();
  gl.bindBuffer(target || gl.ARRAY_BUFFER, b);
  gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return b;
}
const enabled = [];
function attr(P, name, b, size, stride, offset) {
  const loc = P.a[name];
  if (loc === undefined || loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride||0, offset||0);
  enabled.push(loc);
}
function endAttrs() { while (enabled.length) gl.disableVertexAttribArray(enabled.pop()); }

/* ───────── state ───────── */
let S = null;
let raf = 0, running = false, visible = true;
let pr = 1, W = 1, H = 1, aspect = 1.6;
let time = 0, last = 0;
let yaw = 0.65, pitch = 0.18, yawT = 0.65, pitchT = 0.18, yawVel = 0;
let dist = 32, distBase = 32, distT = 32;
let mx = 0, my = 0, mxS = 0, myS = 0;
let dragging = false, lastX = 0, lastY = 0;
let lastTap = 0, tapCount = 0;
let mode = 'system'; // 'system' | 'planet'
let focusPlanet = -1;
let zoomT = 0; // 0 = system, 1 = planet
let detailOpen = false;
const view = new Float32Array(16), proj = new Float32Array(16), vp = new Float32Array(16);
const model = new Float32Array(16);
const maxPoint = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1];
const timeScale = reduceMotion ? 0.25 : 1;

/* ───────── geometry ───────── */
function makeSphere(detail) {
  // icosphere
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(v3.norm);
  let faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  for (let s = 0; s < detail; s++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => {
      const key = a < b ? a+','+b : b+','+a;
      if (cache.has(key)) return cache.get(key);
      const m = v3.norm(v3.add(verts[a], verts[b]));
      const i = verts.length; verts.push(m); cache.set(key, i); return i;
    };
    for (const [a,b,c] of faces) {
      const ab = mid(a,b), bc = mid(b,c), ca = mid(c,a);
      nf.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);
    }
    faces = nf;
  }
  const pos = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    pos[i*3] = verts[i][0]; pos[i*3+1] = verts[i][1]; pos[i*3+2] = verts[i][2];
  }
  const idx = new Uint16Array(faces.length * 3);
  let o = 0;
  for (const f of faces) { idx[o++]=f[0]; idx[o++]=f[1]; idx[o++]=f[2]; }
  return { pos, idx, count: idx.length };
}

function makeRing(segs) {
  const v = [];
  for (let i = 0; i <= segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    v.push(1.4, th, 2.25, th);
  }
  return new Float32Array(v);
}

/* ───────── labels ───────── */
const labelCache = {};
function makeLabelTexture(text) {
  if (labelCache[text]) return labelCache[text];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,256,64);
  ctx.font = '600 28px Manrope, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(text, 129, 34);
  ctx.fillStyle = '#eef6ff';
  ctx.fillText(text, 128, 32);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  labelCache[text] = tex;
  return tex;
}

/* ───────── build ───────── */
function build() {
  S = { prog: {}, buf: {} };
  const P = S.prog;
  P.sun = program(VS_SPHERE, FS_SUN, 'sun');
  P.planet = program(VS_SPHERE, FS_PLANET, 'planet');
  P.ring = program(VS_RING, FS_RING, 'ring');
  P.corona = program(VS_CORONA, FS_CORONA, 'corona');
  P.stars = program(VS_STARS, FS_STARS, 'stars');
  P.label = program(VS_LABEL, FS_LABEL, 'label');

  const B = S.buf;
  B.quad = buf(new Float32Array([-1,-1, 1,-1, -1,1, 1,1]));
  const sph = makeSphere(3);
  B.sphere = buf(sph.pos);
  B.sphereIdx = buf(sph.idx, gl.ELEMENT_ARRAY_BUFFER);
  S.sphereCount = sph.count;
  B.ring = buf(makeRing(96));

  // stars
  const rnd = mulberry(42);
  const sn = TIER.stars;
  const sd = new Float32Array(sn * 7);
  for (let i = 0; i < sn; i++) {
    const i7 = i * 7;
    // spherical distribution
    const z = rnd()*2-1, a = rnd()*Math.PI*2;
    const r = Math.sqrt(1 - z*z);
    const R = 80 + rnd()*120;
    sd[i7]   = r * Math.cos(a) * R;
    sd[i7+1] = z * R;
    sd[i7+2] = r * Math.sin(a) * R;
    sd[i7+3] = 0.6 + rnd()*2.2;   // size
    sd[i7+4] = rnd();             // color
    sd[i7+5] = rnd();             // twinkle phase
    sd[i7+6] = 0.5 + rnd()*0.5;   // brightness
  }
  B.stars = buf(sd);
  S.starCount = sn;

  // pre-make label textures
  PLANETS.forEach(p => makeLabelTexture(p.name));
  PLANETS.forEach(p => p.moons.forEach(m => makeLabelTexture(m.name)));
  makeLabelTexture('Sun');
}

/* ───────── camera helpers ───────── */
function eyeFor(yaw, pitch, dist) {
  return [
    Math.sin(yaw) * Math.cos(pitch) * dist,
    Math.sin(pitch) * dist,
    Math.cos(yaw) * Math.cos(pitch) * dist
  ];
}

function setModel(m, x, y, z, s, rotY) {
  const c = Math.cos(rotY||0), si = Math.sin(rotY||0);
  m[0]=s*c; m[1]=0; m[2]=-s*si; m[3]=0;
  m[4]=0; m[5]=s; m[6]=0; m[7]=0;
  m[8]=s*si; m[9]=0; m[10]=s*c; m[11]=0;
  m[12]=x; m[13]=y; m[14]=z; m[15]=1;
}

/* ───────── picking ───────── */
function pickPlanet(cx, cy) {
  // simple distance-based pick in screen space
  const eye = eyeFor(yaw, pitch, dist);
  m4perspective(proj, FOV, aspect, NEAR, FAR);
  m4lookAt(view, eye, [0,0,0], [0,1,0]);
  m4mul(vp, proj, view);

  let best = -1, bestD = 40;
  for (let i = 0; i < PLANETS.length; i++) {
    const p = PLANETS[i];
    const ang = time * p.speed * 0.15 + i * 0.7;
    const px = Math.cos(ang) * p.dist;
    const pz = Math.sin(ang) * p.dist;
    // project
    const x = vp[0]*px + vp[8]*pz + vp[12];
    const y = vp[1]*px + vp[9]*pz + vp[13];
    const w = vp[3]*px + vp[11]*pz + vp[15];
    if (w <= 0.1) continue;
    const sx = (x/w * 0.5 + 0.5) * W;
    const sy = (1 - (y/w * 0.5 + 0.5)) * H;
    const d = Math.hypot(sx - cx, sy - cy);
    const hitR = Math.max(28, p.radius * 18 * (W/900));
    if (d < hitR && d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/* ───────── mode transitions ───────── */
function enterPlanet(idx) {
  focusPlanet = idx;
  mode = 'planet';
  zoomT = 0;
  detailOpen = false;
  detailEl.classList.remove('open');
  heroCopy.classList.add('hidden');
  hintEl.classList.add('hidden');
  backHint.classList.add('show');
  modeLabel.textContent = PLANETS[idx].name.toUpperCase();
  modeLabel.classList.add('show');
  setTimeout(() => modeLabel.classList.remove('show'), 2200);
  hudState.textContent = PLANETS[idx].name.toUpperCase() + ' SYSTEM';
  showDetail(false);
}

function returnToSystem() {
  mode = 'system';
  focusPlanet = -1;
  zoomT = 0;
  detailOpen = false;
  detailEl.classList.remove('open');
  heroCopy.classList.remove('hidden');
  hintEl.classList.remove('hidden');
  backHint.classList.remove('show');
  hudState.textContent = 'ASTRONAUT VIEW';
  modeLabel.textContent = 'SOLAR SYSTEM';
  modeLabel.classList.add('show');
  setTimeout(() => modeLabel.classList.remove('show'), 1800);
}

function showDetail(open) {
  detailOpen = open;
  if (!open) {
    detailEl.classList.remove('open');
    return;
  }
  const p = PLANETS[focusPlanet];
  if (!p) return;
  detailKicker.textContent = p.info.type.toUpperCase();
  detailTitle.textContent = p.name;
  detailDesc.textContent = p.info.desc;
  detailMeta.innerHTML = `
    <span>Diameter<b>${p.info.diameter}</b></span>
    <span>Day length<b>${p.info.day}</b></span>
    <span>Year length<b>${p.info.year}</b></span>
    <span>Moons<b>${p.info.moons}</b></span>`;
  detailEl.classList.add('open');
}

/* ───────── render ───────── */
function render() {
  const P = S.prog, B = S.buf;
  const t = time;

  const eye = eyeFor(yaw, pitch, dist);
  m4perspective(proj, FOV, aspect, NEAR, FAR);
  m4lookAt(view, eye, [0,0,0], [0,1,0]);
  m4mul(vp, proj, view);
  const right = [view[0], view[4], view[8]];
  const up = [view[1], view[5], view[9]];
  const px = W / Math.max(1, hero.clientWidth);

  gl.viewport(0, 0, W, H);
  gl.clearColor(0.008, 0.015, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.BLEND);

  // stars
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  let p = P.stars; gl.useProgram(p.p);
  gl.uniformMatrix4fv(p.u.uVP, false, vp);
  gl.uniform1f(p.u.uTime, t); gl.uniform1f(p.u.uPx, px); gl.uniform1f(p.u.uMaxPt, maxPoint);
  attr(p, 'aPos', B.stars, 3, 28, 0); attr(p, 'aData', B.stars, 4, 28, 12);
  gl.drawArrays(gl.POINTS, 0, S.starCount); endAttrs();

  gl.depthMask(true);
  gl.disable(gl.BLEND);

  if (mode === 'system') {
    // ─── solar system view ───
    // Sun (larger + brighter)
    setModel(model, 0, 0, 0, 2.8, t * 0.12);
    p = P.sun; gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, vp);
    gl.uniformMatrix4fv(p.u.uModel, false, model);
    gl.uniform1f(p.u.uTime, t);
    attr(p, 'aPos', B.sphere, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.sphereIdx);
    gl.drawElements(gl.TRIANGLES, S.sphereCount, gl.UNSIGNED_SHORT, 0); endAttrs();

    // Sun corona
    gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    p = P.corona; gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, vp);
    gl.uniform3fv(p.u.uR, right); gl.uniform3fv(p.u.uU, up);
    gl.uniform1f(p.u.uS, 5.2); gl.uniform1f(p.u.uTime, t);
    attr(p, 'aP', B.quad, 2); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); endAttrs();
    gl.depthMask(true); gl.disable(gl.BLEND);

    // Planets
    for (let i = 0; i < PLANETS.length; i++) {
      const pl = PLANETS[i];
      const ang = t * pl.speed * 0.15 + i * 0.7;
      const px_ = Math.cos(ang) * pl.dist;
      const pz_ = Math.sin(ang) * pl.dist;
      const spin = t * (0.4 + i * 0.08);

      setModel(model, px_, 0, pz_, pl.radius, spin);
      p = P.planet; gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uVP, false, vp);
      gl.uniformMatrix4fv(p.u.uModel, false, model);
      gl.uniform3fv(p.u.uColor, pl.color);
      gl.uniform1f(p.u.uTime, t);
      gl.uniform1f(p.u.uIsGas, (i >= 4 && i <= 7) ? 1 : 0);
      // light from sun (origin) toward this planet
      const lLen = Math.hypot(px_, pz_) || 1;
      gl.uniform3f(p.u.uLightDir, -px_/lLen, 0.15, -pz_/lLen);
      gl.uniform3f(p.u.uCamDir, eye[0], eye[1], eye[2]);
      attr(p, 'aPos', B.sphere, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.sphereIdx);
      gl.drawElements(gl.TRIANGLES, S.sphereCount, gl.UNSIGNED_SHORT, 0); endAttrs();

      // rings for Saturn & Uranus
      if (pl.hasRing) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        setModel(model, px_, 0, pz_, pl.radius, spin * 0.1);
        p = P.ring; gl.useProgram(p.p);
        gl.uniformMatrix4fv(p.u.uVP, false, vp);
        gl.uniformMatrix4fv(p.u.uModel, false, model);
        gl.uniform3fv(p.u.uColor, pl.color);
        attr(p, 'aRT', B.ring, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 194); endAttrs();
        gl.depthMask(true); gl.disable(gl.BLEND);
      }

      // label
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      p = P.label; gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uVP, false, vp);
      gl.uniform3f(p.u.uPos, px_, pl.radius + 0.9, pz_);
      gl.uniform3fv(p.u.uR, right); gl.uniform3fv(p.u.uU, up);
      gl.uniform1f(p.u.uScale, 1.5 + pl.radius * 0.15);
      gl.uniform1f(p.u.uAlpha, 0.9);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, makeLabelTexture(pl.name));
      gl.uniform1i(p.u.uTex, 0);
      attr(p, 'aP', B.quad, 2); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); endAttrs();
      gl.depthMask(true); gl.disable(gl.BLEND);
    }

  } else if (mode === 'planet' && focusPlanet >= 0) {
    // ─── single planet + moons view ───
    const pl = PLANETS[focusPlanet];
    const focusScale = 4.0;   // larger planet for immersive first-person view
    const spin = t * 0.28;

    // planet
    setModel(model, 0, 0, 0, focusScale, spin);
    p = P.planet; gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, vp);
    gl.uniformMatrix4fv(p.u.uModel, false, model);
    gl.uniform3fv(p.u.uColor, pl.color);
    gl.uniform1f(p.u.uTime, t);
    gl.uniform1f(p.u.uIsGas, (focusPlanet >= 4 && focusPlanet <= 7) ? 1 : 0);
    gl.uniform3f(p.u.uLightDir, 0.55, 0.35, 0.75);
    gl.uniform3f(p.u.uCamDir, eye[0], eye[1], eye[2]);
    attr(p, 'aPos', B.sphere, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.sphereIdx);
    gl.drawElements(gl.TRIANGLES, S.sphereCount, gl.UNSIGNED_SHORT, 0); endAttrs();

    // rings
    if (pl.hasRing) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      setModel(model, 0, 0, 0, focusScale, spin * 0.08);
      p = P.ring; gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uVP, false, vp);
      gl.uniformMatrix4fv(p.u.uModel, false, model);
      gl.uniform3fv(p.u.uColor, pl.color);
      attr(p, 'aRT', B.ring, 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 194); endAttrs();
      gl.depthMask(true); gl.disable(gl.BLEND);
    }

    // moons
    for (let i = 0; i < pl.moons.length; i++) {
      const m = pl.moons[i];
      const ang = t * m.speed * 0.4 + i * 1.3;
      const mx = Math.cos(ang) * m.dist * focusScale * 0.9;
      const mz = Math.sin(ang) * m.dist * focusScale * 0.9;
      const mSpin = t * (0.6 + i * 0.2);

      setModel(model, mx, 0, mz, m.radius * focusScale, mSpin);
      p = P.planet; gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uVP, false, vp);
      gl.uniformMatrix4fv(p.u.uModel, false, model);
      gl.uniform3fv(p.u.uColor, m.color);
      gl.uniform1f(p.u.uTime, t);
      gl.uniform1f(p.u.uIsGas, 0);
      gl.uniform3f(p.u.uLightDir, 0.55, 0.35, 0.75);
      gl.uniform3f(p.u.uCamDir, eye[0], eye[1], eye[2]);
      attr(p, 'aPos', B.sphere, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.sphereIdx);
      gl.drawElements(gl.TRIANGLES, S.sphereCount, gl.UNSIGNED_SHORT, 0); endAttrs();

      // moon label
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      p = P.label; gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uVP, false, vp);
      gl.uniform3f(p.u.uPos, mx, m.radius * focusScale + 0.7, mz);
      gl.uniform3fv(p.u.uR, right); gl.uniform3fv(p.u.uU, up);
      gl.uniform1f(p.u.uScale, 1.1);
      gl.uniform1f(p.u.uAlpha, 0.85);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, makeLabelTexture(m.name));
      gl.uniform1i(p.u.uTex, 0);
      attr(p, 'aP', B.quad, 2); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); endAttrs();
      gl.depthMask(true); gl.disable(gl.BLEND);
    }

    // planet name label
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    p = P.label; gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, vp);
    gl.uniform3f(p.u.uPos, 0, focusScale + 1.4, 0);
    gl.uniform3fv(p.u.uR, right); gl.uniform3fv(p.u.uU, up);
    gl.uniform1f(p.u.uScale, 2.0);
    gl.uniform1f(p.u.uAlpha, 0.95);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, makeLabelTexture(pl.name));
    gl.uniform1i(p.u.uTex, 0);
    attr(p, 'aP', B.quad, 2); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); endAttrs();
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
}

/* ───────── loop ───────── */
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  time += dt * timeScale;

  // camera easing
  const e = 1 - Math.exp(-dt * 5);
  if (!dragging) {
    yawT += yawVel * dt;
    yawVel *= Math.exp(-dt * 2.2);
    if (!reduceMotion && mode === 'system') yawT += dt * 0.006;
  }
  yaw += (yawT - yaw) * (1 - Math.exp(-dt * 7));
  pitch += (pitchT - pitch) * (1 - Math.exp(-dt * 7));
  mxS += (mx - mxS) * e;
  myS += (my - myS) * e;

  // zoom transition
  if (mode === 'planet') {
    zoomT = Math.min(1, zoomT + dt * 1.4);
    distT = 11.5;          // closer, more first-person feel on planet page
  } else {
    zoomT = Math.max(0, zoomT - dt * 1.6);
    distT = distBase;
  }
  dist += (distT - dist) * (1 - Math.exp(-dt * 4.5));

  // subtle mouse parallax
  const oy = yaw, op = pitch;
  yaw += mxS * 0.1;
  pitch -= myS * 0.06;

  try { render(); } catch (err) {
    cancelAnimationFrame(raf); running = false; fail(err); return;
  }
  yaw = oy; pitch = op;
}

function start() {
  if (!running && visible && !document.hidden && S) {
    running = true; last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}
function stop() { running = false; cancelAnimationFrame(raf); }

/* ───────── resize ───────── */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, TIER.dpr) * pr;
  const w = hero.clientWidth, h = hero.clientHeight;
  W = Math.max(1, Math.floor(w * dpr));
  H = Math.max(1, Math.floor(h * dpr));
  canvas.width = W; canvas.height = H;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  aspect = W / H;
  // adjust base distance for aspect
  // first-person / astronaut framing — closer so the system fills the view
  distBase = aspect < 0.8 ? 42 : (aspect > 1.6 ? 28 : 32);
  if (mode === 'system') distT = distBase;
}

/* ───────── input ───────── */
canvas.addEventListener('pointerdown', e => {
  const now = performance.now();
  if (now - lastTap < 380) tapCount++;
  else tapCount = 1;
  lastTap = now;

  if (mode === 'planet') {
    if (tapCount >= 3) {
      tapCount = 0;
      returnToSystem();
      e.preventDefault();
      return;
    }
    if (tapCount >= 2) {
      tapCount = 0;
      showDetail(!detailOpen);
      e.preventDefault();
      return;
    }
  }

  if (mode === 'system' && tapCount >= 1) {
    // single tap can pick a planet
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (W / rect.width);
    const cy = (e.clientY - rect.top) * (H / rect.height);
    const hit = pickPlanet(cx, cy);
    if (hit >= 0 && (e.pointerType === 'touch' || tapCount >= 1)) {
      // slight delay so double-tap on planet still works as single select
      setTimeout(() => {
        if (tapCount <= 1 && mode === 'system') enterPlanet(hit);
      }, 220);
    }
  }

  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  yawVel = 0;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});

addEventListener('pointermove', e => {
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    yawT -= dx * 0.005;
    yawVel = -dx * 0.005 * 50 * 0.45;
    if (e.pointerType !== 'touch') {
      pitchT = clamp(pitchT + dy * 0.0038, -0.2, 1.15);
    }
  } else if (e.pointerType !== 'touch') {
    mx = e.clientX / innerWidth - 0.5;
    my = e.clientY / innerHeight - 0.5;
  }
});

const endDrag = () => { dragging = false; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// brand click returns home
document.getElementById('brandLink').addEventListener('click', e => {
  e.preventDefault();
  if (mode === 'planet') returnToSystem();
});

addEventListener('resize', resize);
new ResizeObserver(resize).observe(hero);
document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
new IntersectionObserver(es => {
  visible = es[0].isIntersecting;
  visible ? start() : stop();
}, { threshold: 0 }).observe(hero);

/* ───────── go ───────── */
try {
  resize();
  build();
  resize();
  canvas.classList.add('ready');
  loadingEl.classList.add('done');
  start();
} catch (err) { fail(err); }
})();
