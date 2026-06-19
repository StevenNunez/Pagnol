'use client';

import React from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

interface Option { id?: string; name: string }

/**
 * Combobox de catálogo con creación al vuelo. Muestra las opciones precargadas
 * y, si lo escrito no existe, ofrece "Crear «…»" que persiste en el catálogo
 * (vía `onCreate`) y queda seleccionado. Reutilizable para cualquier catálogo
 * name-only de Reportes de Trabajo (áreas, especialidades, cliente, turno…).
 */
export function CatalogCombobox({
  value,
  options,
  onChange,
  onCreate,
  disabled,
  placeholder = 'Selecciona…',
}: {
  value?: string;
  options: Option[];
  onChange: (name: string) => void;
  onCreate?: (name: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const q = search.trim();
  const filtered = q
    ? options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
    : options;
  const exactExists = options.some((o) => o.name.toLowerCase() === q.toLowerCase());

  const select = (name: string) => {
    onChange(name);
    setOpen(false);
    setSearch('');
  };

  const create = async () => {
    if (!onCreate || !q || creating) return;
    setCreating(true);
    try {
      await onCreate(q);
      select(q);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between rounded-xl font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar o crear…" value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 && !q && <CommandEmpty>Sin opciones. Escribe para crear una.</CommandEmpty>}
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem key={o.id || o.name} value={o.name} onSelect={() => select(o.name)}>
                  <Check className={cn('mr-2 h-4 w-4', value === o.name ? 'opacity-100' : 'opacity-0')} />
                  {o.name}
                </CommandItem>
              ))}
              {q && !exactExists && onCreate && (
                <CommandItem value={`__create__${q}`} onSelect={create} disabled={creating}>
                  <Plus className="mr-2 h-4 w-4 text-primary" />
                  <span>Crear «<b>{q}</b>»</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
