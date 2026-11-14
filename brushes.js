// heemb4by – brush library and stamp engine.
// Each brush is a set of settings for one engine: stamps placed along the stroke,
// drawn on a stroke canvas, then blended onto the layer at the brush's opacity.

export const CATEGORIES = ['Basic', 'Inking', 'Pencils', 'Painting', 'Airbrush', 'Markers', 'Texture', 'Effects', 'Stamps', 'Blending', 'My brushes'];

const B = (o) => ({
  size: 10, opacity: 1, spacing: 0.12, shape: 'round', hardness: 1, roundness: 1, angle: 0,
  followDir: false, sizeJitter: 0, angleJitter: 0, scatter: 0, count: 1, opacityJitter: 0, flow: 1,
  minSize: 0.25, taper: 0, hueJitter: 0, lightJitter: 0, blend: 'source-over', rainbow: false,
  wet: false, neon: false, bristles: 0,
  // stroke dynamics
  taperIn: 0, taperOut: 0, fadeLen: 0, speedThin: 0, pressureGamma: 1, mix: 0, satJitter: 0, ...o,
});

export const BRUSHES = [
  // Basic (the original four tools)
  B({ id: 'basic', cat: 'Basic', name: 'Basic round', size: 8 }),
  B({ id: 'pencil-hb', cat: 'Basic', name: 'HB pencil', shape: 'grain', size: 3, opacity: 0.9, spacing: 0.35, minSize: 0.5, flow: 0.85 }),
  B({ id: 'marker-chisel', cat: 'Basic', name: 'Chisel marker', shape: 'round', roundness: 0.45, angle: -35, size: 22, opacity: 0.55 }),
  B({ id: 'air-soft', cat: 'Basic', name: 'Soft airbrush', hardness: 0, size: 60, opacity: 0.5, flow: 0.08, spacing: 0.08, minSize: 1 }),

  // Inking
  B({ id: 'ink-fine', cat: 'Inking', name: 'Fine liner', size: 3, spacing: 0.08, minSize: 0.6 }),
  B({ id: 'ink-gpen', cat: 'Inking', name: 'G-pen', size: 10, minSize: 0.08, taper: 2.5, spacing: 0.06 }),
  B({ id: 'ink-brushpen', cat: 'Inking', name: 'Brush pen', size: 14, roundness: 0.55, angle: -35, minSize: 0.12, taper: 3, spacing: 0.06 }),
  B({ id: 'ink-mono', cat: 'Inking', name: 'Monoline', size: 6, minSize: 1, spacing: 0.08 }),
  B({ id: 'ink-calli', cat: 'Inking', name: 'Calligraphy', shape: 'flat', size: 18, angle: 45, minSize: 0.5, spacing: 0.05 }),
  B({ id: 'ink-dry', cat: 'Inking', name: 'Dry ink', shape: 'bristle', bristles: 14, size: 16, minSize: 0.4, opacityJitter: 0.3, spacing: 0.08 }),
  B({ id: 'ink-sumi', cat: 'Inking', name: 'Sumi brush', hardness: 0.85, size: 24, minSize: 0.15, sizeJitter: 0.08, taper: 4, spacing: 0.05 }),
  B({ id: 'ink-tech', cat: 'Inking', name: 'Technical pen', shape: 'square', size: 2, minSize: 1, spacing: 0.05 }),

  // Pencils
  B({ id: 'pencil-2b', cat: 'Pencils', name: '2B pencil', shape: 'grain', size: 5, opacity: 0.9, spacing: 0.3, minSize: 0.4, flow: 0.95 }),
  B({ id: 'pencil-6b', cat: 'Pencils', name: '6B soft pencil', shape: 'grain', size: 9, opacity: 0.85, spacing: 0.25, minSize: 0.3, flow: 0.75 }),
  B({ id: 'pencil-color', cat: 'Pencils', name: 'Colored pencil', shape: 'grain', size: 6, opacity: 0.8, spacing: 0.3, flow: 0.6, opacityJitter: 0.3 }),
  B({ id: 'pencil-sketch', cat: 'Pencils', name: 'Sketchy line', shape: 'line', size: 2, opacity: 0.7, spacing: 0.9, scatter: 1.2, count: 2, minSize: 0.6 }),
  B({ id: 'pencil-mech', cat: 'Pencils', name: 'Mechanical pencil', shape: 'grain', size: 2, opacity: 0.95, spacing: 0.3, flow: 1, minSize: 0.7 }),
  B({ id: 'pencil-blue', cat: 'Pencils', name: 'Blue sketch', shape: 'grain', size: 4, opacity: 0.6, spacing: 0.3, flow: 0.7, blend: 'multiply' }),

  // Painting
  B({ id: 'paint-round', cat: 'Painting', name: 'Round brush', hardness: 0.9, size: 20, minSize: 0.3 }),
  B({ id: 'paint-oil', cat: 'Painting', name: 'Oil bristle', shape: 'bristle', bristles: 24, size: 28, opacityJitter: 0.2, lightJitter: 0.08, spacing: 0.06 }),
  B({ id: 'paint-flat', cat: 'Painting', name: 'Flat brush', shape: 'flat', size: 30, followDir: true, angle: 90, minSize: 0.5, spacing: 0.05 }),
  B({ id: 'paint-gouache', cat: 'Painting', name: 'Gouache', hardness: 0.7, size: 26, flow: 0.5, spacing: 0.08 }),
  B({ id: 'paint-water', cat: 'Painting', name: 'Watercolor wash', hardness: 0.2, size: 50, flow: 0.07, wet: true, blend: 'multiply', opacity: 0.8, minSize: 0.6, spacing: 0.1 }),
  B({ id: 'paint-wetedge', cat: 'Painting', name: 'Wet edge', hardness: 0.5, size: 30, flow: 0.12, wet: true, blend: 'multiply', spacing: 0.1 }),
  B({ id: 'paint-acrylic', cat: 'Painting', name: 'Acrylic', shape: 'bristle', bristles: 12, size: 22, scatter: 0.05, lightJitter: 0.05, spacing: 0.06 }),
  B({ id: 'paint-knife', cat: 'Painting', name: 'Palette knife', shape: 'square', roundness: 0.3, followDir: true, size: 26, opacityJitter: 0.3, spacing: 0.08 }),

  // Airbrush & soft
  B({ id: 'air-hard', cat: 'Airbrush', name: 'Hard airbrush', hardness: 0.6, size: 30, flow: 0.1, spacing: 0.08, minSize: 1 }),
  B({ id: 'air-spray', cat: 'Airbrush', name: 'Spray can', shape: 'spray', size: 44, flow: 0.9, spacing: 0.15, minSize: 1 }),
  B({ id: 'air-mist', cat: 'Airbrush', name: 'Mist', hardness: 0, size: 120, flow: 0.03, opacity: 0.6, spacing: 0.08, minSize: 1 }),
  B({ id: 'air-blush', cat: 'Airbrush', name: 'Blush', hardness: 0, size: 40, flow: 0.05, blend: 'multiply', spacing: 0.08, minSize: 1 }),
  B({ id: 'air-shade', cat: 'Airbrush', name: 'Soft shade', hardness: 0.2, size: 70, flow: 0.04, blend: 'multiply', opacity: 0.7, spacing: 0.08, minSize: 1 }),

  // Markers
  B({ id: 'marker-round', cat: 'Markers', name: 'Round marker', size: 12, opacity: 0.5, blend: 'multiply', minSize: 0.8 }),
  B({ id: 'marker-high', cat: 'Markers', name: 'Highlighter', shape: 'square', roundness: 0.35, size: 26, opacity: 0.4, blend: 'multiply', minSize: 1 }),
  B({ id: 'marker-felt', cat: 'Markers', name: 'Felt tip', hardness: 0.8, size: 8, opacityJitter: 0.15, minSize: 0.7 }),
  B({ id: 'marker-brush', cat: 'Markers', name: 'Brush marker', roundness: 0.5, angle: -30, size: 20, opacity: 0.6, blend: 'multiply', taper: 2, minSize: 0.2 }),
  B({ id: 'marker-alcohol', cat: 'Markers', name: 'Alcohol marker', hardness: 0.75, size: 18, opacity: 0.45, blend: 'multiply', flow: 0.7, minSize: 0.8 }),

  // Texture
  B({ id: 'tex-chalk', cat: 'Texture', name: 'Chalk', shape: 'chalk', size: 18, flow: 0.9, spacing: 0.2, minSize: 0.6 }),
  B({ id: 'tex-charcoal', cat: 'Texture', name: 'Charcoal', shape: 'chalk', size: 14, flow: 1, opacityJitter: 0.4, spacing: 0.15, minSize: 0.4 }),
  B({ id: 'tex-crayon', cat: 'Texture', name: 'Wax crayon', shape: 'grain', size: 10, flow: 0.95, spacing: 0.2, minSize: 0.6 }),
  B({ id: 'tex-pastel', cat: 'Texture', name: 'Soft pastel', shape: 'chalk', size: 26, flow: 0.5, spacing: 0.15, minSize: 0.6 }),
  B({ id: 'tex-sponge', cat: 'Texture', name: 'Sponge', shape: 'splat', size: 30, scatter: 0.3, count: 2, opacityJitter: 0.5, spacing: 0.5, minSize: 0.8 }),
  B({ id: 'tex-stipple', cat: 'Texture', name: 'Stipple', shape: 'stipple', size: 30, spacing: 0.4, minSize: 0.8 }),
  B({ id: 'tex-hatch', cat: 'Texture', name: 'Crosshatch', shape: 'hatch', size: 24, angle: 45, spacing: 0.55, opacity: 0.8, minSize: 0.8 }),
  B({ id: 'tex-dry', cat: 'Texture', name: 'Dry brush', shape: 'bristle', bristles: 30, size: 30, opacityJitter: 0.6, sizeJitter: 0.2, spacing: 0.06 }),

  // Effects
  B({ id: 'fx-glow', cat: 'Effects', name: 'Glow', hardness: 0, size: 40, flow: 0.2, blend: 'lighter', spacing: 0.1, minSize: 0.8 }),
  B({ id: 'fx-neon', cat: 'Effects', name: 'Neon tube', neon: true, size: 10, minSize: 0.8, spacing: 0.08, blend: 'lighter' }),
  B({ id: 'fx-rainbow', cat: 'Effects', name: 'Rainbow', size: 14, rainbow: true, minSize: 0.6, spacing: 0.08 }),
  B({ id: 'fx-sparkle', cat: 'Effects', name: 'Sparkles', shape: 'sparkle', size: 22, scatter: 1, spacing: 1.2, sizeJitter: 0.7, angleJitter: 0.2, blend: 'lighter', minSize: 0.8 }),
  B({ id: 'fx-smoke', cat: 'Effects', name: 'Smoke', hardness: 0, size: 50, flow: 0.05, scatter: 0.4, count: 2, sizeJitter: 0.5, lightJitter: 0.1, spacing: 0.15, minSize: 1 }),
  B({ id: 'fx-trail', cat: 'Effects', name: 'Light trail', hardness: 0.3, size: 16, flow: 0.5, blend: 'lighter', taper: 3, spacing: 0.06 }),

  // Stamps & nature
  B({ id: 'st-grass', cat: 'Stamps', name: 'Grass', shape: 'grass', size: 30, count: 3, scatter: 0.6, angleJitter: 0.08, lightJitter: 0.15, spacing: 0.25, minSize: 0.8 }),
  B({ id: 'st-leaves', cat: 'Stamps', name: 'Leaves', shape: 'leaf', size: 22, scatter: 0.8, angleJitter: 1, sizeJitter: 0.5, hueJitter: 0.05, lightJitter: 0.1, spacing: 0.9, minSize: 0.8 }),
  B({ id: 'st-stars', cat: 'Stamps', name: 'Stars', shape: 'star', size: 20, spacing: 1.5, sizeJitter: 0.5, angleJitter: 1, minSize: 0.8 }),
  B({ id: 'st-hearts', cat: 'Stamps', name: 'Hearts', shape: 'heart', size: 20, spacing: 1.4, sizeJitter: 0.4, angleJitter: 0.15, hueJitter: 0.04, minSize: 0.8 }),
  B({ id: 'st-fur', cat: 'Stamps', name: 'Fur', shape: 'hair', size: 18, count: 4, scatter: 0.5, followDir: true, angleJitter: 0.08, spacing: 0.2, minSize: 0.8 }),
  B({ id: 'st-snow', cat: 'Stamps', name: 'Snowflakes', shape: 'snow', size: 18, scatter: 1.2, spacing: 1.3, sizeJitter: 0.6, angleJitter: 1, minSize: 0.8 }),
  B({ id: 'st-bubbles', cat: 'Stamps', name: 'Bubbles', shape: 'ring', size: 24, scatter: 1, spacing: 1, sizeJitter: 0.7, minSize: 0.8 }),
  B({ id: 'st-confetti', cat: 'Stamps', name: 'Confetti', shape: 'square', roundness: 0.5, size: 10, scatter: 2, count: 2, spacing: 0.9, angleJitter: 1, hueJitter: 1, minSize: 1 }),
  B({ id: 'st-rain', cat: 'Stamps', name: 'Rain', shape: 'hair', size: 26, count: 3, scatter: 1.5, angle: 100, angleJitter: 0.02, opacityJitter: 0.4, spacing: 0.5, minSize: 1 }),
  B({ id: 'st-clouds', cat: 'Stamps', name: 'Cloud puffs', hardness: 0.55, size: 40, scatter: 0.5, count: 3, sizeJitter: 0.6, spacing: 0.35, minSize: 1 }),

  // Blending: these pick up and mix the paint already on the layer
  B({ id: 'blend-soft', cat: 'Blending', name: 'Soft blender', hardness: 0.25, size: 40, flow: 0.35, mix: 0.9, spacing: 0.08, minSize: 0.7 }),
  B({ id: 'blend-wet', cat: 'Blending', name: 'Wet mix brush', hardness: 0.6, size: 26, flow: 0.6, mix: 0.6, spacing: 0.06, minSize: 0.4 }),
  B({ id: 'blend-oil', cat: 'Blending', name: 'Oil mixer', shape: 'bristle', bristles: 20, size: 30, mix: 0.7, flow: 0.8, spacing: 0.06 }),
  B({ id: 'blend-fade', cat: 'Blending', name: 'Fading ink', size: 8, taperIn: 30, taperOut: 60, fadeLen: 600, minSize: 0.3, spacing: 0.06 }),
  B({ id: 'blend-speed', cat: 'Blending', name: 'Speed pen', size: 9, speedThin: 0.8, taperIn: 20, taperOut: 40, minSize: 0.5, spacing: 0.05 }),
];

export const BRUSH_BY_ID = Object.fromEntries(BRUSHES.map((b) => [b.id, b]));
export const DEFAULTS = Object.fromEntries(BRUSHES.map((b) => [b.id, { size: b.size, opacity: b.opacity }]));

/* ------------------------------------------------------------------ color helpers */

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/* ------------------------------------------------------------------ engine */

/**
 * Starts a stroke.
 * opts: { size, pressureSize, pressureOpacity, erase, sample(x, y) -> [r,g,b,a] }
 */
export function beginStroke(ctx, brush, color, opts) {
  const rgb = opts.erase ? [0, 0, 0] : hexToRgb(color);
  const st = {
    ctx, b: brush, rgb, hsl: rgbToHsl(rgb), size: opts.size, opts,
    has: false, lx: 0, ly: 0, lp: 1, lt: 0, dist: 0, next: 0, dir: 0, speed: 0,
    minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
    bristles: null, queue: [], sampleN: 0, lastSample: null,
  };
  if (brush.bristles) {
    st.bristles = [];
    for (let i = 0; i < brush.bristles; i++) {
      st.bristles.push({ off: Math.random() - 0.5, r: 0.04 + Math.random() * 0.07, a: 0.5 + Math.random() * 0.5 });
    }
  }
  return st;
}

/** Adds an input point; stamps along the way. time is in ms (for speed-based thickness). */
export function strokePoint(st, x, y, p, time = performance.now()) {
  if (!st.has) {
    st.has = true; st.lx = x; st.ly = y; st.lp = p; st.lt = time;
    queueStamp(st, x, y, p, x, y);
    st.next = spacingOf(st);
    return;
  }
  const dx = x - st.lx, dy = y - st.ly;
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return;
  const dt = Math.max(1, time - st.lt);
  st.speed = st.speed * 0.75 + (d / dt) * 0.25;
  st.lt = time;
  st.dir = Math.atan2(dy, dx);
  let s = st.next;
  let px = st.lx, py = st.ly;
  while (s <= d) {
    const t = s / d;
    const sx = st.lx + dx * t, sy = st.ly + dy * t, sp = st.lp + (p - st.lp) * t;
    st.dist += spacingOf(st);
    queueStamp(st, sx, sy, sp, px, py);
    px = sx; py = sy;
    s += spacingOf(st);
  }
  st.next = s - d;
  st.lx = x; st.ly = y; st.lp = p;
}

/** Finishes the stroke (draws the tapered tail). */
export function endStroke(st) { drain(st, true); }

function queueStamp(st, x, y, p, px, py) {
  st.queue.push({ x, y, p, px, py, dist: st.dist, speed: st.speed, dir: st.dir });
  drain(st, false);
}
// Stamps wait in a queue until we know how far they are from the end of the stroke,
// so the last part of the stroke can taper off.
function drain(st, final) {
  const out = st.b.taperOut || 0;
  while (st.queue.length) {
    const q = st.queue[0];
    let k = 1;
    if (out > 0) {
      const remaining = st.dist - q.dist;
      if (!final && remaining < out) break;
      if (final) k = Math.max(0.06, Math.min(1, remaining / out));
    }
    st.queue.shift();
    stampAt(st, q, k);
  }
}

function spacingOf(st) { return Math.max(0.5, st.size * st.b.spacing); }
const rnd = Math.random;

function stampAt(st, q, k) {
  const b = st.b, ctx = st.ctx;
  const { x, y, p, px, py } = q;
  const pc = Math.pow(Math.max(0.0001, p), b.pressureGamma || 1);
  let size = st.size * k;
  if (st.opts.pressureSize) size *= b.minSize + (1 - b.minSize) * pc;
  if (b.taper) size *= Math.max(0.12, Math.min(1, q.dist / (b.taper * st.size)));
  if (b.taperIn) size *= Math.max(0.06, Math.min(1, q.dist / b.taperIn));
  if (b.speedThin) size *= Math.max(0.15, 1 - b.speedThin * Math.min(1, q.speed / 2.5));
  let alphaP = st.opts.pressureOpacity ? 0.2 + 0.8 * pc : 1;
  if (b.fadeLen) alphaP *= Math.max(0, 1 - q.dist / b.fadeLen);
  if (alphaP <= 0.003 || size < 0.2) return;
  const dirNow = q.dir;

  if (b.neon) {
    drawShape(ctx, 'round', x, y, size * 1.8, 0, 0.12 * alphaP, st.rgb, 0, 1);
    const core = st.rgb.map((v) => Math.round(v + (255 - v) * 0.65));
    drawShape(ctx, 'round', x, y, size * 0.45, 0, 0.9 * alphaP, core, 0.8, 1);
    grow(st, x, y, size * 1.8);
    return;
  }

  for (let n = 0; n < b.count; n++) {
    const s = size * (1 - rnd() * b.sizeJitter);
    let ox = 0, oy = 0;
    if (b.scatter) { const a = rnd() * Math.PI * 2, r = rnd() * b.scatter * size; ox = Math.cos(a) * r; oy = Math.sin(a) * r; }
    const ang = (b.angle * Math.PI) / 180 + (b.followDir ? dirNow : 0) + (rnd() - 0.5) * b.angleJitter * Math.PI * 2;
    const alpha = b.flow * (1 - rnd() * b.opacityJitter) * alphaP;
    let rgb = st.rgb;
    if (b.rainbow) rgb = hslToRgb(q.dist / 400, 0.85, 0.58);
    else if (b.hueJitter || b.lightJitter || b.satJitter) {
      const [hh, ss, ll] = st.hsl;
      rgb = hslToRgb(hh + (rnd() - 0.5) * b.hueJitter,
        b.hueJitter >= 1 ? 0.8 : Math.max(0, Math.min(1, ss + (rnd() - 0.5) * b.satJitter * 2)),
        Math.max(0, Math.min(1, ll + (rnd() - 0.5) * b.lightJitter * 2)));
    }
    const cx = x + ox, cy = y + oy;
    if (b.mix > 0 && st.opts.sample && !st.opts.erase) {
      // pick up the paint underneath and blend it into the brush color
      if (st.sampleN++ % 3 === 0 || !st.lastSample) st.lastSample = st.opts.sample(cx, cy);
      const under = st.lastSample;
      if (under && under[3] > 8) {
        const m = b.mix * (under[3] / 255);
        rgb = [0, 1, 2].map((i) => Math.round(rgb[i] + (under[i] - rgb[i]) * m));
      }
    }
    if (b.shape === 'bristle') drawBristles(st, cx, cy, s, alpha, rgb, dirNow);
    else if (b.shape === 'line') {
      const j = b.scatter * size;
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
      ctx.lineWidth = Math.max(0.6, s * 0.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px + (rnd() - 0.5) * j, py + (rnd() - 0.5) * j);
      ctx.lineTo(cx, cy);
      ctx.stroke();
    } else drawShape(ctx, b.shape, cx, cy, s / 2, ang, alpha, rgb, b.hardness, b.roundness);
    if (b.wet) {
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.min(1, alpha * 1.6)})`;
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.46, 0, Math.PI * 2); ctx.stroke();
    }
    grow(st, cx, cy, s * (b.shape === 'grass' || b.shape === 'hair' ? 1.6 : 0.8));
  }
}

function grow(st, x, y, r) {
  st.minX = Math.min(st.minX, x - r - 3); st.minY = Math.min(st.minY, y - r - 3);
  st.maxX = Math.max(st.maxX, x + r + 3); st.maxY = Math.max(st.maxY, y + r + 3);
}

function drawBristles(st, x, y, size, alpha, rgb, dir = st.dir) {
  const ctx = st.ctx;
  const nx = -Math.sin(dir), ny = Math.cos(dir);
  for (const br of st.bristles) {
    const r = Math.max(0.4, size * br.r);
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha * br.a})`;
    ctx.beginPath();
    ctx.arc(x + nx * br.off * size, y + ny * br.off * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShape(ctx, shape, x, y, r, ang, a, rgb, hard, round) {
  if (r < 0.2 || a <= 0) return;
  const col = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  if (round !== 1) ctx.scale(1, round);
  if (hard >= 0.99) ctx.fillStyle = col;
  else {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, col);
    g.addColorStop(Math.max(0, Math.min(0.99, hard)), col);
    g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = g;
  }
  ctx.strokeStyle = col;
  ctx.beginPath();
  switch (shape) {
    case 'square': ctx.rect(-r, -r, r * 2, r * 2); ctx.fill(); break;
    case 'flat': ctx.rect(-r, -r * 0.16, r * 2, r * 0.32); ctx.fill(); break;
    case 'grain': {
      ctx.fillStyle = col;
      const n = Math.max(3, Math.round(r * r * 1.6));
      for (let i = 0; i < n; i++) { const t = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r; ctx.fillRect(Math.cos(t) * d, Math.sin(t) * d, 1, 1); }
      break;
    }
    case 'chalk': {
      ctx.fillStyle = col;
      const n = Math.max(4, Math.round(r * r * 0.5));
      for (let i = 0; i < n; i++) { const t = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r, s = 0.6 + rnd() * 2.2; if (rnd() < 0.75) ctx.fillRect(Math.cos(t) * d, Math.sin(t) * d, s, s * 0.7); }
      break;
    }
    case 'spray': {
      ctx.fillStyle = col;
      const n = Math.max(6, Math.round(r * 1.2));
      for (let i = 0; i < n; i++) { const t = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * r; ctx.beginPath(); ctx.arc(Math.cos(t) * d, Math.sin(t) * d, 0.5 + rnd() * 0.9, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'stipple': {
      ctx.fillStyle = col;
      const n = Math.max(2, Math.round(r * 0.25));
      for (let i = 0; i < n; i++) { const t = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r; ctx.beginPath(); ctx.arc(Math.cos(t) * d, Math.sin(t) * d, 1 + rnd() * 1.6, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'splat': {
      const n = 5 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) { const t = rnd() * Math.PI * 2, d = rnd() * r * 0.75; ctx.moveTo(Math.cos(t) * d + r * 0.3, Math.sin(t) * d); ctx.arc(Math.cos(t) * d, Math.sin(t) * d, r * (0.12 + rnd() * 0.25), 0, Math.PI * 2); }
      ctx.fill();
      break;
    }
    case 'hatch': {
      ctx.lineWidth = Math.max(0.8, r * 0.07);
      ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) { const o = (i / 2.5) * r; const half = Math.sqrt(Math.max(0, r * r - o * o)); ctx.moveTo(-half, o); ctx.lineTo(half, o); }
      ctx.stroke();
      ctx.beginPath();
      ctx.rotate(Math.PI / 2);
      for (let i = -2; i <= 2; i++) { const o = (i / 2.5) * r; const half = Math.sqrt(Math.max(0, r * r - o * o)); ctx.moveTo(-half, o); ctx.lineTo(half, o); }
      ctx.stroke();
      break;
    }
    case 'star':
    case 'sparkle': {
      const pts = shape === 'star' ? 5 : 4, inner = shape === 'star' ? 0.45 : 0.18;
      for (let i = 0; i < pts * 2; i++) {
        const t = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * inner : r;
        i ? ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr) : ctx.moveTo(Math.cos(t) * rr, Math.sin(t) * rr);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'snow': {
      ctx.lineWidth = Math.max(0.8, r * 0.12); ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2, ex = Math.cos(t) * r, ey = Math.sin(t) * r;
        ctx.moveTo(0, 0); ctx.lineTo(ex, ey);
        const bx = ex * 0.6, by = ey * 0.6, side = r * 0.25;
        ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(t + 0.8) * side, by + Math.sin(t + 0.8) * side);
        ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(t - 0.8) * side, by + Math.sin(t - 0.8) * side);
      }
      ctx.stroke();
      break;
    }
    case 'heart': {
      const s = r / 1.1;
      ctx.moveTo(0, s * 0.9);
      ctx.bezierCurveTo(-s * 1.4, -s * 0.1, -s * 0.7, -s * 1.1, 0, -s * 0.4);
      ctx.bezierCurveTo(s * 0.7, -s * 1.1, s * 1.4, -s * 0.1, 0, s * 0.9);
      ctx.fill();
      break;
    }
    case 'leaf': {
      ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(0, -r * 0.7, r, 0);
      ctx.quadraticCurveTo(0, r * 0.7, -r, 0);
      ctx.fill();
      ctx.strokeStyle = `rgba(0,0,0,${a * 0.25})`; ctx.lineWidth = Math.max(0.6, r * 0.06);
      ctx.beginPath(); ctx.moveTo(-r * 0.9, 0); ctx.lineTo(r * 0.8, 0); ctx.stroke();
      break;
    }
    case 'ring': {
      ctx.lineWidth = Math.max(0.8, r * 0.12);
      ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a * 0.6})`;
      ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.35, r * 0.15, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'grass': {
      ctx.lineWidth = Math.max(0.8, r * 0.1); ctx.lineCap = 'round';
      const lean = (rnd() - 0.5) * r * 0.8;
      ctx.moveTo(0, 0); ctx.quadraticCurveTo(lean * 0.3, -r, lean, -r * 2);
      ctx.stroke();
      break;
    }
    case 'hair': {
      ctx.lineWidth = Math.max(0.5, r * 0.06); ctx.lineCap = 'round';
      const len = r * (1 + rnd());
      ctx.moveTo(-len / 2, 0); ctx.quadraticCurveTo(0, (rnd() - 0.5) * r * 0.3, len / 2, 0);
      ctx.stroke();
      break;
    }
    default: ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ previews */

const previewCache = new Map();
/** A small canvas with a sample stroke for the library grid. */
export function preview(brush, color, w = 132, h = 40, noCache = false) {
  const key = brush.id + color;
  if (!noCache && previewCache.has(key)) return previewCache.get(key);
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  const ctx = c.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = c.width; tmp.height = c.height;
  const size = Math.min(brush.size, 30) * 1.6 * (brush.shape === 'grain' ? 1.6 : 1);
  const st = beginStroke(tmp.getContext('2d'), brush, color, { size: Math.max(4, size), pressureSize: true, pressureOpacity: false });
  const steps = 70;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = 18 + t * (c.width - 36);
    const y = c.height / 2 + Math.sin(t * Math.PI * 2) * c.height * 0.22;
    strokePoint(st, x, y, Math.sin(t * Math.PI) * 0.9 + 0.1, i * 12);
  }
  endStroke(st);
  ctx.globalAlpha = brush.opacity;
  ctx.globalCompositeOperation = brush.blend === 'lighter' ? 'lighter' : 'source-over';
  ctx.drawImage(tmp, 0, 0);
  if (!noCache) previewCache.set(key, c);
  return c;
}
export function clearPreviews() { previewCache.clear(); }

/** Adds or replaces a brush (used for "My brushes"). */
export function registerBrush(b) {
  const full = B(b);
  const i = BRUSHES.findIndex((x) => x.id === full.id);
  if (i >= 0) BRUSHES[i] = full; else BRUSHES.push(full);
  BRUSH_BY_ID[full.id] = full;
  DEFAULTS[full.id] = { size: full.size, opacity: full.opacity };
  for (const k of [...previewCache.keys()]) if (k.startsWith(full.id)) previewCache.delete(k);
  return full;
}
export function unregisterBrush(id) {
  const i = BRUSHES.findIndex((x) => x.id === id);
  if (i >= 0) BRUSHES.splice(i, 1);
  delete BRUSH_BY_ID[id];
}
/** The settings the brush editor can change. */
export const EDITABLE = ['spacing', 'hardness', 'roundness', 'angle', 'followDir', 'scatter', 'count', 'sizeJitter', 'angleJitter', 'opacityJitter',
  'hueJitter', 'satJitter', 'lightJitter', 'flow', 'minSize', 'pressureGamma', 'taperIn', 'taperOut', 'fadeLen', 'speedThin', 'mix', 'blend'];
