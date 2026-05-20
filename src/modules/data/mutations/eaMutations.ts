import { supabase } from '@/modules/core/lib/supabase';

type Context = { user: any; tenantId: string | null; db?: any };

export const generateEADocument = async (
    employeeId: string,
    employeeName: string,
    pdfBlob: Blob,
    { user, tenantId }: Context
): Promise<string> => {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const filePath = `ea-docs/${tenantId}/${employeeId}-${Date.now()}.pdf`;

    const { error: uploadError } = await supabase.storage
        .from('contracts')
        .upload(filePath, pdfBlob, { contentType: 'application/pdf', upsert: true });

    if (uploadError) throw new Error(`Error al subir el documento: ${uploadError.message}`);

    const { data: { publicUrl } } = supabase.storage.from('contracts').getPublicUrl(filePath);

    const { error } = await supabase.from('ea_documents').insert({
        tenant_id: tenantId,
        employee_id: employeeId,
        employee_name: employeeName,
        file_path: filePath,
        file_url: publicUrl,
        status: 'generated',
        generated_by: user.id,
    });

    if (error) throw new Error(`Error al guardar registro EA: ${error.message}`);

    return publicUrl;
};

export const confirmEASentToDT = async (
    documentId: string,
    filePath: string,
    { tenantId }: Context
): Promise<void> => {
    if (!tenantId) throw new Error('Inquilino no válido.');

    // Delete file from storage (privacy: no guardamos documentos laborales más de lo necesario)
    if (filePath) {
        await supabase.storage.from('contracts').remove([filePath]);
    }

    const { error } = await supabase.from('ea_documents')
        .update({
            status: 'sent_to_dt',
            confirmed_at: new Date().toISOString(),
            file_path: null,
            file_url: null,
        })
        .eq('id', documentId)
        .eq('tenant_id', tenantId);

    if (error) throw new Error(`Error al confirmar envío: ${error.message}`);
};
