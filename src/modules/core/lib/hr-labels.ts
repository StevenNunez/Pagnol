import type { LeaveType, LeaveStatus, HRDocumentType, User } from './data';

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  vacation: 'Vacaciones',
  sick_leave: 'Licencia Médica',
  permit: 'Permiso',
  other: 'Otro',
};

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

export const HR_DOCUMENT_TYPE_LABEL: Record<HRDocumentType, string> = {
  contract: 'Contrato',
  certificate: 'Certificado',
  license: 'Licencia/Permiso',
  exam: 'Examen',
  other: 'Otro',
};

export const EMPLOYMENT_STATUS_LABEL: Record<NonNullable<User['employmentStatus']>, string> = {
  active: 'Activo',
  on_leave: 'Con Licencia/Vacaciones',
  terminated: 'Desvinculado',
};
