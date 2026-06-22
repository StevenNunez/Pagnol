import type { WorkReportHousekeeping } from './data';

// Textos estándar del Protocolo de Housekeeping (página 4 del formato SQM).
// Compartidos entre la UI (que permite marcar estado/obs) y el motor PDF.
export const HOUSEKEEPING_CODE = 'PRO-SM-SQM-HK';
export const HOUSEKEEPING_REV = 'REV. 0';

export const HOUSEKEEPING_ITEMS_TEXT = [
  '2.1 Área de trabajo limpia y ordenada (talleres, HDPE, FRP, soldadura, torre)',
  '2.2 Salas de cambio limpias',
  '2.3 Bodegas ordenadas',
  '2.4 Sector de acopio limpio',
  '2.5 Perímetro de instalaciones limpio',
  '2.6 Residuos retirados',
  '2.7 Materiales correctamente almacenados',
  '2.8 Herramientas guardadas',
  '2.9 No existen riesgos visibles',
  '2.10 Evidencia fotográfica enviada a WhatsApp',
];

export const HOUSEKEEPING_JEFE_ITEMS_TEXT = [
  '5.1 Revisión de fotos',
  '5.2 Revisión checklist',
  '5.3 Área en condiciones',
  '5.4 Desviaciones detectadas',
];

// Objeto inicial de housekeeping: ítems estándar sin marcar. Los IDs son
// deterministas (por índice) porque los textos son fijos.
export function createDefaultHousekeeping(): WorkReportHousekeeping {
  return {
    subtitle: '',
    code: HOUSEKEEPING_CODE,
    rev: HOUSEKEEPING_REV,
    sector: '',
    inspection: '',
    items: HOUSEKEEPING_ITEMS_TEXT.map((text, i) => ({
      id: `hk-${i}`,
      text,
      status: '',
      photo: '',
      observations: '',
    })),
    observations: '',
    photos: ['', '', '', ''],
    jefeItems: HOUSEKEEPING_JEFE_ITEMS_TEXT.map((text, i) => ({
      id: `hkj-${i}`,
      text,
      status: '',
      observations: '',
    })),
  };
}
