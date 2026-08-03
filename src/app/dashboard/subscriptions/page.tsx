import { redirect } from "next/navigation";

/**
 * Esta pantalla duplicaba `/dashboard/super-admin/tenants`: ambas listaban las
 * empresas, pero cada una tenía la mitad de las acciones (aquí se creaba, allá
 * se borraba; aquí se editaba el plan, allá el hardware y el contrato). Además
 * el sidebar la rotulaba "Planes y Clientes" mientras `/subscriptions/plans`
 * —que gestiona los planes— se rotulaba "Gestión de Tenants": los nombres
 * estaban cruzados.
 *
 * Ahora hay una sola lista y un solo detalle, con todas las acciones juntas.
 * Se conserva la ruta como redirección para no romper enlaces guardados.
 */
export default function SubscriptionsRedirect() {
  redirect("/dashboard/super-admin/tenants");
}
