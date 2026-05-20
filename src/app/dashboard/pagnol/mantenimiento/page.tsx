"use client";

import React, { useState, useMemo } from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Wrench,
  Clock,
  Activity,
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
  Plus,
  ArrowRight,
  ShieldCheck,
  FileSearch,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { MaintenanceOrder } from '@/modules/core/lib/data';

const OT_TYPES: { value: MaintenanceOrder['type']; label: string }[] = [
  { value: 'PREVENTIVE', label: 'Preventivo' },
  { value: 'CORRECTIVE', label: 'Correctivo' },
  { value: 'PREDICTIVE', label: 'Predictivo' },
];

const OT_PRIORITIES: { value: MaintenanceOrder['priority']; label: string; color: string }[] = [
  { value: 'LOW', label: 'Baja', color: 'bg-green-500 hover:bg-green-600' },
  { value: 'MEDIUM', label: 'Media', color: 'bg-yellow-500 hover:bg-yellow-600 text-yellow-950' },
  { value: 'HIGH', label: 'Alta', color: 'bg-orange-500 hover:bg-orange-600' },
  { value: 'CRITICAL', label: 'Crítica', color: 'bg-red-500 hover:bg-red-600' },
];

const getPriorityColor = (priority: string) => {
  return OT_PRIORITIES.find(p => p.value === priority)?.color ?? 'bg-slate-500 hover:bg-slate-600';
};

const getPriorityLabel = (priority: string) => {
  return OT_PRIORITIES.find(p => p.value === priority)?.label ?? priority;
};

const getTypeLabel = (type: string) => {
  return OT_TYPES.find(t => t.value === type)?.label ?? type;
};

interface NewOTForm {
  materialId: string;
  materialName: string;
  type: MaintenanceOrder['type'];
  priority: MaintenanceOrder['priority'];
  description: string;
  scheduledDate: string;
  assignedToId: string;
  assignedToName: string;
}

const EMPTY_FORM: NewOTForm = {
  materialId: '',
  materialName: '',
  type: 'PREVENTIVE',
  priority: 'MEDIUM',
  description: '',
  scheduledDate: '',
  assignedToId: '',
  assignedToName: '',
};

export default function MantenimientoPage() {
  const { maintenanceOrders, maintenanceLogs, materials, users, addMaintenanceOrder, closeMaintenanceOrder, notify } = useAppState();

  const [selectedOrder, setSelectedOrder] = useState<MaintenanceOrder | null>(null);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [rcaText, setRcaText] = useState('');
  const [preventiveText, setPreventiveText] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const [isNewOTOpen, setIsNewOTOpen] = useState(false);
  const [form, setForm] = useState<NewOTForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // KPIs
  const kpis = useMemo(() => {
    const completedOrders = maintenanceOrders.filter(o => o.status === 'COMPLETED');
    const totalDowntime = completedOrders.reduce((sum, o) => sum + (o.downtimeHours || 0), 0);
    const avgMttr = completedOrders.length > 0 ? (totalDowntime / completedOrders.length).toFixed(1) : '0';

    const totalOperatingHours = 30 * 24 * Math.max(materials.length, 1);
    const failures = maintenanceOrders.filter(o => o.type === 'CORRECTIVE').length;
    const avgMtbf = failures > 0 ? (totalOperatingHours / failures / 24).toFixed(1) : '>30';

    const availability = totalOperatingHours > 0
      ? (((totalOperatingHours - totalDowntime) / totalOperatingHours) * 100).toFixed(2)
      : '100.00';

    return {
      avgMttr,
      avgMtbf,
      availability,
      totalOrders: maintenanceOrders.length,
      openOrders: maintenanceOrders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length,
    };
  }, [maintenanceOrders, materials]);

  const handleOpenCloseModal = (order: MaintenanceOrder) => {
    setSelectedOrder(order);
    setRcaText(order.rootCauseAnalysis || '');
    setPreventiveText(order.preventiveAction || '');
    setIsCloseModalOpen(true);
  };

  const handleCloseOrder = async () => {
    if (!selectedOrder) return;
    setIsClosing(true);
    try {
      await closeMaintenanceOrder(selectedOrder.id, {
        rootCauseAnalysis: rcaText,
        preventiveAction: preventiveText,
      });
      notify('Orden de trabajo cerrada correctamente.', 'success');
      setIsCloseModalOpen(false);
    } catch (e: any) {
      notify(e.message || 'Error al cerrar la OT.', 'destructive');
    } finally {
      setIsClosing(false);
    }
  };

  const handleNewOTSubmit = async () => {
    setFormError('');
    if (!form.materialId) { setFormError('Selecciona un activo.'); return; }
    if (!form.description.trim()) { setFormError('La descripción es obligatoria.'); return; }
    setIsSaving(true);
    try {
      await addMaintenanceOrder({
        materialId: form.materialId,
        materialName: form.materialName,
        type: form.type,
        status: 'OPEN',
        priority: form.priority,
        description: form.description,
        scheduledDate: form.scheduledDate || null,
        assignedTo: form.assignedToId || undefined,
        assignedToName: form.assignedToName || undefined,
      });
      notify('Orden de trabajo creada.', 'success');
      setForm(EMPTY_FORM);
      setIsNewOTOpen(false);
    } catch (e: any) {
      setFormError(e.message || 'Error al crear la OT.');
    } finally {
      setIsSaving(false);
    }
  };

  const maintainers = useMemo(() =>
    users.filter(u => ['jefe-mantencion', 'operador', 'supervisor', 'administrador'].includes(u.role)),
    [users]
  );

  return (
    <div className="flex flex-col h-full bg-background">
      <PageHeader
        title="Gestión de Mantenimiento"
        description="ISO 55001 — Órdenes de Trabajo y Confiabilidad de Activos"
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Actions Bar */}
        <div className="flex justify-end">
          <Button
            onClick={() => setIsNewOTOpen(true)}
            className="rounded-2xl h-11 px-6 bg-pagnol-orange hover:bg-orange-600 text-white font-black uppercase text-[10px] tracking-widest shadow-xl shadow-orange-500/20"
          >
            <Plus size={16} className="mr-2" /> Nueva OT
          </Button>
        </div>

        {/* KPI Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="rounded-[2rem] border-none shadow-sm bg-white overflow-hidden group hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Disponibilidad Física</p>
                  <h3 className="text-3xl font-black text-pagnol-dark mt-2 tracking-tighter">{kpis.availability}%</h3>
                </div>
                <div className="p-3 rounded-2xl bg-green-50 text-green-600">
                  <Activity size={24} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-sm bg-white overflow-hidden group hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">MTBF (Confiabilidad)</p>
                  <h3 className="text-3xl font-black text-pagnol-dark mt-2 tracking-tighter">{kpis.avgMtbf} <span className="text-sm text-muted-foreground">días</span></h3>
                </div>
                <div className="p-3 rounded-2xl bg-blue-50 text-blue-600">
                  <ShieldCheck size={24} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-sm bg-white overflow-hidden group hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">MTTR (Mantenibilidad)</p>
                  <h3 className="text-3xl font-black text-pagnol-dark mt-2 tracking-tighter">{kpis.avgMttr} <span className="text-sm text-muted-foreground">hrs</span></h3>
                </div>
                <div className="p-3 rounded-2xl bg-orange-50 text-orange-600">
                  <Clock size={24} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-sm bg-white overflow-hidden group hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Órdenes Abiertas</p>
                  <h3 className="text-3xl font-black text-pagnol-dark mt-2 tracking-tighter">{kpis.openOrders}</h3>
                </div>
                <div className="p-3 rounded-2xl bg-red-50 text-red-600">
                  <AlertTriangle size={24} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Work Orders List */}
        <Card className="rounded-[2rem] border-none shadow-sm bg-white">
          <CardHeader className="border-b px-8 py-6">
            <CardTitle className="text-sm font-black uppercase tracking-widest text-pagnol-dark">Órdenes de Trabajo (OT)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-8 py-4 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground">ID / Tipo</th>
                    <th className="px-8 py-4 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground">Activo</th>
                    <th className="px-8 py-4 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground">Prioridad</th>
                    <th className="px-8 py-4 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground">Estado</th>
                    <th className="px-8 py-4 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground">Asignado</th>
                    <th className="px-8 py-4 text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {maintenanceOrders.map(order => (
                    <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-sm">{order.internalCode || order.id.slice(0, 8).toUpperCase()}</span>
                          <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">{getTypeLabel(order.type)}</span>
                        </div>
                      </td>
                      <td className="px-8 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-pagnol-dark">{order.materialName}</span>
                          <span className="text-[10px] font-bold text-muted-foreground truncate max-w-[220px]">{order.description}</span>
                        </div>
                      </td>
                      <td className="px-8 py-4">
                        <Badge className={getPriorityColor(order.priority)}>{getPriorityLabel(order.priority)}</Badge>
                      </td>
                      <td className="px-8 py-4">
                        <span className="flex items-center gap-2 text-xs font-bold uppercase">
                          {order.status === 'COMPLETED'
                            ? <CheckCircle2 size={14} className="text-green-500" />
                            : <CalendarClock size={14} className="text-orange-500" />}
                          {order.status}
                        </span>
                      </td>
                      <td className="px-8 py-4">
                        <span className="text-xs text-muted-foreground font-medium">{order.assignedToName || '—'}</span>
                      </td>
                      <td className="px-8 py-4 text-right">
                        {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? (
                          <Button onClick={() => handleOpenCloseModal(order)} variant="outline" size="sm" className="rounded-xl text-xs font-bold">
                            Cerrar OT <ArrowRight size={14} className="ml-2" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="rounded-xl text-xs font-bold text-muted-foreground">
                            Ver Reporte <FileSearch size={14} className="ml-2" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {maintenanceOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-8 py-16 text-center">
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <Wrench size={32} className="opacity-30" />
                          <p className="text-sm font-medium">No hay órdenes de trabajo registradas.</p>
                          <Button onClick={() => setIsNewOTOpen(true)} variant="outline" size="sm" className="rounded-xl text-xs font-bold mt-2">
                            <Plus size={14} className="mr-2" /> Crear primera OT
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* === MODAL: Nueva OT === */}
      <Dialog open={isNewOTOpen} onOpenChange={setIsNewOTOpen}>
        <DialogContent className="max-w-2xl rounded-[2rem] p-0 overflow-hidden border-none shadow-2xl">
          <DialogHeader className="p-8 bg-slate-900 text-white">
            <DialogTitle className="text-2xl font-black uppercase tracking-tight">Nueva Orden de Trabajo</DialogTitle>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">ISO 55001 — Gestión de Mantenimiento</p>
          </DialogHeader>
          <div className="p-8 space-y-5 max-h-[65vh] overflow-y-auto">

            {/* Activo */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Activo *</Label>
              <Select
                value={form.materialId}
                onValueChange={(val) => {
                  const mat = materials.find(m => m.id === val);
                  setForm(f => ({ ...f, materialId: val, materialName: mat?.name || '' }));
                }}
              >
                <SelectTrigger className="rounded-2xl py-6">
                  <SelectValue placeholder="Seleccionar activo..." />
                </SelectTrigger>
                <SelectContent>
                  {materials.filter(m => !m.archived).map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="font-medium">{m.name}</span>
                      {m.internalCode && <span className="ml-2 text-xs text-muted-foreground">{m.internalCode}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo + Prioridad */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Tipo *</Label>
                <Select value={form.type} onValueChange={(val: MaintenanceOrder['type']) => setForm(f => ({ ...f, type: val }))}>
                  <SelectTrigger className="rounded-2xl py-6">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Prioridad *</Label>
                <Select value={form.priority} onValueChange={(val: MaintenanceOrder['priority']) => setForm(f => ({ ...f, priority: val }))}>
                  <SelectTrigger className="rounded-2xl py-6">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OT_PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Descripción */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Descripción del trabajo *</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe el trabajo a realizar, síntoma de la falla o tarea preventiva..."
                className="min-h-[100px] rounded-2xl resize-none py-4"
              />
            </div>

            {/* Fecha programada + Asignado */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Fecha Programada</Label>
                <Input
                  type="date"
                  value={form.scheduledDate}
                  onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                  className="rounded-2xl py-6"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Asignado a</Label>
                <Select
                  value={form.assignedToId}
                  onValueChange={(val) => {
                    const u = maintainers.find(m => m.id === val);
                    setForm(f => ({ ...f, assignedToId: val, assignedToName: u?.name || '' }));
                  }}
                >
                  <SelectTrigger className="rounded-2xl py-6">
                    <SelectValue placeholder="Sin asignar" />
                  </SelectTrigger>
                  <SelectContent>
                    {maintainers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-500 font-medium bg-red-50 rounded-2xl px-4 py-3">{formError}</p>
            )}
          </div>
          <DialogFooter className="p-8 border-t bg-slate-50 flex justify-between">
            <Button variant="ghost" onClick={() => { setIsNewOTOpen(false); setForm(EMPTY_FORM); setFormError(''); }} className="rounded-2xl text-xs font-bold uppercase">
              <X size={14} className="mr-2" /> Cancelar
            </Button>
            <Button
              onClick={handleNewOTSubmit}
              disabled={isSaving}
              className="rounded-2xl text-xs font-black uppercase tracking-widest bg-pagnol-orange hover:bg-orange-600 text-white shadow-xl shadow-orange-500/20"
            >
              {isSaving ? 'Creando...' : 'Crear Orden de Trabajo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === MODAL: Cerrar OT (RCA) === */}
      <Dialog open={isCloseModalOpen} onOpenChange={setIsCloseModalOpen}>
        <DialogContent className="max-w-xl rounded-[2rem] p-0 overflow-hidden border-none shadow-2xl">
          <DialogHeader className="p-8 bg-slate-900 text-white">
            <DialogTitle className="text-2xl font-black uppercase tracking-tight">Cierre de Orden Técnica</DialogTitle>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
              Documentación RCA — ISO 55001 · {selectedOrder?.internalCode || selectedOrder?.id.slice(0, 8).toUpperCase()}
            </p>
          </DialogHeader>
          <div className="p-8 space-y-6">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Análisis de Causa Raíz (RCA) *</Label>
              <Textarea
                value={rcaText}
                onChange={e => setRcaText(e.target.value)}
                placeholder="Describa la falla principal, por qué ocurrió y qué se hizo para repararla..."
                className="min-h-[120px] rounded-2xl resize-none py-4"
              />
              <p className="text-[10px] text-muted-foreground ml-2">Obligatorio para eventos correctivos clase A/B.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-2">Acción Preventiva</Label>
              <Textarea
                value={preventiveText}
                onChange={e => setPreventiveText(e.target.value)}
                placeholder="¿Qué se hará para evitar la recurrencia de esta falla?..."
                className="min-h-[80px] rounded-2xl resize-none py-4"
              />
            </div>
          </div>
          <DialogFooter className="p-8 border-t bg-slate-50 flex justify-between">
            <Button variant="ghost" onClick={() => setIsCloseModalOpen(false)} className="rounded-2xl text-xs font-bold uppercase">Cancelar</Button>
            <Button
              onClick={handleCloseOrder}
              disabled={isClosing}
              className="rounded-2xl text-xs font-black uppercase tracking-widest bg-pagnol-orange hover:bg-orange-600 text-white shadow-xl shadow-orange-500/20"
            >
              {isClosing ? 'Cerrando...' : 'Registrar Cierre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
