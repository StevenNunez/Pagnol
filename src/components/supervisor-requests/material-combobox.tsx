"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { ChevronsUpDown, Check } from 'lucide-react';
import type { Material } from '@/modules/core/lib/data';
import { MaterialPickerShell, filterMaterials, pickerListClass, useIsPhone } from './material-picker-shell';

interface MaterialComboboxProps {
    groupedMaterials: Record<string, Material[]>;
    selectedId: string | null;
    onSelect: (material: Material) => void;
    /** materialId -> {contract, pool}, para mostrar de dónde saldría el stock. */
    availability: Map<string, { contract: number; pool: number }>;
    hasContractSelected: boolean;
    disabled?: boolean;
}

/** Tope de filas sin búsqueda: en un catálogo de cientos, el celular se pone lento y nadie recorre 400 filas. */
const MAX_ROWS = 120;

/**
 * Selector buscable de materiales. El filtrado lo hacemos nosotros
 * (`filterMaterials`, por palabras), así que cmdk va con shouldFilter={false};
 * `value` sigue siendo nombre+id para que materiales homónimos (común en EPPs)
 * no colisionen en el resaltado por teclado.
 */
export function MaterialCombobox({ groupedMaterials, selectedId, onSelect, availability, hasContractSelected, disabled }: MaterialComboboxProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const isPhone = useIsPhone();
    const hasMaterials = Object.keys(groupedMaterials).length > 0;

    let selectedMaterial: Material | null = null;
    if (selectedId) {
        for (const items of Object.values(groupedMaterials)) {
            const found = items.find(m => m.id === selectedId);
            if (found) { selectedMaterial = found; break; }
        }
    }

    const { groups, total, shown } = useMemo(() => {
        const filtered = filterMaterials(groupedMaterials, query);
        let left = MAX_ROWS;
        let count = 0;
        const capped: [string, Material[]][] = [];
        for (const [category, items] of Object.entries(filtered)) {
            count += items.length;
            if (left <= 0) continue;
            const slice = items.slice(0, left);
            left -= slice.length;
            capped.push([category, slice]);
        }
        return { groups: capped, total: count, shown: MAX_ROWS - left };
    }, [groupedMaterials, query]);

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) setQuery('');
    };

    return (
        <MaterialPickerShell
            open={open}
            onOpenChange={handleOpenChange}
            title="Seleccionar material"
            trigger={
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={disabled}
                    className="w-full justify-between h-12 rounded-xl bg-card"
                >
                    <span className="truncate font-medium">
                        {selectedMaterial ? selectedMaterial.name : 'Buscar material…'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            }
        >
            <Command shouldFilter={false} className={cn(isPhone && 'flex-1 min-h-0 rounded-none')}>
                <CommandInput
                    placeholder="Buscar por nombre o código…"
                    value={query}
                    onValueChange={setQuery}
                    className={cn(isPhone && 'h-12 text-base')}
                />
                <CommandList className={pickerListClass(isPhone)}>
                    <CommandEmpty>
                        {!hasMaterials ? 'Sin materiales en pañol. Contacta al administrador.' : 'Material no encontrado.'}
                    </CommandEmpty>
                    {groups.map(([category, items]) => (
                        <CommandGroup key={category} heading={category}>
                            {items.map(m => {
                                const avail = availability.get(m.id);
                                const inContract = avail?.contract || 0;
                                const inPool = avail?.pool || 0;
                                const noStock = m.stock <= 0;
                                return (
                                    <CommandItem
                                        key={m.id}
                                        value={`${m.name} ${m.id}`}
                                        disabled={noStock}
                                        onSelect={() => { onSelect(m); handleOpenChange(false); }}
                                        className="items-start gap-3 py-2.5 rounded-lg"
                                    >
                                        <div className="flex-1 min-w-0 space-y-1">
                                            <p className={cn('text-sm font-semibold leading-snug break-words', noStock && 'text-muted-foreground line-through')}>
                                                {m.name}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                                                {m.internalCode && (
                                                    <span className="font-mono text-muted-foreground">{m.internalCode}</span>
                                                )}
                                                <span className={cn(noStock ? 'text-muted-foreground' : m.stock < 10 ? 'text-destructive font-bold' : 'text-muted-foreground font-medium')}>
                                                    {noStock ? 'Sin stock' : `${m.stock} ${m.unit} disponibles`}
                                                </span>
                                                {hasContractSelected && !noStock && (
                                                    <span className={cn('px-1.5 py-0.5 rounded-md border text-[10px] font-bold', inContract > 0 ? 'text-primary border-primary/30' : 'text-muted-foreground')}>
                                                        {inContract} en contrato{inPool > 0 ? ` · ${inPool} en pool` : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {selectedId === m.id && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    ))}
                    {total > shown && (
                        <p className="px-4 py-3 text-[11px] text-muted-foreground font-medium text-center">
                            Mostrando {shown} de {total}. Escribe para encontrar el resto.
                        </p>
                    )}
                </CommandList>
            </Command>
        </MaterialPickerShell>
    );
}
