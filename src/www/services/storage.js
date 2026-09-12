/**
 * Storage — Capacitor Preferences-backed adapter. Same interface and
 * pattern as the LSA_Life_Change_Backend Capacitor port's storage.js.
 */

import { Preferences } from '@capacitor/preferences';

export class CapacitorStorageAdapter {
  async get(key) {
    const { value } = await Preferences.get({ key });
    return value; // null if not present
  }

  async set(key, value) {
    await Preferences.set({ key, value });
  }

  async remove(key) {
    await Preferences.remove({ key });
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
