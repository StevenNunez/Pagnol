// Herramientas se fusionó en Gestión de Activos (2026-07-03): las herramientas
// son activos (usage_type 'Herramienta Menor') y allí se ve quién las tiene.
// Esta ruta se conserva solo como redirect para URLs guardadas.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/dashboard/pagnol/activos?tipo=Herramienta%20Menor');
}
