import { useEffect, useRef, useState } from "react";
import { supabase } from "@/modules/core/lib/supabase";
import { backoffFor, markFailed, markOk, setRealtime, useRetryTick } from "@/modules/core/lib/data-health";
import { loadAllPages, nextCollectionState, type FetchPage, type PageResult } from "@/modules/core/lib/collection-fetch";
import "@/modules/core/lib/data-resync";

interface Options<T> {
    tenantId?: string | null;
    orderBy?: { column: string; ascending?: boolean };
    mapper?: (item: any) => T;
    columns?: string;
    /**
     * Columnas a usar si la base responde 42703 (columna inexistente): sirve para
     * desplegar el código ANTES de aplicar una migración sin que la colección
     * entera quede vacía en silencio. Se avisa por consola; no oculta el drift.
     */
    fallbackColumns?: string;
    enabled?: boolean;
    version?: number;
    softDelete?: boolean;
}

/**
 * Array de la colección con la marca de si ya resolvió su PRIMER fetch.
 *
 * Es una propiedad adjunta al propio array (no enumerable, así que no aparece en
 * `JSON.stringify`, `Object.keys` ni en un spread) en vez de cambiar el retorno a
 * `{ data, hasLoaded }`: el hook tiene más de 40 llamadas y ese cambio de firma
 * las rompería todas de golpe. Los consumidores siguen usándolo como un array
 * normal; sólo quien necesita distinguir "cargando" de "vacío" lee la marca.
 */
export type LoadableArray<T> = T[] & { readonly hasLoaded: boolean };

function markLoaded<T>(arr: T[], loaded: boolean): LoadableArray<T> {
    Object.defineProperty(arr, 'hasLoaded', { value: loaded, enumerable: false, configurable: true });
    return arr as LoadableArray<T>;
}

/**
 * Generic hook to manage Supabase collections with:
 * 1. Recursive pagination (bypassing 1000 row limit)
 * 2. Incremental Realtime updates
 * 3. Tenant isolation
 * 4. Custom mapping and column selection
 *
 * Devuelve el array con `hasLoaded` adjunto: hasta que el primer fetch responde,
 * el array está vacío y es **indistinguible de "no hay datos"**. Sin esa marca,
 * las páginas afirmaban cosas falsas mientras cargaban (Stock por Contrato decía
 * "No hay existencias registradas" con 137 filas en el ledger).
 */
export function useSupabaseCollection<T>(
    table: string,
    options: Options<T> = {}
): LoadableArray<T> {
    const [data, setData] = useState<T[]>([]);
    const [hasLoaded, setHasLoaded] = useState(false);
    const {
        tenantId,
        orderBy,
        mapper,
        columns = "*",
        fallbackColumns,
        enabled = true,
        version,
        softDelete = false,
    } = options;

    // Al cambiar de empresa (TenantSwitcher del super-admin) o de tabla, lo ya
    // cargado deja de valer: sin este reset, `hasLoaded` seguiría en true y la UI
    // presentaría el array del tenant ANTERIOR como si fuera el nuevo, ya cargado.
    // No se resetea en un simple refresh (`version`), para no provocar un parpadeo
    // de "cargando" cada vez que se refrescan los datos.
    // El scope previo se guarda en ESTADO, no en un ref: es el patrón oficial de
    // React para "resetear estado cuando cambia una entrada". Con un ref, un render
    // descartado (StrictMode/concurrent) dejaría el ref ya mutado pero perdería el
    // `setHasLoaded(false)`, y el render siguiente no volvería a entrar aquí — o sea,
    // justo el fallo que este bloque existe para evitar.
    const scopeKey = `${table}::${tenantId ?? ''}`;
    const [lastScope, setLastScope] = useState(scopeKey);
    if (lastScope !== scopeKey) {
        setLastScope(scopeKey);
        if (hasLoaded) setHasLoaded(false);
    }

    const dataRef = useRef<T[]>(data);
    dataRef.current = data;
    // Sube cuando el canal Realtime se reconecta: lo ocurrido mientras estuvo caído
    // no llega por el canal, así que hay que volver a leer.
    const [resyncTick, setResyncTick] = useState(0);
    const retryTick = useRetryTick();

    useEffect(() => {
        // tenantId null/undefined means auth is loading or no tenant selected
        if (!enabled || tenantId == null) return;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let attempt = 0;

        const fetchPage: FetchPage = (from, to, cols, signal) => {
            let query = supabase.from(table).select(cols).range(from, to);
            if (tenantId !== null) query = query.eq('tenant_id', tenantId);
            if (softDelete) query = query.is('deleted_at', null);
            if (orderBy) query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
            return query.abortSignal(signal) as unknown as PromiseLike<PageResult>;
        };

        const fetchData = async () => {
            const outcome = await loadAllPages(fetchPage, {
                columns,
                fallbackColumns,
                onFallback: (m) => console.warn(`[${table}] falta una columna en la base (${m}); se usan las columnas anteriores. ¿Hay una migración sin aplicar?`),
            });
            if (cancelled) return;
            const next = nextCollectionState(dataRef.current, outcome, mapper);
            if (next.failed) {
                console.error(`Error fetching collection ${table}:`, (outcome as { error: string }).error);
                markFailed(table);
                const wait = backoffFor(attempt++);
                if (wait != null) timer = setTimeout(() => { if (!cancelled) void fetchData(); }, wait);
            } else {
                markOk(table);
                attempt = 0;
                setData(next.data);
            }
            // Se marca DESPUÉS del intento, incluso si falló: significa «ya se
            // intentó», que es lo que la UI necesita para salir del spinner. Un
            // fallo no se disfraza de «vacío»: queda en `data-health` y la UI lo
            // muestra con botón de reintento.
            setHasLoaded(true);
        };

        void fetchData();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table, tenantId, enabled, orderBy?.column, orderBy?.ascending, version, retryTick, resyncTick]);

    useEffect(() => {
        if (!enabled || tenantId == null) return;

        let wasDown = false;
        // Suffix with timestamp to ensure unique channel IDs and avoid collisions
        const channel = supabase
            .channel(`${table}-changes-${tenantId || 'all'}-${Date.now()}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: table,
                filter: tenantId ? `tenant_id=eq.${tenantId}` : undefined
            }, (payload) => {
                const { eventType, new: newRecord, old: oldRecord } = payload;

                setData(prev => {
                    if (eventType === 'INSERT') {
                        const item = mapper ? mapper(newRecord) : newRecord;
                        const id = (item as any)?.id;
                        // Dedupe: si la fila ya existe (p. ej. por un optimistic update
                        // previo o un evento duplicado), reemplázala en lugar de
                        // agregar un duplicado.
                        if (id != null && prev.some(m => (m as any).id === id)) {
                            return prev.map(m => ((m as any).id === id ? (item as T) : m));
                        }
                        return [...prev, item as T];
                    }
                    if (eventType === 'UPDATE') {
                        if (softDelete && newRecord.deleted_at) {
                            return prev.filter(m => (m as any).id !== newRecord.id);
                        }
                        return prev.map(m => {
                            if ((m as any).id === newRecord.id) {
                                // Merge existing data with new changes to handle partial Realtime payloads
                                // This is crucial if REPLICA IDENTITY is not set to FULL in Postgres
                                const merged = { ...m, ...newRecord };
                                return mapper ? mapper(merged) : (merged as T);
                            }
                            return m;
                        });
                    }
                    if (eventType === 'DELETE') {
                        return prev.filter(m => (m as any).id !== oldRecord.id);
                    }
                    return prev;
                });
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    setRealtime(table, true);
                    if (wasDown) {
                        wasDown = false;
                        setResyncTick(t => t + 1);
                    }
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    wasDown = true;
                    setRealtime(table, false);
                }
            });

        return () => {
            supabase.removeChannel(channel);
            setRealtime(table, true);
        };
        // `columns`, `mapper`, `orderBy` y `softDelete` llegan como literales en cada
        // llamada al hook, así que su identidad cambia en todos los renders de
        // `DataProvider`. Incluirlos volvería a pedir TODAS las colecciones y a
        // re-suscribir sus canales de Realtime en cada render. Se depende de sus
        // valores primitivos (`orderBy?.column`, `orderBy?.ascending`), que son lo
        // único que cambia de verdad; el resto es estable por construcción.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table, tenantId, enabled, orderBy?.column, orderBy?.ascending]);

    return markLoaded(data, hasLoaded);
}
