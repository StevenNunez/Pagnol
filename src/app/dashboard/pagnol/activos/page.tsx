"use client";

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { useForm, Controller, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Material, User as UserType, MaterialCategory, Unit, Tool } from '@/modules/core/lib/data';
import { PageHeader } from '@/components/page-header';
import {
  Grid,
  List,
  Download,
  Plus,
  Edit3,
  Trash2,
  Search,
  X,
  Camera,
  Info,
  CalendarClock,
  AlertCircle,
  FileText,
  Sparkles,
  Printer,
  ShieldCheck,
  PieChart,
  Activity,
  History,
  ChevronDown,
  ChevronUp,
  Filter as FilterIcon,
  Box,
  Truck,
  Wrench,
  FileSpreadsheet,
  Settings,
  Calendar,
  AlertTriangle,
  Save,
  QrCode,
  FileUp
} from 'lucide-react';
import { QRWithPagnolLogo } from '@/components/qr-with-pagnol-logo';
import { useToast } from '@/modules/core/hooks/use-toast';
import { generateStrategicReport } from '@/actions/ask-ferro';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as ExcelJS from 'exceljs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ChevronsUpDown, Check, Package, PackagePlus, CalendarIcon } from 'lucide-react';


type Asset = Material; // Alias para compatibilidad con el nuevo diseño
type AssetStatus = 'Disponible' | 'En Mantenimiento' | 'Para Baja' | 'Extraviado' | 'En Uso' | 'Agotado' | 'Stock Crítico' | 'Archivado';
type ModalType = 'ADD' | 'EDIT' | 'MAINTENANCE' | 'RETIRE';

const assetSchema = z.object({
  name: z.string().min(3, "La descripción técnica es obligatoria."),
  serialNumber: z.string().optional(),
  categoryId: z.string({ required_error: "La categoría logística es obligatoria." }),
  class: z.enum(['A', 'B', 'C'], { required_error: "Debes seleccionar una clase." }),
  unitCost: z.coerce.number().min(0).optional(),
  technicalSheetUrl: z.string().optional(),
  technicalSheetName: z.string().optional(),

  // Defaulted fields to avoid showing them in the simplified form
  usageType: z.enum(['Consumible', 'Retornable', 'Permanente']).default('Consumible'),
  unit: z.string().min(1).default('unidad'),
  stock: z.coerce.number().min(0).default(1),
  status: z.enum(['Disponible', 'En Mantenimiento', 'Para Baja', 'Extraviado', 'En Uso']).optional(),
  nextMaintenanceDate: z.date().optional().nullable(),
  photos: z.string().optional(),
  acquisitionDate: z.date().optional().nullable(),
  justification: z.string().optional(),
  description: z.string().optional(), // 'name' will be used as the main description
  supplierId: z.string().nullable().optional(),

  // ISO 55001 Fields
  parentId: z.string().nullable().optional(),
  failureProbability: z.coerce.number().min(1).max(5).optional().default(1),
  failureImpact: z.coerce.number().min(1).max(5).optional().default(1),
});


type FormData = z.infer<typeof assetSchema>;

export default function ActivosPage() {
  const { materials, addMaterial, deleteMaterial, updateMaterial, materialCategories, units, can } = useAppState();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedClass, setSelectedClass] = useState<string>('ALL');
  const [selectedUseType, setSelectedUseType] = useState<string>('ALL');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<ModalType>('ADD');
  const [selectedAsset, setSelectedAsset] = useState<Partial<Asset>>({});

  const [visibleCount, setVisibleCount] = useState(24);
  const ITEMS_PER_LOAD = 24;
  const [listPage, setListPage] = useState(0);
  const LIST_PAGE_SIZE = 100;
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);


  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [smartReport, setSmartReport] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrAsset, setQrAsset] = useState<Asset | null>(null);

  const [techSheetFile, setTechSheetFile] = useState<File | null>(null);
  const [isUploadingTechSheet, setIsUploadingTechSheet] = useState(false);

  const formatCLP = (amount: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const handleTechSheetUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    if ('target' in e && (e.target as HTMLInputElement).files) {
      file = (e.target as HTMLInputElement).files?.[0];
    } else if ('dataTransfer' in e) {
      file = (e as React.DragEvent).dataTransfer.files?.[0];
    }

    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({ variant: "destructive", title: "Archivo muy grande", description: "El límite es 5MB" });
        return;
      }
      setTechSheetFile(file);
      setValue('technicalSheetName', file.name);

      const reader = new FileReader();
      reader.onloadend = () => {
        setValue('technicalSheetUrl', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleTechSheetUpload(e);
  };

  const canManageCatalog = can('materials:create');

  const { register, handleSubmit, control, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(assetSchema)
  });

  const failureProb = watch('failureProbability') || 1;
  const failureImp = watch('failureImpact') || 1;
  const currentClass = watch('class');

  useEffect(() => {
    // ISO 55001 Auto-classification based on Risk Matrix (Probability x Impact)
    // 1-5 low, 6-12 medium, 15-25 high
    const score = failureProb * failureImp;
    let newClass: 'A' | 'B' | 'C' = 'C';
    if (score >= 15) newClass = 'A';
    else if (score >= 6) newClass = 'B';
    
    if (newClass !== currentClass && (failureProb > 1 || failureImp > 1)) {
       setValue('class', newClass, { shouldValidate: true });
    }
  }, [failureProb, failureImp, currentClass, setValue]);

  const getStatusLabel = useCallback((asset: Material | Tool): AssetStatus => {
    if ('stock' in asset) {
      if (asset.archived) return 'Archivado';
      if (asset.status) return asset.status;
      if (asset.stock === 0) return 'Agotado';
      if (asset.stock <= 10) return 'Stock Crítico';
      return 'Disponible';
    }
    return 'Disponible'; // Simplified for now
  }, []);

  const toDate = (date: any) => date ? new Date(date) : null;

  const isMaintenanceSoon = (dateStr?: Date | string) => {
    const maintenanceDate = toDate(dateStr);
    if (!maintenanceDate) return false;
    const today = new Date();
    const diffTime = maintenanceDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 15;
  };

  const isMaintenanceOverdue = (dateStr?: Date | string) => {
    const maintenanceDate = toDate(dateStr);
    if (!maintenanceDate) return false;
    const today = new Date();
    return maintenanceDate < today;
  };

  const filteredAssets = useMemo(() => {
    return (materials || []).filter((a: Material) => {
      const status = getStatusLabel(a);
      const matchesSearch = a.name.toLowerCase().includes(filter.toLowerCase()) || a.id.toLowerCase().includes(filter.toLowerCase()) || (a.internalCode || '').toLowerCase().includes(filter.toLowerCase());
      const matchesStatus = selectedStatus === 'ALL' || status === selectedStatus;
      const matchesClass = selectedClass === 'ALL' || a.class === selectedClass;
      const matchesUse = selectedUseType === 'ALL' || a.usageType === selectedUseType;
      const matchesOverdue = !showOverdueOnly || isMaintenanceOverdue(a.nextMaintenanceDate);
      return matchesSearch && matchesStatus && matchesClass && matchesUse && matchesOverdue;
    });
  }, [materials, filter, selectedStatus, selectedClass, selectedUseType, showOverdueOnly, getStatusLabel, isMaintenanceOverdue]);

  // Reset pagination whenever filters change
  useEffect(() => {
    setVisibleCount(24);
    setListPage(0);
  }, [filter, selectedStatus, selectedClass, selectedUseType, showOverdueOnly]);

  const openQrModal = (asset: Asset) => {
    setQrAsset(asset);
    setIsQrModalOpen(true);
  };

  const handlePrintQR = () => {
    const printContent = document.getElementById('qr-print-area');
    if (!printContent || !qrAsset) return;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    let contentHtml = printContent.innerHTML;
    contentHtml = contentHtml.replace(/href="\/logo1\.png"/g, `href="${origin}/logo1.png"`);
    contentHtml = contentHtml.replace(/xlink:href="\/logo1\.png"/g, `xlink:href="${origin}/logo1.png"`);

    const windowUrl = 'about:blank';
    const uniqueName = new Date().getTime();
    const windowName = `Print_${uniqueName}`;
    const printWindow = window.open(windowUrl, windowName, 'left=50000,top=50000,width=800,height=600');

    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Etiqueta QR - ${qrAsset.internalCode || qrAsset.id}</title>
            <meta charset="utf-8">
            <style>
              @page { size: 22mm 32mm; margin: 0; }
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; min-height: 32mm; }
              @media print {
                body { min-height: 0; }
                .label { border: none !important; }
              }
              .label-sheet {
                display: flex; justify-content: center; align-items: center; min-height: 100vh;
                padding: 10mm;
              }
              .label {
                width: 22mm; height: 32mm;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                padding: 1.5mm; box-sizing: border-box;
                border: 0.5pt dashed #e2e8f0; background: #fff;
              }
              .label .qr-wrap { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
              .label .qr-wrap svg { width: 14mm !important; height: 14mm !important; max-width: 14mm; max-height: 14mm; }
              .label .asset-id { font-size: 5pt; font-weight: 900; text-align: center; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.5mm; word-break: break-all; line-height: 1.1; }
              .label .asset-desc { font-size: 4pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.3mm; }
            </style>
          </head>
          <body>
            <div class="label-sheet">
              <div class="label">
                <div class="qr-wrap">${contentHtml}</div>
                <div class="asset-id">${qrAsset.internalCode || qrAsset.id}</div>
                <div class="asset-desc">ID ÚNICO DE RASTREO PAGNOL</div>
              </div>
            </div>
            <script>window.onload = function() { window.print(); window.close(); };</script>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
    }
  };

  const openAddModal = () => {
    setModalType('ADD');
    setTechSheetFile(null);
    reset({
      name: '',
      serialNumber: '',
      categoryId: '',
      class: 'C',
      usageType: 'Consumible',
      unitCost: 0,
      status: 'Disponible',
      stock: 1,
      nextMaintenanceDate: null,
      unit: 'unidad',
      photos: '',
      acquisitionDate: null,
      justification: '',
      description: '',
      technicalSheetUrl: '',
      technicalSheetName: '',
      parentId: null,
      failureProbability: 1,
      failureImpact: 1,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (asset: Asset) => {
    setModalType('EDIT');
    setTechSheetFile(null);
    const category = materialCategories.find(c => c.name === asset.category);

    // Map asset usageType to form usageType
    const mapUsageType = (type: string): 'Consumible' | 'Retornable' | 'Permanente' => {
      const typeMap: Record<string, 'Consumible' | 'Retornable' | 'Permanente'> = {
        'Consumible': 'Consumible',
        'Retornable': 'Retornable',
        'Reutilizable Controlado': 'Retornable',
        'Permanente': 'Permanente',
        'Herramienta Menor': 'Permanente',
        'Repuesto Crítico': 'Permanente',
        'Activo Fijo': 'Permanente',
        'IT Controlado': 'Permanente',
      };
      return typeMap[type] || 'Consumible';
    };

    reset({
      name: asset.name,
      serialNumber: asset.serialNumber || '',
      categoryId: category?.id || '',
      class: asset.class || 'C',
      usageType: mapUsageType(asset.usageType || 'Consumible'),
      unitCost: asset.unitCost || 0,
      status: asset.status || 'Disponible',
      stock: asset.stock || 1,
      nextMaintenanceDate: asset.nextMaintenanceDate ? toDate(asset.nextMaintenanceDate) : null,
      unit: asset.unit,
      photos: (asset.photos || []).join(', '),
      acquisitionDate: asset.acquisitionDate ? toDate(asset.acquisitionDate) : null,
      description: asset.description || '',
      technicalSheetUrl: asset.technicalSheetUrl || '',
      technicalSheetName: asset.technicalSheetName || '',
      parentId: asset.parentId || null,
      failureProbability: asset.failureProbability || 1,
      failureImpact: asset.failureImpact || 1,
    });
    setSelectedAsset(asset);
    setIsModalOpen(true);
  };

  const openMaintenanceModal = (asset: Asset) => {
    setModalType('MAINTENANCE');
    setSelectedAsset(asset);
    reset({ // solo resetea los campos relevantes para este modal
      nextMaintenanceDate: asset.nextMaintenanceDate ? new Date(asset.nextMaintenanceDate as any) : new Date(),
      status: asset.status || 'Disponible',
    });
    setIsModalOpen(true);
  };

  const openRetireModal = (asset: Asset) => {
    setModalType('RETIRE');
    setSelectedAsset(asset);
    setIsModalOpen(true);
  };

  const handleSaveAsset = async (data: FormData) => {
    const category = materialCategories.find(c => c.id === data.categoryId);
    const photosArray = data.photos ? data.photos.split(',').map(p => p.trim()).filter(p => p) : [];

    const finalData: any = {
      ...data,
      photos: photosArray,
      category: category?.name,
      supplierId: data.supplierId === 'ninguno' ? null : data.supplierId,
    };

    try {
      if (modalType === 'ADD') {
        await addMaterial(finalData);
        toast({ title: 'Activo Registrado' });
      } else {
        await updateMaterial(selectedAsset.id!, finalData);
        toast({ title: 'Activo Actualizado' });
      }
      setIsModalOpen(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpdateStatus = async (status: Material['status']) => {
    if (!selectedAsset.id) return;
    try {
      await updateMaterial(selectedAsset.id, { status });
      toast({ title: `Estado actualizado a ${status}` });
      setIsModalOpen(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const fullContextString = useMemo(() => {
    if (!materials || materials.length === 0) return '{}';
    const byCategory: Record<string, number> = {};
    const byClass: Record<string, number> = { A: 0, B: 0, C: 0 };
    const byStatus: Record<string, number> = {};
    let totalValue = 0;
    materials.forEach(m => {
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
      if (m.class) byClass[m.class] = (byClass[m.class] || 0) + 1;
      const s = m.status || 'Disponible';
      byStatus[s] = (byStatus[s] || 0) + 1;
      totalValue += (m.unitCost || 0);
    });
    return JSON.stringify({
      totalAssets: materials.length,
      totalInventoryValue: totalValue,
      byCategory,
      byClass,
      byStatus,
      topByValue: materials
        .filter(m => (m.unitCost || 0) > 0)
        .sort((a, b) => (b.unitCost || 0) - (a.unitCost || 0))
        .slice(0, 50)
        .map(m => ({ name: m.name, category: m.category, class: m.class, unitCost: m.unitCost, status: m.status })),
    });
  }, [materials]);

  const handleGenerateReport = async () => {
    setIsGeneratingReport(true);
    setIsReportModalOpen(true);
    try {
      const res = await generateStrategicReport(fullContextString);
      if (res.ok && res.report) {
        setSmartReport(res.report);
      } else {
        throw new Error(res.error || "No se pudo generar el reporte.");
      }
    } catch (error) {
      setSmartReport("Error al generar el reporte técnico.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleExportFullInventory = async () => {
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Inventario Completo');

      worksheet.columns = [
        { header: 'ID', key: 'id', width: 25 },
        { header: 'Nombre', key: 'name', width: 40 },
        { header: 'Categoría', key: 'category', width: 25 },
        { header: 'Stock', key: 'stock', width: 10 },
        { header: 'Unidad', key: 'unit', width: 10 },
        { header: 'Clase', key: 'class', width: 10 },
        { header: 'Tipo de Uso', key: 'usageType', width: 15 },
        { header: 'Costo Unitario', key: 'unitCost', width: 15, style: { numFmt: '$ #,##0' } },
        { header: 'Estado', key: 'status', width: 20 },
        { header: 'N° Serie', key: 'serialNumber', width: 20 },
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.addRows(materials.map(m => ({ ...m, status: getStatusLabel(m) })));

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Inventario_PAGNOL_${new Date().toISOString().split('T')[0]}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error("Error al exportar a Excel:", error);
      toast({ variant: 'destructive', title: 'Error de Exportación' });
    } finally {
      setIsExporting(false);
    }
  };

  const getStatusColor = (status: AssetStatus) => {
    switch (status) {
      case 'Disponible': return 'bg-green-100 text-green-700';
      case 'En Uso': return 'bg-blue-100 text-blue-700';
      case 'En Mantenimiento': return 'bg-yellow-100 text-yellow-700';
      case 'Para Baja':
      case 'Extraviado': return 'bg-red-100 text-red-700';
      case 'Agotado': return 'bg-red-100 text-red-700';
      case 'Stock Crítico': return 'bg-amber-100 text-amber-700';
      case 'Archivado':
      default: return 'bg-slate-100 text-slate-700';
    }
  };



  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <PageHeader
        title="Gestión de Activos"
        description="Catálogo maestro de inventario, clasificaciones, stock y proveedores."
      />

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
        <div className="flex items-center gap-3 bg-card p-2 rounded-[1.5rem] border shadow-sm w-full sm:w-auto overflow-x-auto no-scrollbar">
          <button onClick={() => setViewMode('grid')} className={`flex-1 sm:flex-none p-3 rounded-[1rem] transition-all flex items-center justify-center ${viewMode === 'grid' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground'}`}><Grid size={20} /></button>
          <button onClick={() => setViewMode('list')} className={`flex-1 sm:flex-none p-3 rounded-[1rem] transition-all flex items-center justify-center ${viewMode === 'list' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground'}`}><List size={20} /></button>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
          <div className="relative w-full md:w-[400px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input
              type="text"
              placeholder="Buscar por ID o Descripción..."
              className="pl-12 pr-6 py-4 h-auto bg-card border rounded-[1.5rem] focus:ring-4 focus:ring-primary/10 w-full"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            {canManageCatalog && (
              <Button
                onClick={openAddModal}
                className="w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-5 sm:py-4 rounded-[1.5rem] transform hover:scale-105 active:scale-95 shadow-lg shadow-primary/10"
              >
                <Plus size={18} /> Registrar Activo
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 bg-card p-6 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] border shadow-sm animate-in slide-in-from-top-2 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-2 h-full bg-primary opacity-20"></div>
        <div className="flex items-center gap-3 text-foreground mb-2 sm:mb-0">
          <FilterIcon size={18} className="text-primary" />
          <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em]">Filtros</span>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-end gap-4 sm:gap-6 w-full lg:w-auto">
          <div className="flex flex-col space-y-2">
            <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1">Estado Operativo</label>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="bg-muted/50 border rounded-xl px-4 py-2 h-10 text-[10px] font-bold uppercase tracking-widest transition-all w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-xl shadow-2xl border-none">
                <SelectItem value="ALL">TODOS LOS ESTADOS</SelectItem>
                {['Disponible', 'En Mantenimiento', 'Para Baja', 'Extraviado', 'En Uso', 'Agotado', 'Stock Crítico', 'Archivado'].map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col space-y-2">
            <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1">Matriz de Clase</label>
            <Select value={selectedClass} onValueChange={setSelectedClass}>
              <SelectTrigger className="bg-muted/50 border rounded-xl px-4 py-2 h-10 text-[10px] font-bold uppercase tracking-widest transition-all w-full sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-xl shadow-2xl border-none">
                <SelectItem value="ALL">TODAS LAS CLASES</SelectItem>
                {['A', 'B', 'C'].map(cl => <SelectItem key={cl} value={cl}>{cl}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col space-y-2">
            <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1">Modelo de Uso</label>
            <Select value={selectedUseType} onValueChange={setSelectedUseType}>
              <SelectTrigger className="bg-muted/50 border rounded-xl px-4 py-2 h-10 text-[10px] font-bold uppercase tracking-widest transition-all w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-xl shadow-2xl border-none">
                <SelectItem value="ALL">TODOS LOS TIPOS</SelectItem>
                {['Consumible', 'Retornable', 'Permanente'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => { setSelectedStatus('ALL'); setSelectedClass('ALL'); setSelectedUseType('ALL'); setFilter(''); }}
            variant="ghost"
            className="h-10 px-4 text-[9px] font-black text-muted-foreground rounded-xl hover:bg-muted transition-all uppercase tracking-widest flex items-center gap-2"
          >
            <X size={14} /> Limpiar
          </Button>
        </div>

        <div className="ml-auto bg-slate-900 dark:bg-slate-800 text-white px-4 py-2 rounded-xl flex items-center gap-3 shrink-0">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
          <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">{filteredAssets.length} Activos</span>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
          {filteredAssets.slice(0, visibleCount).map(asset => {
            const overdue = isMaintenanceOverdue(asset.nextMaintenanceDate);
            const soon = isMaintenanceSoon(asset.nextMaintenanceDate);
            const status = getStatusLabel(asset);

            return (
              <div key={asset.id} className="bg-card rounded-[2.5rem] border shadow-sm overflow-hidden group hover:shadow-2xl transition-all duration-300 flex flex-col h-full relative">
                <div className="relative h-40 bg-muted overflow-hidden">
                  {asset.photos && asset.photos.length > 0 ? (
                    <Image
                      src={asset.photos[0]}
                      alt={asset.name}
                      layout="fill"
                      loading="lazy"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1536px) 33vw, 25vw"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Camera size={48} strokeWidth={1} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
                  {(overdue || soon) && (
                    <div className={`absolute top-6 left-6 p-2.5 rounded-2xl shadow-xl animate-bounce z-10 ${overdue ? 'bg-red-600 text-white' : 'bg-yellow-500 text-white'}`}>
                      <AlertTriangle size={20} />
                    </div>
                  )}
                  <span className={`absolute top-6 right-6 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${getStatusColor(status)} shadow-2xl`}>
                    {status}
                  </span>
                  <span className="absolute bottom-6 left-6 px-3 py-1.5 bg-background text-foreground text-[9px] rounded-xl font-black tracking-[0.2em] uppercase">
                    CLASE {asset.class || 'N/A'}
                  </span>
                </div>
                <div className="p-4 sm:p-6 flex flex-col flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"></div>
                    <p className="text-[9px] sm:text-[10px] text-primary font-black uppercase tracking-[0.2em]">{asset.category}</p>
                  </div>
                  <h4 className="font-black text-base sm:text-lg tracking-tight mb-4 leading-tight group-hover:text-primary transition-colors min-h-[3rem] line-clamp-2 uppercase">
                    {asset.name}
                  </h4>
                  <div className="space-y-3 mb-6">
                    {asset.nextMaintenanceDate && (
                      <div className={`flex items-center gap-3 p-3 rounded-xl border ${overdue ? 'bg-red-50 border-red-100 text-red-600' : soon ? 'bg-yellow-50 border-yellow-100 text-yellow-600' : 'bg-slate-50 dark:bg-slate-800 dark:border-slate-700 text-muted-foreground'}`}>
                        {overdue ? <AlertCircle size={14} className="shrink-0" /> : <CalendarClock size={14} className="shrink-0" />}
                        <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest">Mantenimiento: {toDate(asset.nextMaintenanceDate)?.toLocaleDateString('es-CL') || 'N/A'}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] font-bold text-muted-foreground px-1">
                      <span className="uppercase tracking-widest opacity-60">S/N</span>
                      <span className="text-foreground uppercase">{asset.serialNumber || 'N/A'}</span>
                    </div>
                    {asset.usageType === 'Consumible' && (
                      <div className="flex justify-between text-[10px] font-bold text-muted-foreground px-1">
                        <span className="uppercase tracking-widest opacity-60">Stock Volumen</span>
                        <span className="text-primary font-black">{asset.stock || 0} {asset.unit}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-auto pt-6 border-t flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">ID PAGNOL</p>
                        <p className="text-[11px] font-black mt-0.5 text-slate-600 font-mono tracking-tighter">{asset.internalCode || asset.id}</p>
                      </div>
                      <button
                        onClick={() => openQrModal(asset)}
                        className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition-all"
                        title="Ver Código QR"
                      >
                        <QrCode size={14} />
                      </button>
                      {asset.technicalSheetUrl && (
                        <a
                          href={asset.technicalSheetUrl}
                          download={asset.technicalSheetName || "ficha_tecnica.pdf"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 bg-pagnol-orange/10 hover:bg-pagnol-orange text-pagnol-orange hover:text-white rounded-lg transition-all"
                          title="Bajar Ficha Técnica"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download size={14} />
                        </a>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest mb-1">Costo Unit.</p>
                      <p className="text-[12px] font-black text-pagnol-dark">{formatCLP(asset.unitCost || 0)}</p>
                    </div>
                    {canManageCatalog && (
                      <div className="text-right">
                        <button onClick={(e) => { e.stopPropagation(); openEditModal(asset); }} className="p-3 bg-slate-50 hover:bg-primary hover:text-white rounded-xl text-muted-foreground transition-all"><Edit3 size={16} /></button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredAssets.length > visibleCount && (
            <div className="col-span-full py-12 flex flex-col items-center gap-4 bg-slate-50/50 rounded-[3rem] border-2 border-dashed border-slate-200 animate-in fade-in slide-in-from-bottom-4">
              <p className="text-[11px] font-black uppercase text-muted-foreground tracking-widest">Mostrando {Math.min(visibleCount, filteredAssets.length)} de {filteredAssets.length} activos industriales</p>
              <Button
                onClick={() => setVisibleCount(prev => prev + ITEMS_PER_LOAD)}
                className="px-10 py-6 rounded-[1.5rem] bg-white text-slate-900 border shadow-xl hover:bg-slate-50 transition-all font-black text-xs uppercase tracking-widest"
              >
                Cargar más Activos <ChevronDown size={18} className="ml-2" />
              </Button>
            </div>
          )}
        </div>

      ) : (
        <div className="bg-card rounded-[2.5rem] border shadow-sm overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left min-w-[1000px]">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="px-8 py-5 text-[9px] font-black text-muted-foreground uppercase tracking-widest">Activo / Descripción</th>
                  <th className="px-8 py-5 text-[9px] font-black text-muted-foreground uppercase tracking-widest">ID PAGNOL</th>
                  <th className="px-8 py-5 text-[9px] font-black text-muted-foreground uppercase tracking-widest">Clasificación Detallada</th>
                  <th className="px-8 py-5 text-[9px] font-black text-muted-foreground uppercase tracking-widest">Mantenimiento</th>
                  <th className="px-8 py-5 text-[9px] font-black text-muted-foreground uppercase tracking-widest text-right">Costo Unit.</th>
                  {canManageCatalog && <th className="px-8 py-5 text-[9px] font-black text-muted-foreground uppercase tracking-widest text-center">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAssets.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE).map(asset => {
                  const overdue = isMaintenanceOverdue(asset.nextMaintenanceDate);
                  const soon = isMaintenanceSoon(asset.nextMaintenanceDate);
                  const isExpanded = expandedRowId === asset.id;

                  return (
                    <React.Fragment key={asset.id}>
                      <tr
                        className={`hover:bg-muted/50 transition-all cursor-pointer group ${isExpanded ? 'bg-orange-50/40' : ''}`}
                        onClick={() => setExpandedRowId(isExpanded ? null : asset.id)}
                      >
                        <td className="px-10 py-6">
                          <div className="flex items-center gap-5">
                            <div className="w-12 h-12 rounded-2xl bg-muted overflow-hidden flex-shrink-0 group-hover:scale-110 transition-transform relative">
                              {asset.photos && asset.photos.length > 0 ? <Image src={asset.photos[0]} className="w-full h-full object-cover" alt={asset.name} width={48} height={48} loading="lazy" /> : <Camera className="p-3 text-muted-foreground" />}
                              {(overdue || soon) && (
                                <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center border border-white shadow-sm animate-pulse ${overdue ? 'bg-red-600' : 'bg-yellow-500'}`}>
                                  <AlertTriangle size={8} className="text-white" />
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="font-black text-sm uppercase tracking-tight line-clamp-1">{asset.name}</div>
                              <div className="text-[9px] text-muted-foreground font-bold uppercase mt-0.5">{asset.category}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-10 py-6 text-xs font-black text-muted-foreground tracking-widest font-mono">{asset.internalCode || asset.id}</td>
                        <td className="px-10 py-6">
                          <div className="text-[10px] font-black text-foreground/60 uppercase tracking-widest">CLASE {asset.class}</div>
                          <div className="text-[9px] text-muted-foreground font-bold uppercase mt-1 tracking-widest">{asset.usageType}</div>
                        </td>
                        <td className="px-10 py-6">
                          {asset.nextMaintenanceDate ? (
                            <div className={`flex items-center gap-2 font-black text-[9px] uppercase tracking-widest ${overdue ? 'text-red-500' : soon ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                              {overdue ? <AlertCircle size={14} className="animate-pulse" /> : soon ? <CalendarClock size={14} /> : <Calendar size={14} />}
                              {toDate(asset.nextMaintenanceDate)?.toLocaleDateString('es-CL')}
                            </div>
                          ) : (
                            <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">No programado</span>
                          )}
                        </td>
                        <td className="px-10 py-6 text-sm text-right font-black tracking-tight">{formatCLP(asset.unitCost || 0)}</td>
                        {canManageCatalog && (
                          <td className="px-10 py-6 text-center">
                            <div className={`p-2.5 rounded-2xl transition-all ${isExpanded ? 'bg-primary text-white' : 'text-slate-300 group-hover:bg-muted/80 group-hover:text-primary'}`}>
                              {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </div>
                          </td>
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/30">
                          <td colSpan={canManageCatalog ? 7 : 6} className="p-8">
                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
                              <div className="lg:col-span-1">
                                <div className="w-full aspect-square rounded-[3rem] overflow-hidden border-8 border-card shadow-2xl relative">
                                  <Image
                                    src={asset.photos?.[0] || `https://picsum.photos/seed/${asset.id}/400/400`}
                                    alt={asset.name}
                                    layout="fill"
                                    loading="lazy"
                                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900/80 backdrop-blur-md text-white rounded-xl text-[9px] font-black uppercase tracking-widest">
                                    Vista Técnica 01
                                  </div>
                                </div>
                              </div>
                              <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-10">
                                <div className="space-y-6">
                                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Settings size={14} className="text-primary" /> Parámetros de Fábrica
                                  </p>
                                  <div className="space-y-4 pt-2">
                                    <div className="flex flex-col border-b border-slate-200 dark:border-slate-700 pb-2">
                                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">N° de Serie / Manufacturer</span>
                                      <span className="text-xs font-bold text-foreground uppercase mt-0.5">{asset.serialNumber || 'N/A'}</span>
                                    </div>
                                    <div className="flex flex-col border-b border-slate-200 dark:border-slate-700 pb-2">
                                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Fecha de Adquisición</span>
                                      <span className="text-xs font-bold text-foreground uppercase mt-0.5">{toDate(asset.acquisitionDate)?.toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' }) || 'N/A'}</span>
                                    </div>
                                    <div className="flex flex-col border-b border-slate-200 dark:border-slate-700 pb-2">
                                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Modelo de Uso</span>
                                      <span className="text-xs font-bold text-foreground uppercase mt-0.5">{asset.usageType || 'N/A'}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-6">
                                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Activity size={14} className="text-primary" /> Trazabilidad Operativa
                                  </p>
                                  <div className="space-y-4 pt-2">
                                    <div className="flex flex-col border-b border-slate-200 dark:border-slate-700 pb-2">
                                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Clasificación Matriz</span>
                                      <span className="text-xs font-bold text-foreground uppercase mt-0.5">CLASE {asset.class} ({asset.class === 'A' ? 'CRÍTICO/ALTO VALOR' : asset.class === 'B' ? 'IMPORTANTE' : 'FUNGIBLE'})</span>
                                    </div>
                                    <div className="flex flex-col border-b border-slate-200 dark:border-slate-700 pb-2">
                                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Criticidad del Recurso</span>
                                      <span className="text-xs font-bold text-primary uppercase mt-0.5">ALTA (SECTOR ESTRUCTURAS)</span>
                                    </div>
                                    <div className="flex flex-col border-b border-slate-200 dark:border-slate-700 pb-2">
                                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Stock Disponible</span>
                                      <span className="text-xs font-bold text-foreground uppercase mt-0.5">{asset.stock} {asset.unit === 'unidad' ? 'Unidades Físicas' : asset.unit}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-4">
                                  <div className="bg-card p-6 rounded-[2rem] border shadow-sm flex flex-col gap-4 h-full">
                                    <h6 className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-2">
                                      <Wrench size={14} /> Gestión Administrativa
                                    </h6>
                                    <div className="flex flex-col gap-2 flex-grow justify-center">
                                      <Button onClick={() => openQrModal(asset)} variant="outline" className="w-full justify-between rounded-[1.5rem] h-12 px-6 bg-slate-900 text-white hover:bg-black border-none">Imprimir QR <QrCode size={14} /></Button>
                                      {asset.technicalSheetUrl ? (
                                        <a
                                          href={asset.technicalSheetUrl}
                                          download={asset.technicalSheetName || "ficha_tecnica.pdf"}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center"
                                        >
                                          <Button variant="outline" className="w-full justify-between rounded-[1.5rem] h-12 px-6 bg-pagnol-orange text-white hover:bg-orange-600 border-none">Descargar Ficha <Download size={14} /></Button>
                                        </a>
                                      ) : (
                                        <Button disabled variant="outline" className="w-full justify-between rounded-[1.5rem] h-12 px-6 opacity-30">Sin Ficha Técnica <Download size={14} /></Button>
                                      )}
                                      <Button onClick={() => openEditModal(asset)} variant="outline" className="w-full justify-between rounded-[1.5rem] h-12 px-6">Editar Ficha <Edit3 size={14} /></Button>
                                      <Button onClick={() => openMaintenanceModal(asset)} variant="outline" className="w-full justify-between rounded-[1.5rem] h-12 px-6">Mantenimiento <Calendar size={14} /></Button>
                                      {canManageCatalog && <Button onClick={() => openRetireModal(asset)} variant="destructive" className="w-full justify-between bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-700 rounded-[1.5rem] h-12 px-6 border-none shadow-sm">Solicitar Baja <Trash2 size={14} /></Button>}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* List pagination */}
          {filteredAssets.length > LIST_PAGE_SIZE && (
            <div className="flex items-center justify-between px-10 py-5 border-t bg-muted/30">
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                {listPage * LIST_PAGE_SIZE + 1}–{Math.min((listPage + 1) * LIST_PAGE_SIZE, filteredAssets.length)} de {filteredAssets.length} activos
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl text-xs font-black uppercase"
                  onClick={() => setListPage(p => Math.max(0, p - 1))}
                  disabled={listPage === 0}
                >
                  ← Anterior
                </Button>
                <span className="text-[10px] font-black text-muted-foreground px-2">
                  Pág. {listPage + 1} / {Math.ceil(filteredAssets.length / LIST_PAGE_SIZE)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl text-xs font-black uppercase"
                  onClick={() => setListPage(p => Math.min(Math.ceil(filteredAssets.length / LIST_PAGE_SIZE) - 1, p + 1))}
                  disabled={(listPage + 1) * LIST_PAGE_SIZE >= filteredAssets.length}
                >
                  Siguiente →
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODALS */}
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-xl p-0 border-none bg-transparent overflow-hidden sm:rounded-[3rem] shadow-3xl h-full sm:h-auto">
            <div className="flex flex-col h-full sm:max-h-[90vh] bg-card sm:rounded-[3rem] overflow-hidden">
              <DialogHeader className="p-6 sm:p-10 industrial-gradient text-white flex flex-row justify-between items-center shrink-0 relative">
                <div>
                  <DialogTitle className="text-3xl font-black tracking-tighter uppercase leading-none text-white font-outfit">
                    {modalType === 'ADD' ? 'Registro de Activo' : modalType === 'EDIT' ? 'Edición de Ficha' : modalType === 'MAINTENANCE' ? 'Control de Mantenimiento' : 'Solicitud de Baja'}
                  </DialogTitle>
                  <DialogDescription className="text-white/40 text-[11px] font-black uppercase tracking-[0.2em] mt-2">
                    PAGNOL IMS CORE SYSTEM | FAENA NORTE
                  </DialogDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsModalOpen(false)} className="p-3 bg-white/5 rounded-2xl text-white/40 hover:text-white hover:bg-white/10 transition-all absolute top-10 right-10"><X size={24} /></Button>
              </DialogHeader>
              {modalType === 'RETIRE' ? (
                <div className="text-center py-10 px-10 space-y-8">
                  <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto shadow-xl">
                    <Trash2 size={48} />
                  </div>
                  <div>
                    <h5 className="text-2xl font-black text-pagnol-dark uppercase tracking-tight">¿Confirmar solicitud de baja?</h5>
                    <p className="text-muted-foreground font-medium mt-2">Esta acción marcará el activo {selectedAsset.name} como fuera de servicio permanente.</p>
                  </div>
                  <DialogFooter className="p-10 border-t flex flex-row justify-between items-center shrink-0 bg-card">
                    <Button onClick={() => setIsModalOpen(false)} variant="ghost" className="px-8 py-6 rounded-2xl text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-slate-600">Cancelar</Button>
                    <Button onClick={() => handleUpdateStatus('Para Baja')} className="px-10 py-6 rounded-2xl text-[11px] font-black uppercase tracking-widest bg-destructive hover:bg-red-700 text-white shadow-xl shadow-destructive/20 transition-all transform hover:scale-105" variant="destructive">Ejecutar Baja</Button>
                  </DialogFooter>
                </div>
              ) : modalType === 'MAINTENANCE' ? (
                <form onSubmit={handleSubmit(handleSaveAsset)} className="flex flex-col flex-1 overflow-y-auto">
                  <div className="p-10 space-y-8">
                    <div className="bg-yellow-50 border border-yellow-100 p-8 rounded-3xl flex gap-6 items-center uppercase tracking-tight">
                      <div className="p-4 bg-white rounded-2xl text-yellow-600 shadow-sm"><Wrench size={32} /></div>
                      <div>
                        <p className="text-[10px] font-black text-yellow-700 uppercase tracking-widest">Intervención Técnica</p>
                        <h6 className="font-black text-pagnol-dark uppercase">{selectedAsset.name}</h6>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Próxima Fecha de Mantenimiento</Label>
                        <Controller control={control} name="nextMaintenanceDate" render={({ field }) => (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="w-full justify-start text-left font-normal py-6 rounded-2xl"><CalendarIcon className="mr-2 h-4 w-4" />{field.value ? format(field.value, "PPP", { locale: es }) : "Selecciona fecha"}</Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0"><CalendarUI mode="single" selected={field.value ?? undefined} onSelect={field.onChange} initialFocus /></PopoverContent>
                          </Popover>
                        )} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Nuevo Estado Operativo</Label>
                        <Controller control={control} name="status" render={({ field }) => (
                          <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger className="py-6 rounded-2xl"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Disponible">DISPONIBLE (OK)</SelectItem>
                              <SelectItem value="En Mantenimiento">EN TALLER (BLOQUEADO)</SelectItem>
                            </SelectContent>
                          </Select>
                        )} />
                      </div>
                    </div>
                  </div>
                  <DialogFooter className="p-10 border-t flex flex-row justify-between items-center shrink-0 bg-card">
                    <Button type="button" onClick={() => setIsModalOpen(false)} variant="ghost" className="px-8 py-6 rounded-2xl text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-slate-600">Cancelar</Button>
                    <Button type="submit" className="px-10 py-6 rounded-2xl text-[11px] font-black uppercase tracking-widest bg-pagnol-orange hover:bg-orange-600 text-white shadow-xl shadow-pagnol-orange/20 transition-all transform hover:scale-105 active:scale-95"><Save size={16} className="mr-2" /> Actualizar Plan de Mantenimiento</Button>
                  </DialogFooter>
                </form>
              ) : (
                <form onSubmit={handleSubmit(handleSaveAsset)} className="flex flex-col flex-1 overflow-y-auto">
                  <div className="p-10 space-y-6 custom-scrollbar">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Descripción Técnica / Certificación</Label>
                      <Input id="name" {...register("name")} placeholder="Marca, Modelo, Especificación..." className="py-6 rounded-2xl" />
                      {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="serialNumber" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Número de Serie (SN)</Label>
                        <Input id="serialNumber" {...register("serialNumber")} placeholder="N/A" className="py-6 rounded-2xl" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="categoryId" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Categoría Logística</Label>
                        <Controller name="categoryId" control={control} render={({ field }) => (
                          <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger className="py-6 rounded-2xl"><SelectValue placeholder="EPP..." /></SelectTrigger>
                            <SelectContent>
                              {materialCategories.map((cat: MaterialCategory) => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )} />
                        {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId.message}</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="class" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Clase de Criticidad (Auto)</Label>
                        <Controller name="class" control={control} render={({ field }) => (
                          <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger className="py-6 rounded-2xl bg-slate-50 border-dashed"><SelectValue placeholder="Clase C" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="A">Clase A (Crítico)</SelectItem>
                              <SelectItem value="B">Clase B (Importante)</SelectItem>
                              <SelectItem value="C">Clase C (No Crítico / Fungible)</SelectItem>
                            </SelectContent>
                          </Select>
                        )} />
                        {errors.class && <p className="text-xs text-destructive">{errors.class.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="unitCost" className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Costo Neto (CLP$)</Label>
                        <Input id="unitCost" type="number" placeholder="0" {...register("unitCost")} className="py-6 rounded-2xl" />
                      </div>
                    </div>

                    <div className="bg-orange-50 border border-orange-100 p-6 rounded-[2rem] space-y-6">
                      <h6 className="text-[10px] font-black uppercase text-pagnol-orange tracking-widest flex items-center gap-2">
                        <ShieldCheck size={14} /> ISO 55001 - Matriz de Riesgo y Jerarquía
                      </h6>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-2">Probabilidad de Falla (1-5)</Label>
                          <Input type="number" min={1} max={5} {...register("failureProbability")} className="py-6 rounded-2xl" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-2">Impacto Operacional (1-5)</Label>
                          <Input type="number" min={1} max={5} {...register("failureImpact")} className="py-6 rounded-2xl" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-2">Activo Padre (Taxonomía)</Label>
                        <Controller name="parentId" control={control} render={({ field }) => (
                          <Select onValueChange={(val) => field.onChange(val === 'none' ? null : val)} value={field.value || 'none'}>
                            <SelectTrigger className="py-6 rounded-2xl"><SelectValue placeholder="Seleccionar Padre..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Ninguno (Activo Principal)</SelectItem>
                              {materials.filter(m => m.id !== selectedAsset?.id && m.class === 'A').map(m => (
                                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )} />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <Label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2">Ficha Técnica del Activo (PDF/DOC)</Label>
                      <div className="relative group">
                        <div className={cn(
                          "border-2 border-dashed rounded-[2rem] p-8 text-center transition-all cursor-pointer hover:bg-slate-50",
                          techSheetFile ? "border-pagnol-orange bg-orange-50/30" : "border-slate-200"
                        )}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                          onClick={() => document.getElementById('tech-sheet-input')?.click()}>
                          <input
                            type="file"
                            id="tech-sheet-input"
                            className="hidden"
                            accept=".pdf,.doc,.docx"
                            onChange={handleTechSheetUpload}
                          />
                          {techSheetFile || selectedAsset.technicalSheetUrl ? (
                            <div className="flex flex-col items-center gap-2">
                              <FileText className="text-pagnol-orange" size={32} />
                              <p className="text-xs font-black text-slate-700 uppercase tracking-tight">{techSheetFile?.name || selectedAsset.technicalSheetName || 'Archivo Cargado'}</p>
                              <p className="text-[9px] font-bold text-pagnol-orange uppercase tracking-widest">Haga clic para cambiar archivo</p>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-2">
                              <div className="p-4 bg-slate-100 rounded-2xl text-muted-foreground group-hover:text-primary transition-colors">
                                <FileUp size={32} />
                              </div>
                              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-2">Arrastra o selecciona la ficha técnica</p>
                              <p className="text-[9px] text-muted-foreground">PDF o WORD (Máx 5MB)</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <DialogFooter className="p-10 border-t flex flex-row justify-between items-center shrink-0 bg-card">
                    <Button type="button" onClick={() => setIsModalOpen(false)} variant="ghost" className="px-8 py-6 rounded-2xl text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-slate-600">Cancelar</Button>
                    <Button type="submit" disabled={isSubmitting} className="px-10 py-6 rounded-2xl text-[11px] font-black uppercase tracking-widest bg-pagnol-orange hover:bg-orange-600 text-white shadow-xl shadow-pagnol-orange/20 transition-all transform hover:scale-105 active:scale-95">
                      {isSubmitting ? <Loader2 className="animate-spin" /> : <Plus size={20} />}
                      Finalizar Registro
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* QR MODAL */}
      {isQrModalOpen && qrAsset && (
        <Dialog open={isQrModalOpen} onOpenChange={setIsQrModalOpen}>
          <DialogContent className="max-w-md p-0 border-none bg-transparent overflow-hidden rounded-[3rem] shadow-3xl">
            <div className="bg-card rounded-[3rem] overflow-hidden">
              <DialogHeader className="p-10 bg-slate-900 text-white flex flex-row justify-between items-center shrink-0 relative">
                <div>
                  <DialogTitle className="text-2xl font-black tracking-tighter uppercase leading-none text-white font-outfit">Código QR del Activo</DialogTitle>
                  <DialogDescription className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-2">{qrAsset.internalCode || qrAsset.id}</DialogDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsQrModalOpen(false)} className="p-3 bg-white/5 rounded-2xl text-white/40 hover:text-white hover:bg-white/10 transition-all absolute top-10 right-10"><X size={24} /></Button>
              </DialogHeader>
              <div className="p-10 flex flex-col items-center gap-8">
                <div className="p-6 bg-white rounded-[2rem] shadow-lg border-2 border-slate-100 group hover:scale-105 transition-transform duration-500">
                  <div id="qr-print-area">
                    <QRWithPagnolLogo value={qrAsset.internalCode || qrAsset.id} size={200} />
                  </div>
                </div>
                <div className="text-center">
                  <h4 className="font-black text-lg uppercase text-slate-900">{qrAsset.name}</h4>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-2">ID ÚNICO DE RASTREO PAGNOL</p>
                </div>
              </div>
              <DialogFooter className="p-10 pt-0 flex gap-4">
                <Button onClick={handlePrintQR} className="w-full py-6 rounded-2xl bg-pagnol-orange hover:bg-orange-600 text-white shadow-xl shadow-orange-200 uppercase font-black text-xs tracking-widest flex items-center gap-3">
                  <Printer size={18} /> Imprimir Etiqueta
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* REPORT MODAL */}
      {isReportModalOpen && (
        <Dialog open={isReportModalOpen} onOpenChange={setIsReportModalOpen}>
          <DialogContent className="max-w-5xl p-0 border-none bg-transparent overflow-hidden rounded-[3rem] shadow-3xl">
            <div className="flex flex-col max-h-[90vh] bg-card rounded-[3rem] overflow-hidden">
              <DialogHeader className="p-10 industrial-gradient text-white flex flex-row justify-between items-center shrink-0 relative">
                <div className="flex items-center gap-6">
                  <div className="p-4 bg-pagnol-orange rounded-3xl shadow-xl shadow-pagnol-orange/20 animate-pulse">
                    <FileText size={32} />
                  </div>
                  <div>
                    <DialogTitle className="text-3xl font-black tracking-tighter uppercase leading-none text-white font-outfit">Informe Técnico de Existencias</DialogTitle>
                    <DialogDescription className="text-white/40 text-[11px] font-black uppercase tracking-[0.2em] mt-2">Generado vía Pagnol AI Intelligence</DialogDescription>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsReportModalOpen(false)} className="p-3 bg-white/5 rounded-2xl text-white/40 hover:text-white hover:bg-white/10 transition-all absolute top-10 right-10"><X size={24} /></Button>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto p-12 space-y-12 custom-scrollbar bg-background">
                {isGeneratingReport ? (
                  <div className="py-32 flex flex-col items-center text-center space-y-8 animate-in fade-in">
                    <div className="relative">
                      <div className="w-24 h-24 border-8 border-pagnol-orange/10 border-t-pagnol-orange rounded-full animate-spin"></div>
                      <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-pagnol-orange animate-bounce" size={32} />
                    </div>
                    <div>
                      <h5 className="text-2xl font-black text-pagnol-dark uppercase tracking-tighter">Procesando Inteligencia de Datos</h5>
                      <p className="text-muted-foreground font-medium mt-2 max-w-sm mx-auto">Gemini está analizando las métricas de inventario.</p>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed font-medium italic">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{smartReport}</ReactMarkdown>
                  </div>
                )}
              </div>
              <DialogFooter className="p-10 border-t flex flex-row justify-end items-center shrink-0 bg-card">
                <Button onClick={() => setIsReportModalOpen(false)} className="px-10 py-6 rounded-2xl text-[11px] font-black uppercase tracking-widest bg-pagnol-dark hover:bg-black text-white shadow-xl transition-all">Cerrar Reporte</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
