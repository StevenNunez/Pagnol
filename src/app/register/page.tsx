"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2, Mail, Phone, User, ArrowRight, ShieldCheck,
  Lock, ArrowLeft, Hash, Loader2, Eye, EyeOff, CheckCircle,
} from 'lucide-react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/modules/core/lib/supabase';

// ── Schemas ──────────────────────────────────────────────────────────────────

const EmailSchema = z.object({
  tenantName: z.string().min(3, 'El nombre de la empresa es requerido.'),
  tenantId: z.string().min(5, 'El RUT de la empresa es requerido.'),
  adminName: z.string().min(3, 'Tu nombre es requerido.'),
  adminEmail: z.string().email('El correo no es válido.'),
  phone: z.string().optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Las contraseñas no coinciden.',
  path: ['confirmPassword'],
});

const OAuthSchema = z.object({
  tenantName: z.string().min(3, 'El nombre de la empresa es requerido.'),
  tenantId: z.string().min(5, 'El RUT de la empresa es requerido.'),
  adminName: z.string().min(3, 'Tu nombre es requerido.'),
  phone: z.string().optional(),
});

type EmailFormData = z.infer<typeof EmailSchema>;
type OAuthFormData = z.infer<typeof OAuthSchema>;

// ── Left panel (shared) ───────────────────────────────────────────────────────

function LeftPanel() {
  return (
    <div className="hidden lg:flex flex-col justify-between w-[45%] bg-[#0F172A] p-12 relative overflow-hidden text-white">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-pagnol-orange/10 rounded-full blur-[100px] translate-y-1/4 -translate-x-1/4 pointer-events-none" />
      <div className="relative z-10">
        <Link href="/login" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
          <ArrowLeft size={14} /> Volver al Login
        </Link>
      </div>
      <div className="relative z-10 space-y-6">
        <div className="w-28 h-28 bg-white rounded-2xl flex items-center justify-center mb-6 shadow-xl">
          <img src="/logo.png" alt="PAGNOL" className="h-20 w-auto object-contain" />
        </div>
        <h1 className="text-5xl font-black tracking-tighter leading-none">
          Registro de<br /><span className="text-pagnol-orange">Corporación</span> Minera.
        </h1>
        <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md">
          Centralice el control de activos en múltiples faenas. Cada pañol conectado, cada movimiento auditado.
        </p>
        <div className="space-y-4 pt-4">
          {[
            { icon: ShieldCheck, label: "Control de acceso por roles" },
            { icon: Building2, label: "Multi-faena desde un solo panel" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="p-2 bg-white/5 rounded-lg text-pagnol-orange"><item.icon size={16} /></div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="relative z-10 pt-12 border-t border-white/10">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white/5 rounded-xl text-pagnol-orange"><ShieldCheck size={24} /></div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Datos protegidos</p>
        </div>
      </div>
    </div>
  );
}

// ── OAuth registration form ───────────────────────────────────────────────────

function OAuthRegisterForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleName, setGoogleName] = useState('');
  const [loadingSession, setLoadingSession] = useState(true);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<OAuthFormData>({
    resolver: zodResolver(OAuthSchema),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        // No session — shouldn't be here, redirect to login
        router.replace('/login');
        return;
      }
      const name = (session.user.user_metadata?.name as string | undefined) ?? '';
      const email = session.user.email ?? '';
      setGoogleEmail(email);
      setGoogleName(name);
      setValue('adminName', name);
      setLoadingSession(false);
    });
  }, [router, setValue]);

  const onSubmit: SubmitHandler<OAuthFormData> = async (data) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast({ variant: 'destructive', title: 'Sesión expirada', description: 'Vuelve a iniciar sesión con Google.' });
      return;
    }

    const res = await fetch('/api/register/oauth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tenantName: data.tenantName,
        tenantId: data.tenantId,
        adminName: data.adminName,
        phone: data.phone,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      toast({ variant: 'destructive', title: 'Error', description: json.error || 'No se pudo crear la empresa.' });
      return;
    }

    setDone(true);
    toast({ title: '¡Empresa creada!', description: `${data.tenantName} ya está en Pagnol.`, duration: 4000 });
    // Hard reload so AuthProvider re-fetches the new profile
    setTimeout(() => { window.location.href = '/dashboard'; }, 1500);
  };

  if (loadingSession) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={36} className="animate-spin text-pagnol-orange" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-sm">
          <CheckCircle size={56} className="text-green-500 mx-auto" />
          <h2 className="text-3xl font-black tracking-tight text-[#204A57]">¡Todo listo!</h2>
          <p className="text-slate-500 text-sm">Redirigiendo a tu panel de control...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-8 sm:p-16">
      <div className="w-full max-w-xl space-y-7 animate-in slide-in-from-right-8 duration-700 py-8">

        {/* Google account info banner */}
        <div className="flex items-center gap-4 bg-blue-50 border border-blue-200 rounded-2xl p-4">
          <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Cuenta Google verificada</p>
            <p className="text-sm font-semibold text-blue-900 truncate">{googleEmail}</p>
            <p className="text-[11px] text-blue-600">Seguirás ingresando con Google — no necesitas contraseña.</p>
          </div>
        </div>

        <div className="space-y-1">
          <h2 className="text-3xl font-black tracking-tight text-[#204A57]">Crear tu Empresa</h2>
          <p className="text-slate-500 text-sm font-medium">Completa los datos para activar tu organización en Pagnol.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2">
            <Building2 size={11} /> Datos de la Empresa
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Razón Social</Label>
              <div className="relative">
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('tenantName')} placeholder="Minera Norte S.A." className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
              </div>
              {errors.tenantName && <p className="text-xs text-destructive">{errors.tenantName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">RUT Empresa</Label>
              <div className="relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('tenantId')} placeholder="76.123.456-7" className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
              </div>
              {errors.tenantId && <p className="text-xs text-destructive">{errors.tenantId.message}</p>}
            </div>
          </div>

          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2 pt-2">
            <User size={11} /> Tu Perfil de Administrador
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nombre Completo</Label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('adminName')} placeholder="Tu nombre" className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
              </div>
              {errors.adminName && <p className="text-xs text-destructive">{errors.adminName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Teléfono</Label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('phone')} type="tel" placeholder="+56 9 ..." className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
              </div>
            </div>
          </div>

          {/* Email read-only */}
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Correo Electrónico (Google)</Label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <Input value={googleEmail} readOnly className="pl-11 h-12 bg-slate-100 border-slate-200 rounded-xl font-medium text-slate-500 cursor-not-allowed" />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-12 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-100 transition-all active:scale-95 flex items-center justify-center gap-2 mt-2"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? <><Loader2 className="animate-spin" size={18} /> Creando organización...</>
              : <><span>Activar mi Empresa en Pagnol</span><ArrowRight size={16} /></>
            }
          </Button>
        </form>

        <p className="text-center text-[10px] uppercase font-bold text-slate-300 tracking-widest">
          Soporte Técnico &bull; hola@teolabs.app
        </p>
      </div>
    </div>
  );
}

// ── Standard email/password registration form ────────────────────────────────

function EmailRegisterForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<EmailFormData>({
    resolver: zodResolver(EmailSchema),
  });

  const onRegister: SubmitHandler<EmailFormData> = async (data) => {
    try {
      const { isPasswordLeaked } = await import('@/lib/password-security');
      if (await isPasswordLeaked(data.password)) {
        toast({ variant: 'destructive', title: 'Contraseña Comprometida', description: 'Esta contraseña fue expuesta en filtraciones conocidas. Elige una diferente.' });
        return;
      }

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantName: data.tenantName, tenantId: data.tenantId,
          adminName: data.adminName, adminEmail: data.adminEmail,
          phone: data.phone, password: data.password,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo procesar tu solicitud.');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.adminEmail, password: data.password,
      });

      if (signInError) throw new Error('Cuenta creada. Inicia sesión manualmente.');

      toast({ title: '¡Registro Exitoso!', description: `La empresa ${data.tenantName} ha sido creada. Bienvenido a Pagnol.`, duration: 4000 });
      router.push('/dashboard');

    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error en el Registro', description: error.message || 'No se pudo procesar tu solicitud.' });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-8 sm:p-16">
      <div className="w-full max-w-xl space-y-7 animate-in slide-in-from-right-8 duration-700 py-8">

        <div className="space-y-2">
          <h2 className="text-3xl font-black tracking-tight text-[#204A57]">Nueva Cuenta Corporativa</h2>
          <p className="text-slate-500 text-sm font-medium">Configure el perfil maestro de su empresa minera.</p>
        </div>

        <form onSubmit={handleSubmit(onRegister)} className="space-y-5">

          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2 pt-2">
            <Building2 size={11} /> Datos de la Empresa
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Razón Social</Label>
              <div className="relative">
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('tenantName')} placeholder="Minera Norte S.A." className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
              </div>
              {errors.tenantName && <p className="text-xs text-destructive">{errors.tenantName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">RUT Empresa</Label>
              <div className="relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('tenantId')} placeholder="76.123.456-7" className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
              </div>
              {errors.tenantId && <p className="text-xs text-destructive">{errors.tenantId.message}</p>}
            </div>
          </div>

          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2 pt-3">
            <User size={11} /> Contacto Administrativo
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nombre Completo</Label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('adminName')} placeholder="Administrador Jefe" className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
              </div>
              {errors.adminName && <p className="text-xs text-destructive">{errors.adminName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Teléfono</Label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('phone')} type="tel" placeholder="+56 9 ..." className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Correo Electrónico</Label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <Input {...register('adminEmail')} type="email" placeholder="admin@empresa.cl" className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
            </div>
            {errors.adminEmail && <p className="text-xs text-destructive">{errors.adminEmail.message}</p>}
          </div>

          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2 pt-3">
            <Lock size={11} /> Seguridad
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contraseña Maestra</Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('password')} type={showPassword ? "text" : "password"} placeholder="Mín. 8 caracteres" className="pl-11 pr-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confirmar Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input {...register('confirmPassword')} type={showConfirm ? "text" : "password"} placeholder="Repite la contraseña" className="pl-11 pr-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium" />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-12 bg-pagnol-orange hover:bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-100 transition-all active:scale-95 flex items-center justify-center gap-2 mt-2"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? <><Loader2 className="animate-spin" size={18} /> Creando organización...</>
              : <><span>Confirmar Registro Corporativo</span><ArrowRight size={16} /></>
            }
          </Button>
        </form>

        <div className="space-y-3">
          <p className="text-center text-sm text-slate-400">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-bold text-pagnol-orange hover:underline">Iniciar sesión</Link>
          </p>
          <p className="text-center text-[10px] uppercase font-bold text-slate-300 tracking-widest">
            Soporte Técnico &bull; hola@teolabs.app
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Router component that detects ?oauth=1 ───────────────────────────────────

function RegisterRouter() {
  const searchParams = useSearchParams();
  const isOAuth = searchParams.get('oauth') === '1';

  return (
    <div className="min-h-screen flex bg-white">
      <LeftPanel />
      {isOAuth ? <OAuthRegisterForm /> : <EmailRegisterForm />}
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={36} className="animate-spin text-pagnol-orange" />
      </div>
    }>
      <RegisterRouter />
    </Suspense>
  );
}
