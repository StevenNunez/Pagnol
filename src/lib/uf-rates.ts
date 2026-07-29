import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

// Sincroniza `uf_rates` y `utm_rates` con mindicador.cl (API pública, sin key).
// Las tablas son GLOBALES (son valores nacionales) y solo se escriben
// server-side con service role. La API devuelve ~30 días hacia atrás, así que
// cada refresh rellena huecos si el cron estuvo caído. Compartida por el cron
// diario y el botón "Actualizar UF" de Configuración (fallback manual =
// re-consulta, nunca digitación: un humano no puede introducir un valor
// inventado).
//
// La UTM se agrega en Remuneraciones F1 (RFC-003): el impuesto único de 2ª
// categoría usa tramos en UTM. Es el mismo proveedor y el mismo patrón, por eso
// se extiende este módulo en vez de crear otro.

const BASE_URL = 'https://mindicador.cl/api';

interface SeriePoint { fecha: string; valor: number }

/** Descarga una serie de mindicador y la normaliza a filas de la tabla. */
async function fetchSerie(indicator: 'uf' | 'utm'): Promise<SeriePoint[]> {
    const res = await fetch(`${BASE_URL}/${indicator}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`mindicador.cl respondió HTTP ${res.status} para ${indicator.toUpperCase()}`);
    const json = await res.json();
    const serie: SeriePoint[] = Array.isArray(json?.serie) ? json.serie : [];
    if (!serie.length) throw new Error(`mindicador.cl no devolvió serie ${indicator.toUpperCase()}.`);
    return serie.filter((s) => s?.fecha && Number(s?.valor) > 0);
}

async function upsertSerie(table: 'uf_rates' | 'utm_rates', serie: SeriePoint[]): Promise<number> {
    const supabase = getSupabaseAdmin();
    const rows = serie.map((s) => ({
        rate_date: s.fecha.slice(0, 10),
        value: Number(s.valor),
        source: 'mindicador.cl',
    }));
    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'rate_date' });
    if (error) throw error;
    return rows.length;
}

export async function refreshUfRates(): Promise<{
    upserted: number;
    latest: { fecha: string; valor: number } | null;
    utm: { upserted: number; latest: { fecha: string; valor: number } | null } | null;
}> {
    const ufSerie = await fetchSerie('uf');
    const upserted = await upsertSerie('uf_rates', ufSerie);
    const latest = ufSerie[0] ? { fecha: ufSerie[0].fecha.slice(0, 10), valor: Number(ufSerie[0].valor) } : null;

    // La UTM no debe tumbar la sincronización de UF: la UF sostiene arriendos y
    // topes que ya están en producción, y la UTM solo la usará el motor de
    // remuneraciones (F2). Si falla, se reporta y el cron vuelve a intentar.
    let utm: { upserted: number; latest: { fecha: string; valor: number } | null } | null = null;
    try {
        const utmSerie = await fetchSerie('utm');
        utm = {
            upserted: await upsertSerie('utm_rates', utmSerie),
            latest: utmSerie[0] ? { fecha: utmSerie[0].fecha.slice(0, 10), valor: Number(utmSerie[0].valor) } : null,
        };
    } catch (e) {
        console.error('refreshUfRates: la UTM falló (la UF sí se actualizó):', e);
    }

    return { upserted, latest, utm };
}
