import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { buildServiceWorker, isPrecached, precachePath, versionOf } from "../pwa/buildSw";
import type { PrecacheFile } from "../pwa/buildSw";
import { registerServiceWorker } from "../src/pwa";
import type { PwaEnv } from "../src/pwa";

const ROOT = join(import.meta.dirname, "..");
const TEMPLATE = readFileSync(join(ROOT, "pwa", "sw.template.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8")) as Record<string, any>;
const html = readFileSync(join(ROOT, "index.html"), "utf8");

describe("manifiesto", () => {
  it("tiene los campos necesarios para instalarse", () => {
    for (const k of ["name", "short_name", "start_url", "scope", "display", "background_color", "theme_color", "icons"]) {
      assert.ok(manifest[k], `falta ${k}`);
    }
    assert.equal(manifest.display, "standalone");
    assert.ok(manifest.short_name.length <= 12, "el nombre corto debe caber bajo el icono");
  });

  it("start_url, scope e id son relativos (valen con cualquier base de Vite)", () => {
    for (const k of ["start_url", "scope", "id"]) assert.ok(!String(manifest[k]).startsWith("/"), `${k} es absoluto`);
    for (const icon of manifest.icons) assert.ok(!icon.src.startsWith("/"), `${icon.src} es absoluto`);
  });

  it("los colores coinciden con la interfaz y con <meta theme-color>", () => {
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    assert.ok(html.includes(`<meta name="theme-color" content="${manifest.theme_color}"`));
  });

  it("incluye iconos de 192 y 512, y uno enmascarable de 512", () => {
    const has = (sizes: string, purpose: string) =>
      manifest.icons.some((i: any) => i.sizes === sizes && i.purpose === purpose && i.type === "image/png");
    assert.ok(has("192x192", "any"));
    assert.ok(has("512x512", "any"));
    assert.ok(has("512x512", "maskable"));
  });

  it("cada icono PNG existe y mide exactamente lo declarado", () => {
    for (const icon of manifest.icons as any[]) {
      const file = join(ROOT, "public", icon.src);
      assert.ok(existsSync(file), `falta ${icon.src}`);
      if (icon.type !== "image/png") continue;
      const buf = readFileSync(file);
      assert.equal(buf.subarray(1, 4).toString(), "PNG");
      const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
      assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    }
    assert.ok(existsSync(join(ROOT, "public", "icons", "apple-touch-icon.png")));
  });

  it("index.html enlaza manifiesto e iconos que existen", () => {
    assert.ok(html.includes('rel="manifest" href="/manifest.webmanifest"'));
    for (const href of [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="\/([^"]+)"/g)].map((m) => m[1]!)) {
      assert.ok(existsSync(join(ROOT, "public", href)), `index.html enlaza ${href}, que no existe`);
    }
  });
});

describe("generador del service worker", () => {
  const files: PrecacheFile[] = [
    { path: "index.html", content: "<html>" },
    { path: "assets/index-abc.js", content: "js" },
    { path: "assets/index-def.css", content: "css" },
    { path: "manifest.webmanifest", content: "{}" },
  ];

  it("sustituye versi\u00f3n y lista, y la lista usa './' para index.html", () => {
    const out = buildServiceWorker(TEMPLATE, files);
    assert.ok(!out.includes("__VERSION__") && !out.includes("__PRECACHE__"));
    assert.ok(out.includes('"./"'));
    assert.ok(out.includes('"assets/index-abc.js"'));
    assert.ok(!out.includes('"index.html"'));
    assert.doesNotThrow(() => new vm.Script(out), "el resultado es JavaScript v\u00e1lido");
  });

  it("la versi\u00f3n cambia si cambia el contenido o el nombre de un archivo, y no si es igual", () => {
    const v = versionOf(files);
    assert.equal(versionOf([...files].reverse()), v, "no depende del orden");
    assert.notEqual(versionOf(files.map((f) => (f.path === "assets/index-abc.js" ? { ...f, content: "js2" } : f))), v);
    assert.notEqual(versionOf(files.map((f) => (f.path === "assets/index-abc.js" ? { ...f, path: "assets/index-zzz.js" } : f))), v);
  });

  it("rechaza una plantilla sin marcadores", () => {
    assert.throws(() => buildServiceWorker("sin marcadores", files));
  });

  it("solo precachea la aplicaci\u00f3n: las muestras de piano y sw.js quedan fuera", () => {
    assert.equal(isPrecached("index.html"), true);
    assert.equal(isPrecached("assets/x.js"), true);
    assert.equal(isPrecached("icons/icon-192.png"), true);
    assert.equal(isPrecached("manifest.webmanifest"), true);
    assert.equal(isPrecached("samples/salamander/A0.mp3"), false);
    assert.equal(isPrecached("sw.js"), false);
    assert.equal(precachePath("index.html"), "./");
  });
});

// ---- Ejecuci\u00f3n del service worker en un entorno simulado ----

interface FakeResponse { ok: boolean; status: number; url: string; clone(): FakeResponse; tag?: string }
const res = (status = 200, tag = "net"): FakeResponse => ({ ok: status >= 200 && status < 300, status, url: "", tag, clone() { return this; } });

function makeCaches() {
  const store = new Map<string, Map<string, FakeResponse>>();
  const key = (r: any, ignoreSearch?: boolean) => {
    const u = new URL(typeof r === "string" ? r : r.url);
    if (ignoreSearch) u.search = "";
    return u.href;
  };
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      put: async (r: any, v: FakeResponse) => void m.set(key(r), v),
      match: async (r: any, o?: { ignoreSearch?: boolean }) => {
        for (const [k, v] of m) if (key(k, o?.ignoreSearch) === key(r, o?.ignoreSearch)) return v;
        return undefined;
      },
    };
  };
  return {
    store,
    open,
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    match: async (r: any, o?: { ignoreSearch?: boolean }) => {
      for (const name of store.keys()) {
        const hit = await (await open(name)).match(r, o);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

function loadSw(opts: { scope?: string; files?: PrecacheFile[]; network?: (url: string) => Promise<FakeResponse>; instantTimers?: boolean } = {}) {
  const scope = opts.scope ?? "https://app.test/";
  const files = opts.files ?? [
    { path: "index.html", content: "<html>" },
    { path: "assets/index-1.js", content: "js" },
    { path: "icons/icon-192.png", content: "png" },
  ];
  const origin = new URL(scope).origin;
  const code = buildServiceWorker(TEMPLATE, files);
  const caches = makeCaches();
  const listeners = new Map<string, (e: any) => void>();
  const log = { fetched: [] as string[], skipWaiting: 0, claimed: 0, fetchOptions: [] as unknown[] };
  const network = opts.network ?? (async () => res());
  const self = {
    registration: { scope },
    location: { origin },
    clients: { claim: async () => void log.claimed++ },
    skipWaiting: async () => void log.skipWaiting++,
    addEventListener: (t: string, fn: (e: any) => void) => void listeners.set(t, fn),
  };
  const fetch = async (r: any, o?: unknown) => {
    const url = typeof r === "string" ? r : r.url;
    log.fetched.push(url);
    log.fetchOptions.push(o);
    return network(url);
  };
  const sandbox: Record<string, unknown> = {
    self, caches, fetch, URL, Set, Promise, Error, console,
    setTimeout: opts.instantTimers ? (fn: () => void) => (setImmediate(fn), 1) : setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(code, sandbox);
  const lifecycle = async (type: "install" | "activate") => {
    let p: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
  };
  /** Devuelve la promesa de respondWith, o undefined si el service worker NO interceptó la petici\u00f3n. */
  const request = (url: string, extra: { method?: string; mode?: string } = {}): Promise<FakeResponse> | undefined => {
    let out: Promise<FakeResponse> | undefined;
    listeners.get("fetch")!({ request: { url, method: extra.method ?? "GET", mode: extra.mode ?? "no-cors" }, respondWith: (p: Promise<FakeResponse>) => (out = p) });
    return out;
  };
  const appCacheName = [...caches.store.keys()][0];
  return { caches, log, lifecycle, request, scope, appCacheName, version: versionOf(files) };
}

describe("service worker: instalaci\u00f3n y actualizaci\u00f3n", () => {
  it("al instalar guarda todos los archivos de la app en una cach\u00e9 con la versi\u00f3n, sin usar la cach\u00e9 HTTP", async () => {
    const sw = loadSw();
    await sw.lifecycle("install");
    const name = `mipiano-app-${sw.version}`;
    assert.deepEqual([...sw.caches.store.keys()], [name]);
    assert.deepEqual([...sw.caches.store.get(name)!.keys()].sort(), [
      "https://app.test/",
      "https://app.test/assets/index-1.js",
      "https://app.test/icons/icon-192.png",
    ]);
    assert.ok(sw.log.fetchOptions.every((o) => (o as any).cache === "reload"));
    assert.equal(sw.log.skipWaiting, 1);
  });

  it("si un archivo no se puede descargar, la instalaci\u00f3n falla y no se activa la versi\u00f3n a medias", async () => {
    const sw = loadSw({ network: async (u) => (u.endsWith(".js") ? res(404) : res()) });
    await assert.rejects(sw.lifecycle("install"));
    assert.equal(sw.log.skipWaiting, 0);
  });

  it("al activarse borra las cach\u00e9s de versiones antiguas, conserva las muestras y reclama las pesta\u00f1as", async () => {
    const sw = loadSw();
    await sw.caches.open("mipiano-app-viejo");
    await sw.caches.open("mipiano-samples-v1");
    await sw.caches.open("otra-app");
    await sw.lifecycle("install");
    await sw.lifecycle("activate");
    const names = [...sw.caches.store.keys()].sort();
    assert.deepEqual(names, ["mipiano-app-" + sw.version, "mipiano-samples-v1", "otra-app"].sort());
    assert.equal(sw.log.claimed, 1);
  });

  it("funciona bajo una subcarpeta (base de Vite distinta de '/')", async () => {
    const sw = loadSw({ scope: "https://user.github.io/mi-piano/" });
    await sw.lifecycle("install");
    const keys = [...sw.caches.store.get(`mipiano-app-${sw.version}`)!.keys()];
    assert.ok(keys.includes("https://user.github.io/mi-piano/"));
    assert.ok(keys.includes("https://user.github.io/mi-piano/assets/index-1.js"));
    // las muestras de esa base tambi\u00e9n se reconocen
    assert.ok(sw.request("https://user.github.io/mi-piano/samples/salamander/C4.mp3"));
    assert.equal(sw.request("https://user.github.io/otra/samples/salamander/C4.mp3"), undefined);
  });
});

describe("service worker: peticiones", () => {
  it("navegaci\u00f3n con conexi\u00f3n: usa la red (siempre la versi\u00f3n m\u00e1s nueva)", async () => {
    const sw = loadSw({ network: async () => res(200, "red") });
    await sw.lifecycle("install");
    const r = await sw.request("https://app.test/", { mode: "navigate" })!;
    assert.equal(r.tag, "red");
  });

  it("navegaci\u00f3n sin conexi\u00f3n: sirve la p\u00e1gina guardada, tambi\u00e9n con #ayuda o ?par\u00e1metros", async () => {
    let online = true;
    const sw = loadSw({
      network: async () => {
        if (!online) throw new TypeError("sin red");
        return res(200, "guardada");
      },
    });
    await sw.lifecycle("install");
    online = false;
    const r = await sw.request("https://app.test/?utm=1", { mode: "navigate" })!;
    assert.equal(r.tag, "guardada");
  });

  it("navegaci\u00f3n que tarda demasiado: recurre a la p\u00e1gina guardada", async () => {
    let hang = false;
    const sw = loadSw({
      instantTimers: true,
      network: () => (hang ? new Promise<FakeResponse>(() => undefined) : Promise.resolve(res(200, "guardada"))),
    });
    await sw.lifecycle("install");
    hang = true;
    assert.equal((await sw.request("https://app.test/", { mode: "navigate" })!).tag, "guardada");
  });

  it("navegaci\u00f3n sin conexi\u00f3n y sin nada guardado: falla (no inventa respuesta)", async () => {
    const sw = loadSw({ network: async () => { throw new TypeError("sin red"); } });
    await assert.rejects(sw.request("https://app.test/", { mode: "navigate" })!);
  });

  it("archivos de la app: se sirven de la cach\u00e9 sin tocar la red", async () => {
    const sw = loadSw();
    await sw.lifecycle("install");
    const before = sw.log.fetched.length;
    const r = await sw.request("https://app.test/assets/index-1.js")!;
    assert.ok(r.ok);
    assert.equal(sw.log.fetched.length, before);
  });

  it("muestras de piano: se descargan al usarlas, se guardan, y despu\u00e9s funcionan sin conexi\u00f3n", async () => {
    let online = true;
    const sw = loadSw({ network: async () => { if (!online) throw new TypeError("sin red"); return res(200, "mp3"); } });
    await sw.lifecycle("install");
    const url = "https://app.test/samples/salamander/C4.mp3";
    assert.equal(sw.caches.store.get("mipiano-samples-v1")?.size ?? 0, 0, "la instalaci\u00f3n NO descarga muestras");
    assert.ok(!sw.log.fetched.some((u) => u.includes("/samples/")));
    await sw.request(url)!;
    assert.equal(sw.caches.store.get("mipiano-samples-v1")!.size, 1);
    online = false;
    assert.equal((await sw.request(url)!).tag, "mp3");
    await assert.rejects(sw.request("https://app.test/samples/salamander/A0.mp3")!, "una muestra no guardada falla sin red");
  });

  it("no guarda respuestas parciales (206) ni errores en la cach\u00e9 de muestras", async () => {
    const status = new Map([["A0", 206], ["A1", 404], ["A2", 200]]);
    const sw = loadSw({ network: async (u) => res(status.get(u.split("/").pop()!.replace(".mp3", "")) ?? 200) });
    await sw.lifecycle("install");
    for (const n of ["A0", "A1", "A2"]) await sw.request(`https://app.test/samples/salamander/${n}.mp3`)!;
    assert.deepEqual([...sw.caches.store.get("mipiano-samples-v1")!.keys()], ["https://app.test/samples/salamander/A2.mp3"]);
  });

  it("no intercepta POST, otros or\u00edgenes, ni rutas desconocidas (incluido sw.js)", async () => {
    const sw = loadSw();
    await sw.lifecycle("install");
    assert.equal(sw.request("https://app.test/assets/index-1.js", { method: "POST" }), undefined);
    assert.equal(sw.request("https://cdn.otro.test/assets/index-1.js"), undefined);
    assert.equal(sw.request("https://app.test/api/datos"), undefined);
    assert.equal(sw.request("https://app.test/sw.js"), undefined);
  });
});

// ---- Registro ----

function fakeEnv(opts: { secure?: boolean; controller?: boolean; fail?: boolean } = {}) {
  const regListeners = new Map<string, () => void>();
  const installing = { state: "installing", listeners: new Map<string, () => void>(), addEventListener(t: string, f: () => void) { this.listeners.set(t, f); } };
  const reg = { installing, addEventListener: (t: string, f: () => void) => void regListeners.set(t, f) };
  const registered: string[] = [];
  const env: PwaEnv = {
    isSecureContext: opts.secure ?? true,
    serviceWorker: {
      controller: opts.controller ? {} : null,
      register: async (url: string) => {
        if (opts.fail) throw new Error("fallo");
        registered.push(url);
        return reg;
      },
    } as unknown as ServiceWorkerContainer,
  };
  const finishInstall = () => {
    regListeners.get("updatefound")!();
    installing.state = "installed";
    installing.listeners.get("statechange")!();
  };
  return { env, registered, finishInstall };
}

describe("registro del service worker", () => {
  it("registra la URL indicada en un contexto seguro", async () => {
    const f = fakeEnv();
    assert.equal(await registerServiceWorker({ swUrl: "/app/sw.js" }, f.env), true);
    assert.deepEqual(f.registered, ["/app/sw.js"]);
  });

  it("en un contexto no seguro o sin soporte no hace nada y no falla", async () => {
    const f = fakeEnv({ secure: false });
    assert.equal(await registerServiceWorker({ swUrl: "/sw.js" }, f.env), false);
    assert.deepEqual(f.registered, []);
    assert.equal(await registerServiceWorker({ swUrl: "/sw.js" }, { isSecureContext: true, serviceWorker: undefined }), false);
  });

  it("si el registro falla, no lanza error", async () => {
    const f = fakeEnv({ fail: true });
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      assert.equal(await registerServiceWorker({ swUrl: "/sw.js" }, f.env), false);
    } finally {
      console.warn = warn;
    }
  });

  it("primera instalaci\u00f3n: avisa 'lista sin conexi\u00f3n'; con una versi\u00f3n previa: avisa 'actualizaci\u00f3n'", async () => {
    const events: string[] = [];
    const first = fakeEnv({ controller: false });
    await registerServiceWorker({ swUrl: "/sw.js", onOfflineReady: () => events.push("offline"), onUpdateReady: () => events.push("update") }, first.env);
    first.finishInstall();
    const upgrade = fakeEnv({ controller: true });
    await registerServiceWorker({ swUrl: "/sw.js", onOfflineReady: () => events.push("offline"), onUpdateReady: () => events.push("update") }, upgrade.env);
    upgrade.finishInstall();
    assert.deepEqual(events, ["offline", "update"]);
  });
});
