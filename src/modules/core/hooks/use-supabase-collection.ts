import { useEffect, useState } from "react";
import { supabase } from "@/modules/core/lib/supabase";

interface Options<T> {
    tenantId?: string | null;
    orderBy?: { column: string; ascending?: boolean };
    mapper?: (item: any) => T;
    columns?: string;
    enabled?: boolean;
    version?: number;
    softDelete?: boolean;
}

/**
 * Generic hook to manage Supabase collections with:
 * 1. Recursive pagination (bypassing 1000 row limit)
 * 2. Incremental Realtime updates
 * 3. Tenant isolation
 * 4. Custom mapping and column selection
 */
export function useSupabaseCollection<T>(
    table: string,
    options: Options<T> = {}
) {
    const [data, setData] = useState<T[]>([]);
    const {
        tenantId,
        orderBy,
        mapper,
        columns = "*",
        enabled = true,
        version,
        softDelete = false,
    } = options;

    useEffect(() => {
        // tenantId null/undefined means auth is loading or no tenant selected
        if (!enabled || tenantId == null) return;

        const fetchData = async () => {
            let allResults: any[] = [];
            let from = 0;
            const step = 1000;
            let hasMore = true;

            while (hasMore) {
                let query = supabase.from(table).select(columns).range(from, from + step - 1);

                if (tenantId !== null) {
                    query = query.eq('tenant_id', tenantId);
                }

                if (softDelete) {
                    query = query.is('deleted_at', null);
                }

                if (orderBy) {
                    query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
                }

                const { data: batch, error } = await query;

                if (error) {
                    console.error(`Error fetching collection ${table}:`, error.message, error.code, error.details);
                    hasMore = false;
                } else {
                    if (batch && batch.length > 0) {
                        allResults = [...allResults, ...batch];
                        from += batch.length;
                        if (batch.length < step) hasMore = false;
                    } else {
                        hasMore = false;
                    }
                }
            }

            const mapped = mapper ? allResults.map(mapper) : allResults;
            setData(mapped as T[]);
        };

        fetchData();

        // Suffix with timestamp to ensure unique channel IDs and avoid collisions
        const channel = supabase
            .channel(`${table}-changes-${tenantId || 'all'}-${Date.now()}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: table,
                filter: tenantId ? `tenant_id=eq.${tenantId}` : undefined
            }, (payload) => {
                const { eventType, new: newRecord, old: oldRecord } = payload;

                setData(prev => {
                    if (eventType === 'INSERT') {
                        const item = mapper ? mapper(newRecord) : newRecord;
                        return [...prev, item as T];
                    }
                    if (eventType === 'UPDATE') {
                        if (softDelete && newRecord.deleted_at) {
                            return prev.filter(m => (m as any).id !== newRecord.id);
                        }
                        return prev.map(m => {
                            if ((m as any).id === newRecord.id) {
                                // Merge existing data with new changes to handle partial Realtime payloads
                                // This is crucial if REPLICA IDENTITY is not set to FULL in Postgres
                                const merged = { ...m, ...newRecord };
                                return mapper ? mapper(merged) : (merged as T);
                            }
                            return m;
                        });
                    }
                    if (eventType === 'DELETE') {
                        return prev.filter(m => (m as any).id !== oldRecord.id);
                    }
                    return prev;
                });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [table, tenantId, enabled, orderBy?.column, orderBy?.ascending, version]);

    return data;
}
