// Módulo Bodega fusionado en el Módulo Pagnol (big-bang 2026-07-02).
// Esta ruta se conserva solo como redirect para URLs guardadas.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/dashboard/pagnol/herramientas');
}
