// UBO-22: the UBO screens' working copy of a case - research, charts, answers,
// people's names - lives in this page's memory, never in the browser's storage
// (invariant 5). The server holds the case; a reload rebuilds this copy from
// it (DurablePocCaseBoundary), found by the case id in the address.
//
// It keeps the browser Storage interface, so the screens that used
// localStorage and sessionStorage use this unchanged.

class MemoryStorage {
  constructor() { this.items = new Map(); }
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.has(String(key)) ? this.items.get(String(key)) : null; }
  setItem(key, value) { this.items.set(String(key), String(value)); }
  removeItem(key) { this.items.delete(String(key)); }
  clear() { this.items.clear(); }
}

export const uboStore = new MemoryStorage();

// The one thing kept in the browser: which case this tab is on - a random id,
// nothing about the company or its people - so a full page load between steps
// finds the case again. Per tab, and gone when the tab closes.
export const casePointerStore = {
  getItem(key) { try { return window.sessionStorage.getItem(key); } catch (_) { return null; } },
  setItem(key, value) { try { window.sessionStorage.setItem(key, value); } catch (_) { /* The address still carries it. */ } },
  removeItem(key) { try { window.sessionStorage.removeItem(key); } catch (_) { /* Nothing to remove. */ } },
};

// What earlier versions left in the browser, names included.
const LEGACY_PREFIXES = ["ubo-demo.", "ubo-control-demo.", "ubo-control-lab."];

/** Removes what earlier versions of these screens saved in the browser. */
export function forgetLegacyBrowserCopies(stores = [window.localStorage, window.sessionStorage]) {
  for (const storage of stores) {
    try {
      const stale = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) stale.push(key);
      }
      stale.forEach((key) => storage.removeItem(key));
    } catch (_) { /* Storage blocked: nothing was saved there either. */ }
  }
}
