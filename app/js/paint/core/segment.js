import { rgbToOklab } from './color.js';

const MAX_CLUSTERS = 6;
const TRANSPARENT = 16;

function borderIndices(rect, width) {
  const out = [];
  const { x, y, width: w, height: h } = rect;
  const ring = Math.max(1, Math.min(3, Math.floor(Math.min(w, h) / 12)));
  for (let r = 0; r < ring; r++) {
    for (let i = x + r; i < x + w - r; i++) out.push((y + r) * width + i, (y + h - 1 - r) * width + i);
    for (let j = y + r + 1; j < y + h - 1 - r; j++) out.push(j * width + x + r, j * width + x + w - 1 - r);
  }
  return out;
}

function labOf(p, cache) {
  const i = p * 3;
  if (cache[i] === undefined || Number.isNaN(cache[i])) return null;
  return [cache[i], cache[i + 1], cache[i + 2]];
}

function kmeans(points, k) {
  if (!points.length) return [];
  const centers = [points[0]];
  while (centers.length < k) {
    let best = null;
    let bestDistance = -1;
    for (let i = 0; i < points.length; i += Math.max(1, Math.floor(points.length / 2048))) {
      const p = points[i];
      let nearest = Infinity;
      for (const c of centers) nearest = Math.min(nearest, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2);
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = p;
      }
    }
    if (!best || bestDistance < 1e-5) break;
    centers.push(best.slice());
  }
  for (let round = 0; round < 8; round++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      let index = 0;
      let nearest = Infinity;
      centers.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < nearest) {
          nearest = d;
          index = i;
        }
      });
      const s = sums[index];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    sums.forEach((s, i) => {
      if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  return centers;
}

function otsu(values, bins = 128) {
  if (!values.length) return 0;
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max <= 0) return 0;
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v / max) * (bins - 1)))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let threshold = 0;
  for (let i = 0; i < bins; i++) {
    weightB += hist[i];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += i * hist[i];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return ((threshold + 0.5) / (bins - 1)) * max;
}

function components(mask, width, rect, value) {
  const labels = new Int32Array(mask.length).fill(-1);
  const sizes = [];
  const stack = new Int32Array(rect.width * rect.height);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const start = y * width + x;
      if (mask[start] !== value || labels[start] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      let top = 0;
      stack[top++] = start;
      labels[start] = id;
      while (top) {
        const p = stack[--top];
        size++;
        const px = p % width;
        const py = (p - px) / width;
        if (px > rect.x && mask[p - 1] === value && labels[p - 1] < 0) (labels[p - 1] = id), (stack[top++] = p - 1);
        if (px < rect.x + rect.width - 1 && mask[p + 1] === value && labels[p + 1] < 0) (labels[p + 1] = id), (stack[top++] = p + 1);
        if (py > rect.y && mask[p - width] === value && labels[p - width] < 0) (labels[p - width] = id), (stack[top++] = p - width);
        if (py < rect.y + rect.height - 1 && mask[p + width] === value && labels[p + width] < 0) (labels[p + width] = id), (stack[top++] = p + width);
      }
      sizes.push(size);
    }
  }
  return { labels, sizes };
}

export function normalizeRect(rect, width, height) {
  const r = rect ?? { x: 0, y: 0, width, height };
  const x = Math.max(0, Math.min(width - 1, Math.floor(r.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(r.y)));
  const x2 = Math.max(x + 1, Math.min(width, Math.ceil(r.x + r.width)));
  const y2 = Math.max(y + 1, Math.min(height, Math.ceil(r.y + r.height)));
  return { x, y, width: x2 - x, height: y2 - y };
}

export function segmentObject(image, { rect = null, point = null, sensitivity = 50, removeHoles = false, softEdges = true } = {}) {
  const { width, height, data } = image;
  const area = normalizeRect(rect, width, height);
  const alpha = new Uint8Array(width * height);
  if (area.width < 3 || area.height < 3) return { alpha, bounds: null, coverage: 0 };

  const lab = new Float32Array(width * height * 3).fill(NaN);
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const p = y * width + x;
      const i = p * 4;
      if (data[i + 3] < TRANSPARENT) continue;
      const [L, A, B] = rgbToOklab(data[i], data[i + 1], data[i + 2]);
      lab[p * 3] = L;
      lab[p * 3 + 1] = A;
      lab[p * 3 + 2] = B;
    }
  }

  const border = borderIndices(area, width);
  const samples = [];
  for (const p of border) {
    const c = labOf(p, lab);
    if (c) samples.push(c);
  }

  const distance = new Float32Array(width * height);
  const inside = [];
  if (samples.length) {
    const centers = kmeans(samples, Math.min(MAX_CLUSTERS, samples.length));
    for (let y = area.y; y < area.y + area.height; y++) {
      for (let x = area.x; x < area.x + area.width; x++) {
        const p = y * width + x;
        const c = labOf(p, lab);
        if (!c) {
          distance[p] = 0;
          continue;
        }
        let nearest = Infinity;
        for (const k of centers) nearest = Math.min(nearest, (c[0] - k[0]) ** 2 + (c[1] - k[1]) ** 2 + (c[2] - k[2]) ** 2);
        distance[p] = Math.sqrt(nearest) * 100;
        inside.push(distance[p]);
      }
    }
  } else {
    for (let y = area.y; y < area.y + area.height; y++) {
      for (let x = area.x; x < area.x + area.width; x++) {
        const p = y * width + x;
        distance[p] = labOf(p, lab) ? 100 : 0;
        inside.push(distance[p]);
      }
    }
  }

  const auto = otsu(inside);
  const factor = 1.6 - (Math.max(0, Math.min(100, sensitivity)) / 100) * 1.2;
  const threshold = Math.max(2.5, Math.min(40, auto * factor || 6));

  const background = new Uint8Array(width * height);
  const stack = new Int32Array(area.width * area.height + 4);
  let top = 0;
  for (const p of border) {
    if (distance[p] <= threshold && !background[p]) {
      background[p] = 1;
      stack[top++] = p;
    }
  }
  while (top) {
    const p = stack[--top];
    const px = p % width;
    const py = (p - px) / width;
    const visit = (n) => {
      if (!background[n] && distance[n] <= threshold) {
        background[n] = 1;
        stack[top++] = n;
      }
    };
    if (px > area.x) visit(p - 1);
    if (px < area.x + area.width - 1) visit(p + 1);
    if (py > area.y) visit(p - width);
    if (py < area.y + area.height - 1) visit(p + width);
  }

  const object = new Uint8Array(width * height);
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const p = y * width + x;
      if (!background[p] && data[p * 4 + 3] >= TRANSPARENT) object[p] = 1;
    }
  }

  if (removeHoles) {
    for (let y = area.y; y < area.y + area.height; y++) {
      for (let x = area.x; x < area.x + area.width; x++) {
        const p = y * width + x;
        if (object[p] && distance[p] <= threshold * 0.6) object[p] = 2;
      }
    }
    const holes = components(object, width, area, 2);
    const minHole = Math.max(12, Math.round(area.width * area.height * 0.0008));
    for (let y = area.y; y < area.y + area.height; y++) {
      for (let x = area.x; x < area.x + area.width; x++) {
        const p = y * width + x;
        if (object[p] === 2) object[p] = holes.sizes[holes.labels[p]] >= minHole ? 0 : 1;
      }
    }
  }

  const parts = components(object, width, area, 1);
  if (!parts.sizes.length) return { alpha, bounds: null, coverage: 0, threshold };
  let keep;
  if (point && point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height && object[point.y * width + point.x]) {
    const id = parts.labels[point.y * width + point.x];
    keep = (label) => label === id;
  } else {
    const largest = Math.max(...parts.sizes);
    const minimum = Math.max(16, largest * 0.04);
    keep = (label) => parts.sizes[label] >= minimum;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const p = y * width + x;
      if (!object[p] || !keep(parts.labels[p])) continue;
      alpha[p] = 255;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!count) return { alpha, bounds: null, coverage: 0, threshold };

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = y * width + x;
      if (alpha[p]) continue;
      let filled = 0;
      if (x > minX && alpha[p - 1]) filled++;
      if (x < maxX && alpha[p + 1]) filled++;
      if (y > minY && alpha[p - width]) filled++;
      if (y < maxY && alpha[p + width]) filled++;
      if (filled >= 3 && object[p] !== 0) alpha[p] = 255;
    }
  }

  const final = softEdges ? refineEdges(image, alpha, { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }) : alpha;

  return {
    alpha: final,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    coverage: count / (area.width * area.height),
    threshold,
  };
}

function expand(bounds, n, width, height) {
  const x = Math.max(0, bounds.x - n);
  const y = Math.max(0, bounds.y - n);
  return { x, y, width: Math.min(width, bounds.x + bounds.width + n) - x, height: Math.min(height, bounds.y + bounds.height + n) - y };
}

function boxBlur(values, w, h, radius) {
  const tmp = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  const size = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += values[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / size;
      sum += values[y * w + Math.min(w - 1, x + radius + 1)] - values[y * w + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return out;
}

function chamfer(inside, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? INF : 0;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - w] + a);
        if (x > 0) v = Math.min(v, d[i - w - 1] + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (x > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

export function refineEdges(image, mask, bounds, { band = 2, window = 4 } = {}) {
  const { width, height, data } = image;
  const area = expand(bounds, band + window + 2, width, height);
  const w = area.width;
  const h = area.height;
  const local = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) local[y * w + x] = mask[(area.y + y) * width + area.x + x] ? 1 : 0;
  const smooth = boxBlur(boxBlur(local, w, h, 1), w, h, 1);
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) inside[i] = smooth[i] >= 0.5 ? 1 : 0;
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < outside.length; i++) outside[i] = inside[i] ? 0 : 1;
  const din = chamfer(inside, w, h);
  const dout = chamfer(outside, w, h);
  const signed = new Float32Array(w * h);
  for (let i = 0; i < signed.length; i++) signed[i] = inside[i] ? din[i] - 0.5 : 0.5 - dout[i];
  const result = new Uint8Array(width * height);
  const alphaLocal = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const sd = signed[i];
      const geometric = Math.max(0, Math.min(1, 0.5 + sd));
      if (Math.abs(sd) > band) {
        alphaLocal[i] = sd > 0 ? 1 : 0;
        continue;
      }
      let fr = 0;
      let fg = 0;
      let fb = 0;
      let fn = 0;
      let br = 0;
      let bg = 0;
      let bb = 0;
      let bn = 0;
      for (let dy = -window; dy <= window; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -window; dx <= window; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          const s = signed[j];
          const k = ((area.y + yy) * width + area.x + xx) * 4;
          if (s > band) {
            fr += data[k];
            fg += data[k + 1];
            fb += data[k + 2];
            fn++;
          } else if (s < -band && data[k + 3] > 16) {
            br += data[k];
            bg += data[k + 1];
            bb += data[k + 2];
            bn++;
          }
        }
      }
      let alpha = geometric;
      if (fn && bn) {
        const F = [fr / fn, fg / fn, fb / fn];
        const B = [br / bn, bg / bn, bb / bn];
        const k = ((area.y + y) * width + area.x + x) * 4;
        const FB = [F[0] - B[0], F[1] - B[1], F[2] - B[2]];
        const len = FB[0] * FB[0] + FB[1] * FB[1] + FB[2] * FB[2];
        if (len > 400) {
          const t = ((data[k] - B[0]) * FB[0] + (data[k + 1] - B[1]) * FB[1] + (data[k + 2] - B[2]) * FB[2]) / len;
          const colorAlpha = Math.max(0, Math.min(1, t));
          const weight = Math.min(1, Math.sqrt(len) / 120);
          alpha = colorAlpha * weight * 0.75 + geometric * (1 - weight * 0.75);
        }
      }
      alphaLocal[i] = alpha;
    }
  }
  const blurred = boxBlur(alphaLocal, w, h, 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const value = Math.abs(signed[i]) > band ? alphaLocal[i] : alphaLocal[i] * 0.6 + blurred[i] * 0.4;
      result[(area.y + y) * width + area.x + x] = Math.round(Math.max(0, Math.min(1, value)) * 255);
    }
  }
  return result;
}

export function applyMatte(image, alpha, { decontaminate = true, window = 4 } = {}) {
  const { width, height, data } = image;
  const source = decontaminate ? data.slice() : data;
  for (let p = 0; p < alpha.length; p++) {
    const a = alpha[p];
    const i = p * 4;
    if (decontaminate && a > 0 && a < 255) {
      const x = p % width;
      const y = (p - x) / width;
      const back = [0, 0, 0, 0];
      const front = [0, 0, 0, 0];
      for (let dy = -window; dy <= window; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -window; dx <= window; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (source[q * 4 + 3] < 16) continue;
          const bucket = alpha[q] === 0 ? back : alpha[q] === 255 ? front : null;
          if (!bucket) continue;
          bucket[0] += source[q * 4];
          bucket[1] += source[q * 4 + 1];
          bucket[2] += source[q * 4 + 2];
          bucket[3]++;
        }
      }
      if (back[3]) {
        const t = a / 255;
        for (let c = 0; c < 3; c++) {
          const estimate = Math.max(0, Math.min(255, (source[i + c] - (1 - t) * (back[c] / back[3])) / t));
          data[i + c] = Math.round(front[3] ? estimate * t + (front[c] / front[3]) * (1 - t) : estimate);
        }
      }
    }
    data[i + 3] = Math.round((source[i + 3] * a) / 255);
  }
  return image;
}
