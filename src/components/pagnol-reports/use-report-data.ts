"use client";

import { useMemo } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { Material, User } from '@/modules/core/lib/data';
import { computeToolHolderMap, ToolHolder } from '@/modules/core/lib/tool-loans';
import {
    AssetStatus,
    DisplayTransaction,
    buildTransactions,
    criticalThreshold,
    isReturnable,
} from './report-utils';

/**
 * Fuente única de datos del Centro de Reportes. La posesión se calcula con
 * computeToolHolderMap — el MISMO helper que usa la página de Activos — para
 * que ambas pantallas cuenten siempre la misma historia.
 */
export function useReportData() {
    const { materials, users, requests, returnRequests, materialCategories } = useAppState();

    const materialsMap = useMemo(() => new Map((materials || []).map(m => [m.id, m])), [materials]);
    const usersMap = useMemo(() => new Map((users || []).map((u: User) => [u.id, u])), [users]);

    const transactions: DisplayTransaction[] = useMemo(
        () => buildTransactions(requests, returnRequests, usersMap),
        [requests, returnRequests, usersMap],
    );

    // Posesión real (materialId → { holder, since }), consistente con Activos.
    const holderMap = useMemo(
        () => computeToolHolderMap(requests, returnRequests, users),
        [requests, returnRequests, users],
    );

    // Agrupación por persona: userId → materiales retornables en su poder.
    const possessionByUser = useMemo(() => {
        const map = new Map<string, { materialId: string; since: Date }[]>();
        holderMap.forEach((holder: ToolHolder, materialId: string) => {
            const mat = materialsMap.get(materialId);
            if (!isReturnable(mat)) return; // el cemento no queda "en poder" de nadie
            const list = map.get(holder.id) || [];
            list.push({ materialId, since: holder.since });
            map.set(holder.id, list);
        });
        return map;
    }, [holderMap, materialsMap]);

    // Estado honesto de un material. "En Uso" solo aplica a retornables en manos de alguien.
    const getStatusLabel = useMemo(() => {
        return (asset: Material): AssetStatus => {
            if (asset.archived) return 'Archivado';
            if (asset.status === 'En Mantenimiento') return 'En Mantenimiento';
            if (asset.status === 'Para Baja') return 'Para Baja';
            if (asset.status === 'Extraviado') return 'Extraviado';
            if (isReturnable(asset) && holderMap.has(asset.id)) return 'En Uso';
            if ((asset.stock ?? 0) <= 0) return 'Agotado';
            if ((asset.stock ?? 0) <= criticalThreshold(asset)) return 'Stock Crítico';
            return 'Disponible';
        };
    }, [holderMap]);

    const activeMaterials = useMemo(() => (materials || []).filter(m => !m.archived), [materials]);

    const totalValue = useMemo(
        () => activeMaterials.reduce((acc, m) => acc + ((m.unitCost || 0) * (m.stock || 0)), 0),
        [activeMaterials],
    );

    const categoryData = useMemo(() => {
        return (materialCategories || []).map(cat => {
            const catAssets = activeMaterials.filter(a => a.category === cat.name);
            const value = catAssets.reduce((acc, curr) => acc + (curr.unitCost || 0) * (curr.stock || 0), 0);
            return { name: cat.name, value, count: catAssets.length };
        }).filter(d => d.count > 0).sort((a, b) => b.value - a.value);
    }, [activeMaterials, materialCategories]);

    const statusDistribution = useMemo(() => {
        const dist: Record<string, number> = {};
        activeMaterials.forEach(m => {
            const status = getStatusLabel(m);
            dist[status] = (dist[status] || 0) + 1;
        });
        return Object.entries(dist)
            .map(([name, value]) => ({ name: name as AssetStatus, value }))
            .sort((a, b) => b.value - a.value);
    }, [activeMaterials, getStatusLabel]);

    // % REAL de activos listos para despacho (nada de 75 pintado a mano).
    const operabilityPct = useMemo(() => {
        if (activeMaterials.length === 0) return 0;
        const ready = statusDistribution.find(s => s.name === 'Disponible')?.value || 0;
        return Math.round((ready / activeMaterials.length) * 100);
    }, [statusDistribution, activeMaterials.length]);

    // Stock crítico con el umbral REAL de cada material (minStock; fallback solo
    // para consumibles/repuestos). Umbral 0 = sin control de stock mínimo.
    const criticalStock = useMemo(
        () => activeMaterials
            .filter(m => {
                const threshold = criticalThreshold(m);
                return threshold > 0 && (m.stock ?? 0) <= threshold;
            })
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0)),
        [activeMaterials],
    );

    // Mantenimiento accionable: vencidos y próximos 15 días por nextMaintenanceDate.
    const maintenance = useMemo(() => {
        const now = new Date();
        const in15 = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
        const planned = activeMaterials.filter(m => m.requiresMaintenance === true && m.nextMaintenanceDate);
        const overdue = planned
            .filter(m => new Date(m.nextMaintenanceDate as any) < now)
            .sort((a, b) => new Date(a.nextMaintenanceDate as any).getTime() - new Date(b.nextMaintenanceDate as any).getTime());
        const upcoming = planned
            .filter(m => {
                const d = new Date(m.nextMaintenanceDate as any);
                return d >= now && d <= in15;
            })
            .sort((a, b) => new Date(a.nextMaintenanceDate as any).getTime() - new Date(b.nextMaintenanceDate as any).getTime());
        const inWorkshop = activeMaterials.filter(m => m.status === 'En Mantenimiento');
        const forRetirement = (materials || []).filter(m => m.status === 'Para Baja');
        return { overdue, upcoming, inWorkshop, forRetirement };
    }, [activeMaterials, materials]);

    return {
        materials,
        activeMaterials,
        users,
        materialsMap,
        usersMap,
        transactions,
        holderMap,
        possessionByUser,
        getStatusLabel,
        totalValue,
        categoryData,
        statusDistribution,
        operabilityPct,
        criticalStock,
        maintenance,
    };
}

export type ReportData = ReturnType<typeof useReportData>;
