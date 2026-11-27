import { rotate90, rotate180, flip, invertColors, validateSize, skewSize, borderBackgroundMask, contentBounds } from '../core/raster.js';
import { segmentObject, refineEdges, applyMatte } from '../core/segment.js';
import { makeCanvas, context } from './document.js';

function canvasFromImage(image) {
  const canvas = makeCanvas(image.width, image.height);
  context(canvas).putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
}

function imageOf(canvas) {
  const image = context(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data };
}

function transformCanvas(canvas, op) {
  const image = imageOf(canvas);
  const out = op === 'right' ? rotate90(image, true) : op === 'left' ? rotate90(image, false) : op === '180' ? rotate180(image) : flip(image, op);
  return canvasFromImage(out);
}

function scaledCanvas(source, width, height, smooth = true) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function skewedCanvas(source, degX, degY, background = null) {
  const { width, height, tx, ty } = skewSize(source.width, source.height, degX, degY);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  const ox = tx < 0 ? -tx * source.height : 0;
  const oy = ty < 0 ? -ty * source.width : 0;
  ctx.setTransform(1, ty, tx, 1, ox, oy);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

export class Operations {
  constructor(app, notify) {
    this.app = app;
    this.notify = notify;
  }

  withFloating(label, fn) {
    const app = this.app;
    if (app.selection && !app.floating) app.lift();
    if (!app.floating) return false;
    const current = makeCanvas(app.floating.width, app.floating.height);
    const ctx = current.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(app.floating.canvas, 0, 0, current.width, current.height);
    app.replaceFloatingCanvas(fn(current));
    app.floating.label = label;
    return true;
  }

  rotate(op) {
    const labels = { right: 'Girar 90° à direita', left: 'Girar 90° à esquerda', 180: 'Girar 180°', horizontal: 'Virar na horizontal', vertical: 'Virar na vertical' };
    const label = labels[op];
    if (this.withFloating(label, (c) => transformCanvas(c, op))) return;
    const app = this.app;
    app.recordDocument(label, (doc) => {
      const swap = op === 'right' || op === 'left';
      const width = swap ? doc.height : doc.width;
      const height = swap ? doc.width : doc.height;
      doc.replaceSize(width, height, (ctx, old) => ctx.drawImage(transformCanvas(old.canvas, op), 0, 0));
    });
  }

  resize({ width, height, skewX = 0, skewY = 0, keepPixels = false }) {
    const app = this.app;
    const smooth = !keepPixels;
    if (app.selection) {
      this.withFloating('Redimensionar e inclinar', (c) => {
        let out = scaledCanvas(c, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), smooth);
        if (skewX || skewY) out = skewedCanvas(out, skewX, skewY);
        return out;
      });
      return;
    }
    const size = validateSize(width, height);
    const { width: fw, height: fh } = skewX || skewY ? skewSize(size.width, size.height, skewX, skewY) : size;
    validateSize(fw, fh);
    app.recordDocument('Redimensionar e inclinar', (doc) => {
      doc.replaceSize(fw, fh, (ctx, old, i) => {
        let out = scaledCanvas(old.canvas, size.width, size.height, smooth);
        if (skewX || skewY) out = skewedCanvas(out, skewX, skewY, i === 0 && !doc.transparent ? app.state.secondary : null);
        ctx.drawImage(out, 0, 0);
      });
    });
  }

  resizeCanvas(width, height, anchor = 'nw') {
    const app = this.app;
    const size = validateSize(width, height);
    app.recordDocument('Tamanho da tela', (doc) => {
      const dx = anchor.includes('e') ? size.width - doc.width : anchor.includes('w') ? 0 : Math.round((size.width - doc.width) / 2);
      const dy = anchor.includes('s') ? size.height - doc.height : anchor.includes('n') ? 0 : Math.round((size.height - doc.height) / 2);
      doc.replaceSize(size.width, size.height, (ctx, old, i) => {
        if (i === 0 && !doc.transparent) {
          ctx.fillStyle = app.state.secondary;
          ctx.fillRect(0, 0, size.width, size.height);
        }
        ctx.drawImage(old.canvas, dx, dy);
      });
    });
  }

  crop() {
    const app = this.app;
    const s = app.selection;
    if (!s) {
      this.notify('Selecione uma área primeiro: o Cortar deixa só o que está dentro da seleção.', 'info');
      return;
    }
    if (app.floating) {
      const f = app.floating;
      const content = makeCanvas(f.width, f.height);
      app.drawFloatingOnto(content.getContext('2d'), { ...f, x: 0, y: 0 });
      app.floating = null;
      const layer = app.layerById(f.layerId);
      layer?.write(f.before);
      app.recordDocument('Cortar', (doc) => {
        const index = doc.layers.findIndex((l) => l.id === f.layerId);
        doc.replaceSize(f.width, f.height, (ctx, old, i) => {
          if (i === index) ctx.drawImage(content, 0, 0);
          else ctx.drawImage(old.canvas, -f.x, -f.y);
        });
      });
      return;
    }
    const mask = app.selectionMaskCanvas(s);
    const vacated = app.state.secondary;
    app.recordDocument('Cortar', (doc) => {
      doc.replaceSize(s.width, s.height, (ctx, old, i) => {
        ctx.drawImage(old.canvas, -s.x, -s.y);
        if (mask) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-in';
          ctx.drawImage(mask, 0, 0);
          ctx.restore();
          if (i === 0 && !doc.transparent) {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = vacated;
            ctx.fillRect(0, 0, s.width, s.height);
            ctx.restore();
          }
        }
      });
    });
  }

  invertColors() {
    const app = this.app;
    if (app.selection || app.floating) {
      this.withFloating('Inverter cores', (c) => {
        const image = imageOf(c);
        invertColors(image);
        return canvasFromImage(image);
      });
      return;
    }
    const layer = app.doc.layer;
    app.recordPixels('Inverter cores', { x: 0, y: 0, width: app.doc.width, height: app.doc.height }, () => {
      const image = layer.read();
      invertColors(image);
      layer.write(image);
    });
  }

  keepObject() {
    const app = this.app;
    const s = app.selection;
    if (!s) return;
    if (app.floating) app.commitFloating();
    const layer = app.doc.layer;
    const full = { x: 0, y: 0, width: app.doc.width, height: app.doc.height };
    const before = { transparent: app.doc.transparent };
    app.recordDocument('Manter só o objeto', (doc) => {
      const image = layer.read();
      const alpha = new Uint8Array(doc.width * doc.height);
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          const gx = s.x + x;
          const gy = s.y + y;
          if (gx < 0 || gy < 0 || gx >= doc.width || gy >= doc.height) continue;
          alpha[gy * doc.width + gx] = s.mask ? s.mask[y * s.width + x] : 255;
        }
      }
      applyMatte(image, alpha);
      doc.layers.find((l) => l.id === layer.id).write(new ImageData(image.data, full.width, full.height));
      doc.transparent = true;
    });
    if (!before.transparent) this.notify('Fundo removido: a imagem agora tem fundo transparente. Salve como PNG para manter a transparência.', 'success', 5200);
  }

  removeObject() {
    const app = this.app;
    if (!app.selection) return;
    if (app.floating) app.commitFloating();
    app.deleteSelection();
  }

  removeBackground({ sensitivity = 50, removeHoles = false } = {}) {
    const app = this.app;
    if (app.floating) app.commitFloating();
    const layer = app.doc.layer;
    const image = layer.read();
    const rect = app.selection ? { x: app.selection.x, y: app.selection.y, width: app.selection.width, height: app.selection.height } : null;
    const result = segmentObject(image, { rect, sensitivity, removeHoles });
    if (!result.bounds) {
      this.notify('Não encontrei um objeto em destaque para separar do fundo.', 'warning', 4500);
      return false;
    }
    app.recordDocument('Remover fundo', (doc) => {
      applyMatte(image, result.alpha);
      doc.layers.find((l) => l.id === layer.id).write(new ImageData(image.data, doc.width, doc.height));
      doc.transparent = true;
    });
    return true;
  }

  transparentBackgroundPreview(tolerance) {
    const image = this.app.doc.layer.read();
    return this.knockOutBackground(image, tolerance);
  }

  knockOutBackground(image, tolerance) {
    const background = borderBackgroundMask(image, tolerance);
    const object = new Uint8Array(background.length);
    for (let p = 0; p < object.length; p++) object[p] = background[p] || image.data[p * 4 + 3] < 16 ? 0 : 1;
    const alpha = refineEdges(image, object, { x: 0, y: 0, width: image.width, height: image.height });
    applyMatte(image, alpha);
    return image;
  }

  makeBackgroundTransparent(tolerance) {
    const app = this.app;
    if (app.floating) app.commitFloating();
    const layer = app.doc.layer;
    app.recordDocument('Tornar fundo transparente', (doc) => {
      const image = this.knockOutBackground(layer.read(), tolerance);
      doc.layers.find((l) => l.id === layer.id).write(new ImageData(image.data, doc.width, doc.height));
      doc.transparent = true;
    });
  }

  setTransparent(on) {
    const app = this.app;
    if (app.doc.transparent === on) return;
    app.recordDocument(on ? 'Fundo transparente' : 'Fundo opaco', (doc) => {
      doc.transparent = on;
      if (!on) {
        const base = doc.layers[0];
        base.ctx.save();
        base.ctx.globalCompositeOperation = 'destination-over';
        base.ctx.fillStyle = app.state.secondary;
        base.ctx.fillRect(0, 0, doc.width, doc.height);
        base.ctx.restore();
      }
    }, { keepSelection: true });
  }

  trimToContent() {
    const app = this.app;
    const image = app.doc.composite().getContext('2d').getImageData(0, 0, app.doc.width, app.doc.height);
    const b = contentBounds(image);
    if (!b) return;
    app.setSelection({ ...b, mask: null });
    this.crop();
  }
}
