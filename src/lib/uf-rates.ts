import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

// Sincroniza `uf_rates` con mindicador.cl (API pública, sin key). La tabla es
// GLOBAL (la UF es un valor nacional) y solo se escribe server-side con service
// role. La API devuelve ~30 días hacia atrás, así que cada refresh rellena
// huecos si el cron estuvo caído. Compartida por el cron diario y el botón
// "Actualizar UF" de Configuración (fallback manual = re-consulta, nunca
// digitación: un humano no puede introducir un valor UF inventado).

const MINDICADOR_URL = 'https://mindicador.cl/api/uf';

export async function refreshUfRates(): Promise<{ upserted: number; latest: { fecha: string; valor: number } | null }> {
    const supabase = getSupabaseAdmin();

    const res = await fetch(MINDICADOR_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`mindicador.cl respondió HTTP ${res.status}`);
    const json = await res.json();
    const serie: { fecha: string; valor: number }[] = Array.isArray(json?.serie) ? json.serie : [];
    if (!serie.length) throw new Error('mindicador.cl no devolvió serie UF.');

    const rows = serie
        .filter((s) => s?.fecha && Number(s?.valor) > 0)
        .map((s) => ({
            rate_date: s.fecha.slice(0, 10),
            value: Number(s.valor),
            source: 'mindicador.cl',
        }));

    const { error } = await supabase.from('uf_rates').upsert(rows, { onConflict: 'rate_date' });
    if (error) throw error;

    const latest = serie[0] ? { fecha: serie[0].fecha.slice(0, 10), valor: Number(serie[0].valor) } : null;
    return { upserted: rows.length, latest };
}
