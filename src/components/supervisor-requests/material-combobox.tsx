"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { ChevronsUpDown, Check } from 'lucide-react';
import type { Material } from '@/modules/core/lib/data';

interface MaterialComboboxProps {
    groupedMaterials: Record<string, Material[]>;
    selectedId: string | null;
    onSelect: (material: Material) => void;
    /** materialId -> {contract, pool}, para mostrar de dónde saldría el stock. */
    availability: Map<string, { contract: number; pool: number }>;
    hasContractSelected: boolean;
    disabled?: boolean;
}

/**
 * Selector buscable de materiales. cmdk identifica y navega los ítems por su
 * prop `value` — con nombres duplicados (materiales homónimos, común en EPPs)
 * el resaltado por teclado y la resolución interna de "ítem actual" colisionan
 * entre instancias. Se compone `value` con nombre+id: el buscador sigue
 * matcheando por nombre (aparece primero en la cadena) y cada ítem queda
 * inequívoco para cmdk.
 */
export function MaterialCombobox({ groupedMaterials, selectedId, onSelect, availability, hasContractSelected, disabled }: MaterialComboboxProps) {
    const [open, setOpen] = useState(false);
    const hasMaterials = Object.keys(groupedMaterials).length > 0;

    let selectedMaterial: Material | null = null;
    if (selectedId) {
        for (const items of Object.values(groupedMaterials)) {
            const found = items.find(m => m.id === selectedId);
            if (found) { selectedMaterial = found; break; }
        }
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
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
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl" align="start">
                <Command>
                    <CommandInput placeholder="Buscar por nombre…" />
                    <CommandList>
                        <CommandEmpty>
                            {!hasMaterials ? 'Sin materiales en pañol. Contacta al administrador.' : 'Material no encontrado.'}
                        </CommandEmpty>
                        {Object.entries(groupedMaterials).map(([category, items]) => (
                            <CommandGroup key={category} heading={category}>
                                {items.map(m => {
                                    const avail = availability.get(m.id);
                                    const inContract = avail?.contract || 0;
                                    const inPool = avail?.pool || 0;
                                    return (
                                        <CommandItem
                                            key={m.id}
                                            value={`${m.name} ${m.id}`}
                                            disabled={m.stock <= 0}
                                            onSelect={() => { onSelect(m); setOpen(false); }}
                                        >
                                            <div className="flex justify-between w-full items-center gap-2">
                                                <span className={cn('truncate', m.stock <= 0 && 'text-muted-foreground line-through')}>{m.name}</span>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {hasContractSelected && (
                                                        <Badge variant="outline" className={cn('text-[9px] font-bold', inContract > 0 ? 'text-primary border-primary/30' : 'text-muted-foreground')}>
                                                            {inContract} contrato{inPool > 0 ? ` · ${inPool} pool` : ''}
                                                        </Badge>
                                                    )}
                                                    <span className={cn('text-xs', m.stock < 10 ? 'text-destructive font-bold' : 'text-muted-foreground')}>
                                                        {m.stock} {m.unit}
                                                    </span>
                                                    {selectedId === m.id && <Check className="h-4 w-4 text-primary" />}
                                                </div>
                                            </div>
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
