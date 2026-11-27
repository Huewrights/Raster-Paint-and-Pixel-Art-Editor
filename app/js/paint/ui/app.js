import { History } from '../core/history.js';
import { clipRect, rectUnion, inflate, maskBounds } from '../core/raster.js';
import { parseHex, CUSTOM_SLOTS } from '../core/color.js';
import { STYLE_FINISH, textureAlpha } from '../core/brushes.js';
import { PaintDocument, Layer, makeCanvas, context } from './document.js';

export const ZOOM_LEVELS = [0.125, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];
export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS.at(-1);

export const DEFAULT_SIZES = { pencil: 1, brush: 6, eraser: 10, shape: 3 };

export class PaintApp {
  constructor() {
    this.listeners = new Map();
    this.history = new History();
    this.history.on(() => this.emit('history'));
    this.state = {
      tool: 'pencil',
      previousTool: 'pencil',
      selectMode: 'rect',
      brush: 'brush',
      shape: 'rectangle',
      outline: 'solid',
      fill: 'none',
      sizes: { ...DEFAULT_SIZES },
      opacity: 100,
      primary: '#000000',
      secondary: '#ffffff',
      custom: Array(CUSTOM_SLOTS).fill(null),
      transparentSelection: false,
      fillTolerance: 0,
      eraserMode: 'transparent',
      objectSensitivity: 50,
      objectHoles: false,
      text: { font: 'Segoe UI', size: 24, bold: false, italic: false, underline: false, strike: false, align: 'left', background: false },
      zoom: 1,
      rulers: false,
      gridlines: false,
      statusbar: true,
      layersPanel: false,
      thumbnail: false,
    };
    this.doc = new PaintDocument(1152, 648);
    this.file = { name: null, format: 'png', target: null, size: null, savedAt: null };
    this.savedVersion = 0;
    this.selection = null;
    this.floating = null;
    this.preview = null;
    this.clipboard = null;
    this.textures = new Map();
    this.strokeCanvas = null;
    this.scratch = null;
    this.paper = null;
    this.ensureBuffers();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  get modified() {
    return this.history.version !== this.savedVersion;
  }

  markSaved(info = {}) {
    Object.assign(this.file, info);
    this.savedVersion = this.history.version;
    this.emit('history');
    this.emit('file');
  }

  setState(key, value) {
    if (this.state[key] === value) return;
    const previous = this.state[key];
    this.state[key] = value;
    if (key === 'tool' && previous !== value) this.state.previousTool = previous;
    this.emit('state', { key, value, previous });
  }

  setText(patch) {
    this.state.text = { ...this.state.text, ...patch };
    this.emit('state', { key: 'text', value: this.state.text });
  }

  get size() {
    return this.state.sizes[this.sizeKey()] ?? 1;
  }

  set size(value) {
    const key = this.sizeKey();
    const limit = key === 'pencil' ? 32 : 100;
    this.state.sizes = { ...this.state.sizes, [key]: Math.max(1, Math.min(limit, Math.round(value))) };
    this.emit('state', { key: 'sizes', value: this.state.sizes });
  }

  sizeKey() {
    const t = this.state.tool;
    if (t === 'pencil' || t === 'eraser' || t === 'brush' || t === 'shape') return t;
    return 'brush';
  }

  setColor(which, hex) {
    const key = which === 'secondary' ? 'secondary' : 'primary';
    this.setState(key, hex.toLowerCase());
  }

  swapColors() {
    const { primary, secondary } = this.state;
    this.state.primary = secondary;
    this.state.secondary = primary;
    this.emit('state', { key: 'primary', value: secondary });
    this.emit('state', { key: 'secondary', value: primary });
  }

  addCustomColor(hex) {
    const custom = [...this.state.custom];
    const existing = custom.indexOf(hex);
    if (existing >= 0) return;
    const empty = custom.indexOf(null);
    if (empty >= 0) custom[empty] = hex;
    else {
      custom.shift();
      custom.push(hex);
    }
    this.setState('custom', custom);
  }

  colorFor(button) {
    return button === 2 ? this.state.secondary : this.state.primary;
  }

  ensureBuffers() {
    const { width, height } = this.doc;
    if (!this.strokeCanvas || this.strokeCanvas.width !== width || this.strokeCanvas.height !== height) {
      this.strokeCanvas = makeCanvas(width, height);
      this.strokeCtx = context(this.strokeCanvas);
      this.scratch = makeCanvas(width, height);
      this.scratchCtx = this.scratch.getContext('2d');
      this.texCanvas = makeCanvas(width, height);
      this.texCtx = this.texCanvas.getContext('2d');
    }
  }

  attach(paper) {
    this.paper = paper;
    this.paperCtx = paper.getContext('2d');
    this.layoutPaper();
  }

  layoutPaper() {
    if (!this.paper) return;
    if (this.paper.width !== this.doc.width || this.paper.height !== this.doc.height) {
      this.paper.width = this.doc.width;
      this.paper.height = this.doc.height;
    }
    this.render();
  }

  texturePattern(ctx, kind) {
    if (!this.textures.has(kind)) {
      const { size, alpha } = textureAlpha(kind);
      const canvas = makeCanvas(size, size);
      const c = canvas.getContext('2d');
      const image = c.createImageData(size, size);
      for (let i = 0; i < alpha.length; i++) {
        image.data[i * 4 + 3] = alpha[i];
      }
      c.putImageData(image, 0, 0);
      this.textures.set(kind, canvas);
    }
    return ctx.createPattern(this.textures.get(kind), 'repeat');
  }

  finishOnto(target, source, rect, { style = 'solid', opacity = 1, erase = false } = {}) {
    const finish = STYLE_FINISH[style] ?? STYLE_FINISH.solid;
    const r = clipRect(rect, this.doc.width, this.doc.height);
    if (!r) return;
    let from = source;
    if (finish.texture) {
      const t = this.texCtx;
      t.save();
      t.clearRect(r.x, r.y, r.width, r.height);
      t.drawImage(source, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
      t.globalCompositeOperation = 'destination-in';
      t.fillStyle = this.texturePattern(t, finish.texture);
      t.fillRect(r.x, r.y, r.width, r.height);
      t.restore();
      from = this.texCanvas;
    }
    target.save();
    target.globalAlpha = finish.alpha * opacity;
    if (finish.blur) target.filter = `blur(${finish.blur}px)`;
    if (erase) target.globalCompositeOperation = 'destination-out';
    target.drawImage(from, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
    target.restore();
  }

  render(rect = null) {
    if (!this.paperCtx) return;
    const full = { x: 0, y: 0, width: this.doc.width, height: this.doc.height };
    const r = clipRect(rect ?? full, this.doc.width, this.doc.height);
    if (!r) return;
    const ctx = this.paperCtx;
    ctx.save();
    ctx.clearRect(r.x, r.y, r.width, r.height);
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.width, r.height);
    ctx.clip();
    for (const layer of this.doc.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      if (layer === this.doc.layer && (this.preview || this.floating)) {
        const s = this.scratchCtx;
        s.save();
        s.clearRect(r.x, r.y, r.width, r.height);
        s.beginPath();
        s.rect(r.x, r.y, r.width, r.height);
        s.clip();
        s.drawImage(layer.canvas, 0, 0);
        this.preview?.(s, r);
        if (this.floating) this.drawFloating(s);
        s.restore();
        ctx.drawImage(this.scratch, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
      } else {
        ctx.drawImage(layer.canvas, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
      }
    }
    ctx.restore();
    this.emit('render', r);
  }

  changed(rect = null) {
    this.render(rect);
    this.emit('pixels', rect);
  }

  documentChanged() {
    this.ensureBuffers();
    this.layoutPaper();
    this.emit('document');
  }

  layerById(id) {
    return this.doc.layers.find((l) => l.id === id) ?? null;
  }

  recordPixels(label, rect, mutate, layer = this.doc.layer) {
    const r = clipRect(rect, this.doc.width, this.doc.height);
    if (!r) {
      mutate();
      return false;
    }
    const id = layer.id;
    const before = layer.read(r);
    const result = mutate();
    if (result === false) return false;
    const after = layer.read(r);
    this.history.push({
      label,
      bytes: before.data.length * 2,
      undo: () => {
        this.layerById(id)?.write(before, r.x, r.y);
        this.changed(r);
      },
      redo: () => {
        this.layerById(id)?.write(after, r.x, r.y);
        this.changed(r);
      },
    });
    this.changed(r);
    return true;
  }

  recordDocument(label, mutate, { keepSelection = false } = {}) {
    const before = this.doc.snapshot();
    const name = this.doc.name;
    const result = mutate(this.doc);
    if (result === false) return false;
    const after = this.doc.snapshot();
    const apply = (snap) => {
      this.cancelTransient();
      this.doc.restore(snap);
      this.doc.name = name;
      this.documentChanged();
    };
    this.history.push({ label, bytes: PaintDocument.snapshotBytes(before) + PaintDocument.snapshotBytes(after), undo: () => apply(before), redo: () => apply(after) });
    if (!keepSelection) this.clearSelection();
    this.documentChanged();
    return true;
  }

  cancelTransient() {
    this.preview = null;
    this.floating = null;
    this.selection = null;
    this.emit('selection');
    this.emit('cancel');
  }

  undo() {
    this.emit('before-history');
    if (this.floating) {
      this.dropFloating();
      return;
    }
    this.history.undo();
  }

  redo() {
    this.emit('before-history');
    this.history.redo();
  }

  load(doc, file = {}) {
    this.cancelTransient();
    this.doc = doc;
    this.file = { name: null, format: 'png', target: null, size: null, savedAt: null, ...file };
    this.history.clear();
    this.savedVersion = this.history.version;
    this.documentChanged();
    this.emit('file');
    this.emit('history');
  }

  vacatedFill(layer = this.doc.layer) {
    return this.doc.isBackground(layer) ? this.state.secondary : null;
  }

  setSelection(selection) {
    if (this.floating) this.commitFloating();
    this.selection = selection ? normalizeSelection(selection, this.doc.width, this.doc.height) : null;
    this.emit('selection');
  }

  clearSelection() {
    if (this.floating) this.commitFloating();
    if (!this.selection) return;
    this.selection = null;
    this.emit('selection');
  }

  selectAll() {
    this.setSelection({ x: 0, y: 0, width: this.doc.width, height: this.doc.height, mask: null });
  }

  invertSelection() {
    const { width, height } = this.doc;
    if (this.floating) this.commitFloating();
    const mask = new Uint8Array(width * height).fill(255);
    const s = this.selection;
    if (s) {
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          const v = s.mask ? s.mask[y * s.width + x] : 255;
          const gx = s.x + x;
          const gy = s.y + y;
          if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
          mask[gy * width + gx] = 255 - v;
        }
      }
    } else mask.fill(0);
    const b = maskBounds(mask, width, height);
    if (!b) {
      this.clearSelection();
      return;
    }
    const cropped = new Uint8Array(b.width * b.height);
    for (let y = 0; y < b.height; y++) cropped.set(mask.subarray((b.y + y) * width + b.x, (b.y + y) * width + b.x + b.width), y * b.width);
    this.setSelection({ ...b, mask: cropped });
  }

  selectionMaskCanvas(selection = this.selection) {
    if (!selection?.mask) return null;
    const canvas = makeCanvas(selection.width, selection.height);
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(selection.width, selection.height);
    for (let i = 0; i < selection.mask.length; i++) image.data[i * 4 + 3] = selection.mask[i];
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  extractSelection(layer = this.doc.layer, selection = this.selection) {
    const s = selection;
    const canvas = makeCanvas(s.width, s.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(layer.canvas, -s.x, -s.y);
    const mask = this.selectionMaskCanvas(s);
    if (mask) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, 0, 0);
    }
    return canvas;
  }

  clearSelectionArea(ctx, selection, fill) {
    const s = selection;
    const mask = this.selectionMaskCanvas(s);
    ctx.save();
    if (mask) {
      const tinted = makeCanvas(s.width, s.height);
      const t = tinted.getContext('2d');
      t.drawImage(mask, 0, 0);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = fill ?? '#000';
      t.fillRect(0, 0, s.width, s.height);
      if (!fill) ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(tinted, s.x, s.y);
    } else if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(s.x, s.y, s.width, s.height);
    } else ctx.clearRect(s.x, s.y, s.width, s.height);
    ctx.restore();
  }

  lift() {
    if (this.floating || !this.selection) return this.floating;
    const layer = this.doc.layer;
    const s = this.selection;
    const content = this.extractSelection(layer, s);
    const before = layer.read();
    this.clearSelectionArea(layer.ctx, s, this.vacatedFill(layer));
    this.floating = { canvas: content, x: s.x, y: s.y, width: s.width, height: s.height, layerId: layer.id, before, label: 'Mover seleção' };
    this.selection = { ...s, x: s.x, y: s.y };
    this.render();
    this.emit('selection');
    return this.floating;
  }

  placeFloating(canvas, x, y, label = 'Colar') {
    if (this.floating) this.commitFloating();
    const layer = this.doc.layer;
    this.floating = { canvas, x, y, width: canvas.width, height: canvas.height, layerId: layer.id, before: layer.read(), label };
    this.selection = { x, y, width: canvas.width, height: canvas.height, mask: null };
    this.render();
    this.emit('selection');
  }

  floatingContent() {
    const f = this.floating;
    if (!f) return null;
    if (!this.state.transparentSelection) return f.canvas;
    const c = parseHex(this.state.secondary);
    const out = makeCanvas(f.canvas.width, f.canvas.height);
    const ctx = context(out);
    ctx.drawImage(f.canvas, 0, 0);
    const image = ctx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < image.data.length; i += 4) {
      if (Math.abs(image.data[i] - c.r) + Math.abs(image.data[i + 1] - c.g) + Math.abs(image.data[i + 2] - c.b) <= 6) image.data[i + 3] = 0;
    }
    ctx.putImageData(image, 0, 0);
    return out;
  }

  drawFloating(ctx) {
    const f = this.floating;
    if (!f) return;
    ctx.save();
    ctx.imageSmoothingEnabled = f.width !== f.canvas.width || f.height !== f.canvas.height;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.floatingContent(), f.x, f.y, f.width, f.height);
    ctx.restore();
  }

  moveFloating(x, y) {
    if (!this.floating) return;
    const old = { x: this.floating.x, y: this.floating.y, width: this.floating.width, height: this.floating.height };
    this.floating.x = Math.round(x);
    this.floating.y = Math.round(y);
    this.selection = { ...this.selection, x: this.floating.x, y: this.floating.y, width: this.floating.width, height: this.floating.height, mask: null };
    this.render(inflate(rectUnion(old, this.floating), 2));
    this.emit('selection');
  }

  resizeFloating(rect) {
    if (!this.floating) return;
    const old = { x: this.floating.x, y: this.floating.y, width: this.floating.width, height: this.floating.height };
    Object.assign(this.floating, { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
    this.selection = { x: this.floating.x, y: this.floating.y, width: this.floating.width, height: this.floating.height, mask: null };
    this.render(inflate(rectUnion(old, this.floating), 2));
    this.emit('selection');
  }

  replaceFloatingCanvas(canvas) {
    if (!this.floating) return;
    const old = { ...this.floating };
    this.floating.canvas = canvas;
    this.floating.width = canvas.width;
    this.floating.height = canvas.height;
    this.selection = { x: this.floating.x, y: this.floating.y, width: canvas.width, height: canvas.height, mask: null };
    this.render(inflate(rectUnion(old, this.floating), 2));
    this.emit('selection');
  }

  commitFloating() {
    const f = this.floating;
    if (!f) return;
    const layer = this.layerById(f.layerId) ?? this.doc.layer;
    this.floating = null;
    this.drawFloatingOnto(layer.ctx, f);
    const after = layer.read();
    const before = f.before;
    const id = layer.id;
    this.history.push({
      label: f.label,
      bytes: before.data.length * 2,
      undo: () => {
        this.layerById(id)?.write(before);
        this.changed();
      },
      redo: () => {
        this.layerById(id)?.write(after);
        this.changed();
      },
    });
    this.selection = null;
    this.changed();
    this.emit('selection');
  }

  drawFloatingOnto(ctx, f) {
    const saved = this.floating;
    this.floating = f;
    this.drawFloating(ctx);
    this.floating = saved;
  }

  dropFloating() {
    const f = this.floating;
    if (!f) return;
    const layer = this.layerById(f.layerId);
    this.floating = null;
    layer?.write(f.before);
    this.selection = null;
    this.changed();
    this.emit('selection');
  }

  deleteSelection() {
    if (this.floating) {
      const f = this.floating;
      this.floating = null;
      const layer = this.layerById(f.layerId) ?? this.doc.layer;
      const after = layer.read();
      const before = f.before;
      const id = layer.id;
      this.history.push({
        label: 'Excluir seleção',
        bytes: before.data.length * 2,
        undo: () => {
          this.layerById(id)?.write(before);
          this.changed();
        },
        redo: () => {
          this.layerById(id)?.write(after);
          this.changed();
        },
      });
      this.selection = null;
      this.changed();
      this.emit('selection');
      return;
    }
    const s = this.selection;
    if (!s) return;
    const layer = this.doc.layer;
    this.recordPixels('Excluir seleção', s, () => this.clearSelectionArea(layer.ctx, s, this.vacatedFill(layer)));
    this.selection = null;
    this.emit('selection');
  }

  addLayer() {
    this.recordDocument('Nova camada', (d) => d.addLayer(), { keepSelection: true });
  }

  visibleImage() {
    return this.doc.composite();
  }
}

export function normalizeSelection(s, width, height) {
  const x = Math.round(s.x);
  const y = Math.round(s.y);
  const w = Math.max(1, Math.round(s.width));
  const h = Math.max(1, Math.round(s.height));
  if (s.mask) return { x, y, width: w, height: h, mask: s.mask, points: s.points ?? null, object: Boolean(s.object) };
  const r = clipRect({ x, y, width: w, height: h }, width, height);
  return r ? { ...r, mask: null } : null;
}

export { Layer };
