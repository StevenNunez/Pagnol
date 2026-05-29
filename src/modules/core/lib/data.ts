
"use client";

export type FieldValue = any;

export type UserRole = "administrador" | "director-faena" | "jefe-turno" | "jefe-mantencion" | "geologo" | "topografo" | "supervisor" | "operador" | "apr" | "guardia" | "finance" | "super-admin" | "panolero" | "cphs" | "jefe-terreno" | "quality" | "jefe-oficina-tecnica" | "contratista";

export interface Tenant {
  id: string;
  name: string;
  tenantId: string;
  createdAt?: Date | string;
  plan?: 'basic' | 'pro' | 'enterprise';
  criticalitySettings?: {
    thresholdA: number;
    thresholdB: number;
    currency?: string;
  };
  // Datos legales para Acta EA (Art. 11 Código del Trabajo Chile)
  rut?: string;
  legalRepresentative?: string;
  legalRepresentativeRut?: string;
  address?: string;
  // Faenas y sectores configurados (Bodega → Destino en despachos)
  faenas?: string[];
}

export interface EADocument {
  id: string;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  filePath: string | null;
  fileUrl: string | null;
  status: 'generated' | 'sent_to_dt';
  generatedAt: Date | string;
  confirmedAt?: Date | string | null;
  generatedBy?: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string;
  token: string;
  status: 'pending' | 'used' | 'expired';
  expiresAt: Date | string;
  invitedBy: string;
  invitedByName?: string;
  createdAt: Date | string;
}

export interface SubscriptionPlan {
  plan: 'basic' | 'pro' | 'enterprise';
  features: {
    basic: boolean;
    pro: boolean;
    enterprise: boolean;
  },
  maxUsers?: number;
  maxRequests?: number;
  storageLimitMB?: number;
  expiresAt?: Date | string;
  allowedPermissions?: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  qrCode: string;
  tenantId: string; // ID of the company/tenant they belong to
  rut?: string;
  internalId?: string;
  cargo?: string;
  phone?: string;
  fechaIngreso?: Date | null;
  baseSalary?: number; // Sueldo base
  afp?: string;
  tipoSalud?: 'Fonasa' | 'Isapre';
  cargasFamiliares?: number;
  signature?: string; // Data URL of the user's signature
  biometric_template?: string | null; // WebAuthn Credential ID for hardware authentication
  kyc_id_front?: string | null; // Data URL or URL for ID front
  kyc_id_back?: string | null; // Data URL or URL for ID back
  kyc_face_image?: string | null; // Data URL or URL for face capture
  onboardingCompleted?: boolean;
  grantedPermissions?: string[]; // Dynamically granted permissions for this user
  enrolledBy?: string | null; // Name/ID of admin who did the enrollment
  enrolledAt?: Date | string | null;
}

export interface Unit {
  id: string;
  name: string;
}

export interface Tool {
  id: string;
  name: string;
  qrCode: string;
  status: 'available' | 'in-use' | 'maintenance';
}

export interface MaterialCategory {
  id: string;
  name: string;
}

export interface Material {
  id: string;
  name: string;
  stock: number;
  inUse?: number;
  unit: string;
  category: string;
  supplierId?: string | null;
  archived?: boolean;

  // ISO 55000/55001/55002 — Asset Management fields
  class?: 'A' | 'B' | 'C'; // Criticidad operacional (ISO 55001 risk-based classification)
  usageType?: 'Consumible' | 'Reutilizable Controlado' | 'Herramienta Menor' | 'Repuesto Crítico' | 'Activo Fijo' | 'IT Controlado';
  accountingNature?: 'CAPEX' | 'OPEX' | 'Inventario Estratégico' | 'Activo Menor Capitalizable';
  usefulLife?: number; // Vida útil en años
  description?: string; // Marca, modelo, certificaciones
  unitCost?: number;
  acquisitionDate?: Date | string;
  serialNumber?: string; // N° de Serie del Fabricante
  status?: 'Disponible' | 'En Mantenimiento' | 'Para Baja' | 'Extraviado' | 'En Uso';
  photos?: string[]; // URLs de las fotos
  nextMaintenanceDate?: Date | string;
  isITAsset?: boolean;
  internalCode?: string; // Código interno personalizado
  location?: string; // Ubicación física (Bodega, Planta, etc)
  brand?: string; // Marca del fabricante
  technicalSheetUrl?: string; // URL de la ficha técnica (PDF/Doc)
  technicalSheetName?: string; // Nombre del archivo de la ficha técnica
  conditionScore?: 'Excelente' | 'Bueno' | 'Regular' | 'Crítico' | 'Obsoleto'; // ISO 55001 condition assessment
  
  // ISO 55001 Core Additions
  parentId?: string | null; // Taxonomía Padre-Hijo (jerarquía de activos)
  failureProbability?: 1 | 2 | 3 | 4 | 5; // Matriz de riesgo
  failureImpact?: 1 | 2 | 3 | 4 | 5; // Matriz de riesgo
  mtbf?: number; // Mean Time Between Failures (días)
  mttr?: number; // Mean Time To Repair (horas)
  availability?: number; // % Disponibilidad histórica
  documents?: { id: string; name: string; url: string; type: 'Manual' | 'Garantía' | 'Certificado' | 'RCA' | 'Otro'; date: string }[];
}

// ISO 55001 - Mantenimiento
export interface MaintenanceOrder {
  id: string;
  internalCode?: string; // código legible tipo OT-XXX-0001
  tenantId: string;
  materialId: string;
  materialName: string;
  type: 'PREVENTIVE' | 'CORRECTIVE' | 'PREDICTIVE';
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: Date | string;
  scheduledDate?: Date | string | null;
  completedAt?: Date | string | null;
  reportedBy?: string;
  assignedTo?: string; // ID del mantenedor
  assignedToName?: string;
  description: string;
  rootCauseAnalysis?: string; // RCA (Análisis Causa Raíz)
  preventiveAction?: string; // Acción para evitar recurrencia
  partsUsed?: { materialId: string; materialName: string; quantity: number; cost: number }[];
  downtimeHours?: number; // Horas que el equipo estuvo fuera de servicio
  totalCost?: number;
}

export interface MaintenanceLog {
  id: string;
  tenantId: string;
  materialId: string;
  orderId?: string; // Ref a MaintenanceOrder
  timestamp: Date | string;
  action: string;
  performedBy: string;
  performedByName: string;
  type: 'INSPECTION' | 'REPAIR' | 'CALIBRATION' | 'REPLACEMENT' | 'FAILURE_REPORT';
}

export interface MaterialRequest {
  id: string;
  internalCode?: string;
  items: {
    materialId: string;
    quantity: number;
  }[];
  area: string;
  supervisorId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  userName?: string;
  approvalDate?: Date;
  rejectionDate?: Date;
  deliveryDate?: Date;
  approverId?: string;
  approverName?: string;
  notes?: string;
  tenantId: string;
  highestClass?: 'A' | 'B' | 'C';
  contractUrl?: string | null;
  deliveredByUserId?: string;
  deliveredByUserName?: string;
}

export interface ReturnRequest {
  id: string;
  internalCode?: string;
  supervisorId: string;
  supervisorName: string;
  materialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  status: 'pending' | 'completed' | 'rejected';
  createdAt: Date;
  completionDate?: Date;
  notes?: string;
  handlerId?: string; // ID of the admin who handled it
  handlerName?: string;
  tenantId: string;
  returnCondition?: 'OK' | 'CON FALLA' | 'ROTO';
  evidenceUrl?: string;
}

export type PurchaseRequestStatus = "pending" | "approved" | "rejected" | "received" | "ordered" | "batched";

export interface PurchaseRequest {
  id: string;
  materialName: string;
  quantity: number;
  originalQuantity?: number | null;
  unit: string;
  justification: string;
  supervisorId: string;
  status: PurchaseRequestStatus;
  createdAt: Date;
  receivedAt?: Date | null;
  category: string;
  area: string;
  lotId?: string | null;
  notes?: string | null;
  approverId?: string | null;
  approvalDate?: Date | null;
  requesterName?: string;
  approverName?: string;
  tenantId: string;
  purchaseOrderId?: string;
  rejectionReason?: string;
  rejectionDate?: Date;
}

export interface ToolLog {
  id: string;
  toolId: string;
  toolName: string;
  userId: string;
  userName: string;
  checkoutDate: Date;
  returnDate: Date | null;
  checkoutSupervisorId: string;
  checkoutSupervisorName: string;
  returnSupervisorId?: string;
  returnSupervisorName?: string;
  returnStatus?: 'ok' | 'damaged' | null;
  returnNotes?: string;
}

// Códigos de marcas de asistencia (estándar industria minera)
export type AttendanceMark = 'P' | 'A' | 'D' | 'LM' | 'PSG' | 'V' | 'PP' | 'MJ' | 'ATR';

export const ATTENDANCE_MARK_LABELS: Record<AttendanceMark, string> = {
  P:   'Presente',
  A:   'Ausente',
  D:   'Descanso',
  LM:  'Licencia Médica',
  PSG: 'Permiso Sin Goce',
  V:   'Vacaciones',
  PP:  'Permiso Paternal',
  MJ:  'Media Jornada',
  ATR: 'Atraso',
};

export interface AttendanceLog {
  id: string;
  userId: string;
  userName: string;
  timestamp: Date;
  type: 'in' | 'out';
  method: 'qr' | 'manual' | 'import';
  registrarId: string;
  registrarName: string;
  date: string; // YYYY-MM-DD
  contractId?: string | null;
  markType?: AttendanceMark | null; // null = entrada/salida normal
  originalTimestamp?: Date | null;
  modifiedAt?: Date | null;
  modifiedBy?: string | null;
}

// ── Resultado de escaneo QR ──────────────────────────────────────────────────

export interface ScanResult {
  workerId: string;
  workerName: string;
  workerCargo?: string;
  logType: 'in' | 'out';
  logTime: string;           // HH:mm
  contractId?: string | null;
  contractName?: string | null;
  shiftName?: string | null;
  shiftType?: string | null;
  isNightShift?: boolean;
  isRestDay: boolean;
}

// ── Contratos y Turnos (Minería) ─────────────────────────────────────────────

export type ShiftType = '5x2' | '4x3' | '7x7' | '14x14' | '21x7' | 'custom';

export interface ShiftSchedule {
  id: string;
  tenantId: string;
  name: string;
  shiftType: ShiftType;
  daysOn: number;
  daysOff: number;
  workStart: string;    // HH:mm
  workEnd: string;      // HH:mm
  isNightShift: boolean;
  lunchStart?: string;  // HH:mm
  lunchEnd?: string;    // HH:mm
  rotationReferenceDate: string; // YYYY-MM-DD — day 1 of the on-cycle
  createdAt: Date;
}

export interface Contract {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
  clientName?: string;
  location?: string;
  status: 'active' | 'closed' | 'suspended';
  startDate: Date | string;
  endDate?: Date | string | null;
  description?: string;
  createdBy?: string;
  createdAt: Date;
  // Subcontratistas
  isSubcontractor?: boolean;
  parentContractId?: string | null;
  subcontractorCompany?: string | null;
  subcontractorRut?: string | null;
}

export interface ContractWorker {
  id: string;
  tenantId: string;
  contractId: string;
  userId: string;
  shiftScheduleId?: string | null;
  roleInContract?: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  createdAt: Date;
}

export interface Supplier {
  id: string;
  name: string;
  categories: string[];
  rut?: string;
  bank?: string;
  accountType?: string;
  accountNumber?: string;
  email?: string;
  address?: string;
  phone?: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  createdAt: Date;
  creatorId: string;
  creatorName: string;
  status: 'generated' | 'sent' | 'completed' | 'cancelled' | 'issued';
  requestIds?: string[];
  items: { id: string; name: string; unit: string; totalQuantity: number; price?: number; }[];
  lotId?: string | null;
  pdfUrl?: string;
  officialOCId?: string; // ID for the final, confirmed OC
  processedAt?: Date;
  processedBy?: string;
  totalAmount?: number;
  tenantId: string;
}

export interface StockMovement {
  id: string;
  materialId: string;
  materialName: string;
  quantityChange: number; // Positive for entry, negative for exit
  newStock: number;
  type: 'manual-entry' | 'initial' | 'request-delivery' | 'return-reentry' | 'adjustment';
  date: Date;
  justification: string;
  userId: string; // User who performed the action
  userName: string;
  relatedRequestId?: string;
}

export interface PurchaseLot {
  id: string;
  name: string;
  createdAt: Date;
  creatorId: string;
  creatorName: string;
  status: 'open' | 'ordered';
  supplierId: string;
}

// ── Construction Protocols ───────────────────────────────────────────────────

export type ProtocolType = 'inicio' | 'entrega';
export type ProtocolStatus = 'borrador' | 'pendiente_revision' | 'aprobado' | 'rechazado';

export interface ProtocolNormativa {
  code: string;       // ej: "NCh 170 Of.85"
  description: string;
}

export interface ProtocolResponsibility {
  role: string;       // ej: "Supervisor de Obra"
  description: string;
}

export interface ProtocolItem {
  element: string;
  si: boolean;
  no: boolean;
  na: boolean;
  responsibleUserId?: string;
  responsibleName?: string;
  date?: string | null;
  observations?: string;
}

export interface ProtocolSignature {
  userId: string;
  name: string;
  role: string;
  signature: string; // PNG data URL
  date: string;      // ISO timestamp
}

export interface ProtocolTemplate {
  id: string;
  tenantId: string;
  title: string;
  type: ProtocolType;
  activityType: string;    // ej: "enfierradura", "hormigonado", "excavacion"
  objective: string;
  normativa: ProtocolNormativa[];
  responsibilities: ProtocolResponsibility[];
  items: Pick<ProtocolItem, 'element'>[];
  createdBy: string;
  createdAt: Date;
}

export interface Protocol {
  id: string;
  tenantId: string;
  templateId?: string | null;
  workItemId?: string | null;
  title: string;
  type: ProtocolType;
  activityType: string;
  obra: string;
  objective: string;
  normativa: ProtocolNormativa[];
  responsibilities: ProtocolResponsibility[];
  items: ProtocolItem[];
  status: ProtocolStatus;
  evidencePhotos: string[];
  executorSignature?: ProtocolSignature | null;
  supervisorSignature?: ProtocolSignature | null;
  qualityManagerSignature?: ProtocolSignature | null;
  rejectionReason?: string | null;
  createdBy: string;
  createdAt: Date;
  completedAt?: Date | null;
  reviewedAt?: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ChecklistTemplate {
  id: string;
  title: string;
  items: Pick<ChecklistItem, 'element'>[];
  createdBy: string;
  createdAt: Date;
}

export interface AssignedSafetyTask {
  id: string;
  templateId: string;
  templateTitle: string;
  supervisorId: string;
  assignerId: string;
  assignerName: string;
  createdAt: Date;
  status: 'assigned' | 'completed' | 'approved' | 'rejected';
  area: string;
  items?: any[];
  observations?: string;
  evidencePhotos?: string[];
  performedBy?: any;
  completedAt?: Date;
  reviewedBy?: {
    signature: string;
    date: Date;
    name: string;
  };
  rejectionNotes?: string;
}

export interface BehaviorObservation {
  id: string;
  obra: string;
  workerId: string;
  workerName: string;
  workerRut: string;
  observationDate: Date;
  items: BehaviorObservationItem[];
  riskLevel: 'aceptable' | 'leve' | 'grave' | 'gravisimo' | null;
  feedback: string;
  observerSignature: string;
  workerSignature: string;
  observerId: string;
  observerName: string;
  createdAt: Date;
  evidencePhoto?: string;
}

export interface BehaviorObservationItem {
  question: string;
  status: 'si' | 'no' | 'na' | null;
}

export interface ChecklistItem {
  element: string;
  yes: boolean;
  no: boolean;
  na: boolean;
  responsibleUserId: string;
  completionDate: Date | null;
}

export interface SafetyInspection {
  id: string;
  inspectorId: string;
  inspectorName: string;
  inspectorRole: UserRole;
  date: Date;
  area: string;
  location?: string;
  description: string;
  riskLevel: 'leve' | 'grave' | 'fatal';
  actionPlan?: string;
  evidencePhotoUrl?: string;
  evidencePhotos?: string[];
  assignedTo: string;
  deadline?: Date;
  status: 'open' | 'in-progress' | 'completed' | 'approved' | 'rejected';
  completionNotes?: string;
  completionExecutor?: string;
  completionPhotos?: string[];
  completedAt?: Date;
  completionSignature?: string;
  reviewedBy?: {
    id: string;
    name: string;
    signature: string;
    date: Date;
  };
  rejectionNotes?: string;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  amount: number;
  issueDate: Date;
  dueDate: Date;
  status: 'pending' | 'paid' | 'overdue';
  createdAt?: Date;
  purchaseOrderNumber?: string;
  work?: string; // Obra
  paymentDate?: Date;
  paymentMethod?: string;
  pdfURL?: string;
}

export interface SalaryAdvance {
  id: string;
  workerId: string;
  workerName: string;
  amount: number;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  processedAt?: Date;
  approverId?: string;
  approverName?: string;
  rejectionReason?: string;
  tenantId: string;
}

export interface DailyTalk {
  id: string;
  tenantId: string;
  obra: string;
  fecha: Date | string;
  expositorId: string;
  expositorName: string;
  temas: string;
  asistentes: {
    id: string;
    name: string;
    rut?: string;
    signed: boolean;
    signedAt: Date | string | null;
    signature?: string | null;
  }[];
  firma: string; // dataURL
  foto?: string; // dataURL
  createdAt: Date | string;
}


export interface WorkItem {
  id: string;
  tenantId: string;
  projectId: string; // Main obra ID
  name: string;
  type: 'project' | 'phase' | 'subphase' | 'activity' | 'task';
  status: 'in-progress' | 'pending-quality-review' | 'completed' | 'rejected';
  parentId: string | null;
  path: string; // e.g., '01/02/03'
  progress: number; // 0-100
  plannedStartDate?: Date | null;
  plannedEndDate?: Date | null;
  actualStartDate?: Date | null;
  actualEndDate?: Date | null;
  unit: string; // e.g., m2, m3, und
  quantity: number;
  unitPrice: number;
  assignedTo?: string | null;
  createdBy?: string;
  rejectionReason?: string | null;
}

export interface PaymentState {
  id: string;
  contractorId: string;
  contractorName: string;
  createdAt: Date | string;
  totalValue: number;
  earnedValue: number;
  status: 'pending' | 'approved' | 'paid';
  items: WorkItem[];
  tenantId: string;
}

export interface ProgressLog {
  id: string;
  tenantId: string;
  workItemId: string;
  date: Date | string;
  quantity: number;
  userId: string;
  userName: string;
  observations?: string;
  photoUrl?: string;
}


// This is a client-side only type, not stored in DB
export interface Checklist {
  id: string;
  title: string;
  items: {
    element: string;
    checked: boolean;
  }[];
  createdBy: string;
}

export const WORK_SCHEDULE = {
  weekdays: {
    start: '08:00',
    end: '18:00',
  },
  friday: {
    start: '08:00',
    end: '17:00',
  },
  saturday: {
    start: '08:00',
    end: '13:00',
  },
  lunchBreak: {
    start: '13:00',
    end: '14:00',
  },
};

