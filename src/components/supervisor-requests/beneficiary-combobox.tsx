"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { ChevronsUpDown, Check } from 'lucide-react';
import type { User } from '@/modules/core/lib/data';

// Roles de plataforma que nunca son destinatarios de un retiro de terreno.
const NON_FIELD_ROLES = new Set(['super-admin', 'soporte-pagnol']);

interface BeneficiaryComboboxProps {
    users: User[];
    excludeUserId?: string;
    selectedId: string | null;
    onSelect: (user: User) => void;
    disabled?: boolean;
}

export function BeneficiaryCombobox({ users, excludeUserId, selectedId, onSelect, disabled }: BeneficiaryComboboxProps) {
    const [open, setOpen] = useState(false);

    const options = useMemo(
        () => users
            .filter(u => u.id !== excludeUserId && !NON_FIELD_ROLES.has(u.role))
            .sort((a, b) => a.name.localeCompare(b.name)),
        [users, excludeUserId],
    );

    const selected = selectedId ? options.find(u => u.id === selectedId) || null : null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" disabled={disabled} className="w-full justify-between h-12 rounded-xl bg-card">
                    <span className="truncate font-medium">{selected ? selected.name : 'Selecciona al trabajador que retira…'}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl" align="start">
                <Command>
                    <CommandInput placeholder="Buscar trabajador…" />
                    <CommandList>
                        <CommandEmpty>No se encontró el trabajador.</CommandEmpty>
                        <CommandGroup>
                            {options.map(u => (
                                <CommandItem
                                    key={u.id}
                                    value={`${u.name} ${u.id}`}
                                    onSelect={() => { onSelect(u); setOpen(false); }}
                                >
                                    <Check className={cn('mr-2 h-4 w-4', selectedId === u.id ? 'opacity-100' : 'opacity-0')} />
                                    <span className="truncate">{u.name}</span>
                                    <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wide shrink-0 pl-2">{u.role}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
