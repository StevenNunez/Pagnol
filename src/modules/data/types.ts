
import {
  User,
  Material,
  Tool,
  ToolLog,
  MaterialRequest,
  ReturnRequest,
  PurchaseRequest,
  Supplier,
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
} from '../core/lib/data';
import { ROLES as ROLES_DEFAULT, Permission, PLANS } from '@/modules/core/lib/permissions';

export interface AppDataState {
  isLoading: boolean;
  roles: typeof ROLES_DEFAULT;
  subscriptionPlans: typeof PLANS;
  users: User[];
  materials: Material[];
  tools: Tool[];
  toolLogs: ToolLog[];
  requests: MaterialRequest[];
  returnRequests: ReturnRequest[];
  purchaseRequests: PurchaseRequest[];
  suppliers: Supplier[];
  materialCategories: MaterialCategory[];
  units: Unit[];
  purchaseLots: PurchaseLot[];
  purchaseOrders: PurchaseOrder[];
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
}

// This defines the shape of the context, including all functions
export interface AppStateContextType extends AppDataState {
  can: (permission: Permission) => boolean;
  notify: (message: string, variant?: "default" | "destructive" | "success") => void;
  refreshData: (collection?: keyof AppDataState) => void;
  currentTenant: Tenant | null;

  // Purchase Requests
  addPurchaseRequest: (data: Partial<Omit<PurchaseRequest, 'id' | 'status' | 'createdAt' | 'tenantId'>>) => Promise<void>;
  updatePurchaseRequestStatus: (requestId: string, status: PurchaseRequest['status'], data: Partial<PurchaseRequest>) => Promise<void>;
  receivePurchaseRequest: (requestId: string, receivedQuantity: number, existingMaterialId?: string) => Promise<void>;
  deletePurchaseRequest: (requestId: string) => Promise<void>;
  cancelPurchaseOrder: (orderId: string) => Promise<void>;
  archiveLot: (requestIds: string[]) => Promise<void>;
  generatePurchaseOrder: (requests: PurchaseRequest[], supplierId: string) => Promise<string>;
  createPurchaseOrder: (data: { lotId: string; ocNumber: string; items: { requestId: string; price: number; quantity: number; name: string; unit: string; }[]; totalAmount: number; }) => Promise<string>;
  returnToPool: (requestIds: string[]) => Promise<void>;

  // Material Requests
  addMaterialRequest: (data: { items: { materialId: string; quantity: number }[]; area: string; supervisorId: string; supervisorName?: string; highestClass?: 'A' | 'B' | 'C'; tenantPrefix?: string; }) => Promise<void>;
  addAndApproveMaterialRequest: (data: { items: { materialId: string; quantity: number }[]; area: string; supervisorId: string; contractUrl?: string | null; internalCode?: string; }) => Promise<void>;
  updateMaterialRequestStatus: (requestId: string, status: 'approved' | 'rejected') => Promise<void>;
  deliverApprovedMaterialRequest: (requestId: string, contractUrl: string | null) => Promise<void>;
  addReturnRequest: (items: { materialId: string; quantity: number; materialName: string; unit: string }[], notes: string) => Promise<void>;
  addAndCompleteReturnRequest: (data: { items: { materialId: string; quantity: number; materialName: string; unit: string; condition: 'OK' | 'CON FALLA' | 'ROTO' }[]; notes: string; workerId: string; workerName: string; evidenceUrl?: string; }) => Promise<void>;
  updateReturnRequestStatus: (requestId: string, status: 'completed' | 'rejected', additionalData?: { condition: 'OK' | 'CON FALLA' | 'ROTO', evidenceUrl?: string }) => Promise<void>;
  deleteMaterialRequest: (requestId: string) => Promise<void>;
  deleteReturnRequest: (requestId: string) => Promise<void>;

  // Generic CRUD
  addTenant: (data: any) => Promise<void>;
  addUser: (data: any) => Promise<any>;
  updateUser: (userId: string, data: Partial<User>) => Promise<void>;
  updateUserPermissions: (userId: string, permissions: string[]) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  addMaterial: (data: any) => Promise<void>;
  updateMaterial: (materialId: string, data: Partial<Material>) => Promise<void>;
  deleteMaterial: (materialId: string) => Promise<void>;
  addManualStockEntry: (materialId: string, quantity: number, justification: string) => Promise<void>;
  addMaterialCategory: (name: string) => Promise<void>;
  updateMaterialCategory: (id: string, name: string) => Promise<void>;
  deleteMaterialCategory: (id: string) => Promise<void>;
  addUnit: (name: string) => Promise<void>;
  deleteUnit: (id: string) => Promise<void>;
  addSupplier: (data: any) => Promise<void>;
  updateSupplier: (id: string, data: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  createLot: (name: string) => Promise<void>;
  addRequestToLot: (requestId: string, lotId: string) => Promise<void>;
  removeRequestFromLot: (requestId: string) => Promise<void>;
  deleteLot: (lotId: string) => Promise<void>;
  updateTenant: (tenantId: string, data: Partial<Tenant>) => Promise<void>;

  // Work Items
  addWorkItem: (data: Omit<WorkItem, 'id' | 'tenantId' | 'progress' | 'path'>) => Promise<void>;
  updateWorkItem: (id: string, data: Partial<WorkItem>) => Promise<void>;
  deleteWorkItem: (id: string) => Promise<void>;
  addWorkItemProgress: (workItemId: string, quantity: number, date: Date, observations: string | undefined) => Promise<void>;
  submitForQualityReview: (workItemId: string) => Promise<void>;
  approveWorkItem: (workItemId: string) => Promise<void>;
  rejectWorkItem: (workItemId: string, reason: string) => Promise<void>;
  addPaymentState: (data: Omit<PaymentState, 'id' | 'tenantId' | 'createdAt' | 'status' | 'contractorId' | 'contractorName'>) => Promise<string>;

  // Tools
  addTool: (name: string) => Promise<void>;
  updateTool: (toolId: string, data: Partial<Tool>) => Promise<void>;
  deleteTool: (toolId: string) => Promise<void>;
  checkoutTool: (toolId: string, userId: string, supervisorId: string) => Promise<void>;
  returnTool: (logId: string, status: 'ok' | 'damaged', notes: string) => Promise<void>;
  findActiveLogForTool: (toolId: string) => Promise<ToolLog | null>;

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
  handleAttendanceScan: (qrCode: string) => Promise<void>;
  addManualAttendance: (userId: string, date: Date, time: string, type: 'in' | 'out') => Promise<void>;
  updateAttendanceLog: (logId: string, newTimestamp: Date, newType: 'in' | 'out', originalTimestamp: Date) => Promise<void>;
  deleteAttendanceLog: (logId: string) => Promise<void>;

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
  | { type: 'SET_ROLES'; payload: typeof ROLES_DEFAULT }
  | { type: 'SET_PLANS'; payload: typeof PLANS }
  | { type: 'SET_LOADING'; payload: boolean };
