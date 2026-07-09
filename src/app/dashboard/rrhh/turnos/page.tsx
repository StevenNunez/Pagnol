// Ruta espejo para el módulo RRHH: la gestión de turnos es la MISMA página que
// Asistencia → Turnos (fuente única), pero montada bajo /rrhh para que quien
// vive en el módulo RRHH (rol recursos-humanos ya tiene shifts:manage) la
// encuentre en SU sidebar sin cambiar de módulo.
export { default } from '@/app/dashboard/attendance/shifts/page';
