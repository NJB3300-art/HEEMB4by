// heemb4by – frame-by-frame 2D animation drawn over a navigable 3D scene.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { colorWheel } from './colorwheel.js';
import { ACCEPT, MODEL_FORMATS, ext, groupFiles, parseModel, normalize, setRenderer } from './importers.js';
import { BRUSHES, BRUSH_BY_ID, CATEGORIES, DEFAULTS as BRUSH_DEFAULTS, EDITABLE, beginStroke, strokePoint, endStroke as finishEngine, preview, clearPreviews, registerBrush, unregisterBrush } from './brushes.js';

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);

/* =================================================================== project state */

const proj = {
  name: 'My animation',
  W: 960, H: 540,
  fps: 12,
  layers: [],
  frames: [],
  current: 0,
  activeLayer: null,
  env: { sky: '#bcd4f6', ground: true, grid: true, light: 1, groundColor: '#9fb78a', skyMode: 'dynamic', skyTop: '#4a7fd6', skyBottom: '#dcecff', time: 14, haze: 3, fog: 0, ambient: 1, sunTint: '#ffffff', lapse: false, lapseFrom: 6, lapseTo: 21 },
};
const models = []; // { id, name, kind, files, root, visible, animate, clip, mixer, clips }
let selectedModel = null;

function newLayer(name) { return { id: uid(), name, visible: true, opacity: 1 }; }
function newFrame(cam, camId = null) { return { id: uid(), cam, camId, sheets: [], thumb: null, thumbDirty: true }; }

/* =================================================================== 3D setup */

const box = $('box');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
setRenderer(renderer);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
box.prepend(renderer.domElement);
$('loading').remove();

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 2000);
camera.position.set(13, 3, 12);
camera.lookAt(0, 1, 0);

const hemi = new THREE.HemisphereLight(0xffffff, 0x667755, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 0.5, far: 120 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: proj.env.groundColor, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(60, 60, 0x445566, 0x8899aa);
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.position.y = 0.002;
scene.add(grid);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.zoomToCursor = true;
orbit.screenSpacePanning = true;
orbit.minDistance = 0.3;
orbit.maxDistance = 400;
orbit.target.set(0, 1, 0);
// remember when the user last moved the view, so heavy background work can wait
let lastInteract = 0;
const markInteract = () => { lastInteract = performance.now(); };
const interacting = () => performance.now() - lastInteract < 700;
const COARSE = window.matchMedia?.('(pointer: coarse)').matches ?? false;
orbit.addEventListener('start', markInteract);
orbit.addEventListener('change', markInteract);
orbit.update();

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value && camMode === 'orbit'; if (!e.value) { saveSoon(); markAllThumbs(); } });
scene.add(gizmo);

/* ---------- sky, time of day, sun & moon */

RectAreaLightUniformsLib.init();
const sky = new Sky();
sky.scale.setScalar(1500);
// the stock sky is so bright at midday it turns white; a gain keeps it blue (and lets clouds show)
sky.material.uniforms.skyGain = { value: 1 };
sky.material.fragmentShader = sky.material.fragmentShader
  .replace('void main() {', 'uniform float skyGain;\nvoid main() {')
  .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
scene.add(sky);

const stars = (() => {
  const n = 2200, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    if (v.y < 0.02) v.y = Math.abs(v.y) + 0.02;
    v.normalize().multiplyScalar(680);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
})();
scene.add(stars);

const moonLight = new THREE.DirectionalLight(0xa8bcff, 0);
scene.add(moonLight, moonLight.target);
const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), new THREE.MeshBasicMaterial({ color: '#eef1ff', toneMapped: false, fog: false }));
scene.add(moonDisc);

/* ---------- clouds: a sunlit cloud layer high above, drifting with the frames */
const CLOUD_COVER = { none: 0, few: 0.4, some: 0.52, lots: 0.66, overcast: 0.92 };
const clouds = new THREE.Mesh(
  new THREE.PlaneGeometry(4200, 4200, 1, 1).rotateX(Math.PI / 2),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: {
      uCover: { value: 0.5 }, uT: { value: 0 }, uWind: { value: new THREE.Vector2(8, 3) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.65, 0.72) },
      uGlow: { value: new THREE.Color(1, 0.9, 0.8) }, uCamPos: { value: new THREE.Vector3() }, uOpacity: { value: 1 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uCover, uT, uOpacity;
      uniform vec2 uWind;
      uniform vec3 uSunDir, uLit, uShade, uGlow, uCamPos;
      varying vec3 vWorld;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
        return v;
      }
      float density(vec2 p) {
        float big = fbm(p * 0.32 + vec2(7.3, 2.1));          // where the cloud banks are
        float detail = fbm(p + vec2(big * 1.3));              // puffy, billowing edges
        float n = big * 0.62 + detail * 0.58;
        float lo = 1.02 - uCover * 0.95;
        return smoothstep(lo, lo + 0.17, n);
      }
      void main() {
        vec2 p = (vWorld.xz + uWind * uT) * 0.0021;
        float d = density(p);
        if (d < 0.004) discard;
        // self-shadowing: look a little way toward the sun through the cloud
        vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.045;
        float d1 = density(p + toSun), d2 = density(p + toSun * 2.2);
        float light = clamp(1.0 - (d1 * 0.65 + d2 * 0.45) * 0.9 + (1.0 - d) * 0.35, 0.0, 1.0);
        light = mix(light, 1.0, max(0.0, uSunDir.y) * 0.25);
        vec3 col = mix(uShade, uLit, light);
        col *= 1.0 - d * 0.26;                                // thick middles are a bit darker
        // bright silver linings when looking toward the sun
        vec3 v = normalize(vWorld - uCamPos);
        float toward = pow(max(dot(v, normalize(uSunDir)), 0.0), 8.0);
        col += uGlow * toward * (1.0 - d) * 1.2;
        // thin out toward the horizon so the layer melts into the sky
        float dist = length(vWorld.xz - uCamPos.xz);
        float fade = 1.0 - smoothstep(950.0, 1850.0, dist);
        float a = smoothstep(0.0, 0.32, d) * fade * uOpacity;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  })
);
clouds.renderOrder = -1;
clouds.frustumCulled = false;
clouds.onBeforeRender = (r, sc, cam) => {
  clouds.position.set(cam.position.x, cam.position.y + 260, cam.position.z);
  clouds.updateMatrixWorld();
  clouds.material.uniforms.uCamPos.value.copy(cam.position);
};
scene.add(clouds);
/** Colors, cover and wind for the clouds at this time of day. */
function updateClouds(e, sunDir, dayK, goldK, nightK) {
  const cover = CLOUD_COVER[e.clouds] ?? 0;
  clouds.visible = cover > 0;
  const u = clouds.material.uniforms;
  u.uCover.value = cover;
  u.uSunDir.value.copy(sunDir);
  const lit = new THREE.Color(0.17, 0.19, 0.27).lerp(new THREE.Color(1, 1, 1), dayK).lerp(new THREE.Color(1.0, 0.68, 0.48), goldK * 0.85);
  const shade = new THREE.Color(0.035, 0.04, 0.065).lerp(new THREE.Color(0.47, 0.52, 0.61), dayK).lerp(new THREE.Color(0.5, 0.36, 0.45), goldK * 0.75);
  if (cover > 0.8) { lit.lerp(new THREE.Color(0.78, 0.8, 0.84).multiplyScalar(0.15 + 0.85 * dayK), 0.55); shade.multiplyScalar(0.85); }
  const k = Math.min(1.4, 0.6 + 0.4 * e.light) * (1 + 0.12 * dayK * (1 - goldK));
  u.uLit.value.copy(lit.multiplyScalar(k));
  u.uShade.value.copy(shade.multiplyScalar(k));
  u.uGlow.value.set(1, 0.92, 0.8).lerp(new THREE.Color(1, 0.6, 0.35), goldK).multiplyScalar(dayK * 0.9 + 0.05);
  const ang = THREE.MathUtils.degToRad(e.windDir ?? 35);
  u.uWind.value.set(Math.cos(ang), Math.sin(ang)).multiplyScalar((e.wind ?? 1) * 10);
}

const ENV_DEFAULTS = { sky: '#bcd4f6', skyMode: 'dynamic', skyTop: '#4a7fd6', skyBottom: '#dcecff', time: 14, haze: 3, fog: 0, ambient: 1, sunTint: '#ffffff', lapse: false, lapseFrom: 6, lapseTo: 21, light: 1, groundColor: '#9fb78a', ground: true, grid: true, clouds: 'some', wind: 1, windDir: 35 };
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let gradKey = '', gradTex = null, lastEnvK = -1;

function gradientTexture(top, bottom) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top); grd.addColorStop(1, bottom);
  g.fillStyle = grd; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Time of day for a frame: fixed, or sweeping across the frames when time lapse is on. */
function timeAt(i) {
  const e = proj.env;
  if (!e.lapse || proj.frames.length < 2) return e.time;
  return e.lapseFrom + (e.lapseTo - e.lapseFrom) * (i / (proj.frames.length - 1));
}
function fmtClock(v) {
  let t = ((v % 24) + 24) % 24;
  let hh = Math.floor(t), mm = Math.round((t - hh) * 60);
  if (mm === 60) { hh = (hh + 1) % 24; mm = 0; }
  const ap = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

function applyEnv(timeOverride) {
  const e = proj.env;
  for (const [k, v] of Object.entries(ENV_DEFAULTS)) if (e[k] === undefined) e[k] = v;
  const t = ((((timeOverride ?? e.time) % 24) + 24) % 24);
  const dayFrac = (t - 6) / 12;
  const elev = Math.sin(dayFrac * Math.PI) * 68;          // degrees above the horizon
  const az = 90 + dayFrac * 180;                          // rises east, sets west
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));
  const dayK = smoothstep(-6, 8, elev);
  const nightK = 1 - dayK;
  const sunUp = smoothstep(-2, 5, elev);
  const goldK = (1 - smoothstep(3, 28, elev)) * sunUp;

  sun.position.copy(sunDir).multiplyScalar(40);
  sun.color.set('#ffffff').lerp(new THREE.Color('#ff9a52'), goldK * 0.85).multiply(new THREE.Color(e.sunTint));
  const cloudDim = 1 - 0.75 * smoothstep(0.55, 0.92, CLOUD_COVER[e.clouds] ?? 0);
  sun.intensity = 2.6 * e.light * sunUp * cloudDim;
  sun.castShadow = sunUp > 0.05;

  const moonDir = sunDir.clone().negate();
  moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.25;
  moonDir.normalize();
  moonLight.position.copy(moonDir).multiplyScalar(40);
  moonLight.intensity = 0.45 * e.light * nightK;

  hemi.color.set('#20283f').lerp(new THREE.Color('#cfe2ff'), dayK).lerp(new THREE.Color('#ffc59a'), goldK * 0.4);
  hemi.groundColor.set('#1c1a22').lerp(new THREE.Color('#6b7a55'), dayK);
  hemi.intensity = (0.18 + 0.5 * dayK) * e.ambient * (1 + (1 - cloudDim) * 0.5);
  renderer.toneMappingExposure = 0.6 + 0.45 * dayK;

  const dyn = e.skyMode === 'dynamic';
  sky.visible = dyn;
  if (dyn) {
    const u = sky.material.uniforms;
    u.turbidity.value = e.haze * (1 - 0.35 * dayK * (1 - goldK));
    u.rayleigh.value = 1.2 + dayK * (1 - goldK) * 2.0 + goldK * 1.5; // deeper blue at midday, so clouds stand out
    u.mieCoefficient.value = 0.004 + e.haze * 0.0004;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sunDir);
    u.skyGain.value = 1 - 0.68 * dayK * (1 - goldK * 0.75);
    scene.background = new THREE.Color('#05060c');
  } else if (e.skyMode === 'gradient') {
    const key = e.skyTop + e.skyBottom;
    if (key !== gradKey || !gradTex) { gradTex?.dispose(); gradTex = gradientTexture(e.skyTop, e.skyBottom); gradKey = key; }
    scene.background = gradTex;
  } else {
    scene.background = new THREE.Color(e.sky);
  }
  stars.visible = dyn && nightK > 0.35;
  stars.material.opacity = smoothstep(0.35, 0.95, nightK);
  moonDisc.visible = dyn && nightK > 0.2;
  moonDisc.position.copy(moonDir).multiplyScalar(640);

  if (e.fog > 0.001) {
    const fc = new THREE.Color('#0b1020').lerp(new THREE.Color('#c9dbef'), dayK).lerp(new THREE.Color('#e9a77f'), goldK * 0.6);
    if (!e.ground) fc.multiplyScalar(1);
    scene.fog = new THREE.FogExp2(fc, e.fog * 0.035);
  } else scene.fog = null;

  ground.visible = e.ground;
  ground.material.color.set(e.groundColor);
  grid.visible = e.grid;
  updateClouds(e, sunDir, dayK, goldK, nightK);

  // reflections from the studio environment dim at night
  const envK = 0.15 + 0.85 * dayK;
  if (Math.abs(envK - lastEnvK) > 0.01) {
    lastEnvK = envK;
    scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) if (m.isMeshStandardMaterial) m.envMapIntensity = envK;
    });
  }
}
function refreshEnvIntensity() { lastEnvK = -1; applyEnv(timeAt(proj.current)); }

/* ---------- sample scene (procedural, so the app works with no files) */

function buildSampleScene() {
  const g = new THREE.Group();
  const mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const add = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  const houses = [[-6, -4, 0.3, '#f2b880', '#c45b4a'], [-1, -7, -0.2, '#9ecbd8', '#3d5a80'], [5, -5, 0.5, '#f4e2a1', '#7a4e8a'], [8, 2, -1.2, '#c9e4b4', '#b5473a'], [-8, 4, 1.4, '#f7c6d0', '#4b6b52']];
  for (const [x, z, ry, wall, roof] of houses) {
    const w = 3 + Math.abs(x) % 1.5, h = 2.4 + Math.abs(z) % 1.2;
    add(new THREE.BoxGeometry(w, h, 3), mat(wall), x, h / 2, z, ry);
    const r = add(new THREE.ConeGeometry(Math.max(w, 3) * 0.8, 1.8, 4), mat(roof), x, h + 0.9, z, ry + Math.PI / 4);
    r.scale.z = 0.9;
    add(new THREE.BoxGeometry(0.8, 1.4, 0.1), mat('#5a3d2b'), x + Math.sin(ry) * 1.55, 0.7, z + Math.cos(ry) * 1.55, ry);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.6, 0.6, 0.08), mat('#dff3ff', 0.2), x + Math.cos(ry) * s * 0.9 + Math.sin(ry) * 1.53, 1.6, z - Math.sin(ry) * s * 0.9 + Math.cos(ry) * 1.53, ry);
  }
  const trees = [[-3, 3], [2, 4], [-10, -2], [10, -3], [0, 9], [-5, 9], [6, 8], [12, 6], [-12, 8], [3, -11]];
  for (const [x, z] of trees) {
    const s = 0.8 + ((x * 7 + z * 3) % 5 + 5) % 5 * 0.12;
    add(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 1.4 * s, 8), mat('#7a5236'), x, 0.7 * s, z);
    add(new THREE.IcosahedronGeometry(1.1 * s, 1), mat('#5fa35a'), x, 1.9 * s, z);
  }
  const path = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 30), mat('#d9c9a3', 1));
  path.rotation.x = -Math.PI / 2; path.rotation.z = 0.25; path.position.y = 0.01; path.receiveShadow = true; g.add(path);
  for (let i = 0; i < 8; i++) add(new THREE.DodecahedronGeometry(0.25 + (i % 3) * 0.12, 0), mat('#9a9aa6'), -4 + i * 1.4, 0.15, 6 - (i % 2) * 2.5);
  const lamp = add(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), mat('#333842', 0.5), 1.8, 1.5, 1.2);
  add(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff2b3', emissive: '#ffcf4d', emissiveIntensity: 1.5 }), 1.8, 3.05, 1.2);
  lamp.castShadow = true;
  return g;
}

/* ---------- models */

function prepModelObject(obj) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && m.map) m.map.colorSpace = THREE.SRGBColorSpace;
    }
  });
}

async function addModelFromFiles(entry, saved) {
  const { object, animations } = await parseModel(entry);
  prepModelObject(object);
  const root = new THREE.Group();
  root.name = entry.name;
  const inner = new THREE.Group();
  inner.add(object);
  root.add(inner);
  if (!saved) {
    const s = normalize(object);
    inner.scale.setScalar(s);
    // sit on the ground at the origin
    root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(root);
    if (!b.isEmpty()) {
      const c = b.getCenter(new THREE.Vector3());
      inner.position.set(-c.x, -b.min.y, -c.z);
    }
  }
  const m = {
    id: saved?.id || uid(), name: entry.name, kind: 'file', files: entry.files, root, inner,
    visible: saved?.visible ?? true, animate: saved?.animate ?? animations.length > 0,
    clip: saved?.clip ?? 0, clips: animations, mixer: null,
  };
  if (saved?.inner) applyTransform(inner, saved.inner);
  if (saved?.transform) applyTransform(root, saved.transform);
  if (animations.length) {
    m.mixer = new THREE.AnimationMixer(object);
    setClip(m, m.clip);
  }
  root.visible = m.visible;
  scene.add(root);
  models.push(m);
  refreshEnvIntensity();
  return m;
}

function addSampleModel(saved) {
  const root = new THREE.Group();
  root.name = 'Sample town';
  const inner = buildSampleScene();
  root.add(inner);
  const m = { id: saved?.id || uid(), name: 'Sample town', kind: 'sample', files: null, root, inner, visible: saved?.visible ?? true, animate: false, clip: 0, clips: [], mixer: null };
  if (saved?.transform) applyTransform(root, saved.transform);
  root.visible = m.visible;
  scene.add(root);
  models.push(m);
  refreshEnvIntensity();
  return m;
}

function setClip(m, i) {
  if (!m.mixer) return;
  m.mixer.stopAllAction();
  m.clip = Math.min(i, m.clips.length - 1);
  const a = m.mixer.clipAction(m.clips[m.clip]);
  a.play();
}

function removeModel(m) {
  if (selectedModel === m) selectModel(null);
  scene.remove(m.root);
  m.root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const mt of mats) { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) mt[k]?.dispose?.(); mt.dispose(); }
  });
  models.splice(models.indexOf(m), 1);
}

function getTransform(o) { return { p: o.position.toArray(), r: [o.rotation.x, o.rotation.y, o.rotation.z], s: o.scale.toArray() }; }
function applyTransform(o, t) { o.position.fromArray(t.p); o.rotation.set(t.r[0], t.r[1], t.r[2]); o.scale.fromArray(t.s); }

function selectModel(m) {
  selectedModel = m;
  if (m) { selectedCam = null; selectedLight = null; dropArt(); }
  reattachGizmo();
  renderScenePane();
}

function setModelTimes(frameIndex) {
  if (proj.env.lapse) applyEnv(timeAt(frameIndex));
  const t = frameIndex / proj.fps;
  for (const m of models) {
    if (m.mixer) {
      if (m.animate) m.mixer.setTime(t % Math.max(0.0001, m.clips[m.clip].duration));
      else m.mixer.setTime(0);
    }
  }
}

/* =================================================================== cameras */

let camMode = 'orbit';
const fly = { yaw: 0, pitch: 0, speed: 4, keys: new Set(), dragging: false, lx: 0, ly: 0 };
const ORBIT_DIST = 6;

function captureCam() {
  return { p: camera.position.toArray(), q: camera.quaternion.toArray(), fov: camera.fov };
}
function applyCam(c) {
  flushOrbit();
  camera.position.fromArray(c.p);
  camera.quaternion.fromArray(c.q);
  camera.fov = c.fov;
  camera.updateProjectionMatrix();
  syncControllersFromCamera();
}
/** Distance to whatever is in the middle of the view (so orbiting turns around it). */
function centerDistance(fallback) {
  try {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const targets = models.filter((m) => m.visible).map((m) => m.root);
    if (ground.visible) targets.push(ground);
    const hit = raycaster.intersectObjects(targets, true).find((x) => x.object.isMesh);
    if (hit && hit.distance > 0.4 && hit.distance < 300) return hit.distance;
  } catch { /* ignore */ }
  return fallback;
}
function syncControllersFromCamera() {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const dist = centerDistance(camMode === 'orbit' ? Math.max(1, orbit.target.distanceTo(camera.position)) : ORBIT_DIST);
  orbit.target.copy(camera.position).addScaledVector(fwd, dist || ORBIT_DIST);
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  fly.yaw = e.y; fly.pitch = e.x;
}
/** Uses up any leftover orbit momentum, so a frame's camera stays exactly where it was saved. */
function flushOrbit() {
  orbit.enableDamping = false;
  orbit.update();
  orbit.enableDamping = true;
}
/* ---------- scene cameras you can hop into */

const sceneCams = []; // { id, name, obj, proxy, helper, fov }
let selectedCam = null;
let hopped = null;        // scene camera we're looking through
let editorView = null;    // the free view from before hopping in
let lastHopped = null;
let conesOn = true;

const camBodyMat = new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.45 });
const camDarkMat = new THREE.MeshStandardMaterial({ color: '#20242c', roughness: 0.35 });
function makeCamBody() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.34), camBodyMat);
  body.position.z = 0.12;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.095, 0.16, 18), camDarkMat);
  lens.rotation.x = Math.PI / 2; lens.position.z = -0.12;
  g.add(body, lens);
  for (const z of [0.03, 0.21]) {
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 18), camBodyMat);
    reel.rotation.z = Math.PI / 2; reel.position.set(0, 0.17, z);
    g.add(reel);
  }
  g.traverse((o) => { if (o.isMesh) o.userData.camBody = true; });
  return g;
}
function nextCamName() {
  let n = 1;
  for (const c of sceneCams) { const m = /^Camera (\d+)$/.exec(c.name); if (m) n = Math.max(n, +m[1] + 1); }
  return `Camera ${n}`;
}
function addSceneCam(view = captureCam(), saved = null) {
  const obj = new THREE.Group();
  obj.add(makeCamBody());
  obj.position.fromArray(view.p);
  obj.quaternion.fromArray(view.q);
  const proxy = new THREE.PerspectiveCamera(view.fov, proj.W / proj.H, 0.25, 2.2);
  obj.add(proxy);
  obj.updateMatrixWorld(true);
  const helper = new THREE.CameraHelper(proxy);
  scene.add(obj, helper);
  const c = { id: saved?.id || uid(), name: saved?.name || nextCamName(), obj, proxy, helper, fov: view.fov };
  sceneCams.push(c);
  camsVisible(!playing && !exporting);
  return c;
}
function removeSceneCam(c) {
  if (hopped === c) hopOut();
  if (selectedCam === c) selectCam(null);
  scene.remove(c.obj, c.helper);
  c.obj.traverse((o) => o.geometry?.dispose());
  c.helper.dispose?.();
  sceneCams.splice(sceneCams.indexOf(c), 1);
  for (const f of proj.frames) if (f.camId === c.id) f.camId = null;
  if (lastHopped === c) lastHopped = null;
}
function camsVisible(v) {
  for (const c of sceneCams) {
    c.obj.visible = v && c !== hopped;
    c.helper.visible = v && c !== hopped && conesOn;
  }
  lightsVisible(v);
}
function setCamLens(c, fov) {
  c.fov = fov;
  c.proxy.fov = fov;
  c.proxy.aspect = proj.W / proj.H;
  c.proxy.updateProjectionMatrix();
  c.helper.update();
}
function camView(c) { return { p: c.obj.position.toArray(), q: c.obj.quaternion.toArray(), fov: c.fov }; }

function hopIn(c) {
  if (!c || hopped === c) return;
  if (!hopped) editorView = captureCam();
  hopped = c;
  lastHopped = c;
  if (gizmo.object === c.obj) gizmo.detach();
  camsVisible(!playing);
  applyCam(camView(c));
  if (tool !== 'camera') setTool('camera');
  updateHopUI();
  toast(`Inside ${c.name}: moving the view moves this camera`);
}
function hopOut() {
  if (!hopped) return;
  const c = hopped;
  hopped = null;
  camsVisible(!playing);
  if (editorView) applyCam(editorView);
  else {
    // step back so the camera you just left is in sight
    const back = new THREE.Vector3(0, 0.6, 2.5).applyQuaternion(c.obj.quaternion).add(c.obj.position);
    camera.position.copy(back);
    camera.lookAt(c.obj.position);
    syncControllersFromCamera();
  }
  editorView = null;
  updateHopUI();
  reattachGizmo();
}
/** A new camera where you're looking from; then step back so you can see it. */
function newCameraHere() {
  if (hopped) hopOut();
  const c = addSceneCam();
  const back = new THREE.Vector3(0.8, 0.7, 3).applyQuaternion(camera.quaternion).add(camera.position);
  camera.position.copy(back);
  camera.lookAt(c.obj.position);
  syncControllersFromCamera();
  setTool('camera');
  selectCam(c);
  saveSoon();
  toast(`${c.name} placed. Click it for options.`);
  return c;
}

/* ---------- click menu for a camera in the picture */
const camMenu = document.getElementById('camMenu');
let camMenuFor = null;
function showCamMenu(c, cx, cy) {
  camMenuFor = c;
  camMenu.innerHTML = '';
  const item = (label, icon, fn, cls = '') => {
    const b = h('button', { type: 'button', role: 'menuitem', class: cls }, svg(icon), label);
    b.addEventListener('click', () => { hideCamMenu(); fn(); });
    camMenu.append(b);
    return b;
  };
  camMenu.append(h('div', { class: 'cm-title' }, c.name));
  const first = item(hopped === c ? 'Hop out' : 'Hop in', '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>', () => (hopped === c ? hopOut() : hopIn(c)));
  item('Move', '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>', () => { selectCam(c); gizmo.setMode('translate'); toast('Drag the arrows to move ' + c.name); });
  item('Turn', '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>', () => { selectCam(c); gizmo.setMode('rotate'); toast('Drag the rings to turn ' + c.name); });
  item('Rename', '<path d="M15 4l5 5L9 20H4v-5z"/>', async () => { const n = await promptDlg('Rename camera', c.name); if (n) { c.name = n.slice(0, 30); updateHopUI(); saveSoon(); } });
  camMenu.append(h('hr'));
  item('Delete', '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', async () => {
    if (await confirmDlg('Delete camera?', `Remove “${c.name}”? Frames made with it keep their view.`, 'Delete')) { removeSceneCam(c); renderScenePane(); saveSoon(); toast('Camera deleted'); }
  }, 'danger');
  camMenu.hidden = false;
  const vr = view.getBoundingClientRect();
  const mw = camMenu.offsetWidth, mh = camMenu.offsetHeight;
  const x = Math.min(Math.max(8, cx - vr.left + 10), vr.width - mw - 8);
  const y = Math.min(Math.max(8, cy - vr.top + 10), vr.height - mh - 8);
  camMenu.style.left = x + 'px';
  camMenu.style.top = y + 'px';
  first.focus();
}
function hideCamMenu() { camMenu.hidden = true; camMenuFor = null; }
document.addEventListener('pointerdown', (e) => { if (!camMenu.hidden && !camMenu.contains(e.target)) hideCamMenu(); }, true);
camMenu.addEventListener('keydown', (e) => {
  const items = [...camMenu.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === 'Escape') { e.stopPropagation(); hideCamMenu(); }
});

function toggleHop() {
  if (hopped) { hopOut(); return; }
  let c = selectedCam || lastHopped || sceneCams[0];
  if (!c) { c = addSceneCam(); toast(`${c.name} placed at this view`); }
  hopIn(c);
}
/** While inside a camera, the camera object follows the view (and lens). */
function syncHoppedCam() {
  if (!hopped || playing || exporting) return;
  hopped.obj.position.copy(camera.position);
  hopped.obj.quaternion.copy(camera.quaternion);
  if (Math.abs(hopped.fov - camera.fov) > 0.001) setCamLens(hopped, camera.fov);
}
/** Frames made from inside a camera remember it; visiting the frame puts you back inside. */
function hopFromFrame(f) {
  const c = f.camId ? sceneCams.find((x) => x.id === f.camId) : null;
  if (c) {
    if (!hopped) editorView = null;
    hopped = c; lastHopped = c;
    if (gizmo.object === c.obj) gizmo.detach();
  } else if (hopped) {
    hopped = null; editorView = null;
    reattachGizmo();
  }
  camsVisible(!playing);
  updateHopUI();
}
function updateHopUI() {
  const b = $('hopBtn');
  if (!b) return;
  b.textContent = hopped ? `Hop out of ${hopped.name}` : 'Hop in camera';
  b.setAttribute('aria-pressed', String(!!hopped));
  box.classList.toggle('hopped', !!hopped);
  $('hopTag').textContent = hopped ? hopped.name : '';
  if (activeTab === 'Scene') renderScenePane();
}
function selectCam(c) {
  selectedCam = c;
  if (c) { selectedModel = null; selectedLight = null; dropArt(); }
  if (c && gizmo.mode === 'scale') gizmo.setMode('translate');
  reattachGizmo();
  renderScenePane();
}
function reattachGizmo() {
  if (tool !== 'camera' || playing || exporting) { gizmo.detach(); return; }
  if (selectedModel) gizmo.attach(selectedModel.root);
  else if (selectedCam && selectedCam !== hopped) gizmo.attach(selectedCam.obj);
  else if (selectedLight) gizmo.attach(selectedLight.root);
  else if (selectedArt) gizmo.attach(artPivot);
  else gizmo.detach();
  gizmo.setSpace(gizmo.object === artPivot ? 'local' : 'world');
}

/* ---------- placeable lights */

const LIGHT_TYPES = { point: 'Point bulb', spot: 'Spotlight', dir: 'Directional', area: 'Area panel' };
const LIGHT_DEFAULTS = {
  point: { color: '#ffd7a1', intensity: 160, distance: 18, shadow: false },
  spot: { color: '#fff3dc', intensity: 500, distance: 30, angle: 30, penumbra: 0.35, shadow: true },
  dir: { color: '#ffffff', intensity: 3, shadow: true },
  area: { color: '#dfe9ff', intensity: 40, width: 2, height: 1.2, shadow: false },
};
const LIGHT_MAX = { point: 2000, spot: 5000, dir: 12, area: 400 };
// soft glow drawn around lamps so you can see where the light comes from
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const lights = [];
let selectedLight = null, lightIconsOn = true;

function nextLightName(type) {
  const base = LIGHT_TYPES[type];
  let n = 1;
  while (lights.some((l) => l.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}
function spotConeGeo(angleDeg, len) {
  const r = len * Math.tan(THREE.MathUtils.degToRad(Math.min(85, angleDeg)));
  const pts = [], N = 24;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a0) * r, Math.sin(a0) * r, -len), new THREE.Vector3(Math.cos(a1) * r, Math.sin(a1) * r, -len));
    if (i % 6 === 0) pts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a0) * r, Math.sin(a0) * r, -len));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function addLight(type, saved) {
  const d = { id: uid(), type, name: nextLightName(type), on: true, distance: 12, angle: 30, penumbra: 0.35, width: 2, height: 1.2, ...LIGHT_DEFAULTS[type], ...(saved || {}) };
  const root = new THREE.Group();
  let light;
  if (type === 'point') light = new THREE.PointLight(d.color, d.intensity, d.distance, 2);
  else if (type === 'spot') light = new THREE.SpotLight(d.color, d.intensity, d.distance, 0.5, d.penumbra, 2);
  else if (type === 'dir') {
    light = new THREE.DirectionalLight(d.color, d.intensity);
    Object.assign(light.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 0.5, far: 80 });
  } else light = new THREE.RectAreaLight(d.color, d.intensity, d.width, d.height);
  root.add(light);
  if ('target' in light && light.target) {
    const tg = new THREE.Object3D(); tg.position.set(0, 0, -1); root.add(tg); light.target = tg;
  }
  if (light.shadow) { light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -0.0006; }

  const icon = new THREE.Group();
  const iconMat = new THREE.MeshBasicMaterial({ color: d.color, toneMapped: false, fog: false });
  const lineMat = new THREE.LineBasicMaterial({ color: d.color, transparent: true, opacity: 0.55, toneMapped: false, fog: false });
  const mk = (geo, mat = iconMat) => { const m = new THREE.Mesh(geo, mat); m.userData.lightBody = true; icon.add(m); return m; };
  if (type === 'point') mk(new THREE.SphereGeometry(0.14, 16, 12));
  if (type === 'spot') { const g = new THREE.ConeGeometry(0.13, 0.28, 16); g.rotateX(-Math.PI / 2); mk(g); }
  if (type === 'dir') {
    mk(new THREE.SphereGeometry(0.16, 16, 12));
    const shaft = new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8); shaft.rotateX(Math.PI / 2); shaft.translate(0, 0, -0.45); mk(shaft);
    const tip = new THREE.ConeGeometry(0.08, 0.18, 12); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, -0.85); mk(tip);
  }
  if (type === 'area') {
    const panel = mk(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: d.color, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.85, fog: false }));
    panel.userData.panel = true;
  }
  let cone = null;
  if (type === 'spot') { cone = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat); icon.add(cone); }
  root.add(icon);
  let glow = null;
  if (type !== 'dir') {
    glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: d.color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    glow.renderOrder = 50;
    glow.raycast = () => {};
    root.add(glow);
  }

  const L = { ...d, root, light, icon, iconMat, lineMat, cone, glow };
  delete L.transform;
  if (saved?.transform) applyTransform(root, saved.transform);
  else {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    root.position.copy(camera.position).addScaledVector(fwd, type === 'dir' ? 4 : 3);
    root.quaternion.copy(camera.quaternion);
    root.position.y = Math.max(root.position.y, 0.4);
  }
  scene.add(root);
  lights.push(L);
  applyLight(L);
  lightsVisible(!playing && !exporting);
  return L;
}

function applyLight(L) {
  const lt = L.light;
  lt.color.set(L.color);
  lt.intensity = L.on ? L.intensity : 0;
  lt.visible = L.on;
  if (lt.isPointLight || lt.isSpotLight) lt.distance = L.distance;
  if (lt.isSpotLight) { lt.angle = THREE.MathUtils.degToRad(L.angle); lt.penumbra = L.penumbra; }
  if (lt.isRectAreaLight) { lt.width = L.width; lt.height = L.height; }
  if (lt.shadow) lt.castShadow = L.on && !!L.shadow;
  if (L.glow) {
    L.glow.visible = L.on && L.intensity > 0;
    L.glow.material.color.set(L.color);
    const k = { point: 160, spot: 500, area: 40 }[L.type] || 100;
    const sz = Math.min(4, 0.7 + 0.9 * Math.sqrt(L.intensity / k));
    L.glow.scale.set(sz, sz, 1);
    L.glow.material.opacity = Math.min(1, 0.35 + 0.4 * Math.sqrt(L.intensity / k));
  }
  const iconColor = L.on ? L.color : '#5a5f6b';
  L.icon.traverse((o) => {
    if (o.material?.color) o.material.color.set(iconColor);
    if (o.userData.panel) o.scale.set(L.width, L.height, 1);
  });
  if (L.cone) {
    L.cone.geometry.dispose();
    L.cone.geometry = spotConeGeo(L.angle, Math.max(0.8, Math.min(3, L.distance * 0.2)));
  }
}

function lightsVisible(v) {
  for (const L of lights) L.icon.visible = v && lightIconsOn;
}

function removeLight(L) {
  if (selectedLight === L) selectLight(null);
  scene.remove(L.root);
  L.root.traverse((o) => { if (!o.isSprite) o.geometry?.dispose(); if (o.material && o.material !== outlineSafe) o.material.dispose?.(); });
  L.light.dispose?.();
  lights.splice(lights.indexOf(L), 1);
}
const outlineSafe = null;

function selectLight(L) {
  selectedLight = L;
  if (L) { selectedModel = null; selectedCam = null; dropArt(); if (gizmo.mode === 'scale') gizmo.setMode('translate'); }
  reattachGizmo();
  renderScenePane();
}

function camDiffers(a, b) {
  if (!a || !b) return false;
  const dp = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  const dq = 1 - Math.abs(a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3]);
  return dp > 0.002 || dq > 1e-6 || Math.abs(a.fov - b.fov) > 0.01;
}
function lerpCam(a, b, t) {
  const p = new THREE.Vector3().fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), t);
  const q = new THREE.Quaternion().fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q), t);
  return { p: p.toArray(), q: q.toArray(), fov: a.fov + (b.fov - a.fov) * t };
}

function setCamMode(mode) {
  camMode = mode;
  $('modeOrbit').setAttribute('aria-pressed', String(mode === 'orbit'));
  $('modeFly').setAttribute('aria-pressed', String(mode === 'fly'));
  $('flyHelp').style.display = mode === 'fly' ? '' : 'none';
  syncControllersFromCamera();
  orbit.enabled = mode === 'orbit';
  if (mode === 'orbit') { flushOrbit(); orbit.update(); }
  fly.vel?.set(0, 0, 0);
  if (typeof updateFlyPad === 'function') updateFlyPad();
}

// Fly / walk: drag to look (one finger or the mouse), WASD or the on-screen stick to move.
const glc = renderer.domElement;
let downAt = null;
glc.addEventListener('pointerdown', (e) => {
  markInteract();
  if (downAt) return;               // ignore extra fingers
  downAt = { x: e.clientX, y: e.clientY, id: e.pointerId };
  if (camMode !== 'fly' || gizmo.dragging) return;
  fly.dragging = true; fly.lx = e.clientX; fly.ly = e.clientY; fly.pid = e.pointerId;
  glc.setPointerCapture(e.pointerId);
});
glc.addEventListener('pointermove', (e) => {
  if (!fly.dragging || gizmo.dragging || e.pointerId !== fly.pid) return;
  markInteract();
  const dx = e.clientX - fly.lx, dy = e.clientY - fly.ly;
  fly.lx = e.clientX; fly.ly = e.clientY;
  const sens = COARSE ? 0.006 : 0.0035;
  fly.yaw -= dx * sens; fly.pitch -= dy * sens;
  fly.pitch = Math.max(-1.5, Math.min(1.5, fly.pitch));
  camera.quaternion.setFromEuler(new THREE.Euler(fly.pitch, fly.yaw, 0, 'YXZ'));
});
const flyUp = (e) => {
  if (downAt && e.pointerId !== downAt.id) return;
  if (fly.pid === e.pointerId) fly.dragging = false;
  if (e.type === 'pointerup' && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && !gizmo.dragging && tool === 'camera') pickModelAt(e);
  downAt = null;
};
glc.addEventListener('pointerup', flyUp);
glc.addEventListener('pointercancel', flyUp);
glc.addEventListener('wheel', (e) => {
  markInteract();
  if (camMode !== 'fly') return;
  e.preventDefault();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  fly.vel.addScaledVector(fwd, -Math.sign(e.deltaY) * fly.speed * 0.9);
}, { passive: false });

/* on-screen stick + up/down buttons for touch screens */
fly.vel = new THREE.Vector3();
fly.stick = { x: 0, y: 0 };
fly.vert = 0;
function buildTouchPad() {
  const pad = document.createElement('div');
  pad.className = 'flypad';
  pad.setAttribute('aria-hidden', 'true');
  pad.innerHTML = '<div class="joy"><div class="knob"></div></div><div class="ud"><button type="button" data-v="1">▲</button><button type="button" data-v="-1">▼</button></div>';
  document.getElementById('view').append(pad);
  const joy = pad.querySelector('.joy'), knob = pad.querySelector('.knob');
  let jid = null;
  const setStick = (e) => {
    const r = joy.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    fly.stick.x = x; fly.stick.y = y;
    knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
    markInteract();
  };
  joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); setStick(e); e.stopPropagation(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) setStick(e); });
  const release = (e) => { if (e.pointerId !== jid) return; jid = null; fly.stick.x = fly.stick.y = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', release);
  joy.addEventListener('pointercancel', release);
  for (const b of pad.querySelectorAll('.ud button')) {
    b.addEventListener('pointerdown', (e) => { fly.vert = +b.dataset.v; b.setPointerCapture(e.pointerId); markInteract(); });
    const stop = () => { fly.vert = 0; };
    b.addEventListener('pointerup', stop); b.addEventListener('pointercancel', stop);
  }
  return pad;
}
const flyPad = buildTouchPad();
function updateFlyPad() {
  flyPad.classList.toggle('show', COARSE && camMode === 'fly' && tool === 'camera' && !playing);
}

const raycaster = new THREE.Raycaster();
function pickModelAt(e) {
  const r = glc.getBoundingClientRect();
  const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(v, camera);
  const f = curFrame();
  const art = new Map([...(f ? f.sheets : []), ...mediaSheets.values()].filter((s) => s.mesh && s.mesh.visible && !isLocked(s.layerId)).map((s) => [s.mesh, s]));
  const targets = [...models.filter((m) => m.visible).map((m) => m.root), ...sceneCams.filter((c) => c.obj.visible).map((c) => c.obj), ...lights.filter((L) => L.icon.visible).map((L) => L.icon), ...art.keys()];
  const all = raycaster.intersectObjects(targets, true).filter((x) => (x.object.isMesh || x.object.isPoints) && (!x.object.userData.sheet || art.has(x.object)));
  // drawings are see-through except where there's paint, so only paint counts as a hit;
  const artHit = all.filter((x) => art.has(x.object)).find((x) => x.uv && paintAt(art.get(x.object), x.uv));
  const hits = all.filter((x) => !art.has(x.object));
  // a drawing hidden behind a model doesn't get picked through it
  if (artHit && (!hits.length || artHit.distance <= hits[0].distance * 1.02 + 0.05)) {
    const s = art.get(artHit.object);
    selectArt([s]);
    proj.activeLayer = s.layerId;
    openPanel('Layers');
    return;
  }
  if (!hits.length) { selectCam(null); selectModel(null); selectLight(null); if (selectedArt) selectArt(null); return; }
  const hit = hits[0].object;
  if (hit.userData.lightBody) {
    const L = lights.find((ll) => { let f = false; ll.icon.traverse((o) => { if (o === hit) f = true; }); return f; });
    selectLight(L || null);
    openPanel('Scene');
    return;
  }
  if (hit.userData.camBody) {
    const c = sceneCams.find((cc) => { let f = false; cc.obj.traverse((o) => { if (o === hit) f = true; }); return f; });
    selectCam(c || null);
    if (c) showCamMenu(c, e.clientX, e.clientY);
    return;
  }
  const m = models.find((mm) => { let found = false; mm.root.traverse((o) => { if (o === hit) found = true; }); return found; });
  selectModel(m || null);
  if (m) openPanel('Scene');
}

function updateFly(dt) {
  if (camMode !== 'fly' || playing) { fly.vel.set(0, 0, 0); return; }
  const k = isTyping() ? new Set() : fly.keys;
  const want = new THREE.Vector3();
  const fwd = new THREE.Vector3(-Math.sin(fly.yaw), 0, -Math.cos(fly.yaw));
  const right = new THREE.Vector3(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw));
  if (k.has('w') || k.has('arrowup')) want.add(fwd);
  if (k.has('s') || k.has('arrowdown')) want.sub(fwd);
  if (k.has('d') || k.has('arrowright')) want.add(right);
  if (k.has('a') || k.has('arrowleft')) want.sub(right);
  if (k.has('e')) want.y += 1;
  if (k.has('q')) want.y -= 1;
  want.addScaledVector(fwd, -fly.stick.y).addScaledVector(right, fly.stick.x);
  want.y += fly.vert;
  if (want.lengthSq() > 1) want.normalize();
  want.multiplyScalar(fly.speed * (k.has('shift') ? 3 : 1));
  // ease toward the wanted speed so starting and stopping feel smooth
  fly.vel.lerp(want, 1 - Math.exp(-dt * 10));
  if (fly.vel.lengthSq() < 1e-5) { fly.vel.set(0, 0, 0); return; }
  camera.position.addScaledVector(fly.vel, dt);
  markInteract();
}

/* =================================================================== frames & layers */

function curFrame() { return proj.frames[proj.current]; }
function layerIndex(id) { return proj.layers.findIndex((l) => l.id === id); }

function makeCanvas(w = proj.W, h = proj.H) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
/* ---------- drawings live in the 3D world
   Each frame holds "sheets": a drawing canvas plus the camera view it was drawn from
   and how far away it sits. A sheet is shown as a flat picture in the scene, exactly
   where it was drawn, so it stays put when the camera moves. */

const sheetGroup = new THREE.Group();
sheetGroup.name = 'drawings';
scene.add(sheetGroup);
proj.draw = { mode: 'auto', dist: 6, front: true, lit: true };

function newSheet(layerId, anchor, canvas) {
  return { id: uid(), layerId, anchor, xf: null, canvas: canvas || makeCanvas(), dirty: true, blob: null, mesh: null, tex: null };
}
function cloneSheet(s) {
  const c = makeCanvas(); c.getContext('2d').drawImage(s.canvas, 0, 0);
  const n = newSheet(s.layerId, { ...s.anchor, p: [...s.anchor.p], q: [...s.anchor.q] }, c);
  if (s.xf) n.xf = { p: [...s.xf.p], q: [...s.xf.q], s: [...s.xf.s] };
  return n;
}
function sameView(anchor, cam) {
  return !camDiffers(anchor, cam) && Math.abs((anchor.aspect || proj.W / proj.H) - proj.W / proj.H) < 1e-3;
}
/** How far away a new drawing goes: onto whatever is under the pen, or a fixed distance. */
function depthAt(pt) {
  if (proj.draw.mode === 'fixed' || !pt) return proj.draw.dist;
  const v = new THREE.Vector2((pt.x / proj.W) * 2 - 1, -((pt.y / proj.H) * 2 - 1));
  raycaster.setFromCamera(v, camera);
  const targets = models.filter((m) => m.visible).map((m) => m.root);
  if (ground.visible) targets.push(ground);
  const hit = raycaster.intersectObjects(targets, true).find((x) => x.object.isMesh);
  if (!hit) return proj.draw.dist;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const d = hit.point.clone().sub(camera.position).dot(fwd);
  return Math.max(0.3, Math.min(500, d * 0.995));
}
/** The sheet on this layer that was drawn from the current view (made if needed). */
function sheetForView(frame, layerId, create, pt) {
  const cam = captureCam();
  const locked = isLocked(layerId);
  let s = frame.sheets.find((x) => x.layerId === layerId && (locked || (!x.xf && sameView(x.anchor, cam))));
  // one drawing per layer: from a new angle, the layer's drawing swings round to face the camera
  if (!s && create && proj.draw.one !== false) {
    const mine = frame.sheets.filter((x) => x.layerId === layerId);
    s = mine[mine.length - 1] || null;
    if (s) {
      s.reanchored = { anchor: s.anchor, xf: s.xf || null };
      s.anchor = { ...cam, aspect: proj.W / proj.H, dist: depthAt(pt) };
      s.xf = null;
      if (s.mesh) placeSheet(s);
      s.reanchored.to = s.anchor;
    }
  }
  if (!s && create) {
    s = newSheet(layerId, { ...cam, aspect: proj.W / proj.H, dist: depthAt(pt) });
    frame.sheets.push(s);
  }
  return s || null;
}
const isLocked = (layerId) => !!proj.layers[layerIndex(layerId)]?.lock;
/** Layers locked to the camera frame: the drawing rides along with the camera, filling the frame like a sheet of glass in front of the lens. */
function camLockedXf(s) {
  const d = Math.min(s.anchor.dist || 6, 50);
  const hgt = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  let w = hgt * (proj.W / proj.H), hh = hgt;
  if (s.media) { const ar = s.canvas.width / s.canvas.height; if (ar > w / hh) hh = w / ar; else w = hh * ar; w *= 0.7; hh *= 0.7; }
  return { p: camera.position.clone().addScaledVector(fwd, d).toArray(), q: camera.quaternion.toArray(), s: [w, hh, 1] };
}
function placeSheet(s) {
  const x = isLocked(s.layerId) ? camLockedXf(s) : sheetXf(s), m = s.mesh;
  m.position.fromArray(x.p);
  m.quaternion.fromArray(x.q);
  m.scale.fromArray(x.s);
}
/** Drawings either take the scene's light (sun, night, lamps) or always show their full colors. */
function sheetMaterial(m) {
  const want = proj.draw.lit !== false;
  if (m.userData.lit === want) return;
  const old = m.material, map = old.map;
  m.material = want
    ? new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, fog: false, envMapIntensity: lastEnvK < 0 ? 1 : lastEnvK })
    : new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  old.dispose();
  m.userData.lit = want;
}
function sheetMesh(s) {
  if (!s.mesh) {
    s.tex = new THREE.CanvasTexture(s.canvas);
    s.tex.colorSpace = THREE.SRGBColorSpace;
    s.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: s.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    s.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    s.mesh.userData.sheet = true;
    sheetGroup.add(s.mesh);
    placeSheet(s);
  }
  return s.mesh;
}
/** Shows the sheets for one frame (plus onion-skin neighbours) and hides the rest. */
function syncSheets(idx = proj.current, forExport = false) {
  clouds.material.uniforms.uT.value = idx / Math.max(1, proj.fps);
  for (const m of sheetGroup.children) m.visible = false;
  const show = (f, alpha) => {
    if (!f) return;
    for (const s of f.sheets) {
      const li = layerIndex(s.layerId), l = proj.layers[li];
      if (!l || !l.visible) continue;
      if (!forExport && stroke && stroke.sheet === s) continue; // the live stroke is drawn on top instead
      const m = sheetMesh(s);
      sheetMaterial(m);
      const locked = !!l.lock;
      if (locked || m.userData.locked) placeSheet(s);
      m.userData.locked = locked;
      // drawings show on top of the scene like paint on glass (unless set to hide behind models)
      m.material.depthTest = !(locked || proj.draw.front !== false);
      m.visible = true;
      m.material.opacity = l.opacity * alpha;
      m.renderOrder = 100 + li * 3 + (alpha < 1 ? 0 : 2);
      for (const o of m.children) if (o.userData.selOutline) o.visible = !forExport && alpha === 1;
    }
  };
  if (!forExport && !playing && $('onion').checked) { show(proj.frames[idx - 1], 0.28); show(proj.frames[idx + 1], 0.14); }
  show(proj.frames[idx], 1);
  syncMedia(idx, forExport);
}
function touchSheet(frame, s) {
  s.dirty = true;
  if (s.tex) s.tex.needsUpdate = true;
  frame.thumbDirty = true;
  displayDirty = true;
  saveSoon();
}
/* ---------- picking up drawings and moving them in 3D
   Click a drawing with the Camera tool to select it, or pick a whole layer in the Layers
   panel. A moved drawing keeps its own place in the world (s.xf); drawing again from
   the view it was drawn from then starts a fresh sheet. */

let selectedArt = null; // { sheets, layerId } layerId is set when a whole layer is picked
const artPivot = new THREE.Object3D();
artPivot.name = 'art-handle';
scene.add(artPivot);
let artRel = [], artDragStart = null, artAllFrames = true;

function sheetXf(s) {
  if (s.xf) return { p: [...s.xf.p], q: [...s.xf.q], s: [...s.xf.s] };
  const a = s.anchor;
  const hgt = 2 * a.dist * Math.tan(THREE.MathUtils.degToRad(a.fov) / 2);
  const wid = hgt * (a.aspect || proj.W / proj.H);
  const q = new THREE.Quaternion().fromArray(a.q);
  const p = new THREE.Vector3().fromArray(a.p).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(q), a.dist);
  return { p: p.toArray(), q: q.toArray(), s: [wid, hgt, 1] };
}
const xfMatrix = (x) => new THREE.Matrix4().compose(new THREE.Vector3().fromArray(x.p), new THREE.Quaternion().fromArray(x.q), new THREE.Vector3().fromArray(x.s));
function matrixXf(m) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  m.decompose(p, q, sc);
  return { p: p.toArray(), q: q.toArray(), s: sc.toArray() };
}

/** The part of a sheet that has paint on it, in canvas pixels. */
function contentBox(c) {
  const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 2) {
    const row = y * W;
    for (let x = 0; x < W; x += 2) {
      if (d[(row + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: Math.min(W, x1 + 2), y1: Math.min(H, y1 + 2) };
}
/** True if there is paint near this spot of the sheet (so clicks on empty space go through). */
function paintAt(s, uv) {
  const c = s.canvas, r = Math.max(5, Math.round(c.width / 110));
  const x = Math.round(uv.x * c.width), y = Math.round((1 - uv.y) * c.height);
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), w = Math.min(c.width, x + r) - x0, hh = Math.min(c.height, y + r) - y0;
  if (w <= 0 || hh <= 0) return false;
  const d = c.getContext('2d').getImageData(x0, y0, w, hh).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 16) return true;
  return false;
}

function clearArtOutlines() {
  for (const m of sheetGroup.children) {
    for (const o of [...m.children]) if (o.userData.selOutline) { m.remove(o); o.geometry.dispose(); o.material.dispose(); }
  }
}
function outlineFor(s, b) {
  const W = s.canvas.width, H = s.canvas.height, pad = 8;
  const l = (b.x0 - pad) / W - 0.5, r = (b.x1 + pad) / W - 0.5, t = 0.5 - (b.y0 - pad) / H, bo = 0.5 - (b.y1 + pad) / H;
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(l, t, 0), new THREE.Vector3(r, t, 0), new THREE.Vector3(r, bo, 0), new THREE.Vector3(l, bo, 0)]);
  const line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: '#2fb6ff', transparent: true, opacity: 0.95, depthTest: false, toneMapped: false, fog: false }));
  line.renderOrder = 999;
  line.userData.selOutline = true;
  line.raycast = () => {};
  return line;
}

/** Forgets the drawing selection without redrawing panels (used when something else gets picked). */
function dropArt() {
  if (!selectedArt) return;
  selectedArt = null;
  artDragStart = null;
  clearArtOutlines();
  if (gizmo.object === artPivot) gizmo.detach();
}
function selectArt(sheets, layerId = null, keepSpin = false) {
  clearArtOutlines();
  if (!keepSpin) artSpin = 0;
  const f = curFrame();
  sheets = (sheets || []).filter((s) => s.media ? mediaSheets.get(s.layerId) === s && layerIndex(s.layerId) >= 0 : f && f.sheets.includes(s));
  if (!sheets.length) {
    selectedArt = null;
    reattachGizmo();
    if (activeTab === 'Layers') renderLayersPane();
    return;
  }
  selectedModel = null; selectedCam = null; selectedLight = null;
  selectedArt = { sheets, layerId };
  const c = new THREE.Vector3();
  for (const s of sheets) {
    const m = sheetMesh(s);
    placeSheet(s);
    m.updateMatrixWorld(true);
    const b = contentBox(s.canvas);
    if (b) {
      m.add(outlineFor(s, b));
      c.add(m.localToWorld(new THREE.Vector3(((b.x0 + b.x1) / 2) / s.canvas.width - 0.5, 0.5 - ((b.y0 + b.y1) / 2) / s.canvas.height, 0)));
    } else c.add(m.getWorldPosition(new THREE.Vector3()));
  }
  artPivot.position.copy(c.divideScalar(sheets.length));
  artPivot.quaternion.copy(sheets[0].mesh.quaternion);
  artPivot.scale.set(1, 1, 1);
  artPivot.updateMatrixWorld(true);
  const inv = artPivot.matrixWorld.clone().invert();
  artRel = sheets.map((s) => inv.clone().multiply(s.mesh.matrixWorld));
  if (tool !== 'camera') setTool('camera');
  reattachGizmo();
  if (activeTab === 'Layers') renderLayersPane();
  if (activeTab === 'Scene') renderScenePane();
}
function reselectArt() { if (selectedArt) selectArt(selectedArt.sheets, selectedArt.layerId, true); }

gizmo.addEventListener('mouseDown', () => {
  if (!selectedArt || gizmo.object !== artPivot) return;
  artPivot.updateMatrixWorld(true);
  artDragStart = { xfs: selectedArt.sheets.map((s) => (s.xf ? sheetXf(s) : null)), pivot: artPivot.matrixWorld.clone() };
});
gizmo.addEventListener('objectChange', () => {
  if (!selectedArt || gizmo.object !== artPivot) return;
  followPivot();
});
gizmo.addEventListener('mouseUp', () => commitArtEdit());
/** Remembers where the picked-up art is before a change (gizmo drag, spin, flip). */
function beginArtEdit() {
  if (!selectedArt) return null;
  artPivot.updateMatrixWorld(true);
  return { xfs: selectedArt.sheets.map((s) => (s.xf ? sheetXf(s) : null)), pivot: artPivot.matrixWorld.clone() };
}
/** Moves the picked-up drawings to follow the handle (artPivot). */
function followPivot() {
  if (!selectedArt) return;
  artPivot.updateMatrixWorld(true);
  selectedArt.sheets.forEach((s, i) => { s.xf = matrixXf(artPivot.matrixWorld.clone().multiply(artRel[i])); placeSheet(s); });
  curFrame().thumbDirty = true;
}
/** Finishes a change: one undo step, and for a whole layer the same change on every frame. */
function commitArtEdit(label, reselect = false) {
  if (!artDragStart || !selectedArt) return;
  const sel = selectedArt, start = artDragStart;
  artDragStart = null;
  const sheets = sel.sheets, before = start.xfs, after = sheets.map((s) => s.xf);
  // moving a whole layer can carry the same move to that layer on every other frame
  const others = [];
  if (sel.layerId && artAllFrames && proj.frames.length > 1) {
    artPivot.updateMatrixWorld(true);
    const D = artPivot.matrixWorld.clone().multiply(start.pivot.clone().invert());
    for (const f of proj.frames) {
      if (f === curFrame()) continue;
      for (const s of f.sheets) {
        if (s.layerId !== sel.layerId) continue;
        others.push({ s, f, was: s.xf || null });
        s.xf = matrixXf(D.clone().multiply(xfMatrix(sheetXf(s))));
        if (s.mesh) placeSheet(s);
        f.thumbDirty = true;
      }
    }
  }
  const othersAfter = others.map((o) => o.s.xf);
  const apply = (vals, ovals) => {
    sheets.forEach((s, i) => { s.xf = vals[i]; if (s.mesh) placeSheet(s); });
    others.forEach((o, i) => { o.s.xf = ovals[i]; if (o.s.mesh) placeSheet(o.s); });
    markAllThumbs();
    if (selectedArt) selectArt(selectedArt.sheets, selectedArt.layerId); // spin readout starts over
    saveSoon();
  };
  pushUndo(label || (sel.layerId ? 'move layer art' : 'move drawing'), () => apply(before, others.map((o) => o.was)), () => apply(after, othersAfter));
  markAllThumbs();
  saveSoon();
  if (reselect) reselectArt();
  if (activeTab === 'Layers') renderLayersPane();
}

/* ---------- 2D-style turning and flipping, around the drawing's own middle */
let artSpin = 0; // degrees turned since this art was picked up (shown on the Spin slider)
function artSpinBy(deg) {
  if (!selectedArt) return;
  artDragStart = beginArtEdit();
  artPivot.rotateZ(THREE.MathUtils.degToRad(-deg));
  followPivot();
  artSpin = ((artSpin + deg + 540) % 360) - 180;
  commitArtEdit('turn drawing');
}
function artFlip(axis) {
  if (!selectedArt) return;
  artDragStart = beginArtEdit();
  if (axis === 'x') artPivot.scale.x *= -1; else artPivot.scale.y *= -1;
  followPivot();
  commitArtEdit('flip drawing');
}
function spinSlider() {
  let base = null;
  const field = slider('Spin', Math.round(artSpin), -180, 180, 1, (v) => {
    if (!selectedArt) return;
    if (!base) { artDragStart = beginArtEdit(); base = { q: artPivot.quaternion.clone(), from: artSpin }; }
    artPivot.quaternion.copy(base.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-(v - base.from))));
    artSpin = v;
    followPivot();
  }, (v) => `${Math.round(v)}°`);
  field.querySelector('input').addEventListener('change', () => { if (base) { base = null; commitArtEdit('turn drawing'); } });
  return field;
}

function artPutBack() {
  const sel = selectedArt; if (!sel) return;
  const sheets = sel.sheets, was = sheets.map((s) => s.xf || null);
  const go = (vals) => { sheets.forEach((s, i) => { s.xf = vals[i]; if (s.mesh) placeSheet(s); }); markAllThumbs(); reselectArt(); saveSoon(); };
  const home = sheets.map((s) => (s.media ? s.homeXf || null : null));
  go(home);
  pushUndo('put back', () => go(was), () => go(home));
  toast('Back where you drew it');
}
function artToLayer(layerId) {
  const sel = selectedArt; if (!sel) return;
  if (isLocked(layerId)) { toast('That layer is locked to the camera frame'); renderLayersPane(); return; }
  if (sel.sheets.some((s) => s.media) || proj.layers[layerIndex(layerId)]?.media) { toast('Imports keep their own layer'); renderLayersPane(); return; }
  const sheets = sel.sheets, was = sheets.map((s) => s.layerId);
  const go = (ids) => { sheets.forEach((s, i) => { s.layerId = ids[i]; }); curFrame().thumbDirty = true; displayDirty = true; reselectArt(); if (activeTab === 'Layers') renderLayersPane(); saveSoon(); };
  go(sheets.map(() => layerId));
  pushUndo('change layer', () => go(was), () => go(sheets.map(() => layerId)));
  const l = proj.layers[layerIndex(layerId)];
  toast(`Moved to ${l ? l.name : 'layer'}`);
}
function artDelete() {
  const sel = selectedArt; if (!sel) return;
  if (sel.sheets[0].media) { const l = proj.layers[layerIndex(sel.sheets[0].layerId)]; dropArt(); if (l) deleteLayer(l); return; }
  const f = curFrame(), gone = sel.sheets;
  const drop = () => { f.sheets = f.sheets.filter((s) => !gone.includes(s)); f.thumbDirty = true; dropArt(); if (activeTab === 'Layers') renderLayersPane(); saveSoon(); };
  drop();
  pushUndo('delete drawing', () => { f.sheets.push(...gone); for (const s of gone) s.dirty = true; f.thumbDirty = true; saveSoon(); }, drop);
  toast(gone.length > 1 ? 'Drawings deleted' : 'Drawing deleted');
}
function pickLayerArt(l) {
  if (l.media?.kind === 'audio') { toast(`${l.name} is a sound, so it has nothing to move`); return; }
  if (l.lock) { toast(`${l.name} is locked to the camera frame. Unlock it to move it in 3D.`); return; }
  const f = curFrame();
  const ss = l.media ? [mediaSheets.get(l.id)].filter(Boolean) : f.sheets.filter((s) => s.layerId === l.id);
  if (!ss.length) { toast(`Nothing on ${l.name} in this frame`); return; }
  selectArt(ss, l.id);
  toast(`Drag the handles to move ${l.name}`);
}

function artSection() {
  const sel = selectedArt;
  if (!sel) return null;
  const l = proj.layers[layerIndex(sel.layerId || sel.sheets[0].layerId)];
  const modeBtn = (mode, label) => {
    const b = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(gizmo.mode === mode) }, label);
    b.addEventListener('click', () => { gizmo.setMode(mode); renderLayersPane(); });
    return b;
  };
  const sect = h('div', { class: 'sect art-sel' },
    h('h3', {}, sel.layerId ? `Moving layer: ${l?.name || ''}` : `Drawing on ${l?.name || 'layer'}`),
    h('div', { class: 'row' }, modeBtn('translate', 'Move'), modeBtn('rotate', 'Turn'), modeBtn('scale', 'Size')),
    h('p', { class: 'note', style: 'margin:8px 0' }, 'Drag the handles in the picture to move it around the 3D scene. Click empty space to let go.'),
    spinSlider(),
    h('div', { class: 'row spin-row' },
      h('button', { type: 'button', class: 'btn', title: 'Turn left 15°', onclick: () => artSpinBy(-15) }, '⟲ 15°'),
      h('button', { type: 'button', class: 'btn', title: 'Turn right 15°', onclick: () => artSpinBy(15) }, '⟳ 15°'),
      h('button', { type: 'button', class: 'btn', title: 'Turn a quarter', onclick: () => artSpinBy(90) }, '⟳ 90°'),
      h('button', { type: 'button', class: 'btn', title: 'Mirror left to right', onclick: () => artFlip('x') }, '⇆ Flip'),
      h('button', { type: 'button', class: 'btn', title: 'Mirror top to bottom', onclick: () => artFlip('y') }, '⇅ Flip')));
  const isMedia = sel.sheets[0].media;
  if (isMedia) {
    // imports keep their own layer
  } else if (sel.layerId) {
    if (proj.frames.length > 1) sect.append(check('Move this layer on every frame', artAllFrames, (v) => { artAllFrames = v; }));
  } else {
    const pick = h('select', { 'aria-label': 'Layer for this drawing' });
    [...proj.layers].reverse().forEach((ly) => { const o = h('option', { value: ly.id }, ly.name); if (ly.id === sel.sheets[0].layerId) o.selected = true; pick.append(o); });
    pick.addEventListener('change', () => artToLayer(pick.value));
    sect.append(h('div', { class: 'row' }, h('span', { class: 'note' }, 'Layer'), pick),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn', onclick: () => l && pickLayerArt(l) }, 'Pick whole layer')));
  }
  sect.append(h('div', { class: 'row', style: 'margin-top:10px' },
    sel.sheets.some((s) => s.xf) ? h('button', { type: 'button', class: 'btn', onclick: artPutBack }, 'Put back') : null,
    h('button', { type: 'button', class: 'btn', onclick: artDelete }, 'Delete'),
    h('button', { type: 'button', class: 'btn primary', onclick: () => selectArt(null) }, 'Done')));
  if (sel.sheets.some((s) => s.xf)) sect.append(h('p', { class: 'note', style: 'margin-top:8px' }, 'Moved drawings stay where you put them. Drawing on this layer again from another angle brings the drawing round to face you.'));
  return sect;
}

/* ---------- imported photos and videos
   Each import gets its own layer ("Import 1", "Import 2"…) holding one picture that sits in
   the 3D world just like a drawing. It shows on every frame; a video plays along with the
   frames, starting at the frame it was imported on. */

const mediaSheets = new Map(); // layerId -> sheet
proj.media = [];               // { id, kind, name, blob, el, canvas, dur, shownT, seeking, wantT }
proj.importCount = 0;

function fitDraw(ctx, src, sw, sh) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!sw || !sh) return;
  const k = Math.min(W / sw, H / sh), w = sw * k, hh = sh * k;
  ctx.drawImage(src, (W - w) / 2, (H - hh) / 2, w, hh);
}
/** Gives the picture's canvas the photo's own shape (long side at most `max` pixels). */
function shapeCanvas(c, sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw || 1, sh || 1));
  c.width = Math.max(2, Math.round((sw || proj.W) * k)); c.height = Math.max(2, Math.round((sh || proj.H) * k));
}
async function makeMedia(blob, kind, name, id = uid()) {
  const url = URL.createObjectURL(blob);
  const m = { id, kind, name, blob, url, canvas: makeCanvas(), dur: 0, shownT: -1, seeking: false, wantT: null, waiters: [] };
  if (kind === 'audio') {
    const buf = await decodeSound(m);
    if (!buf) throw new Error('no sound');
    m.dur = buf.duration;
    return m;
  }
  if (kind === 'image') {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    m.el = img;
    shapeCanvas(m.canvas, img.naturalWidth, img.naturalHeight, 1600);
    fitDraw(m.canvas.getContext('2d'), img, img.naturalWidth, img.naturalHeight);
  } else {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    // phones only decode a picture once the video is in the page and has been nudged to play
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.append(v);
    v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(res, 8000); try { v.load(); } catch { /* ignore */ } });
    try { await v.play(); v.pause(); } catch { /* fine: seeking still works */ }
    try { v.currentTime = 0; } catch { /* ignore */ }
    shapeCanvas(m.canvas, v.videoWidth, v.videoHeight, 1280);
    decodeSound(m); // its sound track, if the browser can read it
    m.el = v;
    m.dur = isFinite(v.duration) ? v.duration : 0;
    v.addEventListener('seeked', () => {
      fitDraw(m.canvas.getContext('2d'), v, v.videoWidth, v.videoHeight);
      m.shownT = v.currentTime;
      m.seeking = false;
      const s = [...mediaSheets.values()].find((x) => x.mediaId === m.id);
      if (s?.tex) s.tex.needsUpdate = true;
      if (m.wantT != null && Math.abs(m.wantT - m.shownT) > 0.01) { const t = m.wantT; m.wantT = null; seekMedia(m, t); return; }
      m.wantT = null;
      const w = m.waiters; m.waiters = []; for (const r of w) r();
    });
    // first picture straight away (no seek needed for time 0)
    fitDraw(m.canvas.getContext('2d'), v, v.videoWidth, v.videoHeight);
    m.shownT = v.currentTime || 0;
  }
  return m;
}
function seekMedia(m, t) {
  if (m.kind !== 'video' || !m.el) return;
  t = Math.max(0, Math.min(t, Math.max(0, m.dur - 0.001)));
  if (Math.abs(t - m.shownT) < 0.005 && !m.seeking) return;
  if (m.seeking) { m.wantT = t; return; }
  m.seeking = true;
  m.el.currentTime = t;
}
/** Resolves once every video shows the picture for frame i (used by export). */
function prepMediaFor(i) {
  const waits = [];
  for (const [lid, s] of mediaSheets) {
    const l = proj.layers[layerIndex(lid)], m = mediaById(s.mediaId);
    if (!l || !m || m.kind !== 'video') continue;
    const t = (i - (l.media.start || 0)) / proj.fps;
    if (t < 0 || t > m.dur) continue;
    const want = Math.max(0, Math.min(t, Math.max(0, m.dur - 0.001)));
    if (Math.abs(want - m.shownT) < 0.005 && !m.seeking) continue;
    waits.push(new Promise((r) => { m.waiters.push(r); setTimeout(r, 1500); }));
    seekMedia(m, want);
  }
  return Promise.all(waits);
}
const mediaById = (id) => proj.media.find((m) => m.id === id);

/** Shows the imported pictures for frame idx (called from syncSheets). */
function syncMedia(idx, forExport) {
  for (const [lid, s] of mediaSheets) {
    const li = layerIndex(lid), l = proj.layers[li], m = mediaById(s.mediaId);
    if (!l || !l.visible || !m) continue;
    if (m.kind === 'video') {
      const t = (idx - (l.media.start || 0)) / proj.fps;
      if (t < 0 || t > m.dur + 0.5 / proj.fps) continue; // before it starts or after it ends
      seekMedia(m, t);
    }
    const mesh = sheetMesh(s);
    sheetMaterial(mesh);
    const locked = !!l.lock;
    if (locked || mesh.userData.locked) placeSheet(s);
    mesh.userData.locked = locked;
    mesh.material.depthTest = !(locked || proj.draw.front !== false);
    mesh.visible = true;
    mesh.material.opacity = l.opacity;
    mesh.renderOrder = 100 + li * 3 + 2;
    for (const o of mesh.children) if (o.userData.selOutline) o.visible = !forExport;
  }
}

function mediaKind(file) {
  const x = (file.name.split('.').pop() || '').toLowerCase();
  if (['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'aif', 'aiff', 'caf'].includes(x)) return 'audio';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp'].includes(x)) return 'image';
  if (['mp4', 'mov', 'm4v', 'webm', 'ogv', '3gp'].includes(x)) return 'video';
  return null;
}
/** Where a new import goes: a picture card standing in front of the view, about half the frame tall. */
function mediaCardXf(a, c, n = 0) {
  const fh = 2 * a.dist * Math.tan(THREE.MathUtils.degToRad(a.fov) / 2), fw = fh * (a.aspect || proj.W / proj.H);
  const ar = c.width / c.height;
  let hh = fh * 0.42, ww = hh * ar;
  if (ww > fw * 0.31) { ww = fw * 0.31; hh = ww / ar; }
  const q = new THREE.Quaternion().fromArray(a.q);
  const p = new THREE.Vector3().fromArray(a.p).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(q), a.dist);
  // fan new imports out so they don't land exactly on top of each other
  const slots = [[0, 0], [-0.33, 0], [0.33, 0], [0, 0.3], [-0.33, 0.3], [0.33, 0.3]];
  const [sx, sy] = slots[n % slots.length];
  p.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), sx * fw).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), sy * fh);
  if (n >= slots.length) p.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(q), 0.5 * Math.floor(n / slots.length));
  return { p: p.toArray(), q: q.toArray(), s: [ww, hh, 1] };
}
async function importMedia(file) {
  const kind = mediaKind(file);
  if (!kind) { toast('Pick a photo, video or sound file'); return; }
  let m;
  try { m = await makeMedia(file, kind, file.name); }
  catch { toast(kind === 'audio' ? 'That sound file could not be read' : `That ${kind === 'video' ? 'video' : 'photo'} could not be opened`); return; }
  if (kind === 'video' && !m.el.videoWidth) {
    toast(/\.mov$/i.test(file.name) ? 'This MOV uses a format this browser can’t play (often iPhone HEVC). Try Safari, or save it as MP4.' : 'That video could not be played in this browser');
    return;
  }
  if (kind === 'audio') {
    proj.media.push(m);
    proj.importCount = (proj.importCount || 0) + 1;
    const l = newLayer(`Import ${proj.importCount}`);
    l.media = { id: m.id, kind, start: proj.current, vol: 1 };
    const at = layerIndex(proj.activeLayer) + 1;
    const add = () => { proj.layers.splice(at, 0, l); proj.activeLayer = l.id; layersChanged(); };
    add();
    pushUndo('import', () => { proj.layers.splice(proj.layers.indexOf(l), 1); proj.activeLayer = proj.layers[Math.max(0, at - 1)].id; layersChanged(); }, add);
    openPanel('Layers');
    toast(`${l.name}: sound plays from frame ${proj.current + 1} (${m.dur.toFixed(1)} s)`);
    return;
  }
  proj.media.push(m);
  proj.importCount = (proj.importCount || 0) + 1;
  const l = newLayer(`Import ${proj.importCount}`);
  l.media = { id: m.id, kind, start: proj.current };
  const s = newSheet(l.id, { ...captureCam(), aspect: proj.W / proj.H, dist: depthAt({ x: proj.W / 2, y: proj.H / 2 }) }, m.canvas);
  s.mediaId = m.id;
  s.media = true;
  // not too close: if something is right in front of the lens, stand the picture a little way off
  s.anchor.dist = Math.max(3, Math.min(40, s.anchor.dist));
  s.xf = s.homeXf = mediaCardXf(s.anchor, m.canvas, [...mediaSheets.values()].length);
  const at = layerIndex(proj.activeLayer) + 1;
  const add = () => { proj.layers.splice(at, 0, l); mediaSheets.set(l.id, s); proj.activeLayer = l.id; markAllThumbs(); layersChanged(); };
  add();
  pushUndo('import', () => { proj.layers.splice(proj.layers.indexOf(l), 1); mediaSheets.delete(l.id); if (selectedArt?.sheets.includes(s)) dropArt(); proj.activeLayer = proj.layers[Math.max(0, at - 1)].id; markAllThumbs(); layersChanged(); }, add);
  openPanel('Layers');
  toast(kind === 'video' ? `${l.name}: video plays from frame ${proj.current + 1}` : `${l.name} added`);
}
/** A button that opens the phone's photo library / the computer's files. */
function importButton() {
  const input = h('input', { type: 'file', multiple: true, 'aria-label': 'Import photos or videos from this device' });
  input.setAttribute('accept', 'image/*,video/*,audio/*,.png,.jpg,.jpeg,.heic,.webp,.gif,.mp4,.mov,.m4v,.webm,.wav,.mp3,.m4a,.aac,.ogg,.flac');
  input.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%';
  input.addEventListener('change', async () => { const fs = [...input.files]; input.value = ''; for (const f of fs) await importMedia(f); });
  return h('label', { class: 'btn primary', style: 'position:relative;overflow:hidden', title: 'Pick photos or videos from your phone or computer' }, '+ Photo / video / sound', input);
}
function mediaSection(l) {
  const m = mediaById(l.media.id);
  const kindName = { video: 'video', audio: 'sound', image: 'photo' }[l.media.kind] || 'import';
  const sect = h('div', { class: 'sect' }, h('h3', {}, `${l.name} · ${kindName}`));
  if (m?.name) sect.append(h('p', { class: 'note', style: 'margin-top:-6px' }, m.name));
  if (l.media.kind === 'audio') {
    sect.append(slider('Starts on frame', (l.media.start || 0) + 1, 1, Math.max(1, proj.frames.length), 1, (v) => { l.media.start = v - 1; saveSoon(); }));
    sect.append(slider('Volume', l.media.vol ?? 1, 0, 2, 0.05, (v) => { l.media.vol = v; saveSoon(); }, (v) => Math.round(v * 100) + '%'));
    if (m?.dur) sect.append(h('p', { class: 'note' }, `${m.dur.toFixed(1)} s long, about ${Math.round(m.dur * proj.fps)} frames at ${proj.fps} fps. Press Play to hear it with your animation. The eye button mutes it. It’s included when you export a video.`));
    const tryIt = h('button', { type: 'button', class: 'btn', onclick: () => { stopSounds(); startSounds(Math.max(proj.current, l.media.start || 0)); setTimeout(stopSounds, 3000); } }, 'Listen (3 s)');
    sect.append(h('div', { class: 'row', style: 'margin-top:6px' }, tryIt));
    return sect;
  }
  if (l.media.kind === 'video' && m?.buffer) {
    sect.append(check('Play the video’s sound', !l.media.muted, (v) => { l.media.muted = !v; saveSoon(); }));
    sect.append(slider('Volume', l.media.vol ?? 1, 0, 2, 0.05, (v) => { l.media.vol = v; saveSoon(); }, (v) => Math.round(v * 100) + '%'));
  }
  if (l.media.kind === 'video' && proj.frames.length > 1) {
    sect.append(slider('Starts on frame', (l.media.start || 0) + 1, 1, proj.frames.length, 1, (v) => { l.media.start = v - 1; markAllThumbs(); saveSoon(); }));
    if (m?.dur) sect.append(h('p', { class: 'note' }, `${m.dur.toFixed(1)} s long, about ${Math.round(m.dur * proj.fps)} frames at ${proj.fps} fps.`));
  }
  const ms = mediaSheets.get(l.id);
  sect.append(h('div', { class: 'row', style: 'margin-top:6px' },
    h('button', { type: 'button', class: 'btn', onclick: () => pickLayerArt(l) }, 'Move in 3D'),
    ms ? h('button', { type: 'button', class: 'btn', onclick: () => { selectArt([ms], l.id); artPutBack(); } }, 'Put back') : null));
  sect.append(h('p', { class: 'note', style: 'margin-top:8px' }, 'Imports sit in the 3D world like drawings and show on every frame. Add a new layer to draw over them.'));
  return sect;
}

/* ---------- sound: WAV/MP3/etc. imports and the sound inside imported videos.
   Sounds play along with the frames (from their start frame) and go into exported videos. */
let actx = null;
function audioCtx() {
  if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { try { actx = new AC(); } catch { actx = null; } } }
  return actx;
}
async function decodeSound(m) {
  if (m.buffer !== undefined) return m.buffer;
  m.buffer = null;
  try {
    const ac = audioCtx(); if (!ac) return null;
    const ab = await m.blob.arrayBuffer();
    m.buffer = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  } catch { m.buffer = null; }
  return m.buffer;
}
let soundSources = [];
function stopSounds() { for (const s of soundSources) { try { s.stop(); } catch { /* already stopped */ } } soundSources = []; }
/** Starts every sound as it should be heard from frame `from` onward. */
function startSounds(from, dest = null) {
  const ac = audioCtx(); if (!ac) return;
  try { ac.resume?.(); } catch { /* ignore */ }
  const t0 = ac.currentTime + 0.03;
  for (const l of proj.layers) {
    if (!l.media || !l.visible || l.media.muted) continue;
    const m = mediaById(l.media.id);
    if (!m || !m.buffer) continue;
    const off = (from - (l.media.start || 0)) / proj.fps;
    if (off >= m.buffer.duration) continue;
    const src = ac.createBufferSource(); src.buffer = m.buffer;
    const g = ac.createGain(); g.gain.value = l.media.vol ?? 1;
    src.connect(g); g.connect(dest || ac.destination);
    try { if (off >= 0) src.start(t0, off); else src.start(t0 - off); soundSources.push(src); } catch { /* ignore */ }
  }
}
const hasSound = () => proj.layers.some((l) => l.media && l.visible && !l.media.muted && mediaById(l.media.id)?.buffer);

function frameHasArt(f, layerId) { return f.sheets.some((s) => !layerId || s.layerId === layerId); }

function goTo(i, moveCamera = true) {
  if (!proj.frames.length) return;
  const to = Math.max(0, Math.min(proj.frames.length - 1, i));
  if (to !== proj.current && selectedArt) { dropArt(); if (activeTab === 'Layers') renderLayersPane(); }
  proj.current = to;
  if (moveCamera) { applyCam(curFrame().cam); if (!playing && !exporting) hopFromFrame(curFrame()); }
  setModelTimes(proj.current);
  displayDirty = true;
  updateFrameUI();
}

function addFrameHere() {
  const f = newFrame(captureCam(), hopped?.id || null);
  const at = proj.current + 1;
  proj.frames.splice(at, 0, f);
  pushUndo('add frame', () => { proj.frames.splice(proj.frames.indexOf(f), 1); goTo(Math.min(at - 1, proj.frames.length - 1)); rebuildStrip(); },
    () => { proj.frames.splice(at, 0, f); goTo(at); rebuildStrip(); });
  rebuildStrip();
  goTo(at, false);
  saveSoon();
  scrollStripToCurrent();
  toast(`Frame ${at + 1} added`);
}

function duplicateFrame() {
  const src = curFrame();
  const f = newFrame({ ...src.cam, p: [...src.cam.p], q: [...src.cam.q] }, src.camId);
  f.sheets = src.sheets.map(cloneSheet);
  const at = proj.current + 1;
  proj.frames.splice(at, 0, f);
  pushUndo('duplicate', () => { proj.frames.splice(proj.frames.indexOf(f), 1); goTo(at - 1); rebuildStrip(); },
    () => { proj.frames.splice(at, 0, f); goTo(at); rebuildStrip(); });
  rebuildStrip(); goTo(at); saveSoon(); scrollStripToCurrent();
}

function deleteFrame() {
  if (proj.frames.length === 1) {
    toast('A project needs at least one frame');
    return;
  }
  const i = proj.current, f = curFrame();
  proj.frames.splice(i, 1);
  pushUndo('delete frame', () => { proj.frames.splice(i, 0, f); goTo(i); rebuildStrip(); },
    () => { proj.frames.splice(proj.frames.indexOf(f), 1); goTo(Math.min(i, proj.frames.length - 1)); rebuildStrip(); });
  rebuildStrip(); goTo(Math.min(i, proj.frames.length - 1)); saveSoon();
}

function moveFrame(dir) {
  const i = proj.current, j = i + dir;
  if (j < 0 || j >= proj.frames.length) return;
  const swap = () => { const t = proj.frames[i]; proj.frames[i] = proj.frames[j]; proj.frames[j] = t; };
  swap();
  pushUndo('move frame', () => { swap(); goTo(i); rebuildStrip(); }, () => { swap(); goTo(j); rebuildStrip(); });
  rebuildStrip(); goTo(j, false); saveSoon();
}

function addInbetweens(n) {
  const i = proj.current;
  if (i >= proj.frames.length - 1) { toast('Pick a frame that has a frame after it'); return; }
  const a = proj.frames[i].cam, b = proj.frames[i + 1].cam;
  const added = [];
  const tweenCam = proj.frames[i].camId === proj.frames[i + 1].camId ? proj.frames[i].camId : null;
  for (let k = 1; k <= n; k++) added.push(newFrame(lerpCam(a, b, k / (n + 1)), tweenCam));
  proj.frames.splice(i + 1, 0, ...added);
  pushUndo('in-betweens', () => { proj.frames.splice(i + 1, n); goTo(i); rebuildStrip(); },
    () => { proj.frames.splice(i + 1, 0, ...added); goTo(i + 1); rebuildStrip(); });
  rebuildStrip(); goTo(i + 1); saveSoon();
  toast(`${n} in-between frame${n > 1 ? 's' : ''} added`);
}

function updateFrameCamera() {
  const f = curFrame();
  const before = f.cam, after = captureCam(), idBefore = f.camId, idAfter = hopped?.id || null;
  f.cam = after; f.camId = idAfter; f.thumbDirty = true;
  pushUndo('update camera', () => { f.cam = before; f.camId = idBefore; f.thumbDirty = true; goTo(proj.frames.indexOf(f)); }, () => { f.cam = after; f.camId = idAfter; f.thumbDirty = true; goTo(proj.frames.indexOf(f)); });
  saveSoon();
  toast('Frame camera updated');
}

function markAllThumbs() { for (const f of proj.frames) f.thumbDirty = true; }

/* ---------- layers */

function addLayer() {
  const l = newLayer(`Layer ${proj.layers.length + 1}`);
  const at = layerIndex(proj.activeLayer) + 1;
  proj.layers.splice(at, 0, l);
  proj.activeLayer = l.id;
  pushUndo('add layer', () => { proj.layers.splice(proj.layers.indexOf(l), 1); proj.activeLayer = proj.layers[Math.max(0, at - 1)].id; layersChanged(); },
    () => { proj.layers.splice(at, 0, l); proj.activeLayer = l.id; layersChanged(); });
  layersChanged();
}

async function deleteLayer(l) {
  if (proj.layers.length === 1) { toast('Keep at least one layer'); return; }
  const hasArt = proj.frames.some((f) => frameHasArt(f, l.id));
  if (hasArt && !(await confirmDlg('Delete layer?', `“${l.name}” and its drawings on every frame will be removed. You can undo this.`, 'Delete'))) return;
  const i = proj.layers.indexOf(l);
  const kept = proj.frames.map((f) => [f, f.sheets.filter((s) => s.layerId === l.id)]);
  const removeIt = () => { proj.layers.splice(proj.layers.indexOf(l), 1); for (const f of proj.frames) { f.sheets = f.sheets.filter((s) => s.layerId !== l.id); f.thumbDirty = true; } if (proj.activeLayer === l.id) proj.activeLayer = proj.layers[Math.max(0, i - 1)].id; layersChanged(); };
  removeIt();
  pushUndo('delete layer', () => { proj.layers.splice(i, 0, l); for (const [f, ss] of kept) { f.sheets.push(...ss); for (const s of ss) s.dirty = true; f.thumbDirty = true; } proj.activeLayer = l.id; layersChanged(); }, removeIt);
}

function moveLayer(l, dir) {
  const i = proj.layers.indexOf(l), j = i + dir;
  if (j < 0 || j >= proj.layers.length) return;
  proj.layers.splice(i, 1); proj.layers.splice(j, 0, l);
  pushUndo('move layer', () => { proj.layers.splice(j, 1); proj.layers.splice(i, 0, l); layersChanged(); }, () => { proj.layers.splice(i, 1); proj.layers.splice(j, 0, l); layersChanged(); });
  layersChanged();
}

function layersChanged() {
  markAllThumbs();
  displayDirty = true;
  renderLayersPane();
  saveSoon();
}

/** If drawing just swung this sheet round to face the camera, returns how to undo / redo that. */
function takeReanchor(s) {
  const r = s.reanchored;
  delete s.reanchored;
  if (!r) return { undo() {}, redo() {} };
  const set = (a, xf) => { s.anchor = a; s.xf = xf; if (s.mesh) placeSheet(s); };
  return { undo: () => set(r.anchor, r.xf), redo: () => set(r.to, null) };
}
function pixelEdit(label, frame, layerId, fn, pt) {
  const s = sheetForView(frame, layerId, true, pt);
  const re = takeReanchor(s);
  const c = s.canvas, ctx = c.getContext('2d');
  const before = ctx.getImageData(0, 0, c.width, c.height);
  fn(ctx, c);
  const after = ctx.getImageData(0, 0, c.width, c.height);
  pushUndo(label, () => { ctx.putImageData(before, 0, 0); re.undo(); touchSheet(frame, s); }, () => { re.redo(); ctx.putImageData(after, 0, 0); touchSheet(frame, s); });
  touchSheet(frame, s);
}

function clearLayerOnFrame() {
  const f = curFrame(), id = proj.activeLayer;
  const removed = f.sheets.filter((s) => s.layerId === id);
  if (!removed.length) return;
  const drop = () => { f.sheets = f.sheets.filter((s) => !removed.includes(s)); f.thumbDirty = true; saveSoon(); };
  drop();
  pushUndo('clear', () => { f.sheets.push(...removed); for (const s of removed) s.dirty = true; f.thumbDirty = true; saveSoon(); }, drop);
}
function copyFromPrevious() {
  if (proj.current === 0) { toast('This is the first frame'); return; }
  const src = proj.frames[proj.current - 1].sheets.filter((s) => s.layerId === proj.activeLayer);
  if (!src.length) { toast('Nothing on this layer in the previous frame'); return; }
  const f = curFrame();
  const copies = src.map(cloneSheet);
  const add = () => { f.sheets.push(...copies); f.thumbDirty = true; saveSoon(); };
  add();
  pushUndo('copy previous', () => { f.sheets = f.sheets.filter((s) => !copies.includes(s)); f.thumbDirty = true; saveSoon(); }, add);
}

/* =================================================================== undo */

const undoStack = [], redoStack = [];
function pushUndo(label, undo, redo) {
  undoStack.push({ label, undo, redo });
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function doUndo() { const a = undoStack.pop(); if (!a) return; a.undo(); redoStack.push(a); updateUndoButtons(); saveSoon(); toast('Undid ' + a.label); }
function doRedo() { const a = redoStack.pop(); if (!a) return; a.redo(); undoStack.push(a); updateUndoButtons(); saveSoon(); }
function updateUndoButtons() { $('undoBtn').disabled = !undoStack.length; $('redoBtn').disabled = !redoStack.length; }

/* =================================================================== drawing */

const drawCanvas = $('draw');
let displayCtx = null;
let displayDirty = true;
let tool = 'brush';
const TOOLS = [
  { id: 'camera', label: 'Camera (move around; click a drawing or model to move it)', key: '1', icon: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>' },
  { id: 'brush', label: 'Brush', key: '2', icon: '<path d="M18 3l3 3-9.5 9.5-3-3z"/><path d="M8.5 12.5C6 12.5 4 14 4 17c0 1.5-1 2.5-2 3 3 1 7 0 8-3 .4-1.2 0-2.5-1.5-4.5z"/>' },
  { id: 'pencil', label: 'Pencil', key: '3', icon: '<path d="M15 4l5 5L9 20H4v-5z"/><path d="M13 6l5 5"/>' },
  { id: 'marker', label: 'Marker', key: '4', icon: '<path d="M14 3l7 7-8 8H8l-1-1v-5z"/><path d="M7 17l-3 4h5"/>' },
  { id: 'airbrush', label: 'Airbrush', key: '5', icon: '<path d="M3 12h9l3-3h4v6h-4l-3-3"/><circle cx="19" cy="5" r="1"/><circle cx="21" cy="8" r="0.6"/><circle cx="17" cy="3" r="0.6"/>' },
  { id: 'eraser', label: 'Eraser', key: '6', icon: '<path d="M16 4l5 5-10 10H6l-3-3z"/><path d="M11 9l5 5M6 19h14"/>' },
  { id: 'fill', label: 'Fill', key: '7', icon: '<path d="M5 11l7-7 7 7-7 7z"/><path d="M19 15c0 2 1.5 3 1.5 4.5a1.5 1.5 0 0 1-3 0C17.5 18 19 17 19 15z"/>' },
  { id: 'picker', label: 'Eyedropper', key: '8', icon: '<path d="M14 4l6 6M17 7l-9 9-4 1 1-4 9-9"/>' },
];
const toolCfg = {
  brush: { size: 8, opacity: 1 },
  pencil: { size: 3, opacity: 0.9 },
  marker: { size: 22, opacity: 0.55 },
  airbrush: { size: 60, opacity: 0.5 },
  eraser: { size: 24, opacity: 1 },
  fill: { size: 0, opacity: 1 },
  picker: { size: 0, opacity: 1 },
};
const brush = { color: '#1d1d24', smoothing: 0.45, pressureSize: true, pressureOpacity: false, tolerance: 40, sampleAll: true, recent: [] };
const PALETTE = ['#1d1d24', '#ffffff', '#ff5d8f', '#ff8a3d', '#ffd23f', '#7bd66c', '#44d3c4', '#4c8dff', '#8a63ff', '#c27c4e', '#7a7f8c', '#f4c7a7'];

const strokeCanvas = document.createElement('canvas');
const previewCanvas = document.createElement('canvas');
const beforeCanvas = document.createElement('canvas');
beforeCanvas.getContext('2d', { willReadFrequently: true });
let stroke = null;

function sizeWorkCanvases() {
  for (const c of [drawCanvas, strokeCanvas, previewCanvas, beforeCanvas]) { c.width = proj.W; c.height = proj.H; }
  displayCtx = drawCanvas.getContext('2d');
  displayDirty = true;
}

function toCanvasXY(e) {
  const r = drawCanvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * proj.W, y: ((e.clientY - r.top) / r.height) * proj.H };
}
function pressureOf(e) { return e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1; }

/* ---------- brush library glue */

const BRUSH_TOOLS = ['brush', 'pencil', 'marker', 'airbrush'];
const toolBrush = { brush: 'basic', pencil: 'pencil-hb', marker: 'marker-chisel', airbrush: 'air-soft' };
const brushSettings = JSON.parse(JSON.stringify(BRUSH_DEFAULTS)); // per-brush size & opacity
let brushCat = 'All', eraserSoft = false;

function activeBrush() {
  if (tool === 'eraser') {
    return { ...BRUSH_BY_ID.basic, id: 'eraser', hardness: eraserSoft ? 0.25 : 1, flow: eraserSoft ? 0.4 : 1, spacing: 0.1, blend: 'destination-out' };
  }
  const base = BRUSH_BY_ID[toolBrush[tool]] || BRUSH_BY_ID.basic;
  const ov = settingsFor(base.id).ov;
  return ov ? { ...base, ...ov } : base;
}
/** Size, opacity and any edited settings ("ov") for one brush. */
function settingsFor(id) {
  if (!brushSettings[id]) brushSettings[id] = { ...(BRUSH_DEFAULTS[id] || { size: 10, opacity: 1 }) };
  return brushSettings[id];
}
function activeSize() { return tool === 'eraser' ? toolCfg.eraser.size : settingsFor(activeBrush().id).size; }
function activeOpacity() { return tool === 'eraser' ? toolCfg.eraser.opacity : settingsFor(activeBrush().id).opacity; }
function setActiveSize(v) { if (tool === 'eraser') toolCfg.eraser.size = v; else if (BRUSH_TOOLS.includes(tool)) settingsFor(activeBrush().id).size = v; }

/* ---------- rulers and saved brushes */
const ruler = { line: false, mirror: false };
function loadMyBrushes() {
  for (const b of recall('myBrushes', [])) { try { registerBrush(b); } catch { /* skip */ } }
}
function saveMyBrushes() {
  store('myBrushes', BRUSHES.filter((b) => b.cat === 'My brushes'));
}
function activeBlend() { return tool === 'eraser' ? 'destination-out' : activeBrush().blend; }

function newEngines(s) {
  const sctx = strokeCanvas.getContext('2d');
  const opts = { size: activeSize(), pressureSize: brush.pressureSize, pressureOpacity: brush.pressureOpacity, erase: tool === 'eraser', sample: s.sample };
  const b = activeBrush();
  s.engs = [beginStroke(sctx, b, brush.color, opts)];
  if (s.mirror) s.engs.push(beginStroke(sctx, b, brush.color, opts));
}
function feed(s, x, y, p, t) {
  strokePoint(s.engs[0], x, y, p, t);
  if (s.engs[1]) strokePoint(s.engs[1], proj.W - x, y, p, t);
}
function strokeTo(pt) {
  const s = stroke;
  s.last = pt;
  if (s.straight) {
    // straight-line ruler: redraw a clean line from where the stroke started
    strokeCanvas.getContext('2d').clearRect(0, 0, proj.W, proj.H);
    newEngines(s);
    const d = Math.hypot(pt.x - s.x0, pt.y - s.y0), n = Math.max(1, Math.ceil(d / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      feed(s, s.x0 + (pt.x - s.x0) * t, s.y0 + (pt.y - s.y0) * t, s.p0 + (pt.p - s.p0) * t, i * 6);
    }
    for (const e of s.engs) finishEngine(e);
    displayDirty = true;
    return;
  }
  const sm = brush.smoothing;
  s.sx += (pt.x - s.sx) * (1 - sm * 0.9);
  s.sy += (pt.y - s.sy) * (1 - sm * 0.9);
  feed(s, s.sx, s.sy, pt.p, pt.t);
  displayDirty = true;
}

drawCanvas.addEventListener('pointerdown', (e) => {
  if (tool === 'camera' || playing || e.button === 2) return;
  e.preventDefault();
  const pt = toCanvasXY(e);
  const layer = proj.layers[layerIndex(proj.activeLayer)];
  if (!layer.visible) { toast('This layer is hidden. Show it to draw.'); return; }
  if (tool === 'picker') { pickColor(pt); return; }
  if (layer.media) { toast(`${layer.name} is an imported ${{ video: 'video', audio: 'sound', image: 'photo' }[layer.media.kind]}. Pick or add another layer to draw.`); return; }
  if (tool === 'fill') { floodFill(pt); return; }
  const frame = curFrame();
  const sheet = sheetForView(frame, proj.activeLayer, true, pt);
  const reanchor = takeReanchor(sheet);
  const lc = sheet.canvas;
  const bctx = beforeCanvas.getContext('2d');
  bctx.clearRect(0, 0, proj.W, proj.H); bctx.drawImage(lc, 0, 0);
  const sctx = strokeCanvas.getContext('2d');
  sctx.clearRect(0, 0, proj.W, proj.H);
  const p = pressureOf(e);
  const sample = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= proj.W || yi >= proj.H) return null;
    return bctx.getImageData(xi, yi, 1, 1).data;
  };
  stroke = { frame, sheet, reanchor, layerId: proj.activeLayer, sx: pt.x, sy: pt.y, x0: pt.x, y0: pt.y, p0: p, last: { ...pt, p },
    straight: ruler.line || e.shiftKey, mirror: ruler.mirror, sample, opacity: activeOpacity(), blend: activeBlend() };
  newEngines(stroke);
  feed(stroke, pt.x, pt.y, p, e.timeStamp);
  drawCanvas.setPointerCapture(e.pointerId);
  displayDirty = true;
});
drawCanvas.addEventListener('pointermove', (e) => {
  if (!stroke) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs.length ? evs : [e]) { const pt = toCanvasXY(ev); pt.p = pressureOf(ev); pt.t = ev.timeStamp; strokeTo(pt); }
});
const endStroke = () => {
  if (!stroke) return;
  const s = stroke;
  if (!s.straight) {
    // catch up to where the pen actually stopped, then draw the tapered tail
    if (s.last) feed(s, s.last.x, s.last.y, s.last.p, (s.last.t || 0) + 16);
    for (const e of s.engs) finishEngine(e);
  }
  stroke = null;
  const sh = s.sheet;
  const ctx = sh.canvas.getContext('2d');
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.globalCompositeOperation = s.blend;
  ctx.drawImage(strokeCanvas, 0, 0);
  ctx.restore();
  const b = { minX: Math.min(...s.engs.map((e) => e.minX)), minY: Math.min(...s.engs.map((e) => e.minY)), maxX: Math.max(...s.engs.map((e) => e.maxX)), maxY: Math.max(...s.engs.map((e) => e.maxY)) };
  const x = Math.max(0, Math.floor(b.minX)), y = Math.max(0, Math.floor(b.minY));
  const w = Math.min(proj.W, Math.ceil(b.maxX)) - x, h = Math.min(proj.H, Math.ceil(b.maxY)) - y;
  if (w > 0 && h > 0) {
    const before = beforeCanvas.getContext('2d').getImageData(x, y, w, h);
    const after = ctx.getImageData(x, y, w, h);
    const f = s.frame;
    const re = s.reanchor;
    pushUndo('stroke', () => { sh.canvas.getContext('2d').putImageData(before, x, y); re.undo(); touchSheet(f, sh); },
      () => { re.redo(); sh.canvas.getContext('2d').putImageData(after, x, y); touchSheet(f, sh); });
  }
  if (tool !== 'eraser') rememberColor(brush.color);
  touchSheet(s.frame, sh);
};
drawCanvas.addEventListener('pointerup', endStroke);
drawCanvas.addEventListener('pointercancel', endStroke);

/** Draws this frame's sheets that were drawn from the current view (used by fill). */
function compositeView(ctx, frame, onlyLayer = null) {
  const cam = captureCam();
  for (const l of proj.layers) {
    if (!l.visible || (onlyLayer && l.id !== onlyLayer)) continue;
    for (const s of frame.sheets) if (s.layerId === l.id && (l.lock || (!s.xf && sameView(s.anchor, cam)))) { ctx.globalAlpha = l.opacity; ctx.drawImage(s.canvas, 0, 0); }
  }
  ctx.globalAlpha = 1;
}

function renderDisplay() {
  if (!displayDirty || !displayCtx) return;
  displayDirty = false;
  const ctx = displayCtx;
  ctx.clearRect(0, 0, proj.W, proj.H);
  if (stroke) {
    // live preview of the stroke on its sheet (the sheet itself is hidden in 3D meanwhile)
    const pc = previewCanvas.getContext('2d');
    pc.clearRect(0, 0, proj.W, proj.H);
    pc.drawImage(stroke.sheet.canvas, 0, 0);
    pc.save();
    pc.globalAlpha = stroke.opacity;
    pc.globalCompositeOperation = stroke.blend;
    pc.drawImage(strokeCanvas, 0, 0);
    pc.restore();
    const l = proj.layers[layerIndex(stroke.layerId)];
    ctx.globalAlpha = l ? l.opacity : 1;
    ctx.drawImage(previewCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }
  if (ruler.mirror && BRUSH_TOOLS.concat('eraser').includes(tool)) {
    ctx.save();
    ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(29,155,230,0.75)';
    ctx.beginPath(); ctx.moveTo(proj.W / 2, 0); ctx.lineTo(proj.W / 2, proj.H); ctx.stroke();
    ctx.restore();
  }
}

function pickColor(pt) {
  const t = makeCanvas(1, 1).getContext('2d');
  t.drawImage(glc, (pt.x / proj.W) * glc.width, (pt.y / proj.H) * glc.height, 1, 1, 0, 0, 1, 1);
  t.drawImage(drawCanvas, pt.x, pt.y, 1, 1, 0, 0, 1, 1);
  const d = t.getImageData(0, 0, 1, 1).data;
  setColor('#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
  setTool('brush');
  toast('Picked ' + brush.color);
}

function floodFill(pt) {
  const x0 = Math.floor(pt.x), y0 = Math.floor(pt.y);
  if (x0 < 0 || y0 < 0 || x0 >= proj.W || y0 >= proj.H) return;
  const W = proj.W, H = proj.H;
  const frame = curFrame();
  // region comes from all visible layers (so fills stay inside line art on another layer)
  const sample = makeCanvas();
  const sctx = sample.getContext('2d');
  compositeView(sctx, frame, brush.sampleAll ? null : proj.activeLayer);
  const src = new Uint32Array(sctx.getImageData(0, 0, W, H).data.buffer);
  const target = src[y0 * W + x0];
  const tr = target & 255, tg = (target >> 8) & 255, tb = (target >> 16) & 255, ta = (target >>> 24) & 255;
  const tol = brush.tolerance;
  const same = (v) => Math.abs((v & 255) - tr) <= tol && Math.abs(((v >> 8) & 255) - tg) <= tol && Math.abs(((v >> 16) & 255) - tb) <= tol && Math.abs(((v >>> 24) & 255) - ta) <= tol;
  const mask = new Uint8Array(W * H);
  const stack = [x0, y0];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    let l = x;
    while (l >= 0 && !mask[y * W + l] && same(src[y * W + l])) l--;
    l++;
    let r = x;
    while (r < W && !mask[y * W + r] && same(src[y * W + r])) r++;
    for (let i = l; i < r; i++) {
      mask[y * W + i] = 1;
      if (y > 0 && !mask[(y - 1) * W + i] && same(src[(y - 1) * W + i])) stack.push(i, y - 1);
      if (y < H - 1 && !mask[(y + 1) * W + i] && same(src[(y + 1) * W + i])) stack.push(i, y + 1);
    }
  }
  // grow 1px so the fill tucks under anti-aliased edges
  const grown = mask.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!mask[i] && (mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W])) grown[i] = 1;
  }
  const col = new THREE.Color(brush.color);
  const fill = makeCanvas();
  const fctx = fill.getContext('2d');
  const img = fctx.createImageData(W, H);
  const r8 = Math.round(col.r * 255), g8 = Math.round(col.g * 255), b8 = Math.round(col.b * 255);
  for (let i = 0; i < W * H; i++) if (grown[i]) { const o = i * 4; img.data[o] = r8; img.data[o + 1] = g8; img.data[o + 2] = b8; img.data[o + 3] = 255; }
  fctx.putImageData(img, 0, 0);
  pixelEdit('fill', frame, proj.activeLayer, (ctx) => {
    ctx.save(); ctx.globalAlpha = toolCfg.fill.opacity; ctx.drawImage(fill, 0, 0); ctx.restore();
  }, pt);
  rememberColor(brush.color);
}


/* =================================================================== layout & loop */

const view = $('view');
const boxSize = { w: 1, h: 1 };
function basePixelRatio() { return Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2); }
let lowRes = false;
function adaptQuality() {
  const want = COARSE && interacting() && !exporting;
  if (want === lowRes) return;
  lowRes = want;
  renderer.setPixelRatio(want ? 1 : basePixelRatio());
  renderer.setSize(boxSize.w, boxSize.h, false);
}
function layoutBox() {
  const r = view.getBoundingClientRect();
  // the picture uses the whole screen (letterboxed to the project's shape)
  const aw = Math.max(50, r.width), ah = Math.max(50, r.height);
  const aspect = proj.W / proj.H;
  let w = aw, h = aw / aspect;
  if (h > ah) { h = ah; w = ah * aspect; }
  box.style.width = Math.round(w) + 'px';
  box.style.height = Math.round(h) + 'px';
  boxSize.w = Math.round(w); boxSize.h = Math.round(h);
  lowRes = false;
  renderer.setPixelRatio(basePixelRatio());
  renderer.setSize(boxSize.w, boxSize.h, false);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  displayDirty = true;
}
new ResizeObserver(layoutBox).observe(view);

let playing = false, playStart = 0, playFrom = 0, exporting = false;
const clock = new THREE.Clock();

function frameLoop() {
  requestAnimationFrame(frameLoop);
  const dt = Math.min(0.1, clock.getDelta());
  if (exporting) return;

  if (playing) {
    const n = proj.frames.length;
    const elapsed = (performance.now() - playStart) / 1000;
    let idx = playFrom + Math.floor(elapsed * proj.fps);
    if (idx >= n) {
      if ($('loop').checked) idx %= n;
      else { stopPlay(); idx = n - 1; }
    }
    if (playing && idx < proj.current) { stopSounds(); startSounds(idx); } // looped back to the start
    if (idx !== proj.current) { goTo(idx); }
  } else {
    updateFly(dt);
    if (camMode === 'orbit') orbit.update();
  }

  syncHoppedCam();
  if (!playing && !stroke && !fly.dragging && !gizmo.dragging) backgroundThumb();
  syncSheets();
  adaptQuality();
  renderer.render(scene, camera);
  renderDisplay();
  updateCamChanged();
  const f = curFrame();
  if (f && f.thumbDirty && !stroke && !camDiffers(f.cam, captureCam())) drawThumb(f);
}

let lastThumbAt = 0;
/** Renders one stale thumbnail for a frame that isn't on screen, then puts the camera back. */
function backgroundThumb() {
  const now = performance.now();
  if (now - lastThumbAt < 160 || interacting()) return;
  const f = proj.frames.find((fr, i) => fr.thumbDirty && fr.thumb && i !== proj.current);
  if (!f) return;
  lastThumbAt = now;
  const pos = camera.position.clone(), q = camera.quaternion.clone(), fov = camera.fov;
  const gizmoWas = gizmo.visible;
  gizmo.visible = false;
  camsVisible(false);
  camera.position.fromArray(f.cam.p); camera.quaternion.fromArray(f.cam.q); camera.fov = f.cam.fov; camera.updateProjectionMatrix();
  setModelTimes(proj.frames.indexOf(f));
  syncSheets(proj.frames.indexOf(f), true);
  renderer.render(scene, camera);
  drawThumb(f);
  camera.position.copy(pos); camera.quaternion.copy(q); camera.fov = fov; camera.updateProjectionMatrix();
  setModelTimes(proj.current);
  gizmo.visible = gizmoWas;
  camsVisible(true);
}

let lastCamFlag = false;
function updateCamChanged() {
  const f = curFrame();
  const changed = !playing && f && camDiffers(f.cam, captureCam());
  if (changed !== lastCamFlag) {
    lastCamFlag = changed;
    const b = $('updateCamBtn');
    b.disabled = !changed;
    b.classList.toggle('changed', changed);
    b.title = changed ? 'Camera moved: save this view to the current frame (U)' : 'This frame already uses this camera view';
  }
}

function startPlay() {
  if (proj.frames.length < 2) { toast('Add more frames to play'); return; }
  playing = true;
  gizmo.detach();
  camsVisible(false);
  updateFlyPad();
  playFrom = proj.current >= proj.frames.length - 1 ? 0 : proj.current;
  playStart = performance.now();
  if (playFrom !== proj.current) goTo(playFrom);
  stopSounds(); startSounds(playFrom);
  $('playBtn').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
  $('playBtn').setAttribute('aria-label', 'Pause (Space)');
  $('hudPlay').innerHTML = $('playBtn').innerHTML; $('hudPlay').setAttribute('aria-label', 'Pause');
  displayDirty = true;
  updateFrameUI();
}
function stopPlay() {
  playing = false;
  stopSounds();
  $('playBtn').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
  $('playBtn').setAttribute('aria-label', 'Play (Space)');
  $('hudPlay').innerHTML = $('playBtn').innerHTML; $('hudPlay').setAttribute('aria-label', 'Play');
  camsVisible(true);
  reattachGizmo();
  hopFromFrame(curFrame());
  updateFlyPad();
  displayDirty = true;
  updateFrameUI();
}

/* =================================================================== timeline UI */

const strip = $('strip');
const THUMB_W = 132;
function thumbH() { return Math.round(THUMB_W * proj.H / proj.W); }

function drawThumb(f) {
  if (!f.thumb) return;
  const ctx = f.thumb.getContext('2d');
  ctx.drawImage(glc, 0, 0, f.thumb.width, f.thumb.height);
  f.thumbDirty = false;
}

function rebuildStrip() {
  strip.innerHTML = '';
  proj.frames.forEach((f, i) => {
    if (!f.thumb || f.thumb.height !== thumbH()) { f.thumb = makeCanvas(THUMB_W, thumbH()); f.thumbDirty = true; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'frame';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-label', `Frame ${i + 1}`);
    b.append(f.thumb);
    const s = document.createElement('span'); s.textContent = i + 1; b.append(s);
    b.addEventListener('click', () => { if (playing) stopPlay(); goTo(i); });
    strip.append(b);
  });
  updateFrameUI();
}

function updateFrameUI() {
  const kids = strip.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].setAttribute('aria-current', String(i === proj.current));
    kids[i].setAttribute('aria-selected', String(i === proj.current));
    kids[i].classList.toggle('playing', playing && i === proj.current);
  }
  $('frameLabel').textContent = `Frame ${proj.current + 1} / ${proj.frames.length}`;
  $('timeTabCount').textContent = `${proj.current + 1} / ${proj.frames.length}`;
  if (playing) scrollStripToCurrent();
}
function scrollStripToCurrent() {
  const el = strip.children[proj.current];
  if (!el) return;
  // scroll only the frame strip (scrollIntoView would also shove the whole app up)
  const l = el.offsetLeft - strip.offsetLeft, r = l + el.offsetWidth;
  if (l < strip.scrollLeft) strip.scrollLeft = l - 12;
  else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 12;
}

/* =================================================================== panels */

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const svg = (p) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = p; return s; };
const ICON = {
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.9 8.3 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.3-1"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  pen: '<path d="M15 4l5 5L9 20H4v-5z"/>',
  move: '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
};

function slider(label, value, min, max, step, onInput, fmt = (v) => v) {
  const id = 'f' + uid();
  const out = h('output', { for: id }, String(fmt(value)));
  const inp = h('input', { type: 'range', id, min, max, step });
  inp.value = value;
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); onInput(v); });
  return h('div', { class: 'field' }, h('div', { class: 'hd' }, h('label', { for: id }, label), out), inp);
}
function check(label, value, onChange) {
  const id = 'k' + uid();
  const inp = h('input', { type: 'checkbox', id });
  inp.checked = value;
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'check', for: id }, inp, label);
}

function setColor(c) {
  brush.color = c;
  const now = document.querySelector('.swatch-now');
  if (now) now.style.background = c;
  if (activeTab === 'Brush') renderBrushPane();
}
function rememberColor(c) {
  brush.recent = [c, ...brush.recent.filter((x) => x !== c)].slice(0, 8);
}

function renderBrushPane() {
  const p = $('paneBrush');
  p.innerHTML = '';
  const t = TOOLS.find((x) => x.id === tool);
  const wheel = colorWheel({ value: brush.color, label: 'Brush color', size: 160,
    onInput: (c) => { brush.color = c; const now = document.querySelector('.swatch-now'); if (now) now.style.background = c; },
    onChange: (c) => { brush.color = c; } });
  const sw = (c) => { const b = h('button', { type: 'button', class: 'sw', 'aria-label': c, 'aria-pressed': String(c === brush.color) }); b.style.background = c; b.addEventListener('click', () => setColor(c)); return b; };

  p.append(h('div', { class: 'sect' }, h('h3', {}, 'Color'), wheel.el, h('div', { class: 'row', style: 'margin-top:10px' }, ...PALETTE.map(sw)),
    brush.recent.length ? h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'note' }, 'Recent'), ...brush.recent.map(sw)) : null));

  if (tool === 'camera') {
    p.append(h('div', { class: 'sect' }, h('h3', {}, 'Camera tool'), h('p', { class: 'note' },
      'Move around the 3D scene. Orbit: drag to turn, right-drag to pan, scroll to zoom. Walk / fly: drag to look, WASD to move, Q/E for down/up, Shift to go faster. Click a model to move, turn or resize it. When the view looks right, press “Add frame here”.')));
    return;
  }
  const sect = h('div', { class: 'sect' });
  if (BRUSH_TOOLS.includes(tool) || tool === 'eraser') {
    const b = activeBrush();
    sect.append(h('h3', {}, tool === 'eraser' ? 'Eraser' : `${t.label}: ${b.name}`));
    sect.append(slider('Size', activeSize(), 1, 200, 1, (v) => { setActiveSize(v); }, (v) => v + ' px'));
    sect.append(slider('Opacity', activeOpacity(), 0.05, 1, 0.01, (v) => { if (tool === 'eraser') toolCfg.eraser.opacity = v; else brushSettings[b.id].opacity = v; }, (v) => Math.round(v * 100) + '%'));
    sect.append(slider('Smoothing', brush.smoothing, 0, 0.95, 0.01, (v) => { brush.smoothing = v; }, (v) => Math.round(v * 100) + '%'));
    sect.append(check('Pen pressure changes size', brush.pressureSize, (v) => { brush.pressureSize = v; }));
    sect.append(check('Pen pressure changes opacity', brush.pressureOpacity, (v) => { brush.pressureOpacity = v; }));
    if (tool === 'eraser') sect.append(check('Soft edge', eraserSoft, (v) => { eraserSoft = v; }));
    else {
      sect.append(h('button', { type: 'button', class: 'btn', style: 'margin-top:4px', onclick: () => { brushSettings[b.id] = { ...BRUSH_DEFAULTS[b.id] }; renderBrushPane(); } }, 'Reset this brush'));
    }
  } else {
    sect.append(h('h3', {}, t.label));
    sect.append(slider('Opacity', toolCfg[tool].opacity, 0.05, 1, 0.01, (v) => { toolCfg[tool].opacity = v; }, (v) => Math.round(v * 100) + '%'));
  }
  if (tool === 'fill') {
    sect.append(slider('Tolerance', brush.tolerance, 0, 160, 1, (v) => { brush.tolerance = v; }));
    sect.append(check('Fill inside lines on all layers', brush.sampleAll, (v) => { brush.sampleAll = v; }));
  }
  if (tool === 'picker') sect.append(h('p', { class: 'note' }, 'Click anywhere on the picture, including the 3D scene, to pick its color.'));
  p.append(sect);
  if (BRUSH_TOOLS.includes(tool) || tool === 'eraser') p.append(rulerSection());
  if (BRUSH_TOOLS.includes(tool)) p.append(brushEditor(), brushLibrary());
  p.append(h('p', { class: 'note' }, 'Shortcuts: 1–8 tools · [ and ] size · Space play · , and . step frames · Enter add frame · Ctrl+Z undo'));
}

function rulerSection() {
  const sect = h('div', { class: 'sect' }, h('h3', {}, 'Rulers'));
  const mk = (key, label, tip) => {
    const b = h('button', { type: 'button', class: 'chipb', 'aria-pressed': String(ruler[key]), title: tip }, label);
    b.addEventListener('click', () => { ruler[key] = !ruler[key]; b.setAttribute('aria-pressed', String(ruler[key])); displayDirty = true; });
    return b;
  };
  sect.append(h('div', { class: 'row' }, mk('line', 'Straight line', 'Every stroke is a straight line (or hold Shift while drawing)'), mk('mirror', 'Mirror (symmetry)', 'Whatever you draw is mirrored across the middle')));
  sect.append(h('p', { class: 'note', style: 'margin-top:6px' }, 'Tip: hold Shift while drawing for a quick straight line.'));
  return sect;
}

const EDIT_GROUPS = [
  ['Stroke shape', [
    ['taperIn', 'Start taper', 0, 400, 1, (v) => v ? v + ' px' : 'off'],
    ['taperOut', 'End taper', 0, 400, 1, (v) => v ? v + ' px' : 'off'],
    ['fadeLen', 'Fade out over', 0, 3000, 10, (v) => v ? v + ' px' : 'off'],
    ['speedThin', 'Thinner when fast', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
  ]],
  ['Pen pressure', [
    ['minSize', 'Size at light pressure', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['pressureGamma', 'Pressure curve', 0.3, 3, 0.05, (v) => v < 0.95 ? 'soft' + ' (' + v.toFixed(2) + ')' : v > 1.05 ? 'firm' + ' (' + v.toFixed(2) + ')' : 'even'],
  ]],
  ['Tip', [
    ['hardness', 'Hardness', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['roundness', 'Roundness', 0.1, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['angle', 'Angle', -180, 180, 1, (v) => v + '°'],
    ['followDir', 'Turn with the stroke', null],
    ['spacing', 'Spacing', 0.02, 2, 0.01, (v) => Math.round(v * 100) + '% of size'],
  ]],
  ['Scatter & variation', [
    ['scatter', 'Scatter', 0, 3, 0.01, (v) => Math.round(v * 100) + '%'],
    ['count', 'Stamps per step', 1, 8, 1, (v) => v],
    ['sizeJitter', 'Size jitter', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['angleJitter', 'Angle jitter', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['opacityJitter', 'Opacity jitter', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['hueJitter', 'Hue jitter', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['satJitter', 'Saturation jitter', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['lightJitter', 'Brightness jitter', 0, 0.5, 0.01, (v) => Math.round(v * 200) + '%'],
  ]],
  ['Paint', [
    ['flow', 'Flow (paint per stamp)', 0.01, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['mix', 'Mix with paint underneath', 0, 1, 0.01, (v) => Math.round(v * 100) + '%'],
    ['blend', 'Blend mode', 'select'],
  ]],
];
const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['lighter', 'Add (glow)'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['soft-light', 'Soft light']];
let editorOpen = false;

function brushEditor() {
  const base = BRUSH_BY_ID[toolBrush[tool]] || BRUSH_BY_ID.basic;
  const set = settingsFor(base.id);
  const cur = () => activeBrush();
  const prev = h('canvas', { class: 'bprev', width: 528, height: 120, 'aria-label': 'Brush preview' });
  const redraw = () => {
    const pc = preview({ ...cur(), id: '__edit' }, brush.color, 264, 60, true);
    const ctx = prev.getContext('2d');
    ctx.clearRect(0, 0, prev.width, prev.height);
    ctx.drawImage(pc, 0, 0, prev.width, prev.height);
  };
  let t = 0;
  const changed = () => { clearTimeout(t); t = setTimeout(redraw, 30); };
  const setOv = (k, v) => { set.ov = { ...(set.ov || {}), [k]: v }; changed(); };

  const det = h('details', { class: 'cwd beditor' }, h('summary', {}, 'Brush settings: ' + base.name));
  det.open = editorOpen;
  det.addEventListener('toggle', () => { editorOpen = det.open; });
  det.append(prev);
  for (const [title, ctls] of EDIT_GROUPS) {
    det.append(h('h3', { class: 'bed-h' }, title));
    for (const [k, label, min, max, step, fmt] of ctls) {
      const v = cur()[k];
      if (min === null) det.append(check(label, !!v, (x) => setOv(k, x)));
      else if (min === 'select') {
        const sel = h('select', { 'aria-label': label });
        for (const [val, text] of BLENDS) { const o = h('option', { value: val }, text); if (val === v) o.selected = true; sel.append(o); }
        sel.addEventListener('change', () => setOv(k, sel.value));
        det.append(h('div', { class: 'field' }, h('div', { class: 'hd' }, h('span', {}, label)), sel));
      } else det.append(slider(label, v ?? 0, min, max, step, (x) => setOv(k, x), fmt));
    }
  }
  const acts = h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { type: 'button', class: 'btn', onclick: () => { delete set.ov; renderBrushPane(); toast('Brush settings reset'); } }, 'Reset settings'),
    h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      const name = await promptDlg('Save as my brush', base.cat === 'My brushes' ? base.name : base.name + ' (mine)');
      if (!name) return;
      const id = base.cat === 'My brushes' ? base.id : 'my-' + uid();
      const b = { ...cur(), id, cat: 'My brushes', name: name.slice(0, 32), size: activeSize(), opacity: activeOpacity() };
      registerBrush(b);
      brushSettings[id] = { size: b.size, opacity: b.opacity };
      if (id !== base.id) delete set.ov;
      toolBrush[tool] = id;
      brushCat = 'My brushes';
      saveMyBrushes();
      renderBrushPane();
      toast(`Saved “${b.name}” to My brushes`);
    } }, base.cat === 'My brushes' ? 'Save changes' : 'Save as my brush'));
  if (base.cat === 'My brushes') {
    acts.append(h('button', { type: 'button', class: 'btn', onclick: async () => {
      if (!(await confirmDlg('Delete brush?', `Delete “${base.name}” from My brushes?`, 'Delete'))) return;
      unregisterBrush(base.id);
      saveMyBrushes();
      for (const k of Object.keys(toolBrush)) if (toolBrush[k] === base.id) toolBrush[k] = 'basic';
      renderBrushPane();
    } }, 'Delete'));
  }
  det.append(acts);
  setTimeout(redraw, 0);
  return det;
}

function brushLibrary() {
  const wrap = h('div', { class: 'sect' }, h('h3', {}, `Brush library (${BRUSHES.length})`));
  const cats = h('div', { class: 'row', role: 'group', 'aria-label': 'Brush groups', style: 'margin-bottom:10px' });
  for (const c of ['All', ...CATEGORIES.filter((x) => x !== 'My brushes' || BRUSHES.some((b) => b.cat === 'My brushes'))]) {
    const b = h('button', { type: 'button', class: 'chipb', 'aria-pressed': String(c === brushCat) }, c);
    b.addEventListener('click', () => { brushCat = c; renderBrushPane(); });
    cats.append(b);
  }
  const grid = h('div', { class: 'bgrid', role: 'listbox', 'aria-label': 'Brushes' });
  const cur = toolBrush[tool];
  const dark = ['lighter', 'screen'];
  for (const br of BRUSHES) {
    if (brushCat !== 'All' && br.cat !== brushCat) continue;
    const btn = h('button', { type: 'button', class: 'bitem' + (dark.includes(br.blend) ? ' dark' : ''), role: 'option', 'aria-selected': String(br.id === cur), title: `${br.name} (${br.cat})` });
    btn.append(preview(br, dark.includes(br.blend) ? '#7fd8ff' : '#2a2633'), h('span', {}, br.name));
    btn.addEventListener('click', () => { toolBrush[tool] = br.id; renderBrushPane(); toast(br.name); });
    grid.append(btn);
  }
  wrap.append(cats, grid, h('p', { class: 'note', style: 'margin-top:8px' }, 'Brush, Pencil, Marker and Airbrush each remember the brush you last picked for them. Size and opacity are kept for each brush.'));
  return wrap;
}

function renderLayersPane() {
  const p = $('paneLayers');
  p.innerHTML = '';
  const list = h('ul', { class: 'list' });
  [...proj.layers].reverse().forEach((l) => {
    const active = l.id === proj.activeLayer;
    const eye = h('button', { type: 'button', class: 'mini' + (l.visible ? '' : ' off'), 'aria-label': (l.visible ? 'Hide ' : 'Show ') + l.name, 'aria-pressed': String(l.visible) }, svg(l.visible ? ICON.eye : ICON.eyeOff));
    eye.addEventListener('click', () => { l.visible = !l.visible; layersChanged(); });
    const nm = h('button', { type: 'button', class: 'nm', 'aria-pressed': String(active) }, l.name, l.media ? h('small', {}, { video: '▶ video', audio: '♪ sound', image: 'photo' }[l.media.kind] || '') : null, l.lock ? h('small', {}, '🔒 camera') : null);
    nm.addEventListener('click', () => { proj.activeLayer = l.id; renderLayersPane(); });
    nm.addEventListener('dblclick', () => renameLayer(l));
    const ren = h('button', { type: 'button', class: 'mini', 'aria-label': 'Rename ' + l.name }, svg(ICON.pen));
    ren.addEventListener('click', () => renameLayer(l));
    const up = h('button', { type: 'button', class: 'mini', 'aria-label': 'Move up' }, svg(ICON.up)); up.addEventListener('click', () => moveLayer(l, 1));
    const dn = h('button', { type: 'button', class: 'mini', 'aria-label': 'Move down' }, svg(ICON.down)); dn.addEventListener('click', () => moveLayer(l, -1));
    const del = h('button', { type: 'button', class: 'mini', 'aria-label': 'Delete ' + l.name }, svg(ICON.trash)); del.addEventListener('click', () => deleteLayer(l));
    const mv = h('button', { type: 'button', class: 'mini' + (selectedArt?.layerId === l.id ? ' on' : '') + (l.lock ? ' off' : ''), 'aria-label': 'Move ' + l.name + ' in 3D', title: 'Move this layer’s drawing in 3D' }, svg(ICON.move));
    mv.addEventListener('click', () => { proj.activeLayer = l.id; pickLayerArt(l); });
    list.append(h('li', { class: active ? 'sel' : '' }, eye, nm, l.media?.kind === 'audio' ? h('span', { class: 'mini', 'aria-hidden': 'true' }) : mv, ren, up, dn, del));
  });
  const act = proj.layers[layerIndex(proj.activeLayer)];
  p.append(
    artSection() || '',
    h('div', { class: 'sect' }, h('h3', {}, 'Layers'), list,
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn', onclick: addLayer }, '+ New layer'),
        importButton())),
    h('div', { class: 'sect' }, h('h3', {}, act.name),
      chipRow('Where this layer’s drawing stays', [['world', 'In the 3D world'], ['cam', 'Locked to camera frame']], act.lock ? 'cam' : 'world', (v) => setLayerLock(act, v === 'cam')),
      act.lock ? h('p', { class: 'note', style: 'margin:-2px 0 10px' }, 'This layer stays exactly where you drew it in the picture, even when the camera moves, and shows on top of the 3D scene. Good for titles, characters and effects.') : null,
      slider('Layer opacity', act.opacity, 0, 1, 0.01, (v) => { act.opacity = v; displayDirty = true; markAllThumbs(); saveSoon(); }, (v) => Math.round(v * 100) + '%'),
      act.media ? null : h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: copyFromPrevious }, 'Copy from previous frame'),
        h('button', { type: 'button', class: 'btn', onclick: clearLayerOnFrame }, 'Clear this frame'))),
    act.media ? mediaSection(act) : '',
    drawDepthSection(),
    h('p', { class: 'note' }, 'Layers are shared by every frame; each frame has its own drawing on each layer. Turn on Onion skin to see the frames around this one.'),
  );
}

function drawDepthSection() {
  const d = proj.draw;
  const sect = h('div', { class: 'sect' }, h('h3', {}, 'Drawings in 3D'));
  sect.append(chipRow('Where new drawings go', [['auto', 'On what’s under the pen'], ['fixed', 'Fixed distance']], d.mode, (v) => { d.mode = v; saveSoon(); renderLayersPane(); }));
  sect.append(chipRow('Light on drawings', [['lit', 'Lit by the scene'], ['flat', 'Always full color']], d.lit !== false ? 'lit' : 'flat', (v) => { d.lit = v === 'lit'; markAllThumbs(); saveSoon(); renderLayersPane(); }));
  if (d.lit !== false) sect.append(h('p', { class: 'note', style: 'margin:-2px 0 10px' }, 'Your drawings and imported pictures get the sun, the night and your lamps, just like the 3D scene.'));
  sect.append(chipRow('How drawings sit in the scene', [['front', 'Always in front'], ['behind', 'Can hide behind models']], d.front !== false ? 'front' : 'behind', (v) => { d.front = v === 'front'; markAllThumbs(); saveSoon(); renderLayersPane(); }));
  if (d.front === false) sect.append(h('p', { class: 'note', style: 'margin:-2px 0 10px' }, 'Models closer to the camera cover your drawing. Strokes drawn onto the ground or a model may sink into it.'));
  if (d.mode === 'fixed') sect.append(slider('Distance from camera', d.dist, 0.5, 80, 0.5, (v) => { d.dist = v; saveSoon(); }, (v) => v + ' m'));
  sect.append(h('p', { class: 'note' }, d.one !== false
    ? 'Each layer holds one drawing per frame. It stays in the 3D world, facing the camera you last drew from, so it looks right from there. Move the camera and draw again, and the drawing swings round to face you so you can keep adding to it. To move a drawing, click it with the Camera tool, or use the arrows button next to a layer.'
    : 'Your drawings stay where you drew them in the 3D world, facing the camera you drew from. Drawing again from a different view starts a new drawing there, so earlier strokes keep their place. To move a drawing, click it with the Camera tool, or use the arrows button next to a layer.'));
  sect.append(chipRow('Drawing from a new angle', [['one', 'One drawing that faces you'], ['many', 'New drawing in each view']], d.one !== false ? 'one' : 'many', (v) => { d.one = v === 'one'; saveSoon(); renderLayersPane(); }));
  const f = curFrame();
  const n = f ? f.sheets.filter((s) => s.layerId === proj.activeLayer).length : 0;
  if (n) sect.append(h('p', { class: 'note' }, `This frame has ${n} drawing sheet${n > 1 ? 's' : ''} on this layer.`));
  return sect;
}

function setLayerLock(l, on) {
  if (!!l.lock === on) return;
  const go = (v) => { l.lock = v; if (v && selectedArt && selectedArt.sheets.some((s) => s.layerId === l.id)) dropArt(); for (const f of proj.frames) for (const s of f.sheets) if (s.layerId === l.id && s.mesh) placeSheet(s); layersChanged(); };
  go(on);
  pushUndo(on ? 'lock layer' : 'unlock layer', () => go(!on), () => go(on));
  toast(on ? `${l.name} now stays in the camera frame` : `${l.name} now stays in the 3D world`);
}

async function renameLayer(l) {
  const name = await promptDlg('Rename layer', l.name);
  if (name) { l.name = name.slice(0, 30); renderLayersPane(); saveSoon(); }
}

function renderScenePane() {
  const p = $('paneScene');
  p.innerHTML = '';
  const input = h('input', { type: 'file', multiple: true, 'aria-label': 'Import 3D models' });
  input.setAttribute('accept', ACCEPT);
  input.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer';
  input.addEventListener('change', () => { importFiles([...input.files]); input.value = ''; });
  const list = h('ul', { class: 'list' });
  for (const m of models) {
    const eye = h('button', { type: 'button', class: 'mini' + (m.visible ? '' : ' off'), 'aria-label': (m.visible ? 'Hide ' : 'Show ') + m.name }, svg(m.visible ? ICON.eye : ICON.eyeOff));
    eye.addEventListener('click', () => { m.visible = !m.visible; m.root.visible = m.visible; if (!m.visible && selectedModel === m) selectModel(null); markAllThumbs(); renderScenePane(); saveSoon(); });
    const fmt = m.kind === 'sample' ? 'built-in' : (MODEL_FORMATS[ext(m.name)] || '');
    const nm = h('button', { type: 'button', class: 'nm' }, m.name, h('small', {}, fmt));
    nm.addEventListener('click', () => { setTool('camera'); selectModel(m); });
    const del = h('button', { type: 'button', class: 'mini', 'aria-label': 'Remove ' + m.name }, svg(ICON.trash));
    del.addEventListener('click', async () => {
      if (await confirmDlg('Remove model?', `Take “${m.name}” out of the scene?`, 'Remove')) { removeModel(m); markAllThumbs(); renderScenePane(); saveSoon(); }
    });
    list.append(h('li', { class: selectedModel === m ? 'sel' : '' }, eye, nm, del));
  }
  p.append(h('div', { class: 'sect' }, h('h3', {}, 'Models'),
    models.length ? list : h('p', { class: 'note' }, 'No models in the scene.'),
    h('div', { class: 'drop-hint', style: 'margin-top:10px;position:relative' }, h('b', {}, 'Import 3D'), h('br'), 'GLB, glTF, FBX, OBJ + MTL, STL, PLY, DAE, 3MF, 3DS, USDZ, AMF, VOX, LWO, WRL, PCD, XYZ, G-code, KMZ, VTK, MD2. Pick the model with its texture files, or drop them on the picture.', input),
    models.some((m) => m.kind === 'sample') ? null : h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn', onclick: () => { addSampleModel(); markAllThumbs(); renderScenePane(); saveSoon(); } }, 'Add sample town'))));

  const m = selectedModel;
  if (m) {
    const modeBtn = (mode, label) => {
      const b = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(gizmo.mode === mode) }, label);
      if (gizmo.mode === mode) b.style.background = 'var(--bg-4)';
      b.addEventListener('click', () => { gizmo.setMode(mode); renderScenePane(); });
      return b;
    };
    const sect = h('div', { class: 'sect' }, h('h3', {}, m.name),
      h('div', { class: 'row' }, modeBtn('translate', 'Move'), modeBtn('rotate', 'Turn'), modeBtn('scale', 'Size')),
      h('p', { class: 'note', style: 'margin:8px 0' }, 'Drag the handles in the picture. Use the Camera tool.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => dropToFloor(m) }, 'Drop to floor'),
        h('button', { type: 'button', class: 'btn', onclick: () => { applyTransform(m.root, { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }); markAllThumbs(); saveSoon(); } }, 'Reset'),
        h('button', { type: 'button', class: 'btn', onclick: () => selectModel(null) }, 'Done')));
    if (m.clips.length) {
      const sel = h('select', { 'aria-label': 'Animation clip' });
      m.clips.forEach((c, i) => { const o = h('option', { value: i }, c.name || `Clip ${i + 1}`); if (i === m.clip) o.selected = true; sel.append(o); });
      sel.addEventListener('change', () => { setClip(m, +sel.value); setModelTimes(proj.current); markAllThumbs(); saveSoon(); });
      sect.append(h('div', { style: 'margin-top:10px' },
        check('Play its animation with the frames', m.animate, (v) => { m.animate = v; setModelTimes(proj.current); markAllThumbs(); saveSoon(); }),
        h('div', { class: 'row' }, h('span', { class: 'note' }, 'Clip'), sel)));
    }
    p.append(sect);
  }

  p.append(lightsSection(), skySection());

  const camList = h('ul', { class: 'list' });
  for (const c of sceneCams) {
    const inside = hopped === c;
    const nm = h('button', { type: 'button', class: 'nm' }, c.name, h('small', {}, inside ? 'you are inside' : ''));
    nm.addEventListener('click', () => { setTool('camera'); selectCam(c); });
    const hop = h('button', { type: 'button', class: 'btn', style: 'height:30px;padding:0 10px' }, inside ? 'Hop out' : 'Hop in');
    hop.addEventListener('click', () => (inside ? hopOut() : hopIn(c)));
    const ren = h('button', { type: 'button', class: 'mini', 'aria-label': 'Rename ' + c.name }, svg(ICON.pen));
    ren.addEventListener('click', async () => { const n = await promptDlg('Rename camera', c.name); if (n) { c.name = n.slice(0, 30); updateHopUI(); renderScenePane(); saveSoon(); } });
    const del = h('button', { type: 'button', class: 'mini', 'aria-label': 'Delete ' + c.name }, svg(ICON.trash));
    del.addEventListener('click', async () => { if (await confirmDlg('Delete camera?', `Remove “${c.name}”? Frames made with it keep their view.`, 'Delete')) { removeSceneCam(c); renderScenePane(); saveSoon(); } });
    camList.append(h('li', { class: selectedCam === c ? 'sel' : '' }, nm, hop, ren, del));
  }
  const camSect = h('div', { class: 'sect' }, h('h3', {}, 'Cameras'),
    sceneCams.length ? camList : h('p', { class: 'note' }, 'Place cameras in the scene, then hop in to look and move through them.'),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { type: 'button', class: 'btn', onclick: () => { const c = addSceneCam(); selectCam(c); saveSoon(); toast(`${c.name} placed at this view`); } }, '+ Camera at this view'),
      hopped ? h('button', { type: 'button', class: 'btn primary', onclick: hopOut }, 'Hop out') : null),
    h('div', { style: 'margin-top:8px' }, check('Show view cones', conesOn, (v) => { conesOn = v; camsVisible(!playing); saveSoon(); })));
  if (selectedCam && selectedCam !== hopped) {
    const modeBtn = (mode, label) => {
      const b = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(gizmo.mode === mode) }, label);
      if (gizmo.mode === mode) b.style.background = 'var(--bg-4)';
      b.addEventListener('click', () => { gizmo.setMode(mode); renderScenePane(); });
      return b;
    };
    camSect.append(h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'note' }, selectedCam.name), modeBtn('translate', 'Move'), modeBtn('rotate', 'Turn'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => hopIn(selectedCam) }, 'Hop in')));
  }
  p.append(camSect);

  p.append(h('div', { class: 'sect' }, h('h3', {}, 'Camera'),
    slider('Lens (field of view)', camera.fov, 15, 110, 1, (v) => { camera.fov = v; camera.updateProjectionMatrix(); }, (v) => v + '°'),
    slider('Walk speed', fly.speed, 0.5, 30, 0.5, (v) => { fly.speed = v; }, (v) => v + ' m/s'),
    h('p', { class: 'note' }, 'Each frame remembers the camera, including the lens. Change the view, then use “Camera moved: update frame” to save it to the current frame. Frames added while inside a camera put you back inside it.')));
}

function chipRow(label, items, current, onPick) {
  const row = h('div', { class: 'row', role: 'group', 'aria-label': label, style: 'margin-bottom:10px' });
  for (const [val, text] of items) {
    const b = h('button', { type: 'button', class: 'chipb', 'aria-pressed': String(val === current) }, text);
    b.addEventListener('click', () => onPick(val));
    row.append(b);
  }
  return row;
}
function envChanged(rerender = false) {
  applyEnv(timeAt(proj.current));
  markAllThumbs();
  saveSoon();
  if (rerender) renderScenePane();
}
function wheelIn(summary, value, onInput, open = false) {
  const w = colorWheel({ value, label: summary, size: 150, onInput, onChange: () => { markAllThumbs(); saveSoon(); } });
  const d = h('details', { class: 'cwd' }, h('summary', {}, h('i', { class: 'dot' }), summary), w.el);
  if (open) d.open = true;
  const dot = d.querySelector('.dot');
  dot.style.background = value;
  const orig = onInput;
  w.el.addEventListener('input', () => {});
  return { el: d, setDot: (c) => { dot.style.background = c; }, w, orig };
}

function skySection() {
  const e = proj.env;
  const s = h('div', { class: 'sect' }, h('h3', {}, 'Sky & time of day'));
  s.append(chipRow('Sky type', [['dynamic', 'Real sky'], ['gradient', 'Gradient'], ['solid', 'Solid color']], e.skyMode, (v) => { e.skyMode = v; envChanged(true); }));
  if (!e.lapse) {
    s.append(slider('Time of day', e.time, 0, 24, 0.05, (v) => { e.time = v; envChanged(); }, fmtClock));
    s.append(chipRow('Time presets', [[6.3, 'Sunrise'], [9, 'Morning'], [12, 'Noon'], [15.5, 'Afternoon'], [17.8, 'Golden hour'], [19.1, 'Dusk'], [23, 'Night']], e.time, (v) => { e.time = v; envChanged(true); }));
  }
  s.append(check('Time changes across frames (time lapse)', e.lapse, (v) => { e.lapse = v; envChanged(true); }));
  if (e.lapse) {
    s.append(slider('First frame', e.lapseFrom, 0, 48, 0.1, (v) => { e.lapseFrom = v; envChanged(); }, fmtClock));
    s.append(slider('Last frame', e.lapseTo, 0, 48, 0.1, (v) => { e.lapseTo = v; envChanged(); }, fmtClock));
    s.append(h('p', { class: 'note' }, 'Each frame gets its own time, from the first to the last. Go past midnight to run into the next day.'));
  }
  s.append(chipRow('Clouds', [['none', 'None'], ['few', 'A few'], ['some', 'Some'], ['lots', 'Lots'], ['overcast', 'Overcast']], e.clouds || 'none', (v) => { e.clouds = v; envChanged(true); }));
  if ((CLOUD_COVER[e.clouds] ?? 0) > 0) {
    s.append(slider('Wind', e.wind ?? 1, 0, 6, 0.05, (v) => { e.wind = v; envChanged(); }, (v) => (v < 0.05 ? 'still' : `${Math.round(v * 10)} m/s`)));
    s.append(slider('Wind direction', e.windDir ?? 35, 0, 360, 1, (v) => { e.windDir = v; envChanged(); }, (v) => `${Math.round(v)}°`));
    s.append(h('p', { class: 'note', style: 'margin:-2px 0 10px' }, 'Clouds drift with your frames, so they move when you play or export.'));
  }
  if (e.skyMode === 'dynamic') s.append(slider('Haze', e.haze, 1, 20, 0.1, (v) => { e.haze = v; envChanged(); }, (v) => v.toFixed(1)));
  if (e.skyMode === 'gradient') {
    const top = wheelIn('Top color', e.skyTop, (c) => { e.skyTop = c; top.setDot(c); applyEnv(timeAt(proj.current)); }, true);
    const bot = wheelIn('Horizon color', e.skyBottom, (c) => { e.skyBottom = c; bot.setDot(c); applyEnv(timeAt(proj.current)); });
    s.append(top.el, bot.el);
  }
  if (e.skyMode === 'solid') {
    const sc = wheelIn('Sky color', e.sky, (c) => { e.sky = c; sc.setDot(c); applyEnv(timeAt(proj.current)); }, true);
    s.append(sc.el);
  }
  s.append(
    slider('Sun & moon brightness', e.light, 0, 2.5, 0.01, (v) => { e.light = v; envChanged(); }, (v) => Math.round(v * 100) + '%'),
    slider('Ambient light', e.ambient, 0, 2.5, 0.01, (v) => { e.ambient = v; envChanged(); }, (v) => Math.round(v * 100) + '%'),
    slider('Fog', e.fog, 0, 1, 0.01, (v) => { e.fog = v; envChanged(); }, (v) => Math.round(v * 100) + '%'));
  const tint = wheelIn('Sunlight color', e.sunTint, (c) => { e.sunTint = c; tint.setDot(c); applyEnv(timeAt(proj.current)); });
  s.append(tint.el);
  const gnd = wheelIn('Ground color', e.groundColor, (c) => { e.groundColor = c; gnd.setDot(c); applyEnv(timeAt(proj.current)); });
  s.append(check('Ground', e.ground, (v) => { e.ground = v; envChanged(); }), gnd.el,
    check('Grid (not exported)', e.grid, (v) => { e.grid = v; applyEnv(timeAt(proj.current)); saveSoon(); }));
  return s;
}

function lightsSection() {
  const s = h('div', { class: 'sect' }, h('h3', {}, 'Lights'));
  const add = h('div', { class: 'row' });
  for (const [type, label] of Object.entries(LIGHT_TYPES)) {
    add.append(h('button', { type: 'button', class: 'btn', style: 'height:32px;padding:0 10px;font-size:13px', onclick: () => {
      const L = addLight(type);
      setTool('camera');
      selectLight(L);
      markAllThumbs(); saveSoon();
      toast(`${L.name} added in front of you`);
    } }, '+ ' + label));
  }
  s.append(add);
  if (lights.length) {
    const list = h('ul', { class: 'list', style: 'margin-top:10px' });
    for (const L of lights) {
      const pw = h('button', { type: 'button', class: 'mini' + (L.on ? '' : ' off'), 'aria-label': (L.on ? 'Turn off ' : 'Turn on ') + L.name, 'aria-pressed': String(L.on) },
        svg('<path d="M12 3v8"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>'));
      pw.addEventListener('click', () => { L.on = !L.on; applyLight(L); markAllThumbs(); saveSoon(); renderScenePane(); });
      const dot = h('i', { class: 'dot' }); dot.style.background = L.color;
      const nm = h('button', { type: 'button', class: 'nm' }, dot, ' ', L.name);
      nm.addEventListener('click', () => { setTool('camera'); selectLight(L); });
      const del = h('button', { type: 'button', class: 'mini', 'aria-label': 'Delete ' + L.name }, svg(ICON.trash));
      del.addEventListener('click', () => { removeLight(L); markAllThumbs(); saveSoon(); renderScenePane(); });
      list.append(h('li', { class: selectedLight === L ? 'sel' : '' }, pw, nm, del));
    }
    s.append(list);
  } else {
    s.append(h('p', { class: 'note', style: 'margin-top:8px' }, 'Add a light, then drag it into place. Spotlights, directional lights and area panels shine the way they face: use Aim to point them.'));
  }
  s.append(h('div', { style: 'margin-top:6px' }, check('Show light icons (not exported)', lightIconsOn, (v) => { lightIconsOn = v; lightsVisible(!playing); saveSoon(); })));

  const L = selectedLight;
  if (L) {
    const box = h('div', { class: 'lightbox' }, h('h3', {}, L.name));
    const modeBtn = (mode, label) => {
      const b = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(gizmo.mode === mode), style: gizmo.mode === mode ? 'background:var(--bg-4)' : '' }, label);
      b.addEventListener('click', () => { gizmo.setMode(mode); renderScenePane(); });
      return b;
    };
    box.append(h('div', { class: 'row', style: 'margin-bottom:8px' }, modeBtn('translate', 'Move'), L.type === 'point' ? null : modeBtn('rotate', 'Aim'),
      h('button', { type: 'button', class: 'btn', onclick: () => {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        L.root.position.copy(camera.position).addScaledVector(fwd, 3);
        L.root.quaternion.copy(camera.quaternion);
        markAllThumbs(); saveSoon();
      } }, 'Bring here'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { const n = await promptDlg('Rename light', L.name); if (n) { L.name = n.slice(0, 30); renderScenePane(); saveSoon(); } } }, 'Rename')));
    const cw = colorWheel({ value: L.color, label: L.name + ' color', size: 150,
      onInput: (c) => { L.color = c; applyLight(L); },
      onChange: () => { markAllThumbs(); saveSoon(); renderScenePane(); } });
    box.append(h('p', { class: 'note', style: 'margin:0 0 6px' }, 'Light color'), cw.el);
    const max = LIGHT_MAX[L.type];
    box.append(slider('Brightness', L.intensity, 0, max, max / 400, (v) => { L.intensity = v; applyLight(L); markAllThumbs(); saveSoon(); }, (v) => (v < 10 ? v.toFixed(1) : Math.round(v))));
    if (L.type === 'point' || L.type === 'spot') box.append(slider('Reach', L.distance, 1, 80, 0.5, (v) => { L.distance = v; applyLight(L); markAllThumbs(); saveSoon(); }, (v) => v + ' m'));
    if (L.type === 'spot') {
      box.append(slider('Cone width', L.angle, 4, 85, 1, (v) => { L.angle = v; applyLight(L); markAllThumbs(); saveSoon(); }, (v) => v + '°'));
      box.append(slider('Soft edge', L.penumbra, 0, 1, 0.01, (v) => { L.penumbra = v; applyLight(L); markAllThumbs(); saveSoon(); }, (v) => Math.round(v * 100) + '%'));
    }
    if (L.type === 'area') {
      box.append(slider('Width', L.width, 0.2, 12, 0.1, (v) => { L.width = v; applyLight(L); markAllThumbs(); saveSoon(); }, (v) => v.toFixed(1) + ' m'));
      box.append(slider('Height', L.height, 0.2, 12, 0.1, (v) => { L.height = v; applyLight(L); markAllThumbs(); saveSoon(); }, (v) => v.toFixed(1) + ' m'));
      box.append(h('p', { class: 'note' }, 'Area panels give soft light on painted (standard) materials. They don’t cast shadows.'));
    } else {
      box.append(check('Casts shadows', L.shadow, (v) => { L.shadow = v; applyLight(L); markAllThumbs(); saveSoon(); }));
    }
    box.append(h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { type: 'button', class: 'btn', onclick: () => selectLight(null) }, 'Done')));
    s.append(box);
  }
  return s;
}

function dropToFloor(m) {
  m.root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(m.root);
  if (!b.isEmpty()) m.root.position.y -= b.min.y;
  markAllThumbs(); saveSoon();
}

let activeTab = 'Brush';
const TAB_TITLES = { Brush: 'Brush', Layers: 'Layers', Scene: '3D scene' };
function showTab(name) {
  activeTab = name;
  for (const t of ['Brush', 'Layers', 'Scene']) {
    $('tab' + t).setAttribute('aria-selected', String(t === name));
    $('pane' + t).classList.toggle('on', t === name);
  }
  $('sideTitle').textContent = TAB_TITLES[name];
  if (name === 'Brush') renderBrushPane();
  if (name === 'Layers') renderLayersPane();
  if (name === 'Scene') renderScenePane();
}
/* ---------- slide-out drawers */
function sideIsOpen() { return $('side').classList.contains('open'); }
const SHORT_SCREEN = () => window.innerHeight < 500;
function setSide(open) {
  // on short (landscape phone) screens only one drawer is open at a time
  if (open && SHORT_SCREEN() && $('time').classList.contains('open')) setTimeline(false);
  $('side').classList.toggle('open', open);
  $('app').classList.toggle('side-open', open);
  for (const t of ['Brush', 'Layers', 'Scene']) $('tab' + t).setAttribute('aria-expanded', String(open && activeTab === t));
  store('side', open);
}
/** Opens the side drawer on a tab (used when you pick something that has settings). */
function openPanel(name) { showTab(name); setSide(true); }
function toggleTab(name) {
  if (sideIsOpen() && activeTab === name) setSide(false);
  else openPanel(name);
}
function setTimeline(open) {
  if (open && SHORT_SCREEN() && $('side').classList.contains('open')) setSide(false);
  $('time').classList.toggle('open', open);
  $('app').classList.toggle('time-open', open);
  $('timeTab').setAttribute('aria-expanded', String(open));
  store('timeline', open);
  if (open) scrollStripToCurrent();
}
function store(k, v) { try { localStorage.setItem('heemb4by.' + k, JSON.stringify(v)); } catch { /* ignore */ } }
function recall(k, d) { try { const v = localStorage.getItem('heemb4by.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
for (const t of ['Brush', 'Layers', 'Scene']) $('tab' + t).addEventListener('click', () => toggleTab(t));
$('sideClose').addEventListener('click', () => setSide(false));
$('timeTab').addEventListener('click', () => setTimeline(!$('time').classList.contains('open')));

function renderTools() {
  const nav = $('tools');
  nav.innerHTML = '';
  for (const t of TOOLS) {
    const b = h('button', { type: 'button', class: 'tool', 'aria-pressed': String(t.id === tool), 'aria-label': t.label, title: `${t.label} (${t.key})` }, svg(t.icon), h('span', { class: 'k', 'aria-hidden': 'true' }, t.key));
    b.addEventListener('click', () => setTool(t.id));
    nav.append(b);
    if (t.id === 'camera') nav.append(h('hr'));
  }
  const now = h('button', { type: 'button', class: 'swatch-now', 'aria-label': 'Current color' });
  now.style.background = brush.color;
  now.addEventListener('click', () => openPanel('Brush'));
  nav.append(h('hr'), now);
}

function setTool(id) {
  if (stroke) return;
  tool = id;
  if (id !== 'camera' && selectedArt) { dropArt(); if (activeTab === 'Layers') renderLayersPane(); }
  drawCanvas.style.pointerEvents = id === 'camera' ? 'none' : 'auto';
  drawCanvas.style.cursor = id === 'picker' ? 'copy' : id === 'fill' ? 'cell' : 'crosshair';
  reattachGizmo();
  renderTools();
  if (activeTab === 'Brush') renderBrushPane();
  updateFlyPad();
}

/* =================================================================== dialogs */

const scrim = $('scrim'), dlg = $('dlg');
let dlgClose = null, lastFocus = null;
function openDlg(build, onClose) {
  lastFocus = document.activeElement;
  dlg.innerHTML = '';
  dlg.classList.remove('wide');
  build(dlg);
  scrim.classList.add('open');
  dlgClose = onClose || null;
  (dlg.querySelector('[autofocus]') || dlg.querySelector('input, button'))?.focus();
}
function closeDlg() {
  scrim.classList.remove('open');
  const c = dlgClose; dlgClose = null;
  if (c) c();
  lastFocus?.focus?.();
}
scrim.addEventListener('click', (e) => { if (e.target === scrim) closeDlg(); });

function confirmDlg(title, msg, ok) {
  return new Promise((res) => {
    let answered = false;
    openDlg((d) => d.append(h('h2', { id: 'dlgTitle' }, title), h('p', {}, msg), h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'btn', autofocus: true, onclick: () => closeDlg() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { answered = true; closeDlg(); } }, ok))),
    () => res(answered));
  });
}
function promptDlg(title, value) {
  return new Promise((res) => {
    let result = null;
    const inp = h('input', { class: 'proj', style: 'width:100%;max-width:none', autofocus: true });
    inp.value = value;
    const ok = () => { result = inp.value.trim() || null; closeDlg(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    openDlg((d) => d.append(h('h2', { id: 'dlgTitle' }, title), inp, h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'btn', onclick: () => closeDlg() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn primary', onclick: ok }, 'OK'))), () => res(result));
    inp.select();
  });
}

let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900); }

function tweenDialog() {
  let n = 3;
  openDlg((d) => {
    const opts = h('div', { class: 'opts', role: 'group', 'aria-label': 'Number of frames' });
    for (const v of [1, 2, 3, 4, 6, 8, 12]) {
      const b = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(v === n) }, String(v));
      b.addEventListener('click', () => { n = v; opts.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
      opts.append(b);
    }
    d.append(h('h2', { id: 'dlgTitle' }, 'Add in-between frames'),
      h('p', {}, `Adds empty frames between frame ${proj.current + 1} and ${proj.current + 2}, with the camera moving smoothly from one view to the other.`),
      opts, h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn', onclick: () => closeDlg() }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => { closeDlg(); addInbetweens(n); } }, 'Add frames')));
  });
}

/* =================================================================== export */

function exportDialog() {
  if (playing) stopPlay();
  const canVideo = typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  let loops = 1;
  openDlg((d) => {
    const lo = h('div', { class: 'opts', role: 'group', 'aria-label': 'Times to play' });
    for (const v of [1, 2, 3, 5]) {
      const b = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(v === loops) }, `${v}×`);
      b.addEventListener('click', () => { loops = v; lo.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
      lo.append(b);
    }
    d.append(h('h2', { id: 'dlgTitle' }, 'Export your animation'),
      h('p', {}, `${proj.frames.length} frame${proj.frames.length === 1 ? '' : 's'} at ${proj.fps} fps, ${proj.W}×${proj.H}. The grid and move handles are left out.`),
      canVideo ? h('div', {}, h('p', { style: 'margin-bottom:6px' }, 'Play the animation'), lo) : h('p', {}, 'Video export isn’t available in this browser. You can still export the current frame.'),
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn', onclick: () => closeDlg() }, 'Cancel'),
        h('button', { type: 'button', class: 'btn', onclick: () => { closeDlg(); exportFrame(); } }, 'This frame (PNG)'),
        canVideo ? h('button', { type: 'button', class: 'btn primary', onclick: () => { closeDlg(); exportVideo(loops); } }, 'Video') : null));
  });
}

function renderExportFrame(ctx, i) {
  const f = proj.frames[i];
  applyCam(f.cam);
  setModelTimes(i);
  syncSheets(i, true);
  renderer.render(scene, camera);
  ctx.clearRect(0, 0, proj.W, proj.H);
  ctx.drawImage(glc, 0, 0, proj.W, proj.H);
}

function withExportRenderer(fn) {
  exporting = true;
  const keepGrid = grid.visible, keepGizmo = gizmo.object;
  grid.visible = false; gizmo.detach(); camsVisible(false);
  const prevRatio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(proj.W, proj.H, false);
  const restore = () => {
    grid.visible = keepGrid;
    if (keepGizmo && tool === 'camera') gizmo.attach(keepGizmo);
    renderer.setPixelRatio(prevRatio);
    layoutBox();
    exporting = false;
    camsVisible(true);
    goTo(proj.current);
  };
  return Promise.resolve().then(fn).finally(restore);
}

function exportFrame() {
  const c = makeCanvas();
  withExportRenderer(async () => { await prepMediaFor(proj.current); renderExportFrame(c.getContext('2d'), proj.current); }).then(() => {
    const url = c.toDataURL('image/png');
    c.toBlob((blob) => {
      openDlg((d) => d.append(h('h2', { id: 'dlgTitle' }, `Frame ${proj.current + 1}`),
        h('p', {}, inPreview ? 'Downloads are blocked inside this preview. Right-click or long-press the picture to save it, or open the site at njb3300-art.github.io/HEEMB4by.' : 'Save it with Download, or right-click / long-press the picture.'),
        h('img', { src: url, alt: `Frame ${proj.current + 1} of ${proj.name}` }),
        h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn', onclick: () => closeDlg() }, 'Done'), ...saveButtons(blob, `${safeName()} frame ${proj.current + 1}.png`))));
    }, 'image/png');
  });
}

async function exportVideo(loops) {
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const withSound = hasSound();
  let soundDest = null;
  if (withSound) {
    try { const ac = audioCtx(); await ac.resume?.(); soundDest = ac.createMediaStreamDestination(); stream.addTrack(soundDest.stream.getAudioTracks()[0]); }
    catch { soundDest = null; }
  }
  const types = soundDest ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });

  const total = proj.frames.length * loops;
  openDlg((d) => d.append(h('h2', { id: 'dlgTitle' }, 'Recording video…'), h('p', { id: 'expProg' }, `Frame 0 of ${total}`)));
  await withExportRenderer(async () => {
    rec.start();
    const wait = 1000 / proj.fps;
    for (let k = 0; k < total; k++) {
      const t0 = performance.now();
      await prepMediaFor(k % proj.frames.length);
      if (soundDest && k % proj.frames.length === 0) { stopSounds(); startSounds(0, soundDest); }
      renderExportFrame(ctx, k % proj.frames.length);
      track.requestFrame?.();
      const prog = document.getElementById('expProg');
      if (prog) prog.textContent = `Frame ${k + 1} of ${total}`;
      await new Promise((r) => setTimeout(r, Math.max(0, wait - (performance.now() - t0))));
    }
    stopSounds();
    rec.stop();
    await done;
  });
  const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
  const url = URL.createObjectURL(blob);
  const kind = (rec.mimeType || 'video/webm').includes('mp4') ? 'MP4' : 'WebM';
  openDlg((d) => d.append(h('h2', { id: 'dlgTitle' }, 'Your video'),
    h('p', {}, `${kind}, ${(blob.size / 1048576).toFixed(1)} MB. ` + (inPreview ? 'Downloads are blocked inside this preview. Right-click the video and choose Save video as, or open the site at njb3300-art.github.io/HEEMB4by to download.' : 'Tap Download to save it.')),
    h('video', { src: url, controls: true, autoplay: true, loop: true, playsinline: true }),
    h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn', onclick: () => closeDlg() }, 'Done'), ...saveButtons(blob, `${safeName()}.${kind === 'MP4' ? 'mp4' : 'webm'}`))),
  () => setTimeout(() => URL.revokeObjectURL(url), 1000));
}

/* =================================================================== saving (IndexedDB) */

let db = null;
function openDB() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('heemb4by', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
function idb(mode, fn) {
  return new Promise((res, rej) => {
    if (!db) return res(null);
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

let saveTimer = 0, saving = false, saveAgain = false;
function saveSoon() {
  if (!db) return;
  $('saveStatus').textContent = 'Unsaved changes';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
}
const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
let switching = false; // true while one project is being swapped for another: no saving then
async function saveNow() {
  if (!db || switching) return;
  if (saving) { saveAgain = true; return; }
  saving = true;
  $('saveStatus').textContent = 'Saving…';
  try {
    const frames = [];
    for (const f of proj.frames) {
      const sheets = [];
      for (const s of f.sheets) {
        if (!proj.layers.some((l) => l.id === s.layerId)) continue;
        if (s.dirty || !s.blob) { s.blob = await toBlob(s.canvas); s.dirty = false; }
        sheets.push({ id: s.id, layerId: s.layerId, anchor: s.anchor, xf: s.xf || null, blob: s.blob });
      }
      frames.push({ id: f.id, cam: f.cam, camId: f.camId, sheets });
    }
    const data = {
      v: 1,
      meta: { name: proj.name, W: proj.W, H: proj.H, fps: proj.fps, importCount: proj.importCount || 0, layers: proj.layers, activeLayer: proj.activeLayer, current: proj.current, env: proj.env, draw: proj.draw },
      frames,
      media: proj.media.filter((m) => proj.layers.some((l) => l.media?.id === m.id)).map((m) => ({ id: m.id, kind: m.kind, name: m.name, blob: m.blob })),
      mediaSheets: [...mediaSheets].filter(([lid]) => layerIndex(lid) >= 0).map(([lid, sh]) => ({ lid, mediaId: sh.mediaId, id: sh.id, anchor: sh.anchor, xf: sh.xf || null, homeXf: sh.homeXf || null })),
      cams: sceneCams.map((c) => ({ id: c.id, name: c.name, ...camView(c) })),
      lights: lights.map((L) => ({ id: L.id, type: L.type, name: L.name, on: L.on, color: L.color, intensity: L.intensity, distance: L.distance, angle: L.angle, penumbra: L.penumbra, width: L.width, height: L.height, shadow: L.shadow, transform: getTransform(L.root) })),
      lightIconsOn,
      conesOn,
      models: models.map((m) => ({ id: m.id, kind: m.kind, name: m.name, files: m.files, visible: m.visible, animate: m.animate, clip: m.clip, transform: getTransform(m.root), inner: m.kind === 'file' ? getTransform(m.inner) : null })),
    };
    if (!proj.id) proj.id = uid();
    const list = await projList();
    let entry = list.find((p) => p.id === proj.id);
    if (!entry && list.length >= MAX_PROJECTS) { $('saveStatus').textContent = 'Not saved: 10 projects max'; return; }
    await idb('readwrite', (s) => s.put(data, projKey(proj.id)));
    let thumb = null;
    try { const t = proj.frames[0]?.thumb; if (t && t.width) thumb = t.toDataURL('image/jpeg', 0.7); } catch { /* no thumbnail */ }
    if (!entry) { entry = { id: proj.id }; list.unshift(entry); }
    Object.assign(entry, { name: proj.name, updated: Date.now(), frames: proj.frames.length, thumb: thumb || entry.thumb || null });
    await kvPut(listKey(), list);
    await kvPut(lastKey(), proj.id);
    $('saveStatus').textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    $('saveStatus').textContent = 'Couldn’t save (storage full?)';
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; saveSoon(); }
  }
}

async function loadSaved(id) {
  const data = await idb('readonly', (s) => s.get(projKey(id))).catch(() => null);
  if (!data || !data.meta) return false;
  const m = data.meta;
  Object.assign(proj, { name: m.name, W: m.W, H: m.H, fps: m.fps, layers: m.layers, activeLayer: m.activeLayer, env: { ...proj.env, ...m.env }, draw: { mode: 'auto', dist: 6, front: true, lit: true, ...(m.draw || {}) } });
  proj.frames = [];
  proj.importCount = m.importCount || 0;
  mediaSheets.clear(); proj.media = [];
  for (const md of data.media || []) { try { proj.media.push(await makeMedia(md.blob, md.kind, md.name, md.id)); } catch { /* skip */ } }
  for (const ms of data.mediaSheets || []) {
    const mm = mediaById(ms.mediaId); if (!mm) continue;
    const sh = newSheet(ms.lid, ms.anchor, mm.canvas); sh.id = ms.id; sh.xf = ms.xf || null; sh.homeXf = ms.homeXf || null; sh.mediaId = mm.id; sh.media = true; sh.dirty = false;
    mediaSheets.set(ms.lid, sh);
  }
  conesOn = data.conesOn ?? true;
  for (const cd of data.cams || []) addSceneCam(cd, cd);
  lightIconsOn = data.lightIconsOn ?? true;
  const OLD_DEFAULT = { point: 20, spot: 60, area: 8, dir: 2 };
  for (const ld of data.lights || []) {
    if (ld.intensity === OLD_DEFAULT[ld.type]) ld.intensity = LIGHT_DEFAULTS[ld.type].intensity; // lights made before they were brightened
    try { addLight(ld.type, ld); } catch { /* skip */ }
  }
  for (const fd of data.frames) {
    const f = newFrame(fd.cam, fd.camId || null);
    f.id = fd.id;
    const readCanvas = async (blob) => { const bmp = await createImageBitmap(blob); const c = makeCanvas(); c.getContext('2d').drawImage(bmp, 0, 0); return c; };
    for (const sd of fd.sheets || []) {
      try { const s = newSheet(sd.layerId, sd.anchor, await readCanvas(sd.blob)); s.id = sd.id; s.xf = sd.xf || null; s.blob = sd.blob; s.dirty = false; f.sheets.push(s); }
      catch { /* skip unreadable drawing */ }
    }
    // older saves: one flat drawing per layer, pinned to the frame's own camera
    for (const [lid, blob] of Object.entries(fd.blobs || {})) {
      try { f.sheets.push(newSheet(lid, { ...fd.cam, aspect: m.W / m.H, dist: 6 }, await readCanvas(blob))); }
      catch { /* skip unreadable drawing */ }
    }
    proj.frames.push(f);
  }
  for (const md of data.models || []) {
    try {
      if (md.kind === 'sample') addSampleModel(md);
      else await addModelFromFiles({ name: md.name, files: md.files }, md);
    } catch (e) { toast(`Couldn’t reload ${md.name}`); }
  }
  proj.current = Math.min(m.current || 0, proj.frames.length - 1);
  return proj.frames.length > 0;
}

function clearSheetMeshes() {
  dropArt();
  for (const m of [...sheetGroup.children]) { sheetGroup.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }
  for (const f of proj.frames) for (const s of f.sheets || []) { s.mesh = null; s.tex = null; }
  for (const s of mediaSheets.values()) { s.mesh = null; s.tex = null; }
}
function freshProject(opts = {}) {
  clearSheetMeshes();
  proj.draw = { mode: 'auto', dist: 6, front: true, lit: true };
  mediaSheets.clear(); for (const m of proj.media) URL.revokeObjectURL(m.url); proj.media = []; proj.importCount = 0;
  proj.name = opts.name || 'My animation';
  proj.W = opts.W || 960; proj.H = opts.H || 540;
  const l = newLayer('Ink');
  proj.layers = [newLayer('Color'), l];
  proj.activeLayer = l.id;
  proj.frames = [newFrame(captureCam())];
  proj.current = 0;
  proj.id = uid();
}

async function newProjectDialog() {
  await saveNow();
  if (!(await newProjectAllowed())) return;
  const sizes = [['Wide', 960, 540], ['Wide HD', 1280, 720], ['Square', 720, 720], ['Tall (phone)', 540, 960], ['Classic 4:3', 960, 720]];
  let pick = 0, keepScene = false;
  openDlg((d) => {
    const nameIn = h('input', { class: 'proj', style: 'width:100%;max-width:none', 'aria-label': 'Project name', autofocus: true }); nameIn.value = 'My animation';
    const opts = h('div', { class: 'opts', role: 'group', 'aria-label': 'Picture size' });
    sizes.forEach(([n, w, hh], i) => {
      const b = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(i === pick) }, `${n} ${w}×${hh}`);
      b.addEventListener('click', () => { pick = i; opts.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
      opts.append(b);
    });
    d.append(h('h2', { id: 'dlgTitle' }, 'New project'), h('p', {}, 'Your current project stays saved in projectsbby<3.'),
      nameIn, h('p', { style: 'margin:14px 0 6px' }, 'Picture size'), opts,
      h('div', { style: 'margin-top:10px' }, check('Keep this project’s 3D scene (otherwise you start fresh in Sample town)', keepScene, (v) => { keepScene = v; })),
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn', onclick: () => closeDlg() }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => {
          const [, w, hh] = sizes[pick];
          closeDlg();
          clearSheetMeshes(); stopSounds();
          if (!keepScene) {
            for (const m of [...models]) removeModel(m); for (const c of [...sceneCams]) removeSceneCam(c); for (const L of [...lights]) removeLight(L);
            addSampleModel();
            proj.env = { ...ENV_DEFAULTS };
            resetStartView();
          }
          freshProject({ name: nameIn.value.trim() || 'My animation', W: w, H: hh });
          undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
          startUI();
          saveNow();
        } }, 'Create')));
  });
}

/* =================================================================== accounts & projects
   Accounts and projects live in this browser (IndexedDB). Each person (or the guest space)
   keeps up to 10 projects. Passwords are stored only as a salted PBKDF2 hash. */

const MAX_PROJECTS = 10;
let user = null; // { name } while logged in
proj.id = null;
const space = () => (user ? 'u:' + user.name.toLowerCase() : 'guest');
const projKey = (id, sp = space()) => `proj:${sp}:${id}`;
const listKey = (sp = space()) => `list:${sp}`;
const lastKey = (sp = space()) => `last:${sp}`;
const kvGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => null);
const kvPut = (k, v) => idb('readwrite', (s) => s.put(v, k));
const kvDel = (k) => idb('readwrite', (s) => s.delete(k));
async function projList(sp = space()) { return (await kvGet(listKey(sp))) || []; }

/** Older versions kept one project under "project": it becomes the first guest project. */
async function migrateLegacy() {
  const old = await kvGet('project');
  if (!old || !old.meta) return;
  const list = await projList('guest');
  if (list.length < MAX_PROJECTS) {
    const id = uid();
    await kvPut(projKey(id, 'guest'), old);
    list.unshift({ id, name: old.meta.name || 'My animation', updated: Date.now(), frames: (old.frames || []).length, thumb: null });
    await kvPut(listKey('guest'), list);
    await kvPut(lastKey('guest'), id);
  }
  await kvDel('project');
}

/** The camera spot a brand-new project starts from (looking into Sample town). */
function resetStartView() {
  if (hopped) hopOut();
  camera.position.set(13, 3, 12);
  camera.lookAt(0, 1, 0);
  syncControllersFromCamera();
}
function clearScene() {
  if (playing) stopPlay();
  stopSounds();
  for (const m of [...models]) removeModel(m);
  for (const c of [...sceneCams]) removeSceneCam(c);
  for (const L of [...lights]) removeLight(L);
  clearSheetMeshes();
  proj.frames = [];
  undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
}
async function openProject(id, { save = true } = {}) {
  if (save) await saveNow();
  clearTimeout(saveTimer);
  switching = true;
  clearScene();
  let ok = false;
  try { ok = await loadSaved(id); } catch { ok = false; } finally { switching = false; }
  if (ok) proj.id = id;
  else { toast('That project couldn’t be opened'); addSampleModel(); proj.env = { ...ENV_DEFAULTS }; resetStartView(); freshProject(); }
  await kvPut(lastKey(), proj.id);
  startUI();
  $('saveStatus').textContent = ok ? 'Opened ' + proj.name : '';
}
/** After logging in or out: open that space's last project, or start a new one. */
async function openSpace() {
  const list = await projList();
  let id = await kvGet(lastKey());
  if (!list.some((p) => p.id === id)) id = list[0]?.id;
  if (id) return openProject(id, { save: false });
  clearScene(); addSampleModel(); proj.env = { ...ENV_DEFAULTS }; resetStartView(); freshProject(); startUI(); saveNow();
}
async function newProjectAllowed() {
  const list = await projList();
  if (list.length >= MAX_PROJECTS) {
    await confirmDlg('10 projects saved', 'You can keep up to 10 projects. Open projectsbby<3 and delete one to make room.', 'OK');
    return false;
  }
  return true;
}
async function deleteProject(id) {
  clearTimeout(saveTimer);
  if (id === proj.id) proj.id = null; // never re-save the one being deleted
  let list;
  switching = true;
  try {
    await kvDel(projKey(id));
    list = (await projList()).filter((p) => p.id !== id);
    await kvPut(listKey(), list);
  } finally { switching = false; }
  if (proj.id === null) {
    if (list.length) await openProject(list[0].id, { save: false });
    else { clearScene(); addSampleModel(); proj.env = { ...ENV_DEFAULTS }; resetStartView(); freshProject(); startUI(); saveNow(); }
  }
}

/* ---------- passwords */
async function hashPw(name, pw, salt) {
  if (!window.crypto?.subtle) throw new Error('no-crypto');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt + ':' + name.toLowerCase()), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function signUp(name, pw, moveGuest) {
  name = name.trim();
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(name)) return 'Usernames are 3–20 letters, numbers, dots, dashes or underscores.';
  if (pw.length < 4) return 'Use a password of at least 4 characters.';
  const users = (await kvGet('users')) || {};
  if (users[name.toLowerCase()]) return 'That username is taken on this device. Try logging in.';
  const salt = randSalt();
  users[name.toLowerCase()] = { name, salt, hash: await hashPw(name, pw, salt), created: Date.now() };
  await kvPut('users', users);
  await saveNow();
  const fromGuest = moveGuest ? await projList('guest') : [];
  user = { name };
  if (fromGuest.length) {
    const mine = await projList();
    const moving = fromGuest.slice(0, MAX_PROJECTS - mine.length);
    for (const p of moving) {
      const data = await kvGet(projKey(p.id, 'guest'));
      if (data) await kvPut(projKey(p.id), data);
      await kvDel(projKey(p.id, 'guest'));
    }
    await kvPut(listKey(), [...moving, ...mine]);
    await kvPut(listKey('guest'), fromGuest.slice(moving.length));
    if (moving.some((p) => p.id === proj.id)) await kvPut(lastKey(), proj.id);
  }
  return null;
}
async function logIn(name, pw) {
  const users = (await kvGet('users')) || {};
  const u = users[name.trim().toLowerCase()];
  if (!u || (await hashPw(u.name, pw, u.salt)) !== u.hash) return 'Wrong username or password.';
  await saveNow();
  user = { name: u.name };
  return null;
}
async function logOut() {
  await saveNow();
  user = null;
  store('user', null);
  updateAcctButton();
  await openSpace();
  toast('Logged out');
}
function updateAcctButton() {
  $('acctLabel').textContent = user ? user.name : 'Log in';
  $('acctBtn').setAttribute('aria-label', user ? `Account: ${user.name}` : 'Log in or sign up');
}

function accountDialog(mode = 'login') {
  if (user) {
    openDlg((d) => d.append(h('h2', { id: 'dlgTitle' }, `Hi, ${user.name}`),
      h('p', {}, 'Your projects are saved under your account in this browser.'),
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn', onclick: () => { closeDlg(); logOut(); } }, 'Log out'),
        h('button', { type: 'button', class: 'btn', onclick: () => { closeDlg(); projectsDialog(); } }, 'projectsbby<3'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => closeDlg() }, 'Done'))));
    return;
  }
  openDlg((d) => {
    const seg = h('div', { class: 'opts', role: 'group', 'aria-label': 'Log in or sign up' });
    for (const [m, label] of [['login', 'Log in'], ['signup', 'Sign up']]) {
      const b = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(m === mode) }, label);
      b.addEventListener('click', () => accountDialog(m));
      seg.append(b);
    }
    const nameIn = h('input', { class: 'proj acct-in', type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Username', placeholder: 'Username', autofocus: true });
    const pwIn = h('input', { class: 'proj acct-in', type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', 'aria-label': 'Password', placeholder: 'Password' });
    const err = h('p', { class: 'acct-err', role: 'alert' });
    let remember = true, moveGuest = true;
    const go = async () => {
      err.textContent = '';
      btn.disabled = true;
      try {
        const why = mode === 'signup' ? await signUp(nameIn.value, pwIn.value, moveGuest) : await logIn(nameIn.value, pwIn.value);
        if (why) { err.textContent = why; btn.disabled = false; return; }
        store('user', remember ? user.name : null);
        updateAcctButton();
        closeDlg();
        await openSpace();
        toast(mode === 'signup' ? `Welcome, ${user.name}!` : `Welcome back, ${user.name}!`);
      } catch (e) {
        err.textContent = String(e?.message) === 'no-crypto' ? 'Accounts need a secure (https) page.' : 'Something went wrong. Try again.';
        btn.disabled = false;
      }
    };
    const btn = h('button', { type: 'submit', class: 'btn primary' }, mode === 'signup' ? 'Create account' : 'Log in');
    const form = h('form', { class: 'acct-form' }, nameIn, pwIn,
      check('Keep me logged in on this device', remember, (v) => { remember = v; }),
      mode === 'signup' ? check('Move my guest projects into this account', moveGuest, (v) => { moveGuest = v; }) : null,
      err,
      h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn', onclick: () => closeDlg() }, 'Cancel'), btn));
    form.addEventListener('submit', (e) => { e.preventDefault(); go(); });
    d.append(h('h2', { id: 'dlgTitle' }, mode === 'signup' ? 'Make an account' : 'Log in'), seg,
      h('p', { class: 'note', style: 'margin:10px 0' }, 'Heemb4by is free forever. Everything you make with it is yours. Your account and projects are kept in this browser on this device. They don’t sync to other devices, and clearing your browser data removes them.'),
      form);
  });
}

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};
async function projectsDialog() {
  await saveNow();
  const list = (await projList()).sort((a, b) => b.updated - a.updated);
  openDlg((d) => {
    d.classList.add('wide');
    const grid = h('div', { class: 'pgrid' });
    for (const p of list) {
      const cur = p.id === proj.id;
      const del = h('button', { type: 'button', class: 'mini', 'aria-label': 'Delete ' + p.name, title: 'Delete' }, svg(ICON.trash));
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDlg(`Delete “${p.name}”?`, 'This can’t be undone.', 'Delete');
        if (ok) { await deleteProject(p.id); toast('Project deleted'); }
        projectsDialog();
      });
      const card = h('button', { type: 'button', class: 'pcard' + (cur ? ' cur' : ''), 'aria-label': `${cur ? 'Open now: ' : 'Open '}${p.name}` },
        p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('div', { class: 'pthumb' }),
        h('div', { class: 'pname' }, p.name),
        h('div', { class: 'pmeta' }, cur ? 'Open now' : `${p.frames || 1} frame${p.frames === 1 ? '' : 's'} · ${ago(p.updated)}`));
      card.addEventListener('click', async () => { closeDlg(); if (!cur) { await openProject(p.id); toast('Opened ' + p.name); } });
      grid.append(h('div', { class: 'pwrap' }, card, del));
    }
    if (!list.length) grid.append(h('p', { class: 'note' }, 'No saved projects yet.'));
    const full = list.length >= MAX_PROJECTS;
    const newB = h('button', { type: 'button', class: 'btn primary', onclick: () => { closeDlg(); newProjectDialog(); } }, '+ New project');
    if (full) newB.disabled = true;
    d.append(h('h2', { id: 'dlgTitle' }, 'projectsbby<3'),
      h('p', { class: 'note', style: 'margin:-4px 0 12px' }, `${user ? user.name + '’s' : 'Guest'} projects · ${list.length} / ${MAX_PROJECTS}${full ? ' · full, delete one to start another' : ''}`),
      grid,
      h('p', { class: 'note free-note' }, 'Heemb4by is free forever. Everything you make with it is yours.'),
      h('div', { class: 'acts' },
        user ? null : h('button', { type: 'button', class: 'btn', onclick: () => accountDialog('signup') }, 'Sign up to save under your name'),
        h('button', { type: 'button', class: 'btn', onclick: () => closeDlg() }, 'Close'), newB));
  }, () => dlg.classList.remove('wide'));
}

/* ---------- saving files out (downloads work on the real site; the Claude preview blocks them) */
const inPreview = (() => { try { return window.self !== window.top; } catch { return true; } })();
function saveButtons(blob, filename) {
  const row = [];
  const dl = h('button', { type: 'button', class: 'btn primary' }, 'Download');
  dl.addEventListener('click', () => {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (inPreview) toast('If nothing downloaded, open the site at njb3300-art.github.io/HEEMB4by to save files');
  });
  row.push(dl);
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      const sh = h('button', { type: 'button', class: 'btn' }, 'Share / Save to Photos');
      sh.addEventListener('click', () => navigator.share({ files: [file], title: proj.name }).catch(() => {}));
      row.push(sh);
    }
  } catch { /* no sharing */ }
  return row;
}
const safeName = () => (proj.name || 'animation').replace(/[^\w\- ]+/g, '').trim() || 'animation';

/* =================================================================== import */

async function importFiles(fileList) {
  const files = [];
  for (const f of fileList) files.push({ name: f.name, data: await f.arrayBuffer() });
  const groups = groupFiles(files);
  if (!groups.length) {
    const exts = files.map((f) => '.' + ext(f.name)).join(', ');
    toast(exts.includes('.drc') ? 'Draco .drc files aren’t supported' : `No 3D model found in ${exts || 'those files'}`);
    return;
  }
  for (const g of groups) {
    toast(`Loading ${g.name}…`);
    try {
      const m = await addModelFromFiles(g);
      setTool('camera');
      selectModel(m);
      showTab('Scene');
      markAllThumbs();
      toast(`${g.name} added${m.clips.length ? ` with ${m.clips.length} animation${m.clips.length > 1 ? 's' : ''}` : ''}`);
      saveSoon();
    } catch (e) {
      console.error(e);
      const why = /draco/i.test(String(e)) ? 'it uses Draco compression, which isn’t supported here' : (e?.message || 'unknown error');
      await confirmDlg('Couldn’t import ' + g.name, `The file couldn’t be read: ${why}. Try exporting it as GLB.`, 'OK');
    }
  }
}

$('modelInput').setAttribute('accept', ACCEPT);
$('modelInput').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
$('imageInput').addEventListener('change', async (e) => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) await importMedia(f); });

const app = $('app');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; app.classList.add('dropping'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) app.classList.remove('dropping'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; app.classList.remove('dropping');
  const files = [...(e.dataTransfer?.files || [])];
  const pics = files.filter((f) => mediaKind(f));
  if (pics.length && pics.length === files.length) (async () => { for (const f of pics) await importMedia(f); })();
  else if (files.length) importFiles(files);
});

/* =================================================================== keyboard & buttons */

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'file'].includes(a.type)) || a.tagName === 'SELECT');
}
window.addEventListener('keydown', (e) => {
  if (scrim.classList.contains('open')) { if (e.key === 'Escape') closeDlg(); return; }
  if (isTyping()) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (tool === 'camera' && camMode === 'fly' && ['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    fly.keys.add(k); e.preventDefault(); return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedArt) { e.preventDefault(); artDelete(); return; }
  if (e.key === 'Escape' && selectedArt) { selectArt(null); return; }
  if (selectedArt && tool === 'camera' && camMode !== 'fly' && !gizmo.dragging && (k === 'q' || k === 'e')) { artSpinBy(k === 'q' ? -15 : 15); if (activeTab === 'Layers') renderLayersPane(); return; }
  if (selectedArt && tool === 'camera' && !gizmo.dragging && (k === 'r' || k === 'm' || k === 'z')) { gizmo.setMode(k === 'm' ? 'translate' : k === 'r' ? 'rotate' : 'scale'); if (activeTab === 'Layers') renderLayersPane(); return; }
  if (k === 'h') { toggleHop(); return; }
  if (k === 'u') { if (!$('updateCamBtn').disabled) updateFrameCamera(); return; }
  if (k === 'b') { toggleTab('Brush'); return; }
  if (k === 'l') { toggleTab('Layers'); return; }
  if (k === 'g') { toggleTab('Scene'); return; }
  if (k === 't') { setTimeline(!$('time').classList.contains('open')); return; }
  if (e.key === 'Escape' && sideIsOpen()) { setSide(false); return; }
  if (k === 'c') { newCameraHere(); return; }
  const t = TOOLS.find((x) => x.key === e.key);
  if (t) { setTool(t.id); return; }
  if (e.key === ' ') { e.preventDefault(); playing ? stopPlay() : startPlay(); return; }
  if (e.key === ',') { if (playing) stopPlay(); goTo(proj.current - 1); scrollStripToCurrent(); return; }
  if (e.key === '.') { if (playing) stopPlay(); goTo(proj.current + 1); scrollStripToCurrent(); return; }
  if (e.key === 'Enter' && (document.activeElement === document.body || document.activeElement === drawCanvas || document.activeElement === glc)) { addFrameHere(); return; }
  if (e.key === '[' || e.key === ']') {
    if (BRUSH_TOOLS.includes(tool) || tool === 'eraser') {
      const v = Math.max(1, Math.min(200, Math.round(activeSize() * (e.key === ']' ? 1.2 : 1 / 1.2)) + (e.key === ']' ? 1 : 0)));
      setActiveSize(v);
      if (activeTab === 'Brush') renderBrushPane();
      toast(`Size ${v} px`);
    }
  }
});
window.addEventListener('keyup', (e) => fly.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => fly.keys.clear());

$('undoBtn').addEventListener('click', doUndo);
$('redoBtn').addEventListener('click', doRedo);
$('modeOrbit').addEventListener('click', () => { setCamMode('orbit'); setTool('camera'); });
$('modeFly').addEventListener('click', () => { setCamMode('fly'); setTool('camera'); });
$('addFrameBtn').addEventListener('click', addFrameHere);
$('hopBtn').addEventListener('click', toggleHop);
$('newCamBtn').addEventListener('click', newCameraHere);
$('updateCamBtn').addEventListener('click', updateFrameCamera);
$('playBtn').addEventListener('click', () => (playing ? stopPlay() : startPlay()));
$('hudPlay').addEventListener('click', () => (playing ? stopPlay() : startPlay()));
$('hudPrev').addEventListener('click', () => { if (playing) stopPlay(); goTo(proj.current - 1); scrollStripToCurrent(); });
$('hudNext').addEventListener('click', () => { if (playing) stopPlay(); goTo(proj.current + 1); scrollStripToCurrent(); });
$('firstBtn').addEventListener('click', () => { if (playing) stopPlay(); goTo(0); scrollStripToCurrent(); });
$('prevBtn').addEventListener('click', () => { if (playing) stopPlay(); goTo(proj.current - 1); scrollStripToCurrent(); });
$('nextBtn').addEventListener('click', () => { if (playing) stopPlay(); goTo(proj.current + 1); scrollStripToCurrent(); });
$('fps').addEventListener('change', (e) => { proj.fps = +e.target.value; if (playing) { playFrom = proj.current; playStart = performance.now(); } setModelTimes(proj.current); saveSoon(); });
$('onion').addEventListener('change', () => { displayDirty = true; });
$('dupBtn').addEventListener('click', duplicateFrame);
$('tweenBtn').addEventListener('click', tweenDialog);
$('moveLBtn').addEventListener('click', () => moveFrame(-1));
$('moveRBtn').addEventListener('click', () => moveFrame(1));
$('delFrameBtn').addEventListener('click', async () => {
  const f = curFrame();
  const hasArt = frameHasArt(f);
  if (!hasArt || await confirmDlg('Delete frame?', `Frame ${proj.current + 1} and its drawings will be removed. You can undo this.`, 'Delete')) deleteFrame();
});
$('exportBtn').addEventListener('click', exportDialog);
$('projectsBtn').addEventListener('click', projectsDialog);
$('acctBtn').addEventListener('click', () => accountDialog());

/* ---------- full screen / landscape: only the picture, controls tucked behind edge arrows */
let wasFullscreen = false;
function isImmersive() { return $('app').classList.contains('immersive'); }
function updateFsButton() {
  const on = isImmersive();
  $('fsLabel').textContent = on ? 'Exit full screen' : (COARSE ? 'Landscape' : 'Full screen');
  $('fsBtn').setAttribute('aria-pressed', String(on));
}
function setEdge(cls, tabId, open) {
  $('app').classList.toggle(cls, open);
  $(tabId).setAttribute('aria-expanded', String(open));
}
async function enterImmersive() {
  const app = $('app');
  app.classList.add('immersive');
  app.classList.remove('allow-portrait');
  setEdge('top-open', 'topTab', false);
  setEdge('tools-open', 'toolsTab', false);
  setSide(false);
  setTimeline(false);
  updateFsButton();
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch { /* the page may not be allowed to go full screen; the layout still switches */ }
  try { await screen.orientation?.lock?.('landscape'); } catch { /* not supported (e.g. iPhone): the rotate prompt covers it */ }
  setTimeout(layoutBox, 300);
}
function exitImmersive() {
  const app = $('app');
  app.classList.remove('immersive', 'top-open', 'tools-open', 'allow-portrait');
  try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  setTimeline(true);
  updateFsButton();
  setTimeout(layoutBox, 300);
}
$('fsBtn').addEventListener('click', () => (isImmersive() ? exitImmersive() : enterImmersive()));

// the app frame never scrolls (older phones ignore overflow: clip)
$('app').addEventListener('scroll', (e) => { if (e.target === $('app')) { $('app').scrollTop = 0; $('app').scrollLeft = 0; } });

/* ---------- background behind the picture: Aero plaza or plain black */
// modes: 'plaza' (the Aero plaza), 'off' (plain black, purple bubbles), 'image' (your own picture)
let bgImageUrl = null;
const wantBg = recall('bgMode', recall('bgOff', false) ? 'off' : 'plaza');
let bgMode = 'plaza';
function setBgMode(mode, save = true) {
  if (mode === 'image' && !bgImageUrl) mode = 'plaza';
  bgMode = mode;
  const off = mode === 'off', img = mode === 'image';
  $('app').classList.toggle('bg-off', off);
  document.body.classList.toggle('bg-off', off);
  $('app').classList.toggle('bg-img', img);
  $('view').style.backgroundImage = img ? `url("${bgImageUrl}")` : '';
  $('bgBtn').setAttribute('aria-pressed', String(mode !== 'plaza'));
  $('bgLabel').textContent = mode === 'plaza' ? 'Background off' : 'Background on';
  if (save) { store('bgMode', mode); store('bgOff', off); }
}
setBgMode(wantBg === 'image' ? 'plaza' : wantBg, false); // your picture comes back once it's read from storage
$('bgBtn').addEventListener('click', () => setBgMode(bgMode === 'plaza' ? 'off' : 'plaza'));
async function loadBgImage() {
  const b = await kvGet('uiBgImage');
  if (!b) return;
  bgImageUrl = URL.createObjectURL(b);
  if (wantBg === 'image') setBgMode('image', false);
}
async function useBgImage(file) {
  if (!file || mediaKind(file) !== 'image') { toast('Pick a picture (PNG, JPG…)'); return; }
  // check it opens before keeping it
  const url = URL.createObjectURL(file);
  const ok = await new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = url; });
  if (!ok) { URL.revokeObjectURL(url); toast('That picture couldn’t be opened'); return; }
  if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
  bgImageUrl = url;
  try { await kvPut('uiBgImage', file); } catch { toast('Your picture is showing, but couldn’t be saved for next time'); }
  setBgMode('image');
  toast('Your background is set');
}
async function removeBgImage() {
  await kvDel('uiBgImage');
  if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
  bgImageUrl = null;
  setBgMode('plaza');
}
function bgDialog() {
  openDlg((d) => {
    const opt = (mode, title, sub, swatch) => {
      const b = h('button', { type: 'button', class: 'bgopt', 'aria-pressed': String(bgMode === mode) }, swatch, h('span', { class: 'bgopt-t' }, title), h('span', { class: 'bgopt-s' }, sub));
      b.addEventListener('click', () => { setBgMode(mode); bgDialog(); });
      return b;
    };
    const opts = h('div', { class: 'bgopts' },
      opt('plaza', 'Aero plaza', 'The default', h('span', { class: 'bgsw bgsw-plaza' })),
      opt('off', 'Off', 'Plain black, purple bubbles', h('span', { class: 'bgsw bgsw-off' })));
    if (bgImageUrl) {
      const sw = h('span', { class: 'bgsw' }); sw.style.backgroundImage = `url("${bgImageUrl}")`;
      opts.append(opt('image', 'My picture', 'Your own background', sw));
    }
    const input = h('input', { type: 'file', accept: 'image/*,.png,.jpg,.jpeg,.webp,.gif,.heic', 'aria-label': 'Choose a background picture' });
    input.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%';
    input.addEventListener('change', async () => { const f = input.files[0]; input.value = ''; if (f) { await useBgImage(f); bgDialog(); } });
    d.append(h('h2', { id: 'dlgTitle' }, 'Background'),
      h('p', { class: 'note', style: 'margin:-4px 0 12px' }, 'What shows behind your picture. Your 3D scene isn’t changed.'),
      opts,
      h('div', { class: 'acts' },
        bgImageUrl ? h('button', { type: 'button', class: 'btn', onclick: async () => { await removeBgImage(); bgDialog(); } }, 'Remove my picture') : null,
        h('label', { class: 'btn', style: 'position:relative;overflow:hidden' }, bgImageUrl ? 'Choose another picture' : '+ Use my own picture', input),
        h('button', { type: 'button', class: 'btn primary', onclick: () => closeDlg() }, 'Done')));
  });
}
$('bgFab').addEventListener('click', bgDialog);
$('toolsTab').addEventListener('click', () => setEdge('tools-open', 'toolsTab', !$('app').classList.contains('tools-open')));
$('topTab').addEventListener('click', () => setEdge('top-open', 'topTab', !$('app').classList.contains('top-open')));
$('stayPortrait').addEventListener('click', () => $('app').classList.add('allow-portrait'));
const onFsChange = () => {
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (wasFullscreen && !fs && isImmersive()) exitImmersive();   // the browser's own exit (Esc, back gesture)
  wasFullscreen = fs;
};
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
window.addEventListener('orientationchange', () => setTimeout(layoutBox, 300));
updateFsButton();
$('newBtn').addEventListener('click', newProjectDialog);
$('projName').addEventListener('input', (e) => { proj.name = e.target.value.trim() || 'My animation'; saveSoon(); });
$('projName').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.target.blur(); } });

/* =================================================================== start */

function startUI() {
  sizeWorkCanvases();
  for (const c of sceneCams) setCamLens(c, c.fov);
  $('projName').value = proj.name;
  $('fps').value = String(proj.fps);
  applyEnv();
  layoutBox();
  rebuildStrip();
  goTo(proj.current);
  renderTools();
  showTab('Brush');
  setTool(tool);
  setSide(recall('side', false));
  setTimeline(recall('timeline', true));
}

(async function init() {
  loadMyBrushes();
  db = await openDB();
  let restored = false;
  const remembered = recall('user', null);
  if (remembered) user = { name: remembered };
  updateAcctButton();
  loadBgImage().catch(() => {});
  try {
    await migrateLegacy();
    const list = await projList();
    let id = await kvGet(lastKey());
    if (!list.some((p) => p.id === id)) id = list[0]?.id;
    if (id) { restored = await loadSaved(id); if (restored) proj.id = id; }
  } catch { restored = false; }
  if (!restored) {
    clearSheetMeshes();
    if (!models.length) addSampleModel();
    freshProject();
  }
  setCamMode('orbit');
  startUI();
  if (!db) $('saveStatus').textContent = 'Saving is off in this browser';
  else if (restored) $('saveStatus').textContent = 'Restored your last project';
  frameLoop();
})();
