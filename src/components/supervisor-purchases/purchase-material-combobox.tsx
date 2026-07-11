"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { ChevronsUpDown, Check } from 'lucide-react';
import type { Material } from '@/modules/core/lib/data';

interface PurchaseMaterialComboboxProps {
    groupedMaterials: Record<string, Material[]>;
    currentName: string;
    selectedId: string | null;
    onSelectMaterial: (material: Material) => void;
    onFreeText: (text: string) => void;
    disabled?: boolean;
}

/**
 * Selector de material para compra externa: permite elegir un material EXISTENTE
 * (para vincularlo) o escribir uno nuevo que no está en el catálogo (compra de
 * algo que el pañol nunca tuvo). Mismo fix que MaterialCombobox de
 * supervisor-requests: `value` combina nombre+id para que cmdk no colisione
 * con materiales homónimos.
 */
export function PurchaseMaterialCombobox({ groupedMaterials, currentName, selectedId, onSelectMaterial, onFreeText, disabled }: PurchaseMaterialComboboxProps) {
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    disabled={disabled}
                    className={cn('w-full justify-between h-12 rounded-xl bg-card font-medium', !currentName && 'text-muted-foreground font-normal')}
                >
                    <span className="truncate">{currentName || 'Buscar o escribir material…'}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl" align="start">
                <Command>
                    <CommandInput
                        placeholder="Buscar material…"
                        onValueChange={(val) => onFreeText(val)}
                    />
                    <CommandList>
                        <CommandEmpty>
                            <div className="p-3 space-y-2">
                                <p className="text-xs text-muted-foreground">No está en el inventario.</p>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="w-full text-xs h-8 rounded-lg"
                                    onClick={() => setOpen(false)}
                                    disabled={!currentName.trim()}
                                >
                                    Usar nombre: "{currentName}"
                                </Button>
                            </div>
                        </CommandEmpty>
                        {Object.entries(groupedMaterials).map(([cat, items]) => (
                            <CommandGroup key={cat} heading={cat}>
                                {items.map(m => (
                                    <CommandItem
                                        key={m.id}
                                        value={`${m.name} ${m.id}`}
                                        onSelect={() => { onSelectMaterial(m); setOpen(false); }}
                                    >
                                        <Check className={cn('mr-2 h-3.5 w-3.5', selectedId === m.id ? 'opacity-100' : 'opacity-0')} />
                                        <span className="truncate">{m.name}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
