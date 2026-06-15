
import { useAppStateTracked } from './DataProvider';

/**
 * Hook de acceso al estado global de la app.
 *
 * Internamente usa react-tracked: el objeto devuelto es un Proxy que registra
 * qué propiedades lee cada componente durante el render. Gracias a eso, un
 * componente que solo usa `materials` no se re-renderiza cuando cambia
 * `dailyTalks` u otra colección. La API (destructurar lo que se necesita) es
 * idéntica a la anterior, por lo que los consumidores no requieren cambios.
 */
export const useAppState = () => useAppStateTracked();
