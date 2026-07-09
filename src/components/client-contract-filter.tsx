'use client';

import React from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { Contract } from '@/modules/core/lib/data';

/**
 * Filtro en cascada Cliente → Contrato (Fase 3 Valar), compartido por
 * Activos/pañol, Asistencia y el reporte Stock por Contrato.
 *
 * Semántica de valores (strings para calzar con los filtros existentes):
 * - `CC_ALL`  — sin filtro en esa dimensión.
 * - `CC_POOL` — "sin contrato": pool central de existencias o personal sin asignar,
 *   según la página (`poolLabel`). Solo se ofrece con `includePool`.
 *
 * Elegir un cliente acota el select de contratos a los suyos; si el contrato
 * seleccionado deja de pertenecer, se resetea a CC_ALL. El select de cliente no se
 * muestra cuando el tenant aún no tiene clientes (comportamiento pre-Fase 1).
 */
export const CC_ALL = 'ALL';
export const CC_POOL = 'POOL';

/** IDs de los contratos de un cliente (para armar el predicado de filtrado por cliente). */
export function contractIdsOfClient(contracts: Contract[], clientId: string): Set<string> {
    return new Set((contracts || []).filter(c => c.clientId === clientId).map(c => c.id));
}

interface ClientContractFilterProps {
    clientId: string;
    contractId: string;
    onClientChange: (clientId: string) => void;
    onContractChange: (contractId: string) => void;
    includePool?: boolean;
    poolLabel?: string;
    /** Pinta el micro-label industrial sobre cada select (layout tipo Activos). */
    showLabels?: boolean;
    triggerClassName?: string;
    /** Qué contratos ofrecer (default: solo activos). */
    contractPredicate?: (c: Contract) => boolean;
}

export function ClientContractFilter({
    clientId,
    contractId,
    onClientChange,
    onContractChange,
    includePool = false,
    poolLabel = 'Pool central (s/contrato)',
    showLabels = false,
    triggerClassName = 'w-[200px] rounded-xl',
    contractPredicate,
}: ClientContractFilterProps) {
    const { clients, contracts } = useAppState();

    const clientOptions = (clients || [])
        .filter(cl => cl.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name));

    const baseContracts = (contracts || [])
        .filter(contractPredicate ?? (c => c.status === 'active'))
        .sort((a, b) => a.name.localeCompare(b.name));
    const contractOptions = clientId === CC_ALL
        ? baseContracts
        : baseContracts.filter(c => c.clientId === clientId);

    const handleClientChange = (v: string) => {
        onClientChange(v);
        // El contrato elegido puede no pertenecer al nuevo cliente → se resetea.
        if (v !== CC_ALL && contractId !== CC_ALL && contractId !== CC_POOL) {
            const belongs = baseContracts.some(c => c.id === contractId && c.clientId === v);
            if (!belongs) onContractChange(CC_ALL);
        }
    };

    const labelCls = 'text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1';

    const clientSelect = clientOptions.length > 0 && (
        <div className="flex flex-col space-y-2">
            {showLabels && <label className={labelCls}>Cliente</label>}
            <Select value={clientId} onValueChange={handleClientChange}>
                <SelectTrigger className={triggerClassName}>
                    <SelectValue placeholder="Cliente" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                    <SelectItem value={CC_ALL}>Todos los clientes</SelectItem>
                    {clientOptions.map(cl => (
                        <SelectItem key={cl.id} value={cl.id}>{cl.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );

    const contractSelect = (
        <div className="flex flex-col space-y-2">
            {showLabels && <label className={labelCls}>Contrato</label>}
            <Select value={contractId} onValueChange={onContractChange}>
                <SelectTrigger className={triggerClassName}>
                    <SelectValue placeholder="Contrato" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                    <SelectItem value={CC_ALL}>
                        {clientId === CC_ALL ? 'Todos los contratos' : 'Todos sus contratos'}
                    </SelectItem>
                    {includePool && <SelectItem value={CC_POOL}>{poolLabel}</SelectItem>}
                    {contractOptions.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );

    return (
        <>
            {clientSelect}
            {contractSelect}
        </>
    );
}
