export const BRUSHES = [
  { id: 'brush', name: 'Pincel' },
  { id: 'calligraphyBrush', name: 'Pincel caligráfico' },
  { id: 'calligraphyPen', name: 'Caneta caligráfica' },
  { id: 'airbrush', name: 'Aerógrafo' },
  { id: 'oil', name: 'Pincel a óleo' },
  { id: 'crayon', name: 'Giz de cera' },
  { id: 'marker', name: 'Marcador' },
  { id: 'pencil', name: 'Lápis natural' },
  { id: 'watercolor', name: 'Pincel aquarela' },
];

export const BRUSH_IDS = BRUSHES.map((b) => b.id);

export const STYLE_FINISH = {
  solid: { alpha: 1, texture: null },
  brush: { alpha: 1, texture: null },
  calligraphyBrush: { alpha: 1, texture: null },
  calligraphyPen: { alpha: 1, texture: null },
  airbrush: { alpha: 1, texture: null },
  oil: { alpha: 1, texture: null },
  crayon: { alpha: 1, texture: 'grain' },
  marker: { alpha: 0.55, texture: null },
  pencil: { alpha: 0.9, texture: 'fine' },
  watercolor: { alpha: 0.6, texture: 'paper', blur: 1.5 },
};

export function random(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(gx, gy, seed);
  const b = hash(gx + 1, gy, seed);
  const c = hash(gx, gy + 1, seed);
  const d = hash(gx + 1, gy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export const TEXTURES = {
  grain: { size: 128, build: (x, y) => (smoothNoise(x, y, 3, 7) * 0.65 + hash(x, y, 11) * 0.35 > 0.42 ? 255 : 0) },
  fine: { size: 96, build: (x, y) => Math.round(255 * Math.min(1, Math.max(0, (hash(x, y, 5) - 0.18) * 1.5))) },
  paper: { size: 128, build: (x, y) => Math.round(255 * (0.72 + 0.28 * smoothNoise(x, y, 6, 3))) },
  streak: { size: 128, build: (x, y) => Math.round(255 * (0.55 + 0.45 * smoothNoise(x / 6, y, 1.5, 9))) },
};

export function textureAlpha(kind) {
  const t = TEXTURES[kind];
  if (!t) throw new Error(`Textura desconhecida: ${kind}`);
  const out = new Uint8ClampedArray(t.size * t.size);
  for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) out[y * t.size + x] = t.build(x, y);
  return { size: t.size, alpha: out };
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export class StrokeEngine {
  constructor(ctx, { kind = 'brush', size = 8, color = '#000000', seed = 1 } = {}) {
    this.ctx = ctx;
    this.kind = kind;
    this.size = Math.max(1, size);
    this.color = color;
    this.rand = random(seed);
    this.last = null;
    this.dirty = null;
    this.bristles = null;
  }

  mark(x, y, r) {
    const rect = { x: Math.floor(x - r - 2), y: Math.floor(y - r - 2), width: Math.ceil(r * 2 + 4), height: Math.ceil(r * 2 + 4) };
    if (!this.dirty) this.dirty = rect;
    else {
      const x0 = Math.min(this.dirty.x, rect.x);
      const y0 = Math.min(this.dirty.y, rect.y);
      this.dirty = { x: x0, y: y0, width: Math.max(this.dirty.x + this.dirty.width, rect.x + rect.width) - x0, height: Math.max(this.dirty.y + this.dirty.height, rect.y + rect.height) - y0 };
    }
  }

  begin(x, y) {
    this.last = { x, y };
    const ctx = this.ctx;
    ctx.fillStyle = this.color;
    ctx.strokeStyle = this.color;
    if (this.kind === 'oil') {
      const count = Math.max(3, Math.min(28, Math.round(this.size / 2.2)));
      this.bristles = Array.from({ length: count }, (_, i) => ({
        offset: (i / (count - 1 || 1) - 0.5) * this.size,
        alpha: 1,
        width: Math.max(1, (this.size / count) * (1.1 + this.rand() * 0.9)),
        color: shade(this.color, (this.rand() - 0.5) * 0.36),
      }));
    }
    this.segment(x, y, x, y);
  }

  to(x, y) {
    if (!this.last) return this.begin(x, y);
    const { x: x0, y: y0 } = this.last;
    if (x === x0 && y === y0 && this.kind !== 'airbrush') return;
    this.segment(x0, y0, x, y);
    this.last = { x, y };
  }

  tick() {
    if (this.kind === 'airbrush' && this.last) this.spray(this.last.x, this.last.y);
  }

  spray(x, y) {
    const ctx = this.ctx;
    const radius = this.size;
    const dots = Math.max(6, Math.round(radius * 1.4));
    ctx.fillStyle = this.color;
    for (let i = 0; i < dots; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = radius * Math.sqrt(this.rand());
      ctx.fillRect(Math.floor(x + Math.cos(a) * r), Math.floor(y + Math.sin(a) * r), 1, 1);
    }
    this.mark(x, y, radius);
  }

  nib(x0, y0, x1, y1, angle, half) {
    const ctx = this.ctx;
    const nx = Math.cos(angle) * half;
    const ny = Math.sin(angle) * half;
    ctx.beginPath();
    ctx.moveTo(x0 + nx, y0 + ny);
    ctx.lineTo(x0 - nx, y0 - ny);
    ctx.lineTo(x1 - nx, y1 - ny);
    ctx.lineTo(x1 + nx, y1 + ny);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + nx, y0 + ny);
    ctx.lineTo(x0 - nx, y0 - ny);
    ctx.lineTo(x1 - nx, y1 - ny);
    ctx.lineTo(x1 + nx, y1 + ny);
    ctx.closePath();
    ctx.stroke();
  }

  round(x0, y0, x1, y1, width, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 + (x0 === x1 && y0 === y1 ? 0.01 : 0), y1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  segment(x0, y0, x1, y1) {
    const ctx = this.ctx;
    const s = this.size;
    switch (this.kind) {
      case 'calligraphyBrush':
        this.nib(x0, y0, x1, y1, -Math.PI / 4, s / 2);
        break;
      case 'calligraphyPen':
        this.nib(x0, y0, x1, y1, Math.PI / 4, Math.max(1, s / 2));
        break;
      case 'airbrush': {
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(2, s / 2)));
        for (let i = 1; i <= steps; i++) this.spray(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        return;
      }
      case 'oil': {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const px = dx || dy ? -dy / len : 0;
        const py = dx || dy ? dx / len : 1;
        ctx.lineCap = 'round';
        for (const b of this.bristles ?? []) {
          ctx.strokeStyle = b.color;
          ctx.globalAlpha = b.alpha;
          ctx.lineWidth = b.width;
          ctx.beginPath();
          ctx.moveTo(x0 + px * b.offset, y0 + py * b.offset);
          ctx.lineTo(x1 + px * b.offset + (len < 0.5 ? 0.01 : 0), y1 + py * b.offset);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = this.color;
        break;
      }
      case 'crayon':
        this.round(x0, y0, x1, y1, s * (0.92 + this.rand() * 0.16));
        break;
      case 'marker':
        ctx.lineCap = 'square';
        ctx.lineJoin = 'bevel';
        ctx.lineWidth = s;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1 + (x0 === x1 && y0 === y1 ? 0.01 : 0), y1);
        ctx.stroke();
        break;
      case 'pencil':
        this.round(x0, y0, x1, y1, Math.max(1, s * 0.5));
        break;
      case 'watercolor':
        this.round(x0, y0, x1, y1, s);
        break;
      default:
        this.round(x0, y0, x1, y1, s);
    }
    this.mark(x0, y0, s);
    this.mark(x1, y1, s);
  }

  path(points) {
    if (!points.length) return;
    this.begin(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) this.to(points[i][0], points[i][1]);
  }
}
