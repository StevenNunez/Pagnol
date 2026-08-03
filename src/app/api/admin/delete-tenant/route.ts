import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/modules/core/lib/supabase";
import { createClient } from "@supabase/supabase-js";

/**
 * Borrado completo de una empresa. DESTRUCTIVO E IRREVERSIBLE.
 *
 * Existe para limpiar empresas de prueba mientras la plataforma está en pruebas
 * con alta abierta. No es una baja comercial: cuando exista pricing hay que
 * retirar esta ruta y el botón que la usa (ver PENDIENTES.md).
 *
 * El borrado no puede hacerse desde el cliente: `tenants` no tiene política de
 * DELETE y, aunque la tuviera, falla por las claves foráneas de `profiles` y del
 * resto del esquema. El trabajo sucio lo hace `super_admin_delete_tenant()`, que
 * además desactiva los guards de inmutabilidad del Artículo 2.
 */

async function verifySuperAdmin(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
        .from("profiles")
        .select("role, tenant_id")
        .eq("id", user.id)
        .single();

    if (profile?.role !== "super-admin") return null;
    return { user, profile };
}

export async function POST(req: NextRequest) {
    const caller = await verifySuperAdmin(req);
    if (!caller) {
        return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    let body: { tenantId?: string; confirmName?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    }

    const { tenantId, confirmName } = body;
    if (!tenantId) {
        return NextResponse.json({ error: "tenantId requerido." }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    const { data: tenant, error: tenantError } = await admin
        .from("tenants")
        .select("id, name")
        .eq("id", tenantId)
        .single();

    if (tenantError || !tenant) {
        return NextResponse.json({ error: "La empresa no existe." }, { status: 404 });
    }

    // Confirmación por nombre exacto: el borrado es irreversible, un doble clic
    // no es garantía suficiente de intención.
    if (confirmName?.trim() !== tenant.name) {
        return NextResponse.json(
            { error: `Para confirmar, escribe el nombre exacto de la empresa: "${tenant.name}".` },
            { status: 400 }
        );
    }

    // Nadie borra la empresa a la que pertenece. El super-admin de plataforma
    // tiene tenant_id NULL, así que esto sólo ataja un accidente.
    if (caller.profile.tenant_id && caller.profile.tenant_id === tenantId) {
        return NextResponse.json(
            { error: "No puedes eliminar la empresa a la que perteneces." },
            { status: 400 }
        );
    }

    // 1. Usuarios: hay que borrarlos por la API de Auth. `profiles` tiene clave
    //    foránea contra `tenants`, así que si quedaran vivos el borrado fallaría
    //    con 23503 — y un usuario huérfano en auth.users seguiría iniciando sesión.
    const { data: members, error: membersError } = await admin
        .from("profiles")
        .select("id, email")
        .eq("tenant_id", tenantId);

    if (membersError) {
        console.error("[admin/delete-tenant] listar usuarios:", membersError.message);
        return NextResponse.json({ error: "No se pudieron listar los usuarios de la empresa." }, { status: 500 });
    }

    const authFailures: string[] = [];
    for (const member of members ?? []) {
        const { error } = await admin.auth.admin.deleteUser(member.id);
        // "not found" es benigno: el perfil existía sin su cuenta de Auth.
        if (error && !/not.?found/i.test(error.message)) {
            authFailures.push(member.email ?? member.id);
        }
    }

    if (authFailures.length > 0) {
        console.error("[admin/delete-tenant] usuarios no eliminados:", authFailures.join(", "));
        return NextResponse.json(
            { error: `No se pudieron eliminar ${authFailures.length} usuario(s). No se borró nada más.` },
            { status: 500 }
        );
    }

    // 2. Datos + empresa, en la base.
    const { data: report, error: rpcError } = await admin.rpc("super_admin_delete_tenant", {
        p_tenant: tenantId,
    });

    if (rpcError) {
        console.error("[admin/delete-tenant] rpc:", rpcError.message);
        return NextResponse.json(
            { error: `No se pudo completar el borrado: ${rpcError.message}` },
            { status: 500 }
        );
    }

    // 3. Comprobar que de verdad desapareció, en vez de confiar en que no hubo error.
    const { data: leftover } = await admin
        .from("tenants")
        .select("id")
        .eq("id", tenantId)
        .maybeSingle();

    if (leftover) {
        return NextResponse.json(
            { error: "El borrado no se completó: la empresa sigue existiendo." },
            { status: 500 }
        );
    }

    console.warn(
        `[admin/delete-tenant] ${caller.user.email} eliminó la empresa "${tenant.name}" (${tenantId}): ` +
        `${members?.length ?? 0} usuarios, ${(report as any)?.rows_deleted ?? 0} filas.`
    );

    return NextResponse.json({
        ok: true,
        tenantName: tenant.name,
        usersDeleted: members?.length ?? 0,
        rowsDeleted: (report as any)?.rows_deleted ?? 0,
        byTable: (report as any)?.by_table ?? {},
    });
}
