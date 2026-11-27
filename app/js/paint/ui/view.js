import { ZOOM_LEVELS, MIN_ZOOM, MAX_ZOOM } from './app.js';

const PAD = 24;
const HANDLE = 7;

function maskOutline(selection) {
  const { width: w, height: h, mask } = selection;
  const segments = [];
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128;
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on(x, y) !== on(x, y - 1);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        segments.push([start, y, x, y]);
        start = -1;
      }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && on(x, y) !== on(x - 1, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        segments.push([x, start, x, y]);
        start = -1;
      }
    }
  }
  return segments;
}

export class Stage {
  constructor(app, { stage, sizer, wrap, paper, overlay, rulerTop, rulerLeft, workspace }) {
    this.app = app;
    this.stage = stage;
    this.sizer = sizer;
    this.wrap = wrap;
    this.paper = paper;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.rulerTop = rulerTop;
    this.rulerLeft = rulerLeft;
    this.workspace = workspace;
    this.decorations = [];
    this.pointer = null;
    this.dash = 0;
    this.outlineCache = new WeakMap();
    this.padX = PAD;
    this.padY = PAD;
    app.attach(paper);
    new ResizeObserver(() => this.layout()).observe(stage);
    stage.addEventListener('scroll', () => this.drawOverlay());
    app.on('document', () => this.layout());
    app.on('render', () => this.drawOverlay());
    app.on('selection', () => this.drawOverlay());
    app.on('state', ({ key }) => {
      if (key === 'rulers' || key === 'gridlines') this.layout();
    });
    setInterval(() => {
      if (!this.app.selection || document.hidden) return;
      this.dash = (this.dash + 1) % 8;
      this.drawOverlay();
    }, 120);
  }

  get zoom() {
    return this.app.state.zoom;
  }

  layout() {
    const { width, height } = this.app.doc;
    const z = this.zoom;
    const rulers = this.app.state.rulers;
    this.workspace.classList.toggle('with-rulers', rulers);
    const vw = this.stage.clientWidth;
    const vh = this.stage.clientHeight;
    const w = Math.round(width * z);
    const h = Math.round(height * z);
    this.padX = Math.max(PAD, Math.floor((vw - w) / 2));
    this.padY = Math.max(PAD, Math.floor((vh - h) / 2));
    this.sizer.style.width = `${w + this.padX * 2}px`;
    this.sizer.style.height = `${h + this.padY * 2}px`;
    Object.assign(this.wrap.style, { left: `${this.padX}px`, top: `${this.padY}px`, width: `${w}px`, height: `${h}px` });
    this.paper.classList.toggle('pixelated', z >= 2);
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.overlay, this.rulerTop, this.rulerLeft]) {
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
        c.width = Math.max(1, Math.round(cw * dpr));
        c.height = Math.max(1, Math.round(ch * dpr));
      }
    }
    this.app.emit('layout');
    this.drawOverlay();
  }

  toImage(e) {
    const r = this.paper.getBoundingClientRect();
    const z = this.zoom;
    const x = (e.clientX - r.left) / z;
    const y = (e.clientY - r.top) / z;
    return { x, y, ix: Math.floor(x), iy: Math.floor(y), inside: x >= 0 && y >= 0 && x < this.app.doc.width && y < this.app.doc.height };
  }

  toScreen(x, y) {
    return { x: this.padX + x * this.zoom - this.stage.scrollLeft, y: this.padY + y * this.zoom - this.stage.scrollTop };
  }

  setZoom(value, anchor = null) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
    const s = this.stage.getBoundingClientRect();
    const ax = anchor ? anchor.clientX - s.left : this.stage.clientWidth / 2;
    const ay = anchor ? anchor.clientY - s.top : this.stage.clientHeight / 2;
    const ix = (this.stage.scrollLeft + ax - this.padX) / this.zoom;
    const iy = (this.stage.scrollTop + ay - this.padY) / this.zoom;
    this.app.setState('zoom', z);
    this.layout();
    this.stage.scrollLeft = this.padX + ix * z - ax;
    this.stage.scrollTop = this.padY + iy * z - ay;
    this.app.emit('zoom', z);
    this.drawOverlay();
  }

  zoomStep(direction, anchor = null) {
    const z = this.zoom;
    const next = direction > 0 ? ZOOM_LEVELS.find((v) => v > z + 1e-6) ?? MAX_ZOOM : [...ZOOM_LEVELS].reverse().find((v) => v < z - 1e-6) ?? MIN_ZOOM;
    this.setZoom(next, anchor);
  }

  fit() {
    const { width, height } = this.app.doc;
    const z = Math.min((this.stage.clientWidth - PAD * 2) / width, (this.stage.clientHeight - PAD * 2) / height, 1);
    this.setZoom(Math.max(MIN_ZOOM, z));
    this.stage.scrollLeft = 0;
    this.stage.scrollTop = 0;
  }

  actualSize() {
    this.setZoom(1);
  }

  handles(rect) {
    const a = this.toScreen(rect.x, rect.y);
    const b = this.toScreen(rect.x + rect.width, rect.y + rect.height);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return [
      ['nw', a.x, a.y],
      ['n', mx, a.y],
      ['ne', b.x, a.y],
      ['e', b.x, my],
      ['se', b.x, b.y],
      ['s', mx, b.y],
      ['sw', a.x, b.y],
      ['w', a.x, my],
    ];
  }

  hitHandle(rect, e) {
    if (!rect) return null;
    const s = this.stage.getBoundingClientRect();
    const px = e.clientX - s.left;
    const py = e.clientY - s.top;
    for (const [id, x, y] of this.handles(rect)) {
      if (Math.abs(px - x) <= HANDLE && Math.abs(py - y) <= HANDLE) return id;
    }
    return null;
  }

  drawHandles(ctx, rect, { dashed = true } = {}) {
    const a = this.toScreen(rect.x, rect.y);
    const b = this.toScreen(rect.x + rect.width, rect.y + rect.height);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = getComputedStyle(this.workspace).getPropertyValue('--accent') || '#2b3f8c';
    if (dashed) ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
    ctx.setLineDash([]);
    for (const [, x, y] of this.handles(rect)) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7);
      ctx.strokeRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7);
    }
    ctx.restore();
  }

  selectionPath(selection) {
    if (!selection.mask) return null;
    if (!this.outlineCache.has(selection)) this.outlineCache.set(selection, maskOutline(selection));
    return this.outlineCache.get(selection);
  }

  drawAnts(ctx, selection) {
    const z = this.zoom;
    const o = this.toScreen(selection.x, selection.y);
    ctx.save();
    ctx.lineWidth = 1;
    const stroke = (dash) => {
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = dash;
      ctx.beginPath();
      const segs = selection.points ? null : this.selectionPath(selection);
      if (selection.points) {
        selection.points.forEach(([x, y], i) => {
          const p = this.toScreen(x, y);
          if (i) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
        });
        ctx.closePath();
      } else if (segs) {
        for (const [x0, y0, x1, y1] of segs) {
          ctx.moveTo(Math.round(o.x + x0 * z) + 0.5, Math.round(o.y + y0 * z) + 0.5);
          ctx.lineTo(Math.round(o.x + x1 * z) + 0.5, Math.round(o.y + y1 * z) + 0.5);
        }
      } else {
        ctx.rect(Math.round(o.x) + 0.5, Math.round(o.y) + 0.5, Math.round(selection.width * z), Math.round(selection.height * z));
      }
      ctx.stroke();
    };
    ctx.strokeStyle = '#ffffff';
    stroke(this.dash);
    ctx.strokeStyle = '#000000';
    stroke(this.dash + 4);
    ctx.restore();
  }

  drawGrid(ctx) {
    const { width, height } = this.app.doc;
    const z = this.zoom;
    let step = 1;
    if (z < 4) step = [5, 10, 20, 50, 100, 200, 500, 1000].find((s) => s * z >= 12) ?? 1000;
    const a = this.toScreen(0, 0);
    const b = this.toScreen(width, height);
    const x0 = Math.max(0, Math.floor((-a.x) / z / step) * step);
    const y0 = Math.max(0, Math.floor((-a.y) / z / step) * step);
    ctx.save();
    ctx.beginPath();
    for (let x = x0; x <= width; x += step) {
      const sx = Math.round(a.x + x * z) + 0.5;
      if (sx > this.overlay.clientWidth) break;
      ctx.moveTo(sx, Math.max(0, a.y));
      ctx.lineTo(sx, Math.min(this.overlay.clientHeight, b.y));
    }
    for (let y = y0; y <= height; y += step) {
      const sy = Math.round(a.y + y * z) + 0.5;
      if (sy > this.overlay.clientHeight) break;
      ctx.moveTo(Math.max(0, a.x), sy);
      ctx.lineTo(Math.min(this.overlay.clientWidth, b.x), sy);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.stroke();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();
    ctx.restore();
  }

  drawRulers() {
    if (!this.app.state.rulers) return;
    const dpr = window.devicePixelRatio || 1;
    const styles = getComputedStyle(this.workspace);
    const text = styles.getPropertyValue('--text-muted').trim() || '#555';
    const bg = styles.getPropertyValue('--surface-2').trim() || '#fff';
    const accent = styles.getPropertyValue('--accent').trim() || '#2b3f8c';
    const z = this.zoom;
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find((s) => s * z >= 50) ?? 2000;
    const minor = step / (step % 5 === 0 ? 5 : 2);
    for (const [canvas, horizontal] of [
      [this.rulerTop, true],
      [this.rulerLeft, false],
    ]) {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const length = horizontal ? canvas.clientWidth : canvas.clientHeight;
      const thick = horizontal ? canvas.clientHeight : canvas.clientWidth;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, horizontal ? length : thick, horizontal ? thick : length);
      ctx.strokeStyle = text;
      ctx.fillStyle = text;
      ctx.font = '10px system-ui, sans-serif';
      ctx.lineWidth = 1;
      const origin = horizontal ? this.toScreen(0, 0).x : this.toScreen(0, 0).y;
      const first = Math.floor(-origin / z / minor) * minor;
      ctx.beginPath();
      for (let v = first; origin + v * z <= length; v += minor) {
        const p = Math.round(origin + v * z) + 0.5;
        if (p < 0) continue;
        const major = Math.abs(v % step) < 1e-6;
        const t = major ? thick * 0.55 : thick * 0.25;
        if (horizontal) {
          ctx.moveTo(p, thick);
          ctx.lineTo(p, thick - t);
          if (major) ctx.fillText(String(Math.round(v)), p + 2, 9);
        } else {
          ctx.moveTo(thick, p);
          ctx.lineTo(thick - t, p);
          if (major) {
            ctx.save();
            ctx.translate(9, p + 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(Math.round(v)), -ctx.measureText(String(Math.round(v))).width - 2, 0);
            ctx.restore();
          }
        }
      }
      ctx.stroke();
      if (this.pointer) {
        const p = horizontal ? this.toScreen(this.pointer.x, 0).x : this.toScreen(0, this.pointer.y).y;
        ctx.strokeStyle = accent;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(Math.round(p) + 0.5, 0);
          ctx.lineTo(Math.round(p) + 0.5, thick);
        } else {
          ctx.moveTo(0, Math.round(p) + 0.5);
          ctx.lineTo(thick, Math.round(p) + 0.5);
        }
        ctx.stroke();
      }
    }
  }

  drawOverlay() {
    const ctx = this.octx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.overlay.clientWidth, this.overlay.clientHeight);
    if (this.app.state.gridlines) this.drawGrid(ctx);
    const s = this.app.selection;
    if (s) {
      this.drawAnts(ctx, s);
      if (this.app.floating || this.app.state.tool === 'select' || this.app.state.tool === 'objectSelect') {
        if (!s.mask || this.app.floating) this.drawHandles(ctx, s, { dashed: false });
      }
    }
    for (const decorate of this.decorations) decorate(ctx, this);
    this.drawRulers();
  }
}
