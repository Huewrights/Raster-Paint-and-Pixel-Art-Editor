import { BITMAPS as PIXEL_BITMAPS, bitmapPath } from '../../../pixel/js/ui/icons.js';
import { shapePath } from '../core/shapes.js';

const dot = (x, y, r = 1.2) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS = {
  selection: '<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3 2.4"/>',
  lasso: '<path d="M7.5 17.2C5 16.2 3.5 14.3 3.5 12c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7-3.8 7-8.5 7c-.9 0-1.8-.1-2.6-.3" stroke-dasharray="3 2.2"/><path d="M8.8 17.6a1.9 1.9 0 1 0-1.9 2.7c.8.5.9 1.3.5 2.2"/>',
  objectSelect: '<path d="M4 8.5V5a1 1 0 0 1 1-1h3.5M15.5 4H19a1 1 0 0 1 1 1v3.5M20 15.5V19a1 1 0 0 1-1 1h-3.5M8.5 20H5a1 1 0 0 1-1-1v-3.5"/><path d="M12 7.2l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z" fill="currentColor"/>',
  crop: '<path d="M6 2.5V16a2 2 0 0 0 2 2h13.5"/><path d="M18 21.5V8a2 2 0 0 0-2-2H2.5"/>',
  resize: '<rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M13 21h6a2 2 0 0 0 2-2v-6"/><path d="M14.5 14.5 19.5 19.5M19.5 15v4.5H15"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/>',
  flip: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7.5 4 17h5zM15 7.5l5 9.5h-5z"/>',
  removeBackground: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2.4"/><circle cx="12" cy="10" r="3"/><path d="M6.5 19c1-3 3.2-4.5 5.5-4.5s4.5 1.5 5.5 4.5"/>',
  transparent: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 3.5h5.7v5.7H3.5zM14.8 3.5h5.7v5.7h-5.7zM9.2 9.2h5.6v5.6H9.2zM3.5 14.8h5.7v5.7H3.5zM14.8 14.8h5.7v5.7h-5.7z" fill="currentColor" stroke="none" opacity=".35"/>',
  invertColors: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  pencil: '<path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="M14.5 5.5l3 3"/>',
  bucket: '<path d="M5.2 11.6 11.6 5.2l7 7-6.4 6.4a2 2 0 0 1-2.8 0l-4.2-4.2a2 2 0 0 1 0-2.8z"/><path d="M8.6 8.2 5.6 5.2M5 12.4h13.4"/><path d="M20 15.2s1.6 2.1 1.6 3.1a1.6 1.6 0 0 1-3.2 0c0-1 1.6-3.1 1.6-3.1z" fill="currentColor"/>',
  text: '<path d="M5 20 11 4h2l6 16M7.7 14h8.6"/>',
  eraser: '<path d="M8.5 20.5h12"/><path d="M4.4 15.2l9.4-9.4a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8l-9.1 9.3H8l-3.6-3.5a1.3 1.3 0 0 1 0-1.8z"/><path d="M9.3 10.3l5.4 5.4"/>',
  eyedropper: '<path d="M13.2 6.8l4 4"/><path d="M17.4 3.6a2.2 2.2 0 0 1 3.1 3.1l-2.3 2.3-3.1-3.1z"/><path d="M15.4 8.6 6 18l-3 1 1-3 9.4-9.4"/>',
  magnifier: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 8v5M8 10.5h5"/>',
  brush: '<path d="M9.6 14.4 18.4 5.6a1.9 1.9 0 0 1 2.7 2.7l-8.8 8.8"/><path d="M7.6 14a3 3 0 0 0-3 3c0 1.6-.9 2.4-2.1 3 2.6.6 6.6.4 7.7-1.6a3 3 0 0 0-2.6-4.4z"/>',
  calligraphyBrush: '<path d="M19 3.5 20.5 5l-8.2 8.2-2.4-1.5z"/><path d="M9.9 11.7l2.4 2.4-5.1 5.4-4.7 1 1-4.7z"/>',
  calligraphyPen: '<path d="M12 3l6 7-6 11-6-11z"/><circle cx="12" cy="11" r="1.5"/><path d="M12 12.5V21"/>',
  airbrush: `<path d="M4.5 10h6v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM6 10V7.5h3V10"/>${dot(14, 6)}${dot(17, 4)}${dot(17, 8)}${dot(20, 6)}${dot(20, 10)}${dot(14, 10)}${dot(17, 12)}`,
  oil: '<path d="M14 3.5l6.5 6.5-6.8 6.8-6.5-6.5z"/><path d="M8.2 12.4 4 16.6c-1 1-1 2.4 0 3.4s2.4 1 3.4 0l4.2-4.2"/><path d="M12 6l6 6"/>',
  crayon: '<path d="M15 3.5l5.5 5.5-10 10H5v-5.5z"/><path d="M13 5.5l5.5 5.5M8.2 11.3l4.5 4.5M5 19l-1.6 1.6"/>',
  marker: '<path d="M15.5 3.5l5 5-8 8-5-5z"/><path d="M7.5 11.5 5 17l2 2 5.5-2.5"/><path d="M3 21h6"/>',
  naturalPencil: '<path d="M17 3l4 4L8 20H4v-4z"/><path d="M4 16l4 4M14.5 5.5l4 4"/>',
  watercolor: '<path d="M12.6 12.4 19.4 5.6a1.9 1.9 0 0 1 2.7 2.7l-6.8 6.8"/><path d="M10.6 12a3 3 0 0 0-3 3c0 1.5-.9 2.2-2 2.7 2.4.5 6 .3 7-1.5a3 3 0 0 0-2-4.2z"/><path d="M6 3.5s2.5 3 2.5 4.6a2.5 2.5 0 0 1-5 0C3.5 6.5 6 3.5 6 3.5z"/>',
  size: '<path d="M4 6h16" stroke-width="1"/><path d="M4 11.5h16" stroke-width="2"/><path d="M4 17.5h16" stroke-width="3.4"/>',
  layers: '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="M2.5 12 12 17l9.5-5"/><path d="M2.5 16 12 21l9.5-5"/>',
  rectangle: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  disk: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
  palette: `<path d="M12 3a9 9 0 0 0 0 18c1.2 0 2-.8 2-1.9 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-1.9 2-1.9h2.3c2.6 0 3.8-2 3.8-4.4C21 6.3 17 3 12 3z"/>${dot(7.5, 11)}${dot(9.8, 7)}${dot(14.6, 7.2)}${dot(17.2, 11)}`,
  gear: '<path d="M12 2.5l1.7 2.4 2.9-.6.6 2.9 2.4 1.7-1.3 2.6 1.3 2.6-2.4 1.7-.6 2.9-2.9-.6L12 21.5l-1.7-2.4-2.9.6-.6-2.9-2.4-1.7L5.7 12 4.4 9.4l2.4-1.7.6-2.9 2.9.6z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a6.6 6.6 0 0 0 11 11z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  merge: '<path d="M7 4v4l5 5 5-5V4"/><path d="M12 13v7.5M8.5 17l3.5 3.5 3.5-3.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeClosed: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z" stroke-width="2.4"/>',
  italic: '<path d="M10 4h9M5 20h9M15 4 9 20"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 21h14"/>',
  strike: '<path d="M16 5.5A4 4 0 0 0 12.5 4H11a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1.5A4 4 0 0 1 8 16.5M4 12h16"/>',
  alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  fillBackground: '<rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor" stroke="none" opacity=".25"/><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 17l4-10 4 10M9.6 13h4.8"/>',
};

export function icon(name, size = 20, label = '') {
  const safe = String(label).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const aria = label ? `role="img" aria-label="${safe}"` : 'aria-hidden="true"';
  if (name === 'logo') {
    const bitmap = PIXEL_BITMAPS.logo;
    const w = Math.max(...bitmap.map((r) => r.length));
    const h = bitmap.length;
    const side = Math.max(w, h) + 2;
    return `<svg class="icon" width="${size}" height="${size}" viewBox="${-(side - w) / 2} ${-(side - h) / 2} ${side} ${side}" shape-rendering="crispEdges" ${aria}><path fill="currentColor" d="${bitmapPath(bitmap)}"/></svg>`;
  }
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="icon vector-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${aria}>${body}</svg>`;
}

function svgPath(commands) {
  return commands.map(([c, ...a]) => c + a.map((v) => Math.round(v * 100) / 100).join(' ')).join('');
}

export function shapeIcon(id, size = 20) {
  const box = { x: 2, y: 2, width: 16, height: 16 };
  let commands;
  if (id === 'curve') commands = shapePath('curve', box, { points: [[2, 16], [18, 6], [6, 0], [12, 22]] });
  else if (id === 'polygon') commands = shapePath('polygon', box, { points: [[3, 6], [10, 2], [17, 8], [14, 17], [5, 15]] });
  else if (id === 'line') commands = shapePath('line', box, { points: [[3, 17], [17, 3]] });
  else commands = shapePath(id, box);
  return `<svg class="icon shape-icon" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><path d="${svgPath(commands)}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
