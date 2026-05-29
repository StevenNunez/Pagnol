"use client";

import React, { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/modules/core/hooks/use-toast";
import {
  ArrowLeft, Users, UserCheck, UserX, Clock, Plus, Trash2, Moon, Sun,
  MapPin, Building2, CalendarDays, RotateCcw,
} from "lucide-react";
import type { User } from "@/modules/core/lib/data";
import { isWorkDay, isRestDay } from "@/modules/core/hooks/use-attendance";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type WorkerStatus = 'present' | 'left' | 'absent' | 'rest_day';

const STATUS_CONFIG: Record<WorkerStatus, { label: string; cls: string; dot: string }> = {
  present:  { label: "Presente",  cls: "bg-green-500/10 text-green-700 border-green-200",  dot: "bg-green-500" },
  left:     { label: "Salió",     cls: "bg-slate-100 text-slate-600 border-slate-200",     dot: "bg-slate-400" },
  absent:   { label: "Ausente",   cls: "bg-red-500/10 text-red-600 border-red-200",        dot: "bg-red-400" },
  rest_day: { label: "Día Libre", cls: "bg-indigo-50 text-indigo-600 border-indigo-200",   dot: "bg-indigo-300" },
};

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contractId = params.id as string;
  const { toast } = useToast();

  const {
    contracts, contractWorkers, shiftSchedules, users, attendanceLogs,
    addContractWorker, removeContractWorker, updateContractWorker, can,
  } = useAppState();

  const contract = contracts.find(c => c.id === contractId);
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [roleInContract, setRoleInContract] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const canManage = can('contracts:manage') || can('attendance:edit');
  const today = format(new Date(), "yyyy-MM-dd");
  const todayDate = new Date();

  // Workers in this contract
  const assignedWorkers = useMemo(() =>
    contractWorkers.filter(cw => cw.contractId === contractId && !cw.endDate),
    [contractWorkers, contractId]
  );

  const assignedUserIds = useMemo(() => new Set(assignedWorkers.map(cw => cw.userId)), [assignedWorkers]);

  // Users not yet in this contract
  const availableUsers = useMemo(() =>
    users.filter(u => u.role !== 'guardia' && u.role !== 'super-admin' && !assignedUserIds.has(u.id)),
    [users, assignedUserIds]
  );

  // Attendance rows
  const workerRows = useMemo(() => {
    return assignedWorkers.map(cw => {
      const user = users.find(u => u.id === cw.userId);
      const shift = shiftSchedules.find(s => s.id === cw.shiftScheduleId);
      const todayLogs = attendanceLogs
        .filter(l => l.userId === cw.userId && l.date === today)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      let status: WorkerStatus;
      if (shift && isRestDay(todayDate, shift)) {
        status = 'rest_day';
      } else if (todayLogs.length === 0) {
        status = 'absent';
      } else {
        const last = todayLogs[todayLogs.length - 1];
        status = last.type === 'in' ? 'present' : 'left';
      }

      const firstIn = todayLogs.find(l => l.type === 'in');
      const lastOut = [...todayLogs].reverse().find(l => l.type === 'out');
      const formatTime = (d: Date | string) => {
        const dt = d instanceof Date ? d : new Date(d);
        return dt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      };

      return { cw, user, shift, status, firstIn: firstIn ? formatTime(firstIn.timestamp) : null, lastOut: lastOut ? formatTime(lastOut.timestamp) : null };
    });
  }, [assignedWorkers, users, shiftSchedules, attendanceLogs, today]);

  const stats = useMemo(() => ({
    total: workerRows.length,
    present: workerRows.filter(r => r.status === 'present').length,
    absent: workerRows.filter(r => r.status === 'absent').length,
    restDay: workerRows.filter(r => r.status === 'rest_day').length,
  }), [workerRows]);

  const handleAddWorker = async () => {
    if (!selectedUserId) return;
    setIsAdding(true);
    try {
      await addContractWorker(contractId, selectedUserId, selectedShiftId || null, roleInContract || undefined);
      toast({ title: "Trabajador agregado al contrato" });
      setAddWorkerOpen(false);
      setSelectedUserId(""); setSelectedShiftId(""); setRoleInContract("");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveWorker = async (cwId: string, name: string) => {
    if (!confirm(`¿Remover a ${name} del contrato?`)) return;
    try {
      await removeContractWorker(cwId);
      toast({ title: "Trabajador removido" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
        <p>Contrato no encontrado.</p>
        <Button variant="outline" onClick={() => router.push('/dashboard/attendance/contracts')}>
          <ArrowLeft size={14} className="mr-2" /> Volver a contratos
        </Button>
      </div>
    );
  }

  const sc = { active: "bg-green-500/10 text-green-700 border-green-200", suspended: "bg-amber-500/10 text-amber-700 border-amber-200", closed: "bg-slate-100 text-slate-500 border-slate-200" }[contract.status];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start gap-4 flex-wrap">
        <Button variant="ghost" size="icon" className="mt-1 shrink-0" onClick={() => router.push('/dashboard/attendance/contracts')}>
          <ArrowLeft size={18} />
        </Button>
        <div className="flex-1 min-w-0">
          <PageHeader
            title={contract.name}
            description={[contract.clientName, contract.location].filter(Boolean).join(" · ") || "Sin información adicional"}
          />
        </div>
        <Badge variant="outline" className={`shrink-0 text-[10px] font-black uppercase tracking-widest mt-1 ${sc}`}>
          {contract.status === 'active' ? 'Activo' : contract.status === 'suspended' ? 'Suspendido' : 'Cerrado'}
        </Badge>
      </div>

      {/* Info strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Dotación Total",    value: stats.total,   icon: Users,     color: "text-slate-700", bg: "bg-slate-100" },
          { label: "Presentes Hoy",     value: stats.present, icon: UserCheck, color: "text-green-700", bg: "bg-green-50" },
          { label: "Ausentes Hoy",      value: stats.absent,  icon: UserX,     color: "text-red-600",   bg: "bg-red-50" },
          { label: "Día Libre (turno)", value: stats.restDay, icon: RotateCcw, color: "text-indigo-600", bg: "bg-indigo-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`${bg} rounded-2xl p-4 flex items-center gap-3`}>
            <div className={`${color} shrink-0`}><Icon size={20} /></div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className={`text-2xl font-black tracking-tighter ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="attendance">
        <TabsList className="rounded-xl">
          <TabsTrigger value="attendance" className="rounded-lg">Asistencia de Hoy</TabsTrigger>
          <TabsTrigger value="workers" className="rounded-lg">Personal ({stats.total})</TabsTrigger>
          <TabsTrigger value="info" className="rounded-lg">Datos del Contrato</TabsTrigger>
        </TabsList>

        {/* Attendance tab */}
        <TabsContent value="attendance" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {workerRows.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">Sin trabajadores asignados a este contrato.</div>
              ) : (
                <div className="divide-y divide-border">
                  {workerRows.map(({ cw, user: u, shift, status, firstIn, lastOut }) => {
                    const cfg = STATUS_CONFIG[status];
                    return (
                      <div key={cw.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/50">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 font-black text-sm flex items-center justify-center shrink-0 uppercase">
                          {(u?.name ?? "?").split(' ').map(n => n[0]).join('').substring(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm truncate">{u?.name ?? "Desconocido"}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{u?.cargo ?? cw.roleInContract ?? u?.role}</p>
                            {shift && (
                              <Badge variant="outline" className="text-[8px] font-black h-4 px-1.5">
                                {shift.isNightShift ? <Moon size={8} className="mr-0.5" /> : <Sun size={8} className="mr-0.5" />}
                                {shift.name}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="hidden md:flex items-center gap-5 text-xs shrink-0">
                          <span className="text-green-600 font-bold">{firstIn ?? '—'}</span>
                          <span className="text-slate-400 font-bold">{lastOut ?? '—'}</span>
                        </div>
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest shrink-0 ${cfg.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Workers tab */}
        <TabsContent value="workers" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm">Personal Asignado</CardTitle>
                <CardDescription>Trabajadores y sus turnos de rotación en este contrato.</CardDescription>
              </div>
              {canManage && (
                <Button size="sm" onClick={() => setAddWorkerOpen(true)} className="gap-1.5 text-[10px] font-black uppercase tracking-widest">
                  <Plus size={14} /> Agregar
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {assignedWorkers.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">
                  Sin trabajadores asignados.{canManage && " Agrega personal con el botón de arriba."}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {assignedWorkers.map(cw => {
                    const u = users.find(u => u.id === cw.userId);
                    const shift = shiftSchedules.find(s => s.id === cw.shiftScheduleId);
                    return (
                      <div key={cw.id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/50">
                        <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 font-black text-xs flex items-center justify-center shrink-0 uppercase">
                          {(u?.name ?? "?").split(' ').map(n => n[0]).join('').substring(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{u?.name ?? cw.userId}</p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{cw.roleInContract || u?.cargo || u?.role}</p>
                        </div>
                        {shift ? (
                          <div className="hidden sm:flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest gap-1">
                              {shift.isNightShift ? <Moon size={9} /> : <Sun size={9} />}
                              {shift.name}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground font-mono">{shift.workStart}–{shift.workEnd}</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic hidden sm:block">Sin turno</span>
                        )}
                        {canManage && (
                          <Select
                            value={cw.shiftScheduleId ?? "none"}
                            onValueChange={async (val) => {
                              try {
                                await updateContractWorker(cw.id, { shiftScheduleId: val === "none" ? null : val });
                                toast({ title: "Turno actualizado" });
                              } catch (e: any) {
                                toast({ variant: "destructive", title: "Error", description: e.message });
                              }
                            }}
                          >
                            <SelectTrigger className="w-36 h-7 text-[10px]"><SelectValue placeholder="Asignar turno" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sin turno</SelectItem>
                              {shiftSchedules.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        {canManage && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0"
                            onClick={() => handleRemoveWorker(cw.id, u?.name ?? "trabajador")}>
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Info tab */}
        <TabsContent value="info" className="mt-4">
          <Card>
            <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
              {[
                { icon: Building2, label: "Empresa mandante", value: contract.clientName },
                { icon: MapPin,    label: "Faena / Ubicación", value: contract.location },
                { icon: CalendarDays, label: "Fecha de inicio", value: typeof contract.startDate === 'string' ? contract.startDate.substring(0, 10) : format(new Date(contract.startDate), "dd/MM/yyyy") },
                { icon: CalendarDays, label: "Fecha de término", value: contract.endDate ? (typeof contract.endDate === 'string' ? contract.endDate.substring(0, 10) : format(new Date(contract.endDate), "dd/MM/yyyy")) : "Indefinido" },
              ].filter(i => i.value).map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3">
                  <Icon size={16} className="text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
                    <p className="font-semibold">{value}</p>
                  </div>
                </div>
              ))}
              {contract.description && (
                <div className="col-span-full">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Descripción</p>
                  <p className="text-muted-foreground">{contract.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add worker dialog */}
      <Dialog open={addWorkerOpen} onOpenChange={setAddWorkerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Agregar trabajador al contrato</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Trabajador</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger><SelectValue placeholder="Selecciona un trabajador..." /></SelectTrigger>
                <SelectContent>
                  {availableUsers.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      <span className="font-semibold">{u.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{u.cargo || u.role}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Turno de trabajo</Label>
              <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
                <SelectTrigger><SelectValue placeholder="Selecciona un turno (opcional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin turno asignado</SelectItem>
                  {shiftSchedules.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{s.shiftType} · {s.workStart}–{s.workEnd}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Rol en el contrato <span className="text-muted-foreground">(opcional)</span></Label>
              <Input placeholder="Ej: Operador LHD, Supervisor de guardia..." value={roleInContract} onChange={e => setRoleInContract(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleAddWorker} disabled={!selectedUserId || isAdding}>Agregar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
