import type { WorkExecutionStatus, WorkReportStatus } from './data';

export const WORK_REPORT_STATUS_LABEL: Record<WorkReportStatus, string> = {
  draft: 'Borrador',
  pending_review: 'Pendiente revision',
  observed: 'Observado',
  operations_approved: 'Aprobación parcial (1 de 2 firmas)',
  final_approved: 'Aprobado final',
  archived: 'Archivado',
};

export const WORK_EXECUTION_LABEL: Record<WorkExecutionStatus, string> = {
  not_started: 'No iniciado',
  in_progress: 'En ejecucion',
  suspended: 'Suspendido',
  finished: 'Finalizado',
};
