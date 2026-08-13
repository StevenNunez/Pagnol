
"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Material, User as UserType, MaterialRequest } from '@/modules/core/lib/data';
import {
  ArrowUpRight,
  ArrowDownRight,
  Package,
  Search,
  Plus,
  CheckCircle,
  X,
  ArrowRight,
  ClipboardList,
  Fingerprint,
  QrCode,
  ShieldCheck,
  ShieldAlert,
  Shield,
  ScanFace,
  UserCheck,
  Loader2,
  FileText,
  Trash2,
  Camera,
  MessageSquare,
  Download,
  MapPin,
  Settings2,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { Textarea } from "@/components/ui/textarea";
import { supabase } from '@/modules/core/lib/supabase';
import { authHeaders } from '@/modules/core/lib/auth-header';
import { generateContractPDF } from '@/lib/contract-pdf-generator';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { PageHeader } from '@/components/page-header';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { verifyBiometric, searchIdentity1N, captureEvidenceFrame, MATCH_THRESHOLD, verifyLiveness } from '@/lib/biometricService';
import {
  pickChallenge,
  CHALLENGE_PROMPT,
  LIVENESS_MESSAGE,
  LIVENESS_MIN_AMPLITUDE,
  LIVENESS_METHOD,
  type LivenessChallenge,
} from '@/modules/data/mutations/livenessMath';
import type { LivenessRecord } from '@/modules/data/mutations/biometricMutations';
import { uploadBiometricEvidence, exceptionStatus } from '@/modules/data/mutations/biometricMutations';
import { BiometricExceptionDialog, type ExceptionTarget } from '@/components/biometric-exception-dialog';

type TransactionState =
  | 'CREADA'
  | 'IDENTIDAD_VERIFICADA'
  | 'PENDIENTE_ENTREGA'
  | 'ENTREGADA_POR_PAÑOLERO'
  | 'RECIBIDA_CONFORME'
  | 'CERRADA';

type FlowStep = 'IDLE' | 'SCANNING' | 'ITEMS SELECTION' | 'CONDITION CHECK' | 'CONFIRMATION PAGNOLERO' | 'FIRMA RECIBIDO' | 'COMPLETED' | 'MANUAL USER SELECT';
type ReturnStatus = 'OK' | 'CON FALLA' | 'ROTO';
type TransactionType = 'WITHDRAWAL' | 'RETURN';

interface DisplayTransaction {
  id: string;
  internalCode?: string;
  assetIds: string[];
  type: 'WITHDRAWAL' | 'RETURN';
  site: string;
  employeeId: string;
  timestamp: string;
  status: string;
  isApproved?: boolean;
  deliveryDate?: string | null;
  contractUrl?: string | null;
  contractName?: string | null; // contrato (obra) al que se imputa
  // ── Beneficiario: quién debe retirar (puede diferir del solicitante) ──
  deliveryMode?: 'self' | 'directed' | 'open';
  beneficiaryId?: string | null;
  beneficiaryName?: string | null;
}

type CompatibleMaterialRequest = MaterialRequest & {
  materialId?: string;
  quantity?: number;
  items?: { materialId: string; quantity: number }[];
};

export default function MovimientosPagnolPage() {
  const {
    requests,
    returnRequests,
    materials,
    users,
    currentTenant,
    contracts,
    contractWorkers,
    warehouses,
    addMaterialRequest,
    addAndApproveMaterialRequest,
    deliverApprovedMaterialRequest,
    addAndCompleteReturnRequest,
    deleteMaterialRequest,
    deleteReturnRequest,
    updateTenant,
    refreshData,
    biometricVerifications,
    recordBiometricVerification,
    requestBiometricException,
    resolveBiometricException,
  } = useAppState();
  const { user: currentUser, can, getTenantId } = useAuth();
  const { toast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<TransactionType>('WITHDRAWAL');

  const [txState, setTxState] = useState<TransactionState>('CREADA');
  const [flowStep, setFlowStep] = useState<FlowStep>('IDLE');
  const [pendingDeliveryId, setPendingDeliveryId] = useState<string | null>(null);
  const [pendingDeliveryCode, setPendingDeliveryCode] = useState<string | null>(null);

  const [selectedEmployee, setSelectedEmployee] = useState<UserType | null>(null);
  const [initialBiometricToken, setInitialBiometricToken] = useState<string | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [returnConditions, setReturnConditions] = useState<Record<string, ReturnStatus>>({}); // Map assetId -> Condition
  const [site, setSite] = useState('');
  const [showFaenaManager, setShowFaenaManager] = useState(false);
  const [newFaenaInput, setNewFaenaInput] = useState('');
  const [searchAsset, setSearchAsset] = useState('');
  const [description, setDescription] = useState('');
  const [returnNotes, setReturnNotes] = useState<Record<string, string>>({});
  /** Path en el bucket privado (lo que se persiste). */
  const [returnPhotos, setReturnPhotos] = useState<Record<string, string>>({});
  /** Data URL del archivo local, solo para la vista previa en pantalla. */
  const [returnPhotoPreviews, setReturnPhotoPreviews] = useState<Record<string, string>>({});
  const [isBiometricPulse, setIsBiometricPulse] = useState(false);
  /** Gesto que se le está pidiendo al trabajador en este instante, o null. */
  const [livenessPrompt, setLivenessPrompt] = useState<LivenessChallenge | null>(null);
  // Trabajador que no pudo verificarse y espera una excepción autorizada.
  const [excepcionPara, setExcepcionPara] = useState<ExceptionTarget | null>(null);
  // Excepción ya aprobada para esta entrega: permite cerrarla sin biometría.
  const [excepcionAprobada, setExcepcionAprobada] = useState<string | null>(null);
  const [qrInput, setQrInput] = useState('');
  const [isPagnoleroConfirming, setIsPagnoleroConfirming] = useState(false);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isSearching1N, setIsSearching1N] = useState(false);
  const [manualUserSearch, setManualUserSearch] = useState('');
  const [justReturnedIds, setJustReturnedIds] = useState<Set<string>>(new Set());
  const [pendingReturnTxs, setPendingReturnTxs] = useState<DisplayTransaction[]>([]);
  const [capturingPhotoFor, setCapturingPhotoFor] = useState<string | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  const canOperate = can('material_requests:create');
  const usersMap = useMemo(() => new Map((users || []).map(u => [u.id, u])), [users]);
  const materialsMap = useMemo(() => new Map((materials || []).map(m => [m.id, m])), [materials]);

  // ── Contrato del trabajador (scoping vía contract_workers) ────────────────
  // El despacho/devolución se imputa al contrato del trabajador identificado:
  // 1 contrato activo → autocarga; varios → el pañolero elige; ninguno → pool central.
  const [txContractId, setTxContractId] = useState<string | null>(null);
  const contractsMap = useMemo(() => new Map((contracts || []).map(c => [c.id, c])), [contracts]);
  const employeeContracts = useMemo(() => {
    if (!selectedEmployee) return [];
    const myIds = new Set(
      (contractWorkers || [])
        .filter(cw => cw.userId === selectedEmployee.id)
        .map(cw => cw.contractId)
    );
    return (contracts || []).filter(c => c.status === 'active' && myIds.has(c.id));
  }, [selectedEmployee, contractWorkers, contracts]);

  useEffect(() => {
    // Autocarga cuando el trabajador tiene exactamente un contrato activo.
    setTxContractId(employeeContracts.length === 1 ? employeeContracts[0].id : null);
  }, [employeeContracts]);

  const txContractName = txContractId ? (contractsMap.get(txContractId)?.name ?? null) : null;

  // ── Pañol del panolero (scope por warehouse) ───────────────────────────────
  // Si el usuario logueado es encargado de pañol(es), los movimientos que
  // registra quedan imputados a su pañol: 1 → autocarga; varios → elige.
  const myWarehouses = useMemo(
    () => (warehouses || []).filter(w => w.status === 'active' && w.managerId === currentUser?.id),
    [warehouses, currentUser?.id]
  );
  const [txWarehouseId, setTxWarehouseId] = useState<string | null>(null);
  useEffect(() => {
    setTxWarehouseId(myWarehouses.length > 0 ? myWarehouses[0].id : null);
  }, [myWarehouses]);

  const transactions: DisplayTransaction[] = useMemo(() => {
    const combinedList: DisplayTransaction[] = [];

    ((requests || []) as CompatibleMaterialRequest[]).forEach(r => {
      // Gate ADC: las pendientes sin autorizar viven en la bandeja del ADC
      // (/dashboard/authorizations), no en la cola del pañol.
      if (r.status === 'pending' && !(r as any).adcAuthorizedAt) return;

      const items = r.items && Array.isArray(r.items)
        ? r.items
        : (r.materialId ? [{ materialId: r.materialId, quantity: r.quantity || 1 }] : []);

      combinedList.push({
        id: r.id,
        internalCode: r.internalCode,
        assetIds: items.map(i => i.materialId),
        type: 'WITHDRAWAL',
        site: r.area,
        employeeId: r.supervisorId,
        timestamp: r.createdAt ? new Date(r.createdAt as any).toISOString() : new Date().toISOString(),
        status: r.status,
        isApproved: r.status === 'approved',
        deliveryDate: r.deliveryDate ? new Date(r.deliveryDate as any).toISOString() : null,
        contractUrl: r.contractUrl || null,
        contractName: r.contractName || null,
        deliveryMode: r.deliveryMode || 'self',
        beneficiaryId: r.beneficiaryId || null,
        beneficiaryName: r.beneficiaryName || null,
      });
    });

    (returnRequests || []).forEach(r => {
      combinedList.push({
        id: r.id,
        internalCode: r.internalCode,
        assetIds: [r.materialId],
        type: 'RETURN',
        site: '',
        employeeId: r.supervisorId,
        timestamp: r.createdAt ? new Date(r.createdAt as any).toISOString() : new Date().toISOString(),
        status: r.status,
        isApproved: r.status === 'completed',
        contractName: r.contractName || null,
      });
    });

    // Include optimistic entries for returns not yet in DB state
    pendingReturnTxs.forEach(pt => {
      const alreadySynced = combinedList.some(
        t => t.type === 'RETURN' && t.assetIds[0] === pt.assetIds[0] && t.employeeId === pt.employeeId
      );
      if (!alreadySynced) combinedList.push(pt);
    });

    return combinedList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [requests, returnRequests, pendingReturnTxs]);

  const inPossessionIds = useMemo(() => {
    if (!selectedEmployee) return new Set<string>();
    return transactions
      .filter(t => t.employeeId === selectedEmployee?.id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .reduce((acc, t) => {
        if (t.type === 'WITHDRAWAL' && t.isApproved) {
          t.assetIds.forEach(id => acc.add(id));
        } else if (t.type === 'RETURN' && t.status === 'completed') {
          t.assetIds.forEach(id => acc.delete(id));
        }
        return acc;
      }, new Set<string>());
  }, [selectedEmployee, transactions]);


  const handleDeleteTransaction = async (tx: DisplayTransaction) => {
    if (!currentUser || currentUser.role !== 'super-admin') return;

    if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente esta transacción (${tx.internalCode || tx.id})? Esta acción no se puede deshacer.`)) return;

    try {
      if (tx.type === 'WITHDRAWAL') {
        await deleteMaterialRequest(tx.id);
      } else {
        await deleteReturnRequest(tx.id);
      }
      toast({ title: "Eliminado", description: "La transacción ha sido eliminada correctamente." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  };

  const ASSET_DISPLAY_LIMIT = 12;

  // Base pool: todos los activos disponibles para el tipo de transacción, sin filtro de búsqueda
  const availableAssets = useMemo(() => {
    if (selectedType === 'WITHDRAWAL') {
      return (materials || [])
        .filter(a =>
          (a.status === 'Disponible' || (a.usageType === 'Consumible' && (a.stock || 0) > 0)) &&
          !a.archived
        )
        .sort((a, b) => (b.inUse || 0) - (a.inUse || 0));
    } else {
      return (materials || []).filter(a =>
        inPossessionIds.has(a.id) && !justReturnedIds.has(a.id)
      );
    }
  }, [selectedType, materials, inPossessionIds, justReturnedIds]);

  // Lista a renderizar: top 12 sin búsqueda, filtrada y limitada a 50 con búsqueda
  const displayedAssets = useMemo(() => {
    const q = searchAsset.trim().toLowerCase();
    if (!q) return availableAssets.slice(0, ASSET_DISPLAY_LIMIT);
    return availableAssets
      .filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.internalCode || '').toLowerCase().includes(q) ||
        (a.serialNumber || '').toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [availableAssets, searchAsset]);

  const startTransaction = (type: TransactionType) => {
    setSelectedType(type);
    setSelectedAssetIds([]);
    setReturnConditions({});
    setSelectedEmployee(null);
    setSearchAsset('');
    setDescription('');
    setManualUserSearch('');
    setPendingDeliveryId(null);
    setPendingDeliveryCode(null);
    setIsPagnoleroConfirming(false);
    setSite('');
    setSearchAsset('');
    setTxState('CREADA');
    setFlowStep('SCANNING');
    setIsModalOpen(true);
    startFaceDetect();
  };

  const handleContinueDelivery = async (tx: DisplayTransaction) => {
    // Retiro abierto: no hay destinatario fijo — primero se identifica (biometría)
    // a quien retira; sus entregas pendientes (incluidas las abiertas) aparecen
    // en el paso de selección y desde ahí se completa la entrega.
    if (tx.deliveryMode === 'open') {
      toast({
        variant: 'info',
        title: 'Retiro Abierto',
        description: 'Identifica al trabajador que retira; luego selecciona esta entrega en su panel.',
      });
      startTransaction('WITHDRAWAL');
      return;
    }

    // Quién debe retirar: el beneficiario (dirigida) o el solicitante (para mí).
    const receiverId = tx.deliveryMode === 'directed' && tx.beneficiaryId ? tx.beneficiaryId : tx.employeeId;

    // 1. Intentamos obtener del mapa local
    let emp = usersMap.get(receiverId);

    // 2. Si no tiene template o no está en mapa, refetch fresco de Supabase
    if (!emp || !emp.biometric_template) {
      try {
        const { data: snap, error } = await supabase.from('profiles').select('*').eq('id', receiverId).single();
        if (!error && snap) {
          // Fusionamos lo que tenemos con lo fresco
          emp = { ...emp, ...(snap as unknown as UserType), id: snap.id };
        }
      } catch (e) {
        console.error("Error fetching fresh user:", e);
      }
    }

    if (!emp) {
      toast({ title: "Error", description: "Empleado no encontrado en base de datos.", variant: "destructive" });
      return;
    }

    // Regla de negocio (Steven, 2026-08-11): nadie retira activos sin detección
    // biométrica, salvo excepción autorizada por ADC o Administrador. Se bloquea
    // ACÁ y no al final: antes el pañolero avanzaba tres pasos con el trabajador
    // esperando para toparse con un "Protocolo Incompleto" que no explicaba nada.
    if (!emp.biometric_template) {
      // ¿Ya hay una excepción autorizada para él? Puede haberla aprobado el ADC
      // desde la bandeja hace un minuto: llega por Realtime, sin recargar.
      const yaAutorizada = excepcionesAprobadasPorUsuario.get(emp.id);
      if (!yaAutorizada) {
        setExcepcionPara({ emp, requestId: tx.id, transactionCode: tx.internalCode || null });
        toast({
          title: "Sin biometría enrolada",
          description: `${emp.name} no puede retirar sin verificación. Enrólalo en Personal o registra una excepción autorizada.`,
          variant: "destructive",
        });
        return;
      }
      setExcepcionAprobada(yaAutorizada);
      toast({
        variant: 'info',
        title: "Excepción vigente",
        description: `${emp.name} tiene una excepción autorizada. La entrega quedará marcada como sin verificación biométrica.`,
      });
    }

    setSelectedType('WITHDRAWAL');
    setSelectedAssetIds(tx.assetIds);
    setSelectedEmployee(emp);
    setInitialBiometricToken(emp.biometric_template || null);
    setPendingDeliveryId(tx.id);
    setPendingDeliveryCode(tx.internalCode || null);
    setIsPagnoleroConfirming(false);

    // Saltamos directo a verificación del pañolero
    setTxState('PENDIENTE_ENTREGA');
    setFlowStep('CONFIRMATION PAGNOLERO');
    setIsModalOpen(true);
  };

  // Entregas aprobadas sin retirar que puede recibir el trabajador identificado:
  // dirigidas a él + las suyas ("para mí") + las de retiro abierto.
  const pendingDeliveriesForEmployee = useMemo(() => {
    if (!selectedEmployee) return [];
    return transactions.filter(t =>
      t.type === 'WITHDRAWAL' && t.isApproved && !t.deliveryDate && (
        t.deliveryMode === 'open' ||
        (t.deliveryMode === 'directed'
          ? t.beneficiaryId === selectedEmployee.id
          : t.employeeId === selectedEmployee.id)
      )
    );
  }, [transactions, selectedEmployee]);

  // Continuar una entrega cuando el receptor YA fue verificado biométricamente
  // en esta sesión (banner del paso de selección de ítems).
  const continueDeliveryAsIdentified = (tx: DisplayTransaction) => {
    setSelectedType('WITHDRAWAL');
    setSelectedAssetIds(tx.assetIds);
    setPendingDeliveryId(tx.id);
    setPendingDeliveryCode(tx.internalCode || null);
    setIsPagnoleroConfirming(false);
    setTxState('PENDIENTE_ENTREGA');
    setFlowStep('CONFIRMATION PAGNOLERO');
  };

  const startFaceDetect = async (attempt = 0) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err: any) {
      // AbortError means the hardware hasn't released yet — retry up to 3 times with backoff
      if ((err?.name === 'AbortError' || err?.name === 'NotReadableError') && attempt < 3) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        return startFaceDetect(attempt + 1);
      }
      console.error("Camera fail:", err);
      if (err?.name !== 'AbortError') {
        toast({ variant: 'destructive', title: "Error de Cámara", description: "No se pudo acceder a la cámara." });
      }
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
      if (videoRef.current) videoRef.current.srcObject = null;
    }
  };

  /**
   * Deja constancia de un acto biométrico: distancia, umbral, hora y —cuando la
   * verificación fue buena— el frame de la cámara en el bucket privado.
   *
   * Nunca interrumpe el flujo: si la evidencia falla, el pañolero no puede
   * quedarse bloqueado con el trabajador y la herramienta en la mano. Por eso se
   * invoca con `void` y el error sólo se registra.
   *
   * La foto se guarda en los casos con match: subir una imagen por cada intento
   * fallido del bucle 1:N llenaría el bucket sin aportar nada.
   *
   * 🔴 Y se guarda TAMBIÉN cuando la prueba de vida no vio movimiento, aunque el
   * rostro haya coincidido. Ese frame —alguien sosteniendo una fotografía frente
   * a la cámara— es la evidencia más valiosa que este sistema puede producir, y
   * con la regla anterior ("sólo si `verified`") se habría descartado justo en el
   * único caso que importa mirar después. La condición vive acá y no en cada
   * llamada para que no se pueda olvidar en un call site.
   */
  const registrarHechoBiometrico = useCallback(async (p: {
    emp: { id: string; name: string };
    stage: 'identificacion' | 'recepcion';
    check: { verified: boolean; reason: string; score: number };
    guardarFoto: boolean;
    requestId?: string | null;
    transactionCode?: string | null;
    liveness?: LivenessRecord | null;
  }) => {
    try {
      let evidencePath: string | null = null;
      const guardarFoto = p.guardarFoto || p.liveness?.outcome === 'no_change';
      if (guardarFoto && videoRef.current && currentTenant?.id) {
        const frame = await captureEvidenceFrame(videoRef.current);
        if (frame) {
          evidencePath = await uploadBiometricEvidence(frame, currentTenant.id, `${p.stage}-${p.emp.id}`);
        }
      }
      const outcome = p.check.verified
        ? 'match'
        : p.check.reason === 'no_face' ? 'no_face'
          : p.check.reason === 'no_match' ? 'no_match' : 'error';

      await recordBiometricVerification({
        subject: { id: p.emp.id, name: p.emp.name },
        stage: p.stage,
        outcome,
        // La distancia sólo significa algo si hubo rostro que comparar.
        distance: p.check.reason === 'no_face' ? null : p.check.score,
        threshold: MATCH_THRESHOLD,
        evidencePath,
        requestId: p.requestId ?? null,
        transactionCode: p.transactionCode ?? null,
        liveness: p.liveness ?? null,
      });
    } catch (err) {
      console.error('No se pudo registrar la evidencia biométrica:', err);
    }
  }, [currentTenant?.id, recordBiometricVerification]);

  /**
   * Excepciones vigentes por trabajador, DERIVADAS de los hechos (no hay campo
   * de estado): una excepción sirve si su último hecho de resolución fue una
   * aprobación. Así una aprobación remota desde la bandeja aparece sola acá,
   * sin que el pañolero tenga que recargar.
   */
  const excepcionesAprobadasPorUsuario = useMemo(() => {
    const porGrupo = new Map<string, typeof biometricVerifications>();
    for (const h of biometricVerifications) {
      if (!h.exceptionGroupId) continue;
      const g = porGrupo.get(h.exceptionGroupId) ?? [];
      g.push(h);
      porGrupo.set(h.exceptionGroupId, g);
    }
    const vigentes = new Map<string, string>();
    for (const [grupo, hechos] of porGrupo) {
      if (exceptionStatus(hechos) !== 'aprobada') continue;
      const sujeto = hechos.find(h => h.subjectUserId)?.subjectUserId;
      if (sujeto) vigentes.set(sujeto, grupo);
    }
    return vigentes;
  }, [biometricVerifications]);

  const handleIdentityVerified = async (emp: UserType) => {
    if (!emp.biometric_template) {
      toast({ variant: 'destructive', title: "Acceso Denegado", description: "Trabajador no enrolado." });
      return;
    }
    setIsBiometricPulse(true);
    const check = await verifyBiometric(emp.biometric_template, (s) => console.log(s), videoRef.current || undefined);
    // Deja constancia del acto ANTES de ramificar, para que también quede el
    // intento fallido: un patrón de rechazos sobre el mismo trabajador es
    // justamente lo que hay que poder mirar después.
    void registrarHechoBiometrico({
      emp,
      stage: 'identificacion',
      check,
      guardarFoto: check.verified,
    });
    if (check.verified) {
      setSelectedEmployee(emp);
      setInitialBiometricToken(emp.biometric_template);
      setTxState('IDENTIDAD_VERIFICADA');
      setFlowStep('ITEMS SELECTION');
      toast({
        variant: 'success',
        title: "Identidad Verificada",
        description: `Bienvenido, ${emp.name}`
      });
      stopCamera();
    } else if (check.reason === 'no_face') {
      // No es un rechazo de identidad: la cámara no encontró la cara. Decirle
      // "fallo biométrico" a alguien mal encuadrado lo acusa de ser otro.
      toast({ variant: 'warning', title: "No se ve el rostro", description: check.message });
    } else {
      toast({
        variant: 'destructive',
        title: check.reason === 'no_match' ? "No coincide" : "Error de verificación",
        description: check.reason === 'no_match'
          ? `El rostro no coincide con ${emp.name}.`
          : check.message,
      });
    }
    setIsBiometricPulse(false);
  };

  // Bucle de búsqueda 1:N
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (flowStep === 'SCANNING' && cameraStream && videoRef.current && !isSearching1N) {
      interval = setInterval(async () => {
        if (!videoRef.current) return;
        setIsSearching1N(true);
        const result = await searchIdentity1N(videoRef.current, (users || []).filter(u => u.biometric_template));
        if (result.success && result.userId) {
          const emp = usersMap.get(result.userId);
          if (emp) {
            handleIdentityVerified(emp);
            clearInterval(interval);
          }
        }
        setIsSearching1N(false);
      }, 1500); // Escanear cada 1.5s para no saturar
    }

    return () => clearInterval(interval);
    // `handleIdentityVerified` no está memoizada: declararla recrearía el efecto en
    // cada render y con él el `setInterval`, así que el escaneo 1:N nunca llegaría a
    // completar su ciclo de 1,5 s. El efecto ya se rehace con `isSearching1N` en cada
    // pasada, de modo que la versión que usa nunca queda vieja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStep, cameraStream, users, isSearching1N, usersMap]);

  // Once returnRequests updates from DB, clear optimistic state
  useEffect(() => {
    if (justReturnedIds.size > 0) setJustReturnedIds(new Set());
    if (pendingReturnTxs.length > 0) setPendingReturnTxs([]);
    // El disparador es la llegada del dato real desde la base: `justReturnedIds` y
    // `pendingReturnTxs` son lo que este efecto LIMPIA, no lo que lo despierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnRequests]);

  // Ensure video stream is attached to ref whenever it changes or component re-renders
  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, flowStep]); // Re-run when step changes (video element mounts/unmounts)

  // Auto-start camera when reaching FIRMA RECIBIDO — delay 400ms to let hardware release from prior stream
  useEffect(() => {
    if (flowStep === 'FIRMA RECIBIDO') {
      const t = setTimeout(() => {
        startFaceDetect().finally(() => setIsPagnoleroConfirming(false));
      }, 400);
      return () => clearTimeout(t);
    }
    // Sólo debe dispararse al ENTRAR al paso de firma. `startFaceDetect` es una
    // función suelta (identidad nueva en cada render) que además hace
    // `setCameraStream`: declararla encadenaría efecto → render → efecto y
    // reiniciaría la cámara en bucle en mitad del cierre biométrico.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStep]);

  const handleQrScan = (e: React.FormEvent) => {
    e.preventDefault();
    const scId = qrInput.trim();
    if (!scId) return;
    const asset = materials.find(m => m.id === scId || m.serialNumber === scId);
    if (asset) {
      if (!selectedAssetIds.includes(asset.id)) {
        if (selectedType === 'RETURN' && !inPossessionIds.has(asset.id)) {
          toast({ variant: 'destructive', title: "Error", description: "Este ítem no está en posesión del trabajador." });
        } else {
          setSelectedAssetIds(prev => [...prev, asset.id]);
          toast({
            variant: 'info',
            title: "Ítem Escaneado",
            description: asset.name
          });
        }
      } else {
        toast({ variant: 'destructive', title: "Repetido", description: "Este ítem ya está en la lista." });
      }
    } else {
      toast({ variant: 'destructive', title: "No encontrado", description: "QR no válido." });
    }
    setQrInput('');
  };

  const toggleAsset = (id: string) => {
    setSelectedAssetIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const handleConfirmItems = async () => {
    if (selectedAssetIds.length === 0) return;

    if (selectedType === 'RETURN') {
      const initialConditions: Record<string, ReturnStatus> = {};
      selectedAssetIds.forEach(id => initialConditions[id] = 'OK');
      setReturnConditions(initialConditions);
      setFlowStep('CONDITION CHECK');
    } else {
      // WITHDRAWAL: Check if any item is Class A or B
      const hasRestrictedItems = selectedAssetIds.some(id => {
        const m = materialsMap.get(id);
        return m?.class === 'A' || m?.class === 'B';
      });

      if (hasRestrictedItems) {
        try {
          setIsBiometricPulse(true);

          // Compute highest class from client state (no DB round-trip needed)
          const classRank: Record<'A' | 'B' | 'C', number> = { A: 3, B: 2, C: 1 };
          const computedClass = selectedAssetIds.reduce<'A' | 'B' | 'C'>((acc, id) => {
            const cls = (materialsMap.get(id)?.class as 'A' | 'B' | 'C' | undefined) ?? 'C';
            return classRank[cls] > classRank[acc] ? cls : acc;
          }, 'C');

          await addMaterialRequest({
            items: selectedAssetIds.map(id => ({ materialId: id, quantity: 1 })),
            area: site,
            contractId: txContractId,
            contractName: txContractName,
            supervisorId: selectedEmployee?.id || '',
            supervisorName: selectedEmployee?.name ?? undefined,
            highestClass: computedClass,
          });

          // Notificar solo a quienes pueden aprobar según la clase del activo
          const approverRoles = computedClass === 'A'
            ? ['administrador', 'supervisor']
            : ['administrador', 'supervisor'];
          const approverIds = (users || [])
            .filter(u => approverRoles.includes(u.role))
            .map(u => u.id);

          fetch('/api/push/send', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({
              tenantId: getTenantId(),
              targetUserIds: approverIds,
              payload: {
                title: `Autorización Requerida — Clase ${computedClass}`,
                body: `${selectedEmployee?.name || 'Operario'} solicita despacho de ${selectedAssetIds.length} activo(s). Acción inmediata requerida.`,
                url: '/dashboard/pagnol/solicitudes',
                tag: 'approval-request',
                requireInteraction: true,
              },
            }),
          }).catch(() => {});

          refreshData();
          setIsModalOpen(false);
          setFlowStep('IDLE');
          toast({
            variant: 'success',
            title: "Solicitud Enviada",
            description: `Solicitud Clase ${computedClass} generada. Los autorizadores serán notificados.`,
          });
        } catch (err: any) {
          toast({ variant: 'destructive', title: "Error al solicitar aprobación", description: err.message || 'Error desconocido' });
        } finally {
          setIsBiometricPulse(false);
        }
      } else {
        // Normal Class C flow -> Continue to physical delivery
        setTxState('PENDIENTE_ENTREGA');
        setFlowStep('CONFIRMATION PAGNOLERO');
      }
    }
  };

  const handleConfirmConditions = () => {
    setTxState('PENDIENTE_ENTREGA');
    setFlowStep('CONFIRMATION PAGNOLERO');
  };

  const handlePagnoleroApproval = () => {
    setIsPagnoleroConfirming(true);
    setTxState('ENTREGADA_POR_PAÑOLERO');
    setFlowStep('FIRMA RECIBIDO');
    toast({
      variant: 'info',
      title: "Entrega Registrada",
      description: "Esperando firma del trabajador."
    });
  };

  const uploadWithTimeout = useCallback(async (path: string, blob: Blob): Promise<string | null> => {
    try {
      const { error } = await Promise.race([
        supabase.storage.from('contracts').upload(path, blob),
        new Promise<{ data: null; error: Error }>((_, reject) =>
          setTimeout(() => reject(new Error('Upload timeout')), 15000)
        )
      ]) as { data: any; error: any };
      if (error) throw error;
      // Se guarda el PATH, no una URL: el bucket es privado y las URLs firmadas
      // expiran, así que persistir una la dejaría muerta a los minutos. Quien
      // muestre el archivo lo firma en el momento (<SecureFileLink>).
      return path;
    } catch (err) {
      console.warn('Storage upload failed:', err);
      return null;
    }
  }, []);

  const handleEvidenceCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>, assetId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // La vista previa siempre sale del archivo local: lo que se persiste es el
      // path del bucket privado, que no sirve como `src` de una imagen.
      const reader = new FileReader();
      reader.onload = (ev) => {
        setReturnPhotoPreviews(prev => ({ ...prev, [assetId]: ev.target?.result as string }));
      };
      reader.readAsDataURL(file);

      // El tenant va EN LA RUTA para que la política de storage pueda acotar por
      // empresa: sin él, el objeto sólo se puede proteger como "cualquier usuario
      // autenticado" (ver migración 20260806040000).
      const path = `return-evidence/${currentTenant?.id}/${Date.now()}-${assetId}.jpg`;
      const stored = await uploadWithTimeout(path, file);
      if (stored) {
        setReturnPhotos(prev => ({ ...prev, [assetId]: stored }));
        toast({ variant: 'success', title: "Foto Guardada", description: "Evidencia fotográfica registrada en la nube." });
      } else {
        // Sin conexión el archivo no llegó al bucket: se conserva solo la vista
        // previa local y no se persiste un path que no existe.
        toast({ variant: 'info', title: "Foto Local", description: "Sin conexión — la evidencia no se respaldó en la nube." });
      }
    } catch (err) {
      console.error("Evidence upload failed:", err);
    } finally {
      if (evidenceInputRef.current) evidenceInputRef.current.value = '';
      setCapturingPhotoFor(null);
    }
  }, [uploadWithTimeout, toast, currentTenant?.id]);

  /**
   * Qué imprimir en el contrato sobre cómo se acreditó la identidad. Si la
   * entrega salió por excepción, el PDF tiene que decirlo con nombre y motivo:
   * un contrato que da a entender que hubo biometría cuando no la hubo es peor
   * que uno que no dice nada.
   */
  const datosVerificacionParaContrato = useCallback(() => {
    if (!excepcionAprobada) return { mode: 'biometric' as const };
    const hechos = biometricVerifications.filter(h => h.exceptionGroupId === excepcionAprobada);
    const aprobacion = hechos.find(h => h.outcome === 'exception_granted');
    const solicitud = hechos.find(h => h.outcome === 'exception_requested');
    return {
      mode: 'exception' as const,
      authorizedByName: aprobacion?.authorizedByName ?? null,
      reason: solicitud?.exceptionReason ?? null,
    };
  }, [excepcionAprobada, biometricVerifications]);

  const handleFinalAcceptance = async () => {
    if (!selectedEmployee) return;

    // Vía de excepción: hay una autorización vigente de un ADC/Administrador, así
    // que la entrega sale sin cámara — pero queda MARCADA como tal, con quién la
    // autorizó y por qué, y eso se imprime en el contrato de responsabilidad.
    const conExcepcion = !!excepcionAprobada;

    if (!conExcepcion) {
      if (!initialBiometricToken) {
        toast({
          variant: 'destructive',
          title: "Protocolo Incompleto",
          description: "No se ha capturado el token biométrico del trabajador. Por favor re-identifique."
        });
        return;
      }

      if (!cameraStream) {
        toast({ variant: 'destructive', title: "Cámara no lista", description: "Espere a que la cámara inicie antes de validar." });
        return;
      }
    }

    setIsBiometricPulse(true);
    try {
      if (!conExcepcion) {
        const verificationPromise = verifyBiometric(initialBiometricToken!, (s) => console.log(s), videoRef.current || undefined);
        const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Tiempo de espera agotado. Asegúrese de estar frente a la cámara.")), 15000));

        const check = await Promise.race([verificationPromise, timeoutPromise]);

        /**
         * Prueba de vida. Va DESPUÉS de la identidad porque pedirle un gesto a
         * alguien cuyo rostro ni siquiera coincide es hacerlo trabajar para nada.
         *
         * Sólo se hace en `recepcion`, no en `identificacion`: el ataque de la
         * foto tiene que pasar por las dos puertas —es el mismo rostro frente a
         * la misma cámara en el mismo trámite—, así que blindar el cierre lo
         * corta entero. Ponerlo también al identificar no agregaría seguridad,
         * sólo segundos con el trabajador esperando.
         */
        let liveness: LivenessRecord | null = null;
        if (check.verified && videoRef.current) {
          // Sorteado en el momento: un video pregrabado del trabajador
          // parpadeando no sirve si esta vez toca abrir la boca.
          const challenge = pickChallenge();
          setLivenessPrompt(challenge);
          try {
            const r = await verifyLiveness(videoRef.current, challenge);
            liveness = {
              outcome: r.reason,
              challenge: r.challenge,
              score: Number(r.score.toFixed(4)),
              threshold: LIVENESS_MIN_AMPLITUDE,
              method: LIVENESS_METHOD,
            };
          } catch (e) {
            console.error('Prueba de vida interrumpida:', e);
          } finally {
            setLivenessPrompt(null);
          }
        }

        // Éste es el acto que constituye la aceptación del activo: se registra
        // siempre, con foto cuando hubo coincidencia. Es la evidencia que antes no
        // existía y dejaba la entrega respaldada sólo por una firma pre-guardada.
        void registrarHechoBiometrico({
          emp: selectedEmployee,
          stage: 'recepcion',
          check,
          guardarFoto: check.verified,
          requestId: pendingDeliveryId,
          transactionCode: pendingDeliveryCode,
          liveness,
        });

        /**
         * ⚠️ MODO OBSERVACIÓN — la prueba de vida MIDE pero NO BLOQUEA todavía.
         *
         * El umbral de identidad ya está apretado por el lado equivocado (0,5
         * contra un intra-persona real de 0,427: 15% de margen), así que apilarle
         * un segundo motivo de rechazo sin conocer su tasa de falso rechazo en
         * faena llevaría al pañolero a usar la vía de excepción todo el día —que
         * es justo el incentivo que la excepción vino a evitar—.
         *
         * Se recogen los números reales primero; el bloqueo se activa después,
         * con datos. Es el mismo camino que se usó con la CSP: report-only antes
         * que enforcement.
         */
        if (liveness && liveness.outcome !== 'ok') {
          toast({
            variant: 'warning',
            title: 'Prueba de vida no superada',
            description: `${LIVENESS_MESSAGE[liveness.outcome]} La entrega continúa: la prueba de vida está en observación y todavía no bloquea.`,
          });
        }

        if (!check.verified) {
          // El cierre de la entrega es el momento más sensible del flujo: si la
          // cámara no encontró el rostro hay que decir eso, no "el rostro no
          // coincide", que suena a que el trabajador está intentando hacer trampa.
          if (check.reason === 'no_face') {
            toast({ variant: 'warning', title: "No se ve el rostro", description: check.message });
          } else {
            toast({
              variant: 'destructive',
              title: "Validación Fallida",
              description: check.reason === 'no_match'
                ? "El rostro no coincide con el del trabajador identificado. Intente de nuevo."
                : check.message,
            });
          }
          return;
        }
      }
      setTxState('RECIBIDA_CONFORME');

      if (pendingDeliveryId) {
        // Caso: Entrega de solicitud YA aprobada -> Generar Contrato
        let contractUrl: string | null = null;
        try {
          const itemsForContract = selectedAssetIds.map(id => {
            const m = materialsMap.get(id);
            return { name: m?.name || 'Item', id: id, internalCode: m?.internalCode, condition: 'OK' };
          });

          // 1. Generar PDF
          const { blob, filename } = await generateContractPDF({
            transactionId: pendingDeliveryCode || pendingDeliveryId || `TX-ERR`,
            employeeName: selectedEmployee.name,
            employeeRut: selectedEmployee.rut || '',
            employeeSignatureUrl: selectedEmployee.signature || null,
            site: site,
            items: itemsForContract,
            deliveryTimestamp: new Date(),
            pagnoleroName: currentUser?.name || 'Pañolero',
            pagnoleroSignatureUrl: currentUser?.signature || null,
            logoUrl: currentTenant?.logoUrl,
            verification: datosVerificacionParaContrato(),
          });

          // 2. Subir a Storage con timeout (8s)
          const path = `contracts/${pendingDeliveryId || 'direct'}/${filename}`;
          contractUrl = await uploadWithTimeout(path, blob);
          if (!contractUrl) {
            toast({
              variant: 'warning',
              title: "Advertencia de Conexión",
              description: "No se pudo respaldar el contrato en la nube, pero la entrega se procesará igual."
            });
          }

        } catch (err) {
          console.error("Error generating contract:", err);
          toast({ variant: 'destructive', title: "Error en Contrato", description: "Falló la generación del PDF." });
        }

        // 3. Finalizar transacción (Con o sin URL) — registra al receptor real verificado
        await Promise.race([
          deliverApprovedMaterialRequest(
            pendingDeliveryId,
            contractUrl,
            { id: selectedEmployee.id, name: selectedEmployee.name },
            conExcepcion
              ? { mode: 'exception', exceptionGroupId: excepcionAprobada }
              : { mode: 'biometric' },
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Tiempo de espera excedido al confirmar la entrega. Verifica tu conexión y reintenta.')), 20000)
          ),
        ]);
        refreshData();

        toast({
          variant: 'success',
          title: "Entrega Completada",
          description: contractUrl ? "Contrato generado y solicitud finalizada." : "Solicitud finalizada correctamente."
        });

      } else if (selectedType === 'WITHDRAWAL') {
        // Here we only reach if it's Class C (auto-approvable)
        // because Class A/B stops at handleConfirmItems

        // 0. Pre-generar ID secuencial antes del PDF (RPC atómica, sin race condition)
        const tenantId = getTenantId();
        let directTxCode = `ERR-TX-${Date.now().toString().slice(-6)}`;
        if (tenantId) {
          try {
            directTxCode = await nextInternalCode(tenantId, 'TX');
          } catch (e) {
            console.error('Error pre-generando ID de transacción:', e);
          }
        }

        // 1. Generar Contrato para entrega directa (Clase C)
        let contractUrl: string | null = null;
        try {
          const itemsForContract = selectedAssetIds.map(id => {
            const m = materialsMap.get(id);
            return { name: m?.name || 'Item', id: id, internalCode: m?.internalCode, condition: 'OK' };
          });

          const { blob, filename } = await generateContractPDF({
            transactionId: directTxCode,
            employeeName: selectedEmployee.name,
            employeeRut: selectedEmployee.rut || '',
            employeeSignatureUrl: selectedEmployee.signature || null,
            site: site,
            items: itemsForContract,
            deliveryTimestamp: new Date(),
            pagnoleroName: currentUser?.name || 'Pañolero',
            pagnoleroSignatureUrl: currentUser?.signature || null,
            logoUrl: currentTenant?.logoUrl,
            verification: datosVerificacionParaContrato(),
          });

          // El tenant va EN LA RUTA: ver la nota de `return-evidence` más arriba.
          const path = `contracts/direct/${currentTenant?.id}/${filename}`;
          contractUrl = await uploadWithTimeout(path, blob);
        } catch (err) {
          console.error("Error generating direct contract PDF:", err);
          // Non-critical, continue
        }

        await Promise.race([
          addAndApproveMaterialRequest({
            items: selectedAssetIds.map(id => ({ materialId: id, quantity: 1 })),
            area: site,
            contractId: txContractId,
            contractName: txContractName,
            supervisorId: selectedEmployee.id,
            contractUrl: contractUrl,
            internalCode: directTxCode,
            warehouseId: txWarehouseId,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Tiempo de espera excedido al registrar la entrega. Verifica tu conexión y reintenta.')), 20000)
          ),
        ]);
        refreshData();
        toast({
          variant: 'success',
          title: "Transacción Cerrada",
          description: "Material entregado correctamente (Clase C)."
        });
      } else {
        const items = selectedAssetIds.map(id => ({
          materialId: id,
          quantity: 1,
          materialName: materialsMap.get(id)?.name || '',
          unit: materialsMap.get(id)?.unit || 'und',
          condition: returnConditions[id] || 'OK',
          notes: returnNotes[id] || '',
          evidenceUrl: returnPhotos[id] || null,
        }));
        await Promise.race([
          addAndCompleteReturnRequest({
            items,
            notes: description || 'Devolución directa en Pañol',
            workerId: selectedEmployee.id,
            workerName: selectedEmployee.name,
            contractId: txContractId,
            contractName: txContractName,
            warehouseId: txWarehouseId,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Tiempo de espera excedido al registrar la devolución. Verifica tu conexión y reintenta.')), 20000)
          ),
        ]);
        const returnedNow = new Date().toISOString();
        setJustReturnedIds(prev => new Set([...prev, ...selectedAssetIds]));
        setPendingReturnTxs(prev => [
          ...prev,
          ...selectedAssetIds.map(assetId => ({
            id: `optimistic-${assetId}`,
            assetIds: [assetId],
            type: 'RETURN' as const,
            site: '',
            employeeId: selectedEmployee!.id,
            timestamp: returnedNow,
            status: 'completed',
            isApproved: true,
          }))
        ]);
        refreshData();
      }
      setTxState('CERRADA');
      setFlowStep('COMPLETED');
      toast({
        variant: 'success',
        title: "Transacción Cerrada",
        description: "Protocolo auditado y finalizado correctamente."
      });
      setTimeout(() => setIsModalOpen(false), 2000);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsBiometricPulse(false);
    }
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobado',
      rejected: 'Rechazado',
      completed: 'Completado',
    };
    return map[status] || status.toUpperCase();
  };

  const statsWithdrawals = transactions.filter(t => t.type === 'WITHDRAWAL' && t.isApproved).length;
  const statsReturns = transactions.filter(t => t.type === 'RETURN' && t.isApproved).length;
  const statsPending = transactions.filter(t => t.status === 'pending').length;
  const statsWithContracts = transactions.filter(t => t.contractUrl).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <input
        ref={evidenceInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => capturingPhotoFor && handleEvidenceCapture(e, capturingPhotoFor)}
      />
      <div className="flex items-center justify-between">
        <PageHeader
          title="Control de Movimientos"
          description="Trazabilidad biométrica de activos — Despacho y Recepción"
        />
        {(currentUser?.role === 'administrador' || currentUser?.role === 'super-admin') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFaenaManager(true)}
            className="shrink-0 rounded-xl gap-2 text-[10px] font-black uppercase tracking-widest border-border"
          >
            <Settings2 size={14} /> Gestionar Faenas
          </Button>
        )}
      </div>

      {/* Stats rápidas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Despachos Completados', value: statsWithdrawals, color: 'text-pagnol-orange', bg: 'bg-pagnol-orange/10 border-pagnol-orange/20' },
          { label: 'Devoluciones Completadas', value: statsReturns, color: 'text-success', bg: 'bg-success-subtle border-success/30' },
          { label: 'Solicitudes Pendientes', value: statsPending, color: 'text-warning', bg: 'bg-warning-subtle border-warning/20' },
          { label: 'Actas Firmadas', value: statsWithContracts, color: 'text-info', bg: 'bg-info-subtle border-info/20' },
        ].map(s => (
          <div key={s.label} className={`p-5 rounded-[1.5rem] border ${s.bg} flex flex-col gap-1`}>
            <span className={`text-3xl font-black ${s.color}`}>{s.value}</span>
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
        <Card className="group border-none shadow-xl shadow-pagnol-orange/10 hover:shadow-2xl hover:shadow-pagnol-orange/20 transition-all cursor-pointer overflow-hidden rounded-[2rem] sm:rounded-[2.5rem] bg-card duration-500" onClick={() => startTransaction('WITHDRAWAL')}>
          <CardContent className="p-8 sm:p-12">
            <div className="flex flex-col sm:flex-row items-center sm:items-center gap-6 sm:gap-8 text-center sm:text-left">
              <div className="p-4 sm:p-6 bg-pagnol-orange/10 rounded-[1.5rem] sm:rounded-[2rem] text-pagnol-orange transition-transform group-hover:scale-110">
                <ArrowUpRight className="w-8 h-8 sm:w-10 sm:h-10" />
              </div>
              <div>
                <CardTitle className="text-2xl sm:text-3xl font-black uppercase font-outfit">Despacho</CardTitle>
                <CardDescription className="font-black uppercase tracking-widest text-[9px] sm:text-[10px]">Pañol → Faena</CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="group border-none shadow-xl shadow-success/10 hover:shadow-2xl hover:shadow-success/20 transition-all cursor-pointer overflow-hidden rounded-[2.5rem] bg-card duration-500" onClick={() => startTransaction('RETURN')}>
          <CardContent className="p-12">
            <div className="flex items-center gap-8">
              <div className="p-6 bg-success/10 rounded-[2rem] text-success transition-transform group-hover:scale-110"><ArrowDownRight size={40} /></div>
              <div>
                <CardTitle className="text-3xl font-black uppercase font-outfit">Recepción</CardTitle>
                <CardDescription className="font-black uppercase tracking-widest text-[10px]">Faena → Pañol</CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="bg-card rounded-[2rem] sm:rounded-[3rem] border-none shadow-2xl shadow-black/5 overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left min-w-[1000px]">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-6 sm:px-10 py-6 text-[10px] font-black uppercase tracking-widest">ID Transacción</th>
                <th className="px-6 sm:px-10 py-6 text-[10px] font-black uppercase tracking-widest">Tipo / Estado</th>
                <th className="px-6 sm:px-10 py-6 text-[10px] font-black uppercase tracking-widest">Activos</th>
                <th className="px-6 sm:px-10 py-6 text-[10px] font-black uppercase tracking-widest">Ruta</th>
                <th className="px-6 sm:px-10 py-6 text-[10px] font-black uppercase tracking-widest">Responsable</th>
                <th className="px-6 sm:px-10 py-6 text-[10px] font-black uppercase tracking-widest">Fecha</th>
                <th className="px-6 sm:px-10 py-6 text-[10px] font-black uppercase tracking-widest">Acta Firmada</th>
                {currentUser?.role === 'super-admin' && (
                  <th className="px-6 sm:px-10 py-6 text-[10px] font-black uppercase tracking-widest">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-muted/50">
                  <td className="px-6 sm:px-10 py-6 font-black text-xs font-mono">{tx.internalCode || tx.id}</td>
                  <td className="px-6 sm:px-10 py-6">
                    <div className="space-y-1.5">
                      <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${tx.type === 'WITHDRAWAL' ? 'bg-pagnol-orange/10 text-pagnol-orange' : 'bg-success-subtle text-success'}`}>
                        {tx.type === 'WITHDRAWAL' ? 'Despacho' : 'Devolución'}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge
                          className={
                            tx.deliveryDate || tx.isApproved
                              ? 'bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle text-[8px]'
                              : tx.status === 'pending'
                                ? 'bg-warning-subtle text-warning-subtle-foreground hover:bg-warning-subtle text-[8px]'
                                : 'bg-destructive/10 text-destructive hover:bg-destructive/10 text-[8px]'
                          }
                        >
                          {tx.type === 'WITHDRAWAL'
                            ? tx.deliveryDate
                              ? 'Entregado'
                              : tx.status === 'approved'
                                ? 'Aprobado'
                                : tx.status === 'rejected'
                                  ? 'Rechazado'
                                  : 'Pendiente'
                            : tx.isApproved ? 'Recibido' : statusLabel(tx.status)}
                        </Badge>
                        {tx.status === 'approved' && !tx.deliveryDate && tx.type === 'WITHDRAWAL' && (
                          <Button
                            size="sm"
                            onClick={() => handleContinueDelivery(tx)}
                            className="h-6 text-[8px] bg-primary text-primary-foreground animate-pulse hover:animate-none"
                          >
                            Entregar
                          </Button>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 sm:px-10 py-6">
                    <div className="flex flex-wrap gap-1">
                      {tx.assetIds.slice(0, 2).map(aid => (
                        <span key={aid} className="px-2 py-0.5 bg-muted text-muted-foreground rounded-lg text-[9px] font-black uppercase leading-tight">
                          {materialsMap.get(aid)?.name || aid}
                        </span>
                      ))}
                      {tx.assetIds.length > 2 && (
                        <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-lg text-[9px] font-black">
                          +{tx.assetIds.length - 2} más
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 sm:px-10 py-6">
                    {tx.type === 'WITHDRAWAL' ? (
                      <div className="flex items-center gap-1 text-[9px] font-black uppercase">
                        <span className="text-muted-foreground">Pañol</span>
                        <ArrowRight size={10} className="text-muted-foreground/50" />
                        <span className={tx.site ? 'text-pagnol-orange' : 'text-muted-foreground/50'}>
                          {tx.site || '—'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[9px] font-black uppercase">
                        <span className="text-muted-foreground">Faena</span>
                        <ArrowRight size={10} className="text-muted-foreground/50" />
                        <span className="text-success">Pañol</span>
                      </div>
                    )}
                    <span className={`inline-flex mt-1.5 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest ${tx.contractName ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground/60'}`}>
                      {tx.contractName || 'Sin imputar'}
                    </span>
                  </td>
                  <td className="px-6 sm:px-10 py-6">
                    <p className="font-black text-xs uppercase">
                      {usersMap.get(tx.employeeId)?.name || 'Usuario desconocido'}
                    </p>
                    {tx.type === 'WITHDRAWAL' && tx.deliveryMode === 'directed' && tx.beneficiaryName && (
                      <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest bg-info-subtle text-info">
                        Para: {tx.beneficiaryName}
                      </span>
                    )}
                    {tx.type === 'WITHDRAWAL' && tx.deliveryMode === 'open' && (
                      <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest bg-warning-subtle text-warning-subtle-foreground">
                        Retiro abierto
                      </span>
                    )}
                  </td>
                  <td className="px-6 sm:px-10 py-6">
                    <p className="text-[10px] font-black text-foreground">
                      {new Date(tx.timestamp).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                    <p className="text-[9px] text-muted-foreground font-bold">
                      {new Date(tx.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </td>
                  <td className="px-6 sm:px-10 py-6">
                    {tx.contractUrl ? (
                      <a
                        href={tx.contractUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[9px] font-black text-pagnol-orange hover:text-pagnol-orange/90 transition-colors"
                      >
                        <Download size={13} /> Ver Acta
                      </a>
                    ) : tx.deliveryDate ? (
                      <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">Sin acta</span>
                    ) : (
                      <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">—</span>
                    )}
                  </td>
                  {currentUser?.role === 'super-admin' && (
                    <td className="px-6 sm:px-10 py-6">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteTransaction(tx)}
                        className="text-muted-foreground hover:text-destructive rounded-xl transition-colors"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Faena Manager Dialog */}
      <Dialog open={showFaenaManager} onOpenChange={setShowFaenaManager}>
        <DialogContent className="max-w-md border-none bg-card sm:rounded-[2.5rem] p-8">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase font-outfit flex items-center gap-2">
              <MapPin size={18} className="text-pagnol-orange" /> Faenas y Sectores
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Configure los destinos disponibles para el despacho de activos. Estas opciones aparecerán al seleccionar materiales.
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
              {(currentTenant?.faenas || []).length === 0 ? (
                <p className="text-[10px] text-muted-foreground/50 font-bold uppercase text-center py-4">Sin faenas configuradas</p>
              ) : (
                (currentTenant?.faenas || []).map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-muted rounded-xl border">
                    <div className="flex items-center gap-2">
                      <MapPin size={12} className="text-pagnol-orange" />
                      <span className="text-[11px] font-black uppercase">{f}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive rounded-lg"
                      onClick={async () => {
                        const newList = (currentTenant?.faenas || []).filter((_, idx) => idx !== i);
                        await updateTenant(currentTenant!.id, { faenas: newList });
                        refreshData();
                      }}
                    >
                      <X size={13} />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2 pt-2 border-t border-border">
              <input
                type="text"
                placeholder="Ej: Faena Norte - Sector A"
                value={newFaenaInput}
                onChange={e => setNewFaenaInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newFaenaInput.trim()) e.currentTarget.form?.requestSubmit();
                }}
                className="flex-1 px-4 py-2.5 rounded-xl border-2 border-border bg-muted text-[11px] font-black uppercase outline-none focus:border-pagnol-orange/50"
              />
              <Button
                className="bg-pagnol-dark text-white font-black uppercase text-[10px] px-5 rounded-xl"
                onClick={async () => {
                  const name = newFaenaInput.trim();
                  if (!name || !currentTenant) return;
                  const newList = [...(currentTenant.faenas || []), name];
                  await updateTenant(currentTenant.id, { faenas: newList });
                  setNewFaenaInput('');
                  refreshData();
                }}
              >
                Agregar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isModalOpen} onOpenChange={(val) => {
        if (!val) {
          stopCamera();
          setIsModalOpen(false);
          setPendingDeliveryId(null);
          setPendingDeliveryCode(null);
          setFlowStep('IDLE');
          setIsPagnoleroConfirming(false);
        }
      }}>
        <DialogContent hideClose className="max-w-4xl p-0 border-none bg-transparent overflow-hidden sm:rounded-[3rem] h-full sm:h-auto">
          <div className="flex flex-col h-full sm:max-h-[90vh] bg-card sm:rounded-[3rem] overflow-hidden border border-border shadow-2xl">
            <DialogHeader className="p-6 sm:p-10 industrial-gradient text-white flex flex-col gap-6 shrink-0 relative overflow-hidden">
              {/* Decorative background for dark mode */}
              <div className="absolute inset-0 bg-slate-900/50 dark:bg-black/50 pointer-events-none" />
              <div className="relative z-10 flex justify-between items-center">
                <DialogTitle className="text-2xl sm:text-3xl font-black uppercase font-outfit">
                  {{
                    'CREADA': 'Inicio del Ciclo',
                    'IDENTIDAD_VERIFICADA': 'Identidad Verificada',
                    'PENDIENTE_ENTREGA': 'Selección de Activos',
                    'ENTREGADA_POR_PAÑOLERO': 'Entregado por Pañolero',
                    'RECIBIDA_CONFORME': 'Recibido Conforme',
                    'CERRADA': 'Transacción Cerrada',
                  }[txState] ?? txState}
                </DialogTitle>
                <Button variant="ghost" onClick={() => { stopCamera(); setIsModalOpen(false); }} className="text-white/40"><X size={24} /></Button>
              </div>
              {(() => {
                const STEPS = [
                  { state: 'CREADA', label: 'Inicio' },
                  { state: 'IDENTIDAD_VERIFICADA', label: 'Identidad' },
                  { state: 'PENDIENTE_ENTREGA', label: 'Activos' },
                  { state: 'ENTREGADA_POR_PAÑOLERO', label: 'Entrega' },
                  { state: 'RECIBIDA_CONFORME', label: 'Firma' },
                  { state: 'CERRADA', label: 'Cierre' },
                ];
                const activeIdx = STEPS.findIndex(s => s.state === txState);
                return (
                  <div className="flex items-center relative z-10">
                    {STEPS.map((step, i) => {
                      const isActive = i === activeIdx;
                      const isDone = i < activeIdx;
                      return (
                        <React.Fragment key={step.state}>
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black transition-all duration-300 ${isActive ? 'bg-pagnol-orange text-white scale-110 shadow-lg shadow-pagnol-orange/50' :
                                isDone ? 'bg-white/30 text-white' :
                                  'bg-white/10 text-white/30'
                              }`}>
                              {isDone ? '✓' : i + 1}
                            </div>
                            <span className={`text-[7px] font-black uppercase tracking-wider transition-all duration-300 ${isActive ? 'text-pagnol-orange' : isDone ? 'text-white/60' : 'text-white/20'
                              }`}>
                              {step.label}
                            </span>
                          </div>
                          {i < STEPS.length - 1 && (
                            <div className={`h-px flex-1 mx-1 mb-4 min-w-[12px] transition-all duration-500 ${isDone ? 'bg-white/40' : 'bg-white/10'}`} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                );
              })()}
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-6 sm:p-10 custom-scrollbar">
              {flowStep === 'SCANNING' && (
                <div className="text-center space-y-8 animate-in zoom-in-95 max-w-sm mx-auto">
                  <div className="relative aspect-square rounded-[3rem] overflow-hidden bg-black border-4 border-pagnol-orange shadow-2xl shadow-pagnol-orange/20">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 backdrop-blur-[2px]">
                      <div className="relative">
                        <div className="w-32 h-32 border-4 border-white/30 rounded-full animate-ping absolute inset-0"></div>
                        <div className="w-32 h-32 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/50 relative z-10 shadow-[0_0_40px_rgba(255,255,255,0.3)]">
                          <ScanFace size={48} className="text-white drop-shadow-lg" />
                        </div>
                      </div>
                      <div className="mt-8 bg-black/60 px-6 py-2 rounded-full backdrop-blur-md border border-white/10">
                        <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] animate-pulse">Identificando...</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-black uppercase text-2xl tracking-tight text-foreground">Identificación en Curso</h4>
                    <p className="text-[10px] font-black text-muted-foreground uppercase mt-2 tracking-widest">Aproxime su rostro a la cámara para iniciar</p>
                    <p className="text-[9px] font-bold text-muted-foreground mt-4">Sistema de Identificación Pagnol</p>

                    {/* Fallback Manual */}
                    <div className="mt-6 pt-6 border-t border-border">
                      <p className="text-[9px] text-muted-foreground mb-3 font-medium">¿Problemas con la biometría?</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          stopCamera();
                          setFlowStep('MANUAL USER SELECT');
                        }}
                        className="bg-muted hover:bg-muted/80 text-muted-foreground font-bold text-[10px] uppercase tracking-wider rounded-xl h-10 px-6"
                      >
                        Selección Manual de Operario
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {flowStep === 'MANUAL USER SELECT' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="text-center">
                    <h4 className="font-black uppercase text-xl">Selección Manual</h4>
                    <p className="text-[10px] font-black text-muted-foreground uppercase mt-1">Busque al operario por nombre o RUT</p>
                  </div>
                  <div className="space-y-4 max-h-[400px] overflow-y-auto no-scrollbar px-1">
                    <Input
                      placeholder="Buscar operario..."
                      className="h-12 rounded-xl border-border bg-muted"
                      value={manualUserSearch}
                      onChange={(e) => setManualUserSearch(e.target.value)}
                    />
                    <div className="grid grid-cols-1 gap-2">
                      {users?.filter(u => u.biometric_template && (
                        !manualUserSearch ||
                        u.name.toLowerCase().includes(manualUserSearch.toLowerCase()) ||
                        (u.rut || '').toLowerCase().includes(manualUserSearch.toLowerCase())
                      )).map(u => (
                        <button
                          key={u.id}
                          onClick={() => handleIdentityVerified(u)}
                          className="flex items-center gap-4 p-4 rounded-xl border hover:border-pagnol-orange/50 hover:bg-pagnol-orange/10 transition-all text-left group bg-card"
                        >
                          <Avatar>
                            <AvatarFallback className="bg-muted text-muted-foreground font-bold text-xs">{u.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-bold text-sm text-foreground group-hover:text-pagnol-orange uppercase">{u.name}</p>
                            <p className="text-[10px] text-muted-foreground font-medium">{u.rut || 'Sin RUT'}</p>
                          </div>
                          <div className="ml-auto">
                            {u.biometric_template ? (
                              <span className="px-2 py-1 bg-success-subtle text-success rounded-md text-[9px] font-bold uppercase">Enrolado</span>
                            ) : (
                              <span className="px-2 py-1 bg-destructive/10 text-destructive rounded-md text-[9px] font-bold uppercase">No Enrolado</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => { setFlowStep('SCANNING'); startFaceDetect(); }} className="w-full text-muted-foreground text-[10px] uppercase font-bold">
                    Volver a Escáner
                  </Button>
                </div>
              )}

              {flowStep === 'ITEMS SELECTION' && (
                <div className="space-y-6 animate-in slide-in-from-bottom-4">
                  {/* Entregas aprobadas listas para retiro por este trabajador (dirigidas / propias / abiertas) */}
                  {selectedType === 'WITHDRAWAL' && pendingDeliveriesForEmployee.length > 0 && (
                    <div className="p-4 bg-success-subtle rounded-2xl border border-success/30">
                      <p className="text-[9px] font-black text-success uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <ClipboardList size={11} /> {pendingDeliveriesForEmployee.length} Entrega{pendingDeliveriesForEmployee.length > 1 ? 's' : ''} Lista{pendingDeliveriesForEmployee.length > 1 ? 's' : ''} para Retiro
                      </p>
                      <div className="space-y-2">
                        {pendingDeliveriesForEmployee.map(tx => (
                          <div key={tx.id} className="flex items-center justify-between gap-3 p-3 bg-card rounded-xl border border-border">
                            <div className="min-w-0 space-y-0.5">
                              <p className="text-[10px] font-black text-foreground uppercase truncate">
                                {tx.assetIds.slice(0, 2).map(aid => materialsMap.get(aid)?.name || aid).join(', ')}
                                {tx.assetIds.length > 2 ? ` +${tx.assetIds.length - 2}` : ''}
                              </p>
                              <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">
                                {tx.internalCode || tx.id}
                                {tx.deliveryMode === 'directed' && ' · Dirigida a este trabajador'}
                                {tx.deliveryMode === 'open' && ' · Retiro abierto'}
                                {(!tx.deliveryMode || tx.deliveryMode === 'self') && ' · Solicitada por él'}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => continueDeliveryAsIdentified(tx)}
                              className="h-8 text-[9px] font-black uppercase bg-success text-success-foreground hover:bg-success/90 shrink-0"
                            >
                              Entregar <ArrowRight size={12} className="ml-1" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Contrato o área del trabajador: define de qué desglose sale (o a cuál vuelve) el stock.
                      Un área interna (Administración, Finanzas…) se comporta igual que un contrato. */}
                  <div className="p-4 bg-primary/5 rounded-2xl border border-primary/20">
                    <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <ClipboardList size={11} /> Contrato / Área {selectedType === 'WITHDRAWAL' ? 'de Cargo' : 'de Devolución'}
                    </p>
                    {employeeContracts.length === 0 ? (
                      <p className="text-[9px] font-bold text-warning uppercase tracking-widest">
                        {selectedEmployee?.name || 'El trabajador'} no está asignado a ningún contrato ni área interna —
                        el movimiento quedará sin imputar. Si es personal de planta, asígnalo a su área.
                      </p>
                    ) : employeeContracts.length === 1 ? (
                      <span className="inline-flex px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-primary text-primary-foreground">
                        {employeeContracts[0].name}
                        {employeeContracts[0].kind === 'internal' && ' · Área interna'}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {employeeContracts.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setTxContractId(txContractId === c.id ? null : c.id)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border-2 ${txContractId === c.id ? 'bg-primary text-primary-foreground border-primary shadow-md' : 'bg-card text-muted-foreground border-primary/20 hover:border-primary/40'}`}
                          >
                            {c.name}{c.kind === 'internal' && ' · Área'}
                          </button>
                        ))}
                      </div>
                    )}
                    {employeeContracts.length > 1 && !txContractId && (
                      <p className="text-[8px] text-primary/70 font-bold mt-2 uppercase tracking-widest">
                        El trabajador tiene varias asignaciones — seleccione a cuál se imputa
                      </p>
                    )}
                  </div>
                  {/* Pañol del panolero: dónde queda registrado el movimiento */}
                  {myWarehouses.length > 0 && (
                    <div className="p-4 bg-info-subtle rounded-2xl border border-info/20">
                      <p className="text-[9px] font-black text-info uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <WarehouseIcon size={11} /> Pañol {selectedType === 'WITHDRAWAL' ? 'que entrega' : 'que recibe'}
                      </p>
                      {myWarehouses.length === 1 ? (
                        <span className="inline-flex px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-info text-info-foreground">
                          {myWarehouses[0].name}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {myWarehouses.map(w => (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => setTxWarehouseId(w.id)}
                              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border-2 ${txWarehouseId === w.id ? 'bg-info text-info-foreground border-info shadow-md' : 'bg-card text-muted-foreground border-info/20 hover:border-info/40'}`}
                            >
                              {w.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {selectedType === 'WITHDRAWAL' && (
                    <div className="p-4 bg-pagnol-orange/10 rounded-2xl border border-pagnol-orange/20">
                      <p className="text-[9px] font-black text-pagnol-orange uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <MapPin size={11} /> Faena / Sector de Destino
                      </p>
                      {(currentTenant?.faenas && currentTenant.faenas.length > 0) ? (
                        <div className="flex flex-wrap gap-2">
                          {currentTenant.faenas.map(f => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setSite(site === f ? '' : f)}
                              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border-2 ${site === f ? 'bg-pagnol-orange text-white border-pagnol-orange shadow-md' : 'bg-card text-muted-foreground border-pagnol-orange/20 hover:border-pagnol-orange/40'}`}
                            >
                              {f}
                            </button>
                          ))}
                          <input
                            type="text"
                            placeholder="Otro sector..."
                            value={!currentTenant.faenas.includes(site) ? site : ''}
                            onChange={e => setSite(e.target.value)}
                            className="px-4 py-2 rounded-xl text-[10px] font-black border-2 border-pagnol-orange/20 bg-card outline-none focus:border-pagnol-orange/40 min-w-[130px]"
                          />
                        </div>
                      ) : (
                        <input
                          type="text"
                          placeholder="Ingrese la faena o sector de destino..."
                          value={site}
                          onChange={e => setSite(e.target.value)}
                          className="w-full px-4 py-3 rounded-xl text-[10px] font-black border-2 border-pagnol-orange/20 bg-card outline-none focus:border-pagnol-orange/40"
                        />
                      )}
                      {!site && (
                        <p className="text-[8px] text-pagnol-orange/70 font-bold mt-2 uppercase tracking-widest">Seleccione o ingrese el destino del despacho</p>
                      )}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <form onSubmit={handleQrScan} className="flex items-center gap-3 bg-primary/5 px-4 py-3 rounded-2xl border-2 border-primary/20 flex-1">
                      <QrCode className="text-primary shrink-0" size={16} />
                      <input ref={qrInputRef} autoFocus type="text" placeholder="ESCANEANDO QR..." className="bg-transparent border-none outline-none font-black text-xs flex-1 min-w-0" value={qrInput} onChange={e => setQrInput(e.target.value)} />
                    </form>
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={14} />
                      <input
                        type="text"
                        placeholder="Buscar por nombre..."
                        value={searchAsset}
                        onChange={e => setSearchAsset(e.target.value)}
                        className="w-full pl-9 pr-4 py-3 rounded-2xl text-xs font-bold border-2 border-border bg-muted outline-none focus:border-primary/40 transition-all h-full"
                      />
                    </div>
                  </div>

                  {!searchAsset.trim() && availableAssets.length > ASSET_DISPLAY_LIMIT && (
                    <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest text-center">
                      Mostrando {ASSET_DISPLAY_LIMIT} más utilizados de {availableAssets.length} — busca para filtrar o escanea QR
                    </p>
                  )}
                  {searchAsset.trim() && (
                    <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest text-center">
                      {displayedAssets.length} resultado{displayedAssets.length !== 1 ? 's' : ''} para "{searchAsset}"
                    </p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {displayedAssets.map(a => (
                      <div key={a.id} onClick={() => toggleAsset(a.id)} className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between gap-3 ${selectedAssetIds.includes(a.id) ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/40'}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <Package size={18} className="text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="font-black uppercase text-[10px] truncate">{a.name}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <Badge variant="outline" className="text-[7px] font-mono uppercase">{a.internalCode || a.id.substring(0, 8)}</Badge>
                              {(a.stock || 0) > 0 && <span className="text-[7px] font-bold text-success">{a.stock} disp.</span>}
                              {selectedType === 'WITHDRAWAL' && (a.class === 'A' || a.class === 'B') && <Badge className="bg-destructive/10 text-destructive text-[7px]">Restringido</Badge>}
                            </div>
                          </div>
                        </div>
                        {selectedAssetIds.includes(a.id) && <CheckCircle size={18} className="text-primary shrink-0" />}
                      </div>
                    ))}
                    {displayedAssets.length === 0 && searchAsset.trim() && (
                      <div className="col-span-2 text-center py-8 text-muted-foreground text-xs font-bold uppercase tracking-widest">
                        Sin resultados para "{searchAsset}"
                      </div>
                    )}
                  </div>
                </div>
              )}

              {flowStep === 'CONDITION CHECK' && (
                <div className="space-y-6 animate-in slide-in-from-right-4">
                  <div className="p-6 bg-pagnol-orange/10 rounded-[2rem] border border-pagnol-orange/20 mb-6">
                    <h4 className="font-black uppercase text-lg text-pagnol-orange flex items-center gap-2"><ClipboardList /> Estado de Devolución</h4>
                    <p className="text-[10px] font-bold text-pagnol-orange uppercase mt-1">Verifique el estado físico de cada activo antes de recibirlo.</p>
                  </div>

                  <div className="space-y-4">
                    {selectedAssetIds.map(id => {
                      const asset = materialsMap.get(id);
                      const condition = returnConditions[id];
                      return (
                        <div key={id} className="p-6 bg-muted border rounded-[2rem] flex flex-col gap-6 shadow-sm transition-all">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                              <div className="p-3 bg-muted rounded-2xl"><Package size={20} /></div>
                              <div>
                                <p className="text-[11px] font-black uppercase text-foreground">{asset?.name}</p>
                                {(asset?.internalCode || asset?.serialNumber) && (
                                  <Badge variant="outline" className="text-[8px] mt-1 font-mono tracking-tighter">
                                    {asset.internalCode || `SN: ${asset.serialNumber}`}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            <div className="flex gap-2">
                              {(['OK', 'CON FALLA', 'ROTO'] as ReturnStatus[]).map(status => (
                                <button
                                  key={status}
                                  onClick={() => setReturnConditions(prev => ({ ...prev, [id]: status }))}
                                  className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border-2 ${condition === status
                                    ? (status === 'OK' ? 'bg-success-subtle text-success-subtle-foreground border-success/30' : status === 'CON FALLA' ? 'bg-warning-subtle text-warning-subtle-foreground border-warning/20' : 'bg-destructive/10 text-destructive border-destructive/30')
                                    : 'bg-muted text-muted-foreground border-border hover:border-border hover:bg-muted/80'
                                    }`}
                                >
                                  {status}
                                </button>
                              ))}
                            </div>
                          </div>

                          {condition && condition !== 'OK' && (
                            <div className="animate-in fade-in slide-in-from-top-2 border-t pt-6 space-y-4">
                              <div className="space-y-2">
                                <label className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1 flex items-center gap-2">
                                  <MessageSquare size={12} /> Detalles de la falla / Daño
                                </label>
                                <Textarea
                                  value={returnNotes[id] || ''}
                                  onChange={(e) => setReturnNotes(prev => ({ ...prev, [id]: e.target.value }))}
                                  placeholder="DESCRIBA BREVEMENTE CÓMO LLEGÓ EL ACTIVO..."
                                  className="rounded-2xl border-2 border-border focus:border-primary/20 bg-muted text-[10px] font-bold h-24 uppercase"
                                />
                              </div>

                              <div className="flex items-center gap-4">
                                {returnPhotoPreviews[id] && (
                                  <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-success/30 shadow-sm shrink-0">
                                    <img src={returnPhotoPreviews[id]} className="w-full h-full object-cover" alt="Evidencia" />
                                  </div>
                                )}
                                <div className="flex-1">
                                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1 mb-2">Evidencia Fotográfica (Opcional)</p>
                                  <Button
                                    variant="outline"
                                    onClick={() => { setCapturingPhotoFor(id); evidenceInputRef.current?.click(); }}
                                    className={`w-full h-14 rounded-2xl border-2 border-dashed transition-all flex items-center justify-center gap-3 ${returnPhotoPreviews[id] ? 'border-success/30 bg-success-subtle text-success hover:bg-success-subtle' : 'border-border hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary'}`}
                                  >
                                    <Camera size={20} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">
                                      {returnPhotoPreviews[id] ? 'Cambiar Foto de Evidencia' : 'Tomar Foto de Evidencia'}
                                    </span>
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <Button onClick={handleConfirmConditions} className="w-full py-6 rounded-2xl bg-pagnol-dark text-white font-black uppercase tracking-widest mt-4">Confirmar Estados y Continuar</Button>
                </div>
              )}

              {flowStep === 'CONFIRMATION PAGNOLERO' && (
                <div className="space-y-6 animate-in zoom-in-95">
                  <div className="p-8 bg-muted rounded-[2rem] border border-border space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-pagnol-orange/10 rounded-2xl">
                        <CheckCircle size={28} className="text-pagnol-orange" />
                      </div>
                      <div>
                        <h4 className="font-black uppercase text-lg">Confirmación del Pañolero</h4>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase mt-0.5">Verifique el material físico antes de confirmar.</p>
                      </div>
                    </div>

                    {selectedEmployee && (
                      <div className="flex items-center gap-3 p-4 bg-card rounded-2xl border border-border">
                        <Avatar>
                          <AvatarFallback className="bg-pagnol-orange/10 text-pagnol-orange font-black text-xs">
                            {selectedEmployee.name.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-[10px] font-black text-muted-foreground uppercase">Trabajador</p>
                          <p className="font-black text-sm uppercase">{selectedEmployee.name}</p>
                        </div>
                      </div>
                    )}

                    {selectedType === 'WITHDRAWAL' && (
                      <div className="flex items-center gap-3 p-4 bg-pagnol-orange/10 rounded-2xl border border-pagnol-orange/20">
                        <MapPin size={16} className="text-pagnol-orange shrink-0" />
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase flex-wrap">
                          <span className="text-muted-foreground">Pañol</span>
                          <ArrowRight size={12} className="text-muted-foreground" />
                          <span className="text-pagnol-orange">{site || 'Sin destino especificado'}</span>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest ml-1">Activos a entregar ({selectedAssetIds.length})</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto no-scrollbar">
                        {selectedAssetIds.map(id => {
                          const asset = materialsMap.get(id);
                          return (
                            <div key={id} className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border">
                              <Package size={16} className="text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-black text-[11px] uppercase truncate">{asset?.name || 'Activo'}</p>
                                {(asset?.internalCode || asset?.serialNumber) && (
                                  <p className="text-[9px] text-muted-foreground font-mono">
                                    {asset.internalCode || `SN: ${asset.serialNumber}`}
                                  </p>
                                )}
                              </div>
                              {asset?.class && (
                                <Badge className="text-[8px] shrink-0 bg-muted text-muted-foreground">Clase {asset.class}</Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={handlePagnoleroApproval}
                    disabled={isPagnoleroConfirming}
                    className="w-full py-8 rounded-[1.5rem] bg-pagnol-dark text-white font-black uppercase tracking-widest hover:bg-black shadow-2xl shadow-black/20 transition-all"
                  >
                    {isPagnoleroConfirming
                      ? <Loader2 className="animate-spin mx-auto" />
                      : <span className="flex items-center justify-center gap-3"><CheckCircle size={18} /> Confirmar Entrega</span>
                    }
                  </Button>
                </div>
              )}

              {flowStep === 'FIRMA RECIBIDO' && (
                <div className="text-center space-y-8 animate-in zoom-in-95 max-w-md mx-auto">
                  <div className="relative aspect-square rounded-[3rem] overflow-hidden bg-black border-4 border-pagnol-orange/30 shadow-2xl">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    {!cameraStream && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-4">
                        <Loader2 size={40} className="text-pagnol-orange animate-spin" />
                        <p className="text-[10px] font-black text-white uppercase tracking-widest">Iniciando cámara...</p>
                      </div>
                    )}
                    {/* Prueba de vida: la instrucción tapa el pie de foto porque
                        mientras se pide el gesto es lo ÚNICO que el trabajador
                        tiene que leer. Sin instrucción visible nadie parpadea a
                        propósito y toda la medición saldría "sin movimiento". */}
                    {livenessPrompt ? (
                      <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black via-black/80 to-transparent animate-in fade-in">
                        <p className="text-[10px] font-black text-pagnol-orange uppercase tracking-widest mb-1">
                          Prueba de vida
                        </p>
                        <p className="text-xl font-black text-white uppercase leading-tight">
                          {CHALLENGE_PROMPT[livenessPrompt]}
                        </p>
                      </div>
                    ) : (
                      <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 to-transparent">
                        <p className="text-[10px] font-black text-white uppercase tracking-widest mb-1">Trabajador:</p>
                        <p className="text-xl font-black text-pagnol-orange uppercase">{selectedEmployee?.name}</p>
                      </div>
                    )}
                    <div className="absolute top-4 right-4 p-2 bg-black/40 rounded-xl backdrop-blur-sm">
                      <ShieldCheck size={28} className="text-pagnol-orange drop-shadow-lg" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-black uppercase text-xl text-foreground">Certificación de Recepción</h4>
                    <p className="text-[10px] font-black text-muted-foreground uppercase leading-relaxed px-10">
                      Al presionar el botón, se realizará una validación biométrica final para cerrar el protocolo de entrega.
                    </p>
                  </div>

                  <Button
                    disabled={isBiometricPulse || !cameraStream}
                    onClick={handleFinalAcceptance}
                    className="w-full py-8 rounded-[1.5rem] bg-pagnol-orange text-white font-black uppercase tracking-widest shadow-xl shadow-pagnol-orange/20 hover:bg-pagnol-orange/90 transition-all disabled:opacity-50"
                  >
                    {livenessPrompt
                      ? CHALLENGE_PROMPT[livenessPrompt]
                      : isBiometricPulse
                        ? <Loader2 className="animate-spin mx-auto" />
                        : !cameraStream
                          ? "Iniciando cámara..."
                          : "Validar Biometría y Cerrar"
                    }
                  </Button>
                </div>
              )}

              {flowStep === 'COMPLETED' && (
                <div className="text-center py-20 animate-in zoom-in duration-500">
                  <div className="w-24 h-24 bg-success text-success-foreground rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl animate-bounce">
                    <UserCheck size={48} />
                  </div>
                  <h4 className="font-black uppercase text-2xl mt-8">Transacción Cerrada</h4>
                  <p className="text-[10px] font-black text-muted-foreground uppercase mt-2">Protocolo finalizado correctamente.</p>
                </div>
              )}
            </div>

            <DialogFooter className="p-6 sm:p-10 border-t flex items-center justify-between">
              {flowStep !== 'COMPLETED' && (
                <>
                  <Button variant="ghost" onClick={() => { stopCamera(); setIsModalOpen(false); }} className="text-muted-foreground font-black uppercase text-[10px]">Cancelar</Button>
                  {flowStep === 'ITEMS SELECTION' && (() => {
                    const hasRestricted = selectedType === 'WITHDRAWAL' && selectedAssetIds.some(id => {
                      const m = materialsMap.get(id);
                      return m?.class === 'A' || m?.class === 'B';
                    });
                    return (
                      <Button
                        disabled={selectedAssetIds.length === 0 || isBiometricPulse}
                        onClick={handleConfirmItems}
                        className={`text-white font-black uppercase text-[10px] px-8 rounded-xl h-12 ${hasRestricted ? 'bg-destructive hover:bg-destructive/90' : 'bg-pagnol-dark'}`}
                      >
                        {isBiometricPulse
                          ? <><Loader2 className="animate-spin h-4 w-4 mr-2" />Enviando solicitud...</>
                          : hasRestricted
                            ? <>Solicitar Aprobación <ArrowRight size={14} className="ml-2" /></>
                            : <>Confirmar Selección <ArrowRight size={14} className="ml-2" /></>
                        }
                      </Button>
                    );
                  })()}
                </>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Única vía para que un activo salga sin verificación facial. */}
      <BiometricExceptionDialog
        target={excepcionPara}
        onClose={() => setExcepcionPara(null)}
        onRequest={requestBiometricException}
        onResolve={resolveBiometricException}
        onApproved={(grupo) => {
          setExcepcionAprobada(grupo);
          // No se reconstruye el flujo a mano —haría falta duplicar la carga de
          // ítems y dejaría la entrega a medias si algo faltara—. Con la
          // excepción ya vigente, volver a pulsar "Entregar" recorre el camino
          // normal, que la detecta solo.
          toast({
            variant: 'success',
            title: "Listo para entregar",
            description: "Pulsa Entregar de nuevo: la excepción ya está autorizada.",
          });
        }}
      />
    </div >
  );
}
