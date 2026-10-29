/* Service worker de Mi Piano. Plantilla: el plugin de Vite (pwa/swPlugin.ts) rellena la
 * versión y la lista de precaché (las dos constantes de abajo) al compilar. No se sirve tal cual.
 *
 * Todas las rutas son relativas al alcance (scope) del service worker, así que funciona
 * con cualquier `base` de Vite (raíz del dominio o subcarpeta) sin cambiar nada.
 *
 * Estrategias:
 *  - Aplicación (HTML, JS, CSS, iconos): se precachea al instalar, en una caché con la
 *    versión en el nombre. Al activarse una versión nueva se borran las cachés antiguas.
 *  - Navegación: red primero (siempre la versión más nueva si hay conexión) y, si falla o
 *    tarda, la página guardada.
 *  - Muestras de piano: bajo demanda. Se guardan al usarse por primera vez y después se
 *    sirven de la caché. Su caché no depende de la versión de la aplicación.
 *  - Todo lo demás (otros orígenes, peticiones que no son GET) no se toca.
 */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;

const APP_CACHE_PREFIX = "mipiano-app-";
const APP_CACHE = APP_CACHE_PREFIX + VERSION;
const SAMPLES_CACHE = "mipiano-samples-v1";
const SAMPLES_PATH = "samples/salamander/";
const NAVIGATION_TIMEOUT_MS = 4000;

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
const precacheUrls = () => new Set(PRECACHE.map(scopeUrl));

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      // Si cualquier archivo falla, la instalación falla y se mantiene la versión anterior.
      for (const path of PRECACHE) {
        const url = scopeUrl(path);
        const res = await fetch(url, { cache: "reload" });
        if (!res.ok) throw new Error("No se pudo guardar " + url + " (" + res.status + ")");
        await cache.put(url, res);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith(APP_CACHE_PREFIX) && n !== APP_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(navigate(req));
  } else if (url.href.startsWith(scopeUrl(SAMPLES_PATH))) {
    event.respondWith(cacheFirst(SAMPLES_CACHE, req));
  } else if (precacheUrls().has(url.origin + url.pathname)) {
    event.respondWith(cacheFirst(APP_CACHE, req));
  }
});

async function navigate(req) {
  try {
    return await withTimeout(fetch(req), NAVIGATION_TIMEOUT_MS);
  } catch (err) {
    const cached = await caches.match(scopeUrl("./"), { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  // Solo respuestas completas: una 206 (parcial) dejaría un archivo cortado en la caché.
  if (res.ok && res.status === 200) await cache.put(req, res.clone());
  return res;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tiempo agotado")), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}
