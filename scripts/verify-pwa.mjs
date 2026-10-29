// Verificación de la PWA en un navegador real (Edge o Chrome, sin ventana) sobre `vite preview`.
// Uso: npm run build && node scripts/verify-pwa.mjs
// No añade dependencias: usa el protocolo de depuración (CDP) por WebSocket (Node >= 22).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PORT = 4173;
const CDP_PORT = 9333;
const ORIGIN = `http://localhost:${PORT}`;
const BROWSERS = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK    " : "FALLO "} ${name}${detail ? " — " + detail : ""}`);
};

async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* se reintenta */ }
    if (Date.now() > end) throw new Error("Tiempo agotado esperando: " + what);
    await sleep(200);
  }
}

const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) {
  console.error("No se encontró Edge ni Chrome. Indica la ruta con BROWSER_PATH.");
  process.exit(2);
}

let preview = null;
let browser = null;
const profile = mkdtempSync(join(tmpdir(), "mipiano-pwa-"));
const stopPreview = () => {
  preview?.kill();
  preview = null;
};

try {
  preview = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  await waitFor(() => fetch(ORIGIN + "/").then((r) => r.ok), "servidor de vista previa");

  browser = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  await waitFor(() => fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok), "navegador");
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === "page"), "pesta\u00f1a");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "error en evaluate");
    return r.result.value;
  };
  const navigate = async (url) => {
    events.length = 0;
    await send("Page.navigate", { url });
    await waitFor(() => events.some((e) => e.method === "Page.loadEventFired"), "carga de " + url);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  // ---- 1. Primera visita con conexi\u00f3n ----
  await navigate(ORIGIN + "/");
  check("Contexto seguro (localhost)", await evaluate("window.isSecureContext"));
  await waitFor(() => evaluate("navigator.serviceWorker.getRegistration().then(r => !!r && !!r.active)"), "service worker activo");
  check("Service worker registrado y activo", true, await evaluate("navigator.serviceWorker.getRegistration().then(r => r.scope + ' ' + r.active.scriptURL)"));

  await navigate(ORIGIN + "/"); // recarga: ya controlada por el service worker
  await waitFor(() => evaluate("!!navigator.serviceWorker.controller"), "p\u00e1gina controlada");
  check("La p\u00e1gina est\u00e1 controlada por el service worker tras recargar", true);

  const cacheInfo = () => evaluate("(async()=>{const o={};for(const k of await caches.keys()){o[k]=(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)}return o})()");
  const c1 = await cacheInfo();
  const appKey = Object.keys(c1).find((k) => k.startsWith("mipiano-app-"));
  check("Cach\u00e9 de la aplicaci\u00f3n creada", !!appKey, appKey ?? "");
  const appFiles = c1[appKey] ?? [];
  check("Precach\u00e9: index, JS, CSS, manifiesto e iconos", ["/", "/manifest.webmanifest", "/icons/icon-192.png"].every((p) => appFiles.includes(p)) && appFiles.some((p) => p.endsWith(".js")) && appFiles.some((p) => p.endsWith(".css")), appFiles.length + " archivos");
  check("La primera visita NO descarga las muestras de piano", !(c1["mipiano-samples-v1"]?.length), JSON.stringify(Object.fromEntries(Object.entries(c1).map(([k, v]) => [k, v.length]))));

  const manifest = await send("Page.getAppManifest");
  check("Manifiesto sin errores", (manifest.errors ?? []).length === 0, manifest.url + (manifest.errors?.length ? " " + JSON.stringify(manifest.errors) : ""));
  const inst = await send("Page.getInstallabilityErrors");
  check("El navegador no reporta errores de instalabilidad", (inst.installabilityErrors ?? []).length === 0, JSON.stringify(inst.installabilityErrors ?? []));

  // Muestra bajo demanda
  const sampleOnline = await evaluate("fetch('/samples/salamander/C4.mp3').then(async r => r.status + ':' + (await r.arrayBuffer()).byteLength)");
  check("Una muestra se descarga bajo demanda", sampleOnline.startsWith("200:"), sampleOnline);
  const c2 = await cacheInfo();
  check("...y queda guardada (solo esa)", JSON.stringify(c2["mipiano-samples-v1"]) === JSON.stringify(["/samples/salamander/C4.mp3"]), JSON.stringify(c2["mipiano-samples-v1"]));

  // ---- 2. Sin conexi\u00f3n: se apaga el servidor ----
  stopPreview();
  await waitFor(() => fetch(ORIGIN + "/").then(() => false, () => true), "servidor apagado");
  check("Servidor apagado (sin red hacia la aplicaci\u00f3n)", true);

  await navigate(ORIGIN + "/");
  const offline = await evaluate("({title: document.title, play: !!document.getElementById('play'), stage: !!document.getElementById('stage'), css: getComputedStyle(document.body).backgroundColor})");
  check("Sin conexi\u00f3n: la p\u00e1gina carga desde la cach\u00e9", offline.title === "Pr\u00e1ctica de piano" && offline.play && offline.stage, JSON.stringify(offline));
  check("Sin conexi\u00f3n: el CSS se aplic\u00f3", offline.css !== "rgba(0, 0, 0, 0)" && offline.css !== "rgb(255, 255, 255)", offline.css);

  await evaluate("document.getElementById('demo').click()");
  const song = await evaluate("document.getElementById('songInfo').textContent");
  check("Sin conexi\u00f3n: el JavaScript funciona (cargar la canci\u00f3n de prueba)", /pistas?/.test(song), song);

  await evaluate("location.hash = '#ayuda'");
  check("Sin conexi\u00f3n: la ayuda se abre", (await evaluate("!document.getElementById('help').hidden")) === true);

  const sampleOffline = await evaluate("fetch('/samples/salamander/C4.mp3').then(async r => r.status + ':' + (await r.arrayBuffer()).byteLength)");
  check("Sin conexi\u00f3n: la muestra ya usada sigue disponible", sampleOffline === sampleOnline, sampleOffline);
  const notCached = await evaluate("fetch('/samples/salamander/A0.mp3').then(r => 'respuesta ' + r.status, e => 'error de red')");
  check("Sin conexi\u00f3n: una muestra nunca usada NO est\u00e1 (el piano usar\u00e1 el sonido b\u00e1sico)", notCached === "error de red", notCached);

  const errors = events.filter((e) => (e.method === "Runtime.exceptionThrown") || (e.method === "Log.entryAdded" && e.params.entry.level === "error" && !/Failed to load resource|ERR_CONNECTION/.test(e.params.entry.text)));
  check("Sin excepciones de JavaScript en la p\u00e1gina sin conexi\u00f3n", errors.length === 0, errors.map((e) => JSON.stringify(e.params).slice(0, 200)).join(" | "));

  ws.close();
} catch (err) {
  check("Ejecuci\u00f3n de la verificaci\u00f3n", false, String(err?.message ?? err));
} finally {
  stopPreview();
  browser?.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* el navegador puede tardar en soltar el perfil */ }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas (${browserPath})`);
process.exit(failed === 0 ? 0 : 1);
