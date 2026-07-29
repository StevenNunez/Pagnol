
import {
  User,
  Material,
  Tool,
  FinanceCategory,
  FinanceBudgetEntry,
  FinancePeriodEvent,
  EmploymentContract,
  MaterialRequest,
  ReturnRequest,
  PurchaseRequest,
  Supplier,
  SupplierDocument,
  QuoteRequest,
  QuoteResponse,
  QuoteItem,
  GoodsReceipt,
  ReceiptItem,
  ReceiptPhoto,
  CostCenter,
  MaterialCategory,
  Unit,
  PurchaseLot,
  PurchaseOrder,
  SupplierPayment,
  SalaryAdvance,
  AttendanceLog,
  AssignedSafetyTask,
  SafetyInspection,
  ChecklistTemplate,
  BehaviorObservation,
  StockMovement,
  UserRole,
  Tenant,
  WorkItem,
  ProgressLog,
  PaymentState,
  DailyTalk,
  MaintenanceOrder,
  MaintenanceLog,
  EADocument,
  ProtocolTemplate,
  Protocol,
  ProtocolSignature,
  ShiftSchedule,
  Client,
  Contract,
  ContractWorker,
  Warehouse,
  WarehouseContract,
  MaterialStock,
  ScanResult,
  RentalParty,
  RentalContract,
  RentalAsset,
  RentalPayment,
  RentalRequest,
  RentalCategory,
  RentalQuoteRequest,
  RentalQuoteItem,
  RentalQuoteResponse,
  RentalAssetCategory,
  RentalBillingCycle,
  WorkReport,
  WorkReportPhoto,
  WorkReportSignature,
  WorkReportStatus,
  LeaveRequest,
  LeaveStatus,
  HRDocument,
  WorkReportArea,
  WorkReportSpecialty,
  WorkReportMilestone,
  WorkReportCatalogItem,
  WorkReportCatalogKind,
  WorkOrder,
  WorkWeeklyReport,
} from '../core/lib/data';
import { ROLES as ROLES_DEFAULT, Permission, PLANS } from '@/modules/core/lib/permissions';

export interface AppDataState {
  isLoading: boolean;
  roles: typeof ROLES_DEFAULT;
  subscriptionPlans: typeof PLANS;
  users: User[];
  materials: Material[];
  tools: Tool[];
  requests: MaterialRequest[];
  returnRequests: ReturnRequest[];
  purchaseRequests: PurchaseRequest[];
  suppliers: Supplier[];
  materialCategories: MaterialCategory[];
  units: Unit[];
  purchaseLots: PurchaseLot[];
  purchaseOrders: PurchaseOrder[];
  quoteRequests: QuoteRequest[];
  goodsReceipts: GoodsReceipt[];
  costCenters: CostCenter[];
  supplierPayments: SupplierPayment[];
  salaryAdvances: SalaryAdvance[];
  attendanceLogs: AttendanceLog[];
  assignedChecklists: AssignedSafetyTask[];
  safetyInspections: SafetyInspection[];
  checklistTemplates: ChecklistTemplate[];
  behaviorObservations: BehaviorObservation[];
  stockMovements: StockMovement[];
  workItems: WorkItem[];
  progressLogs: ProgressLog[];
  paymentStates: PaymentState[];
  dailyTalks: DailyTalk[];
  maintenanceOrders: MaintenanceOrder[];
  maintenanceLogs: MaintenanceLog[];
  eaDocuments: EADocument[];
  protocolTemplates: ProtocolTemplate[];
  protocols: Protocol[];
  shiftSchedules: ShiftSchedule[];
  clients: Client[];
  contracts: Contract[];
  contractWorkers: ContractWorker[];
  warehouses: Warehouse[];
  warehouseContracts: WarehouseContract[];
  materialStocks: MaterialStock[];
  rentalParties: RentalParty[];
  rentalContracts: RentalContract[];
  rentalAssets: RentalAsset[];
  rentalPayments: RentalPayment[];
  rentalRequests: RentalRequest[];
  rentalQuoteRequests: RentalQuoteRequest[];
  rentalCategories: RentalCategory[];
  workReports: WorkReport[];
  leaveRequests: LeaveRequest[];
  hrDocuments: HRDocument[];
  workReportAreas: WorkReportArea[];
  workReportSpecialties: WorkReportSpecialty[];
  workReportMilestones: WorkReportMilestone[];
  workReportCatalogs: WorkReportCatalogItem[];
  workOrders: WorkOrder[];
  workWeeklyReports: WorkWeeklyReport[];
}

// This defines the shape of the context, including all functions
export interface AppStateContextType extends AppDataState {
  can: (permission: Permission) => boolean;
  notify: (message: string, variant?: "default" | "destructive" | "success") => void;
  refreshData: (collection?: keyof AppDataState) => void;
  currentTenant: Tenant | null;

  // Purchase Requests
  addPurchaseRequest: (data: Partial<Omit<PurchaseRequest, 'id' | 'status' | 'createdAt' | 'tenantId'>>) => Promise<void>;
  authorizePurchaseRequest: (requestId: string) => Promise<void>;
  updatePurchaseRequestStatus: (requestId: string, status: PurchaseRequest['status'], data: Partial<PurchaseRequest>) => Promise<void>;
  receivePurchaseRequest: (requestId: string, receivedQuantity: number, existingMaterialId?: string) => Promise<void>;
  markClientRequestsSent: (requestIds: string[], sentToEmail: string) => Promise<void>;
  deletePurchaseRequest: (requestId: string) => Promise<void>;
  cancelPurchaseOrder: (orderId: string) => Promise<void>;
  archiveLot: (requestIds: string[]) => Promise<void>;
  generatePurchaseOrder: (requests: PurchaseRequest[], supplierId: string, prices: Record<string, number>) => Promise<string>;
  createPurchaseOrder: (data: { lotId: string; ocNumber: string; items: { requestId: string; price: number; quantity: number; name: string; unit: string; }[]; totalAmount: number; }) => Promise<string>;
  returnToPool: (requestIds: string[]) => Promise<void>;

  // Material Requests
  addMaterialRequest: (data: { items: { materialId: string; quantity: number }[]; area: string; contractId?: string | null; contractName?: string | null; supervisorId: string; supervisorName?: string; highestClass?: 'A' | 'B' | 'C'; tenantPrefix?: string; deliveryMode?: 'self' | 'directed' | 'open'; beneficiaryId?: string | null; beneficiaryName?: string | null; }) => Promise<void>;
  addAndApproveMaterialRequest: (data: { items: { materialId: string; quantity: number }[]; area: string; contractId?: string | null; contractName?: string | null; supervisorId: string; contractUrl?: string | null; internalCode?: string; warehouseId?: string | null; }) => Promise<void>;
  authorizeMaterialRequest: (requestId: string) => Promise<void>;
  updateMaterialRequestStatus: (requestId: string, status: 'approved' | 'rejected') => Promise<void>;
  deliverApprovedMaterialRequest: (requestId: string, contractUrl: string | null, receiver: { id: string; name: string } | null) => Promise<void>;
  // Cada ítem lleva su propio contrato de reingreso (un mismo material puede
  // tener saldo pendiente en más de un contrato a la vez).
  addReturnRequest: (items: { materialId: string; quantity: number; materialName: string; unit: string; contractId?: string | null; contractName?: string | null }[], notes: string) => Promise<void>;
  addAndCompleteReturnRequest: (data: { items: { materialId: string; quantity: number; materialName: string; unit: string; condition: 'OK' | 'CON FALLA' | 'ROTO' }[]; notes: string; workerId: string; workerName: string; evidenceUrl?: string; contractId?: string | null; contractName?: string | null; warehouseId?: string | null; }) => Promise<void>;
  updateReturnRequestStatus: (requestId: string, status: 'completed' | 'rejected', additionalData?: { condition: 'OK' | 'CON FALLA' | 'ROTO', evidenceUrl?: string }) => Promise<void>;
  deleteMaterialRequest: (requestId: string) => Promise<void>;
  deleteReturnRequest: (requestId: string) => Promise<void>;

  // Generic CRUD
  addTenant: (data: any) => Promise<void>;
  addUser: (data: any) => Promise<any>;
  enrollUser: (userId: string, data: any) => Promise<any>;
  hrUpdateUser: (userId: string, data: any) => Promise<any>;
  updateUser: (userId: string, data: Partial<User>) => Promise<void>;
  updateUserPermissions: (userId: string, permissions: string[]) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  addMaterial: (data: any) => Promise<void>;
  updateMaterial: (materialId: string, data: Partial<Material>) => Promise<void>;
  deleteMaterial: (materialId: string, reason: string) => Promise<void>;
  addManualStockEntry: (materialId: string, quantity: number, justification: string) => Promise<void>;
  addMaterialCategory: (name: string, parentId: string | null) => Promise<void>;
  updateMaterialCategory: (id: string, data: { name?: string; parentId?: string | null }) => Promise<void>;
  deleteMaterialCategory: (id: string) => Promise<void>;
  addUnit: (name: string) => Promise<void>;
  deleteUnit: (id: string) => Promise<void>;
  addSupplier: (data: any) => Promise<Supplier>;
  updateSupplier: (id: string, data: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  uploadSupplierDocument: (supplierId: string, file: File, meta: { name: string; type?: string; expiresAt?: string }) => Promise<SupplierDocument>;
  deleteSupplierDocumentFile: (path: string) => Promise<void>;
  addQuoteRequest: (data: { title: string; requestIds: string[]; items: QuoteItem[]; supplierIds: string[]; deadline?: string; notes?: string }) => Promise<void>;
  updateQuoteRequest: (id: string, data: Partial<QuoteRequest>) => Promise<void>;
  deleteQuoteRequest: (id: string) => Promise<void>;
  sendQuoteRequest: (id: string) => Promise<void>;
  closeQuoteRequest: (id: string) => Promise<void>;
  addQuoteResponse: (rfqId: string, response: Omit<QuoteResponse, "id" | "createdAt" | "createdBy">) => Promise<void>;
  updateQuoteResponse: (rfqId: string, responseId: string, data: Partial<QuoteResponse>) => Promise<void>;
  deleteQuoteResponse: (rfqId: string, responseId: string) => Promise<void>;
  uploadQuoteAttachment: (rfqId: string, file: File) => Promise<{ url: string; path: string; name: string }>;
  awardQuote: (rfqId: string, quoteId: string) => Promise<string>;
  uploadReceptionPhoto: (purchaseOrderId: string, file: File) => Promise<ReceiptPhoto>;
  receiveGoodsReceipt: (data: { purchaseOrderId: string; items: ReceiptItem[]; photos: ReceiptPhoto[]; notes?: string }) => Promise<void>;
  deleteGoodsReceipt: (id: string) => Promise<void>;
  addCostCenter: (data: Partial<CostCenter>) => Promise<void>;
  updateCostCenter: (id: string, data: Partial<CostCenter>) => Promise<void>;
  deleteCostCenter: (id: string) => Promise<void>;
  assignOrderCostCenter: (orderId: string, costCenterId: string | null) => Promise<void>;
  createLot: (name: string) => Promise<void>;
  addRequestToLot: (requestId: string, lotId: string) => Promise<void>;
  removeRequestFromLot: (requestId: string) => Promise<void>;
  deleteLot: (lotId: string) => Promise<void>;
  updateTenant: (tenantId: string, data: Partial<Tenant>) => Promise<void>;

  // Work Items
  addWorkItem: (data: Omit<WorkItem, 'id' | 'tenantId' | 'progress' | 'path'>) => Promise<void>;
  updateWorkItem: (id: string, data: Partial<WorkItem>) => Promise<void>;
  deleteWorkItem: (id: string) => Promise<void>;
  seedExampleWorkItems: () => Promise<void>;
  addWorkItemProgress: (workItemId: string, quantity: number, date: Date, observations: string | undefined) => Promise<void>;
  submitForQualityReview: (workItemId: string) => Promise<void>;
  approveWorkItem: (workItemId: string) => Promise<void>;
  rejectWorkItem: (workItemId: string, reason: string) => Promise<void>;
  addPaymentState: (data: { workItemRootId: string; totalValue: number; earnedValue: number; items: WorkItem[] }) => Promise<string>;
  approvePaymentState: (id: string) => Promise<void>;
  markPaymentStatePaid: (id: string, paidDate: string) => Promise<void>;
  annulPaymentState: (id: string, reason: string) => Promise<void>;
  addBudgetEntry: (data: { contractId: string; category: Exclude<FinanceCategory, 'revenue'>; amountNet: number; reason: string }) => Promise<FinanceBudgetEntry>;
  addEmploymentContract: (data: Omit<EmploymentContract, 'id' | 'tenantId' | 'createdBy' | 'createdByName' | 'createdAt'>) => Promise<EmploymentContract>;
  closePeriod: (data: { month: string; reason?: string }) => Promise<FinancePeriodEvent>;
  reopenPeriod: (data: { month: string; reason: string }) => Promise<FinancePeriodEvent>;

  // Safety
  addChecklistTemplate: (template: Pick<ChecklistTemplate, 'title' | 'items'>) => Promise<void>;
  deleteChecklistTemplate: (templateId: string) => Promise<void>;
  assignChecklistToSupervisors: (template: ChecklistTemplate, supervisorIds: string[], workArea: string) => Promise<void>;
  completeAssignedChecklist: (checklist: AssignedSafetyTask) => Promise<void>;
  reviewAssignedChecklist: (checklistId: string, status: 'approved' | 'rejected', notes: string, signature: string) => Promise<void>;
  deleteAssignedChecklist: (checklistId: string) => Promise<void>;
  addSafetyInspection: (data: any) => Promise<void>;
  completeSafetyInspection: (inspectionId: string, data: any) => Promise<void>;
  reviewSafetyInspection: (inspectionId: string, status: 'approved' | 'rejected', notes: string, signature: string) => Promise<void>;
  addBehaviorObservation: (data: any) => Promise<void>;
  addDailyTalk: (data: Omit<DailyTalk, 'id' | 'createdAt' | 'tenantId'>) => Promise<void>;
  signDailyTalk: (talkId: string) => Promise<void>;

  // Attendance
  handleAttendanceScan: (qrCode: string) => Promise<ScanResult>;
  addManualAttendance: (userId: string, date: Date, time: string, type: 'in' | 'out') => Promise<void>;
  updateAttendanceLog: (logId: string, newTimestamp: Date, newType: 'in' | 'out', originalTimestamp: Date) => Promise<void>;
  deleteAttendanceLog: (logId: string) => Promise<void>;

  // Clientes (jerarquía: Empresa → Cliente → Contratos)
  addClient: (data: Omit<Client, 'id' | 'tenantId' | 'createdAt'>) => Promise<Client>;
  updateClient: (id: string, data: Partial<Client>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;

  // Contratos
  addContract: (data: Omit<Contract, 'id' | 'tenantId' | 'createdBy' | 'createdAt'>) => Promise<Contract>;
  updateContract: (id: string, data: Partial<Contract>) => Promise<void>;
  deleteContract: (id: string) => Promise<void>;
  addContractWorker: (contractId: string, userId: string, shiftScheduleId: string | null, roleInContract: string | undefined, rotationStartDate: string | null) => Promise<void>;
  removeContractWorker: (contractWorkerId: string) => Promise<void>;
  updateContractWorker: (id: string, data: Partial<ContractWorker>) => Promise<void>;

  // Pañoles y existencias por contrato
  addWarehouse: (data: { name: string; location?: string | null; managerId?: string | null; managerName?: string | null; notes?: string | null; contractIds?: string[] }) => Promise<Warehouse>;
  updateWarehouse: (id: string, data: Partial<Warehouse> & { contractIds?: string[] }) => Promise<void>;
  deleteWarehouse: (id: string) => Promise<void>;
  transferMaterialStock: (params: { materialId: string; qty: number; fromContractId: string | null; toContractId: string | null; warehouseId?: string | null; justification?: string }) => Promise<void>;

  // Turnos
  addShiftSchedule: (data: Omit<ShiftSchedule, 'id' | 'tenantId' | 'createdAt'>) => Promise<ShiftSchedule>;
  updateShiftSchedule: (id: string, data: Partial<ShiftSchedule>) => Promise<void>;
  deleteShiftSchedule: (id: string) => Promise<void>;

  // Arriendos (Rentals)
  addRentalParty: (data: Omit<RentalParty, 'id' | 'tenantId' | 'createdAt'>) => Promise<RentalParty>;
  updateRentalParty: (id: string, data: Partial<RentalParty>) => Promise<void>;
  deleteRentalParty: (id: string) => Promise<void>;
  addRentalContract: (data: Omit<RentalContract, 'id' | 'tenantId' | 'createdBy' | 'createdAt'>) => Promise<RentalContract>;
  updateRentalContract: (id: string, data: Partial<RentalContract>) => Promise<void>;
  deleteRentalContract: (id: string) => Promise<void>;
  closeRentalContract: (contractId: string, opts: { returnDate: Date | string; notes?: string; cancelFuturePayments?: boolean }) => Promise<void>;
  addRentalAsset: (data: Omit<RentalAsset, 'id' | 'tenantId' | 'createdAt'>) => Promise<RentalAsset>;
  updateRentalAsset: (id: string, data: Partial<RentalAsset>) => Promise<void>;
  deleteRentalAsset: (id: string) => Promise<void>;
  returnRentalAsset: (id: string, returnDate: Date | string) => Promise<void>;
  addRentalPayment: (data: Omit<RentalPayment, 'id' | 'tenantId' | 'createdAt' | 'status'> & { status?: RentalPayment['status'] }) => Promise<RentalPayment>;
  generateRentalSchedule: (contractId: string, installments: number, opts: { startFrom?: Date | string; firstDueOffsetDays?: number } | undefined) => Promise<void>;
  markRentalOcSent: (contractId: string) => Promise<void>;
  confirmRentalOc: (contractId: string, opts: { installments: number; firstDueOffsetDays?: number }) => Promise<void>;
  materializeRentalContractAssets: (contractId: string) => Promise<number>;
  markRentalPaymentPaid: (id: string, details: { paidDate: Date | string; paymentMethod?: string; reference?: string }) => Promise<void>;
  updateRentalPayment: (id: string, data: Partial<RentalPayment>) => Promise<void>;
  deleteRentalPayment: (id: string) => Promise<void>;
  // Solicitudes de Arriendo + RFQ de arriendo
  addRentalCategory: (name: string) => Promise<void>;
  updateRentalCategory: (id: string, name: string) => Promise<void>;
  deleteRentalCategory: (id: string) => Promise<void>;
  addRentalRequest: (data: { items: { name: string; category: RentalAssetCategory; quantity: number }[]; startDate?: string | null; endDate?: string | null; billingCycleEstimate: RentalBillingCycle; contractId?: string | null; contractName?: string | null; area?: string; justification?: string; supervisorId?: string; }) => Promise<void>;
  updateRentalRequestStatus: (requestId: string, status: 'approved' | 'rejected' | 'quoting', reason?: string) => Promise<void>;
  authorizeRentalRequest: (requestId: string) => Promise<void>;
  deleteRentalRequest: (requestId: string) => Promise<void>;
  addRentalQuoteRequest: (data: { title: string; requestIds: string[]; items: RentalQuoteItem[]; partyIds: string[]; deadline?: string; notes?: string }) => Promise<RentalQuoteRequest>;
  updateRentalQuoteRequest: (id: string, data: Partial<RentalQuoteRequest>) => Promise<void>;
  sendRentalQuoteRequest: (id: string) => Promise<void>;
  recordRentalQuoteResponse: (quoteRequestId: string, response: Omit<RentalQuoteResponse, 'id' | 'createdAt'> & { id?: string }) => Promise<void>;
  awardRentalQuote: (quoteRequestId: string, responseId: string, options?: { currency?: string; paymentDay?: number | null; periods?: number }) => Promise<{ rentalContractId: string; ocNumber: string }>;
  deleteRentalQuoteRequest: (id: string) => Promise<void>;

  // Reportes de Trabajo / Informes de Terreno
  createWorkReport: (data: Partial<Omit<WorkReport, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>) => Promise<WorkReport>;
  updateWorkReport: (id: string, data: Partial<Omit<WorkReport, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  transitionWorkReport: (id: string, toStatus: WorkReportStatus, details?: { signature?: WorkReportSignature; notes?: string; sentTo?: string[] }) => Promise<void>;
  signWorkReportApproval: (id: string, step: 'operations' | 'final', details: { signature: WorkReportSignature; notes?: string }) => Promise<void>;
  recordWorkReportSent: (id: string, recipients: string[]) => Promise<void>;
  uploadWorkReportPhoto: (reportId: string, file: File, description: string) => Promise<WorkReportPhoto>;
  deleteWorkReportPhoto: (photo: WorkReportPhoto) => Promise<void>;
  deleteWorkReport: (id: string) => Promise<void>;

  // Catálogos de Reportes de Trabajo (áreas, especialidades, hitos)
  addWorkReportArea: (name: string) => Promise<void>;
  updateWorkReportArea: (id: string, name: string) => Promise<void>;
  deleteWorkReportArea: (id: string) => Promise<void>;
  addWorkReportSpecialty: (name: string) => Promise<void>;
  updateWorkReportSpecialty: (id: string, name: string) => Promise<void>;
  deleteWorkReportSpecialty: (id: string) => Promise<void>;
  addWorkReportMilestone: (name: string) => Promise<void>;
  updateWorkReportMilestone: (id: string, name: string) => Promise<void>;
  deleteWorkReportMilestone: (id: string) => Promise<void>;
  addWorkReportCatalog: (kind: WorkReportCatalogKind, name: string) => Promise<void>;
  updateWorkReportCatalog: (id: string, name: string) => Promise<void>;
  deleteWorkReportCatalog: (id: string) => Promise<void>;

  // OT / Reportes de Trabajo
  createWorkOrder: (data: Partial<WorkOrder>) => Promise<WorkOrder>;
  updateWorkOrder: (id: string, data: Partial<WorkOrder>) => Promise<void>;
  deleteWorkOrder: (id: string) => Promise<void>;

  // Reporte Semanal (consolida diarios)
  createWorkWeeklyReport: (data: Partial<WorkWeeklyReport>) => Promise<WorkWeeklyReport>;
  updateWorkWeeklyReport: (id: string, data: Partial<WorkWeeklyReport>) => Promise<void>;
  deleteWorkWeeklyReport: (id: string) => Promise<void>;

  // Recursos Humanos
  addLeaveRequest: (data: Omit<LeaveRequest, 'id' | 'tenantId' | 'userId' | 'userName' | 'status' | 'createdAt' | 'reviewedBy' | 'reviewedByName' | 'reviewedAt' | 'rejectionReason'>) => Promise<LeaveRequest>;
  updateLeaveRequestStatus: (id: string, status: LeaveStatus, details?: { rejectionReason?: string }) => Promise<void>;
  deleteLeaveRequest: (id: string) => Promise<void>;
  addHRDocument: (data: Omit<HRDocument, 'id' | 'tenantId' | 'fileUrl' | 'filePath' | 'createdBy' | 'createdAt'>, file: File | null) => Promise<HRDocument>;
  updateHRDocument: (id: string, data: Partial<HRDocument>) => Promise<void>;
  deleteHRDocument: (doc: HRDocument) => Promise<void>;

  // Payments
  addSupplierPayment: (data: any) => Promise<void>;
  updateSupplierPayment: (paymentId: string, data: Partial<SupplierPayment>) => Promise<void>;
  markPaymentAsPaid: (paymentId: string, details: { paymentDate: Date; paymentMethod: string; }) => Promise<void>;
  deleteSupplierPayment: (paymentId: string) => Promise<void>;
  addSalaryAdvanceRequest: (data: { workerId: string; workerName: string; amount: number; }) => Promise<void>;
  approveSalaryAdvance: (advanceId: string) => Promise<void>;
  rejectSalaryAdvance: (advanceId: string, rejectionReason: string) => Promise<void>;

  // Permissions
  updateRolePermissions: (role: UserRole, permission: Permission, checked: boolean) => Promise<void>;
  updatePlanPermissions: (planId: string, permissions: Permission[]) => Promise<void>;

  // Maintenance (ISO 55001)
  addMaintenanceOrder: (data: Omit<MaintenanceOrder, 'id' | 'tenantId' | 'createdAt'>) => Promise<void>;
  updateMaintenanceOrder: (id: string, data: Partial<MaintenanceOrder>) => Promise<void>;
  closeMaintenanceOrder: (id: string, data: Partial<MaintenanceOrder>) => Promise<void>;
  addMaintenanceLog: (data: Omit<MaintenanceLog, 'id' | 'tenantId'>) => Promise<void>;

  // EA Documents (Acta de Entrega de Activos — Art. 11 CT Chile)
  generateEADocument: (employeeId: string, employeeName: string, pdfBlob: Blob) => Promise<string>;
  confirmEASentToDT: (documentId: string, filePath: string) => Promise<void>;

  // Protocols (Control de Calidad de Obra)
  addProtocolTemplate: (data: Omit<ProtocolTemplate, 'id' | 'tenantId' | 'createdBy' | 'createdAt'>) => Promise<void>;
  deleteProtocolTemplate: (templateId: string) => Promise<void>;
  createProtocol: (data: Omit<Protocol, 'id' | 'tenantId' | 'createdBy' | 'createdAt' | 'status' | 'evidencePhotos' | 'executorSignature' | 'supervisorSignature' | 'qualityManagerSignature' | 'completedAt' | 'reviewedAt'>) => Promise<string>;
  saveProtocolDraft: (protocolId: string, data: { items: Protocol['items']; evidencePhotos: string[]; executorSignature?: ProtocolSignature | null }) => Promise<void>;
  submitProtocolForReview: (protocolId: string, data: { items: Protocol['items']; evidencePhotos: string[]; executorSignature: ProtocolSignature; supervisorSignature?: ProtocolSignature | null }) => Promise<void>;
  approveProtocol: (protocolId: string, signature: ProtocolSignature) => Promise<void>;
  rejectProtocol: (protocolId: string, reason: string, signature: ProtocolSignature) => Promise<void>;
  deleteProtocol: (protocolId: string) => Promise<void>;
}

export type AppStateAction =
  | { type: 'SET_DATA'; payload: { collection: keyof AppDataState; data: any[] } }
  | { type: 'SET_ALL'; payload: Partial<AppDataState> }
  | { type: 'SET_ROLES'; payload: typeof ROLES_DEFAULT }
  | { type: 'SET_PLANS'; payload: typeof PLANS }
  | { type: 'SET_LOADING'; payload: boolean };
