import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin } from "vite";
import { buildServiceWorker, isPrecached } from "./buildSw.ts";
import type { PrecacheFile } from "./buildSw.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Escribe `sw.js` en la carpeta de salida cuando termina el build, con la lista de archivos
 * precacheados y una versión derivada de su contenido. No añade dependencias.
 */
export function serviceWorkerPlugin(templatePath: string): Plugin {
  return {
    name: "mi-piano-service-worker",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir;
      if (!outDir) return;
      const files: PrecacheFile[] = walk(outDir)
        .map((full) => relative(outDir, full).split("\\").join("/"))
        .filter(isPrecached)
        .map((path) => ({ path, content: readFileSync(join(outDir, path)) }));
      if (!files.some((f) => f.path === "index.html")) throw new Error("No se encontró index.html en la salida");
      writeFileSync(join(outDir, "sw.js"), buildServiceWorker(readFileSync(templatePath, "utf8"), files));
    },
  };
}
