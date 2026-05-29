import { supabase } from '@/modules/core/lib/supabase';
import { format } from 'date-fns';
import type { ScanResult } from '@/modules/core/lib/data';

type Context = {
  user: any;
  tenantId: string | null;
  db: any;
};

/** Calcula si una fecha es "día de descanso" en un turno rotativo. */
function calcIsRestDay(
  date: Date,
  daysOn: number,
  daysOff: number,
  refDateStr: string
): boolean {
  const cycleLength = daysOn + daysOff;
  const ref = new Date(refDateStr + 'T00:00:00');
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const refDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const diffDays = Math.round((today.getTime() - refDay.getTime()) / 86400000);
  const pos = ((diffDays % cycleLength) + cycleLength) % cycleLength;
  return pos >= daysOn;
}

export async function handleAttendanceScan(
  qrCode: string,
  { user, tenantId }: Context
): Promise<ScanResult> {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (
    user.role !== 'guardia' &&
    user.role !== 'administrador' &&
    user.role !== 'super-admin'
  ) {
    throw new Error('No tienes permiso para registrar asistencia.');
  }

  // 1. Buscar trabajador por QR
  const { data: scannedUser, error: userError } = await supabase
    .from('profiles')
    .select('id, name, cargo')
    .eq('tenant_id', tenantId)
    .eq('qr_code', qrCode)
    .single();

  if (userError || !scannedUser) {
    throw new Error('Código QR no válido o usuario no encontrado.');
  }

  // 2. Buscar asignación activa en un contrato + turno
  const { data: contractWorker } = await supabase
    .from('contract_workers')
    .select(`
      contract_id,
      shift_schedule_id,
      role_in_contract,
      contracts ( id, name ),
      shift_schedules ( id, name, shift_type, days_on, days_off, is_night_shift, rotation_reference_date )
    `)
    .eq('tenant_id', tenantId)
    .eq('user_id', scannedUser.id)
    .is('end_date', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const contract = contractWorker?.contracts as any;
  const shift    = contractWorker?.shift_schedules as any;

  // 3. Determinar si hoy es día de descanso según el turno
  const today = new Date();
  let isRestDay = false;
  if (shift && shift.shift_type !== '5x2') {
    isRestDay = calcIsRestDay(
      today,
      Number(shift.days_on),
      Number(shift.days_off),
      shift.rotation_reference_date
    );
  }

  // 4. Determinar tipo de registro (toggle in/out)
  const todayStr = format(today, 'yyyy-MM-dd');

  const { data: lastLog } = await supabase
    .from('attendance_logs')
    .select('type')
    .eq('user_id', scannedUser.id)
    .eq('date', todayStr)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  const newLogType: 'in' | 'out' = lastLog?.type === 'in' ? 'out' : 'in';
  const logTime = format(today, 'HH:mm');

  // 5. Insertar registro
  const { error: insertError } = await supabase
    .from('attendance_logs')
    .insert({
      user_id:       scannedUser.id,
      user_name:     scannedUser.name,
      type:          newLogType,
      method:        'qr',
      registrar_id:  user.id,
      registrar_name: user.name,
      date:          todayStr,
      tenant_id:     tenantId,
      timestamp:     today.toISOString(),
      contract_id:   contractWorker?.contract_id ?? null,
    });

  if (insertError) throw insertError;

  return {
    workerId:     scannedUser.id,
    workerName:   scannedUser.name,
    workerCargo:  scannedUser.cargo ?? undefined,
    logType:      newLogType,
    logTime,
    contractId:   contractWorker?.contract_id ?? null,
    contractName: contract?.name ?? null,
    shiftName:    shift?.name ?? null,
    shiftType:    shift?.shift_type ?? null,
    isNightShift: shift?.is_night_shift ?? false,
    isRestDay,
  };
}

export async function addManualAttendance(
  userId: string,
  date: Date,
  time: string,
  type: 'in' | 'out',
  { user, tenantId }: Context
) {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const [hours, minutes] = time.split(':').map(Number);
  const timestamp = new Date(date);
  timestamp.setHours(hours, minutes, 0, 0);

  const { data: userProfile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .single();

  // Buscar contrato activo
  const { data: cw } = await supabase
    .from('contract_workers')
    .select('contract_id')
    .eq('user_id', userId)
    .is('end_date', null)
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from('attendance_logs')
    .insert({
      user_id:       userId,
      user_name:     userProfile?.name ?? 'Desconocido',
      timestamp:     timestamp.toISOString(),
      type,
      method:        'manual',
      registrar_id:  user.id,
      registrar_name: user.name,
      date:          format(date, 'yyyy-MM-dd'),
      tenant_id:     tenantId,
      contract_id:   cw?.contract_id ?? null,
    });

  if (error) throw error;
}

export async function updateAttendanceLog(
  logId: string,
  newTimestamp: Date,
  newType: 'in' | 'out',
  originalTimestamp: Date,
  { user, tenantId }: Context
) {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('attendance_logs')
    .update({
      timestamp:          newTimestamp.toISOString(),
      type:               newType,
      original_timestamp: originalTimestamp.toISOString(),
      modified_at:        new Date().toISOString(),
      modified_by:        user.id,
    })
    .eq('id', logId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteAttendanceLog(logId: string, { tenantId }: Context) {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('attendance_logs')
    .delete()
    .eq('id', logId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}
