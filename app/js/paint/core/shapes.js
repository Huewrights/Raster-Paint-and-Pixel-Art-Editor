export const SHAPES = [
  { id: 'line', name: 'Linha', kind: 'line' },
  { id: 'curve', name: 'Curva', kind: 'curve' },
  { id: 'oval', name: 'Oval' },
  { id: 'rectangle', name: 'Retângulo' },
  { id: 'roundedRectangle', name: 'Retângulo arredondado' },
  { id: 'polygon', name: 'Polígono', kind: 'polygon' },
  { id: 'triangle', name: 'Triângulo' },
  { id: 'rightTriangle', name: 'Triângulo retângulo' },
  { id: 'diamond', name: 'Losango' },
  { id: 'pentagon', name: 'Pentágono' },
  { id: 'hexagon', name: 'Hexágono' },
  { id: 'arrowRight', name: 'Seta para a direita' },
  { id: 'arrowLeft', name: 'Seta para a esquerda' },
  { id: 'arrowUp', name: 'Seta para cima' },
  { id: 'arrowDown', name: 'Seta para baixo' },
  { id: 'star4', name: 'Estrela de quatro pontas' },
  { id: 'star5', name: 'Estrela de cinco pontas' },
  { id: 'star6', name: 'Estrela de seis pontas' },
  { id: 'calloutRect', name: 'Balão retangular arredondado' },
  { id: 'calloutOval', name: 'Balão oval' },
  { id: 'calloutCloud', name: 'Balão de nuvem' },
  { id: 'heart', name: 'Coração' },
  { id: 'lightning', name: 'Raio' },
];

export const SHAPE_IDS = SHAPES.map((s) => s.id);

export const STROKE_STYLES = [
  ['none', 'Sem contorno'],
  ['solid', 'Cor sólida'],
  ['crayon', 'Giz de cera'],
  ['marker', 'Marcador'],
  ['oil', 'Óleo'],
  ['pencil', 'Lápis natural'],
  ['watercolor', 'Aquarela'],
];

export const FILL_STYLES = [
  ['none', 'Sem preenchimento'],
  ['solid', 'Cor sólida'],
  ['crayon', 'Giz de cera'],
  ['marker', 'Marcador'],
  ['oil', 'Óleo'],
  ['pencil', 'Lápis natural'],
  ['watercolor', 'Aquarela'],
];

const K = 0.5522847498;

function polygonPath(points) {
  return [['M', ...points[0]], ...points.slice(1).map((p) => ['L', ...p]), ['Z']];
}

function scale(points, x, y, w, h) {
  return points.map(([u, v]) => [x + u * w, y + v * h]);
}

function ellipsePath(cx, cy, rx, ry) {
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry],
    ['C', cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy],
    ['C', cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry],
    ['C', cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy],
    ['Z'],
  ];
}

function roundedRectPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    ['M', x + rr, y],
    ['L', x + w - rr, y],
    ['Q', x + w, y, x + w, y + rr],
    ['L', x + w, y + h - rr],
    ['Q', x + w, y + h, x + w - rr, y + h],
    ['L', x + rr, y + h],
    ['Q', x, y + h, x, y + h - rr],
    ['L', x, y + rr],
    ['Q', x, y, x + rr, y],
    ['Z'],
  ];
}

function regular(sides, rotation = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  const xs = out.map((p) => p[0]);
  const ys = out.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return out.map(([u, v]) => [(u - minX) / (maxX - minX), (v - minY) / (maxY - minY)]);
}

function star(points, inner) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 ? inner : 0.5;
    out.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  const xs = out.map((p) => p[0]);
  const ys = out.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return out.map(([u, v]) => [(u - minX) / (maxX - minX), (v - minY) / (maxY - minY)]);
}

const ARROW_RIGHT = [
  [0, 0.25],
  [0.6, 0.25],
  [0.6, 0],
  [1, 0.5],
  [0.6, 1],
  [0.6, 0.75],
  [0, 0.75],
];

const POLYGONS = {
  triangle: [
    [0.5, 0],
    [1, 1],
    [0, 1],
  ],
  rightTriangle: [
    [0, 0],
    [1, 1],
    [0, 1],
  ],
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  pentagon: regular(5),
  hexagon: regular(6, 0),
  arrowRight: ARROW_RIGHT,
  arrowLeft: ARROW_RIGHT.map(([u, v]) => [1 - u, v]),
  arrowUp: ARROW_RIGHT.map(([u, v]) => [v, 1 - u]),
  arrowDown: ARROW_RIGHT.map(([u, v]) => [v, u]),
  star4: star(4, 0.18),
  star5: star(5, 0.2),
  star6: star(6, 0.27),
  lightning: [
    [0.38, 0],
    [0.62, 0.3],
    [0.52, 0.36],
    [0.82, 0.62],
    [0.72, 0.67],
    [1, 1],
    [0.45, 0.72],
    [0.56, 0.66],
    [0.12, 0.43],
    [0.25, 0.37],
    [0, 0.17],
  ],
};

function calloutRect(x, y, w, h) {
  const body = h * 0.78;
  const r = Math.min(w, body) * 0.18;
  return [
    ['M', x + r, y],
    ['L', x + w - r, y],
    ['Q', x + w, y, x + w, y + r],
    ['L', x + w, y + body - r],
    ['Q', x + w, y + body, x + w - r, y + body],
    ['L', x + w * 0.42, y + body],
    ['L', x + w * 0.2, y + h],
    ['L', x + w * 0.26, y + body],
    ['L', x + r, y + body],
    ['Q', x, y + body, x, y + body - r],
    ['L', x, y + r],
    ['Q', x, y, x + r, y],
    ['Z'],
  ];
}

function calloutOval(x, y, w, h) {
  const body = h * 0.8;
  const cx = x + w / 2;
  const cy = y + body / 2;
  const rx = w / 2;
  const ry = body / 2;
  const a1 = (110 * Math.PI) / 180;
  const a2 = (128 * Math.PI) / 180;
  const p1 = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)];
  const p2 = [cx + rx * Math.cos(a2), cy + ry * Math.sin(a2)];
  const steps = 40;
  const path = [['M', ...p1], ['L', x + w * 0.18, y + h], ['L', ...p2]];
  for (let i = 1; i <= steps; i++) {
    const a = a2 + ((2 * Math.PI - (a2 - a1)) * i) / steps;
    path.push(['L', cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  path.push(['Z']);
  return path;
}

function calloutCloud(x, y, w, h) {
  const body = h * 0.78;
  const cx = x + w / 2;
  const cy = y + body / 2;
  const rx = w / 2;
  const ry = body / 2;
  const bumps = 9;
  const path = [];
  for (let i = 0; i < bumps; i++) {
    const a0 = (i * 2 * Math.PI) / bumps;
    const a1 = ((i + 1) * 2 * Math.PI) / bumps;
    const am = (a0 + a1) / 2;
    const p0 = [cx + rx * 0.82 * Math.cos(a0), cy + ry * 0.82 * Math.sin(a0)];
    const p1 = [cx + rx * 0.82 * Math.cos(a1), cy + ry * 0.82 * Math.sin(a1)];
    const c = [cx + rx * 1.14 * Math.cos(am), cy + ry * 1.14 * Math.sin(am)];
    if (i === 0) path.push(['M', ...p0]);
    path.push(['Q', ...c, ...p1]);
  }
  path.push(['Z']);
  const r1 = Math.min(w, h) * 0.06;
  const r2 = Math.min(w, h) * 0.035;
  path.push(...ellipsePath(x + w * 0.24, y + body + (h - body) * 0.3, r1, r1));
  path.push(...ellipsePath(x + w * 0.14, y + h - r2, r2, r2));
  return path;
}

function heart(x, y, w, h) {
  return [
    ['M', x + w / 2, y + h],
    ['C', x + w * 0.38, y + h * 0.86, x, y + h * 0.62, x, y + h * 0.3],
    ['C', x, y + h * 0.1, x + w * 0.16, y, x + w * 0.28, y],
    ['C', x + w * 0.4, y, x + w * 0.48, y + h * 0.08, x + w / 2, y + h * 0.18],
    ['C', x + w * 0.52, y + h * 0.08, x + w * 0.6, y, x + w * 0.72, y],
    ['C', x + w * 0.84, y, x + w, y + h * 0.1, x + w, y + h * 0.3],
    ['C', x + w, y + h * 0.62, x + w * 0.62, y + h * 0.86, x + w / 2, y + h],
    ['Z'],
  ];
}

export function shapePath(id, { x, y, width: w, height: h }, extra = {}) {
  if (id === 'line') {
    const [a, b] = extra.points ?? [
      [x, y],
      [x + w, y + h],
    ];
    return [['M', ...a], ['L', ...b]];
  }
  if (id === 'curve') {
    const [a, b, c1, c2] = extra.points;
    return [['M', ...a], ['C', ...(c1 ?? a), ...(c2 ?? c1 ?? b), ...b]];
  }
  if (id === 'polygon') {
    const pts = extra.points ?? [];
    if (pts.length < 2) return [];
    return extra.closed === false ? [['M', ...pts[0]], ...pts.slice(1).map((p) => ['L', ...p])] : polygonPath(pts);
  }
  if (id === 'oval') return ellipsePath(x + w / 2, y + h / 2, w / 2, h / 2);
  if (id === 'rectangle') return polygonPath([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);
  if (id === 'roundedRectangle') return roundedRectPath(x, y, w, h, Math.min(w, h) * 0.18);
  if (id === 'calloutRect') return calloutRect(x, y, w, h);
  if (id === 'calloutOval') return calloutOval(x, y, w, h);
  if (id === 'calloutCloud') return calloutCloud(x, y, w, h);
  if (id === 'heart') return heart(x, y, w, h);
  const poly = POLYGONS[id];
  if (!poly) throw new Error(`Forma desconhecida: ${id}`);
  return polygonPath(scale(poly, x, y, w, h));
}

export function isOpenShape(id, extra = {}) {
  return id === 'line' || id === 'curve' || (id === 'polygon' && extra.closed === false);
}

export function toPath2D(commands, PathClass = globalThis.Path2D) {
  const path = new PathClass();
  for (const [c, ...a] of commands) {
    if (c === 'M') path.moveTo(...a);
    else if (c === 'L') path.lineTo(...a);
    else if (c === 'Q') path.quadraticCurveTo(...a);
    else if (c === 'C') path.bezierCurveTo(...a);
    else if (c === 'Z') path.closePath();
  }
  return path;
}

export function flatten(commands, step = 2) {
  const lines = [];
  let current = null;
  let start = null;
  let cx = 0;
  let cy = 0;
  const push = (x, y) => {
    current.push([x, y]);
    cx = x;
    cy = y;
  };
  for (const [c, ...a] of commands) {
    if (c === 'M') {
      current = [];
      lines.push(current);
      push(a[0], a[1]);
      start = [a[0], a[1]];
    } else if (c === 'L') push(a[0], a[1]);
    else if (c === 'Q') {
      const n = Math.max(4, Math.ceil(Math.hypot(a[2] - cx, a[3] - cy) / step));
      const [x0, y0] = [cx, cy];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        push(u * u * x0 + 2 * u * t * a[0] + t * t * a[2], u * u * y0 + 2 * u * t * a[1] + t * t * a[3]);
      }
    } else if (c === 'C') {
      const n = Math.max(6, Math.ceil((Math.hypot(a[0] - cx, a[1] - cy) + Math.hypot(a[2] - a[0], a[3] - a[1]) + Math.hypot(a[4] - a[2], a[5] - a[3])) / step));
      const [x0, y0] = [cx, cy];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        push(
          u * u * u * x0 + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4],
          u * u * u * y0 + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5],
        );
      }
    } else if (c === 'Z' && start) push(start[0], start[1]);
  }
  return lines.filter((l) => l.length > 1);
}

export function pathBounds(commands) {
  const pts = flatten(commands, 4).flat();
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
