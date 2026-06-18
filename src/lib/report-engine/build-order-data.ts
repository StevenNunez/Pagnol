import 'server-only';
import type { WorkOrder } from '@/modules/core/lib/data';

// Traduce una WorkOrder (OT / Reporte de Trabajo) al contrato del template
// work-order-template.hbs. Las fotos se embeben como data URI.

function fmtFecha(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value as any);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

async function fetchAsDataUri(url?: string | null): Promise<string> {
  try {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    const res = await fetch(url);
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

export async function construirDatosOrden(order: WorkOrder, tenantName?: string | null): Promise<any> {
  const fotos = await Promise.all(
    (order.photos || []).map(async (p) => ({
      titulo: p.description || '',
      img: await fetchAsDataUri(p.url),
    })),
  );

  return {
    meta: {
      tenant: (tenantName || 'Pagnol').toUpperCase(),
      otNumber: order.otNumber || '',
      client: order.client || '',
      contract: order.contractNumber || '',
      area: order.area || '',
      location: order.location || '',
      specialty: order.specialty || '',
      milestone: order.milestone || '',
      supervisor: order.supervisorName || '',
      shift: order.shift || '',
      schedule: order.workSchedule || '',
      date: fmtFecha(order.workDate),
    },
    description: order.description || '',
    personal: (order.labor || []).map((l) => ({ nombre: l.name || '', cargo: l.role || '', horas: Number(l.hours) || 0 })),
    equipos: (order.equipment || []).map((e) => ({ equipo: e.equipment || '', horas: Number(e.hours) || 0 })),
    materiales: (order.materials || []).map((m) => ({ material: m.material || '', cantidad: Number(m.quantity) || 0, unidad: m.unit || '' })),
    avance: { programado: Number(order.plannedPercent) || 0, ejecutado: Number(order.executedPercent) || 0 },
    fotos,
  };
}
