import { el } from '../../../pixel/js/ui/util.js';

let open = null;

export function closePopup() {
  if (!open) return;
  const { menu, button } = open;
  open = null;
  menu.remove();
  button?.setAttribute('aria-expanded', 'false');
}

document.addEventListener('pointerdown', (e) => {
  if (open && !open.menu.contains(e.target) && !open.button?.contains(e.target)) closePopup();
});

window.addEventListener('blur', closePopup);
window.addEventListener('resize', closePopup);

export function isPopupOpen() {
  return Boolean(open);
}

export function showPopup(button, build, { className = '', align = 'left', at = null } = {}) {
  const same = open?.button === button && button;
  closePopup();
  if (same) return null;
  const menu = el('div', { class: `menu popup ${className}`, role: 'menu' });
  build(menu, closePopup);
  document.body.append(menu);
  const r = at ?? button.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = align === 'right' ? r.right - width : r.left;
  let top = (r.bottom ?? r.top) + 4;
  left = Math.max(6, Math.min(left, window.innerWidth - width - 6));
  if (top + height > window.innerHeight - 6) top = Math.max(6, (r.top ?? top) - height - 4);
  Object.assign(menu.style, { left: `${left}px`, top: `${top}px` });
  button?.setAttribute('aria-expanded', 'true');
  open = { menu, button };
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.menu-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Escape') {
      closePopup();
      button?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  menu.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
  return menu;
}

export function menuItem({ label, shortcut = '', checked = null, disabled = false, icon = '', submenu = false, onclick }) {
  return el(
    'button',
    {
      type: 'button',
      class: `menu-item${submenu ? ' has-submenu' : ''}`,
      role: checked === null ? 'menuitem' : 'menuitemcheckbox',
      'aria-checked': checked === null ? null : String(checked),
      disabled,
      onclick: (e) => {
        if (!submenu) closePopup();
        onclick?.(e);
      },
    },
    el('span', { class: 'check', html: icon ? icon + (checked ? '<b class="dot"></b>' : '') : checked ? '✓' : '' }),
    el('span', {}, label),
    el('kbd', {}, submenu ? '›' : shortcut),
  );
}
