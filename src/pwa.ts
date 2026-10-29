export interface PwaOptions {
  /** Ruta del service worker relativa a la base de la aplicación. */
  swUrl: string;
  /** Hay una versión nueva instalada: se usará al recargar. */
  onUpdateReady?: () => void;
  /** La aplicación ya se puede usar sin conexión (primera instalación). */
  onOfflineReady?: () => void;
}

/** Entorno inyectable para pruebas. */
export interface PwaEnv {
  isSecureContext: boolean;
  serviceWorker: ServiceWorkerContainer | undefined;
}

/**
 * Registra el service worker. Solo en contextos seguros (HTTPS o localhost): en otros no existe la API
 * o está bloqueada, y la aplicación sigue funcionando sin caché. Nunca recarga la página por su cuenta,
 * para no interrumpir una práctica en curso. Devuelve true si se intentó registrar.
 */
export async function registerServiceWorker(
  opts: PwaOptions,
  env: PwaEnv = {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    serviceWorker: typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
  },
): Promise<boolean> {
  if (!env.serviceWorker || !env.isSecureContext) return false;
  const sw = env.serviceWorker;
  // Había un service worker controlando la página antes de registrar: lo que se instale después es una actualización.
  const hadController = sw.controller !== null;
  try {
    const reg = await sw.register(opts.swUrl);
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state !== "installed") return;
        if (hadController) opts.onUpdateReady?.();
        else opts.onOfflineReady?.();
      });
    });
    return true;
  } catch (err) {
    console.warn("No se pudo registrar el service worker:", err);
    return false;
  }
}
