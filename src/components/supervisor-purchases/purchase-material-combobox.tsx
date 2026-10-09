"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { ChevronsUpDown, Check } from 'lucide-react';
import type { Material } from '@/modules/core/lib/data';
import { MaterialPickerShell, filterMaterials, pickerListClass, useIsPhone } from '@/components/supervisor-requests/material-picker-shell';

interface PurchaseMaterialComboboxProps {
    groupedMaterials: Record<string, Material[]>;
    currentName: string;
    selectedId: string | null;
    onSelectMaterial: (material: Material) => void;
    onFreeText: (text: string) => void;
    disabled?: boolean;
}

const MAX_ROWS = 120;

/**
 * Selector de material para compra externa: permite elegir un material EXISTENTE
 * (para vincularlo) o escribir uno nuevo que no está en el catálogo (compra de
 * algo que el pañol nunca tuvo). Mismo contenedor y búsqueda que
 * MaterialCombobox de supervisor-requests (pantalla completa en el celular,
 * búsqueda por palabras); `value` combina nombre+id para que cmdk no colisione
 * con materiales homónimos.
 */
export function PurchaseMaterialCombobox({ groupedMaterials, currentName, selectedId, onSelectMaterial, onFreeText, disabled }: PurchaseMaterialComboboxProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const isPhone = useIsPhone();

    const groups = useMemo(() => {
        let left = MAX_ROWS;
        const capped: [string, Material[]][] = [];
        for (const [category, items] of Object.entries(filterMaterials(groupedMaterials, query))) {
            if (left <= 0) break;
            const slice = items.slice(0, left);
            left -= slice.length;
            capped.push([category, slice]);
        }
        return capped;
    }, [groupedMaterials, query]);

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) setQuery('');
    };

    return (
        <MaterialPickerShell
            open={open}
            onOpenChange={handleOpenChange}
            title="Material a comprar"
            trigger={
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={disabled}
                    className={cn('w-full justify-between h-12 rounded-xl bg-card font-medium', !currentName && 'text-muted-foreground font-normal')}
                >
                    <span className="truncate">{currentName || 'Buscar o escribir material…'}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            }
        >
            <Command shouldFilter={false} className={cn(isPhone && 'flex-1 min-h-0 rounded-none')}>
                <CommandInput
                    placeholder="Buscar material…"
                    value={query}
                    onValueChange={(val) => { setQuery(val); onFreeText(val); }}
                    className={cn(isPhone && 'h-12 text-base')}
                />
                <CommandList className={pickerListClass(isPhone)}>
                    <CommandEmpty>
                        <div className="p-3 space-y-2">
                            <p className="text-xs text-muted-foreground">No está en el inventario.</p>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="w-full text-xs h-8 rounded-lg"
                                onClick={() => handleOpenChange(false)}
                                disabled={!currentName.trim()}
                            >
                                Usar nombre: "{currentName}"
                            </Button>
                        </div>
                    </CommandEmpty>
                    {groups.map(([cat, items]) => (
                        <CommandGroup key={cat} heading={cat}>
                            {items.map(m => (
                                <CommandItem
                                    key={m.id}
                                    value={`${m.name} ${m.id}`}
                                    onSelect={() => { onSelectMaterial(m); handleOpenChange(false); }}
                                    className="items-start gap-2 py-2.5 rounded-lg"
                                >
                                    <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', selectedId === m.id ? 'opacity-100 text-primary' : 'opacity-0')} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold leading-snug break-words">{m.name}</p>
                                        {m.internalCode && <p className="text-[11px] font-mono text-muted-foreground">{m.internalCode}</p>}
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    ))}
                </CommandList>
            </Command>
        </MaterialPickerShell>
    );
}
