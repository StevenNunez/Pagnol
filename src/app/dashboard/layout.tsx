'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { DataProvider } from '@/modules/data/DataProvider';
import { useAuth } from '@/modules/auth/useAuth';
import { useAppState } from '@/modules/data/useData';
import { Sidebar } from '@/components/sidebar';
import { Menu, Loader2, Bell, Volume2, VolumeX, AlertCircle, ShoppingCart, ClipboardList, Users, LogOut, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { differenceInDays, startOfDay } from 'date-fns';
import { UserRole, type SupplierPayment, type MaterialRequest, type PurchaseRequest, type Supplier, type Tenant } from '@/modules/core/lib/data';
import { ROLES } from '@/modules/core/lib/permissions';
import { InventoryAssistant } from '@/components/assistant/inventory-assistant';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { FeedbackButton } from '@/components/feedback-button';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { OnboardingBanner } from '@/components/onboarding-banner';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { BellRing } from 'lucide-react';

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, authLoading, logout, tenants, currentTenantId, setCurrentTenantId, pageHeader, getTenantId } = useAuth();
  const {
    requests,
    purchaseRequests,
    supplierPayments,
    suppliers,
    purchaseOrders,
    can,
  } = useAppState();
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [isMuted, setIsMuted] = React.useState(false);
  const [isClient, setIsClient] = React.useState(false);
  const [authTimeout, setAuthTimeout] = React.useState(false);

  const { permission: pushPermission, isSubscribed, subscribe: subscribePush } = usePushNotifications(
    user?.id,
    getTenantId() ?? undefined
  );

  const today = startOfDay(new Date());

  // Determine if the current page is the main dashboard hub
  const isDashboardHub = pathname === '/dashboard';

  // Intercept Supabase auth errors that arrive as hash fragments (e.g. after a
  // failed password-reset link clicks through to the site URL instead of /update-password).
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (hash.includes('error=')) {
      window.history.replaceState(null, '', window.location.pathname);
      router.replace('/update-password' + hash);
    }
  }, [router]);

  React.useEffect(() => {
    setIsClient(true);
    console.log('[DashboardLayout] authLoading:', authLoading, '| user:', !!user, '| path:', pathname);

    let timer: NodeJS.Timeout;
    if (authLoading && !user) {
      timer = setTimeout(() => {
        setAuthTimeout(true);
      }, 7000); // 7 seconds timeout for recovery
    } else {
      setAuthTimeout(false);
    }

    if (!authLoading && !user) {
      console.log('[DashboardLayout] No user found, redirecting to /login');
      router.replace('/login');
    }

    return () => clearTimeout(timer);
  }, [user, authLoading, router, pathname]);

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const getRoleDisplayName = (role: UserRole) => {
    return ROLES[role]?.label || role;
  };

  const parseDate = (d: any) => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (d && typeof d === 'object' && 'seconds' in d) {
      return new Date(d.seconds * 1000);
    }
    return new Date(d);
  };

  const overduePayments = React.useMemo(() => (supplierPayments || []).filter((p: SupplierPayment) => {
    if (p.status === 'paid') return false;
    const dueDate = parseDate(p.dueDate);
    return differenceInDays(dueDate, today) < 0;
  }), [supplierPayments, today]);

  const dueSoonPayments = React.useMemo(() => (supplierPayments || []).filter((p: SupplierPayment) => {
    if (p.status === 'paid') return false;
    const dueDate = parseDate(p.dueDate);
    const daysLeft = differenceInDays(dueDate, today);
    return daysLeft >= 0 && daysLeft <= 7;
  }), [supplierPayments, today]);

  const pendingMaterialRequests = React.useMemo(() => (requests || []).filter((r: MaterialRequest) => r.status === 'pending').length, [requests]);
  const pendingPurchaseRequests = React.useMemo(() => (purchaseRequests || []).filter((pr: PurchaseRequest) => pr.status === 'pending').length, [purchaseRequests]);
  const pendingCotizaciones = React.useMemo(() => (purchaseOrders || []).filter(po => po.status === 'generated').length, [purchaseOrders]);

  const totalNotifications = React.useMemo(() => {
    let count = 0;
    if (can('material_requests:approve_class_c')) count += pendingMaterialRequests;
    if (can('purchase_requests:approve')) count += pendingPurchaseRequests;
    if (can('payments:view')) {
      count += overduePayments.length;
      count += dueSoonPayments.length;
    }
    if (can('finance:manage_purchase_orders')) {
      count += pendingCotizaciones;
    }
    return count;
  }, [can, pendingMaterialRequests, pendingPurchaseRequests, overduePayments, dueSoonPayments, pendingCotizaciones]);

  const supplierMap = React.useMemo(() => new Map<string, string>((suppliers || []).map((s: Supplier) => [s.id, s.name])), [suppliers]);

  const prevNotificationsRef = React.useRef<number | null>(null);

  const playNotificationSound = React.useCallback(() => {
    if (isMuted || typeof window === 'undefined') return;
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const audioContext = new AudioContext();
    function playTone(frequency: number, startTime: number, duration: number) {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, startTime);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.6, startTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    }
    const now = audioContext.currentTime;
    playTone(980, now, 0.15);
    playTone(780, now + 0.2, 0.15);
  }, [isMuted]);

  React.useEffect(() => {
    const prev = prevNotificationsRef.current;
    if (prev !== null && totalNotifications > prev) {
      playNotificationSound();
    }
    prevNotificationsRef.current = totalNotifications;
    if ('setAppBadge' in navigator) {
      (navigator as any).setAppBadge(totalNotifications).catch((e: any) => console.error('Error setting app badge:', e));
    }
  }, [totalNotifications, playNotificationSound]);

  if (!isClient || (authLoading && !user)) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center p-6" role="status" aria-live="polite">
          <Loader2 className="h-10 w-10 animate-spin text-primary opacity-50" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Verificando credenciales...</p>
            <p className="text-xs text-muted-foreground">Esto no debería tomar más de unos segundos.</p>
          </div>
          {authTimeout && (
            <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-950/40 rounded-xl border border-orange-100 dark:border-orange-900/60 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-3">La sesión está tardando más de lo esperado en sincronizar.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                className="bg-white dark:bg-transparent border-orange-200 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30"
              >
                Reintentar Sincronización
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!user) return null; // Wait for redirect in useEffect if user is still missing after authLoading

  return (
    <div className={cn(
      'grid w-full h-screen overflow-hidden bg-background',
      !isDashboardHub && 'md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]'
    )}>
      {!isDashboardHub && (
        <div className="hidden md:block border-r border-slate-200 dark:border-slate-800">
          <Sidebar onLinkClick={() => setIsSidebarOpen(false)} />
        </div>
      )}

      <div className="flex flex-col overflow-hidden relative bg-background">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background/80 backdrop-blur-md px-4 lg:h-[64px] lg:px-8 sticky top-0 z-30">
          {!isDashboardHub && (
            <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0 md:hidden bg-slate-100 dark:bg-slate-800 rounded-xl" aria-label="Abrir menú de navegación">
                  <Menu className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  <span className="sr-only">Abrir menú de navegación</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col p-0 border-none bg-transparent">
                <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
                <Sidebar onLinkClick={() => setIsSidebarOpen(false)} />
              </SheetContent>
            </Sheet>
          )}

          <div className="flex-1 overflow-hidden">
            <h1 className="text-xl font-black tracking-tight text-[#204A57] dark:text-slate-100 uppercase truncate">{pageHeader.title}</h1>
            {pageHeader.description && (
              <div className="flex items-center gap-2 mt-0.5 overflow-hidden">
                <div className="w-1.5 h-1.5 rounded-full bg-pagnol-orange shrink-0 shadow-[0_0_8px_rgba(241,90,36,0.4)]"></div>
                <p className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-widest truncate">{pageHeader.description}</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <ThemeSwitcher />
            {pushPermission !== 'unsupported' && !isSubscribed && pushPermission !== 'denied' && (
              <Button
                variant="ghost"
                size="icon"
                title="Activar notificaciones push"
                onClick={subscribePush}
                className="rounded-xl hover:bg-orange-50 dark:hover:bg-orange-950/30 text-pagnol-orange animate-pulse"
              >
                <BellRing className="h-5 w-5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setIsMuted(!isMuted)}>
              {isMuted ? <VolumeX className="h-5 w-5 text-muted-foreground" /> : <Volume2 className="h-5 w-5 text-muted-foreground" />}
              <span className="sr-only">{isMuted ? 'Activar sonido' : 'Silenciar'}</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800">
                  <Bell className="h-5 w-5 text-muted-foreground dark:text-slate-400" />
                  {totalNotifications > 0 && (
                    <span className="absolute top-2 right-2 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full"></span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 rounded-2xl shadow-3xl border-slate-100 dark:border-slate-800 dark:bg-slate-900 p-2">
                <DropdownMenuLabel className="px-4 py-3 text-xs font-black uppercase tracking-widest text-muted-foreground">Notificaciones</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-slate-50" />
                <div className="max-h-[400px] overflow-y-auto no-scrollbar">
                  {totalNotifications === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Bell className="h-10 w-10 text-slate-100 mx-auto mb-2" />
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Sin novedades</p>
                    </div>
                  ) : (
                    <div className="py-2 space-y-1">
                      {can('finance:manage_purchase_orders') && pendingCotizaciones > 0 && (
                        <Link href="/dashboard/payments/pago-facturas">
                          <DropdownMenuItem className="rounded-xl px-4 py-3 cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-950/40">
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg mr-3"><FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /></div>
                            <span className="text-[11px] font-bold uppercase tracking-tight">{pendingCotizaciones} Cotizaciones por Procesar</span>
                          </DropdownMenuItem>
                        </Link>
                      )}
                      {can('purchase_requests:approve') && pendingPurchaseRequests > 0 && (
                        <Link href="/dashboard/purchasing/purchase-requests">
                          <DropdownMenuItem className="rounded-xl px-4 py-3 cursor-pointer hover:bg-cyan-50/50 dark:hover:bg-cyan-950/40">
                            <div className="p-2 bg-cyan-100 dark:bg-cyan-900/50 rounded-lg mr-3"><ShoppingCart className="h-4 w-4 text-cyan-600 dark:text-cyan-400" /></div>
                            <span className="text-[11px] font-bold uppercase tracking-tight">{pendingPurchaseRequests} Solicitudes de Compra</span>
                          </DropdownMenuItem>
                        </Link>
                      )}
                      {can('material_requests:approve_class_c') && pendingMaterialRequests > 0 && (
                        <Link href="/dashboard/bodega/requests">
                          <DropdownMenuItem className="rounded-xl px-4 py-3 cursor-pointer hover:bg-purple-50/50 dark:hover:bg-purple-950/40">
                            <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg mr-3"><ClipboardList className="h-4 w-4 text-purple-600 dark:text-purple-400" /></div>
                            <span className="text-[11px] font-bold uppercase tracking-tight">{pendingMaterialRequests} Solicitudes de Material</span>
                          </DropdownMenuItem>
                        </Link>
                      )}
                      {can('payments:view') && overduePayments.length > 0 && (
                        <Link href="/dashboard/payments">
                          <DropdownMenuItem className="rounded-xl px-4 py-3 cursor-pointer hover:bg-red-50/50 dark:hover:bg-red-950/40">
                            <div className="p-2 bg-red-100 dark:bg-red-900/50 rounded-lg mr-3"><AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" /></div>
                            <span className="text-[11px] font-bold uppercase tracking-tight">{overduePayments.length} Pagos Vencidos</span>
                          </DropdownMenuItem>
                        </Link>
                      )}
                      {can('payments:view') && dueSoonPayments.length > 0 && (
                        <Link href="/dashboard/payments">
                          <DropdownMenuItem className="rounded-xl px-4 py-3 cursor-pointer hover:bg-orange-50/50 dark:hover:bg-orange-950/40">
                            <div className="p-2 bg-orange-100 dark:bg-orange-900/50 rounded-lg mr-3"><AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" /></div>
                            <span className="text-[11px] font-bold uppercase tracking-tight">{dueSoonPayments.length} Pagos por Vencer</span>
                          </DropdownMenuItem>
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 p-1 pl-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors rounded-full border border-slate-200 dark:border-slate-800 group">
                  <div className="flex flex-col items-end hidden sm:flex">
                    <span className="text-[10px] font-black uppercase text-slate-700 dark:text-slate-200 leading-none">{user?.name?.split(' ')[0] || 'User'}</span>
                    <span className="text-[8px] font-bold text-muted-foreground group-hover:text-pagnol-orange transition-colors uppercase mt-0.5 tracking-tighter">{getRoleDisplayName(user.role)}</span>
                  </div>
                  <Avatar className="h-8 w-8 border-2 border-white shadow-sm">
                    <AvatarFallback className="bg-pagnol-orange text-white text-[10px] font-black">{getInitials(user?.name || '')}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-2xl shadow-3xl border-slate-100 p-2 mt-2">
                <DropdownMenuLabel className="p-4 bg-slate-50 rounded-xl mb-2">
                  <p className="font-black text-xs uppercase tracking-tight">{user.name}</p>
                  <p className="text-[10px] text-muted-foreground font-bold truncate">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-slate-50" />
                <DropdownMenuItem asChild className="rounded-xl px-4 py-2.5 mt-1 cursor-pointer">
                  <Link href="/dashboard/profile" className="flex items-center gap-3">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600">Mi Perfil</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-50" />
                <DropdownMenuItem onClick={logout} className="rounded-xl px-4 py-2.5 mt-1 cursor-pointer text-red-500 hover:bg-red-50 focus:bg-red-50">
                  <LogOut className="h-4 w-4 mr-3" />
                  <span className="text-[11px] font-black uppercase tracking-widest">Cerrar Sesión</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto no-scrollbar relative">
          <OnboardingBanner />
          <div className="p-4 sm:p-6 lg:p-10 max-w-[1600px] mx-auto animate-in fade-in duration-500">
            {children}
          </div>
          <InventoryAssistant />
          <FeedbackButton />
          <OnboardingWizard />
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </DataProvider>
  );
}
