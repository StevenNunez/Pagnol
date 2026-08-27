import { useEffect, useState } from 'react';
import { supabase } from '@/modules/core/lib/supabase';

/**
 * Carga bajo demanda columnas específicas de una fila por id.
 *
 * Se usa para campos pesados (firmas / fotos en base64) que se EXCLUYEN de los
 * collections globales por rendimiento, pero que una página de detalle sí
 * necesita mostrar. Mientras carga devuelve null (la UI muestra placeholder).
 *
 * @param table    Nombre de la tabla en Supabase.
 * @param id       id de la fila (o null/undefined para no cargar).
 * @param columns  Lista de columnas a traer, p. ej. 'firma, foto'.
 */
export function useRecordFields<T = Record<string, any>>(
    table: string,
    id: string | null | undefined,
    columns: string
): T | null {
    const [data, setData] = useState<T | null>(null);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sin id no hay registro: limpiar evita mostrar el anterior como si fuera el actual
        if (!id) { setData(null); return; }
        let active = true;
        setData(null);
        supabase
            .from(table)
            .select(columns)
            .eq('id', id)
            .maybeSingle()
            .then(({ data }) => { if (active) setData((data as T) ?? null); });
        return () => { active = false; };
    }, [table, id, columns]);

    return data;
}

/**
 * Versión imperativa de `useRecordFields`, para handlers async (generar un PDF,
 * subir un documento) donde no se puede usar un hook.
 *
 * Mismo motivo de existir: los campos pesados (firmas en base64) salen de los
 * collections globales y se piden por fila, sólo cuando de verdad se usan.
 */
export async function fetchRecordFields<T = Record<string, any>>(
    table: string,
    id: string | null | undefined,
    columns: string
): Promise<T | null> {
    if (!id) return null;
    const { data } = await supabase
        .from(table)
        .select(columns)
        .eq('id', id)
        .maybeSingle();
    return (data as T) ?? null;
}
