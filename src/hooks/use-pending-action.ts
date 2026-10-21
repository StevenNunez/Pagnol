import { useCallback, useRef, useState } from 'react';

/**
 * Guarda de doble envío para acciones async. El candado es un ref (síncrono): un
 * segundo clic en el mismo tick —antes de que React pinte `disabled`— ya no entra,
 * cosa que un `useState` solo no garantiza. `pending` sirve para deshabilitar el
 * botón y mostrar el spinner (`<Button loading={pending}>`).
 *
 * `run` devuelve `undefined` si la acción ya estaba en curso.
 *
 * `holdMs`: para acciones que terminan navegando a otra página. El `router.push`
 * resuelve antes de que la ruta cambie, y soltar el candado ahí deja una ventana
 * para un segundo clic; con `holdMs` el candado se mantiene ese tiempo tras un éxito
 * (si la acción falla se suelta de inmediato, para poder reintentar).
 */
export function usePendingAction() {
    const lock = useRef(false);
    const [pending, setPending] = useState(false);

    const run = useCallback(async <T,>(fn: () => Promise<T>, opts?: { holdMs?: number }): Promise<T | undefined> => {
        if (lock.current) return undefined;
        lock.current = true;
        setPending(true);
        let hold = false;
        try {
            const out = await fn();
            hold = !!opts?.holdMs;
            return out;
        } finally {
            const release = () => { lock.current = false; setPending(false); };
            if (hold) setTimeout(release, opts!.holdMs);
            else release();
        }
    }, []);

    return { run, pending };
}
