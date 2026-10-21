import { LoadingState } from '@/components/loading-state';

// Se muestra mientras Next resuelve el cambio de página: sin esto, un clic en el
// menú no daba ninguna señal hasta que la página nueva estaba lista.
export default function DashboardLoading() {
    return <LoadingState fullHeight />;
}
