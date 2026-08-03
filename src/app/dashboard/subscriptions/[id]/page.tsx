import { redirect } from "next/navigation";

/**
 * Duplicaba `/dashboard/super-admin/tenants/[tenantId]`. El detalle unificado
 * incluye lo que sólo estaba aquí (editar nombre, plan y estado) además del
 * hardware, el contrato y los usuarios. Se conserva como redirección para no
 * romper enlaces guardados.
 */
export default async function SubscriptionDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/super-admin/tenants/${id}`);
}
