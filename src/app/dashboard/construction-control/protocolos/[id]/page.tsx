'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import {
  AlertCircle, CheckCircle2, XCircle, Clock, Save, Send, ArrowLeft,
  Camera, Trash2, Pen, CheckSquare, ChevronDown, ChevronRight,
  FileCheck, User, Shield, Star,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/modules/core/hooks/use-toast';
import SignaturePad from '@/components/signature-pad';
import { ProtocolItem, ProtocolSignature } from '@/modules/core/lib/data';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import Link from 'next/link';

type SINoNA = 'si' | 'no' | 'na';

export default function ProtocolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, can } = useAuth();
  const {
    protocols, users,
    saveProtocolDraft, submitProtocolForReview,
    approveProtocol, rejectProtocol,
  } = useAppState();
  const { toast } = useToast();

  const protocol = useMemo(() => (protocols || []).find(p => p.id === id), [protocols, id]);

  // Local editable state (items)
  const [items, setItems] = useState<ProtocolItem[]>([]);
  const [evidencePhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Signature dialogs
  const [showExecutorSig, setShowExecutorSig] = useState(false);
  const [showSupervisorSig, setShowSupervisorSig] = useState(false);
  const [showQMSig, setShowQMSig] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const [executorSignature, setExecutorSignature] = useState<ProtocolSignature | null>(null);
  const [supervisorSignature, setSupervisorSignature] = useState<ProtocolSignature | null>(null);

  const executorSigRef = useRef<any>(null);
  const supervisorSigRef = useRef<any>(null);
  const qmSigRef = useRef<any>(null);

  const canReview = can('construction_control:review_protocols');
  const isDraft = protocol?.status === 'borrador';
  const isPending = protocol?.status === 'pendiente_revision';
  const isApproved = protocol?.status === 'aprobado';
  const isRejected = protocol?.status === 'rechazado';
  const isReadOnly = !isDraft;

  useEffect(() => {
    if (protocol) {
      setItems(protocol.items.map(item => ({ ...item })));
      setExecutorSignature(protocol.executorSignature ?? null);
      setSupervisorSignature(protocol.supervisorSignature ?? null);
    }
  }, [protocol?.id]);

  const setItemAnswer = (index: number, answer: SINoNA) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return { ...item, si: answer === 'si', no: answer === 'no', na: answer === 'na' };
    }));
  };

  const setItemObservation = (index: number, value: string) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, observations: value } : item));
  };

  const handleSaveDraft = async () => {
    if (!protocol) return;
    setSaving(true);
    try {
      await saveProtocolDraft(protocol.id, { items, evidencePhotos, executorSignature });
      toast({ title: 'Borrador guardado', className: 'border-green-500' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleCaptureExecutorSig = () => {
    const canvas = executorSigRef.current?.getCanvas?.();
    if (!canvas) return null;
    const sigData = canvas.toDataURL('image/png');
    const isEmpty = !sigData || sigData === 'data:,';
    if (isEmpty) {
      toast({ variant: 'destructive', title: 'Firma vacía', description: 'Por favor dibuja tu firma antes de confirmar.' });
      return null;
    }
    return sigData;
  };

  const confirmExecutorSignature = () => {
    const sig = handleCaptureExecutorSig();
    if (!sig) return;
    setExecutorSignature({
      userId: user!.id,
      name: user!.name,
      role: user!.role,
      signature: sig,
      date: new Date().toISOString(),
    });
    setShowExecutorSig(false);
  };

  const confirmSupervisorSignature = () => {
    const canvas = supervisorSigRef.current?.getCanvas?.();
    if (!canvas) return;
    const sigData = canvas.toDataURL('image/png');
    setSupervisorSignature({
      userId: user!.id,
      name: user!.name,
      role: user!.role,
      signature: sigData,
      date: new Date().toISOString(),
    });
    setShowSupervisorSig(false);
  };

  const handleSubmitForReview = async () => {
    if (!protocol || !executorSignature) {
      toast({ variant: 'destructive', title: 'Firma requerida', description: 'Debes firmar el protocolo antes de enviarlo a revisión.' });
      return;
    }
    const unanswered = items.filter(it => !it.si && !it.no && !it.na);
    if (unanswered.length > 0) {
      toast({ variant: 'destructive', title: 'Items sin respuesta', description: `${unanswered.length} elemento(s) sin marcar. Completa todos antes de enviar.` });
      return;
    }
    setSubmitting(true);
    try {
      await submitProtocolForReview(protocol.id, {
        items,
        evidencePhotos,
        executorSignature,
        supervisorSignature: supervisorSignature ?? null,
      });
      toast({ title: 'Enviado a revisión', className: 'border-green-500' });
      router.push('/dashboard/construction-control/protocolos');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    const canvas = qmSigRef.current?.getCanvas?.();
    if (!canvas) return;
    const sigData = canvas.toDataURL('image/png');
    if (!sigData || sigData.length < 1000) {
      toast({ variant: 'destructive', title: 'Firma vacía', description: 'Dibuja tu firma para aprobar.' });
      return;
    }
    try {
      await approveProtocol(protocol!.id, {
        userId: user!.id,
        name: user!.name,
        role: user!.role,
        signature: sigData,
        date: new Date().toISOString(),
      });
      setShowQMSig(false);
      toast({ title: 'Protocolo aprobado', className: 'border-green-500' });
      router.push('/dashboard/construction-control/protocolos');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const handleReject = async () => {
    const canvas = qmSigRef.current?.getCanvas?.();
    if (!canvas) return;
    const sigData = canvas.toDataURL('image/png');
    if (!rejectionReason.trim()) {
      toast({ variant: 'destructive', title: 'Motivo requerido', description: 'Indica el motivo del rechazo.' });
      return;
    }
    try {
      await rejectProtocol(protocol!.id, rejectionReason, {
        userId: user!.id,
        name: user!.name,
        role: user!.role,
        signature: sigData,
        date: new Date().toISOString(),
      });
      setShowRejectDialog(false);
      setShowQMSig(false);
      toast({ title: 'Protocolo rechazado' });
      router.push('/dashboard/construction-control/protocolos');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const answeredCount = items.filter(it => it.si || it.no || it.na).length;
  const progress = items.length > 0 ? Math.round((answeredCount / items.length) * 100) : 0;

  if (!protocol) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Protocolo no encontrado</AlertTitle>
        <AlertDescription>El protocolo solicitado no existe o no tienes acceso.</AlertDescription>
      </Alert>
    );
  }

  const statusConfig = {
    borrador: { label: 'Borrador', color: 'bg-slate-100 text-slate-700', icon: <FileCheck size={12} /> },
    pendiente_revision: { label: 'En Revisión', color: 'bg-amber-100 text-amber-700', icon: <Clock size={12} /> },
    aprobado: { label: 'Aprobado', color: 'bg-green-100 text-green-700', icon: <CheckCircle2 size={12} /> },
    rechazado: { label: 'Rechazado', color: 'bg-red-100 text-red-700', icon: <XCircle size={12} /> },
  }[protocol.status];

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/dashboard/construction-control/protocolos">
          <Button variant="ghost" size="icon" className="rounded-xl mt-1 shrink-0">
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge className={`text-[10px] font-semibold px-2 py-0.5 rounded-full gap-1 flex items-center ${statusConfig.color}`}>
              {statusConfig.icon} {statusConfig.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] rounded-full">
              {protocol.type === 'inicio' ? 'Inicio' : 'Entrega'}
            </Badge>
          </div>
          <h1 className="text-xl font-black leading-tight">{protocol.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{protocol.obra}{protocol.activityType && ` · ${protocol.activityType}`}</p>
        </div>
      </div>

      {isRejected && protocol.rejectionReason && (
        <Alert variant="destructive" className="rounded-2xl">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Protocolo Rechazado</AlertTitle>
          <AlertDescription>{protocol.rejectionReason}</AlertDescription>
        </Alert>
      )}

      {/* Objetivo */}
      {protocol.objective && (
        <Card className="rounded-[1.5rem] border-none shadow-md bg-slate-50">
          <CardContent className="p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">Objetivo</p>
            <p className="text-sm">{protocol.objective}</p>
          </CardContent>
        </Card>
      )}

      {/* Normativa */}
      {protocol.normativa.length > 0 && (
        <Card className="rounded-[1.5rem] border-none shadow-md bg-slate-50">
          <CardContent className="p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Normativa Aplicable</p>
            <div className="space-y-2">
              {protocol.normativa.map((n, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[10px] rounded shrink-0 mt-0.5">{n.code}</Badge>
                  <p className="text-xs text-muted-foreground">{n.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Responsabilidades */}
      {protocol.responsibilities.length > 0 && (
        <Card className="rounded-[1.5rem] border-none shadow-md bg-slate-50">
          <CardContent className="p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Responsabilidades</p>
            <div className="space-y-2">
              {protocol.responsibilities.map((r, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-xs font-bold shrink-0 text-primary w-28">{r.role}</span>
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Checklist */}
      {items.length > 0 && (
        <Card className="rounded-[1.5rem] border-none shadow-md bg-slate-50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-black uppercase tracking-tight">
                Lista de Verificación
              </CardTitle>
              {isDraft && (
                <span className="text-xs text-muted-foreground font-mono">
                  {answeredCount}/{items.length} ({progress}%)
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Header columns */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-5 pb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              <span>Elemento</span>
              <span className="w-10 text-center text-green-600">SI</span>
              <span className="w-10 text-center text-red-500">NO</span>
              <span className="w-10 text-center text-slate-400">N/A</span>
            </div>
            <Separator />
            <div className="divide-y">
              {items.map((item, index) => (
                <div key={index} className={`px-5 py-3 ${!isReadOnly ? 'hover:bg-slate-100/50 transition-colors' : ''}`}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                    <p className="text-sm">{item.element}</p>
                    {/* SI */}
                    <button
                      disabled={isReadOnly}
                      onClick={() => setItemAnswer(index, 'si')}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${item.si ? 'bg-green-100 text-green-700 font-bold' : 'bg-slate-100 text-slate-400 hover:bg-green-50'} ${isReadOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      {item.si ? <CheckCircle2 size={18} /> : <span className="text-xs font-bold">SI</span>}
                    </button>
                    {/* NO */}
                    <button
                      disabled={isReadOnly}
                      onClick={() => setItemAnswer(index, 'no')}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${item.no ? 'bg-red-100 text-red-700 font-bold' : 'bg-slate-100 text-slate-400 hover:bg-red-50'} ${isReadOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      {item.no ? <XCircle size={18} /> : <span className="text-xs font-bold">NO</span>}
                    </button>
                    {/* N/A */}
                    <button
                      disabled={isReadOnly}
                      onClick={() => setItemAnswer(index, 'na')}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${item.na ? 'bg-slate-200 text-slate-700 font-bold' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'} ${isReadOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      <span className="text-xs font-bold">N/A</span>
                    </button>
                  </div>
                  {/* Observaciones */}
                  {(isDraft || item.observations) && (
                    <div className="mt-2 pl-0">
                      {isDraft ? (
                        <Input
                          placeholder="Observaciones (opcional)"
                          className="rounded-xl text-xs h-8"
                          value={item.observations || ''}
                          onChange={e => setItemObservation(index, e.target.value)}
                        />
                      ) : (
                        item.observations && (
                          <p className="text-xs text-muted-foreground italic">{item.observations}</p>
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Firmas existentes (solo vista) */}
      {(protocol.executorSignature || protocol.supervisorSignature || protocol.qualityManagerSignature) && (
        <Card className="rounded-[1.5rem] border-none shadow-md bg-slate-50">
          <CardContent className="p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Firmas</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Ejecutor', sig: protocol.executorSignature, icon: <User size={14} /> },
                { label: 'Supervisor', sig: protocol.supervisorSignature, icon: <Shield size={14} /> },
                { label: 'Enc. Calidad', sig: protocol.qualityManagerSignature, icon: <Star size={14} /> },
              ].map(({ label, sig, icon }) => sig && (
                <div key={label} className="text-center p-3 bg-white rounded-xl border">
                  <div className="flex items-center justify-center gap-1 text-xs font-bold text-muted-foreground mb-2">
                    {icon} {label}
                  </div>
                  <img src={sig.signature} alt={`Firma ${label}`} className="h-16 mx-auto object-contain" />
                  <p className="text-[10px] font-semibold mt-1">{sig.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(sig.date), 'dd/MM/yyyy HH:mm', { locale: es })}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Acciones — Modo Borrador */}
      {isDraft && (
        <Card className="rounded-[1.5rem] border-none shadow-md bg-slate-50">
          <CardContent className="p-5 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Firma del Ejecutor</p>

            {executorSignature ? (
              <div className="flex items-center gap-4 p-3 bg-green-50 rounded-xl border border-green-200">
                <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-green-800">{executorSignature.name}</p>
                  <p className="text-xs text-green-600">Firmado el {format(new Date(executorSignature.date), 'dd/MM/yyyy HH:mm', { locale: es })}</p>
                </div>
                <img src={executorSignature.signature} alt="Firma ejecutor" className="h-10 object-contain" />
                <Button variant="ghost" size="sm" className="text-xs rounded-xl" onClick={() => setExecutorSignature(null)}>
                  Limpiar
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="gap-2 rounded-xl w-full" onClick={() => setShowExecutorSig(true)}>
                <Pen size={14} /> Firmar como Ejecutor
              </Button>
            )}

            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs">Firma supervisor (opcional)</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {supervisorSignature ? (
              <div className="flex items-center gap-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
                <CheckCircle2 size={16} className="text-blue-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-blue-800">{supervisorSignature.name}</p>
                  <p className="text-xs text-blue-600">Firmado</p>
                </div>
                <img src={supervisorSignature.signature} alt="Firma supervisor" className="h-10 object-contain" />
                <Button variant="ghost" size="sm" className="text-xs rounded-xl" onClick={() => setSupervisorSignature(null)}>
                  Limpiar
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="gap-2 rounded-xl w-full" onClick={() => setShowSupervisorSig(true)}>
                <Shield size={14} /> Firma del Supervisor (opcional)
              </Button>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="gap-2 rounded-xl flex-1" onClick={handleSaveDraft} disabled={saving}>
                {saving ? <span className="animate-spin">⟳</span> : <Save size={14} />}
                Guardar Borrador
              </Button>
              <Button
                className="gap-2 rounded-xl flex-1"
                onClick={handleSubmitForReview}
                disabled={submitting || !executorSignature}
              >
                {submitting ? <span className="animate-spin">⟳</span> : <Send size={14} />}
                Enviar a Revisión
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Acciones — Modo Revisión (Encargado de Calidad) */}
      {isPending && canReview && (
        <Card className="rounded-[1.5rem] border-none shadow-md bg-amber-50 border-amber-200">
          <CardContent className="p-5 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Revisión — Encargado de Calidad</p>
            <p className="text-sm text-amber-800">
              Revisa los ítems completados y las firmas. Una vez conforme, aprueba o rechaza el protocolo.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="gap-2 rounded-xl flex-1 border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => setShowRejectDialog(true)}
              >
                <XCircle size={14} /> Rechazar
              </Button>
              <Button
                className="gap-2 rounded-xl flex-1 bg-green-600 hover:bg-green-700"
                onClick={() => setShowQMSig(true)}
              >
                <CheckCircle2 size={14} /> Aprobar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog: Firma Ejecutor */}
      <Dialog open={showExecutorSig} onOpenChange={setShowExecutorSig}>
        <DialogContent className="rounded-[1.5rem]">
          <DialogHeader>
            <DialogTitle>Firma del Ejecutor</DialogTitle>
          </DialogHeader>
          <div className="bg-white border rounded-xl overflow-hidden">
            <SignaturePad ref={executorSigRef} canvasProps={{ width: 460, height: 180, className: 'w-full' }} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowExecutorSig(false)}>Cancelar</Button>
            <Button className="rounded-xl" onClick={confirmExecutorSignature}>Confirmar Firma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Firma Supervisor */}
      <Dialog open={showSupervisorSig} onOpenChange={setShowSupervisorSig}>
        <DialogContent className="rounded-[1.5rem]">
          <DialogHeader>
            <DialogTitle>Firma del Supervisor</DialogTitle>
          </DialogHeader>
          <div className="bg-white border rounded-xl overflow-hidden">
            <SignaturePad ref={supervisorSigRef} canvasProps={{ width: 460, height: 180, className: 'w-full' }} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowSupervisorSig(false)}>Cancelar</Button>
            <Button className="rounded-xl" onClick={confirmSupervisorSignature}>Confirmar Firma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Firma Encargado de Calidad (Aprobación) */}
      <Dialog open={showQMSig} onOpenChange={setShowQMSig}>
        <DialogContent className="rounded-[1.5rem]">
          <DialogHeader>
            <DialogTitle>Firma del Encargado de Calidad</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Tu firma certifica la aprobación de este protocolo.</p>
          <div className="bg-white border rounded-xl overflow-hidden">
            <SignaturePad ref={qmSigRef} canvasProps={{ width: 460, height: 180, className: 'w-full' }} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowQMSig(false)}>Cancelar</Button>
            <Button className="rounded-xl bg-green-600 hover:bg-green-700" onClick={handleApprove}>
              <CheckCircle2 size={14} className="mr-1" /> Aprobar Protocolo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Rechazo */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="rounded-[1.5rem]">
          <DialogHeader>
            <DialogTitle>Rechazar Protocolo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Motivo del rechazo *</Label>
            <Textarea
              className="rounded-xl"
              placeholder="Describe las observaciones o correcciones requeridas..."
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">Tu firma también será requerida para registrar el rechazo.</p>
            <div className="bg-white border rounded-xl overflow-hidden">
              <SignaturePad ref={qmSigRef} canvasProps={{ width: 460, height: 140, className: 'w-full' }} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowRejectDialog(false)}>Cancelar</Button>
            <Button className="rounded-xl bg-red-600 hover:bg-red-700" onClick={handleReject}>
              <XCircle size={14} className="mr-1" /> Confirmar Rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
