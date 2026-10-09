'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Activity,
  AlertCircle,
  Calendar,
  CalendarClock,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Maximize2,
  Package,
  Plus,
  QrCode,
  Settings,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { Material } from '@/modules/core/lib/data';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ContractStockBreakdown } from '@/components/contract-stock-breakdown';

const CLASS_LABEL: Record<string, string> = {
  A: 'Crítico / alto valor',
  B: 'Importante',
  C: 'Fungible',
};

interface AssetDetailSheetProps {
  asset: Material | null;
  onClose: () => void;
  status: string;
  statusClassName: string;
  holderName?: string;
  overdue: boolean;
  soon: boolean;
  canEdit: boolean;
  canManage: boolean;
  canDelete: boolean;
  canAddStock: boolean;
  formatCLP: (amount: number) => string;
  onQr: (asset: Material) => void;
  onEdit: (asset: Material) => void;
  onMaintenance: (asset: Material) => void;
  onRetire: (asset: Material) => void;
  onDelete: (asset: Material) => void;
  onAddStock: (asset: Material) => void;
}

const toDate = (date: any) => (date ? new Date(date) : null);

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col border-b border-border pb-2">
      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">{label}</span>
      <span className={`text-xs font-bold uppercase mt-0.5 ${className ?? 'text-foreground'}`}>{children}</span>
    </div>
  );
}

/**
 * Ficha del activo: el mismo panel se abre desde la vista de tarjetas y desde
 * la de lista, para que ambas muestren el mismo detalle y las mismas acciones.
 */
export function AssetDetailSheet({
  asset,
  onClose,
  status,
  statusClassName,
  holderName,
  overdue,
  soon,
  canEdit,
  canManage,
  canDelete,
  canAddStock,
  formatCLP,
  onQr,
  onEdit,
  onMaintenance,
  onRetire,
  onDelete,
  onAddStock,
}: AssetDetailSheetProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [isZoomOpen, setIsZoomOpen] = useState(false);

  // Al cambiar de activo se vuelve a la primera foto (ajuste durante el render,
  // no en un efecto).
  const [shownAssetId, setShownAssetId] = useState(asset?.id);
  if (shownAssetId !== asset?.id) {
    setShownAssetId(asset?.id);
    setPhotoIndex(0);
    setIsZoomOpen(false);
  }

  if (!asset) return null;

  const photos = asset.photos ?? [];
  const currentPhoto = photos[Math.min(photoIndex, photos.length - 1)];
  const needsMaint = asset.requiresMaintenance === true;
  const nextMaint = toDate(asset.nextMaintenanceDate);

  // Las acciones abren su propio diálogo: cerramos la ficha antes para no
  // apilar dos ventanas modales.
  const run = (action: (a: Material) => void) => () => {
    onClose();
    action(asset);
  };

  const stepPhoto = (delta: number) =>
    setPhotoIndex(i => (i + delta + photos.length) % photos.length);

  return (
    <>
      <Sheet open={!!asset} onOpenChange={open => { if (!open) onClose(); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 overflow-y-auto">
          {/* Foto principal */}
          <div className={`relative bg-muted ${currentPhoto ? 'aspect-[4/3]' : 'h-40'}`}>
            {currentPhoto ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsZoomOpen(true)}
                  className="absolute inset-0 cursor-zoom-in"
                  aria-label="Ver foto en tamaño completo"
                >
                  <Image
                    src={currentPhoto}
                    alt={asset.name}
                    fill
                    sizes="(max-width: 640px) 100vw, 576px"
                    className="object-contain"
                  />
                </button>
                <span className="absolute bottom-4 right-4 p-2 rounded-xl bg-pagnol-dark/70 text-white pointer-events-none">
                  <Maximize2 size={14} />
                </span>
                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => stepPhoto(-1)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-pagnol-dark/70 text-white hover:bg-pagnol-dark transition-colors"
                      aria-label="Foto anterior"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => stepPhoto(1)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-pagnol-dark/70 text-white hover:bg-pagnol-dark transition-colors"
                      aria-label="Foto siguiente"
                    >
                      <ChevronRight size={18} />
                    </button>
                    <span className="absolute bottom-4 left-4 px-3 py-1.5 rounded-xl bg-pagnol-dark/70 text-white text-[9px] font-black uppercase tracking-widest pointer-events-none">
                      {photoIndex + 1} / {photos.length}
                    </span>
                  </>
                )}
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                <Camera size={48} strokeWidth={1} />
                <span className="text-[10px] font-black uppercase tracking-widest">Sin foto</span>
              </div>
            )}
            <span className={`absolute top-4 left-4 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl ${statusClassName}`}>
              {status}
            </span>
          </div>

          {photos.length > 1 && (
            <div className="flex gap-2 px-6 pt-4 overflow-x-auto no-scrollbar">
              {photos.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setPhotoIndex(i)}
                  className={`relative w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-muted border-2 transition-all ${i === photoIndex ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100'}`}
                  aria-label={`Ver foto ${i + 1}`}
                >
                  <Image src={url} alt="" fill sizes="64px" className="object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="p-6 space-y-8">
            <SheetHeader className="text-left space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                <p className="text-[10px] text-primary font-black uppercase tracking-[0.2em]">{asset.category}</p>
                {asset.ownership === 'arrendado' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-info-subtle text-info-subtle-foreground text-[8px] font-black uppercase tracking-widest">
                    <Package size={10} /> Arrendado
                  </span>
                )}
                {asset.ownership === 'cliente' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-warning-subtle text-warning-subtle-foreground text-[8px] font-black uppercase tracking-widest">
                    <Package size={10} /> Del cliente
                  </span>
                )}
              </div>
              <SheetTitle className="text-xl font-black tracking-tight uppercase leading-tight">{asset.name}</SheetTitle>
              <SheetDescription className="text-[11px] font-black text-muted-foreground font-mono tracking-tight">
                ID PAGNOL · {asset.internalCode || asset.id}
              </SheetDescription>
            </SheetHeader>

            {needsMaint && nextMaint && (
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${overdue ? 'bg-destructive/10 border-destructive/30 text-destructive' : soon ? 'bg-warning-subtle border-warning/20 text-warning' : 'bg-muted text-muted-foreground'}`}>
                {overdue ? <AlertCircle size={14} className="shrink-0" /> : <CalendarClock size={14} className="shrink-0" />}
                <span className="text-[9px] font-black uppercase tracking-widest">
                  {overdue ? 'Mantenimiento vencido' : 'Próximo mantenimiento'}: {nextMaint.toLocaleDateString('es-CL')}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              <div className="space-y-4">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                  <Settings size={14} className="text-primary" /> Datos del equipo
                </p>
                <Field label="N° de serie">{asset.serialNumber || 'N/A'}</Field>
                <Field label="Fecha de adquisición">
                  {toDate(asset.acquisitionDate)?.toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' }) || 'N/A'}
                </Field>
                <Field label="Tipo de uso">{asset.usageType || 'N/A'}</Field>
                <Field label="Costo unitario">{formatCLP(asset.unitCost || 0)}</Field>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                  <Activity size={14} className="text-primary" /> Situación actual
                </p>
                <Field label="Clasificación">
                  Clase {asset.class || 'N/A'}{asset.class && CLASS_LABEL[asset.class] ? ` (${CLASS_LABEL[asset.class]})` : ''}
                </Field>
                <div className="flex items-end justify-between gap-3 border-b border-border pb-2">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Stock disponible</span>
                    <span className="text-xs font-bold uppercase mt-0.5 text-foreground">
                      {asset.stock ?? 0} {asset.unit?.toLowerCase() === 'unidad' ? 'unidades' : asset.unit}
                    </span>
                  </div>
                  {canAddStock && (
                    <Button size="sm" onClick={() => onAddStock(asset)} className="h-8 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest gap-1">
                      <Plus size={12} /> Ingresar
                    </Button>
                  )}
                </div>
                <Field label="En posesión de" className={holderName ? 'text-info' : 'text-muted-foreground'}>
                  {holderName || 'En pañol'}
                </Field>
                <Field label="Mantenimiento">
                  {!needsMaint ? 'No aplica' : nextMaint ? nextMaint.toLocaleDateString('es-CL') : 'No programado'}
                </Field>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                <Wrench size={14} className="text-primary" /> Acciones
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button onClick={run(onQr)} className="justify-between rounded-[1.5rem] h-12 px-6 bg-foreground text-background hover:bg-foreground/90">
                  Imprimir QR <QrCode size={14} />
                </Button>
                {asset.technicalSheetUrl ? (
                  <Button asChild className="justify-between rounded-[1.5rem] h-12 px-6 bg-pagnol-orange text-white hover:bg-pagnol-orange/90">
                    <a
                      href={asset.technicalSheetUrl}
                      download={asset.technicalSheetName || 'ficha_tecnica.pdf'}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Descargar ficha <Download size={14} />
                    </a>
                  </Button>
                ) : (
                  <Button disabled variant="outline" className="justify-between rounded-[1.5rem] h-12 px-6">
                    Sin ficha técnica <Download size={14} />
                  </Button>
                )}
                {canEdit && (
                  <Button onClick={run(onEdit)} variant="outline" className="justify-between rounded-[1.5rem] h-12 px-6">
                    Editar ficha <Edit3 size={14} />
                  </Button>
                )}
                {canEdit && needsMaint && (
                  <Button onClick={run(onMaintenance)} variant="outline" className="justify-between rounded-[1.5rem] h-12 px-6">
                    Mantenimiento <Calendar size={14} />
                  </Button>
                )}
                {canManage && (
                  <Button onClick={run(onRetire)} variant="destructive" className="justify-between bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-[1.5rem] h-12 px-6">
                    Solicitar baja <Trash2 size={14} />
                  </Button>
                )}
                {canDelete && (
                  <Button onClick={run(onDelete)} variant="destructive" className="justify-between rounded-[1.5rem] h-12 px-6">
                    Eliminar definitivamente <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-border">
              <ContractStockBreakdown material={asset} />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Foto a tamaño completo */}
      <Dialog open={isZoomOpen && !!currentPhoto} onOpenChange={setIsZoomOpen}>
        <DialogContent hideClose className="max-w-5xl p-0 border-none bg-transparent shadow-none">
          <DialogTitle className="sr-only">{asset.name}</DialogTitle>
          <div className="relative w-full h-[80vh]">
            {currentPhoto && (
              <Image src={currentPhoto} alt={asset.name} fill sizes="100vw" className="object-contain" />
            )}
            <button
              type="button"
              onClick={() => setIsZoomOpen(false)}
              className="absolute top-2 right-2 p-2 rounded-xl bg-pagnol-dark/70 text-white hover:bg-pagnol-dark"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
            {photos.length > 1 && (
              <>
                <button type="button" onClick={() => stepPhoto(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-xl bg-pagnol-dark/70 text-white hover:bg-pagnol-dark" aria-label="Foto anterior">
                  <ChevronLeft size={22} />
                </button>
                <button type="button" onClick={() => stepPhoto(1)} className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-xl bg-pagnol-dark/70 text-white hover:bg-pagnol-dark" aria-label="Foto siguiente">
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
