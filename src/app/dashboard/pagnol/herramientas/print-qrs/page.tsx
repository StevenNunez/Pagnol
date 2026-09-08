// Las etiquetas QR en lote se imprimen ahora en Hardware, con el formato de
// 22 × 32 mm que sí es una etiqueta de equipo. Redirect para URLs guardadas.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/dashboard/pagnol/hardware/label-printing');
}
