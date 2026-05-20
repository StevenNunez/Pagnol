"use client";

import React, { useState, useRef } from 'react';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    FileUp,
    FileSpreadsheet,
    Download,
    CheckCircle2,
    Loader2,
    Trash2,
    ArrowRight,
    Edit2,
    X,
    Check,
    Laptop,
    ShieldAlert,
    Database,
    AlertCircle,
    Info,
    RefreshCw,
    Layers,
    History,
    FileSearch,
    Type,
    Plug,
    Building2,
    ShieldCheck,
    Cable,
    Zap,
    Workflow,
    Lock,
    ExternalLink,
    Sparkles
} from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Material } from '@/modules/core/lib/data';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { nanoid } from 'nanoid';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Printer, Coins, Settings2 } from 'lucide-react';
import { supabase } from '@/modules/core/lib/supabase';
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';

interface ParsedAsset extends Omit<Material, 'id'> {
    tempId: string; // Internal temporary ID for the UI
    validationStatus: 'ready' | 'warning' | 'error';
    validationErrors: string[];
    isDuplicate: boolean;
    duplicateId?: string;
    action: 'create' | 'update' | 'ignore' | 'merge';
}

interface UploadFileState {
    id: string;
    file: File;
    status: 'parsing' | 'validating' | 'ready' | 'uploading' | 'completed' | 'error';
    progress: number;
    assets: ParsedAsset[];
    error?: string;
}

export default function CargaMasivaPage() {
    const { addMaterial, updateMaterial, addMaterialCategory, materialCategories, materials, refreshData } = useAppState();
    const { toast } = useToast();

    // New Multi-file state
    const [uploadFiles, setUploadFiles] = useState<UploadFileState[]>([]);
    const [selectedFileId, setSelectedFileId] = useState<number | null>(null); // Index of selected file

    // UI Helpers
    const [isParsing, setIsParsing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadPhase, setUploadPhase] = useState<'idle' | 'validating' | 'connecting' | 'ingesting' | 'verifying' | 'done' | 'error'>('idle');
    const [processedCount, setProcessedCount] = useState(0);
    const [uploadChunkInfo, setUploadChunkInfo] = useState<{ current: number; total: number } | null>(null);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editForm, setEditForm] = useState<ParsedAsset | null>(null);
    const [categoryUsageMap, setCategoryUsageMap] = useState<Record<string, 'Consumible' | 'Reutilizable Controlado' | 'Herramienta Menor' | 'Repuesto Crítico' | 'Activo Fijo' | 'IT Controlado'>>({});
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [lastInjectedCount, setLastInjectedCount] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 50;

    const [uploadMethod, setUploadMethod] = useState<'standard' | 'api' | 'legacy' | null>(null);
    const [selectedERP, setSelectedERP] = useState<'defontana' | 'softland' | 'netsuite' | 'custom' | null>(null);
    const [erpCredentials, setErpCredentials] = useState<Record<string, string>>({
        clientId: '',
        clientSecret: '',
        tenantId: '',
        apiKey: ''
    });
    const [isConnectingERP, setIsConnectingERP] = useState(false);
    const [erpConnectionStatus, setErpConnectionStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const { currentTenantId, user: currentUser } = useAuth();
    const router = useRouter();

    const formatCLP = (amount: number) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            minimumFractionDigits: 0
        }).format(amount);
    };

    // Criticality Settings
    const [thresholds, setThresholds] = useState({ thresholdA: 1000000, thresholdB: 500000 });
    const [isSavingThresholds, setIsSavingThresholds] = useState(false);
    const [showCriticalityConfig, setShowCriticalityConfig] = useState(true);

    useEffect(() => {
        if (currentTenantId) {
            fetchThresholds();
        }
    }, [currentTenantId]);

    const fetchThresholds = async () => {
        try {
            const { data: tenant, error } = await supabase
                .from('tenants')
                .select('criticality_settings')
                .eq('id', currentTenantId)
                .single();

            if (error) throw error;

            if (tenant?.criticality_settings) {
                setThresholds({
                    thresholdA: tenant.criticality_settings.thresholdA,
                    thresholdB: tenant.criticality_settings.thresholdB
                });
            }
        } catch (error) {
            console.error("Error fetching thresholds:", error);
        }
    };

    const saveThresholds = async () => {
        if (!currentTenantId) return;
        setIsSavingThresholds(true);
        try {
            const { error } = await supabase
                .from('tenants')
                .update({
                    criticality_settings: {
                        thresholdA: thresholds.thresholdA,
                        thresholdB: thresholds.thresholdB,
                        currency: 'CLP'
                    }
                })
                .eq('id', currentTenantId);

            if (error) throw error;

            toast({ title: "Configuración Guardada", description: "Los parámetros de criticidad han sido actualizados en CLP$." });
            setShowCriticalityConfig(false);
        } catch (error: any) {
            console.error("Error saving thresholds:", error);
            toast({
                variant: "destructive",
                title: "Error de Guardado",
                description: error.message || "No se pudieron guardar los parámetros. Verifica tu conexión."
            });
        } finally {
            setIsSavingThresholds(false);
        }
    };

    // Getter for currently visible assets
    const activeFile = selectedFileId !== null ? uploadFiles[selectedFileId] : null;
    const assets = activeFile?.assets || [];

    const downloadTemplate = async () => {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('PAGNOL ISO 55000');

        worksheet.columns = [
            { header: 'Nombre del Activo', key: 'name', width: 30 },
            { header: 'Categoría Logística', key: 'category', width: 25 },
            { header: 'Descripción Técnica / Certificación', key: 'description', width: 40 },
            { header: 'Número de Serie (SN)', key: 'serialNumber', width: 20 },
            { header: 'Tipo de Activo', key: 'usageType', width: 25 },
            { header: 'Naturaleza Contable', key: 'accountingNature', width: 25 },
            { header: 'Vida Útil (Años)', key: 'usefulLife', width: 15 },
            { header: 'Stock Inicial', key: 'stock', width: 12 },
            { header: 'Unidad', key: 'unit', width: 10 },
            { header: 'Costo Neto (CLP$)', key: 'unitCost', width: 15 },
        ];

        // Header Style
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF204A57' } };

        const examples = [
            {
                name: 'CAMIÓN ELÉCTRICO 797F',
                category: 'Maquinaria Pesada',
                description: 'Motor C175-20 / Transmisión Mecánica',
                serialNumber: 'CAT-797-X88',
                usageType: 'Activo Fijo',
                accountingNature: 'CAPEX',
                usefulLife: 15,
                stock: 1,
                unit: 'und',
                unitCost: 3500000000
            },
            {
                name: 'RADIO VHF PORTÁTIL',
                category: 'Equipos Portátiles',
                description: 'Motorola DG-5500 / Intrínsicamente Segura',
                serialNumber: 'MOT-33922-B',
                usageType: 'Reutilizable Controlado',
                accountingNature: 'Activo Menor Capitalizable',
                usefulLife: 3,
                stock: 50,
                unit: 'und',
                unitCost: 450000
            },
            {
                name: 'MASCARILLA N95',
                category: 'EPP Desechable',
                description: 'Protección Particulado / Pack 10 unidades',
                serialNumber: 'LOTE-2024-001',
                usageType: 'Consumible',
                accountingNature: 'OPEX',
                usefulLife: 0,
                stock: 1000,
                unit: 'und',
                unitCost: 1200
            }
        ];

        examples.forEach(ex => worksheet.addRow(ex));

        // Add validation for usageType and accountingNature columns
        const usageTypes = "Consumible,Reutilizable Controlado,Herramienta Menor,Repuesto Crítico,Activo Fijo,IT Controlado";
        const accountingTypes = "CAPEX,OPEX,Inventario Estratégico,Activo Menor Capitalizable";

        for (let i = 2; i <= 1000; i++) {
            const usageCell = worksheet.getCell(`E${i}`);
            const accountingCell = worksheet.getCell(`F${i}`);

            (usageCell as any).dataValidation = {
                type: 'list',
                allowBlank: true,
                formulae: [`"${usageTypes}"`]
            };
            (accountingCell as any).dataValidation = {
                type: 'list',
                allowBlank: true,
                formulae: [`"${accountingTypes}"`]
            };
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `PAGNOL_ISO55000_Ingesta_${new Date().toISOString().split('T')[0]}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const validateAsset = (asset: Partial<ParsedAsset>, existingMaterials: Material[]): ParsedAsset => {
        const errors: string[] = [];
        let status: 'ready' | 'warning' | 'error' = 'ready';

        // 1. Mandatory Fields
        if (!asset.name) errors.push('Nombre requerido');
        if (!asset.category) errors.push('Categoría requerida');
        if (asset.stock === undefined || asset.stock < 0) errors.push('Stock inválido');

        // 2. Duplicate Detection — match by name + serialNumber against existing materials
        const duplicate = existingMaterials.find(m =>
            m.name?.trim().toLowerCase() === (asset.name || '').trim().toLowerCase() &&
            (m.serialNumber?.trim()?.toLowerCase() || '') === ((asset.serialNumber || '').trim().toLowerCase())
        ) || null;

        if (duplicate) {
            status = 'warning';
            errors.push('Activo existente detectado — se actualizará');
        }

        if (errors.some(e => !e.startsWith('Activo existente'))) {
            status = 'error';
        }


        // Automatic Criticality Assignment based on Thresholds
        let finalClass = asset.class || 'B';
        if (asset.unitCost !== undefined && asset.unitCost > 0) {
            if (asset.unitCost >= thresholds.thresholdA) finalClass = 'A';
            else if (asset.unitCost >= thresholds.thresholdB) finalClass = 'B';
            else finalClass = 'C';
        }

        // Logical CAPEX/OPEX mapping if missing
        let finalAccounting = asset.accountingNature;
        if (!finalAccounting) {
            if (asset.usageType === 'Activo Fijo') finalAccounting = 'CAPEX';
            else if (asset.usageType === 'Consumible') finalAccounting = 'OPEX';
            else if (asset.usageType === 'Repuesto Crítico') finalAccounting = 'Inventario Estratégico';
            else finalAccounting = 'OPEX';
        }

        return {
            ...asset,
            tempId: asset.tempId || nanoid(),
            validationStatus: status,
            validationErrors: errors,
            isDuplicate: !!duplicate,
            duplicateId: duplicate?.id,
            action: duplicate ? 'update' : 'create',
            name: asset.name || '',
            category: asset.category || '',
            stock: asset.stock || 0,
            unitCost: asset.unitCost || 0,
            unit: asset.unit || 'und',
            class: finalClass,
            usageType: asset.usageType || 'Consumible',
            accountingNature: finalAccounting,
            usefulLife: asset.usefulLife || 0,
            serialNumber: asset.serialNumber || '',
            description: asset.description || '',
            status: asset.status || 'Disponible',
            isITAsset: asset.usageType === 'IT Controlado',
        } as ParsedAsset;
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setIsParsing(true);

        for (const file of files) {
            const fileId = nanoid();
            const newFileState: UploadFileState = {
                id: fileId,
                file,
                status: 'parsing',
                progress: 0,
                assets: []
            };

            setUploadFiles(prev => [...prev, newFileState]);
            const currentFileIndex = uploadFiles.length; // Approximate index

            try {
                const workbook = new ExcelJS.Workbook();
                const arrayBuffer = await file.arrayBuffer();
                await workbook.xlsx.load(arrayBuffer);
                const worksheet = workbook.getWorksheet(1);

                if (!worksheet) {
                    throw new Error("El archivo no contiene hojas válidas.");
                }

                // --- Validación de Plantilla ---
                const expectedHeaders = [
                    'Nombre del Activo',
                    'Categoría Logística',
                    'Descripción Técnica / Certificación',
                    'Número de Serie (SN)',
                    'Tipo de Activo',
                    'Naturaleza Contable',
                    'Vida Útil (Años)',
                    'Stock Inicial',
                    'Unidad',
                    'Costo Neto (CLP$)',
                ];

                const firstRow = worksheet.getRow(1);
                const actualHeaders: string[] = [];
                for (let i = 1; i <= expectedHeaders.length; i++) {
                    actualHeaders.push(firstRow.getCell(i).text.trim());
                }

                const isValidTemplate = expectedHeaders.every((h, i) => h === actualHeaders[i]);

                if (!isValidTemplate) {
                    toast({
                        variant: 'destructive',
                        title: 'Plantilla No Compatible',
                        description: 'Debes usar la plantilla oficial de Pagnol (alineada con ISO 55001) para procesar la carga. No elimines columnas.'
                    });
                    setUploadFiles(prev => prev.map(f =>
                        f.file === file ? { ...f, status: 'error', error: 'Formato Incorrecto. Use Plantilla ISO.' } : f
                    ));
                    continue;
                }
                // -----------------------------
                const parsedAssets: ParsedAsset[] = [];

                worksheet?.eachRow((row, rowNumber) => {
                    if (rowNumber === 1) return; // Skip header

                    const rawAsset: Partial<ParsedAsset> = {
                        name: row.getCell(1).text.trim(),
                        category: row.getCell(2).text.trim(),
                        description: row.getCell(3).text.trim(),
                        serialNumber: row.getCell(4).text.trim(),
                        usageType: row.getCell(5).text.trim() as any,
                        accountingNature: row.getCell(6).text.trim() as any,
                        usefulLife: Number(row.getCell(7).value) || 0,
                        stock: Number(row.getCell(8).value) || 0,
                        unit: row.getCell(9).text.trim() || 'und',
                        unitCost: Number(row.getCell(10).value) || 0,
                        status: 'Disponible'
                    };

                    parsedAssets.push(validateAsset(rawAsset, materials));
                });

                setUploadFiles(prev => prev.map(f =>
                    f.file === file ? { ...f, assets: parsedAssets, status: 'ready' } : f
                ));

                if (selectedFileId === null) setSelectedFileId(uploadFiles.length);

            } catch (error) {
                console.error(error);
                setUploadFiles(prev => prev.map(f =>
                    f.file === file ? { ...f, status: 'error', error: 'Error al procesar Excel' } : f
                ));
            }
        }

        setIsParsing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const [lastDuplicatesCount, setLastDuplicatesCount] = useState(0);
    const [lastUpdatedCount, setLastUpdatedCount] = useState(0);

    const handleUpload = async () => {
        if (!activeFile) return;

        const CHUNK_SIZE = 1000; // ~2MB por request, bien bajo el límite de Vercel (6MB)
        const assetsToProcess = activeFile.assets.filter(a => a.action !== 'ignore');
        const totalToProcess = assetsToProcess.length;

        const chunks: typeof assetsToProcess[] = [];
        for (let i = 0; i < assetsToProcess.length; i += CHUNK_SIZE) {
            chunks.push(assetsToProcess.slice(i, i + CHUNK_SIZE));
        }
        const totalChunks = chunks.length;

        const animateProgress = (from: number, to: number, duration: number): Promise<void> =>
            new Promise(resolve => {
                const steps = 14;
                const stepTime = duration / steps;
                const stepSize = (to - from) / steps;
                let i = 0;
                const id = setInterval(() => {
                    i++;
                    setProgress(Math.round(from + stepSize * i));
                    if (i >= steps) { clearInterval(id); resolve(); }
                }, stepTime);
            });

        setIsUploading(true);
        setProgress(0);
        setProcessedCount(0);
        setUploadChunkInfo(null);

        setUploadPhase('validating');
        await animateProgress(0, 12, 600);

        setUploadPhase('connecting');
        await animateProgress(12, 22, 700);

        setUploadPhase('ingesting');

        let totalInserted = 0;
        let totalUpdated = 0;
        let totalDuplicates = 0;
        let processedSoFar = 0;

        try {
            for (let ci = 0; ci < totalChunks; ci++) {
                const chunk = chunks[ci];
                setUploadChunkInfo({ current: ci + 1, total: totalChunks });
                setProcessedCount(processedSoFar);

                // Progreso: 22% a 80% distribuido por chunks
                const progressFrom = 22 + (ci / totalChunks) * 58;
                const progressTo = 22 + ((ci + 1) / totalChunks) * 58;

                const response = await fetch('/api/bulk-upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tenantId: currentTenantId,
                        user: { id: currentUser?.id, name: currentUser?.name },
                        assets: chunk,
                        customUsageTypeMap: categoryUsageMap,
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `Error HTTP ${response.status} en lote ${ci + 1}`);
                }

                const result = await response.json();
                if (!result.success) throw new Error(result.error || `Error en lote ${ci + 1} de ${totalChunks}`);

                totalInserted += result.inserted || 0;
                totalUpdated += result.updated || 0;
                totalDuplicates += result.duplicates || 0;
                processedSoFar += chunk.length;

                await animateProgress(progressFrom, progressTo, 350);
                setProcessedCount(processedSoFar);
            }

            setProcessedCount(totalToProcess);
            setUploadChunkInfo(null);
            setUploadPhase('verifying');
            await animateProgress(80, 95, 700);
            setUploadPhase('done');
            await animateProgress(95, 100, 500);

            setLastInjectedCount(totalInserted);
            setLastUpdatedCount(totalUpdated);
            setLastDuplicatesCount(totalDuplicates);
            refreshData('materials');

            await new Promise(r => setTimeout(r, 900));

            setIsUploading(false);
            setUploadPhase('idle');
            setProgress(0);
            setUploadFiles(prev => prev.filter(f => f.id !== activeFile.id));
            setSelectedFileId(prev => prev !== null && prev > 0 ? prev - 1 : null);
            setShowSuccessModal(true);

        } catch (error: any) {
            console.error("Bulk upload err:", error);
            const errorMessage = error.message || 'Hubo un problema de conexión con el backend.';
            setUploadFiles(prev => prev.map(f =>
                f.id === activeFile.id ? { ...f, status: 'error' as const, error: errorMessage } : f
            ));
            toast({ variant: 'destructive', title: 'Error en Ingesta', description: errorMessage });
            setIsUploading(false);
            setUploadPhase('idle');
            setProgress(0);
            setUploadChunkInfo(null);
        }
    };

    const handleConnectERP = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedERP) return;

        setErpConnectionStatus('loading');

        try {
            // We use a proxy in our backend to avoid CORS and protect credentials
            const response = await fetch('/api/integrations/erp-connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    erp: selectedERP,
                    credentials: erpCredentials,
                    tenantId: currentTenantId
                }),
            });

            const data = await response.json();

            if (response.ok) {
                setErpConnectionStatus('success');
                toast({
                    title: 'Conexión Exitosa',
                    description: `Sincronización con ${selectedERP.toUpperCase()} activada correctamente.`
                });
            } else {
                throw new Error(data.error || 'Error al validar credenciales');
            }
        } catch (error: any) {
            console.error('ERP Connection Error:', error);
            setErpConnectionStatus('error');
            toast({
                variant: 'destructive',
                title: 'Error de Conexión',
                description: error.message || 'No se pudo establecer el puente con el ERP.'
            });
        }
    };

    const removeAsset = (index: number) => {
        if (selectedFileId === null) return;
        setUploadFiles(prev => prev.map((f, idx) =>
            idx === selectedFileId ? { ...f, assets: f.assets.filter((_, i) => i !== index) } : f
        ));
        if (editingIndex === index) {
            setEditingIndex(null);
            setEditForm(null);
        }
    };

    const startEditing = (index: number) => {
        if (selectedFileId === null) return;
        setEditingIndex(index);
        setEditForm({ ...uploadFiles[selectedFileId].assets[index] });
    };

    const saveEdit = () => {
        if (selectedFileId !== null && editingIndex !== null && editForm) {
            setUploadFiles(prev => prev.map((f, idx) => {
                if (idx === selectedFileId) {
                    const newAssets = [...f.assets];
                    newAssets[editingIndex] = validateAsset(editForm, materials);
                    return { ...f, assets: newAssets };
                }
                return f;
            }));
            setEditingIndex(null);
            setEditForm(null);
        }
    };

    const cancelEdit = () => {
        setEditingIndex(null);
        setEditForm(null);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            <PageHeader
                title="Centro de Ingesta e Integración"
                description="Gestión automatizada de activos bajo estándares internacionales y conexión directa con ecosistemas ERP"
            />

            {!uploadMethod ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-20">
                    <Card
                        onClick={() => setUploadMethod('standard')}
                        className="group cursor-pointer rounded-[2.5rem] border-none shadow-2xl shadow-slate-200/50 bg-slate-100 hover:shadow-pagnol-orange/20 transition-all duration-500 overflow-hidden relative"
                    >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full translate-x-12 -translate-y-12 group-hover:bg-pagnol-orange/10 transition-colors"></div>
                        <CardHeader className="p-10 space-y-4">
                            <div className="w-16 h-16 rounded-2xl bg-slate-900 text-white flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                                <ShieldCheck size={32} />
                            </div>
                            <div className="space-y-2">
                                <CardTitle className="text-2xl font-black uppercase font-outfit tracking-tight leading-none text-slate-800">Alineado ISO 55001</CardTitle>
                                <Badge className="bg-pagnol-orange text-white border-none text-[8px] font-black uppercase tracking-widest px-2 py-0.5">ISO 55001 Ready</Badge>
                            </div>
                            <CardDescription className="text-xs font-medium text-muted-foreground leading-relaxed uppercase tracking-wide">
                                Diseñado para organizaciones bajo normas <b>IAM, CIPS, APICS</b> o módulos <b>SAP PM/MM</b>. Plantilla estructurada para facilitar el cumplimiento ISO 55001.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-10 pt-0 group">
                            <div className="flex items-center gap-3 text-pagnol-orange font-black text-[10px] uppercase tracking-widest">
                                <span>Iniciar carga técnica</span>
                                <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
                            </div>
                        </CardContent>
                    </Card>

                    <Card
                        onClick={() => setUploadMethod('api')}
                        className="group cursor-pointer rounded-[2.5rem] border-none shadow-2xl shadow-slate-200/50 bg-slate-100 hover:shadow-blue-500/20 transition-all duration-500 overflow-hidden relative"
                    >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full translate-x-12 -translate-y-12 group-hover:bg-blue-500/10 transition-colors"></div>
                        <CardHeader className="p-10 space-y-4">
                            <div className="w-16 h-16 rounded-2xl bg-blue-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                                <Plug size={32} />
                            </div>
                            <div className="space-y-2">
                                <CardTitle className="text-2xl font-black uppercase font-outfit tracking-tight leading-none text-slate-800">Conexión ERP API</CardTitle>
                                <Badge className="bg-blue-100 text-blue-600 border-none text-[8px] font-black uppercase tracking-widest px-2 py-0.5">Sincronización Realtime</Badge>
                            </div>
                            <CardDescription className="text-xs font-medium text-muted-foreground leading-relaxed uppercase tracking-wide">
                                Vinculación directa con <b>De Fontana, Softland</b> y otros sistemas ERP. Recopilación automatizada mediante endpoints de cliente.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-10 pt-0">
                            <div className="flex items-center gap-3 text-blue-600 font-black text-[10px] uppercase tracking-widest">
                                <span>Configurar integración</span>
                                <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
                            </div>
                        </CardContent>
                    </Card>

                    <Card
                        onClick={() => setUploadMethod('legacy')}
                        className="group cursor-pointer rounded-[2.5rem] border-none shadow-2xl shadow-slate-200/50 bg-slate-100 hover:shadow-slate-500/20 transition-all duration-500 overflow-hidden relative"
                    >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full translate-x-12 -translate-y-12 group-hover:bg-slate-500/10 transition-colors"></div>
                        <CardHeader className="p-10 space-y-4">
                            <div className="w-16 h-16 rounded-2xl bg-slate-400 text-white flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                                <RefreshCw size={32} />
                            </div>
                            <div className="space-y-2">
                                <CardTitle className="text-2xl font-black uppercase font-outfit tracking-tight leading-none text-slate-800">Migración Legacy</CardTitle>
                                <Badge className="bg-slate-100 text-muted-foreground border-none text-[8px] font-black uppercase tracking-widest px-2 py-0.5">Mapeo Personalizado</Badge>
                            </div>
                            <CardDescription className="text-xs font-medium text-muted-foreground leading-relaxed uppercase tracking-wide">
                                Para sistemas propietarios no estandarizados. Migramos su esquema actual a la estructura de Pagnol, alineada con las mejores prácticas de la ISO 55000.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-10 pt-0">
                            <div className="flex items-center gap-3 text-muted-foreground font-black text-[10px] uppercase tracking-widest">
                                <span>Solicitar asistencia</span>
                                <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            ) : uploadMethod === 'standard' ? (
                <>
                    <div className="flex items-center justify-between mb-2">
                        <Button
                            variant="ghost"
                            onClick={() => setUploadMethod(null)}
                            className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-slate-900"
                        >
                            <ArrowRight size={14} className="rotate-180 mr-2" /> Volver a Selección de Método
                        </Button>
                    </div>
                    {/* EXISTING ISO UPLOAD UI STARTS HERE */}

                    {/* Configuración de Criticidad */}
                    <AnimatePresence>
                        {showCriticalityConfig && (
                            <motion.div
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                            >
                                <Card className="rounded-[2rem] border-none shadow-xl shadow-slate-200/50 bg-slate-100 overflow-hidden border-l-8 border-l-pagnol-orange">
                                    <CardHeader className="p-8 pb-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="p-3 bg-orange-50 text-pagnol-orange rounded-2xl">
                                                    <ShieldAlert size={20} />
                                                </div>
                                                <div>
                                                    <CardTitle className="text-lg font-black uppercase tracking-tight">Parámetros de Criticidad</CardTitle>
                                                    <CardDescription className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Define los valores para clasificar activos automáticamente</CardDescription>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="icon" onClick={() => setShowCriticalityConfig(false)} className="rounded-xl">
                                                <X size={18} className="text-slate-300" />
                                            </Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-8 pt-4 space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-3">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Mínimo para Clase A | CLP$</Label>
                                                <div className="relative">
                                                    <Coins className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                                                    <Input
                                                        type="number"
                                                        value={thresholds.thresholdA}
                                                        onChange={(e) => setThresholds({ ...thresholds, thresholdA: Number(e.target.value) })}
                                                        className="pl-12 h-14 rounded-2xl border-slate-100 bg-slate-50/50 font-black text-slate-700"
                                                        placeholder="Ej: 1.000.000"
                                                    />
                                                </div>
                                                <p className="text-[9px] font-bold text-muted-foreground px-2 uppercase">Activos con costo superior a este valor serán Clase A</p>
                                            </div>
                                            <div className="space-y-3">
                                                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Mínimo para Clase B | CLP$</Label>
                                                <div className="relative">
                                                    <Coins className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                                                    <Input
                                                        type="number"
                                                        value={thresholds.thresholdB}
                                                        onChange={(e) => setThresholds({ ...thresholds, thresholdB: Number(e.target.value) })}
                                                        className="pl-12 h-14 rounded-2xl border-slate-100 bg-slate-50/50 font-black text-slate-700"
                                                        placeholder="Ej: 500.000"
                                                    />
                                                </div>
                                                <p className="text-[9px] font-bold text-muted-foreground px-2 uppercase">Activos entre este valor y Clase A serán Clase B. El resto será Clase C.</p>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={saveThresholds}
                                            disabled={isSavingThresholds}
                                            className="bg-slate-900 hover:bg-black text-white rounded-xl px-8 h-12 font-black text-[10px] uppercase tracking-widest gap-2"
                                        >
                                            {isSavingThresholds ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                                            Establecer y Continuar con la Carga
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {!showCriticalityConfig && (
                        <div className="flex justify-end mb-4">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowCriticalityConfig(true)}
                                className="rounded-xl gap-2 font-black text-[9px] uppercase tracking-widest text-muted-foreground border-slate-100"
                            >
                                <Settings2 size={14} />
                                Ajustar Criticidad
                            </Button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* Lateral Panel */}
                        <div className="space-y-6 lg:col-span-1">
                            <Card className="rounded-[2.5rem] border-none shadow-xl shadow-slate-200/50 bg-slate-100 overflow-hidden">
                                <CardHeader className="bg-slate-50 border-b">
                                    <CardTitle className="text-lg font-black uppercase font-outfit text-slate-800">Operaciones</CardTitle>
                                </CardHeader>
                                <CardContent className="p-6 space-y-6">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase text-muted-foreground">Paso 1: Estructura</Label>
                                        <Button
                                            variant="outline"
                                            onClick={downloadTemplate}
                                            className="w-full rounded-[1.2rem] py-8 border-2 border-dashed border-slate-200 hover:border-slate-900 hover:bg-slate-50 group transition-all"
                                        >
                                            <Download className="mr-3 text-muted-foreground group-hover:text-slate-900 group-hover:scale-110 transition-all" size={20} />
                                            <div className="text-left">
                                                <p className="font-black text-[10px] uppercase tracking-widest">Descargar Plantilla</p>
                                                <p className="text-[8px] font-bold text-pagnol-orange uppercase">¡Uso Obligatorio!</p>
                                            </div>
                                        </Button>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase text-muted-foreground">Paso 2: Subida</Label>
                                        <div
                                            className="grid grid-cols-1 gap-4"
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const files = Array.from(e.dataTransfer.files);
                                                if (files.length > 0) {
                                                    const event = { target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>;
                                                    handleFileUpload(event);
                                                }
                                            }}
                                        >
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                className="hidden"
                                                accept=".xlsx, .xls"
                                                multiple
                                                onChange={handleFileUpload}
                                            />
                                            <Button
                                                disabled={isParsing || isUploading}
                                                variant="outline"
                                                onClick={() => fileInputRef.current?.click()}
                                                className="w-full py-10 rounded-[1.5rem] border-2 border-slate-200 hover:border-pagnol-orange hover:bg-orange-50 transition-all group"
                                            >
                                                <div className="flex flex-col items-center">
                                                    <FileUp size={24} className="mb-2 text-muted-foreground group-hover:text-pagnol-orange transition-all" />
                                                    <span className="font-black text-[9px] uppercase tracking-widest text-slate-600">Añadir Archivos o Arrastrar Aquí</span>
                                                </div>
                                            </Button>
                                        </div>
                                    </div>

                                    {uploadFiles.length > 0 && (
                                        <div className="space-y-3 pt-6 border-t border-slate-100">
                                            <Label className="text-[10px] font-black uppercase text-muted-foreground">Cola de Procesamiento</Label>
                                            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 no-scrollbar">
                                                {uploadFiles.map((f, idx) => (
                                                    <div
                                                        key={f.id}
                                                        onClick={() => setSelectedFileId(idx)}
                                                        className={`p-4 rounded-2xl border-2 transition-all cursor-pointer group relative overflow-hidden ${selectedFileId === idx ? 'border-pagnol-orange bg-orange-50/30' : 'border-slate-100 hover:border-slate-200 bg-slate-50/50'}`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className={`p-2 rounded-xl ${selectedFileId === idx ? 'bg-pagnol-orange text-white' : 'bg-slate-100 text-muted-foreground'}`}>
                                                                <FileSpreadsheet size={16} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-[10px] font-black uppercase truncate text-slate-700">{f.file.name}</p>
                                                                <div className="flex flex-col gap-1 mt-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <Badge variant="outline" className="text-[7px] font-bold px-1.5 h-4">{f.assets.length} ITEMS</Badge>
                                                                        {f.status === 'ready' && <span className="text-[8px] font-black text-green-500 uppercase">Listo</span>}
                                                                        {f.status === 'error' && <span className="text-[8px] font-black text-red-500 uppercase">Falla</span>}
                                                                        {f.status === 'uploading' && <Loader2 className="animate-spin text-pagnol-orange" size={10} />}
                                                                    </div>
                                                                    {f.status === 'error' && f.error && (
                                                                        <p className="text-[7px] font-bold text-red-400 bg-red-50 p-1 rounded-md uppercase line-clamp-1 border border-red-100 flex items-center gap-1">
                                                                            <AlertCircle size={8} /> {f.error}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setUploadFiles(prev => prev.filter(file => file.id !== f.id));
                                                                    if (selectedFileId === idx) setSelectedFileId(null);
                                                                }}
                                                                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {activeFile && activeFile.assets.length > 0 && (
                                <Card className="rounded-[2.5rem] border-none shadow-xl shadow-slate-100 bg-slate-100 overflow-hidden animate-in slide-in-from-bottom-5 duration-500">
                                    <CardHeader className="bg-slate-50 border-b p-6">
                                        <CardTitle className="text-sm font-black uppercase font-outfit flex items-center gap-2">
                                            <Layers size={16} className="text-muted-foreground" /> Categorías & Flags
                                        </CardTitle>
                                        <CardDescription className="text-[9px] font-bold uppercase text-muted-foreground mt-1">Configura el comportamiento masivo por familia</CardDescription>
                                    </CardHeader>
                                    <CardContent className="p-6 space-y-4">
                                        <div className="space-y-3 overflow-y-auto max-h-[400px] pr-2 no-scrollbar">
                                            {Array.from(new Set(activeFile.assets.map(a => a.category))).map(catName => (
                                                <div key={catName} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <p className="text-[10px] font-black uppercase text-slate-700 leading-tight">{catName}</p>
                                                            {!materialCategories.some(c => c.name === catName) && (
                                                                <Badge className="bg-orange-100 text-pagnol-orange border-none text-[7px] font-black uppercase px-2 h-4 mt-1">Nuevo Registro Maestro</Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-[8px] font-black uppercase text-muted-foreground">Flag: Tipo de Uso</Label>
                                                        <Select
                                                            value={categoryUsageMap[catName] || ""}
                                                            onValueChange={(val: any) => setCategoryUsageMap(prev => ({ ...prev, [catName]: val }))}
                                                        >
                                                            <SelectTrigger className="h-9 text-[9px] font-black uppercase rounded-xl bg-slate-100 border-slate-200">
                                                                <SelectValue placeholder="AUTO" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="Consumible" className="text-[9px] font-black uppercase">Consumible</SelectItem>
                                                                <SelectItem value="Reutilizable Controlado" className="text-[9px] font-black uppercase">Reutilizable (Herramienta/Equipo)</SelectItem>
                                                                <SelectItem value="Herramienta Menor" className="text-[9px] font-black uppercase">Herramienta Menor</SelectItem>
                                                                <SelectItem value="Repuesto Crítico" className="text-[9px] font-black uppercase">Repuesto Crítico</SelectItem>
                                                                <SelectItem value="Activo Fijo" className="text-[9px] font-black uppercase">Activo Fijo (CAPEX)</SelectItem>
                                                                <SelectItem value="IT Controlado" className="text-[9px] font-black uppercase">IT Controlado</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="p-4 bg-orange-50/50 rounded-2xl border border-orange-100/50 text-center">
                                            <p className="text-[8px] font-bold text-pagnol-orange uppercase leading-relaxed">Pagnol registrará estas categorías de forma exclusiva para tu empresa durante la ingesta.</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {activeFile && activeFile.assets.length > 0 && (() => {
                                const toCreate = activeFile.assets.filter(a => a.action === 'create').length;
                                const toUpdate = activeFile.assets.filter(a => a.action === 'update').length;
                                const toProcess = toCreate + toUpdate;
                                const circumference = 2 * Math.PI * 45;

                                const uploadPhases = [
                                    { key: 'validating', label: 'Validando datos' },
                                    { key: 'connecting', label: 'Conectando servidor' },
                                    { key: 'ingesting', label: 'Ingestando activos' },
                                    { key: 'verifying', label: 'Verificando integridad' },
                                ];
                                const phaseOrder = ['validating', 'connecting', 'ingesting', 'verifying', 'done'];
                                const currentPhaseIdx = phaseOrder.indexOf(uploadPhase);

                                return (
                                    <Card className="rounded-[2.5rem] border-none shadow-2xl shadow-orange-100 overflow-hidden animate-in zoom-in-95 duration-300">
                                        {!isUploading ? (
                                            <>
                                                <CardHeader className="bg-pagnol-orange/5 border-b border-orange-100 p-6">
                                                    <CardTitle className="text-lg font-black uppercase font-outfit flex items-center gap-3">
                                                        <CheckCircle2 className="text-pagnol-orange" size={20} /> Ejecutar Carga
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent className="p-6 space-y-5 bg-slate-100">
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-end">
                                                            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Validación</p>
                                                            <span className="text-[10px] font-black text-slate-600">{activeFile.assets.filter(a => a.validationStatus === 'ready').length} / {activeFile.assets.length}</span>
                                                        </div>
                                                        <Progress value={(activeFile.assets.filter(a => a.validationStatus === 'ready').length / activeFile.assets.length) * 100} className="h-1.5" />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                                            <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest mb-1">Duplicados</p>
                                                            <p className="text-xl font-black font-outfit text-amber-600">{activeFile.assets.filter(a => a.isDuplicate).length}</p>
                                                        </div>
                                                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                                            <p className="text-[8px] font-black text-muted-foreground uppercase tracking-widest mb-1">Errores</p>
                                                            <p className="text-xl font-black font-outfit text-red-600">{activeFile.assets.filter(a => a.validationStatus === 'error').length}</p>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        disabled={activeFile.assets.some(a => a.validationStatus === 'error') || toProcess === 0}
                                                        onClick={handleUpload}
                                                        className="w-full py-8 rounded-[1.5rem] bg-slate-900 hover:bg-black text-white shadow-xl transition-all group overflow-hidden relative"
                                                    >
                                                        <div className="flex flex-col items-center gap-1">
                                                            <Database size={18} />
                                                            <span className="font-black text-[11px] uppercase tracking-widest">Ejecutar Carga · {toProcess} Activos</span>
                                                            {toProcess > 0 && (
                                                                <span className="text-[8px] font-bold text-white/50 uppercase tracking-widest">
                                                                    {toCreate > 0 && `${toCreate} nuevos`}{toCreate > 0 && toUpdate > 0 && ' · '}{toUpdate > 0 && `${toUpdate} actualizaciones`}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </Button>
                                                </CardContent>
                                            </>
                                        ) : (
                                            <div className="bg-slate-900 flex flex-col items-center gap-6 p-8">
                                                {/* Ring de progreso */}
                                                <div className="relative flex items-center justify-center mt-2">
                                                    <svg viewBox="0 0 100 100" className="w-36 h-36 -rotate-90">
                                                        <circle cx="50" cy="50" r="45" fill="none" stroke="#1e293b" strokeWidth="7" />
                                                        <circle
                                                            cx="50" cy="50" r="45"
                                                            fill="none"
                                                            stroke={uploadPhase === 'done' ? '#22c55e' : '#f97316'}
                                                            strokeWidth="7"
                                                            strokeLinecap="round"
                                                            strokeDasharray={circumference}
                                                            strokeDashoffset={circumference * (1 - progress / 100)}
                                                            style={{ transition: 'stroke-dashoffset 0.35s ease, stroke 0.4s ease' }}
                                                        />
                                                    </svg>
                                                    <div className="absolute flex flex-col items-center">
                                                        <span className="text-3xl font-black text-white font-outfit leading-none">{progress}%</span>
                                                        <span className="text-[8px] font-black text-white/30 uppercase tracking-widest mt-0.5">completado</span>
                                                    </div>
                                                </div>

                                                {/* Label de fase activa */}
                                                <div className="text-center">
                                                    <p className={cn("font-black text-[11px] uppercase tracking-widest", uploadPhase === 'done' ? 'text-green-400' : 'text-pagnol-orange animate-pulse')}>
                                                        {uploadPhase === 'validating' && 'Validando datos de pre-ingesta...'}
                                                        {uploadPhase === 'connecting' && 'Conectando con servidor Pagnol...'}
                                                        {uploadPhase === 'ingesting' && 'Ingestando activos al inventario...'}
                                                        {uploadPhase === 'verifying' && 'Verificando integridad de datos...'}
                                                        {uploadPhase === 'done' && '¡Carga completada!'}
                                                    </p>
                                                    {uploadPhase === 'ingesting' && (
                                                        <p className="text-white/30 text-[9px] font-bold mt-1 uppercase tracking-widest">
                                                            {processedCount.toLocaleString('es-CL')} / {toProcess.toLocaleString('es-CL')} activos
                                                            {uploadChunkInfo && uploadChunkInfo.total > 1 && (
                                                                <span className="text-pagnol-orange/50 ml-2">· Lote {uploadChunkInfo.current} de {uploadChunkInfo.total}</span>
                                                            )}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Lista de fases */}
                                                <div className="w-full space-y-2">
                                                    {uploadPhases.map((phase) => {
                                                        const phaseIdx = phaseOrder.indexOf(phase.key);
                                                        const isDone = currentPhaseIdx > phaseIdx;
                                                        const isActive = currentPhaseIdx === phaseIdx;
                                                        return (
                                                            <div key={phase.key} className={cn(
                                                                'flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300',
                                                                isDone ? 'bg-green-500/10' : isActive ? 'bg-pagnol-orange/10 border border-pagnol-orange/20' : 'bg-white/5'
                                                            )}>
                                                                <div className={cn(
                                                                    'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300',
                                                                    isDone ? 'bg-green-500' : isActive ? 'bg-pagnol-orange' : 'bg-white/10'
                                                                )}>
                                                                    {isDone
                                                                        ? <Check size={10} className="text-white" />
                                                                        : isActive
                                                                            ? <Loader2 size={10} className="text-white animate-spin" />
                                                                            : <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
                                                                    }
                                                                </div>
                                                                <span className={cn(
                                                                    'text-[9px] font-black uppercase tracking-widest transition-colors duration-300',
                                                                    isDone ? 'text-green-400' : isActive ? 'text-pagnol-orange' : 'text-white/20'
                                                                )}>
                                                                    {phase.label}
                                                                </span>
                                                                {isDone && (
                                                                    <span className="ml-auto text-[8px] font-black text-green-400/60 uppercase tracking-widest">listo</span>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Barra de progreso base */}
                                                <div className="w-full mb-2">
                                                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full transition-all duration-300"
                                                            style={{
                                                                width: `${progress}%`,
                                                                background: uploadPhase === 'done'
                                                                    ? 'linear-gradient(90deg, #22c55e, #86efac)'
                                                                    : 'linear-gradient(90deg, #f97316, #fb923c)'
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </Card>
                                );
                            })()}
                        </div>

                        {/* Main Content: Table/Edit */}
                        <div className="lg:col-span-3">
                            <Card className="rounded-[2.5rem] border-none shadow-2xl shadow-slate-200/50 bg-slate-100 overflow-hidden min-h-[700px]">
                                <CardHeader className="p-8 border-b flex flex-row items-center justify-between bg-slate-100 sticky top-0 z-10">
                                    <div>
                                        <CardTitle className="text-2xl font-black uppercase font-outfit">Control de Pre-Ingesta</CardTitle>
                                        <CardDescription className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-1">Verificación masiva de parámetros técnicos y financieros</CardDescription>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {assets.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-60 text-slate-300 opacity-60">
                                            <Database size={100} className="mb-6 opacity-20" />
                                            <p className="font-black uppercase text-sm tracking-widest text-muted-foreground">Consola de Espera de Datos</p>
                                            <p className="text-[10px] font-black uppercase opacity-60 max-w-[200px] text-center mt-2 leading-relaxed">Sube un archivo para comenzar la validación de activos industriales</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto no-scrollbar">
                                            <div className="p-4 bg-slate-50 border-b flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                                <span>Página {currentPage} de {Math.ceil(assets.length / ITEMS_PER_PAGE)}</span>
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 px-3 rounded-lg text-[9px]"
                                                        disabled={currentPage === 1}
                                                        onClick={() => setCurrentPage(prev => prev - 1)}
                                                    >Anterior</Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 px-3 rounded-lg text-[9px]"
                                                        disabled={currentPage >= Math.ceil(assets.length / ITEMS_PER_PAGE)}
                                                        onClick={() => setCurrentPage(prev => prev + 1)}
                                                    >Siguiente</Button>
                                                </div>
                                            </div>
                                            <table className="w-full min-w-[1000px]">

                                                <thead className="bg-slate-50 border-b">
                                                    <tr>
                                                        <th className="px-6 py-5 text-[9px] font-black uppercase text-muted-foreground text-left">Identidad / QR</th>
                                                        <th className="px-6 py-5 text-[9px] font-black uppercase text-muted-foreground text-left">Activos & SN</th>
                                                        <th className="px-6 py-5 text-[9px] font-black uppercase text-muted-foreground text-left">Config. Logística</th>
                                                        <th className="px-6 py-5 text-[9px] font-black uppercase text-muted-foreground text-center text-left">Ficha QR</th>
                                                        <th className="px-6 py-5 text-[9px] font-black uppercase text-muted-foreground text-center">Criticidad</th>
                                                        <th className="px-6 py-5 text-[9px] font-black uppercase text-muted-foreground text-right">Finanzas (Neto)</th>
                                                        <th className="px-6 py-5"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y">
                                                    {assets.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((asset, localIdx) => {
                                                        const idx = (currentPage - 1) * ITEMS_PER_PAGE + localIdx;
                                                        const isEditing = editingIndex === idx;

                                                        return (
                                                            <tr key={asset.tempId} className={`hover:bg-slate-50/50 transition-colors ${isEditing ? 'bg-orange-50/50' : ''}`}>
                                                                <td className="px-6 py-6 align-top">
                                                                    <div className="flex flex-col gap-1.5">
                                                                        <Badge className={`w-fit border-none font-mono text-[9px] rounded-lg px-2 ${asset.validationStatus === 'error' ? 'bg-red-500' : asset.validationStatus === 'warning' ? 'bg-amber-500' : 'bg-slate-900 font-black'}`}>
                                                                            {asset.validationStatus.toUpperCase()}
                                                                        </Badge>
                                                                        {asset.validationErrors.map((err, i) => (
                                                                            <span key={i} className="text-[8px] font-bold text-red-500 uppercase flex items-center gap-1">
                                                                                <AlertCircle size={8} /> {err}
                                                                            </span>
                                                                        ))}
                                                                        {asset.isDuplicate && (
                                                                            <div className="mt-2 p-2 bg-amber-50 rounded-xl border border-amber-100 space-y-2">
                                                                                <p className="text-[8px] font-black text-amber-700 uppercase">Conflicto Detectado</p>
                                                                                <Select
                                                                                    value={asset.action}
                                                                                    onValueChange={(val: any) => {
                                                                                        setUploadFiles(prev => prev.map((f, fIdx) => {
                                                                                            if (fIdx === selectedFileId) {
                                                                                                return { ...f, assets: f.assets.map((a, i) => i === idx ? { ...a, action: val } : a) };
                                                                                            }
                                                                                            return f;
                                                                                        }));
                                                                                    }}
                                                                                >
                                                                                    <SelectTrigger className="h-7 text-[8px] font-black uppercase bg-slate-100">
                                                                                        <SelectValue />
                                                                                    </SelectTrigger>
                                                                                    <SelectContent>
                                                                                        <SelectItem value="create" className="text-[9px] font-black">CREAR COMO NUEVO</SelectItem>
                                                                                        <SelectItem value="update" className="text-[9px] font-black">ACTUALIZAR EXISTENTE</SelectItem>
                                                                                        <SelectItem value="ignore" className="text-[9px] font-black text-red-500">IGNORAR / EXCLUIR</SelectItem>
                                                                                    </SelectContent>
                                                                                </Select>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-6 align-top min-w-[300px]">
                                                                    {isEditing ? (
                                                                        <div className="space-y-3">
                                                                            <Input
                                                                                placeholder="Nombre del Activo"
                                                                                value={editForm?.name}
                                                                                onChange={e => setEditForm(prev => prev ? { ...prev, name: e.target.value } : null)}
                                                                                className="h-9 text-xs font-black uppercase rounded-xl border-slate-200"
                                                                            />
                                                                            <Input
                                                                                placeholder="SN / Fabricante"
                                                                                value={editForm?.serialNumber}
                                                                                onChange={e => setEditForm(prev => prev ? { ...prev, serialNumber: e.target.value } : null)}
                                                                                className="h-9 text-[10px] font-bold uppercase rounded-xl border-slate-200"
                                                                            />
                                                                            <Textarea
                                                                                placeholder="Descripción técnica / Certificación"
                                                                                value={editForm?.description}
                                                                                onChange={e => setEditForm(prev => prev ? { ...prev, description: e.target.value } : null)}
                                                                                className="w-full min-h-[80px] text-[10px] p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-pagnol-orange/20 uppercase font-medium"
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex flex-col">
                                                                            <div className="flex items-center gap-2 mb-1">
                                                                                <span className="font-black text-xs uppercase text-slate-800 leading-tight">{asset.name}</span>
                                                                                <Badge className="bg-slate-100 text-muted-foreground border-none rounded-md text-[7px] font-black px-1 h-3.5 italic">{asset.accountingNature}</Badge>
                                                                            </div>
                                                                            <div className="flex items-center gap-3">
                                                                                <span className="text-[9px] font-bold text-muted-foreground">SN: {asset.serialNumber || '--'}</span>
                                                                                {asset.usefulLife ? asset.usefulLife > 0 && <span className="text-[9px] font-bold text-blue-500 border-l pl-3">V. ÚTIL: {asset.usefulLife} Años</span> : null}
                                                                            </div>
                                                                            <p className="text-[9px] text-muted-foreground uppercase font-medium line-clamp-2 max-w-[250px] italic mt-2">
                                                                                {asset.description || 'Sin detalles técnicos registrados.'}
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-6 py-6 align-top min-w-[200px]">
                                                                    {isEditing ? (
                                                                        <div className="space-y-3">
                                                                            <Select
                                                                                value={editForm?.category}
                                                                                onValueChange={val => setEditForm(prev => prev ? { ...prev, category: val } : null)}
                                                                            >
                                                                                <SelectTrigger className="h-9 text-[10px] font-black uppercase rounded-xl">
                                                                                    <SelectValue placeholder="Categoría" />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    {(materialCategories || []).map(cat => (
                                                                                        <SelectItem key={cat.id} value={cat.name} className="text-[10px] font-black uppercase">
                                                                                            {cat.name}
                                                                                        </SelectItem>
                                                                                    ))}
                                                                                </SelectContent>
                                                                            </Select>
                                                                            <div className="grid grid-cols-2 gap-2">
                                                                                <Select
                                                                                    value={editForm?.accountingNature}
                                                                                    onValueChange={val => setEditForm(prev => prev ? { ...prev, accountingNature: val as any } : null)}
                                                                                >
                                                                                    <SelectTrigger className="h-9 text-[9px] font-black uppercase rounded-xl">
                                                                                        <SelectValue placeholder="Naturaleza" />
                                                                                    </SelectTrigger>
                                                                                    <SelectContent>
                                                                                        <SelectItem value="CAPEX" className="text-[9px] font-black uppercase">CAPEX</SelectItem>
                                                                                        <SelectItem value="OPEX" className="text-[9px] font-black uppercase">OPEX</SelectItem>
                                                                                        <SelectItem value="Inventario Estratégico" className="text-[9px] font-black uppercase">Inventario Estratégico</SelectItem>
                                                                                        <SelectItem value="Activo Menor Capitalizable" className="text-[9px] font-black uppercase">Activo Menor</SelectItem>
                                                                                    </SelectContent>
                                                                                </Select>
                                                                                <Input
                                                                                    type="number"
                                                                                    placeholder="V. Útil"
                                                                                    value={editForm?.usefulLife}
                                                                                    onChange={e => setEditForm(prev => prev ? { ...prev, usefulLife: Number(e.target.value) } : null)}
                                                                                    className="h-9 text-[9px] font-black uppercase rounded-xl"
                                                                                />
                                                                            </div>
                                                                            <Select
                                                                                value={editForm?.usageType}
                                                                                onValueChange={val => setEditForm(prev => prev ? { ...prev, usageType: val as any } : null)}
                                                                            >
                                                                                <SelectTrigger className="h-9 text-[10px] font-black uppercase rounded-xl">
                                                                                    <SelectValue placeholder="Tipo de Uso" />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    <SelectItem value="Consumible" className="text-[10px] font-black uppercase">Consumible</SelectItem>
                                                                                    <SelectItem value="Reutilizable Controlado" className="text-[10px] font-black uppercase">Reutilizable Controlado</SelectItem>
                                                                                    <SelectItem value="Herramienta Menor" className="text-[10px] font-black uppercase">Herramienta Menor</SelectItem>
                                                                                    <SelectItem value="Repuesto Crítico" className="text-[10px] font-black uppercase">Repuesto Crítico</SelectItem>
                                                                                    <SelectItem value="Activo Fijo" className="text-[10px] font-black uppercase">Activo Fijo</SelectItem>
                                                                                    <SelectItem value="IT Controlado" className="text-[10px] font-black uppercase">IT Controlado</SelectItem>
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex flex-col gap-2">
                                                                            <Badge variant="outline" className={`text-[9px] font-black uppercase rounded-lg w-fit ${!asset.category ? 'border-red-200 text-red-500' : 'border-slate-200 text-slate-600'}`}>
                                                                                {asset.category || 'Categoría Faltante'}
                                                                            </Badge>
                                                                            <Badge className="bg-slate-100 text-muted-foreground border-none rounded-lg text-[8px] font-black uppercase w-fit">
                                                                                {categoryUsageMap[asset.category] || asset.usageType || 'Consumible'}
                                                                            </Badge>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-6 py-6 align-top">
                                                                    <div className="flex flex-col items-center gap-2 p-2 bg-slate-100 rounded-xl border border-slate-100 shadow-sm w-fit mx-auto opacity-50">
                                                                        <QrCode size={40} className="text-slate-300" />
                                                                        <span className="text-[7px] font-black font-mono">PRELIMINAR</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-6 align-top text-center">
                                                                    {isEditing ? (
                                                                        <Select
                                                                            value={editForm?.class}
                                                                            onValueChange={val => setEditForm(prev => prev ? { ...prev, class: val as any } : null)}
                                                                        >
                                                                            <SelectTrigger className="h-9 w-20 mx-auto text-[10px] font-black uppercase rounded-xl">
                                                                                <SelectValue />
                                                                            </SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="A" className="text-[10px] font-black">A</SelectItem>
                                                                                <SelectItem value="B" className="text-[10px] font-black">B</SelectItem>
                                                                                <SelectItem value="C" className="text-[10px] font-black">C</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    ) : (
                                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center mx-auto text-[11px] font-black border-2 ${asset.class === 'A' ? 'bg-red-50 text-red-600 border-red-200' :
                                                                            asset.class === 'B' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                                                                'bg-slate-50 text-slate-600 border-slate-200'
                                                                            }`}>
                                                                            {asset.class}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-6 py-6 align-top text-right">
                                                                    {isEditing ? (
                                                                        <div className="space-y-3">
                                                                            <div className="space-y-1">
                                                                                <Label className="text-[8px] font-black uppercase text-muted-foreground">Stock</Label>
                                                                                <Input
                                                                                    type="number"
                                                                                    value={editForm?.stock}
                                                                                    onChange={e => setEditForm(prev => prev ? { ...prev, stock: Number(e.target.value) } : null)}
                                                                                    className="h-8 text-xs font-black text-right rounded-xl border-slate-200"
                                                                                />
                                                                            </div>
                                                                            <div className="space-y-1">
                                                                                <Label className="text-[8px] font-black uppercase text-muted-foreground">Costo Neto</Label>
                                                                                <Input
                                                                                    type="number"
                                                                                    value={editForm?.unitCost}
                                                                                    onChange={e => setEditForm(prev => prev ? { ...prev, unitCost: Number(e.target.value) } : null)}
                                                                                    className="h-8 text-xs font-black text-right rounded-xl border-slate-200 text-green-600"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex flex-col items-end">
                                                                            <span className="font-black text-[13px] text-green-600">{formatCLP(asset.unitCost || 0)}</span>
                                                                            <span className="text-[9px] font-bold text-muted-foreground uppercase mt-1">Stock: {asset.stock} {asset.unit}</span>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-6 py-6 align-top text-right">
                                                                    <div className="flex items-center justify-end gap-1.5">
                                                                        {isEditing ? (
                                                                            <div className="flex flex-col gap-2">
                                                                                <Button size="icon" className="h-9 w-9 bg-green-500 hover:bg-green-600 text-white rounded-xl shadow-lg shadow-green-100" onClick={saveEdit}>
                                                                                    <Check size={18} />
                                                                                </Button>
                                                                                <Button size="icon" variant="ghost" className="h-9 w-9 text-red-500 hover:bg-red-50 rounded-xl" onClick={cancelEdit}>
                                                                                    <X size={18} />
                                                                                </Button>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="flex items-center gap-1">
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="icon"
                                                                                    className="h-9 w-9 text-slate-300 hover:text-pagnol-orange hover:bg-orange-50 rounded-xl transition-all"
                                                                                    onClick={() => startEditing(idx)}
                                                                                >
                                                                                    <Edit2 size={16} />
                                                                                </Button>
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="icon"
                                                                                    className="h-9 w-9 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                                                                    onClick={() => removeAsset(idx)}
                                                                                >
                                                                                    <Trash2 size={18} />
                                                                                </Button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    {/* Modal de Éxito Post-Carga */}
                    <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
                        <DialogContent className="sm:max-w-md rounded-[2.5rem] p-0 border-none overflow-hidden shadow-2xl">
                            <DialogTitle className="sr-only">Ingesta Exitosa</DialogTitle>
                            <div className="bg-slate-950 p-12 text-center relative overflow-hidden">
                                {/* Background Decor */}
                                <div className="absolute top-0 right-0 w-40 h-40 bg-pagnol-orange/20 blur-[60px] rounded-full translate-x-1/2 -translate-y-1/2"></div>

                                <div className="relative z-10 flex flex-col items-center gap-6">
                                    <div className="w-20 h-20 bg-green-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-green-500/20 animate-bounce">
                                        <CheckCircle2 size={40} className="text-white" />
                                    </div>
                                    <div className="space-y-2">
                                        <h2 className="text-3xl font-black text-white tracking-tighter uppercase font-outfit">Ingesta Exitosa</h2>
                                        <p className="text-muted-foreground text-sm font-medium">Protocolo de carga completado sin errores técnicos.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-10 bg-slate-100 flex flex-col items-center gap-8">
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
                                    <div className="bg-slate-50 p-6 rounded-[2rem] text-center border border-slate-100">
                                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1">Nuevos</p>
                                        <p className="text-2xl font-black text-slate-900">{lastInjectedCount}</p>
                                    </div>
                                    <div className="bg-blue-50 p-6 rounded-[2rem] text-center border border-blue-100">
                                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Actualizados</p>
                                        <p className="text-2xl font-black text-blue-600">{lastUpdatedCount}</p>
                                    </div>
                                    <div className="bg-slate-50 p-6 rounded-[2rem] text-center border border-slate-100">
                                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1">Omitidos</p>
                                        <p className={cn("text-2xl font-black", lastDuplicatesCount > 0 ? "text-amber-500" : "text-muted-foreground")}>
                                            {lastDuplicatesCount}
                                        </p>
                                    </div>
                                    <div className="bg-slate-50 p-6 rounded-[2rem] text-center border border-slate-100">
                                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1">Estado</p>
                                        <p className="text-[10px] font-black text-green-600 uppercase mt-2">100% OK</p>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 w-full">
                                    <Button
                                        onClick={() => router.push('/dashboard/pagnol/activos')}
                                        className="w-full py-7 rounded-[1.5rem] bg-pagnol-orange hover:bg-orange-600 text-white font-black text-[11px] uppercase tracking-widest shadow-xl shadow-pagnol-orange/20 gap-2"
                                    >
                                        <Layers size={18} />
                                        Ir a Gestión de Activos
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        onClick={() => setShowSuccessModal(false)}
                                        className="w-full py-7 rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest text-muted-foreground"
                                    >
                                        Seguir en Carga Masiva
                                    </Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                </>
            ) : uploadMethod === 'api' ? (
                <div className="space-y-8 pb-40">
                    <div className="flex items-center justify-between">
                        <Button
                            variant="ghost"
                            onClick={() => setUploadMethod(null)}
                            className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-slate-900"
                        >
                            <ArrowRight size={14} className="rotate-180 mr-2" /> Volver a Selección de Método
                        </Button>
                    </div>

                    <Card className="rounded-[2.5rem] border-none shadow-2xl bg-slate-100 overflow-hidden">
                        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[600px]">
                            {/* Left Side: ERP Selection */}
                            <div className="p-12 space-y-10 border-r bg-slate-50/50">
                                <div className="space-y-6">
                                    <div className="flex items-center gap-5">
                                        <div className="p-5 bg-indigo-600 text-white rounded-[1.5rem] shadow-lg shadow-indigo-200">
                                            <Building2 size={24} />
                                        </div>
                                        <div>
                                            <h3 className="text-2xl font-black uppercase tracking-tight text-slate-800 font-outfit">Ecosistemas ERP</h3>
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none">Bridge de Sincronización Industrial</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4">
                                        {[
                                            { id: 'defontana', name: 'De Fontana', desc: 'Sincronización via JWT / API oficial', color: 'blue' },
                                            { id: 'softland', name: 'Softland', desc: 'Integración Cloud OAuth 2.0', color: 'indigo' },
                                            { id: 'netsuite', name: 'NetSuite', desc: 'ERP Oracle / Web Services', color: 'slate' },
                                            { id: 'custom', name: 'Custom API', desc: 'Endpoint de cliente / SAP', color: 'emerald' }
                                        ].map(erp => (
                                            <button
                                                key={erp.id}
                                                onClick={() => setSelectedERP(erp.id as any)}
                                                className={`w-full flex items-center justify-between p-8 rounded-[2rem] border-2 transition-all duration-500 relative group ${selectedERP === erp.id ? 'border-indigo-600 bg-slate-100 shadow-2xl shadow-indigo-100 -translate-y-1' : 'bg-slate-100/50 border-transparent hover:border-slate-200 hover:bg-slate-100'}`}
                                            >
                                                <div className="flex items-center gap-5 text-left relative z-10">
                                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${selectedERP === erp.id ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-muted-foreground group-hover:bg-slate-200'}`}>
                                                        {erp.id === 'defontana' ? <Database size={20} /> : <Plug size={20} />}
                                                    </div>
                                                    <div>
                                                        <p className="font-black text-xs uppercase text-slate-800 tracking-tight">{erp.name}</p>
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 tracking-wider">{erp.desc}</p>
                                                    </div>
                                                </div>
                                                <div className={`p-2 rounded-full transition-all ${selectedERP === erp.id ? 'bg-indigo-600 text-white scale-110' : 'bg-slate-100 text-slate-300 group-hover:bg-slate-200'}`}>
                                                    <ArrowRight size={14} className={selectedERP === erp.id ? '' : 'opacity-50'} />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Right Side: Setup Console */}
                            <div className="p-12 flex flex-col justify-center bg-slate-100 relative">
                                {!selectedERP ? (
                                    <div className="text-center space-y-8 animate-in fade-in zoom-in-95 duration-500">
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full scale-150"></div>
                                            <div className="w-32 h-32 bg-indigo-600 text-white rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 relative z-10 shadow-2xl shadow-indigo-200">
                                                <Cable size={56} />
                                            </div>
                                        </div>
                                        <div className="space-y-4 relative z-10">
                                            <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 font-outfit">Consola de Control</h2>
                                            <p className="text-sm text-muted-foreground max-w-sm mx-auto font-medium leading-relaxed uppercase tracking-tight">
                                                Active la sincronización bidireccional para mantener su inventario, centros de costo y activos críticos alineados con su ERP central.
                                            </p>
                                        </div>
                                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-100 rounded-full text-[10px] font-black text-indigo-500 uppercase tracking-widest relative z-10">
                                            <Info size={14} /> Seleccione un origen de datos
                                        </div>
                                    </div>
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className="space-y-8"
                                    >
                                        <div className="space-y-2">
                                            <Badge className="bg-blue-600 text-white border-none text-[8px] font-black uppercase tracking-widest px-2 py-0.5">Configuración Requerida</Badge>
                                            <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-800">Puente {selectedERP.toUpperCase()}</h2>
                                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Ingrese las credenciales del sistema origen</p>
                                        </div>

                                        <form onSubmit={handleConnectERP} className="space-y-6">
                                            <div className="space-y-4">
                                                {selectedERP === 'defontana' ? (
                                                    <>
                                                        <div className="space-y-2">
                                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Client ID / Usuario API</Label>
                                                            <Input
                                                                value={erpCredentials.clientId}
                                                                onChange={e => setErpCredentials(prev => ({ ...prev, clientId: e.target.value }))}
                                                                className="h-12 rounded-xl border-slate-200 bg-slate-50/50 font-medium text-slate-700 focus:bg-slate-100"
                                                                placeholder="EJ: api_pagnol_connect"
                                                                required
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Client Secret / JWT Password</Label>
                                                            <Input
                                                                type="password"
                                                                value={erpCredentials.clientSecret}
                                                                onChange={e => setErpCredentials(prev => ({ ...prev, clientSecret: e.target.value }))}
                                                                className="h-12 rounded-xl border-slate-200 bg-slate-50/50 font-medium text-slate-700 focus:bg-slate-100"
                                                                placeholder="••••••••••••••••"
                                                                required
                                                            />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="space-y-2">
                                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">API Key / Token de Acceso</Label>
                                                        <Input
                                                            type="password"
                                                            value={erpCredentials.apiKey}
                                                            onChange={e => setErpCredentials(prev => ({ ...prev, apiKey: e.target.value }))}
                                                            className="h-12 rounded-xl border-slate-200 bg-slate-50/50 font-medium text-slate-700 focus:bg-slate-100"
                                                            placeholder="Ingresa la credencial..."
                                                            required
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="p-4 bg-slate-900 rounded-2xl space-y-3">
                                                <div className="flex items-center gap-2 text-muted-foreground text-[10px] font-black uppercase">
                                                    <Lock size={12} /> Sync Endpoint v1
                                                </div>
                                                <div className="h-10 bg-slate-100/5 rounded-xl border border-white/10 flex items-center px-4 font-mono text-[9px] text-blue-400 overflow-hidden truncate">
                                                    https://api.pagnol.io/v1/sync/{selectedERP}
                                                </div>
                                            </div>

                                            <Button
                                                type="submit"
                                                disabled={erpConnectionStatus === 'loading'}
                                                className="w-full py-7 rounded-[1.5rem] bg-blue-600 hover:bg-blue-700 text-white font-black text-[11px] uppercase tracking-widest shadow-xl shadow-blue-100 transition-all group"
                                            >
                                                {erpConnectionStatus === 'loading' ? (
                                                    <Loader2 className="animate-spin mr-2" size={18} />
                                                ) : (
                                                    <RefreshCw className="mr-2 group-hover:rotate-180 transition-transform duration-500" size={18} />
                                                )}
                                                {erpConnectionStatus === 'loading' ? 'Validando Puente...' : 'Vincular y Sincronizar'}
                                            </Button>

                                            {erpConnectionStatus === 'success' && (
                                                <div className="p-4 bg-green-50 text-green-700 border border-green-200 rounded-2xl flex items-center gap-3 animate-in zoom-in-95">
                                                    <Check className="text-green-600 shrink-0" size={20} />
                                                    <p className="text-[10px] font-black uppercase tracking-tight">Sincronización establecida. Revisando cambios en el ERP...</p>
                                                </div>
                                            )}
                                        </form>
                                    </motion.div>
                                )}
                            </div>
                        </div>
                    </Card>
                </div>
            ) : (
                <div className="space-y-8 pb-40 text-center">
                    <Button variant="ghost" onClick={() => setUploadMethod(null)} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground self-start"><ArrowRight size={14} className="rotate-180 mr-2" /> Volver</Button>
                    <div className="max-w-4xl mx-auto space-y-12">
                        <div className="space-y-4 text-center">
                            <div className="w-20 h-20 bg-slate-100 text-muted-foreground rounded-3xl flex items-center justify-center mx-auto mb-6"><Workflow size={40} /></div>
                            <h2 className="text-4xl font-black uppercase tracking-tighter text-slate-800">Programa de Adaptación Legacy</h2>
                            <p className="text-muted-foreground uppercase font-black text-xs tracking-[0.2em]">Adaptamos su ecosistema actual a la estructura de Pagnol, alineada con las mejores prácticas de la ISO 55000</p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <Card className="p-10 rounded-[3rem] border-none bg-slate-100 shadow-2xl space-y-6 text-left group hover:-translate-y-2 transition-all">
                                <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center"><Zap size={24} /></div>
                                <h3 className="text-xl font-black uppercase text-slate-800">Auto-Mapeo Industrial</h3>
                                <p className="text-xs text-muted-foreground leading-relaxed uppercase">Suba sus archivos en cualquier formato y nuestro motor de IA normalizará los campos a la estructura de <b>Pagnol alineada con ISO 55001</b>.</p>
                                <Button onClick={() => setUploadMethod('standard')} className="w-full bg-slate-900 hover:bg-black font-black uppercase text-[10px] h-14 rounded-2xl">Usar Engine de Mapeo</Button>
                            </Card>

                            <Card className="p-10 rounded-[3rem] border-none bg-slate-900 text-white shadow-2xl space-y-6 text-left group hover:-translate-y-2 transition-all">
                                <div className="w-12 h-12 bg-slate-100/10 text-pagnol-orange rounded-2xl flex items-center justify-center"><Sparkles size={24} /></div>
                                <h3 className="text-xl font-black uppercase text-white">Consultoría de Ingesta</h3>
                                <p className="text-xs text-white/50 leading-relaxed uppercase">¿Tiene una base de datos compleja o manual? Nuestro equipo técnico realizará la migración y limpieza de datos por usted.</p>
                                <Button className="w-full bg-pagnol-orange hover:bg-orange-600 font-black uppercase text-[10px] h-14 rounded-2xl">Contactar Especialista</Button>
                            </Card>
                        </div>
                    </div>
                </div>
            )
            }
        </div >
    );
}
