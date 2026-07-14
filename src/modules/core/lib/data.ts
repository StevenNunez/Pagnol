
"use client";

export type FieldValue = any;

export type UserRole = "administrador" | "director-faena" | "jefe-turno" | "jefe-mantencion" | "geologo" | "topografo" | "supervisor" | "operador" | "apr" | "guardia" | "finance" | "super-admin" | "panolero" | "cphs" | "jefe-terreno" | "quality" | "jefe-oficina-tecnica" | "contratista" | "recursos-humanos" | "jefe-operaciones" | "adc" | "gerente-general" | "soporte-pagnol" | "abastecimiento";

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
  logoUrl?: string;
  // Prefijo base para los correlativos internos (Configuración de App).
  // Vacío = se derivan las iniciales del nombre (comportamiento histórico).
  codePrefix?: string;
  // Override de prefijo POR TIPO de documento ({ "PUR": "OC", "REC": "REC", ... }).
  // Tiene prioridad sobre codePrefix; tipo sin override hereda el prefijo base.
  codePrefixes?: Record<string, string>;
  // Override de la ETIQUETA de tipo (segmento visible) por documento
  // ({ "PUR": "OC", ... }). No afecta el contador (clave interna estable).
  codeTypes?: Record<string, string>;
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
  // Ficha RRHH
  address?: string;
  birthDate?: Date | string | null;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  employmentStatus?: 'active' | 'on_leave' | 'terminated';
}

export type LeaveType = 'vacation' | 'sick_leave' | 'permit' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequest {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  type: LeaveType;
  startDate: Date | string;
  endDate: Date | string;
  daysCount: number;
  reason?: string | null;
  status: LeaveStatus;
  supportingDocumentUrl?: string | null;
  reviewedBy?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: Date | string | null;
  rejectionReason?: string | null;
  createdAt: Date | string;
}

export type HRDocumentType = 'contract' | 'certificate' | 'license' | 'exam' | 'other';

export interface HRDocument {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  documentType: HRDocumentType;
  name: string;
  fileUrl?: string | null;
  filePath?: string | null;
  issueDate?: Date | string | null;
  expiryDate?: Date | string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: Date | string;
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
  // Jerarquía de 2 niveles: NULL = familia (nivel superior); con valor =
  // subcategoría de esa familia (ej: Herramientas → Herramientas Eléctricas).
  parentId?: string | null;
}

// Catálogos de precarga para Reportes de Trabajo (OT). Name-only, tenant-scoped.
export interface WorkReportArea {
  id: string;
  name: string;
}
export interface WorkReportSpecialty {
  id: string;
  name: string;
}
export interface WorkReportMilestone {
  id: string;
  name: string;
}

// Catálogo genérico de precarga (cliente, contrato, ubicación, turno, jornada…).
export type WorkReportCatalogKind = 'client' | 'contract' | 'location' | 'shift' | 'workschedule';
export interface WorkReportCatalogItem {
  id: string;
  kind: WorkReportCatalogKind;
  name: string;
}

export interface Material {
  id: string;
  name: string;
  stock: number;
  inUse?: number;
  minStock?: number; // Umbral de stock crítico (alertas Panel Reportes). undefined = sin umbral.
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
  requiresMaintenance?: boolean; // ¿el activo lleva plan de mantenimiento? (herramientas menores/consumibles: no)
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

  // Origen del activo. 'arrendado' = espejo de un equipo de arriendo (rental_assets),
  // creado al confirmar la OC; conserva el vínculo al contrato y al activo de arriendo.
  // 'cliente' = suministrado por el cliente del contrato (comodato — se devuelve al
  // cierre); su stock vive en una fila SEPARADA del propio, nunca se mezclan.
  // 'subcontrato' = reservado para material de subcontratistas (sin UI aún).
  ownership?: 'propio' | 'arrendado' | 'cliente' | 'subcontrato';
  rentalContractId?: string | null;
  rentalAssetId?: string | null;
  // Dueño del activo cuando ownership='cliente' (FK a clients).
  clientId?: string | null;
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
  contractId?: string | null;
  contractName?: string | null;
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
  // Gate de autorización del Administrador de Contratos (ADC). NULL = por autorizar.
  adcAuthorizedAt?: Date | string | null;
  adcAuthorizedById?: string | null;
  // ── Beneficiario (quién retira, distinto de quién solicita) ──
  // 'self' = retira el solicitante | 'directed' = dirigida a beneficiaryId |
  // 'open' = retiro abierto (el receptor se registra al entregar).
  deliveryMode?: 'self' | 'directed' | 'open';
  beneficiaryId?: string | null;
  beneficiaryName?: string | null;
  // Receptor real verificado (biometría/QR) al momento de la entrega.
  receivedByUserId?: string | null;
  receivedByUserName?: string | null;
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
  // Contrato del que salió el material (la devolución reingresa ahí)
  contractId?: string | null;
  contractName?: string | null;
}

export type PurchaseRequestStatus = "pending" | "approved" | "rejected" | "received" | "ordered" | "batched";

export interface PurchaseRequest {
  id: string;
  // Código legible (ej. "PAG-PRQ-0007"); `id` es el uuid real de la fila.
  // undefined en filas creadas antes de la migración 20260710010000.
  internalCode?: string;
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
  contractId?: string | null;
  contractName?: string | null;
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
  // Gate de autorización del Administrador de Contratos (ADC). NULL = por autorizar.
  adcAuthorizedAt?: Date | string | null;
  adcAuthorizedById?: string | null;
  // Correlaciona ítems enviados juntos desde el mismo carrito. NULL = solicitud suelta.
  batchId?: string | null;
  // Destino de la solicitud: 'supplier' (compra normal, histórico) o 'client'
  // (suministro del cliente del contrato — Valar↔Novandino). Con 'client', el
  // flujo es solicitud → ADC autoriza → supervisor envía correo al cliente →
  // recepción materializa el ítem como activo ownership='cliente'.
  requestTarget?: 'supplier' | 'client';
  clientId?: string | null;
  clientName?: string | null;
  sentToClientAt?: Date | string | null;
  sentToClientEmail?: string | null;
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

export type ShiftType = '5x2' | '4x3' | '4x4' | '7x7' | '10x10' | '14x14' | '21x7' | 'custom';

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

// Cliente de la empresa (jerarquía: Empresa/tenant → Cliente → Contratos).
// Ej: Valar tiene como clientes a Novandino, QPL, SQM; cada uno con sus contratos.
export interface Client {
  id: string;
  tenantId: string;
  name: string;
  rut?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  status: 'active' | 'inactive';
  createdAt: Date;
}

/**
 * Naturaleza del contrato:
 * - 'client'   — contrato con un mandante externo (Torres, Novandino…).
 * - 'internal' — Área Interna: estructura propia de la empresa (Administración,
 *   Finanzas, Abastecimiento…). Sin cliente. Existe para que su personal, su
 *   stock y sus pañoles tengan un dueño real en vez de caer al pool central,
 *   que significa "sin asignar" (limbo), no "de la empresa".
 */
export type ContractKind = 'client' | 'internal';

export interface Contract {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
  kind: ContractKind;
  clientId?: string | null; // FK a Client (la fuente de verdad). Siempre null si kind='internal'.
  clientName?: string; // legacy: string suelto pre-entidad Cliente (solo lectura)
  location?: string;
  status: 'active' | 'closed' | 'suspended';
  startDate: Date | string;
  endDate?: Date | string | null;
  description?: string;
  /** Presupuesto de compras del área/contrato (entidad aparte: cost_centers). */
  costCenterId?: string | null;
  createdBy?: string;
  createdAt: Date;
  // Subcontratistas
  isSubcontractor?: boolean;
  parentContractId?: string | null;
  subcontractorCompany?: string | null;
  subcontractorRut?: string | null;
}

/** Un Área Interna es un contrato sin mandante: estructura propia de la empresa. */
export const isInternalArea = (c: Contract) => c.kind === 'internal';
/** Contrato con mandante externo (lo que históricamente se llamó "contrato"). */
export const isClientContract = (c: Contract) => c.kind !== 'internal';

export interface ContractWorker {
  id: string;
  tenantId: string;
  contractId: string;
  userId: string;
  shiftScheduleId?: string | null;
  roleInContract?: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  /** Día 1 del ciclo de rotación de ESTE trabajador (fecha de subida).
   *  null = hereda rotationReferenceDate del turno. YYYY-MM-DD. */
  rotationStartDate?: string | null;
  createdAt: Date;
}

// ── Pañoles y existencias por contrato ───────────────────────────────────────

export interface Warehouse {
  id: string;
  tenantId: string;
  name: string;
  location?: string | null;
  managerId?: string | null;   // encargado (panolero) → profiles.id
  managerName?: string | null;
  status: 'active' | 'inactive';
  notes?: string | null;
  createdAt: Date;
}

/** N:M — contratos que atiende cada pañol. */
export interface WarehouseContract {
  id: string;
  tenantId: string;
  warehouseId: string;
  contractId: string;
  createdAt: Date;
}

/**
 * Desglose de existencias de un material por contrato × pañol.
 * `materials.stock` sigue siendo el TOTAL; esto dice dónde están sus unidades.
 * contractId NULL = pool central de la empresa; warehouseId NULL = sin pañol.
 */
export interface MaterialStock {
  id: string;
  tenantId: string;
  materialId: string;
  contractId: string | null;
  warehouseId: string | null;
  qty: number;
}

// ── Arriendos (Rentals) ──────────────────────────────────────────────────────

/** incoming = arrendamos DE un proveedor; outgoing = arrendamos A un cliente. */
export type RentalDirection = 'incoming' | 'outgoing';
/** lessor = arrendador/proveedor; client = cliente al que arrendamos. */
export type RentalPartyType = 'lessor' | 'client';
export type RentalBillingCycle = 'monthly' | 'biweekly' | 'weekly' | 'daily' | 'one_time';
// Antes era un enum cerrado; ahora es texto libre: un slug por defecto
// (RENTAL_CATEGORY_DEFAULTS) o el nombre de una categoría custom (tabla rental_categories).
export type RentalAssetCategory = string;

/** Categoría de arriendo personalizable por tenant (tabla rental_categories). */
export interface RentalCategory {
  id: string;
  name: string;
}

/** Categorías por defecto (en código); se fusionan con las custom del tenant en la UI. */
export const RENTAL_CATEGORY_DEFAULTS: { value: string; label: string }[] = [
  { value: 'machinery', label: 'Maquinaria' },
  { value: 'truck', label: 'Camión / Camión pluma' },
  { value: 'vehicle', label: 'Vehículo' },
  { value: 'measurement', label: 'Medición / Topografía' },
  { value: 'other', label: 'Otro (andamios, generadores, etc.)' },
];

const RENTAL_CATEGORY_DEFAULT_LABELS: Record<string, string> =
  Object.fromEntries(RENTAL_CATEGORY_DEFAULTS.map((c) => [c.value, c.label]));

/** Etiqueta legible de una categoría: usa el label del default, o el valor crudo (categoría custom). */
export function rentalCategoryLabel(value: string | undefined | null): string {
  if (!value) return '—';
  return RENTAL_CATEGORY_DEFAULT_LABELS[value] || value;
}
export type RentalContractStatus = 'active' | 'pending' | 'finished' | 'cancelled';
export type RentalPaymentStatus = 'pending' | 'paid' | 'overdue';
/** Sub-estado de la Orden de Compra del arriendo (independiente del status del contrato). */
export type RentalOcStatus = 'pending' | 'sent' | 'confirmed';

export interface RentalParty {
  id: string;
  tenantId: string;
  name: string;
  partyType: RentalPartyType;
  rut?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  bank?: string;
  accountType?: string;
  accountNumber?: string;
  notes?: string;
  createdAt: Date;
}

export interface RentalContract {
  id: string;
  tenantId: string;
  code?: string;
  direction: RentalDirection;
  partyId: string;
  title: string;
  status: RentalContractStatus;
  startDate: Date | string;
  endDate?: Date | string | null;
  billingCycle: RentalBillingCycle;
  amount: number;           // monto NETO por ciclo (se le aplica taxRate)
  currency: string; // 'CLP' | 'UF' | 'USD'
  paymentDay?: number | null; // día del mes (1-31) para mensual
  taxRate?: number;         // % IVA aplicado (19 por defecto; 0 = exento)
  notes?: string;
  // ── Orden de Compra (OC) del arriendo ──
  ocNumber?: string;
  ocStatus?: RentalOcStatus;          // pending → sent → confirmed
  ocSentAt?: Date | string | null;
  ocConfirmedAt?: Date | string | null;
  paymentTermsDays?: number;          // plazo de pago: 1er venc. = confirmación OC + N días
  createdBy?: string;
  createdAt: Date;
}

export interface RentalAsset {
  id: string;
  tenantId: string;
  contractId: string;
  name: string;
  category: RentalAssetCategory;
  identifier?: string; // patente / nº de serie
  quantity: number;
  unitPrice?: number;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  status: 'active' | 'returned';
  notes?: string;
  createdAt: Date;
}

export interface RentalPayment {
  id: string;
  tenantId: string;
  contractId: string;
  dueDate: Date | string;
  amount: number;
  status: RentalPaymentStatus;
  paidDate?: Date | string | null;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  createdAt: Date;
}

// ── Solicitud de Arriendo + RFQ de Arriendo ──────────────────────────────────
// Conecta el flujo de Abastecimiento con el módulo de Arriendos. Terreno solicita
// un arriendo (equipo + período), Abastecimiento cotiza a arrendadores y, al
// adjudicar, se genera el RentalContract + RentalAsset + 1er RentalPayment.

export type RentalRequestStatus = 'pending' | 'quoting' | 'approved' | 'rejected' | 'fulfilled';

/** Línea de equipo dentro de una solicitud de arriendo (carrito multi-ítem). */
export interface RentalRequestItem {
  name: string;
  category: RentalAssetCategory;
  quantity: number;
}

export interface RentalRequest {
  id: string;
  tenantId: string;
  internalCode?: string;
  // Carrito de equipos del pedido. El mapper SIEMPRE lo entrega poblado
  // (cae al ítem único legacy si la fila no tiene items[]).
  items: RentalRequestItem[];
  // Espejo del primer ítem (compat con filas/consumidores antiguos mono-ítem).
  equipmentName: string;
  category: RentalAssetCategory;
  quantity: number;
  startDate?: string | null;     // ISO date
  endDate?: string | null;       // ISO date
  billingCycleEstimate: RentalBillingCycle;
  contractId?: string | null;    // obra/contrato (tabla contracts)
  contractName?: string | null;
  area?: string;                 // detalle / ubicación
  justification?: string;
  supervisorId: string;
  supervisorName?: string;
  status: RentalRequestStatus;
  approverId?: string;
  approverName?: string;
  approvalDate?: Date;
  rejectionDate?: Date;
  rejectionReason?: string;
  rentalContractId?: string | null; // contrato de arriendo generado al fulfillar
  notes?: string;
  createdAt: Date;
  // Gate de autorización del Administrador de Contratos (ADC). NULL = por autorizar.
  adcAuthorizedAt?: Date | string | null;
  adcAuthorizedById?: string | null;
}

export interface RentalQuoteItem {
  id: string;                 // id de la rental_request de origen (o generado)
  name: string;
  category: RentalAssetCategory;
  quantity: number;
  startDate?: string | null;
  endDate?: string | null;
  billingCycle: RentalBillingCycle;
}

/** Línea de cotización por ítem del RFQ (precio de un equipo específico). */
export interface RentalQuoteLine {
  itemId: string;             // id del RentalQuoteItem del RFQ al que corresponde
  matchedName?: string;       // nombre tal como aparece en el PDF del arrendador (verificación)
  pricePerPeriod: number;     // precio por período de este equipo
  quantity?: number;          // cantidad cotizada
  periods?: number;           // nº de períodos
  total?: number;             // total de la línea (pricePerPeriod * quantity * periods)
  notes?: string;
}

export interface RentalQuoteResponse {
  id: string;
  partyId: string;            // arrendador (rental_parties tipo 'lessor')
  partyName: string;
  pricePerPeriod: number;     // precio por período TOTAL (suma de líneas) — compat comparador/adjudicación
  billingCycle: RentalBillingCycle;
  periods?: number;           // nº de períodos estimados
  totalEstimate?: number;     // total estimado (suma de líneas o pricePerPeriod * periods)
  lines?: RentalQuoteLine[];  // desglose por ítem (extraído del PDF con IA o ingresado a mano)
  extractedByAi?: boolean;    // true si los datos vinieron de extracción automática del PDF
  availabilityDate?: string;  // desde cuándo hay disponibilidad (ISO)
  conditions?: string;        // incluye traslado / operador / combustible, etc.
  validityDate?: string;      // validez de la oferta (ISO)
  attachmentUrl?: string;     // adjunto del arrendador (bucket privado)
  attachmentPath?: string;
  attachmentName?: string;
  notes?: string;
  createdAt: string;          // ISO
  createdBy?: string;
}

export type RentalQuoteRequestStatus = 'draft' | 'sent' | 'closed' | 'awarded' | 'cancelled';

export interface RentalQuoteRequest {
  id: string;
  tenantId: string;
  internalCode?: string;
  title: string;
  status: RentalQuoteRequestStatus;
  requestIds: string[];          // rental_requests incluidas
  items: RentalQuoteItem[];
  partyIds: string[];            // arrendadores invitados
  responses: RentalQuoteResponse[];
  deadline?: string;             // ISO date — fecha límite de respuesta
  notes?: string;
  awardedPartyId?: string;
  awardedQuoteId?: string;
  awardedAt?: string;
  rentalContractId?: string;     // contrato de arriendo generado al adjudicar
  createdBy?: string;
  createdByName: string;
  createdAt: Date;
  updatedAt?: Date;
}

// Work Reports / Informes de Terreno
export type WorkReportStatus =
  | 'draft'
  | 'pending_review'
  | 'observed'
  | 'operations_approved'
  | 'final_approved'
  | 'archived';

export type WorkExecutionStatus = 'not_started' | 'in_progress' | 'suspended' | 'finished';

// OT trabajada en el reporte del día. Su `id` (estable) es la clave de las
// horas en la matriz HH y, a futuro, de fotos/actividades. Define las columnas
// dinámicas de la matriz de personal.
export interface WorkReportDailyOt {
  id: string;
  otNumber: string;      // ej. "SER-07887"
  description?: string;
}

// Actividad ejecutada del día (reemplaza el textarea libre). Cada fila alimenta
// la tabla de actividades del PDF SQM. `otId` referencia un WorkReportDailyOt.id
// (igual que la matriz HH); build-report-data lo traduce al número de OT.
export interface WorkReportActivity {
  id: string;
  description: string;
  area?: string;
  unit?: string;             // unidad (m2, ml, un, etc.)
  plannedQuantity?: number;  // cantidad programada
  quantity?: number;         // cantidad ejecutada
  otId?: string;             // clave de WorkReportDailyOt
  progress?: number;         // % avance de la actividad
}

export interface WorkReportLaborItem {
  id: string;
  workerId?: string | null;
  name: string;
  role: string;                   // cargo
  absenceReason?: string;         // causa/motivo de ausencia
  hours: Record<string, number>;  // clave = WorkReportDailyOt.id → horas en esa OT
  colacion?: number;
  documentacion?: number;
  traslados?: number;
  overtimeHours?: number;         // horas extra (hext)
  // subtotal HH y total son DERIVADOS (no se almacenan).
}

export interface WorkReportEquipmentItem {
  id: string;
  equipmentId?: string | null;   // FK al activo del catálogo (Material) si se eligió
  code?: string;                 // código interno (Material.internalCode) o manual
  equipment: string;
  type: string;
  hours: number;
  activity: string;
}

// Interferencia / improductividad del día (tabla de la página 3 del PDF SQM).
// `otId` referencia un WorkReportDailyOt.id (build-report-data lo traduce al N° OT).
// Total HH es DERIVADO (hours × workerCount); no se almacena.
export interface WorkReportInterference {
  id: string;
  otId?: string;
  reason: string;        // motivo
  responsible?: string;  // responsable
  hours?: number;        // horas perdidas
  workerCount?: number;  // N° de trabajadores afectados
}

export interface WorkReportMaterialItem {
  id: string;
  materialId?: string | null;
  material: string;
  unit: string;
  quantity: number;
  observations?: string;   // columna "Observaciones" del PDF SQM
}

// Programación del día siguiente (tabla de la página 3 del PDF SQM). Texto libre.
export interface WorkReportNextDayPlan {
  id: string;
  description: string;   // descripción de actividades
  area?: string;
  equipment?: string;    // equipos a ocupar (texto libre)
  tools?: string;        // herramienta mayor a ocupar (texto libre)
}

// Housekeeping (página 4 del PDF SQM): checklist de cumplimientos + checklist
// del jefe de operaciones + observaciones + 4 fotos. Los textos de los ítems son
// estándar (ver work-report-housekeeping.ts); el usuario marca estado/obs.
export type HousekeepingStatus = '' | 'cumple' | 'nocumple' | 'na';

export interface WorkReportHousekeepingItem {
  id: string;
  text: string;
  status?: HousekeepingStatus;
  photo?: string;         // foto opcional por punto (solo checklist principal); reemplaza al antiguo "responsable"
  observations?: string;
}

export interface WorkReportHousekeeping {
  subtitle?: string;
  code?: string;          // ej. PRO-SM-SQM-HK
  rev?: string;           // ej. REV. 0
  sector?: string;
  inspection?: string;    // ej. "18:20 – 18:30 · 25-04-2026"
  items: WorkReportHousekeepingItem[];
  observations?: string;
  photos: string[];       // hasta 4 URLs
  jefeItems: WorkReportHousekeepingItem[];
}

export interface WorkReportPhoto {
  id: string;
  url: string;
  path?: string;
  description: string;
  date: string;
  userId: string;
  userName: string;
  otId?: string;       // OT a la que pertenece la foto (WorkReportDailyOt.id)
  executor?: string;   // ejecutor del trabajo fotografiado
  approver?: string;   // visado / revisado por
  // Offline (Fase 4): mientras la foto no se sube, se referencia el Blob local
  // guardado en IndexedDB; `pending` marca que falta sincronizar al servidor.
  localBlobId?: string;
  pending?: boolean;
}

export interface WorkReportProgressEntry {
  id: string;
  percent: number;
  status: WorkExecutionStatus;
  observations?: string;
  date: string;
  userId: string;
  userName: string;
}

export interface WorkReportSignature {
  id: string;
  step: 'supervisor' | 'operations' | 'final';
  userId: string;
  userName: string;
  userRole: string;
  signature: string;
  date: string;
  action: string;
  notes?: string;
}

export interface WorkReportAuditEntry {
  id: string;
  action: string;
  fromStatus?: WorkReportStatus | null;
  toStatus?: WorkReportStatus | null;
  userId: string;
  userName: string;
  date: string;
  notes?: string;
}

export interface WorkReport {
  id: string;
  tenantId: string;
  internalCode: string;
  status: WorkReportStatus;
  workItemId?: string | null;
  otNumber: string;
  client: string;
  faena: string;
  area: string;
  supervisorId: string;
  supervisorName: string;
  workDate: Date | string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  // Cabecera SQM (parte superior de las 4 páginas)
  obra?: string | null;
  contractNumber?: string | null;   // N° CTTO
  addendumNumber?: string | null;
  shift?: string | null;            // turno (ej. 39/44)
  specialty?: string | null;        // especialidad
  emittedBy?: string | null;
  emittedByRole?: string | null;    // cargo emisor
  workSchedule?: string | null;     // jornada (ej. 7x7)
  dayNight?: string | null;         // Diurno / Nocturno
  lunchStart?: string | null;       // hora almuerzo
  restartTime?: string | null;      // hora reinicio
  activities: string;                       // legacy: descripción libre (fallback)
  structuredActivities: WorkReportActivity[];
  dailyOts: WorkReportDailyOt[];
  consolidatedOrderIds: string[];           // OT (work_orders) que este Diario consolida
  // Copia congelada de las OT consolidadas, tomada al enviar a revisión
  // (pending_review). Evita que una edición posterior de la OT altere
  // retroactivamente un Diario ya firmado/aprobado. Se deriva en vivo de
  // `workOrders` mientras está en borrador/observado, o si el Diario se envió
  // a revisión antes de que existiera este campo (sin snapshot histórico).
  consolidatedOrdersSnapshot?: WorkOrder[] | null;
  labor: WorkReportLaborItem[];
  equipment: WorkReportEquipmentItem[];
  interferences: WorkReportInterference[];
  materials: WorkReportMaterialItem[];
  nextDayPlan: WorkReportNextDayPlan[];
  housekeeping?: WorkReportHousekeeping;
  photos: WorkReportPhoto[];
  progressPercent: number;
  executionStatus: WorkExecutionStatus;
  progressObservations?: string | null;
  progressHistory: WorkReportProgressEntry[];
  signatures: WorkReportSignature[];
  auditLog: WorkReportAuditEntry[];
  rejectionReason?: string | null;
  sentTo?: string[] | null;
  createdBy: string;
  createdByName: string;
  updatedBy?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  submittedAt?: Date | string | null;
  operationsApprovedAt?: Date | string | null;
  finalApprovedAt?: Date | string | null;
}

// ── OT / Reporte de Trabajo (entidad granular de la cascada) ─────────────────
// Formulario rápido del supervisor. Personal SOLO nombre/cargo/horas (sin
// colación/doc/traslados). Alimenta el Reporte Diario (consolidado).
export type WorkOrderStatus = 'draft' | 'ready';

export interface WorkOrderLaborItem {
  id: string;
  name: string;
  role: string;
  hours: number;
  userId?: string;         // Ref. a profiles.id cuando se selecciona del catálogo de usuarios
}

export interface WorkOrderEquipmentItem {
  id: string;
  equipment: string;
  hours: number;
  assetId?: string;        // Ref. a materials.id cuando se selecciona del catálogo de activos
}

export interface WorkOrderMaterialItem {
  id: string;
  material: string;        // Nombre del material (texto libre o tomado del catálogo)
  materialId?: string;     // Ref. al catálogo (materials.id) para costo exacto; opcional
  quantity: number;
  unit?: string;
}

export interface WorkOrder {
  id: string;
  tenantId: string;
  otNumber: string;
  otNumberSource: 'auto' | 'manual';  // 'auto' = correlativo del tenant (bloqueado); 'manual' = lo asigna el cliente
  client: string;
  contractNumber?: string | null;
  area?: string | null;
  location?: string | null;
  specialty?: string | null;
  milestone?: string | null;
  supervisorId?: string | null;
  supervisorName: string;
  shift?: string | null;
  workSchedule?: string | null;
  workDate: Date | string;
  description: string;
  labor: WorkOrderLaborItem[];
  equipment: WorkOrderEquipmentItem[];
  materials: WorkOrderMaterialItem[];
  photos: WorkReportPhoto[];
  plannedPercent: number;
  executedPercent: number;
  status: WorkOrderStatus;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type WorkWeeklyReportStatus = 'draft' | 'ready';

// Reporte Semanal (cascada, Fase 3): consolida varios Reportes Diarios
// (work_reports) en un rango de fechas. consolidatedReportIds = IDs de los
// diarios que agrupa; el resumen (HH totales, OT, por día) se deriva de ellos.
export interface WorkWeeklyReport {
  id: string;
  tenantId: string;
  title: string;
  client: string;
  faena: string;
  obra?: string | null;
  contractNumber?: string | null;
  area?: string | null;
  specialty?: string | null;
  supervisorId?: string | null;
  supervisorName: string;
  startDate: Date | string;
  endDate: Date | string;
  consolidatedReportIds: string[];
  // Copia congelada de los Diarios consolidados, tomada al firmar como
  // supervisor (status -> 'ready'). Evita que el Semanal cambie
  // retroactivamente si alguien reabre/edita un Diario después de firmado.
  consolidatedReportsSnapshot?: WorkReport[] | null;
  observations?: string | null;
  shiftHandover?: string | null;
  signatures: WorkReportSignature[];
  status: WorkWeeklyReportStatus;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface SupplierContact {
  id: string;
  name: string;
  role?: string;       // Cargo / rol comercial
  email?: string;
  phone?: string;
  isPrimary?: boolean; // Contacto principal
}

export interface SupplierDocument {
  id: string;
  name: string;
  /** Tipo: Tributario, Bancario, Contrato, Certificado, Seguro, Otro */
  type?: string;
  url: string;         // URL firmada (bucket privado)
  path: string;        // Ruta en storage: {tenantId}/{supplierId}/{docId}.ext
  uploadedAt: string;  // ISO
  uploadedBy?: string;
  expiresAt?: string;  // ISO, para documentos con vencimiento (seguros, certificados)
}

export interface SupplierEvaluation {
  id: string;
  date: string;        // ISO
  userId?: string;
  userName?: string;
  quality: number;     // 1-5 — Calidad del producto/servicio
  delivery: number;    // 1-5 — Cumplimiento de plazos
  price: number;       // 1-5 — Competitividad de precios
  service: number;     // 1-5 — Atención / postventa
  comment?: string;
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
  contacts?: SupplierContact[];
  documents?: SupplierDocument[];
  evaluations?: SupplierEvaluation[];
  costCenterId?: string;
  notes?: string;
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
  costCenterId?: string | null; // Imputación de costo (F4)
  tenantId: string;
}

// ── Centros de Costo (F4) ────────────────────────────────────────────────────
export type CostCenterType = 'Operaciones' | 'Mantención' | 'Ingeniería' | 'TI' | 'Administración' | 'Abastecimiento';

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  type: CostCenterType;
  budget: number;             // Presupuesto asignado
  status: 'active' | 'closed';
  responsibleId?: string;
  responsibleName?: string;
  startDate?: string;         // ISO date
  endDate?: string;           // ISO date
  notes?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt?: Date;
  tenantId: string;
}

export interface StockMovement {
  id: string;
  materialId: string;
  materialName: string;
  quantityChange: number; // Positive for entry, negative for exit
  newStock: number;
  type: 'manual-entry' | 'initial' | 'request-delivery' | 'return-reentry' | 'adjustment' | 'contract-transfer';
  date: Date;
  justification: string;
  userId: string; // User who performed the action
  userName: string;
  relatedRequestId?: string;
  // Dimensión contrato/pañol (null = pool central / sin pañol)
  contractId?: string | null;
  contractName?: string | null;
  warehouseId?: string | null;
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

// ── RFQ (Cotizaciones) ───────────────────────────────────────────────────────
export type QuoteRequestStatus = 'draft' | 'sent' | 'closed' | 'awarded' | 'cancelled';

export interface QuoteItem {
  id: string;          // id de la purchase_request de origen (o generado)
  name: string;
  unit: string;
  quantity: number;
  category?: string;
}

export interface QuoteItemPrice {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface QuoteResponse {
  id: string;
  supplierId: string;
  supplierName: string;
  totalPrice: number;            // Obligatorio
  deliveryDays: number;          // Plazo de entrega (días) — obligatorio
  warranty: string;              // Garantía — obligatorio
  commercialConditions: string;  // Condiciones comerciales — obligatorio
  validityDate?: string;         // Validez de la oferta (ISO date)
  itemPrices?: QuoteItemPrice[]; // Detalle por ítem (opcional)
  attachmentUrl?: string;        // Adjunto del proveedor (bucket privado)
  attachmentPath?: string;
  attachmentName?: string;
  notes?: string;
  createdAt: string;             // ISO
  createdBy?: string;
}

export interface QuoteRequest {
  id: string;
  internalCode: string;
  title: string;
  status: QuoteRequestStatus;
  requestIds: string[];          // purchase_requests incluidas
  items: QuoteItem[];
  supplierIds: string[];         // proveedores invitados
  responses: QuoteResponse[];
  deadline?: string;             // ISO date — fecha límite de respuesta
  notes?: string;
  awardedSupplierId?: string;
  awardedQuoteId?: string;
  awardedAt?: string;
  purchaseOrderId?: string;
  createdBy?: string;
  createdByName: string;
  createdAt: Date;
  updatedAt?: Date;
  tenantId: string;
}

// ── Recepción de Mercadería (ligada a OC) ────────────────────────────────────
export interface ReceiptItem {
  itemId: string;          // id del ítem en la OC (o nombre normalizado)
  name: string;
  unit: string;
  orderedQuantity: number; // cantidad de la OC para este ítem
  receivedQuantity: number;// cantidad recibida en ESTE evento de recepción
  materialId?: string;     // material de bodega donde ingresó el stock
}

export interface ReceiptPhoto {
  id: string;
  url: string;             // URL firmada (bucket privado reception-photos)
  path: string;            // {tenantId}/{receiptId}/{photoId}.ext
  name?: string;
  date: string;            // ISO
}

export interface GoodsReceipt {
  id: string;
  internalCode: string;
  purchaseOrderId: string;
  purchaseOrderCode: string;
  supplierId?: string;
  supplierName: string;
  items: ReceiptItem[];
  photos: ReceiptPhoto[];
  notes?: string;
  receivedBy?: string;
  receivedByName: string;
  receivedAt: string;      // ISO
  createdAt: Date;
  tenantId: string;
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
