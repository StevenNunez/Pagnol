'use client';

import { supabase } from '@/modules/core/lib/supabase';
import { nanoid } from 'nanoid';

type Context = {
  user: any;
  tenantId: string | null;
  db: any;
};

export async function addTool(name: string, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");
  const qr_code = `TOOL-${nanoid(10).toUpperCase()}`;

  const { error } = await supabase.from('tools').insert({
    name,
    qr_code,
    status: 'available',
    tenant_id: tenantId,
  });

  if (error) throw error;
}

export async function updateTool(toolId: string, data: any, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  // Map incoming camelCase data to snake_case if necessary
  const mappedData: any = {};
  if (data.name) mappedData.name = data.name;
  if (data.status) mappedData.status = data.status;
  if (data.qrCode) mappedData.qr_code = data.qrCode;

  const { error } = await supabase.from('tools').update(mappedData).eq('id', toolId).eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function deleteTool(toolId: string, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");
  const { error } = await supabase.from('tools').delete().eq('id', toolId).eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function checkoutTool(toolId: string, userId: string, supervisorId: string, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { data: userProfile } = await supabase.from('profiles').select('name').eq('id', userId).single();
  const { data: supervisorProfile } = await supabase.from('profiles').select('name').eq('id', supervisorId).single();
  const { data: tool } = await supabase.from('tools').select('name').eq('id', toolId).single();

  const userName = userProfile?.name || 'Desconocido';
  const supervisorName = supervisorProfile?.name || 'Desconocido';
  const toolName = tool?.name || 'Herramienta Desconocida';

  // Update tool status
  await supabase.from('tools').update({ status: 'in-use' }).eq('id', toolId);

  // Create log
  const { error } = await supabase.from('tool_logs').insert({
    tool_id: toolId,
    tool_name: toolName,
    user_id: userId,
    user_name: userName,
    checkout_date: new Date().toISOString(),
    return_date: null,
    checkout_supervisor_id: supervisorId,
    checkout_supervisor_name: supervisorName,
    tenant_id: tenantId,
  });

  if (error) throw error;
}

export async function returnTool(logId: string, status: 'ok' | 'damaged', notes: string, { user, tenantId }: Context) {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const { data: log } = await supabase.from('tool_logs').select('*').eq('id', logId).single();
  if (!log) throw new Error("Registro no encontrado");

  const toolId = log.tool_id;
  if (!toolId) throw new Error("No se pudo encontrar la herramienta asociada al registro.");

  // Update tool status
  await supabase.from('tools').update({
    status: status === 'ok' ? 'available' : 'maintenance'
  }).eq('id', toolId);

  // Update log
  const { error } = await supabase.from('tool_logs').update({
    return_date: new Date().toISOString(),
    return_status: status,
    return_notes: notes,
    return_supervisor_id: user.id,
    return_supervisor_name: user.name,
  }).eq('id', logId);

  if (error) throw error;
}

export async function findActiveLogForTool(toolId: string, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { data, error } = await supabase
    .from('tool_logs')
    .select('*')
    .eq('tool_id', toolId)
    .is('return_date', null)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
