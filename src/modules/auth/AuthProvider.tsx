
"use client";

import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useContext,
} from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/modules/core/lib/supabase';
import {
  User,
  UserRole,
  Tenant,
  SubscriptionPlan,
} from '@/modules/core/lib/data';
import {
  ROLES as ROLES_DEFAULT,
  Permission,
  PLANS,
} from '@/modules/core/lib/permissions';

interface AuthContextType {
  user: User | null;
  supabaseUser: any | null;
  authLoading: boolean;
  tenants: Tenant[];
  currentTenantId: string | null;
  subscription: SubscriptionPlan | null;
  login: (identifier: string, pass: string) => Promise<any>;
  logout: () => void;
  sendPasswordReset: (email: string) => Promise<void>;
  reauthenticateAndChangeEmail: (
    currentPass: string,
    newEmail: string
  ) => Promise<void>;
  reauthenticateAndChangePassword: (
    currentPass: string,
    newPass: string
  ) => Promise<void>;
  can: (permission: Permission) => boolean;
  setCurrentTenantId: (tenantId: string | null) => void;
  getTenantId: () => string | null;
  pageHeader: { title: string; description?: string };
  setPageHeader: React.Dispatch<React.SetStateAction<{ title: string; description?: string; }>>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<any | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenantId, _setCurrentTenantId] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionPlan | null>(null);
  const [pageHeader, setPageHeader] = useState<{ title: string; description?: string; }>({ title: 'Dashboard', description: 'Bienvenido' });
  const router = useRouter();

  const can = useCallback(
    (permission: Permission): boolean => {
      if (!user) return false;
      if (user.role === 'super-admin') return true;
      if (user.grantedPermissions?.includes(permission)) return true;
      const userPermissions = ROLES_DEFAULT[user.role]?.permissions;
      return !!userPermissions?.includes(permission);
    },
    [user]
  );

  const setCurrentTenantId = (tenantId: string | null) => {
    _setCurrentTenantId(tenantId);
    if (user?.role === 'super-admin') {
      if (tenantId) {
        localStorage.setItem("selectedTenantId", tenantId);
      } else {
        localStorage.removeItem("selectedTenantId");
      }
    }
  };

  useEffect(() => {
    // isCurrent guards against Strict Mode double-invoke: when the effect cleanup
    // runs, we flip this so any in-flight async work from the first invocation is
    // discarded before the second subscription takes over.
    let isCurrent = true;

    // Small delay lets any in-flight getSession() from a previous Strict Mode
    // unmount release its Web Lock before we register a new subscriber.
    // This prevents the "Lock not released within 5000ms" orphaned-lock warning.
    const LOCK_SETTLE_MS = 50;
    let authSubscription: { unsubscribe: () => void } = { unsubscribe: () => {} };

    const setup = () => {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!isCurrent) return;
        handleAuthChange(session);
      });
      authSubscription = data.subscription;
    };

    const timer = setTimeout(setup, LOCK_SETTLE_MS);

    const handleAuthChange = async (session: any) => {
      if (!isCurrent) return;
      try {
        const sbUser = session?.user || null;

        // Only set loading if the session actually changed to avoid UI flickering
        if (!user || (sbUser && sbUser.id !== user.id)) {
          setAuthLoading(true);
        }

        setSupabaseUser(sbUser);

        if (sbUser) {
          // Add timeout to prevent hanging on RLS policy circular dependencies
          const fetchUserProfileWithTimeout = async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

            try {
              const { data: userData, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', sbUser.id)
                .maybeSingle();

              clearTimeout(timeoutId);
              return { userData, profileError };
            } catch (error) {
              clearTimeout(timeoutId);
              throw error;
            }
          };

          try {
            const { userData, profileError } = await fetchUserProfileWithTimeout();

            if (userData && (userData.tenant_id || userData.role === 'super-admin')) {
              const mappedUser: User = {
                id: userData.id,
                name: userData.name,
                email: userData.email,
                role: userData.role,
                qrCode: userData.qr_code,
                tenantId: userData.tenant_id,
                rut: userData.rut,
                internalId: userData.internal_id,
                cargo: userData.cargo,
                phone: userData.phone,
                fechaIngreso: userData.fecha_ingreso ? new Date(userData.fecha_ingreso) : null,
                baseSalary: userData.base_salary,
                afp: userData.afp,
                tipoSalud: userData.tipo_salud,
                cargasFamiliares: userData.cargas_familiares,
                signature: userData.signature,
                onboardingCompleted: userData.onboarding_completed,
                grantedPermissions: userData.granted_permissions || []
              };

              setUser(mappedUser);
              if (userData.role !== 'super-admin') {
                _setCurrentTenantId(userData.tenant_id);
              } else {
                const savedTenantId = localStorage.getItem('selectedTenantId');
                const isValidUuid = savedTenantId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(savedTenantId);
                if (savedTenantId && !isValidUuid) {
                  localStorage.removeItem('selectedTenantId');
                }
                _setCurrentTenantId(isValidUuid ? savedTenantId : null);
              }
            } else {
              // OAuth user with no profile yet — send them to register their company
              const isOAuthUser = sbUser.app_metadata?.provider && sbUser.app_metadata.provider !== 'email';
              if (isOAuthUser && !window.location.pathname.startsWith('/register')) {
                setUser(null);
                _setCurrentTenantId(null);
                window.location.href = '/register?oauth=1';
              } else {
                console.error("Profile not found for user", sbUser.id, profileError);
                setUser(null);
                _setCurrentTenantId(null);
              }
            }
          } catch (timeoutError) {
            console.warn("Profile query timeout - allowing session to persist", timeoutError);
            // Allow auth state to persist without profile data
            // User will retry profile fetch on navigation
            setUser(null);
            _setCurrentTenantId(null);
          }
        } else {
          setUser(null);
          _setCurrentTenantId(null);
        }
      } catch (error) {
        console.error("Error in onAuthStateChange:", error);
        setUser(null);
        _setCurrentTenantId(null);
      } finally {
        setAuthLoading(false);
      }
    };

    return () => {
      isCurrent = false;
      clearTimeout(timer);
      authSubscription.unsubscribe();
    };
  }, []);

  // Live-sync the logged-in user's own profile row so name/phone/etc
  // updates are reflected everywhere without a page reload.
  useEffect(() => {
    if (!supabaseUser?.id) return;

    const channel = supabase
      .channel(`own-profile-${supabaseUser.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${supabaseUser.id}`,
      }, (payload) => {
        const p = payload.new as any;
        if (!p) return;
        setUser(prev => prev ? {
          ...prev,
          name: p.name ?? prev.name,
          email: p.email ?? prev.email,
          role: p.role ?? prev.role,
          phone: p.phone ?? prev.phone,
          cargo: p.cargo ?? prev.cargo,
          rut: p.rut ?? prev.rut,
          baseSalary: p.base_salary ?? prev.baseSalary,
          afp: p.afp ?? prev.afp,
          tipoSalud: p.tipo_salud ?? prev.tipoSalud,
          cargasFamiliares: p.cargas_familiares ?? prev.cargasFamiliares,
          signature: p.signature ?? prev.signature,
          grantedPermissions: p.granted_permissions ?? prev.grantedPermissions,
          onboardingCompleted: p.onboarding_completed ?? prev.onboardingCompleted,
          biometric_template: p.biometric_template ?? prev.biometric_template,
          kyc_face_image: p.kyc_face_image ?? prev.kyc_face_image,
        } : prev);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabaseUser?.id]);

  useEffect(() => {
    if (user?.role === 'super-admin') {
      const fetchTenants = async () => {
        const { data, error } = await supabase.from('tenants').select('*');
        if (data) {
          setTenants(data.map(t => ({
            id: t.id,
            name: t.name,
            tenantId: t.tenant_id,
            createdAt: t.created_at,
            plan: t.plan,
            criticalitySettings: t.criticality_settings,
            faenas: t.faenas || [],
            rut: t.rut,
            legalRepresentative: t.legal_representative,
            legalRepresentativeRut: t.legal_representative_rut,
            address: t.address,
          })) as Tenant[]);

          const saved = localStorage.getItem("selectedTenantId");
          if (saved && data.some(t => t.id === saved)) {
            _setCurrentTenantId(saved);
          } else {
            _setCurrentTenantId(null);
          }
        }
      };

      fetchTenants();

      // Set up real-time subscription for tenants
      const channel = supabase
        .channel('public:tenants')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, (payload) => {
          fetchTenants();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setTenants([]);
    }
  }, [user]);

  useEffect(() => {
    const tenantToUse =
      user?.role === 'super-admin' ? currentTenantId : user?.tenantId;
    if (tenantToUse) {
      const fetchSubscription = async () => {
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('tenant_id', tenantToUse)
          .maybeSingle();

        if (data) {
          setSubscription(data as SubscriptionPlan);
        } else {
          setSubscription(PLANS.professional as SubscriptionPlan);
        }
      };

      fetchSubscription();

      const channel = supabase
        .channel(`public:subscriptions:tenant_id=eq.${tenantToUse}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions', filter: `tenant_id=eq.${tenantToUse}` }, (payload) => {
          fetchSubscription();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else if (user?.role === 'super-admin') {
      setSubscription(PLANS.enterprise as SubscriptionPlan);
    } else {
      setSubscription(null);
    }
  }, [currentTenantId, user]);

  const getTenantId = useCallback(() => {
    if (!user) return null;
    return user.role === 'super-admin' ? currentTenantId : user.tenantId;
  }, [user, currentTenantId]);

  const login = async (identifier: string, pass: string) => {
    setAuthLoading(true);
    let loginEmail = identifier.trim();

    // Si es un RUT (contiene guion y no es un correo)
    if (!identifier.includes('@') && identifier.includes('-')) {
      const { data, error: rutError } = await supabase
        .from('profiles')
        .select('email')
        .eq('rut', identifier.trim())
        .maybeSingle();

      if (rutError) {
        console.error("[Auth] Error resolving RUT:", rutError);
      }

      if (data?.email) {
        loginEmail = data.email;
      } else {
        // Si no se encuentra el correo por RUT, intentamos con el identificador tal cual
        // pero registramos la advertencia.
        console.warn("[Auth] No email found for RUT:", identifier);
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.toLowerCase(),
      password: pass,
    });

    if (error) {
      console.error("[Auth] Login failed for:", loginEmail, error.message);
      setAuthLoading(false); // onAuthStateChange no dispara en logins fallidos
      throw error;
    }
    return data;
  };

  const logout = () =>
    supabase.auth.signOut().then(() => {
      setUser(null);
      setCurrentTenantId(null);
      localStorage.removeItem("selectedTenantId");
      window.location.href = '/login';
    });

  const sendPasswordReset = async (email: string) => {
    // Uses our own API route so the email is sent from hola@teolabs.app
    // via Nodemailer instead of Supabase's default SMTP.
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.toLowerCase().trim() }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'No se pudo enviar el correo.');
    }
  };

  const reauthenticateAndChangeEmail = async (
    currentPass: string,
    newEmail: string
  ) => {
    const emailToUse = user?.email || supabaseUser?.email;
    if (!emailToUse) throw new Error("No hay un correo electrónico asociado a esta sesión.");
    
    console.log('[Auth] Re-authenticating for email change:', emailToUse);
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password: currentPass,
    });
    
    if (reauthError) {
      console.error('[Auth] Re-authentication failed:', reauthError);
      throw reauthError;
    }

    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) throw error;

    // Update local profile
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ email: newEmail })
      .eq('id', supabaseUser.id);

    if (profileError) throw profileError;
  };

  const reauthenticateAndChangePassword = async (
    currentPass: string,
    newPass: string
  ) => {
    const emailToUse = user?.email || supabaseUser?.email;
    if (!emailToUse) throw new Error("No hay un correo electrónico asociado a esta sesión.");

    console.log('[Auth] Re-authenticating for password change:', emailToUse);
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password: currentPass,
    });

    if (reauthError) {
      console.error('[Auth] Re-authentication failed:', reauthError);
      throw reauthError;
    }

    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) throw error;
  };

  const value = {
    user,
    supabaseUser,
    authLoading,
    tenants,
    currentTenantId,
    setCurrentTenantId,
    subscription,
    login,
    logout,
    sendPasswordReset,
    can,
    getTenantId,
    reauthenticateAndChangeEmail,
    reauthenticateAndChangePassword,
    pageHeader,
    setPageHeader,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
