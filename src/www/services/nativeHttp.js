/**
 * Native HTTP bridge — direct calls to Capacitor's native bridge
 * instead of `import { CapacitorHttp } from '@capacitor/core'`.
 *
 * BUG FIX: the original webSearch.js/learnFilter.js imported
 * CapacitorHttp as a bare module specifier from '@capacitor/core'.
 * That only resolves inside a bundler (Vite/webpack/Rollup); this
 * project deliberately has none (see README), so in the real WebView
 * this threw `TypeError: Failed to resolve module specifier
 * "@capacitor/core"` at parse time, which aborted the entire
 * <script type="module"> block — Brain1 never loaded, and Send did
 * nothing. Confirmed against the actual native-bridge.js shipped
 * inside the built APK: `window.Capacitor` is the real global object
 * the native bridge attaches; low-level plugin calls go through
 * `Capacitor.nativePromise(pluginName, methodName, options)`, which
 * is exactly what @capacitor/core's own CapacitorHttp helper calls
 * internally. Calling it directly here avoids needing the npm
 * package or a bundler at all.
 */

function bridge() {
  const cap = globalThis.Capacitor;
  if (!cap || typeof cap.nativePromise !== 'function') {
    throw new Error(
      'Capacitor native bridge not available (window.Capacitor.nativePromise is missing). ' +
      'This is expected when running outside the native app.'
    );
  }
  return cap;
}

/**
 * @param {{url: string, headers?: object, connectTimeout?: number, readTimeout?: number, params?: object}} options
 * @returns {Promise<{status: number, data: any, headers: object}>}
 */
export async function nativeHttpGet(options) {
  return bridge().nativePromise('CapacitorHttp', 'request', {
    method: 'GET',
    ...options,
  });
}

export async function nativeHttpPost(options) {
  return bridge().nativePromise('CapacitorHttp', 'request', {
    method: 'POST',
    ...options,
  });
}
