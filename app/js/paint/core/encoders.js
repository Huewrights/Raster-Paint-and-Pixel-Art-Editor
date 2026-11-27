export function flattenOn(img, [r, g, b] = [255, 255, 255]) {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < out.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = Math.round(img.data[i] * a + r * (1 - a));
    out[i + 1] = Math.round(img.data[i + 1] * a + g * (1 - a));
    out[i + 2] = Math.round(img.data[i + 2] * a + b * (1 - a));
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

export function encodeBMP(img) {
  const { width, height } = img;
  const flat = flattenOn(img);
  const stride = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + stride * height;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, stride * height, true);
  view.setInt32(38, 3780, true);
  view.setInt32(42, 3780, true);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = row + x * 3;
      bytes[d] = flat.data[s + 2];
      bytes[d + 1] = flat.data[s + 1];
      bytes[d + 2] = flat.data[s];
    }
  }
  return bytes;
}

export function encodeTIFF(img, dpi = 96) {
  const { width, height, data } = img;
  const entries = 12;
  const ifdOffset = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const bitsOffset = ifdOffset + ifdSize;
  const resolutionOffset = bitsOffset + 8;
  const extraOffset = resolutionOffset + 16;
  const pixelOffset = extraOffset;
  const total = pixelOffset + data.length;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries, true);
  let p = ifdOffset + 2;
  const tag = (id, type, count, value) => {
    view.setUint16(p, id, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(p + 8, value, true);
    else view.setUint32(p + 8, value, true);
    p += 12;
  };
  tag(256, 4, 1, width);
  tag(257, 4, 1, height);
  tag(258, 3, 4, bitsOffset);
  tag(259, 3, 1, 1);
  tag(262, 3, 1, 2);
  tag(273, 4, 1, pixelOffset);
  tag(277, 3, 1, 4);
  tag(278, 4, 1, height);
  tag(279, 4, 1, data.length);
  tag(282, 5, 1, resolutionOffset);
  tag(283, 5, 1, resolutionOffset + 8);
  tag(338, 3, 1, 2);
  view.setUint32(p, 0, true);
  for (let i = 0; i < 4; i++) view.setUint16(bitsOffset + i * 2, 8, true);
  view.setUint32(resolutionOffset, dpi, true);
  view.setUint32(resolutionOffset + 4, 1, true);
  view.setUint32(resolutionOffset + 8, dpi, true);
  view.setUint32(resolutionOffset + 12, 1, true);
  bytes.set(data, pixelOffset);
  return bytes;
}

export function encodeICO(images) {
  const header = new Uint8Array(6 + images.length * 16);
  const view = new DataView(header.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    view.setUint16(e + 4, 1, true);
    view.setUint16(e + 6, 32, true);
    view.setUint32(e + 8, png.length, true);
    view.setUint32(e + 12, offset, true);
    offset += png.length;
  });
  const out = new Uint8Array(offset);
  out.set(header, 0);
  let at = header.length;
  for (const { png } of images) {
    out.set(png, at);
    at += png.length;
  }
  return out;
}

export function quantize(img, maxColors = 255) {
  const { data } = img;
  const n = data.length / 4;
  const counts = new Map();
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let boxes = [[...counts.entries()].map(([key, count]) => [((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4, count])];
  if (!boxes[0].length) return { pixels: new Uint32Array(n), palette: [] };
  const range = (box, c) => {
    let lo = 255;
    let hi = 0;
    for (const e of box) {
      if (e[c] < lo) lo = e[c];
      if (e[c] > hi) hi = e[c];
    }
    return hi - lo;
  };
  while (boxes.length < maxColors) {
    let target = -1;
    let best = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const score = Math.max(range(box, 0), range(box, 1), range(box, 2)) * Math.log2(box.reduce((t, e) => t + e[3], 0) + 1);
      if (score > best) {
        best = score;
        target = i;
      }
    });
    if (target < 0) break;
    const box = boxes[target];
    const channel = [0, 1, 2].reduce((a, c) => (range(box, c) > range(box, a) ? c : a), 0);
    box.sort((a, b) => a[channel] - b[channel]);
    const half = box.reduce((t, e) => t + e[3], 0) / 2;
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i][3];
      if (acc >= half) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(target, 1, box.slice(0, cut), box.slice(cut));
  }
  boxes = boxes.filter((b) => b.length);
  const palette = boxes.map((box) => {
    const total = box.reduce((t, e) => t + e[3], 0);
    return [0, 1, 2].map((c) => Math.round(box.reduce((t, e) => t + e[c] * e[3], 0) / total));
  });
  const cache = new Map();
  const pixels = new Uint32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 2) << 12) | ((data[i + 1] >> 2) << 6) | (data[i + 2] >> 2);
    let index = cache.get(key);
    if (index === undefined) {
      let nearest = Infinity;
      index = 0;
      for (let k = 0; k < palette.length; k++) {
        const d = (palette[k][0] - data[i]) ** 2 + (palette[k][1] - data[i + 1]) ** 2 + (palette[k][2] - data[i + 2]) ** 2;
        if (d < nearest) {
          nearest = d;
          index = k;
        }
      }
      cache.set(key, index);
    }
    const [r, g, b] = palette[index];
    pixels[p] = (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
  }
  return { pixels, palette };
}

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function withPngDpi(png, dpi) {
  if (!dpi || png.length < 33) return png;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + 21);
  out.set(png.subarray(0, 33), 0);
  out.set(chunk, 33);
  out.set(png.subarray(33), 54);
  return out;
}
