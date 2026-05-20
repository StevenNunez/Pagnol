'use client';

import React, { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import {
  AlertCircle, Plus, BookOpen, Trash2, ChevronDown, ChevronRight,
  GripVertical, X, PlusCircle,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/modules/core/hooks/use-toast';
import { ProtocolTemplate, ProtocolNormativa, ProtocolResponsibility } from '@/modules/core/lib/data';

export default function PlantillasPage() {
  const { can } = useAuth();
  const { protocolTemplates, addProtocolTemplate, deleteProtocolTemplate } = useAppState();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    title: '',
    type: 'inicio' as 'inicio' | 'entrega',
    activityType: '',
    objective: '',
  });
  const [normativa, setNormativa] = useState<ProtocolNormativa[]>([{ code: '', description: '' }]);
  const [responsibilities, setResponsibilities] = useState<ProtocolResponsibility[]>([{ role: '', description: '' }]);
  const [items, setItems] = useState<string[]>(['']);

  const resetForm = () => {
    setForm({ title: '', type: 'inicio', activityType: '', objective: '' });
    setNormativa([{ code: '', description: '' }]);
    setResponsibilities([{ role: '', description: '' }]);
    setItems(['']);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.objective.trim()) {
      toast({ variant: 'destructive', title: 'Campos requeridos', description: 'Título y objetivo son obligatorios.' });
      return;
    }
    const cleanItems = items.filter(i => i.trim()).map(element => ({ element }));
    if (cleanItems.length === 0) {
      toast({ variant: 'destructive', title: 'Sin elementos', description: 'Agrega al menos un elemento de verificación.' });
      return;
    }
    setSaving(true);
    try {
      await addProtocolTemplate({
        ...form,
        normativa: normativa.filter(n => n.code.trim()),
        responsibilities: responsibilities.filter(r => r.role.trim()),
        items: cleanItems,
      });
      toast({ title: 'Plantilla creada', className: 'border-green-500' });
      setShowForm(false);
      resetForm();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: ProtocolTemplate) => {
    try {
      await deleteProtocolTemplate(template.id);
      toast({ title: 'Plantilla eliminada', className: 'border-green-500' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  if (!can('construction_control:review_protocols')) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Acceso Denegado</AlertTitle>
        <AlertDescription>Solo el encargado de calidad puede gestionar plantillas.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Plantillas de Protocolos"
        description="Define las plantillas base para los protocolos de inicio y entrega de actividades."
      />

      <div className="flex justify-end">
        <Button className="gap-2 rounded-xl" onClick={() => setShowForm(true)}>
          <Plus size={15} /> Nueva Plantilla
        </Button>
      </div>

      {protocolTemplates.length === 0 ? (
        <Card className="rounded-[1.5rem] border-none shadow-lg bg-slate-50">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <BookOpen size={40} className="text-muted-foreground/40" />
            <div>
              <p className="font-semibold text-muted-foreground">Sin plantillas</p>
              <p className="text-sm text-muted-foreground/70 mt-1">Crea la primera plantilla para estandarizar los protocolos de tu obra.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {protocolTemplates.map(tmpl => (
            <Card key={tmpl.id} className="rounded-[1.5rem] border-none shadow-md bg-slate-50 dark:bg-slate-800/50">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <BookOpen size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm">{tmpl.title}</p>
                      <Badge variant="outline" className="text-[10px] rounded-full">
                        {tmpl.type === 'inicio' ? 'Inicio' : 'Entrega'}
                      </Badge>
                      {tmpl.activityType && (
                        <Badge variant="secondary" className="text-[10px] rounded-full">{tmpl.activityType}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tmpl.items.length} elementos · {tmpl.normativa.length} normas
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 rounded-xl"
                      onClick={() => setExpandedId(expandedId === tmpl.id ? null : tmpl.id)}
                    >
                      {expandedId === tmpl.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl">
                          <Trash2 size={14} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-[1.5rem]">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Eliminar plantilla</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se eliminará &quot;{tmpl.title}&quot;. Los protocolos existentes no se verán afectados.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                          <AlertDialogAction className="rounded-xl bg-red-600 hover:bg-red-700" onClick={() => handleDelete(tmpl)}>
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                {expandedId === tmpl.id && (
                  <div className="mt-4 pl-12 space-y-4 text-sm">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Objetivo</p>
                      <p className="text-sm">{tmpl.objective}</p>
                    </div>
                    {tmpl.normativa.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Normativa</p>
                        <div className="space-y-1">
                          {tmpl.normativa.map((n, i) => (
                            <div key={i} className="flex gap-2">
                              <Badge variant="outline" className="text-[10px] rounded shrink-0">{n.code}</Badge>
                              <p className="text-xs text-muted-foreground">{n.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {tmpl.items.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Elementos a verificar</p>
                        <ol className="space-y-0.5 list-decimal list-inside">
                          {tmpl.items.map((item, i) => (
                            <li key={i} className="text-xs text-muted-foreground">{item.element}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog: Nueva Plantilla */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="rounded-[1.5rem] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva Plantilla de Protocolo</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Info básica */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Título *</Label>
                <Input
                  placeholder="Ej: Protocolo de Inicio de Enfierradura"
                  className="rounded-xl"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as any }))}>
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
                  placeholder="Ej: Hormigonado, Enfierradura..."
                  className="rounded-xl"
                  value={form.activityType}
                  onChange={e => setForm(f => ({ ...f, activityType: e.target.value }))}
                />
              </div>
            </div>

            {/* Objetivo */}
            <div className="space-y-1.5">
              <Label>Objetivo *</Label>
              <Textarea
                placeholder="Describe el objetivo de este protocolo..."
                className="rounded-xl min-h-[80px]"
                value={form.objective}
                onChange={e => setForm(f => ({ ...f, objective: e.target.value }))}
              />
            </div>

            {/* Normativa */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Normativa Aplicable</Label>
                <Button
                  variant="ghost" size="sm" className="gap-1 text-xs h-7 rounded-lg"
                  onClick={() => setNormativa(n => [...n, { code: '', description: '' }])}
                >
                  <PlusCircle size={12} /> Agregar
                </Button>
              </div>
              {normativa.map((n, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <Input
                    placeholder="NCh XXX"
                    className="rounded-xl w-28 shrink-0"
                    value={n.code}
                    onChange={e => setNormativa(ns => ns.map((x, j) => j === i ? { ...x, code: e.target.value } : x))}
                  />
                  <Input
                    placeholder="Descripción de la norma"
                    className="rounded-xl flex-1"
                    value={n.description}
                    onChange={e => setNormativa(ns => ns.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                  />
                  {normativa.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-red-400 hover:text-red-600 rounded-xl"
                      onClick={() => setNormativa(ns => ns.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Responsabilidades */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Responsabilidades</Label>
                <Button
                  variant="ghost" size="sm" className="gap-1 text-xs h-7 rounded-lg"
                  onClick={() => setResponsibilities(r => [...r, { role: '', description: '' }])}
                >
                  <PlusCircle size={12} /> Agregar
                </Button>
              </div>
              {responsibilities.map((r, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <Input
                    placeholder="Rol"
                    className="rounded-xl w-36 shrink-0"
                    value={r.role}
                    onChange={e => setResponsibilities(rs => rs.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                  />
                  <Input
                    placeholder="Descripción de la responsabilidad"
                    className="rounded-xl flex-1"
                    value={r.description}
                    onChange={e => setResponsibilities(rs => rs.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                  />
                  {responsibilities.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-red-400 hover:text-red-600 rounded-xl"
                      onClick={() => setResponsibilities(rs => rs.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Elementos de verificación */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Elementos de Verificación *</Label>
                <Button
                  variant="ghost" size="sm" className="gap-1 text-xs h-7 rounded-lg"
                  onClick={() => setItems(it => [...it, ''])}
                >
                  <PlusCircle size={12} /> Agregar
                </Button>
              </div>
              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <span className="text-xs font-mono text-muted-foreground w-5 text-right shrink-0">{i + 1}.</span>
                  <Input
                    placeholder="Describe el elemento a verificar..."
                    className="rounded-xl flex-1"
                    value={item}
                    onChange={e => setItems(it => it.map((x, j) => j === i ? e.target.value : x))}
                  />
                  {items.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-red-400 hover:text-red-600 rounded-xl"
                      onClick={() => setItems(it => it.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => { setShowForm(false); resetForm(); }}>
              Cancelar
            </Button>
            <Button className="rounded-xl gap-2" onClick={handleSave} disabled={saving}>
              {saving && <span className="animate-spin">⟳</span>}
              Crear Plantilla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
