import { el } from '../../pixel/js/ui/util.js';
import { BASIC_COLORS, contrastText } from './core/color.js';
import { SHAPES, STROKE_STYLES, FILL_STYLES } from './core/shapes.js';
import { BRUSHES } from './core/brushes.js';
import { PRESET_PALETTES } from '../../pixel/js/core/palettes.js';
import { icon, shapeIcon } from './ui/icons.js';
import { showPopup, menuItem, closePopup } from './ui/popup.js';
import { TOOLS } from './ui/tools.js';

const SIZE_PRESETS = { pencil: [1, 2, 3, 4, 6, 8, 12, 16], brush: [1, 3, 5, 8, 12, 16, 24, 32, 48, 64], eraser: [4, 6, 8, 10, 16, 24, 32, 48], shape: [1, 2, 3, 5, 8, 12, 16, 24] };
const BRUSH_ICONS = { brush: 'brush', calligraphyBrush: 'calligraphyBrush', calligraphyPen: 'calligraphyPen', airbrush: 'airbrush', oil: 'oil', crayon: 'crayon', marker: 'marker', pencil: 'naturalPencil', watercolor: 'watercolor' };
export const DRAWING_PALETTES = [{ slug: 'paint', colors: BASIC_COLORS.map(([c]) => c) }, ...PRESET_PALETTES.map((p) => ({ slug: p.slug, colors: p.colors }))];

function group(label, ...content) {
  return el('section', { class: 'ribbon-group', 'aria-label': label }, el('div', { class: 'ribbon-body' }, ...content), el('div', { class: 'ribbon-label' }, label));
}

function toolButton(id, iconName, label, { big = false, extra = null } = {}) {
  return el('button', { type: 'button', class: `rb${big ? ' rb-big' : ''}`, data: { tool: id, ...(extra ?? {}) }, title: label, 'aria-label': label, html: icon(iconName, big ? 24 : 18) + (big ? `<span>${label}</span>` : '') });
}

export class Ribbon {
  constructor(root, subbar, ctx) {
    this.root = root;
    this.subbar = subbar;
    this.ctx = ctx;
    this.app = ctx.app;
    this.paletteSlug = 'paint';
    this.build();
    this.app.on('state', ({ key }) => this.sync(key));
    this.app.on('selection', () => this.syncSubbar());
    this.app.on('object-selected', () => this.syncSubbar());
    this.app.on('text-open', () => this.syncSubbar());
    this.sync();
  }

  run(id) {
    this.ctx.execute(id);
  }

  build() {
    const { app } = this;
    const selectBtn = el('button', { type: 'button', class: 'rb rb-big rb-split', data: { tool: 'select' }, title: 'Seleção (S)', 'aria-label': 'Seleção', html: icon('selection', 24) + '<span>Seleção</span>' });
    const selectMenu = el('button', { type: 'button', class: 'rb rb-arrow', title: 'Opções de seleção', 'aria-label': 'Opções de seleção', 'aria-haspopup': 'true', html: icon('chevron', 10) });
    selectBtn.addEventListener('click', () => app.setState('tool', 'select'));
    selectMenu.addEventListener('click', () =>
      showPopup(selectMenu, (menu) => {
        menu.append(
          menuItem({ label: 'Seleção retangular', checked: app.state.selectMode === 'rect', onclick: () => (app.setState('selectMode', 'rect'), app.setState('tool', 'select')) }),
          menuItem({ label: 'Seleção de forma livre', checked: app.state.selectMode === 'free', onclick: () => (app.setState('selectMode', 'free'), app.setState('tool', 'select')) }),
          menuItem({ label: 'Seleção automática de objeto', shortcut: 'O', checked: app.state.tool === 'objectSelect', onclick: () => app.setState('tool', 'objectSelect') }),
          el('hr'),
          menuItem({ label: 'Selecionar tudo', shortcut: 'Ctrl+A', onclick: () => this.run('selectAll') }),
          menuItem({ label: 'Inverter seleção', shortcut: 'Ctrl+Shift+A', onclick: () => this.run('invertSelection') }),
          menuItem({ label: 'Excluir', shortcut: 'Delete', disabled: !app.selection, onclick: () => this.run('delete') }),
          el('hr'),
          menuItem({ label: 'Seleção transparente', checked: app.state.transparentSelection, onclick: () => app.setState('transparentSelection', !app.state.transparentSelection) }),
        );
      }),
    );
    const objectBtn = toolButton('objectSelect', 'objectSelect', 'Seleção automática de objeto (O)');

    const imageGroup = group(
      'Imagem',
      el(
        'div',
        { class: 'rb-grid two' },
        this.commandButton('crop', 'crop', 'Cortar (Ctrl+Shift+X)'),
        this.commandButton('resize', 'resize', 'Redimensionar e inclinar (Ctrl+W)'),
        this.menuButton('rotate', 'Girar e virar', () => [
          ['Girar 90° à direita', 'rotateRight'],
          ['Girar 90° à esquerda', 'rotateLeft'],
          ['Girar 180°', 'rotate180'],
          '-',
          ['Virar na vertical', 'flipVertical'],
          ['Virar na horizontal', 'flipHorizontal'],
        ]),
        this.commandButton('removeBackground', 'removeBackground', 'Remover fundo (deixa transparente)'),
        this.commandButton('transparentBackground', 'transparent', 'Tornar fundo transparente…'),
        this.commandButton('invertColors', 'invertColors', 'Inverter cores (Ctrl+Shift+I)'),
      ),
    );

    const toolsGroup = group(
      'Ferramentas',
      el(
        'div',
        { class: 'rb-grid three' },
        toolButton('pencil', 'pencil', 'Lápis (P)'),
        toolButton('fill', 'bucket', 'Preenchimento com cor (F)'),
        toolButton('text', 'text', 'Texto (T)'),
        toolButton('eraser', 'eraser', 'Borracha (E)'),
        toolButton('picker', 'eyedropper', 'Seletor de cores (I)'),
        toolButton('magnifier', 'magnifier', 'Lupa (Z)'),
      ),
    );

    this.brushButton = el('button', { type: 'button', class: 'rb rb-big rb-split', data: { tool: 'brush' }, title: 'Pincéis (B)', 'aria-label': 'Pincéis' });
    this.brushButton.addEventListener('click', () => app.setState('tool', 'brush'));
    const brushMenu = el('button', { type: 'button', class: 'rb rb-arrow', title: 'Escolher pincel', 'aria-label': 'Escolher pincel', 'aria-haspopup': 'true', html: icon('chevron', 10) });
    brushMenu.addEventListener('click', () =>
      showPopup(brushMenu, (menu) => {
        menu.append(...BRUSHES.map((b) => menuItem({ label: b.name, icon: icon(BRUSH_ICONS[b.id], 16), checked: app.state.brush === b.id, onclick: () => (app.setState('brush', b.id), app.setState('tool', 'brush')) })));
      }),
    );

    this.shapeGallery = el(
      'div',
      { class: 'shape-gallery', role: 'listbox', 'aria-label': 'Formas' },
      SHAPES.map((s) =>
        el('button', {
          type: 'button',
          class: 'shape-btn',
          role: 'option',
          data: { shape: s.id },
          title: s.name,
          'aria-label': s.name,
          html: shapeIcon(s.id, 18),
          onclick: () => {
            app.setState('shape', s.id);
            app.setState('tool', 'shape');
          },
        }),
      ),
    );
    this.outlineButton = this.styleButton('outline', 'Contorno', STROKE_STYLES);
    this.fillButton = this.styleButton('fill', 'Preenchimento', FILL_STYLES);

    this.sizeButton = el('button', { type: 'button', class: 'rb rb-big', title: 'Tamanho (Ctrl + / Ctrl -)', 'aria-label': 'Tamanho', 'aria-haspopup': 'true', html: icon('size', 24) + '<span class="size-value"></span>' });
    this.sizeButton.addEventListener('click', () => this.sizePopup());
    this.opacity = el('input', { type: 'range', min: 1, max: 100, value: app.state.opacity, 'aria-label': 'Opacidade', class: 'opacity-range' });
    this.opacityOut = el('output', { class: 'mono' });
    this.opacity.addEventListener('input', () => app.setState('opacity', +this.opacity.value));

    this.color1 = el('button', { type: 'button', class: 'color-slot', title: 'Cor 1 (primeiro plano): clique com o botão esquerdo', 'aria-label': 'Cor 1', onclick: () => this.active('primary') });
    this.color2 = el('button', { type: 'button', class: 'color-slot', title: 'Cor 2 (plano de fundo): clique com o botão direito', 'aria-label': 'Cor 2', onclick: () => this.active('secondary') });
    this.activeColor = 'primary';
    this.swatches = el('div', { class: 'swatch-grid' });
    this.customSwatches = el('div', { class: 'swatch-grid custom' });
    const editColors = el('button', { type: 'button', class: 'rb rb-big', title: 'Editar cores', 'aria-label': 'Editar cores', html: '<span class="rainbow" aria-hidden="true"></span><span>Editar cores</span>', onclick: () => this.run('editColors') });
    const paletteSets = el('button', { type: 'button', class: 'rb rb-arrow palette-sets', title: 'Trocar o conjunto de cores', 'aria-label': 'Trocar o conjunto de cores', 'aria-haspopup': 'true', html: icon('palette', 16) });
    paletteSets.addEventListener('click', () =>
      showPopup(paletteSets, (menu) => {
        DRAWING_PALETTES.forEach((p, i) => {
          menu.append(
            el(
              'button',
              {
                type: 'button',
                class: 'menu-item palette-strip',
                role: 'menuitemradio',
                'aria-checked': String(this.paletteSlug === p.slug),
                'aria-label': `Conjunto de cores ${i + 1}`,
                onclick: () => {
                  closePopup();
                  this.paletteSlug = p.slug;
                  this.drawSwatches();
                },
              },
              el('span', { class: 'check' }, this.paletteSlug === p.slug ? '✓' : ''),
              el('span', { class: 'swatches' }, ...p.colors.slice(0, 16).map((c) => el('i', { style: { background: c } }))),
            ),
          );
        });
      }, { className: 'palette-menu' }),
    );

    this.layersButton = el('button', { type: 'button', class: 'rb rb-big', title: 'Camadas', 'aria-label': 'Camadas', 'aria-pressed': 'false', html: icon('layers', 24) + '<span>Camadas</span>', onclick: () => this.run('layersPanel') });

    this.root.replaceChildren(
      group('Seleção', el('div', { class: 'rb-split-wrap' }, selectBtn, selectMenu), objectBtn),
      imageGroup,
      toolsGroup,
      group('Pincéis', el('div', { class: 'rb-split-wrap' }, this.brushButton, brushMenu)),
      group('Formas', this.shapeGallery, el('div', { class: 'rb-stack' }, this.outlineButton, this.fillButton)),
      group('Tamanho', this.sizeButton, el('label', { class: 'opacity-control', title: 'Opacidade do traço' }, el('span', {}, 'Opacidade'), this.opacity, this.opacityOut)),
      group('Cores', el('div', { class: 'color-slots' }, this.color1, this.color2), el('div', { class: 'swatch-area' }, this.swatches, this.customSwatches), el('div', { class: 'rb-stack' }, paletteSets), editColors),
      group('Camadas', this.layersButton),
    );
    for (const b of this.root.querySelectorAll('[data-tool]')) {
      if (b === selectBtn || b === this.brushButton) continue;
      b.addEventListener('click', () => app.setState('tool', b.dataset.tool));
    }
    this.drawSwatches();
  }

  commandButton(id, iconName, label) {
    return el('button', { type: 'button', class: 'rb', title: label, 'aria-label': label, html: icon(iconName, 18), onclick: () => this.run(id) });
  }

  menuButton(iconName, label, items) {
    const button = el('button', { type: 'button', class: 'rb', title: label, 'aria-label': label, 'aria-haspopup': 'true', html: icon(iconName, 18) });
    button.addEventListener('click', () =>
      showPopup(button, (menu) => {
        for (const item of items()) menu.append(item === '-' ? el('hr') : menuItem({ label: item[0], onclick: () => this.run(item[1]) }));
      }),
    );
    return button;
  }

  styleButton(key, label, options) {
    const button = el('button', { type: 'button', class: 'rb rb-text', 'aria-haspopup': 'true', title: label });
    button.addEventListener('click', () =>
      showPopup(button, (menu) => {
        menu.append(...options.map(([v, t]) => menuItem({ label: t, checked: this.app.state[key] === v, onclick: () => this.app.setState(key, v) })));
      }),
    );
    return button;
  }

  sizePopup() {
    const app = this.app;
    const key = app.sizeKey();
    showPopup(this.sizeButton, (menu) => {
      const range = el('input', { type: 'range', min: 1, max: key === 'pencil' ? 32 : 100, value: app.size, 'aria-label': 'Tamanho em pixels' });
      const number = el('input', { type: 'number', min: 1, max: key === 'pencil' ? 32 : 100, value: app.size, class: 'mono', 'aria-label': 'Tamanho em pixels' });
      const update = (v) => {
        app.size = v;
        range.value = app.size;
        number.value = app.size;
      };
      range.addEventListener('input', () => update(+range.value));
      number.addEventListener('change', () => update(+number.value || 1));
      menu.append(
        el('div', { class: 'size-custom' }, range, number, el('span', {}, 'px')),
        ...(SIZE_PRESETS[key] ?? SIZE_PRESETS.brush).map((s) =>
          el(
            'button',
            { type: 'button', class: 'menu-item size-item', 'aria-label': `${s} px`, onclick: () => (update(s), closePopup()) },
            el('span', { class: 'size-line', style: { height: `${Math.min(24, s)}px` } }),
            el('span', { class: 'mono' }, `${s} px`),
          ),
        ),
      );
    }, { className: 'size-menu' });
  }

  active(which) {
    this.activeColor = which;
    this.sync('primary');
  }

  pickSwatch(hex, e) {
    const which = e.button === 2 ? 'secondary' : this.activeColor;
    this.app.setColor(which, hex);
  }

  swatch(hex, label) {
    const b = el('button', { type: 'button', class: 'swatch', style: { '--c': hex }, title: `${label} (${hex})`, 'aria-label': `${label} ${hex}` });
    b.addEventListener('click', (e) => this.pickSwatch(hex, e));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.app.setColor('secondary', hex);
    });
    return b;
  }

  drawSwatches() {
    const set = DRAWING_PALETTES.find((p) => p.slug === this.paletteSlug) ?? DRAWING_PALETTES[0];
    const names = new Map(BASIC_COLORS);
    this.swatches.classList.toggle('many', set.colors.length > 20);
    this.swatches.replaceChildren(...set.colors.map((c, i) => this.swatch(c, names.get(c) ?? `Cor ${i + 1}`)));
    this.customSwatches.replaceChildren(
      ...this.app.state.custom.map((c, i) =>
        c ? this.swatch(c, `Cor personalizada ${i + 1}`) : el('button', { type: 'button', class: 'swatch empty', title: 'Cor personalizada vazia: use Editar cores', 'aria-label': 'Espaço vazio para cor personalizada', onclick: () => this.run('editColors') }),
      ),
    );
  }

  sync(key = null) {
    const { app } = this;
    const s = app.state;
    if (!key || key === 'tool' || key === 'shape' || key === 'brush' || key === 'selectMode') {
      for (const b of this.root.querySelectorAll('[data-tool]')) {
        const on = b.dataset.tool === s.tool;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      }
      for (const b of this.shapeGallery.children) b.classList.toggle('active', s.tool === 'shape' && b.dataset.shape === s.shape);
      const brush = BRUSHES.find((b) => b.id === s.brush);
      this.brushButton.innerHTML = icon(BRUSH_ICONS[s.brush] ?? 'brush', 24) + `<span>${brush?.name ?? 'Pincéis'}</span>`;
      this.root.querySelector('[data-tool="select"]').innerHTML = icon(s.selectMode === 'free' ? 'lasso' : 'selection', 24) + '<span>Seleção</span>';
      this.syncSubbar();
    }
    if (!key || key === 'outline' || key === 'fill') {
      this.outlineButton.innerHTML = `${icon('rectangle', 14)}<span>Contorno</span>${icon('chevron', 8)}`;
      this.fillButton.innerHTML = `${icon('bucket', 14)}<span>Preenchimento</span>${icon('chevron', 8)}`;
      this.outlineButton.title = `Contorno: ${STROKE_STYLES.find(([v]) => v === s.outline)?.[1]}`;
      this.fillButton.title = `Preenchimento: ${FILL_STYLES.find(([v]) => v === s.fill)?.[1]}`;
    }
    if (!key || key === 'tool' || key === 'sizes') this.sizeButton.querySelector('.size-value').textContent = `${app.size} px`;
    if (!key || key === 'opacity') {
      this.opacity.value = s.opacity;
      this.opacityOut.textContent = `${s.opacity}%`;
    }
    if (!key || key === 'primary' || key === 'secondary') {
      for (const [b, c, which] of [
        [this.color1, s.primary, 'primary'],
        [this.color2, s.secondary, 'secondary'],
      ]) {
        b.style.setProperty('--c', c);
        b.style.setProperty('--t', contrastText(c));
        b.classList.toggle('active', this.activeColor === which);
        b.dataset.label = which === 'primary' ? 'Cor 1' : 'Cor 2';
      }
    }
    if (key === 'custom') this.drawSwatches();
    if (!key || key === 'layersPanel') {
      this.layersButton.classList.toggle('active', s.layersPanel);
      this.layersButton.setAttribute('aria-pressed', String(s.layersPanel));
    }
  }

  syncSubbar() {
    const { app } = this;
    const s = app.state;
    const items = [el('strong', { class: 'tool-name' }, s.tool === 'brush' ? BRUSHES.find((b) => b.id === s.brush)?.name : s.tool === 'shape' ? SHAPES.find((x) => x.id === s.shape)?.name : TOOLS[s.tool]?.name)];
    const check = (label, key, title = '') => {
      const c = el('input', { type: 'checkbox', checked: s[key] });
      c.addEventListener('change', () => app.setState(key, c.checked));
      return el('label', { class: 'option', title }, c, el('span', {}, label));
    };
    const hint = (text) => el('span', { class: 'option-hint' }, text);
    if (s.tool === 'text') {
      const t = s.text;
      const font = el('select', { 'aria-label': 'Fonte' }, ['Segoe UI', 'Arial', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'].map((f) => el('option', { value: f, selected: f === t.font, style: { fontFamily: f } }, f)));
      font.addEventListener('change', () => app.setText({ font: font.value }));
      const size = el('select', { 'aria-label': 'Tamanho da fonte' }, [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72, 96, 144].map((n) => el('option', { value: n, selected: n === t.size }, String(n))));
      size.addEventListener('change', () => app.setText({ size: +size.value }));
      const toggle = (key, iconName, label) => {
        const b = el('button', { type: 'button', class: `icon-button${t[key] ? ' on' : ''}`, 'aria-pressed': String(t[key]), title: label, 'aria-label': label, html: icon(iconName, 16) });
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          app.setText({ [key]: !app.state.text[key] });
          this.syncSubbar();
        });
        return b;
      };
      const align = (value, iconName, label) => {
        const b = el('button', { type: 'button', class: `icon-button${t.align === value ? ' on' : ''}`, 'aria-pressed': String(t.align === value), title: label, 'aria-label': label, html: icon(iconName, 16) });
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          app.setText({ align: value });
          this.syncSubbar();
        });
        return b;
      };
      items.push(font, size, toggle('bold', 'bold', 'Negrito'), toggle('italic', 'italic', 'Itálico'), toggle('underline', 'underline', 'Sublinhado'), toggle('strike', 'strike', 'Tachado'), el('span', { class: 'separator' }), align('left', 'alignLeft', 'Alinhar à esquerda'), align('center', 'alignCenter', 'Centralizar'), align('right', 'alignRight', 'Alinhar à direita'), el('span', { class: 'separator' }), toggle('background', 'fillBackground', 'Preencher o fundo do texto com a Cor 2'), hint('Arraste para criar a caixa · clique fora para aplicar'));
    } else if (s.tool === 'fill') {
      const r = el('input', { type: 'range', min: 0, max: 100, value: s.fillTolerance, 'aria-label': 'Tolerância' });
      const o = el('output', { class: 'mono' }, `${s.fillTolerance}%`);
      r.addEventListener('input', () => {
        app.setState('fillTolerance', +r.value);
        o.textContent = `${r.value}%`;
      });
      items.push(el('label', { class: 'option' }, el('span', {}, 'Tolerância'), r, o), hint('Botão esquerdo: Cor 1 · direito: Cor 2'));
    } else if (s.tool === 'eraser') {
      const mode = el('select', { 'aria-label': 'A borracha deixa' }, [['transparent', 'Transparente'], ['secondary', 'A Cor 2']].map(([v, t]) => el('option', { value: v, selected: v === s.eraserMode }, t)));
      mode.addEventListener('change', () => app.setState('eraserMode', mode.value));
      items.push(el('label', { class: 'option' }, el('span', {}, 'Apaga para'), mode), hint('Botão direito troca só a Cor 1 pela Cor 2'));
    } else if (s.tool === 'select') {
      const mode = el('select', { 'aria-label': 'Forma da seleção' }, [['rect', 'Retangular'], ['free', 'Forma livre']].map(([v, t]) => el('option', { value: v, selected: v === s.selectMode }, t)));
      mode.addEventListener('change', () => app.setState('selectMode', mode.value));
      items.push(el('label', { class: 'option' }, el('span', {}, 'Forma'), mode), check('Seleção transparente', 'transparentSelection', 'A Cor 2 fica transparente ao mover ou colar'));
      if (app.selection) items.push(...this.selectionActions());
      else items.push(hint('Arraste para selecionar · Shift: quadrado · setas movem a seleção'));
    } else if (s.tool === 'objectSelect') {
      const sens = el('input', { type: 'range', min: 0, max: 100, value: s.objectSensitivity, 'aria-label': 'Sensibilidade' });
      sens.addEventListener('change', () => {
        app.setState('objectSensitivity', +sens.value);
        if (app.selection?.object) this.ctx.tools.runObjectSelection();
      });
      const holes = el('input', { type: 'checkbox', checked: s.objectHoles });
      holes.addEventListener('change', () => {
        app.setState('objectHoles', holes.checked);
        if (app.selection?.object) this.ctx.tools.runObjectSelection();
      });
      items.push(el('label', { class: 'option', title: 'Mais sensível separa melhor objetos de cor parecida com o fundo' }, el('span', {}, 'Sensibilidade'), sens), el('label', { class: 'option' }, holes, el('span', {}, 'Tirar o fundo de dentro do objeto')));
      if (app.selection) {
        items.push(
          el('span', { class: 'separator' }),
          el('button', { type: 'button', class: 'button primary small', onclick: () => this.run('keepObject') }, 'Manter só o objeto (fundo transparente)'),
          el('button', { type: 'button', class: 'button small', onclick: () => this.run('removeObject') }, 'Remover o objeto'),
          ...this.selectionActions(),
        );
      } else items.push(el('button', { type: 'button', class: 'button primary small', onclick: () => this.ctx.tools.runObjectSelection({ rect: null, point: null }) }, 'Detectar objeto principal'), hint('ou clique no objeto · o retângulo em volta dele é opcional'));
    } else if (s.tool === 'shape') {
      items.push(hint('Shift: proporção 1:1 · Alt: do centro · Enter aplica · Esc cancela · contorno usa a Cor 1 e o preenchimento a Cor 2'));
    } else if (s.tool === 'pencil') {
      items.push(hint('Botão esquerdo: Cor 1 · direito: Cor 2 · Shift: linha reta'));
    } else if (s.tool === 'brush') {
      items.push(hint('Botão esquerdo: Cor 1 · direito: Cor 2'));
    } else if (s.tool === 'picker') {
      items.push(hint('Esquerdo define a Cor 1 · direito define a Cor 2'));
    } else if (s.tool === 'magnifier') {
      items.push(hint('Clique para ampliar · botão direito para reduzir'));
    }
    this.subbar.replaceChildren(...items);
  }

  selectionActions() {
    const b = (label, id) => el('button', { type: 'button', class: 'button small', onclick: () => this.run(id) }, label);
    return [el('span', { class: 'separator' }), b('Cortar', 'crop'), b('Copiar', 'copy'), b('Recortar', 'cut'), b('Excluir', 'delete')];
  }
}
