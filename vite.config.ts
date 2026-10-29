import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { serviceWorkerPlugin } from "./pwa/swPlugin.ts";

// `base` se deja en su valor por defecto ("/"). Para desplegar en una subcarpeta (p. ej. GitHub Pages),
// compila con `vite build --base=/mi-carpeta/`: el manifiesto, el service worker y las muestras usan
// rutas relativas o BASE_URL, así que no hay que tocar nada más.
export default defineConfig({
  plugins: [serviceWorkerPlugin(fileURLToPath(new URL("./pwa/sw.template.js", import.meta.url)))],
});
