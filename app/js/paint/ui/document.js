import { validateSize } from '../core/raster.js';

let counter = 0;
const nextId = () => `camada-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function context(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true });
}

export class Layer {
  constructor(width, height, { name = 'Camada', visible = true, opacity = 1, id = nextId() } = {}) {
    this.id = id;
    this.name = name;
    this.visible = visible;
    this.opacity = opacity;
    this.canvas = makeCanvas(width, height);
    this.ctx = context(this.canvas);
  }

  get width() {
    return this.canvas.width;
  }

  get height() {
    return this.canvas.height;
  }

  read(rect = null) {
    const r = rect ?? { x: 0, y: 0, width: this.width, height: this.height };
    return this.ctx.getImageData(r.x, r.y, r.width, r.height);
  }

  write(image, x = 0, y = 0) {
    this.ctx.putImageData(image, x, y);
  }

  clone(name = this.name) {
    const copy = new Layer(this.width, this.height, { name, visible: this.visible, opacity: this.opacity });
    copy.ctx.drawImage(this.canvas, 0, 0);
    return copy;
  }
}

export class PaintDocument {
  constructor(width, height, { name = 'Sem título', background = '#ffffff', dpi = 96 } = {}) {
    const size = validateSize(width, height);
    this.width = size.width;
    this.height = size.height;
    this.name = name;
    this.dpi = dpi;
    this.transparent = background === null;
    this.layers = [];
    const base = new Layer(this.width, this.height, { name: 'Fundo' });
    if (background) {
      base.ctx.fillStyle = background;
      base.ctx.fillRect(0, 0, this.width, this.height);
    }
    this.layers.push(base);
    this.active = 0;
  }

  get layer() {
    return this.layers[this.active];
  }

  isBackground(layer = this.layer) {
    return layer === this.layers[0] && !this.transparent;
  }

  addLayer(name = `Camada ${this.layers.length + 1}`, index = this.active + 1) {
    const layer = new Layer(this.width, this.height, { name });
    this.layers.splice(index, 0, layer);
    this.active = index;
    return layer;
  }

  composite(target = null, { rect = null, include = null } = {}) {
    const canvas = target ?? makeCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');
    const r = rect ?? { x: 0, y: 0, width: this.width, height: this.height };
    ctx.save();
    ctx.clearRect(r.x, r.y, r.width, r.height);
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.width, r.height);
    ctx.clip();
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      if (include && !include(layer)) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.restore();
    return canvas;
  }

  snapshot() {
    return {
      width: this.width,
      height: this.height,
      active: this.active,
      transparent: this.transparent,
      dpi: this.dpi,
      layers: this.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, image: l.read() })),
    };
  }

  restore(snap) {
    this.width = snap.width;
    this.height = snap.height;
    this.transparent = snap.transparent;
    this.dpi = snap.dpi;
    this.layers = snap.layers.map((s) => {
      const layer = new Layer(snap.width, snap.height, { name: s.name, visible: s.visible, opacity: s.opacity, id: s.id });
      layer.write(s.image);
      return layer;
    });
    this.active = Math.min(snap.active, this.layers.length - 1);
  }

  static snapshotBytes(snap) {
    return snap.layers.reduce((t, l) => t + l.image.data.length, 0);
  }

  replaceSize(width, height, draw) {
    const size = validateSize(width, height);
    this.layers = this.layers.map((old, i) => {
      const layer = new Layer(size.width, size.height, { name: old.name, visible: old.visible, opacity: old.opacity, id: old.id });
      draw(layer.ctx, old, i);
      return layer;
    });
    this.width = size.width;
    this.height = size.height;
  }
}
