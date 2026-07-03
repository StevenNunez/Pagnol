// La impresión de QRs en lote vive ahora en Gestión de Activos (para todo el
// inventario, no solo herramientas). Redirect para URLs guardadas.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/dashboard/pagnol/activos/print-qrs');
}
