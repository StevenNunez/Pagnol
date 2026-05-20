import { supabase } from '@/modules/core/lib/supabase';
import { format } from 'date-fns';

type Context = {
  user: any;
  tenantId: string | null;
  db: any;
};

export async function handleAttendanceScan(qrCode: string, { user, tenantId }: Context) {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (user.role !== 'guardia' && user.role !== 'administrador' && user.role !== 'super-admin') {
    throw new Error('No tienes permiso para registrar asistencia.');
  }

  // Find user by QR code
  const { data: scannedUser, error: userError } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('qr_code', qrCode)
    .single();

  if (userError || !scannedUser) {
    throw new Error('Código QR no válido o usuario no encontrado.');
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Find last log today for this user
  const { data: lastLog, error: logError } = await supabase
    .from('attendance_logs')
    .select('type')
    .eq('user_id', scannedUser.id)
    .eq('date', todayStr)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  const newLogType = lastLog?.type === 'in' ? 'out' : 'in';

  const { error: insertError } = await supabase
    .from('attendance_logs')
    .insert({
      user_id: scannedUser.id,
      user_name: scannedUser.name,
      type: newLogType,
      method: 'qr',
      registrar_id: user.id,
      registrar_name: user.name,
      date: todayStr,
      tenant_id: tenantId,
      timestamp: new Date().toISOString()
    });

  if (insertError) throw insertError;
}

export async function addManualAttendance(
  userId: string,
  date: Date,
  time: string,
  type: 'in' | 'out',
  { user, tenantId }: Context
) {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const [hours, minutes] = time.split(':').map(Number);
  const timestamp = new Date(date);
  timestamp.setHours(hours, minutes, 0, 0);

  const { data: userProfile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .single();

  const userName = userProfile ? userProfile.name : 'Desconocido';

  const { error } = await supabase
    .from('attendance_logs')
    .insert({
      user_id: userId,
      user_name: userName,
      timestamp: timestamp.toISOString(),
      type,
      method: 'manual',
      registrar_id: user.id,
      registrar_name: user.name,
      date: format(date, 'yyyy-MM-dd'),
      tenant_id: tenantId,
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
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const { error } = await supabase
    .from('attendance_logs')
    .update({
      timestamp: newTimestamp.toISOString(),
      type: newType,
      original_timestamp: originalTimestamp.toISOString(),
      modified_at: new Date().toISOString(),
      modified_by: user.id,
    })
    .eq('id', logId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteAttendanceLog(logId: string, { tenantId }: Context) {
  if (!tenantId) throw new Error('No autenticado o sin inquilino.');

  const { error } = await supabase
    .from('attendance_logs')
    .delete()
    .eq('id', logId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}
