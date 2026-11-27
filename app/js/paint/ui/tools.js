import { StrokeEngine } from '../core/brushes.js';
import { floodMask, linePoints, constrainRect, snapAngle, clipRect, rectUnion, inflate, createImage } from '../core/raster.js';
import { parseHex } from '../core/color.js';
import { shapePath, toPath2D, flatten, isOpenShape, pathBounds } from '../core/shapes.js';
import { segmentObject } from '../core/segment.js';
import { makeCanvas } from './document.js';

export const TOOLS = {
  select: { name: 'Seleção', key: 's' },
  objectSelect: { name: 'Seleção automática de objeto', key: 'o' },
  pencil: { name: 'Lápis', key: 'p' },
  fill: { name: 'Preenchimento com cor', key: 'f' },
  text: { name: 'Texto', key: 't' },
  eraser: { name: 'Borracha', key: 'e' },
  picker: { name: 'Seletor de cores', key: 'i' },
  magnifier: { name: 'Lupa', key: 'z' },
  brush: { name: 'Pincéis', key: 'b' },
  shape: { name: 'Formas', key: 'u' },
};

const CURSORS = {
  pencil: 'crosshair',
  fill: 'crosshair',
  text: 'text',
  eraser: 'none',
  picker: 'crosshair',
  magnifier: 'zoom-in',
  brush: 'none',
  shape: 'crosshair',
  select: 'crosshair',
  objectSelect: 'crosshair',
};

const HANDLE_CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

function insideRect(r, x, y) {
  return r && x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
}

function resizeRect(start, handle, dx, dy, keep = false) {
  let { x, y, width, height } = start;
  if (handle.includes('w')) {
    x += dx;
    width -= dx;
  }
  if (handle.includes('e')) width += dx;
  if (handle.includes('n')) {
    y += dy;
    height -= dy;
  }
  if (handle.includes('s')) height += dy;
  if (keep && handle.length === 2) {
    const ratio = start.width / start.height || 1;
    if (Math.abs(width / ratio) > Math.abs(height)) height = width / ratio;
    else width = height * ratio;
    if (handle.includes('n')) y = start.y + start.height - height;
    if (handle.includes('w')) x = start.x + start.width - width;
  }
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}

export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (line && ctx.measureText(candidate).width > maxWidth && word.trim()) {
        lines.push(line.trimEnd());
        line = word.trimStart();
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export function fontString(style, size = style.size) {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size}px "${style.font}", sans-serif`;
}

export function renderText(ctx, box, text, style, { color, background }) {
  ctx.save();
  ctx.font = fontString(style);
  ctx.textBaseline = 'top';
  const lineHeight = Math.round(style.size * 1.25);
  const pad = 2;
  const lines = wrapText(ctx, text, Math.max(1, box.width - pad * 2));
  if (style.background && background) {
    ctx.fillStyle = background;
    ctx.fillRect(box.x, box.y, box.width, box.height);
  }
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.round(style.size / 14));
  lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    const x = style.align === 'center' ? box.x + (box.width - w) / 2 : style.align === 'right' ? box.x + box.width - pad - w : box.x + pad;
    const y = box.y + pad + i * lineHeight;
    ctx.fillText(line, x, y);
    if (style.underline) {
      ctx.beginPath();
      ctx.moveTo(x, y + style.size * 1.05);
      ctx.lineTo(x + w, y + style.size * 1.05);
      ctx.stroke();
    }
    if (style.strike) {
      ctx.beginPath();
      ctx.moveTo(x, y + style.size * 0.55);
      ctx.lineTo(x + w, y + style.size * 0.55);
      ctx.stroke();
    }
  });
  ctx.restore();
  return lines.length * lineHeight + pad * 2;
}

export class ToolController {
  constructor(app, stage, { textEditor, onBusy = () => {} }) {
    this.app = app;
    this.stage = stage;
    this.textEditor = textEditor;
    this.onBusy = onBusy;
    this.gesture = null;
    this.shape = null;
    this.text = null;
    this.rubber = null;
    this.hover = null;
    this.spaceDown = false;
    this.lastObject = null;
    const el = stage.stage;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('pointerleave', () => {
      this.hover = null;
      this.stage.pointer = null;
      app.emit('pointer', null);
      stage.drawOverlay();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        stage.zoomStep(e.deltaY < 0 ? 1 : -1, e);
      },
      { passive: false },
    );
    el.addEventListener('dblclick', (e) => {
      if (app.state.tool === 'shape' && this.shape?.id === 'polygon' && this.shape.phase === 'points') {
        e.preventDefault();
        this.closePolygon();
      }
    });
    stage.decorations.push((ctx) => this.decorate(ctx));
    app.on('state', ({ key, previous }) => {
      if (key === 'tool') {
        if (previous === 'shape') this.commitShape();
        if (previous === 'text') this.commitText();
        if ((previous === 'select' || previous === 'objectSelect') && app.state.tool !== 'select' && app.state.tool !== 'objectSelect') app.clearSelection();
        this.updateCursor();
      }
      if (this.shape && ['outline', 'fill', 'sizes', 'opacity', 'primary', 'secondary'].includes(key)) this.refreshShape();
      if (this.text && ['text', 'primary', 'secondary'].includes(key)) this.styleTextEditor();
      if (key === 'transparentSelection' && app.floating) app.render();
    });
    app.on('cancel', () => {
      this.shape = null;
      this.discardText();
    });
    app.on('before-history', () => {
      this.commitShape();
      this.commitText();
    });
    app.on('zoom', () => this.positionTextEditor());
    app.on('layout', () => this.positionTextEditor());
    textEditor.addEventListener('input', () => this.growTextEditor());
    textEditor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.textEditor.value.trim()) this.commitText();
        else this.discardText();
      }
      e.stopPropagation();
    });
    this.updateCursor();
  }

  updateCursor() {
    const tool = this.app.state.tool;
    this.stage.stage.style.cursor = this.spaceDown ? 'grab' : CURSORS[tool] ?? 'default';
  }

  setSpace(on) {
    this.spaceDown = on;
    this.updateCursor();
  }

  pointerData(e) {
    const p = this.stage.toImage(e);
    return { ...p, button: e.button === 2 ? 2 : 0, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }

  down(e) {
    if (e.target.closest?.('.canvas-handle, textarea')) return;
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.gesture = { type: 'pan', x: e.clientX, y: e.clientY, sl: this.stage.stage.scrollLeft, st: this.stage.stage.scrollTop };
      this.stage.stage.setPointerCapture(e.pointerId);
      this.stage.stage.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const rect = this.stage.stage.getBoundingClientRect();
    if (e.clientX - rect.left > this.stage.stage.clientWidth || e.clientY - rect.top > this.stage.stage.clientHeight) return;
    e.preventDefault();
    this.stage.stage.focus({ preventScroll: true });
    const p = this.pointerData(e);
    const tool = this.app.state.tool;
    const handler = this[`${tool}Down`];
    if (!handler) return;
    this.stage.stage.setPointerCapture(e.pointerId);
    handler.call(this, p, e);
  }

  move(e) {
    const p = this.pointerData(e);
    this.hover = p;
    this.stage.pointer = p;
    this.app.emit('pointer', p.inside ? { x: p.ix, y: p.iy } : null);
    const g = this.gesture;
    if (g?.type === 'pan') {
      this.stage.stage.scrollLeft = g.sl - (e.clientX - g.x);
      this.stage.stage.scrollTop = g.st - (e.clientY - g.y);
      return;
    }
    if (g?.move) g.move(p, e);
    else this.hoverCursor(p, e);
    this.stage.drawOverlay();
  }

  up(e) {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.type === 'pan') {
      this.updateCursor();
      return;
    }
    g.up?.(this.pointerData(e), e);
    this.stage.drawOverlay();
  }

  cancel() {
    const g = this.gesture;
    this.gesture = null;
    g?.cancel?.();
    this.app.preview = null;
    this.app.render();
  }

  escape() {
    if (this.gesture) {
      this.cancel();
      return true;
    }
    if (this.shape) {
      if (this.shape.phase === 'points' || this.shape.phase === 'bend') this.shape = null;
      else this.commitShape();
      this.app.preview = null;
      this.app.render();
      return true;
    }
    if (this.text) {
      this.commitText();
      return true;
    }
    if (this.app.floating || this.app.selection) {
      this.app.clearSelection();
      return true;
    }
    return false;
  }

  hoverCursor(p, e) {
    const tool = this.app.state.tool;
    let cursor = this.spaceDown ? 'grab' : CURSORS[tool];
    if (tool === 'select' || tool === 'objectSelect') {
      const s = this.app.selection;
      const handle = s && (!s.mask || this.app.floating) ? this.stage.hitHandle(s, e) : null;
      if (handle) cursor = HANDLE_CURSORS[handle];
      else if (insideRect(s, p.x, p.y)) cursor = 'move';
    } else if (tool === 'shape' && this.shape?.phase === 'edit') {
      const handle = this.shapeHandle(e);
      if (handle) cursor = handle === 'p0' || handle === 'p1' ? 'pointer' : HANDLE_CURSORS[handle];
      else if (insideRect(this.shape.box, p.x, p.y)) cursor = 'move';
    } else if (tool === 'magnifier') cursor = e.altKey ? 'zoom-out' : 'zoom-in';
    this.stage.stage.style.cursor = cursor;
  }

  decorate(ctx) {
    const tool = this.app.state.tool;
    const z = this.stage.zoom;
    if (this.rubber) {
      const a = this.stage.toScreen(this.rubber.x, this.rubber.y);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(this.rubber.width * z), Math.round(this.rubber.height * z));
      ctx.strokeStyle = '#fff';
      ctx.lineDashOffset = 4;
      ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(this.rubber.width * z), Math.round(this.rubber.height * z));
      ctx.restore();
    }
    if (this.lasso?.length > 1) {
      ctx.save();
      ctx.beginPath();
      this.lasso.forEach(([x, y], i) => {
        const s = this.stage.toScreen(x, y);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.restore();
    }
    if (this.shape) this.decorateShape(ctx);
    if (this.text) {
      this.stage.drawHandles(ctx, this.text.box);
    }
    if (this.hover?.inside !== undefined && (tool === 'brush' || tool === 'eraser') && !this.spaceDown) {
      const size = this.app.size;
      const s = this.stage.toScreen(this.hover.x, this.hover.y);
      ctx.save();
      ctx.lineWidth = 1;
      if (tool === 'eraser') {
        const side = size * z;
        const tl = this.stage.toScreen(Math.floor(this.hover.x - size / 2), Math.floor(this.hover.y - size / 2));
        ctx.strokeStyle = '#000';
        ctx.strokeRect(Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5, Math.round(side), Math.round(side));
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(Math.round(tl.x) - 0.5, Math.round(tl.y) - 0.5, Math.round(side) + 2, Math.round(side) + 2);
      } else {
        const radius = Math.max(2, ((this.app.state.brush === 'airbrush' ? size * 2 : size) * z) / 2);
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius + 1, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  beginStroke(drawSegment, { label, style = 'solid', erase = false, onCommit = null, dot = true } = {}) {
    const app = this.app;
    app.ensureBuffers();
    const ctx = app.strokeCtx;
    let dirty = null;
    const extend = (r) => {
      dirty = rectUnion(dirty, r);
    };
    ctx.clearRect(0, 0, app.doc.width, app.doc.height);
    const opacity = app.state.opacity / 100;
    app.preview = (target, r) => {
      const area = clipRect(dirty && rectUnion(dirty, null), app.doc.width, app.doc.height);
      if (!area) return;
      const x = Math.max(area.x, r.x);
      const y = Math.max(area.y, r.y);
      const x2 = Math.min(area.x + area.width, r.x + r.width);
      const y2 = Math.min(area.y + area.height, r.y + r.height);
      if (x2 <= x || y2 <= y) return;
      app.finishOnto(target, app.strokeCanvas, { x, y, width: x2 - x, height: y2 - y }, { style, opacity, erase });
    };
    const api = {
      ctx,
      extend,
      get dirty() {
        return dirty;
      },
      draw: (...args) => {
        const r = drawSegment(...args);
        if (r) {
          extend(r);
          app.render(inflate(r, 2));
        }
      },
      commit: () => {
        app.preview = null;
        const area = clipRect(dirty, app.doc.width, app.doc.height);
        if (area) {
          app.recordPixels(label, area, () => {
            if (onCommit) return onCommit(area);
            app.finishOnto(app.doc.layer.ctx, app.strokeCanvas, area, { style, opacity, erase });
            return true;
          });
        }
        ctx.clearRect(0, 0, app.doc.width, app.doc.height);
        app.render(area);
      },
      cancel: () => {
        app.preview = null;
        ctx.clearRect(0, 0, app.doc.width, app.doc.height);
        app.render();
      },
    };
    if (dot) api.draw();
    return api;
  }

  pencilDown(p) {
    const app = this.app;
    const color = app.colorFor(p.button);
    const size = app.state.sizes.pencil;
    const start = { x: p.ix, y: p.iy };
    let last = start;
    const square = (ctx, x, y) => ctx.fillRect(x - Math.floor((size - 1) / 2), y - Math.floor((size - 1) / 2), size, size);
    const segment = (x0, y0, x1, y1) => {
      const ctx = app.strokeCtx;
      ctx.fillStyle = color;
      linePoints(x0, y0, x1, y1, (x, y) => square(ctx, x, y));
      return inflate({ x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0) + 1, height: Math.abs(y1 - y0) + 1 }, size);
    };
    const stroke = this.beginStroke((x = start.x, y = start.y) => segment(last.x, last.y, x, y), { label: 'Lápis', dot: false });
    stroke.draw(start.x, start.y);
    const straight = p.shift;
    this.gesture = {
      move: (q) => {
        if (straight) {
          app.strokeCtx.clearRect(0, 0, app.doc.width, app.doc.height);
          const end = snapAngle(start.x, start.y, q.ix, q.iy);
          last = start;
          stroke.draw(end.x, end.y);
          app.render();
          return;
        }
        stroke.draw(q.ix, q.iy);
        last = { x: q.ix, y: q.iy };
      },
      up: () => stroke.commit(),
      cancel: () => stroke.cancel(),
    };
  }

  brushDown(p) {
    const app = this.app;
    const kind = app.state.brush;
    const engine = new StrokeEngine(app.strokeCtx, { kind, size: app.state.sizes.brush, color: app.colorFor(p.button), seed: (Date.now() & 0xffff) + 1 });
    let started = false;
    const stroke = this.beginStroke(
      (x, y) => {
        engine.dirty = null;
        if (!started) {
          engine.begin(x, y);
          started = true;
        } else if (x === undefined) engine.tick();
        else engine.to(x, y);
        return engine.dirty;
      },
      { label: 'Pincel', style: kind, dot: false },
    );
    stroke.draw(p.x, p.y);
    let timer = null;
    if (kind === 'airbrush') timer = setInterval(() => stroke.draw(), 40);
    const stop = () => clearInterval(timer);
    this.gesture = {
      move: (q) => stroke.draw(q.x, q.y),
      up: () => {
        stop();
        stroke.commit();
      },
      cancel: () => {
        stop();
        stroke.cancel();
      },
    };
  }

  eraserDown(p) {
    const app = this.app;
    const size = app.state.sizes.eraser;
    const replace = p.button === 2;
    const toColor = app.state.eraserMode === 'secondary';
    let last = { x: p.ix, y: p.iy };
    const square = (ctx, x, y) => ctx.fillRect(x - Math.floor(size / 2), y - Math.floor(size / 2), size, size);
    const segment = (x, y) => {
      const ctx = app.strokeCtx;
      ctx.fillStyle = toColor ? app.state.secondary : '#000';
      linePoints(last.x, last.y, x, y, (px, py) => square(ctx, px, py));
      const r = inflate({ x: Math.min(last.x, x), y: Math.min(last.y, y), width: Math.abs(x - last.x) + 1, height: Math.abs(y - last.y) + 1 }, size);
      last = { x, y };
      return r;
    };
    const from = parseHex(app.state.primary);
    const to = parseHex(app.state.secondary);
    const stroke = this.beginStroke((x = last.x, y = last.y) => segment(x, y), {
      label: replace ? 'Substituir cor' : 'Borracha',
      erase: !toColor && !replace,
      dot: false,
      onCommit: replace
        ? (area) => {
            const layer = app.doc.layer;
            const image = layer.read(area);
            const mask = app.strokeCtx.getImageData(area.x, area.y, area.width, area.height).data;
            let changed = 0;
            for (let i = 0; i < image.data.length; i += 4) {
              if (!mask[i + 3]) continue;
              if (image.data[i] === from.r && image.data[i + 1] === from.g && image.data[i + 2] === from.b && image.data[i + 3] === 255) {
                image.data[i] = to.r;
                image.data[i + 1] = to.g;
                image.data[i + 2] = to.b;
                changed++;
              }
            }
            layer.write(image, area.x, area.y);
            return changed > 0;
          }
        : null,
    });
    if (replace) app.preview = null;
    stroke.draw(p.ix, p.iy);
    if (replace) app.preview = null;
    this.gesture = {
      move: (q) => {
        stroke.draw(q.ix, q.iy);
        if (replace) app.preview = null;
      },
      up: () => stroke.commit(),
      cancel: () => stroke.cancel(),
    };
  }

  fillDown(p) {
    if (!p.inside) return;
    const app = this.app;
    const layer = app.doc.layer;
    const image = layer.read();
    const { mask, bounds } = floodMask(image, p.ix, p.iy, { tolerance: app.state.fillTolerance });
    if (!bounds) return;
    const c = parseHex(app.colorFor(p.button));
    const paint = createImage(bounds.width, bounds.height);
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        if (!mask[(bounds.y + y) * app.doc.width + bounds.x + x]) continue;
        const i = (y * bounds.width + x) * 4;
        paint.data[i] = c.r;
        paint.data[i + 1] = c.g;
        paint.data[i + 2] = c.b;
        paint.data[i + 3] = 255;
      }
    }
    const tile = makeCanvas(bounds.width, bounds.height);
    tile.getContext('2d').putImageData(new ImageData(paint.data, bounds.width, bounds.height), 0, 0);
    app.recordPixels('Preenchimento', bounds, () => {
      const ctx = layer.ctx;
      ctx.save();
      ctx.globalAlpha = app.state.opacity / 100;
      if (app.state.opacity >= 100) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(tile, bounds.x, bounds.y);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(tile, bounds.x, bounds.y);
      ctx.restore();
    });
  }

  pickerDown(p) {
    if (!p.inside) return;
    const app = this.app;
    const sample = app.paperCtx.getImageData(p.ix, p.iy, 1, 1).data;
    if (sample[3] === 0) {
      app.emit('notice', 'Esse pixel está transparente.');
      return;
    }
    const hex = '#' + [sample[0], sample[1], sample[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    app.setColor(p.button === 2 ? 'secondary' : 'primary', hex);
    const back = app.state.previousTool && app.state.previousTool !== 'picker' ? app.state.previousTool : 'pencil';
    app.setState('tool', back);
  }

  magnifierDown(p, e) {
    this.stage.zoomStep(p.button === 2 || p.alt ? -1 : 1, e);
  }

  selectDown(p, e) {
    const app = this.app;
    const s = app.selection;
    const handle = s && (!s.mask || app.floating) ? this.stage.hitHandle(s, e) : null;
    if (handle || insideRect(s, p.x, p.y)) {
      if (!app.floating) app.lift();
      const f = app.floating;
      const start = { x: f.x, y: f.y, width: f.width, height: f.height };
      const origin = { x: p.x, y: p.y };
      this.gesture = {
        move: (q) => {
          const dx = Math.round(q.x - origin.x);
          const dy = Math.round(q.y - origin.y);
          if (handle) app.resizeFloating(resizeRect(start, handle, dx, dy, q.shift));
          else app.moveFloating(start.x + dx, start.y + dy);
          app.emit('shape-size', { width: app.floating.width, height: app.floating.height });
        },
      };
      return;
    }
    app.clearSelection();
    if (app.state.selectMode === 'free') {
      this.lasso = [[p.x, p.y]];
      this.gesture = {
        move: (q) => {
          const last = this.lasso.at(-1);
          if (Math.hypot(q.x - last[0], q.y - last[1]) * this.stage.zoom >= 2) this.lasso.push([q.x, q.y]);
        },
        up: () => {
          const points = this.lasso;
          this.lasso = null;
          if (points.length < 3) return;
          this.selectPolygon(points);
        },
        cancel: () => {
          this.lasso = null;
        },
      };
      return;
    }
    const origin = { x: Math.round(p.x), y: Math.round(p.y) };
    this.gesture = {
      move: (q) => {
        const r = constrainRect(origin.x, origin.y, Math.round(q.x), Math.round(q.y), { square: q.shift });
        app.selection = r.width && r.height ? { ...clipRect(r, app.doc.width, app.doc.height), mask: null } : null;
        if (app.selection && !app.selection.width) app.selection = null;
        app.emit('selection');
      },
      up: () => {
        if (app.selection && (app.selection.width < 1 || app.selection.height < 1)) app.selection = null;
        app.emit('selection');
      },
      cancel: () => {
        app.selection = null;
        app.emit('selection');
      },
    };
  }

  selectPolygon(points) {
    const app = this.app;
    const xs = points.map((q) => q[0]);
    const ys = points.map((q) => q[1]);
    const bounds = clipRect(
      { x: Math.floor(Math.min(...xs)), y: Math.floor(Math.min(...ys)), width: Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs)) + 1, height: Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys)) + 1 },
      app.doc.width,
      app.doc.height,
    );
    if (!bounds) return;
    const canvas = makeCanvas(bounds.width, bounds.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x - bounds.x, y - bounds.y) : ctx.moveTo(x - bounds.x, y - bounds.y)));
    ctx.closePath();
    ctx.fill();
    const data = ctx.getImageData(0, 0, bounds.width, bounds.height).data;
    const mask = new Uint8Array(bounds.width * bounds.height);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= 128 ? 255 : 0;
    app.setSelection({ ...bounds, mask, points });
  }

  objectSelectDown(p, e) {
    const app = this.app;
    const s = app.selection;
    if (s && (insideRect(s, p.x, p.y) || (app.floating && this.stage.hitHandle(s, e)))) {
      this.selectDown(p, e);
      return;
    }
    app.clearSelection();
    const origin = { x: p.x, y: p.y };
    this.rubber = null;
    this.gesture = {
      move: (q) => {
        const r = constrainRect(origin.x, origin.y, q.x, q.y);
        this.rubber = r.width * this.stage.zoom > 4 && r.height * this.stage.zoom > 4 ? r : null;
      },
      up: (q) => {
        const rect = this.rubber;
        this.rubber = null;
        const point = rect ? null : { x: Math.floor(q.x), y: Math.floor(q.y) };
        if (!rect && !q.inside) return;
        this.runObjectSelection({ rect, point });
      },
      cancel: () => {
        this.rubber = null;
      },
    };
  }

  runObjectSelection({ rect = null, point = null } = this.lastObject ?? {}) {
    const app = this.app;
    this.lastObject = { rect, point };
    this.onBusy(true);
    setTimeout(() => {
      try {
        const layer = app.doc.layer;
        const image = layer.read();
        const result = segmentObject(image, { rect, point, sensitivity: app.state.objectSensitivity, removeHoles: app.state.objectHoles });
        if (!result.bounds) {
          app.emit('notice', 'Nenhum objeto encontrado nessa área. Tente um retângulo mais justo em volta dele.');
          app.clearSelection();
          return;
        }
        const b = result.bounds;
        const mask = new Uint8Array(b.width * b.height);
        for (let y = 0; y < b.height; y++) mask.set(result.alpha.subarray((b.y + y) * image.width + b.x, (b.y + y) * image.width + b.x + b.width), y * b.width);
        app.setSelection({ ...b, mask, object: true });
        app.emit('object-selected', b);
      } finally {
        this.onBusy(false);
      }
    }, 30);
  }

  textDown(p) {
    const app = this.app;
    if (this.text) {
      if (insideRect(this.text.box, p.x, p.y)) return;
      this.commitText();
      return;
    }
    if (!p.inside) return;
    const origin = { x: Math.round(p.x), y: Math.round(p.y) };
    this.rubber = null;
    this.gesture = {
      move: (q) => {
        this.rubber = constrainRect(origin.x, origin.y, Math.round(q.x), Math.round(q.y));
      },
      up: () => {
        const r = this.rubber;
        this.rubber = null;
        const minWidth = Math.max(40, app.state.text.size * 4);
        const box =
          r && r.width >= 8 && r.height >= 8
            ? r
            : { x: origin.x, y: origin.y, width: Math.min(Math.max(minWidth, 220), Math.max(minWidth, app.doc.width - origin.x)), height: Math.round(app.state.text.size * 1.25) + 6 };
        this.openText(box);
      },
      cancel: () => {
        this.rubber = null;
      },
    };
  }

  openText(box) {
    this.text = { box: { ...box }, auto: true };
    const t = this.textEditor;
    t.value = '';
    t.hidden = false;
    this.styleTextEditor();
    this.positionTextEditor();
    t.focus({ preventScroll: true });
    requestAnimationFrame(() => document.activeElement !== t && t.focus({ preventScroll: true }));
    this.app.emit('text-open', true);
    this.stage.drawOverlay();
  }

  styleTextEditor() {
    if (!this.text) return;
    const st = this.app.state.text;
    const t = this.textEditor;
    const z = this.stage.zoom;
    t.style.font = fontString(st, st.size * z);
    t.style.lineHeight = `${Math.round(st.size * 1.25) * z}px`;
    t.style.color = this.app.state.primary;
    t.style.background = st.background ? this.app.state.secondary : 'transparent';
    t.style.textAlign = st.align;
    t.style.textDecoration = [st.underline ? 'underline' : '', st.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    t.style.padding = `${2 * z}px`;
    this.growTextEditor();
  }

  positionTextEditor() {
    if (!this.text) return;
    const z = this.stage.zoom;
    const b = this.text.box;
    Object.assign(this.textEditor.style, { left: `${b.x * z}px`, top: `${b.y * z}px`, width: `${b.width * z}px`, height: `${b.height * z}px` });
    this.styleTextEditor();
  }

  growTextEditor() {
    if (!this.text) return;
    const t = this.textEditor;
    const z = this.stage.zoom;
    const needed = Math.ceil(t.scrollHeight / z);
    if (needed > this.text.box.height) {
      this.text.box.height = Math.min(this.app.doc.height - this.text.box.y, needed);
      t.style.height = `${this.text.box.height * z}px`;
    }
    const w = Math.round(t.offsetWidth / z);
    const h = Math.round(t.offsetHeight / z);
    if (w > 0 && h > 0) this.text.box = { ...this.text.box, width: w, height: h };
    this.stage.drawOverlay();
  }

  commitText() {
    if (!this.text) return;
    const app = this.app;
    const value = this.textEditor.value;
    const box = clipRect({ ...this.text.box, width: Math.round(this.textEditor.offsetWidth / this.stage.zoom) || this.text.box.width, height: Math.round(this.textEditor.offsetHeight / this.stage.zoom) || this.text.box.height }, app.doc.width, app.doc.height);
    this.discardText();
    if (!value.trim() || !box) return;
    const style = { ...app.state.text };
    app.recordPixels('Texto', box, () => {
      app.doc.layer.ctx.save();
      app.doc.layer.ctx.globalAlpha = app.state.opacity / 100;
      renderText(app.doc.layer.ctx, box, value, style, { color: app.state.primary, background: app.state.secondary });
      app.doc.layer.ctx.restore();
    });
  }

  discardText() {
    if (!this.text) return;
    this.text = null;
    this.textEditor.hidden = true;
    this.textEditor.value = '';
    this.app.emit('text-open', false);
    this.stage.drawOverlay();
  }

  shapeStyle() {
    const s = this.app.state;
    return { outline: s.outline, fill: s.fill, size: s.sizes.shape, primary: s.primary, secondary: s.secondary, opacity: s.opacity / 100 };
  }

  shapeCommands(shape) {
    if (shape.id === 'line') return shapePath('line', shape.box, { points: [shape.p0, shape.p1] });
    if (shape.id === 'curve') return shapePath('curve', shape.box, { points: [shape.p0, shape.p1, shape.c1 ?? null, shape.c2 ?? null] });
    if (shape.id === 'polygon') return shapePath('polygon', shape.box, { points: shape.points, closed: shape.phase !== 'points' });
    return shapePath(shape.id, shape.box);
  }

  drawShape(target, shape, style = shape.style) {
    const app = this.app;
    const commands = this.shapeCommands(shape);
    if (!commands.length) return null;
    const open = isOpenShape(shape.id, { closed: shape.phase !== 'points' });
    const bounds = pathBounds(commands);
    if (!bounds) return null;
    const area = clipRect(inflate(bounds, style.size + 4), app.doc.width, app.doc.height);
    if (!area) return null;
    const path = toPath2D(commands);
    const layer = app.strokeCtx;
    if (!open && style.fill !== 'none') {
      layer.clearRect(area.x, area.y, area.width, area.height);
      layer.save();
      layer.fillStyle = style.secondary;
      layer.fill(path);
      if (style.fill === 'oil') {
        layer.globalCompositeOperation = 'destination-in';
        layer.fillStyle = app.texturePattern(layer, 'streak');
        layer.fillRect(area.x, area.y, area.width, area.height);
      }
      layer.restore();
      app.finishOnto(target, app.strokeCanvas, area, { style: style.fill, opacity: style.opacity });
    }
    if (style.outline !== 'none') {
      layer.clearRect(area.x, area.y, area.width, area.height);
      if (style.outline === 'solid' || style.outline === 'marker') {
        layer.save();
        layer.strokeStyle = style.primary;
        layer.lineWidth = style.size;
        layer.lineJoin = style.outline === 'marker' ? 'bevel' : 'miter';
        layer.lineCap = style.outline === 'marker' ? 'square' : 'butt';
        layer.stroke(path);
        layer.restore();
      } else {
        const kind = style.outline === 'oil' ? 'oil' : style.outline;
        for (const line of flatten(commands, 1.5)) {
          const engine = new StrokeEngine(layer, { kind, size: style.size, color: style.primary, seed: 7 });
          engine.path(line);
        }
      }
      app.finishOnto(target, app.strokeCanvas, area, { style: style.outline, opacity: style.opacity });
      layer.clearRect(area.x, area.y, area.width, area.height);
    }
    return area;
  }

  refreshShape() {
    if (!this.shape) return;
    this.shape.style = this.shapeStyle();
    this.previewShape();
  }

  previewShape() {
    const app = this.app;
    const shape = this.shape;
    if (!shape) {
      app.preview = null;
      app.render();
      return;
    }
    const old = shape.area;
    app.preview = (target) => {
      shape.area = this.drawShape(target, shape);
    };
    app.render(rectUnion(old, inflate(pathBounds(this.shapeCommands(shape)) ?? old, shape.style.size + 6)));
  }

  commitShape() {
    const shape = this.shape;
    if (!shape) return;
    this.shape = null;
    const app = this.app;
    app.preview = null;
    if (shape.id === 'polygon' && shape.phase === 'points') shape.phase = 'edit';
    const commands = this.shapeCommands(shape);
    const bounds = pathBounds(commands);
    if (!bounds || (bounds.width < 1 && bounds.height < 1)) {
      app.render();
      return;
    }
    const area = clipRect(inflate(bounds, shape.style.size + 4), app.doc.width, app.doc.height);
    if (!area) {
      app.render();
      return;
    }
    app.recordPixels('Forma', area, () => {
      this.drawShape(app.doc.layer.ctx, shape);
    });
    this.stage.drawOverlay();
  }

  closePolygon() {
    if (!this.shape || this.shape.id !== 'polygon') return;
    if (this.shape.points.length > 2 && this.shape.points.at(-1)[0] === this.shape.points.at(-2)[0] && this.shape.points.at(-1)[1] === this.shape.points.at(-2)[1]) this.shape.points.pop();
    this.shape.phase = 'edit';
    this.commitShape();
  }

  shapeHandle(e) {
    const shape = this.shape;
    if (!shape || shape.phase !== 'edit') return null;
    if (shape.id === 'line' || shape.id === 'curve') {
      const s = this.stage.stage.getBoundingClientRect();
      for (const key of ['p0', 'p1']) {
        const q = this.stage.toScreen(...shape[key]);
        if (Math.abs(e.clientX - s.left - q.x) <= 7 && Math.abs(e.clientY - s.top - q.y) <= 7) return key;
      }
      return null;
    }
    return this.stage.hitHandle(shape.box, e);
  }

  decorateShape(ctx) {
    const shape = this.shape;
    if (shape.phase !== 'edit') return;
    if (shape.id === 'line' || shape.id === 'curve') {
      ctx.save();
      for (const key of ['p0', 'p1']) {
        const q = this.stage.toScreen(...shape[key]);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.fillRect(Math.round(q.x) - 3.5, Math.round(q.y) - 3.5, 7, 7);
        ctx.strokeRect(Math.round(q.x) - 3.5, Math.round(q.y) - 3.5, 7, 7);
      }
      ctx.restore();
      return;
    }
    this.stage.drawHandles(ctx, shape.box);
  }

  shapeDown(p, e) {
    const app = this.app;
    const id = app.state.shape;
    const shape = this.shape;
    if (shape?.phase === 'bend') {
      const key = shape.c1 ? 'c2' : 'c1';
      shape[key] = [p.x, p.y];
      if (key === 'c1') shape.c2 = [p.x, p.y];
      this.previewShape();
      this.gesture = {
        move: (q) => {
          shape[key] = [q.x, q.y];
          if (key === 'c1') shape.c2 = [q.x, q.y];
          this.previewShape();
        },
        up: () => {
          if (key === 'c2') {
            shape.phase = 'edit';
            this.commitShape();
          }
        },
      };
      return;
    }
    if (shape?.phase === 'points') {
      const first = shape.points[0];
      if (shape.points.length > 2 && Math.hypot((p.x - first[0]) * this.stage.zoom, (p.y - first[1]) * this.stage.zoom) < 8) {
        this.closePolygon();
        return;
      }
      shape.points.push([Math.round(p.x), Math.round(p.y)]);
      this.previewShape();
      this.gesture = {
        move: (q) => {
          const last = shape.points.at(-2);
          const pt = q.shift ? snapAngle(last[0], last[1], Math.round(q.x), Math.round(q.y)) : { x: Math.round(q.x), y: Math.round(q.y) };
          shape.points[shape.points.length - 1] = [pt.x, pt.y];
          this.previewShape();
        },
      };
      return;
    }
    if (shape?.phase === 'edit') {
      const handle = this.shapeHandle(e);
      const origin = { x: p.x, y: p.y };
      if (handle === 'p0' || handle === 'p1') {
        this.gesture = {
          move: (q) => {
            const other = shape[handle === 'p0' ? 'p1' : 'p0'];
            const pt = q.shift ? snapAngle(other[0], other[1], Math.round(q.x), Math.round(q.y)) : { x: Math.round(q.x), y: Math.round(q.y) };
            shape[handle] = [pt.x, pt.y];
            shape.box = constrainRect(shape.p0[0], shape.p0[1], shape.p1[0], shape.p1[1]);
            this.previewShape();
          },
        };
        return;
      }
      if (handle || insideRect(shape.box, p.x, p.y)) {
        const start = { ...shape.box };
        const p0 = shape.p0 && [...shape.p0];
        const p1 = shape.p1 && [...shape.p1];
        this.gesture = {
          move: (q) => {
            const dx = Math.round(q.x - origin.x);
            const dy = Math.round(q.y - origin.y);
            if (handle) shape.box = resizeRect(start, handle, dx, dy, q.shift);
            else {
              shape.box = { ...start, x: start.x + dx, y: start.y + dy };
              if (p0) {
                shape.p0 = [p0[0] + dx, p0[1] + dy];
                shape.p1 = [p1[0] + dx, p1[1] + dy];
              }
            }
            this.previewShape();
            app.emit('shape-size', { width: shape.box.width, height: shape.box.height });
          },
        };
        return;
      }
      this.commitShape();
    }
    const origin = [Math.round(p.x), Math.round(p.y)];
    const next = { id, style: this.shapeStyle(), phase: 'draw', box: { x: origin[0], y: origin[1], width: 0, height: 0 }, area: null };
    if (id === 'line' || id === 'curve') {
      next.p0 = origin;
      next.p1 = origin;
    }
    if (id === 'polygon') next.points = [origin, origin];
    this.shape = next;
    this.gesture = {
      move: (q) => {
        const end = [Math.round(q.x), Math.round(q.y)];
        if (id === 'line' || id === 'curve') {
          const pt = q.shift ? snapAngle(origin[0], origin[1], end[0], end[1]) : { x: end[0], y: end[1] };
          next.p1 = [pt.x, pt.y];
          next.box = constrainRect(origin[0], origin[1], pt.x, pt.y);
        } else if (id === 'polygon') {
          const pt = q.shift ? snapAngle(origin[0], origin[1], end[0], end[1]) : { x: end[0], y: end[1] };
          next.points[1] = [pt.x, pt.y];
        } else {
          next.box = constrainRect(origin[0], origin[1], end[0], end[1], { square: q.shift, fromCenter: q.alt });
        }
        this.previewShape();
        app.emit('shape-size', { width: next.box.width, height: next.box.height });
      },
      up: () => {
        if (id === 'polygon') {
          next.phase = 'points';
          next.points.push([...next.points[1]]);
          this.previewShape();
          return;
        }
        if (id === 'curve') {
          if (next.p0[0] === next.p1[0] && next.p0[1] === next.p1[1]) {
            this.shape = null;
            this.previewShape();
            return;
          }
          next.phase = 'bend';
          return;
        }
        const tiny = id === 'line' ? next.p0[0] === next.p1[0] && next.p0[1] === next.p1[1] : next.box.width < 1 || next.box.height < 1;
        if (tiny) {
          this.shape = null;
          this.previewShape();
          return;
        }
        next.phase = 'edit';
        this.stage.drawOverlay();
      },
      cancel: () => {
        this.shape = null;
        this.previewShape();
      },
    };
  }

  enterShape() {
    if (!this.shape) return false;
    if (this.shape.id === 'polygon' && this.shape.phase === 'points') this.closePolygon();
    else this.commitShape();
    return true;
  }

  nudge(dx, dy) {
    const app = this.app;
    if (this.shape?.phase === 'edit') {
      this.shape.box = { ...this.shape.box, x: this.shape.box.x + dx, y: this.shape.box.y + dy };
      if (this.shape.p0) {
        this.shape.p0 = [this.shape.p0[0] + dx, this.shape.p0[1] + dy];
        this.shape.p1 = [this.shape.p1[0] + dx, this.shape.p1[1] + dy];
      }
      this.previewShape();
      return true;
    }
    if (!app.selection) return false;
    if (!app.floating) app.lift();
    app.moveFloating(app.floating.x + dx, app.floating.y + dy);
    return true;
  }
}
