import { HIDDEN_RESYNC_AFTER_MS, requestResync } from "./data-health";

/**
 * Resincroniza los datos cuando el navegador pudo haberse perdido cambios:
 * volvió la señal, o la pestaña estuvo oculta un rato (el celular suspende el
 * WebSocket de Realtime sin avisar). Se instala una sola vez, sin sondeo
 * periódico: cada lectura cuesta egreso en el plan gratuito de Supabase.
 */
declare global {
    // eslint-disable-next-line no-var
    var __pagnolResyncInstalled: boolean | undefined;
}

if (typeof window !== "undefined" && !globalThis.__pagnolResyncInstalled) {
    globalThis.__pagnolResyncInstalled = true;
    let hiddenAt: number | null = null;

    window.addEventListener("online", () => { requestResync(); });
    window.addEventListener("pageshow", (e) => { if ((e as PageTransitionEvent).persisted) requestResync(); });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            hiddenAt = Date.now();
        } else if (hiddenAt != null && Date.now() - hiddenAt >= HIDDEN_RESYNC_AFTER_MS) {
            hiddenAt = null;
            requestResync();
        }
    });
}
