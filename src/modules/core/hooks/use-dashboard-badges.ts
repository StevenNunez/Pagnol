import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/modules/core/lib/supabase";

/**
 * Contadores de la barra superior (campana + carrito).
 *
 * RFC-005 F1. Antes, `dashboard/layout.tsx` traía OCHO colecciones completas
 * —y las pagaba toda página del dashboard— para mostrar nueve números. Ahora
 * los nueve llegan en un viaje a `dashboard_badges()`.
 *
 * Se refresca por intervalo (decisión de Steven, 2026-08-06) en vez de por
 * Realtime: el número puede quedar hasta `REFRESH_MS` viejo si otra persona
 * aprueba algo en paralelo, a cambio de no mantener 8 canales abiertos ni 8
 * tablas en memoria. Como es UN viaje a una función agregada, el costo es
 * constante y no crece con los datos del tenant.
 */
export interface DashboardBadges {
    pendingAuthMaterial: number;
    pendingAuthPurchase: number;
    pendingAuthRental: number;
    pendingMaterialRequests: number;
    pendingPurchaseRequests: number;
    overduePayments: number;
    dueSoonPayments: number;
    pendingCotizaciones: number;
    pendingReceptions: number;
    overBudgetCostCenters: number;
}

const ZERO: DashboardBadges = {
    pendingAuthMaterial: 0,
    pendingAuthPurchase: 0,
    pendingAuthRental: 0,
    pendingMaterialRequests: 0,
    pendingPurchaseRequests: 0,
    overduePayments: 0,
    dueSoonPayments: 0,
    pendingCotizaciones: 0,
    pendingReceptions: 0,
    overBudgetCostCenters: 0,
};

const REFRESH_MS = 45_000;

export function useDashboardBadges(tenantId: string | null | undefined) {
    const [badges, setBadges] = useState<DashboardBadges>(ZERO);
    const [hasLoaded, setHasLoaded] = useState(false);
    // Evita que una respuesta lenta de un tenant anterior pise la del actual
    // (el super-admin cambia de empresa con el TenantSwitcher).
    const scopeRef = useRef<string | null | undefined>(tenantId);

    const fetchBadges = useCallback(async () => {
        if (!tenantId) return;
        const scope = tenantId;
        const { data, error } = await supabase.rpc("dashboard_badges", {
            p_tenant_id: tenantId,
        });
        if (scopeRef.current !== scope) return; // cambió de empresa mientras respondía
        if (error) {
            console.error("[dashboard_badges]", error.message, error.code, error.details);
            // Se marca cargado igualmente: significa "ya se intentó" (ADR-014).
            // Si no, la campana se quedaría en un estado de carga permanente.
            setHasLoaded(true);
            return;
        }
        // La función devuelve TABLE, así que PostgREST responde un array de 1 fila.
        const row = Array.isArray(data) ? data[0] : data;
        if (row) {
            setBadges({
                pendingAuthMaterial: row.pending_auth_material ?? 0,
                pendingAuthPurchase: row.pending_auth_purchase ?? 0,
                pendingAuthRental: row.pending_auth_rental ?? 0,
                pendingMaterialRequests: row.pending_material_requests ?? 0,
                pendingPurchaseRequests: row.pending_purchase_requests ?? 0,
                overduePayments: row.overdue_payments ?? 0,
                dueSoonPayments: row.due_soon_payments ?? 0,
                pendingCotizaciones: row.pending_cotizaciones ?? 0,
                pendingReceptions: row.pending_receptions ?? 0,
                overBudgetCostCenters: row.over_budget_cost_centers ?? 0,
            });
        }
        setHasLoaded(true);
    }, [tenantId]);

    useEffect(() => {
        scopeRef.current = tenantId;
        if (!tenantId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- sin empresa hay que borrar los contadores: conservarlos filtraría cifras del tenant anterior
            setBadges(ZERO);
            setHasLoaded(false);
            return;
        }

        setHasLoaded(false);
        fetchBadges();

        let timer: ReturnType<typeof setInterval> | null = null;
        const start = () => {
            if (timer === null) timer = setInterval(fetchBadges, REFRESH_MS);
        };
        const stop = () => {
            if (timer !== null) { clearInterval(timer); timer = null; }
        };

        // Con la pestaña oculta no se consulta: en faena eso es batería y datos
        // móviles gastados en números que nadie está mirando. Al volver se
        // refresca de inmediato para no mostrar un contador viejo.
        const onVisibility = () => {
            if (document.visibilityState === "visible") { fetchBadges(); start(); }
            else stop();
        };

        if (document.visibilityState === "visible") start();
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [tenantId, fetchBadges]);

    return { badges, hasLoaded, refresh: fetchBadges };
}
