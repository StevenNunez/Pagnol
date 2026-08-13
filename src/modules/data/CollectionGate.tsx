"use client";
import React from 'react';
import { usePathname } from 'next/navigation';
import { collectionsFor, moduleOf, type CollectionName } from './moduleData';

/**
 * RFC-005 F2 — Decide qué colecciones están activas y protege el caso en que
 * alguien lea una que no lo está.
 *
 * ## Por qué existe la parte de "protege"
 *
 * Con carga selectiva, un array vacío deja de tener un solo significado y pasa
 * a tener tres: *todavía no llega* · *no hay datos* · **nadie la pidió**.
 *
 * El tercero es nuevo y es el peligroso: la página mostraría cero filas sin
 * ningún error, o se quedaría en "cargando" para siempre. Por eso el manifiesto
 * (`moduleData.ts`) es sólo la optimización y ESTO es la garantía: cuando un
 * componente lee una colección inactiva, se activa al vuelo y en desarrollo se
 * avisa por consola. El peor caso deja de ser "datos falsos en silencio" y pasa
 * a ser "esta página tardó un viaje más".
 *
 * ## Se conservan al navegar (decisión de Steven, 2026-08-06)
 *
 * Al cambiar de módulo, lo ya cargado NO se libera: el usuario de faena navega
 * en círculos entre pocas páginas y volver atrás debe ser instantáneo. El techo
 * es el estado actual de la app (todas las colecciones), así que en el peor caso
 * no empeora nada.
 */
interface CollectionGate {
    /** Colecciones activas. Se lee por ref para no re-renderizar consumidores. */
    activeRef: React.MutableRefObject<ReadonlySet<CollectionName>>;
    /** Activa una colección leída fuera del manifiesto. Seguro durante el render. */
    request: (name: CollectionName) => void;
    /** Set activo, reactivo — sólo lo consume el DataProvider. */
    active: ReadonlySet<CollectionName>;
}

const CollectionGateContext = React.createContext<CollectionGate | null>(null);

export function useCollectionGate(): CollectionGate | null {
    return React.useContext(CollectionGateContext);
}

export function CollectionGateProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [active, setActive] = React.useState<ReadonlySet<CollectionName>>(
        () => new Set(collectionsFor(pathname))
    );

    // Espejo por ref: `request` se llama durante el render de otros componentes
    // y necesita leer el set sin suscribirse a él.
    const activeRef = React.useRef<ReadonlySet<CollectionName>>(active);
    activeRef.current = active;

    const addActive = React.useCallback((names: Iterable<CollectionName>) => {
        setActive(prev => {
            let next: Set<CollectionName> | null = null;
            for (const n of names) {
                if (!prev.has(n)) (next ??= new Set(prev)).add(n);
            }
            // Devolver `prev` cuando no cambió nada evita un render inútil.
            return next ?? prev;
        });
    }, []);

    // Al navegar se suma lo del módulo nuevo; nunca se resta.
    //
    // ⚠️ Esto se ajusta DURANTE el render y no en un `useEffect`, a propósito.
    // Con el efecto, el set llegaba un commit tarde: la página de la ruta nueva
    // se renderizaba con las colecciones de la ruta ANTERIOR todavía activas, su
    // primera lectura caía en la red de seguridad y ésta reportaba —en falso—
    // que el manifiesto no declaraba una colección que sí estaba declarada. El
    // mensaje además salía contradictorio, porque `pathnameRef` ya apuntaba a la
    // ruta nueva (se asigna en el render) mientras el set era el viejo.
    //
    // Una alarma que suena con el manifiesto correcto es peor que no tenerla:
    // enseña a ignorar el único aviso que separa "un viaje extra" de "cero filas
    // en silencio". Ajustar estado en el render es el patrón oficial de React
    // para derivar de props/navegación — re-ejecuta este componente antes de
    // renderizar los hijos, así que la página ve su módulo ya activo.
    const [rutaAplicada, setRutaAplicada] = React.useState(pathname);
    if (pathname !== rutaAplicada) {
        setRutaAplicada(pathname);
        const faltantes = collectionsFor(pathname).filter(n => !active.has(n));
        if (faltantes.length) {
            setActive(prev => {
                const next = new Set(prev);
                for (const n of faltantes) next.add(n);
                return next;
            });
        }
    }

    // `request` debe ser estable (lo usa el Proxy de useAppState en cada render),
    // así que la ruta para el mensaje de consola se lee por ref.
    const pathnameRef = React.useRef(pathname);
    pathnameRef.current = pathname;

    // Las peticiones fuera del manifiesto se juntan y se aplican en un
    // microtask: llamar a setState durante el render de otro componente es
    // justamente lo que hay que evitar.
    const pendingRef = React.useRef<Set<CollectionName>>(new Set());
    const request = React.useCallback((name: CollectionName) => {
        if (activeRef.current.has(name) || pendingRef.current.has(name)) return;
        pendingRef.current.add(name);

        if (process.env.NODE_ENV !== 'production') {
            const mod = moduleOf(pathnameRef.current);
            console.error(
                `[RFC-005] La colección '${name}' se leyó en ${pathnameRef.current} pero el ` +
                `módulo '${mod ?? '(desconocido)'}' no la declara. Se activó al vuelo (la página ` +
                `funciona, con un viaje extra). Agregá '${name}' a MODULE_DATA['${mod}'] en ` +
                `src/modules/data/moduleData.ts para que se cargue desde el principio.`
            );
        }

        queueMicrotask(() => {
            const batch = [...pendingRef.current];
            pendingRef.current.clear();
            if (batch.length) addActive(batch);
        });
    }, [addActive]);

    const value = React.useMemo<CollectionGate>(
        () => ({ activeRef, request, active }),
        [request, active]
    );

    return (
        <CollectionGateContext.Provider value={value}>
            {children}
        </CollectionGateContext.Provider>
    );
}
