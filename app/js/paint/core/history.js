export class History {
  constructor({ maxBytes = 320 * 1024 * 1024, maxEntries = 200 } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.past = [];
    this.future = [];
    this.bytes = 0;
    this.version = 0;
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  push(entry) {
    if (!entry || typeof entry.undo !== 'function' || typeof entry.redo !== 'function') throw new Error('Entrada de histórico inválida.');
    const bytes = Math.max(0, entry.bytes || 0);
    for (const f of this.future) this.bytes -= f.bytes || 0;
    this.future = [];
    this.past.push({ ...entry, bytes });
    this.bytes += bytes;
    this.version++;
    while (this.past.length > 1 && (this.bytes > this.maxBytes || this.past.length > this.maxEntries)) {
      const dropped = this.past.shift();
      this.bytes -= dropped.bytes || 0;
    }
    this.emit();
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get nextUndo() {
    return this.past.at(-1)?.label ?? '';
  }

  get nextRedo() {
    return this.future.at(-1)?.label ?? '';
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return false;
    entry.undo();
    this.future.push(entry);
    this.version++;
    this.emit();
    return true;
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return false;
    entry.redo();
    this.past.push(entry);
    this.version++;
    this.emit();
    return true;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.bytes = 0;
    this.version++;
    this.emit();
  }
}
