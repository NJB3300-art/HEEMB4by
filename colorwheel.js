// heemb4by – full HSV color wheel: hue around the ring, saturation from the center,
// brightness slider below, plus hex entry. Used for brushes, lights, sky and ground.

export function hexToRgb(hex) {
  let h = String(hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return { h, s: max ? d / max : 0, v: max };
}
export function hsvToHex(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return rgbToHex(r * 255, g * 255, b * 255);
}

const wheelCache = new Map();
function baseWheel(size) {
  if (wheelCache.has(size)) return wheelCache.get(size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + 0.5 - r, dy = y + 0.5 - r;
    const d = Math.hypot(dx, dy) / r;
    if (d > 1) continue;
    let hue = Math.atan2(dy, dx) / (Math.PI * 2);
    if (hue < 0) hue += 1;
    const [R, G, B] = hexToRgb(hsvToHex(hue, d, 1));
    const o = (y * size + x) * 4;
    img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B;
    img.data[o + 3] = d > 0.985 ? Math.round((1 - d) / 0.015 * 255) : 255; // soft rim
  }
  ctx.putImageData(img, 0, 0);
  wheelCache.set(size, c);
  return c;
}

/**
 * Creates a color wheel control.
 * opts: { value, label, size, onInput(hex), onChange(hex) }
 * Returns { el, set(hex) }.
 */
export function colorWheel(opts) {
  const size = opts.size || 172;
  let hsv = hexToHsv(opts.value || '#ffffff');
  let hex = hsvToHex(hsv.h, hsv.s, hsv.v);

  const el = document.createElement('div');
  el.className = 'cw';
  const top = document.createElement('div');
  top.className = 'cw-top';
  const wheel = document.createElement('canvas');
  wheel.width = wheel.height = size * 2;
  wheel.style.width = wheel.style.height = size + 'px';
  wheel.className = 'cw-wheel';
  wheel.tabIndex = 0;
  wheel.setAttribute('role', 'slider');
  wheel.setAttribute('aria-label', (opts.label || 'Color') + ' wheel. Left and right change hue, up and down change saturation.');

  const side = document.createElement('div');
  side.className = 'cw-side';
  const sw = document.createElement('div');
  sw.className = 'cw-swatch';
  const hexIn = document.createElement('input');
  hexIn.className = 'cw-hex';
  hexIn.setAttribute('aria-label', (opts.label || 'Color') + ' hex code');
  hexIn.maxLength = 7;
  hexIn.spellcheck = false;
  side.append(sw, hexIn);
  top.append(wheel, side);

  const valWrap = document.createElement('label');
  valWrap.className = 'cw-val';
  const valText = document.createElement('span');
  valText.textContent = 'Brightness';
  const val = document.createElement('input');
  val.type = 'range'; val.min = 0; val.max = 100; val.step = 1;
  valWrap.append(valText, val);
  el.append(top, valWrap);

  const ctx = wheel.getContext('2d');
  function draw() {
    const S = wheel.width, r = S / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(baseWheel(S), 0, 0);
    // darken for brightness
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${1 - hsv.v})`;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
    const a = hsv.h * Math.PI * 2, d = hsv.s * r;
    const mx = r + Math.cos(a) * d, my = r + Math.sin(a) * d;
    ctx.lineWidth = 5; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.arc(mx, my, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(mx, my, 13, 0, Math.PI * 2); ctx.stroke();
    sw.style.background = hex;
    if (document.activeElement !== hexIn) hexIn.value = hex;
    val.value = Math.round(hsv.v * 100);
    val.style.background = `linear-gradient(90deg, #000, ${hsvToHex(hsv.h, hsv.s, 1)})`;
    wheel.setAttribute('aria-valuetext', hex);
  }

  const emit = (final) => {
    hex = hsvToHex(hsv.h, hsv.s, hsv.v);
    draw();
    opts.onInput?.(hex);
    if (final) opts.onChange?.(hex);
  };

  function fromPointer(e) {
    const rect = wheel.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2, dy = e.clientY - rect.top - rect.height / 2;
    let hue = Math.atan2(dy, dx) / (Math.PI * 2);
    if (hue < 0) hue += 1;
    hsv.h = hue;
    hsv.s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    if (hsv.v < 0.05) hsv.v = 1; // picking on a black wheel brings brightness back
    emit(false);
  }
  let dragging = false;
  wheel.addEventListener('pointerdown', (e) => { dragging = true; wheel.setPointerCapture(e.pointerId); fromPointer(e); });
  wheel.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
  const end = () => { if (dragging) { dragging = false; emit(true); } };
  wheel.addEventListener('pointerup', end);
  wheel.addEventListener('pointercancel', end);
  wheel.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') { hsv.h = (hsv.h + (k === 'ArrowRight' ? 1 : -1) / 72 + 1) % 1; }
    else if (k === 'ArrowUp' || k === 'ArrowDown') { hsv.s = Math.max(0, Math.min(1, hsv.s + (k === 'ArrowUp' ? 0.04 : -0.04))); }
    else return;
    e.preventDefault(); e.stopPropagation();
    emit(true);
  });
  val.addEventListener('input', () => { hsv.v = val.value / 100; emit(false); });
  val.addEventListener('change', () => emit(true));
  hexIn.addEventListener('input', () => {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hexIn.value.trim());
    if (m) { hsv = hexToHsv('#' + m[1]); emit(false); }
  });
  hexIn.addEventListener('change', () => { hexIn.value = hex; emit(true); });

  draw();
  return {
    el,
    set(v) { hsv = hexToHsv(v); hex = hsvToHex(hsv.h, hsv.s, hsv.v); draw(); },
  };
}
