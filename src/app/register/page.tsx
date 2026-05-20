"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2,
  Mail,
  Phone,
  User,
  ArrowRight,
  ShieldCheck,
  Lock,
  ArrowLeft,
  Hash,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const FormSchema = z.object({
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

type FormData = z.infer<typeof FormSchema>;

const RegisterPage: React.FC = () => {
  const router = useRouter();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
  });

  const onRegister: SubmitHandler<FormData> = async (data) => {
    try {
      const { isPasswordLeaked } = await import('@/lib/password-security');
      if (await isPasswordLeaked(data.password)) {
        toast({
          variant: 'destructive',
          title: 'Contraseña Comprometida',
          description: 'Esta contraseña fue expuesta en filtraciones conocidas. Elige una diferente.',
        });
        return;
      }

      // Crear tenant + perfil en el servidor (bypassa RLS)
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantName: data.tenantName,
          tenantId: data.tenantId,
          adminName: data.adminName,
          adminEmail: data.adminEmail,
          phone: data.phone,
          password: data.password,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo procesar tu solicitud.');

      // Iniciar sesión automáticamente tras el registro
      const { supabase } = await import('@/modules/core/lib/supabase');
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.adminEmail,
        password: data.password,
      });

      if (signInError) throw new Error('Cuenta creada. Inicia sesión manualmente.');

      toast({
        title: '¡Registro Exitoso!',
        description: `La empresa ${data.tenantName} ha sido creada. Bienvenido a Pagnol.`,
        duration: 4000,
      });

      router.push('/dashboard');

    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error en el Registro',
        description: error.message || 'No se pudo procesar tu solicitud.',
      });
    }
  };

  return (
    <div className="min-h-screen flex bg-white">

      {/* Left Panel — mismo que Login */}
      <div className="hidden lg:flex flex-col justify-between w-[45%] bg-[#0F172A] p-12 relative overflow-hidden text-white">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-pagnol-orange/10 rounded-full blur-[100px] translate-y-1/4 -translate-x-1/4 pointer-events-none" />

        {/* Header */}
        <div className="relative z-10">
          <Link href="/login" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest">
            <ArrowLeft size={14} /> Volver al Login
          </Link>
        </div>

        {/* Main Content */}
        <div className="relative z-10 space-y-6">
          <div className="w-28 h-28 bg-white rounded-2xl flex items-center justify-center mb-6 shadow-xl">
            <img src="/logo.png" alt="PAGNOL" className="h-20 w-auto object-contain" />
          </div>

          <h1 className="text-5xl font-black tracking-tighter leading-none">
            Registro de<br />
            <span className="text-pagnol-orange">Corporación</span> Minera.
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
                <div className="p-2 bg-white/5 rounded-lg text-pagnol-orange">
                  <item.icon size={16} />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 pt-12 border-t border-white/10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/5 rounded-xl text-pagnol-orange">
              <ShieldCheck size={24} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Datos protegidos</p>
          </div>
        </div>
      </div>

      {/* Right Panel — formulario con scroll */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-8 sm:p-16 relative">
        <div className="w-full max-w-xl space-y-7 animate-in slide-in-from-right-8 duration-700 py-8">

          <div className="space-y-2">
            <h2 className="text-3xl font-black tracking-tight text-pagnol-teal">Nueva Cuenta Corporativa</h2>
            <p className="text-slate-500 text-sm font-medium">Configure el perfil maestro de su empresa minera.</p>
          </div>

          <form onSubmit={handleSubmit(onRegister)} className="space-y-5">

            {/* Sección Empresa */}
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2 pt-2">
              <Building2 size={11} /> Datos de la Empresa
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tenantName" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Razón Social</Label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                  <Input
                    {...register('tenantName')}
                    id="tenantName"
                    placeholder="Minera Norte S.A."
                    className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                  />
                </div>
                {errors.tenantName && <p className="text-xs text-destructive">{errors.tenantName.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="tenantId" className="text-[10px] font-black uppercase tracking-widest text-slate-400">RUT Empresa</Label>
                <div className="relative">
                  <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                  <Input
                    {...register('tenantId')}
                    id="tenantId"
                    placeholder="76.123.456-7"
                    className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                  />
                </div>
                {errors.tenantId && <p className="text-xs text-destructive">{errors.tenantId.message}</p>}
              </div>
            </div>

            {/* Sección Administrador */}
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2 pt-3">
              <User size={11} /> Contacto Administrativo
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="adminName" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nombre Completo</Label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                  <Input
                    {...register('adminName')}
                    id="adminName"
                    placeholder="Administrador Jefe"
                    className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                  />
                </div>
                {errors.adminName && <p className="text-xs text-destructive">{errors.adminName.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Teléfono</Label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                  <Input
                    {...register('phone')}
                    id="phone"
                    type="tel"
                    placeholder="+56 9 ..."
                    className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminEmail" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Correo Electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                <Input
                  {...register('adminEmail')}
                  id="adminEmail"
                  type="email"
                  placeholder="admin@empresa.cl"
                  className="pl-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                />
              </div>
              {errors.adminEmail && <p className="text-xs text-destructive">{errors.adminEmail.message}</p>}
            </div>

            {/* Sección Contraseña */}
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pagnol-orange flex items-center gap-2 pt-3">
              <Lock size={11} /> Seguridad
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contraseña Maestra</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                  <Input
                    {...register('password')}
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Mín. 8 caracteres"
                    className="pl-11 pr-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confirmar Contraseña</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                  <Input
                    {...register('confirmPassword')}
                    id="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Repite la contraseña"
                    className="pl-11 pr-11 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
              </div>
            </div>

            {/* Submit */}
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
              <Link href="/login" className="font-bold text-pagnol-orange hover:underline">
                Iniciar sesión
              </Link>
            </p>
            <p className="text-center text-[10px] uppercase font-bold text-slate-300 tracking-widest">
              Soporte Técnico Enterprise &bull; support@pagnol.app
            </p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
