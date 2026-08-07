import { useAppStateTracked } from './DataProvider';
import { useCollectionGate } from './CollectionGate';
import { ALL_COLLECTIONS, type CollectionName } from './moduleData';

/** Nombres válidos de colección, para no reaccionar a `can`, `notify`, mutaciones… */
const COLLECTION_NAMES: ReadonlySet<string> = new Set(ALL_COLLECTIONS);

/**
 * Hook de acceso al estado global de la app.
 *
 * Internamente usa react-tracked: el objeto devuelto es un Proxy que registra
 * qué propiedades lee cada componente durante el render. Gracias a eso, un
 * componente que solo usa `materials` no se re-renderiza cuando cambia
 * `dailyTalks` u otra colección.
 *
 * RFC-005 F2 — sobre ese Proxy va un segundo envoltorio que detecta la lectura
 * de una colección que el módulo actual no declaró en `moduleData.ts`, la activa
 * al vuelo y avisa por consola en desarrollo.
 *
 * Es la red que evita el único modo de falla grave de la carga selectiva: que
 * una página muestre **cero filas en silencio** porque nadie pidió su colección.
 * Sin esto, el manifiesto sería una lista que al desincronizarse produce datos
 * falsos sin dejar rastro. Con esto, desincronizarse cuesta un viaje extra y un
 * mensaje en la consola del desarrollador.
 *
 * El envoltorio delega con `Reflect.get`, así que el tracking por propiedad de
 * react-tracked sigue funcionando igual.
 */
export const useAppState = () => {
    const state = useAppStateTracked();
    const gate = useCollectionGate();

    if (!gate) return state;

    return new Proxy(state, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && COLLECTION_NAMES.has(prop)) {
                gate.request(prop as CollectionName);
            }
            // Delegar al Proxy de react-tracked es lo que conserva el tracking.
            return Reflect.get(target, prop, receiver);
        },
    });
};
