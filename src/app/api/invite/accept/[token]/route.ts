import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/modules/core/lib/admin';

// GET — valida el token y devuelve datos de la invitación + tenant
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const { data: inv, error } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .eq('status', 'pending')
    .single();

  if (error || !inv) {
    return NextResponse.json({ error: 'El link de invitación no es válido, ya fue utilizado o ha expirado.' }, { status: 404 });
  }

  if (new Date(inv.expires_at) < new Date()) {
    await supabaseAdmin.from('invitations').update({ status: 'expired' }).eq('id', inv.id);
    return NextResponse.json({ error: 'Esta invitación ha expirado. Solicita una nueva a tu administrador.' }, { status: 410 });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, name, tenant_id, plan')
    .eq('id', inv.tenant_id)
    .single();

  return NextResponse.json({ invitation: inv, tenant: tenant ?? null });
}

// POST — completa el registro del usuario invitado
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const { name, password } = await req.json();

    if (!name?.trim() || !password || password.length < 6) {
      return NextResponse.json({ error: 'Nombre y contraseña de al menos 6 caracteres son requeridos.' }, { status: 400 });
    }

    // 1. Re-validar el token
    const { data: inv, error: invError } = await supabaseAdmin
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single();

    if (invError || !inv) {
      return NextResponse.json({ error: 'Invitación no válida o ya utilizada.' }, { status: 404 });
    }

    if (new Date(inv.expires_at) < new Date()) {
      await supabaseAdmin.from('invitations').update({ status: 'expired' }).eq('id', inv.id);
      return NextResponse.json({ error: 'La invitación ha expirado.' }, { status: 410 });
    }

    // 2. Crear usuario en Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: inv.email,
      password,
      user_metadata: { name, role: inv.role, tenant_id: inv.tenant_id },
      email_confirm: true,
    });

    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return NextResponse.json({ error: 'Este correo ya tiene una cuenta registrada.' }, { status: 409 });
      }
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const userId = authData.user.id;

    // 3. Crear perfil
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        name,
        email: inv.email,
        role: inv.role,
        tenant_id: inv.tenant_id,
        qr_code: userId,
        is_active: true,
        created_at: new Date().toISOString(),
        onboarding_completed: true,
      });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => null);
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    // 4. Marcar invitación como usada
    await supabaseAdmin.from('invitations').update({ status: 'used' }).eq('id', inv.id);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[Invite Accept]', error);
    return NextResponse.json({ error: error.message || 'Error interno.' }, { status: 500 });
  }
}
