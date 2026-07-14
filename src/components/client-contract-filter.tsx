'use client';

import React from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import {
    Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator,
    SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { Contract } from '@/modules/core/lib/data';

/**
 * Filtro en cascada Cliente → Contrato (Fase 3 Valar), compartido por
 * Activos/pañol, Asistencia, Personal, Usuarios y el reporte Stock por Contrato.
 *
 * Semántica de valores (strings para calzar con los filtros existentes):
 * - `CC_ALL`  — sin filtro en esa dimensión.
 * - `CC_POOL` — SIN ASIGNAR: ni contrato de cliente ni área interna. Es limbo /
 *   dato faltante, NO "de la empresa" (para eso están las áreas internas).
 *   Solo se ofrece con `includePool`.
 *
 * El desplegable de contratos separa en dos grupos:
 *   · Contratos      → kind='client'   (mandante externo)
 *   · Áreas Internas → kind='internal' (Administración, Finanzas, Abastecimiento…)
 * Un área interna no tiene cliente, así que al elegir un cliente el grupo de
 * áreas desaparece solo.
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
    /**
     * Incluir las Áreas Internas en el desplegable. `false` en superficies de
     * cara al cliente (facturación, estados de pago), donde un área no aplica.
     */
    includeInternal?: boolean;
    /** Pinta el micro-label industrial sobre cada select (layout tipo Activos). */
    showLabels?: boolean;
    triggerClassName?: string;
    /** Qué contratos ofrecer (default: solo activos). Se aplica a ambos grupos. */
    contractPredicate?: (c: Contract) => boolean;
}

export function ClientContractFilter({
    clientId,
    contractId,
    onClientChange,
    onContractChange,
    includePool = false,
    poolLabel = 'Sin asignar',
    includeInternal = true,
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

    // Un área interna nunca cuelga de un cliente: al filtrar por cliente se va sola.
    const clientContracts = (clientId === CC_ALL
        ? baseContracts.filter(c => c.kind !== 'internal')
        : baseContracts.filter(c => c.kind !== 'internal' && c.clientId === clientId));

    const internalAreas = includeInternal && clientId === CC_ALL
        ? baseContracts.filter(c => c.kind === 'internal')
        : [];

    const handleClientChange = (v: string) => {
        onClientChange(v);
        // El contrato elegido puede no pertenecer al nuevo cliente (o ser un área
        // interna, que no pertenece a ninguno) → se resetea.
        if (v !== CC_ALL && contractId !== CC_ALL && contractId !== CC_POOL) {
            const belongs = baseContracts.some(
                c => c.id === contractId && c.kind !== 'internal' && c.clientId === v
            );
            if (!belongs) onContractChange(CC_ALL);
        }
    };

    const labelCls = 'text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1';
    const groupLabelCls = 'text-[9px] font-black uppercase tracking-widest text-muted-foreground';

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
            {showLabels && <label className={labelCls}>Contrato / Área</label>}
            <Select value={contractId} onValueChange={onContractChange}>
                <SelectTrigger className={triggerClassName}>
                    <SelectValue placeholder="Contrato" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                    <SelectItem value={CC_ALL}>
                        {clientId === CC_ALL ? 'Todos los contratos' : 'Todos sus contratos'}
                    </SelectItem>

                    {clientContracts.length > 0 && (
                        <SelectGroup>
                            <SelectLabel className={groupLabelCls}>Contratos</SelectLabel>
                            {clientContracts.map(c => (
                                <SelectItem key={c.id} value={c.id}>
                                    {c.name}{c.code ? ` (${c.code})` : ''}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    )}

                    {internalAreas.length > 0 && (
                        <SelectGroup>
                            <SelectLabel className={groupLabelCls}>Áreas Internas</SelectLabel>
                            {internalAreas.map(c => (
                                <SelectItem key={c.id} value={c.id}>
                                    {c.name}{c.code ? ` (${c.code})` : ''}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    )}

                    {includePool && (
                        <>
                            <SelectSeparator />
                            <SelectItem value={CC_POOL}>{poolLabel}</SelectItem>
                        </>
                    )}
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
