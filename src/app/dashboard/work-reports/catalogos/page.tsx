'use client';

import React from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAppState } from '@/modules/core/contexts/app-provider';

interface CatalogItem { id: string; name: string }

function CatalogManager({
  title,
  description,
  placeholder,
  items,
  editable,
  onAdd,
  onUpdate,
  onDelete,
}: {
  title: string;
  description: string;
  placeholder: string;
  items: CatalogItem[];
  editable: boolean;
  onAdd: (name: string) => Promise<void>;
  onUpdate: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');

  const add = async () => {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    try { await onAdd(name); setValue(''); } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    const name = editValue.trim();
    if (!name || !editingId) { setEditingId(null); return; }
    setBusy(true);
    try { await onUpdate(editingId, name); setEditingId(null); } finally { setBusy(false); }
  };

  return (
    <Card className="rounded-[1.5rem]">
      <CardHeader>
        <CardTitle className="text-lg font-bold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {editable && (
          <div className="flex gap-2">
            <Input
              className="rounded-xl"
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            />
            <Button className="rounded-xl" onClick={add} disabled={busy || !value.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin elementos. Agrega el primero.</p>
          )}
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-xl border px-3 py-2">
              {editingId === item.id ? (
                <>
                  <Input
                    className="rounded-xl h-8"
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                  />
                  <Button size="icon" variant="ghost" className="rounded-xl h-8 w-8" onClick={saveEdit} disabled={busy}><Check className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="rounded-xl h-8 w-8" onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{item.name}</span>
                  {editable && (
                    <>
                      <Button size="icon" variant="ghost" className="rounded-xl h-8 w-8" onClick={() => { setEditingId(item.id); setEditValue(item.name); }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="rounded-xl h-8 w-8 text-destructive" onClick={() => onDelete(item.id)}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkReportCatalogsPage() {
  const {
    workReportAreas,
    workReportSpecialties,
    workReportMilestones,
    workReportCatalogs,
    addWorkReportArea, updateWorkReportArea, deleteWorkReportArea,
    addWorkReportSpecialty, updateWorkReportSpecialty, deleteWorkReportSpecialty,
    addWorkReportMilestone, updateWorkReportMilestone, deleteWorkReportMilestone,
    addWorkReportCatalog, updateWorkReportCatalog, deleteWorkReportCatalog,
    can,
  } = useAppState();

  const editable = can('work_reports:create');
  const catBy = (kind: string) => (workReportCatalogs || []).filter((c) => c.kind === kind);

  return (
    <PageShell
      title="Catálogos de Reportes de Trabajo"
      description="Precarga la información general (cliente, contrato, área, especialidad, ubicación, turno, jornada, hitos) para agilizar el llenado de las OT. También puedes crear valores nuevos directamente desde cada campo de la OT."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <CatalogManager
          title="Clientes"
          description="Mandantes / clientes del contrato."
          placeholder="Nuevo cliente"
          items={catBy('client')}
          editable={editable}
          onAdd={(name) => addWorkReportCatalog('client', name)}
          onUpdate={updateWorkReportCatalog}
          onDelete={deleteWorkReportCatalog}
        />
        <CatalogManager
          title="Contratos"
          description="N° o nombre de contratos vigentes."
          placeholder="Nuevo contrato"
          items={catBy('contract')}
          editable={editable}
          onAdd={(name) => addWorkReportCatalog('contract', name)}
          onUpdate={updateWorkReportCatalog}
          onDelete={deleteWorkReportCatalog}
        />
        <CatalogManager
          title="Áreas"
          description="Ej: Carbonato, Hidróxido, Línea 3."
          placeholder="Nueva área"
          items={workReportAreas}
          editable={editable}
          onAdd={addWorkReportArea}
          onUpdate={updateWorkReportArea}
          onDelete={deleteWorkReportArea}
        />
        <CatalogManager
          title="Especialidades"
          description="Ej: Electricidad, Soldadura, FRP, HDPE, Andamios, OCC."
          placeholder="Nueva especialidad"
          items={workReportSpecialties}
          editable={editable}
          onAdd={addWorkReportSpecialty}
          onUpdate={updateWorkReportSpecialty}
          onDelete={deleteWorkReportSpecialty}
        />
        <CatalogManager
          title="Ubicaciones"
          description="Sectores / frentes de trabajo."
          placeholder="Nueva ubicación"
          items={catBy('location')}
          editable={editable}
          onAdd={(name) => addWorkReportCatalog('location', name)}
          onUpdate={updateWorkReportCatalog}
          onDelete={deleteWorkReportCatalog}
        />
        <CatalogManager
          title="Turnos"
          description="Ej: Día, Noche, Turno A, Turno B."
          placeholder="Nuevo turno"
          items={catBy('shift')}
          editable={editable}
          onAdd={(name) => addWorkReportCatalog('shift', name)}
          onUpdate={updateWorkReportCatalog}
          onDelete={deleteWorkReportCatalog}
        />
        <CatalogManager
          title="Jornadas"
          description="Ej: 7x7, 4x3, 5x2, 14x14."
          placeholder="Nueva jornada"
          items={catBy('workschedule')}
          editable={editable}
          onAdd={(name) => addWorkReportCatalog('workschedule', name)}
          onUpdate={updateWorkReportCatalog}
          onDelete={deleteWorkReportCatalog}
        />
        <CatalogManager
          title="Hitos del contrato"
          description="Hitos disponibles para selección rápida."
          placeholder="Nuevo hito"
          items={workReportMilestones}
          editable={editable}
          onAdd={addWorkReportMilestone}
          onUpdate={updateWorkReportMilestone}
          onDelete={deleteWorkReportMilestone}
        />
      </div>
    </PageShell>
  );
}
