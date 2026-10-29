import { createHash } from "node:crypto";

export interface PrecacheFile {
  /** Ruta relativa a la carpeta de salida, con "/" ("index.html", "assets/index-abc.js"). */
  path: string;
  content: Uint8Array | string;
}

/** Ruta que se guarda en la lista de precaché: index.html se sirve como la raíz de la aplicación ("./"). */
export function precachePath(path: string): string {
  return path === "index.html" ? "./" : path;
}

/** Versión determinista: cambia si cambia el nombre o el contenido de cualquier archivo precacheado. */
export function versionOf(files: readonly PrecacheFile[]): string {
  const hash = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(f.path);
    hash.update("\0");
    hash.update(f.content);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/** Rellena la plantilla del service worker. Falla si queda algún marcador sin sustituir. */
export function buildServiceWorker(template: string, files: readonly PrecacheFile[]): string {
  if (!template.includes("__VERSION__") || !template.includes("__PRECACHE__")) {
    throw new Error("La plantilla del service worker no tiene los marcadores __VERSION__ y __PRECACHE__");
  }
  const paths = [...new Set(files.map((f) => precachePath(f.path)))].sort();
  const out = template
    .replaceAll("__VERSION__", versionOf(files))
    .replaceAll("__PRECACHE__", JSON.stringify(paths, null, 2));
  if (/__[A-Z]+__/.test(out.replace(/__proto__/g, ""))) throw new Error("Quedan marcadores sin sustituir");
  return out;
}

/** Qué archivos de la salida van al precaché: la aplicación, sus iconos y el manifiesto. Las muestras NO. */
export function isPrecached(path: string): boolean {
  return (
    path === "index.html" ||
    path === "manifest.webmanifest" ||
    path.startsWith("assets/") ||
    path.startsWith("icons/")
  );
}
