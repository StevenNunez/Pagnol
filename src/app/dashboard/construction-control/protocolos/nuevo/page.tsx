'use client';

import React, { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { AlertCircle, BookOpen, FileCheck, ArrowRight, ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { ProtocolTemplate } from '@/modules/core/lib/data';
import { cn } from '@/lib/utils';

type Step = 'select-template' | 'fill-info';

export default function NuevoProtocoloPage() {
  const { can } = useAuth();
  const { protocolTemplates, workItems, createProtocol } = useAppState();
  const { toast } = useToast();
  const router = useRouter();

  const [step, setStep] = useState<Step>('select-template');
  const [selectedTemplate, setSelectedTemplate] = useState<ProtocolTemplate | null>(null);
  const [useBlank, setUseBlank] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'inicio' | 'entrega'>('inicio');
  const [activityType, setActivityType] = useState('');
  const [obra, setObra] = useState('');
  const [workItemId, setWorkItemId] = useState<string>('none');

  const leafWorkItems = (workItems || []).filter(
    wi => !(workItems || []).some(other => other.parentId === wi.id)
  );

  const handleSelectTemplate = (tmpl: ProtocolTemplate | null) => {
    setSelectedTemplate(tmpl);
    setUseBlank(tmpl === null);
    if (tmpl) {
      setTitle(tmpl.title);
      setType(tmpl.type);
      setActivityType(tmpl.activityType);
    } else {
      setTitle('');
      setType('inicio');
      setActivityType('');
    }
    setStep('fill-info');
  };

  const handleCreate = async () => {
    if (!title.trim() || !obra.trim()) {
      toast({ variant: 'destructive', title: 'Campos requeridos', description: 'Título y obra son obligatorios.' });
      return;
    }
    setSaving(true);
    try {
      const baseTemplate = selectedTemplate;
      const protocolId = await createProtocol({
        templateId: baseTemplate?.id ?? null,
        workItemId: workItemId === 'none' ? null : workItemId,
        title,
        type,
        activityType,
        obra,
        objective: baseTemplate?.objective ?? '',
        normativa: baseTemplate?.normativa ?? [],
        responsibilities: baseTemplate?.responsibilities ?? [],
        items: (baseTemplate?.items ?? []).map(it => ({
          element: it.element,
          si: false, no: false, na: false,
        })),
      });
      toast({ title: 'Protocolo creado', className: 'border-green-500' });
      router.push(`/dashboard/construction-control/protocolos/${protocolId}`);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (!can('module_construction_control:view')) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Acceso Denegado</AlertTitle>
        <AlertDescription>No tienes permisos para acceder a este módulo.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Nuevo Protocolo"
        description="Crea un protocolo de calidad para una actividad de obra."
      />

      {step === 'select-template' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Selecciona una plantilla como base o crea un protocolo en blanco:</p>

          {/* Opción en blanco */}
          <Card
            className="rounded-[1.5rem] border-2 border-dashed border-slate-200 bg-slate-50 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            onClick={() => handleSelectTemplate(null)}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-2xl bg-slate-200 flex items-center justify-center">
                <FileCheck size={20} className="text-slate-500" />
              </div>
              <div>
                <p className="font-bold text-sm">Protocolo en Blanco</p>
                <p className="text-xs text-muted-foreground">Sin elementos predefinidos. Llena todo desde cero.</p>
              </div>
              <ArrowRight size={16} className="ml-auto text-muted-foreground" />
            </CardContent>
          </Card>

          {protocolTemplates.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">o usa una plantilla</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="grid gap-3">
                {protocolTemplates.map(tmpl => (
                  <Card
                    key={tmpl.id}
                    className="rounded-[1.5rem] border-none shadow-md bg-slate-50 cursor-pointer hover:shadow-lg hover:bg-primary/5 transition-all"
                    onClick={() => handleSelectTemplate(tmpl)}
                  >
                    <CardContent className="p-5 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <BookOpen size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-sm">{tmpl.title}</p>
                          <Badge variant="outline" className="text-[10px] rounded-full">
                            {tmpl.type === 'inicio' ? 'Inicio' : 'Entrega'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {tmpl.items.length} elementos · {tmpl.activityType || 'General'}
                        </p>
                      </div>
                      <ArrowRight size={16} className="text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {step === 'fill-info' && (
        <div className="flex flex-col gap-5">
          <Button
            variant="ghost"
            className="gap-2 w-fit -ml-2 text-sm text-muted-foreground rounded-xl"
            onClick={() => setStep('select-template')}
          >
            <ArrowLeft size={14} /> Volver a plantillas
          </Button>

          {selectedTemplate && (
            <div className="flex items-center gap-2 px-4 py-3 bg-primary/5 rounded-2xl border border-primary/20">
              <BookOpen size={14} className="text-primary shrink-0" />
              <p className="text-sm text-primary font-medium">Usando plantilla: <strong>{selectedTemplate.title}</strong></p>
            </div>
          )}

          <Card className="rounded-[1.5rem] border-none shadow-lg bg-slate-50">
            <CardContent className="p-6 space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="title">Título del Protocolo *</Label>
                <Input
                  id="title"
                  className="rounded-xl"
                  placeholder="Ej: Protocolo de Inicio — Hormigonado Losa 3er Piso"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={type} onValueChange={v => setType(v as any)}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inicio">Protocolo de Inicio</SelectItem>
                      <SelectItem value="entrega">Protocolo de Entrega</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo de Actividad</Label>
                  <Input
                    className="rounded-xl"
                    placeholder="Hormigonado, Enfierradura..."
                    value={activityType}
                    onChange={e => setActivityType(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="obra">Obra / Ubicación *</Label>
                <Input
                  id="obra"
                  className="rounded-xl"
                  placeholder="Ej: Edificio Torre Norte, Sector A"
                  value={obra}
                  onChange={e => setObra(e.target.value)}
                />
              </div>

              {leafWorkItems.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Partida EDT (opcional)</Label>
                  <Select value={workItemId} onValueChange={setWorkItemId}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Seleccionar partida..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin partida asociada</SelectItem>
                      {leafWorkItems.map(wi => (
                        <SelectItem key={wi.id} value={wi.id}>
                          {wi.name} <span className="text-muted-foreground font-mono text-xs ml-1">{wi.path}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button variant="outline" className="rounded-xl" onClick={() => router.push('/dashboard/construction-control/protocolos')}>
              Cancelar
            </Button>
            <Button className="rounded-xl gap-2" onClick={handleCreate} disabled={saving}>
              {saving && <span className="animate-spin">⟳</span>}
              Crear Protocolo <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
