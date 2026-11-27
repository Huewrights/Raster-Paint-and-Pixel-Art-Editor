import { encodeBMP, encodeTIFF, encodeICO, quantize, flattenOn, withPngDpi } from '../core/encoders.js';
import { encodeGIF } from '../../../pixel/js/core/gif.js';
import { serializeProject, parseProject, PROJECT_EXTENSION, baseName, cleanName } from '../core/project.js';
import { validateSize } from '../core/raster.js';
import { chooseLocation, writeToLocation, canChooseLocation, download, PickerUnavailable } from '../../../pixel/js/ui/save-file.js';
import { PaintDocument, Layer, makeCanvas } from './document.js';
import { addRecent, saveDraft, readDraft, clearDraft } from './storage.js';

export const FORMATS = {
  png: { label: 'Imagem PNG', extension: 'png', mime: 'image/png', alpha: true },
  jpeg: { label: 'Imagem JPEG', extension: 'jpg', mime: 'image/jpeg', alpha: false },
  bmp: { label: 'Imagem BMP', extension: 'bmp', mime: 'image/bmp', alpha: false },
  gif: { label: 'Imagem GIF', extension: 'gif', mime: 'image/gif', alpha: true },
  tiff: { label: 'Imagem TIFF', extension: 'tif', mime: 'image/tiff', alpha: true },
  webp: { label: 'Imagem WEBP', extension: 'webp', mime: 'image/webp', alpha: true },
  ico: { label: 'Ícone ICO', extension: 'ico', mime: 'image/x-icon', alpha: true },
  matiz: { label: 'Projeto do Matiz (camadas)', extension: PROJECT_EXTENSION, mime: 'application/json', alpha: true },
};

export const OPEN_ACCEPT = '.matiz,.png,.jpg,.jpeg,.jfif,.bmp,.dib,.gif,.webp,.ico,.svg,.avif,image/*';
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.jfif,.bmp,.dib,.gif,.webp,.ico,.svg,.avif,image/*';
export const MAX_OPEN_BYTES = 256 * 1024 * 1024;

const EXTENSION_FORMAT = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', jfif: 'jpeg', bmp: 'bmp', dib: 'bmp', gif: 'gif', tif: 'tiff', tiff: 'tiff', webp: 'webp', ico: 'ico', matiz: 'matiz' };

export function formatFromName(name) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name ?? '')?.[1] ?? '').toLowerCase();
  return EXTENSION_FORMAT[ext] ?? null;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('O navegador não conseguiu gerar a imagem.'))), type, quality));
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function imageData(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data };
}

export async function decodeImage(blob) {
  if (blob.size > MAX_OPEN_BYTES) throw new Error('O arquivo é grande demais (máximo de 256 MB).');
  try {
    const bitmap = await createImageBitmap(blob);
    validateSize(bitmap.width, bitmap.height);
    return bitmap;
  } catch (error) {
    if (/pixels|lado|megapixels/.test(error?.message ?? '')) throw error;
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      const width = img.naturalWidth || 300;
      const height = img.naturalHeight || 150;
      validateSize(width, height);
      const canvas = makeCanvas(width, height);
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      return canvas;
    } catch {
      throw new Error('Não foi possível ler esta imagem. Formatos aceitos: PNG, JPEG, BMP, GIF, WEBP, ICO, SVG e AVIF.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export class Files {
  constructor(app, { notify, confirmSave, desktop }) {
    this.app = app;
    this.notify = notify;
    this.confirmSave = confirmSave;
    this.desktop = desktop;
  }

  composite() {
    return this.app.doc.composite();
  }

  async encode(format) {
    const app = this.app;
    const canvas = this.composite();
    const dpi = app.doc.dpi;
    if (format === 'matiz') {
      const layers = [];
      for (const l of app.doc.layers) layers.push({ name: l.name, visible: l.visible, opacity: l.opacity, png: await base64(await canvasBlob(l.canvas, 'image/png')) });
      const data = serializeProject({ name: app.doc.name, width: app.doc.width, height: app.doc.height, dpi, transparent: app.doc.transparent, activeLayer: app.doc.active, colors: { primary: app.state.primary, secondary: app.state.secondary, custom: app.state.custom }, layers });
      return new Blob([JSON.stringify(data)], { type: FORMATS.matiz.mime });
    }
    if (format === 'png') return new Blob([withPngDpi(new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer()), dpi)], { type: 'image/png' });
    if (format === 'jpeg') return canvasBlob(this.flattened(canvas), 'image/jpeg', 0.92);
    if (format === 'webp') return canvasBlob(canvas, 'image/webp', 0.92);
    if (format === 'bmp') return new Blob([encodeBMP(imageData(canvas))], { type: 'image/bmp' });
    if (format === 'tiff') return new Blob([encodeTIFF(imageData(canvas), dpi)], { type: 'image/tiff' });
    if (format === 'gif') {
      const { pixels } = quantize(imageData(canvas), 255);
      return new Blob([encodeGIF([pixels], canvas.width, canvas.height, { delays: [0] })], { type: 'image/gif' });
    }
    if (format === 'ico') {
      const sizes = [16, 24, 32, 48, 64, 128, 256];
      const images = [];
      for (const size of sizes) {
        const c = makeCanvas(size, size);
        const ctx = c.getContext('2d');
        const scale = Math.min(size / canvas.width, size / canvas.height);
        const w = Math.max(1, Math.round(canvas.width * scale));
        const h = Math.max(1, Math.round(canvas.height * scale));
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
        images.push({ size, png: new Uint8Array(await (await canvasBlob(c, 'image/png')).arrayBuffer()) });
      }
      return new Blob([encodeICO(images)], { type: 'image/x-icon' });
    }
    throw new Error('Formato desconhecido.');
  }

  flattened(canvas) {
    const flat = makeCanvas(canvas.width, canvas.height);
    const ctx = flat.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    return flat;
  }

  thumbnail(size = 96) {
    const canvas = this.composite();
    const scale = Math.min(1, size / Math.max(canvas.width, canvas.height));
    const t = makeCanvas(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)));
    const ctx = t.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, t.width, t.height);
    return t.toDataURL('image/png');
  }

  fileName(format) {
    return `${cleanName(this.app.doc.name)}.${FORMATS[format].extension}`;
  }

  async save({ as = null } = {}) {
    const app = this.app;
    app.emit('before-history');
    if (app.floating) app.commitFloating();
    const format = as ?? app.file.format ?? 'png';
    let target = as ? null : app.file.target;
    if (!as && !target && !app.file.name) return this.save({ as: format });
    if (!FORMATS[format].alpha && app.doc.transparent) this.notify(`${FORMATS[format].label} não guarda transparência: o fundo transparente vira branco.`, 'warning', 5000);
    if (app.doc.layers.length > 1 && format !== 'matiz' && as) this.notify('As camadas são juntadas na imagem salva. Para continuar editando as camadas depois, salve também como projeto do Matiz (.matiz).', 'info', 6000);
    const blob = await this.encode(format);
    const name = this.fileName(format);
    if (!target && canChooseLocation()) {
      try {
        target = await chooseLocation(name, { title: as ? 'Salvar como' : 'Salvar', purpose: format === 'matiz' ? 'project' : 'export' });
        if (!target) return false;
      } catch (error) {
        if (!(error instanceof PickerUnavailable)) throw error;
        target = null;
      }
    }
    if (target) {
      await writeToLocation(target, blob);
      const label = target.label ?? name;
      const savedName = target.handle?.name ?? String(label).split(/[\\/]/).pop();
      app.doc.name = baseName(savedName) || app.doc.name;
      app.markSaved({ name: savedName, format: formatFromName(savedName) ?? format, target, size: blob.size, savedAt: new Date().toISOString() });
      this.notify(target.path ? `Salvo em ${target.path}` : `"${savedName}" salvo.`, 'success', 3500);
    } else {
      download(blob, name);
      app.markSaved({ name, format, target: null, size: blob.size, savedAt: new Date().toISOString() });
      this.notify(`"${name}" baixado.`, 'success', 3000);
    }
    addRecent({ name: app.file.name, type: FORMATS[format].mime, blob, thumbnail: this.thumbnail() });
    return true;
  }

  async openBlob(blob, name) {
    if (blob.size > MAX_OPEN_BYTES) throw new Error('O arquivo é grande demais (máximo de 256 MB).');
    const format = formatFromName(name) ?? (blob.type === 'application/json' ? 'matiz' : 'png');
    if (format === 'matiz') {
      const project = parseProject(await blob.text());
      const doc = await this.documentFromProject(project);
      this.app.load(doc, { name, format: 'matiz', target: null, size: blob.size });
      Object.assign(this.app.state, { primary: project.colors.primary, secondary: project.colors.secondary, custom: project.colors.custom });
      this.app.emit('state', { key: 'custom', value: project.colors.custom });
      this.app.emit('state', { key: 'primary', value: project.colors.primary });
      return doc;
    }
    const bitmap = await decodeImage(blob);
    const doc = new PaintDocument(bitmap.width, bitmap.height, { name: baseName(name), background: null });
    doc.layers[0].ctx.drawImage(bitmap, 0, 0);
    const image = doc.layers[0].read();
    let transparent = false;
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i] < 255) {
        transparent = true;
        break;
      }
    }
    doc.transparent = transparent;
    bitmap.close?.();
    this.app.load(doc, { name, format: format === 'matiz' ? 'png' : format, target: null, size: blob.size });
    return doc;
  }

  async documentFromProject(project) {
    const doc = new PaintDocument(project.width, project.height, { name: project.name, background: null, dpi: project.dpi });
    doc.transparent = project.transparent;
    doc.layers = [];
    for (const l of project.layers) {
      const layer = new Layer(project.width, project.height, { name: l.name, visible: l.visible, opacity: l.opacity });
      const bytes = Uint8Array.from(atob(l.png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      layer.ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      doc.layers.push(layer);
    }
    doc.active = project.activeLayer;
    return doc;
  }

  async open(file) {
    if (!file) return false;
    if (this.app.modified && !(await this.confirmSave())) return false;
    try {
      await this.openBlob(file, file.name);
      addRecent({ name: file.name, type: file.type, blob: file, thumbnail: this.thumbnail() });
      this.app.file.target = null;
      this.notify(`"${file.name}" aberto.`, 'success', 2200);
      return true;
    } catch (error) {
      this.notify(error.message || String(error), 'error', 6000);
      return false;
    }
  }

  async openRecent(record) {
    if (this.app.modified && !(await this.confirmSave())) return false;
    try {
      await this.openBlob(record.blob, record.name);
      addRecent({ ...record });
      return true;
    } catch (error) {
      this.notify(error.message || String(error), 'error', 6000);
      return false;
    }
  }

  async storeDraft() {
    const app = this.app;
    if (!app.modified) {
      await clearDraft();
      return;
    }
    try {
      const blob = await this.encode('matiz');
      if (blob.size > 200 * 1024 * 1024) return;
      await saveDraft({ blob, name: app.doc.name, file: { name: app.file.name, format: app.file.format }, savedAt: new Date().toISOString() });
    } catch {
      return;
    }
  }

  async restoreDraft() {
    const draft = await readDraft();
    if (!draft?.blob) return false;
    try {
      const project = parseProject(await draft.blob.text());
      const doc = await this.documentFromProject(project);
      this.app.load(doc, { name: draft.file?.name ?? null, format: draft.file?.format ?? 'png' });
      this.app.savedVersion = -1;
      this.app.emit('history');
      return true;
    } catch {
      await clearDraft();
      return false;
    }
  }

  forgetDraft() {
    return clearDraft();
  }
}

export { flattenOn };
