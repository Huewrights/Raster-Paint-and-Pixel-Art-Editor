export const MAX_SIDE = 16384;
export const MAX_AREA = 50_000_000;

export function createImage(width, height, fill = null) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3] ?? 255;
    }
  }
  return { width, height, data };
}

export function validateSize(width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) throw new Error('A largura e a altura precisam ser de pelo menos 1 pixel.');
  if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`Cada lado pode ter no máximo ${MAX_SIDE} pixels.`);
  if (w * h > MAX_AREA) throw new Error('A imagem é grande demais: o limite é de 50 megapixels.');
  return { width: w, height: h };
}

export function colorDistance(data, i, r, g, b, a) {
  const da = data[i + 3] - a;
  if (data[i + 3] === 0 && a === 0) return 0;
  const dr = data[i] - r;
  const dg = data[i + 1] - g;
  const db = data[i + 2] - b;
  return Math.sqrt((dr * dr + dg * dg + db * db + da * da) / 4);
}

export function floodMask(img, x, y, { tolerance = 0, contiguous = true } = {}) {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  if (x < 0 || y < 0 || x >= width || y >= height) return { mask, count: 0, bounds: null };
  const s = (y * width + x) * 4;
  const r = data[s];
  const g = data[s + 1];
  const b = data[s + 2];
  const a = data[s + 3];
  const limit = (Math.max(0, Math.min(100, tolerance)) / 100) * 255;
  const match = (p) => colorDistance(data, p * 4, r, g, b, a) <= limit;
  let count = 0;
  let minX = x;
  let minY = y;
  let maxX = x;
  let maxY = y;
  const mark = (p) => {
    mask[p] = 1;
    count++;
    const px = p % width;
    const py = (p - px) / width;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  };
  if (!contiguous) {
    for (let p = 0; p < width * height; p++) if (match(p)) mark(p);
  } else {
    const stack = new Int32Array(width * height);
    let top = 0;
    stack[top++] = y * width + x;
    mask[y * width + x] = 2;
    while (top) {
      const p = stack[--top];
      mark(p);
      const px = p % width;
      const neighbors = [px > 0 ? p - 1 : -1, px < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const n of neighbors) {
        if (n < 0 || n >= width * height || mask[n]) continue;
        if (match(n)) {
          mask[n] = 2;
          stack[top++] = n;
        }
      }
    }
  }
  return { mask, count, bounds: count ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
}

export function invertColors(img, mask = null) {
  const { data } = img;
  for (let p = 0, i = 0; i < data.length; p++, i += 4) {
    if (mask && !mask[p]) continue;
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  return img;
}

export function borderBackgroundMask(img, tolerance = 12) {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  const limit = (Math.max(0, Math.min(100, tolerance)) / 100) * 255;
  const stack = new Int32Array(width * height);
  let top = 0;
  const seeds = [];
  for (let x = 0; x < width; x++) seeds.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) seeds.push(y * width, y * width + width - 1);
  for (const seed of seeds) {
    if (mask[seed]) continue;
    const i = seed * 4;
    const ref = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    mask[seed] = 1;
    stack[top++] = seed;
    while (top) {
      const p = stack[--top];
      const px = p % width;
      const neighbors = [px > 0 ? p - 1 : -1, px < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const n of neighbors) {
        if (n < 0 || n >= width * height || mask[n]) continue;
        if (colorDistance(data, n * 4, ref[0], ref[1], ref[2], ref[3]) <= limit) {
          mask[n] = 1;
          stack[top++] = n;
        }
      }
    }
  }
  return mask;
}

export function rotate90(img, clockwise = true) {
  const { width, height, data } = img;
  const out = createImage(height, width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = clockwise ? height - 1 - y : y;
      const ny = clockwise ? x : width - 1 - x;
      const s = (y * width + x) * 4;
      const d = (ny * height + nx) * 4;
      out.data[d] = data[s];
      out.data[d + 1] = data[s + 1];
      out.data[d + 2] = data[s + 2];
      out.data[d + 3] = data[s + 3];
    }
  }
  return out;
}

export function rotate180(img) {
  const { width, height, data } = img;
  const out = createImage(width, height);
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const s = p * 4;
    const d = (n - 1 - p) * 4;
    out.data[d] = data[s];
    out.data[d + 1] = data[s + 1];
    out.data[d + 2] = data[s + 2];
    out.data[d + 3] = data[s + 3];
  }
  return out;
}

export function flip(img, axis) {
  const { width, height, data } = img;
  const out = createImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = axis === 'horizontal' ? width - 1 - x : x;
      const sy = axis === 'vertical' ? height - 1 - y : y;
      const s = (sy * width + sx) * 4;
      const d = (y * width + x) * 4;
      out.data[d] = data[s];
      out.data[d + 1] = data[s + 1];
      out.data[d + 2] = data[s + 2];
      out.data[d + 3] = data[s + 3];
    }
  }
  return out;
}

export function crop(img, x, y, width, height) {
  const out = createImage(width, height);
  for (let j = 0; j < height; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= img.height) continue;
    for (let i = 0; i < width; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= img.width) continue;
      const s = (sy * img.width + sx) * 4;
      const d = (j * width + i) * 4;
      out.data[d] = img.data[s];
      out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2];
      out.data[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

export function maskBounds(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function contentBounds(img) {
  const { width, height, data } = img;
  const alpha = new Uint8Array(width * height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3] ? 1 : 0;
  return maskBounds(alpha, width, height);
}

export function skewSize(width, height, degreesX, degreesY) {
  const tx = Math.tan((degreesX * Math.PI) / 180);
  const ty = Math.tan((degreesY * Math.PI) / 180);
  return { width: Math.max(1, Math.round(width + Math.abs(tx) * height)), height: Math.max(1, Math.round(height + Math.abs(ty) * width)), tx, ty };
}

export function constrainRect(x0, y0, x1, y1, { square = false, fromCenter = false } = {}) {
  let dx = x1 - x0;
  let dy = y1 - y0;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  if (fromCenter) return { x: x0 - Math.abs(dx), y: y0 - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
  return { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

export function snapAngle(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return { x: x0 + Math.round(Math.cos(angle) * length), y: y0 + Math.round(Math.sin(angle) * length) };
}

export function linePoints(x0, y0, x1, y1, plot) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x, y);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export function rectUnion(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function clipRect(r, width, height) {
  if (!r) return null;
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(width, Math.ceil(r.x + r.width));
  const y2 = Math.min(height, Math.ceil(r.y + r.height));
  if (x2 <= x || y2 <= y) return null;
  return { x, y, width: x2 - x, height: y2 - y };
}

export function inflate(r, n) {
  return r ? { x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2 } : null;
}
