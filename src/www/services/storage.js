/**
 * Storage — Capacitor Preferences-backed adapter. Same interface and
 * pattern as the LSA_Life_Change_Backend Capacitor port's storage.js.
 *
 * BUG FIX: this originally did `import { Preferences } from
 * '@capacitor/preferences'`. That is a bare module specifier — it
 * only resolves inside a bundler (Vite/webpack/Rollup) that rewrites
 * it to a real path. This project deliberately has NO bundler (see
 * README), so in the actual WebView this threw
 * `TypeError: Failed to resolve module specifier "@capacitor/preferences"`
 * at parse time, which aborts the entire <script type="module"> block
 * — meaning Brain1 never loaded at all and Send silently did nothing.
 * This is a well-documented Capacitor pitfall for exactly this
 * no-bundler setup (Capacitor's own `bundledWebRuntime` escape hatch
 * was deprecated in v6). Verified only in Node during the original
 * build, where bare specifiers resolve fine via node_modules — that
 * masked the bug completely; Node's module resolution has nothing to
 * do with what a browser can resolve.
 *
 * Fix: reference the native bridge's own global object instead of
 * importing anything. Capacitor's native-bridge.js (auto-injected by
 * the Android WebView host, listed in capacitor.plugins.json) attaches
 * every registered plugin to `window.Capacitor.Plugins.<PluginName>` —
 * no import statement needed at all.
 */

function getPreferencesPlugin() {
  const plugin = globalThis.Capacitor && globalThis.Capacitor.Plugins && globalThis.Capacitor.Plugins.Preferences;
  if (!plugin) {
    throw new Error(
      'Capacitor Preferences plugin not available (window.Capacitor.Plugins.Preferences is missing). ' +
      'This is expected when running outside the native app (e.g. a desktop browser preview) — ' +
      'use InMemoryStorageAdapter there instead.'
    );
  }
  return plugin;
}

export class CapacitorStorageAdapter {
  async get(key) {
    const { value } = await getPreferencesPlugin().get({ key });
    return value; // null if not present
  }

  async set(key, value) {
    await getPreferencesPlugin().set({ key, value });
  }

  async remove(key) {
    await getPreferencesPlugin().remove({ key });
  }
}

/** Minimal in-memory adapter — used for testing without a device. */
export class InMemoryStorageAdapter {
  constructor() {
    this._store = new Map();
  }
  async get(key) {
    return this._store.has(key) ? this._store.get(key) : null;
  }
  async set(key, value) {
    this._store.set(key, value);
  }
  async remove(key) {
    this._store.delete(key);
  }
}

export const storageAdapter = new CapacitorStorageAdapter();
