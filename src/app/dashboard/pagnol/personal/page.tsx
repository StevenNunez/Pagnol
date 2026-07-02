
"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";
import { User, UserRole, MaterialRequest, ReturnRequest, Tenant } from "@/modules/core/lib/data";
import { supabase } from "@/modules/core/lib/supabase";
import { generateEAPDF } from "@/lib/ea-pdf-generator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ROLES } from "@/modules/core/lib/permissions";
import { generateUserInternalId } from "@/modules/core/lib/user-internal-id";
import { UserPermissionsEditor } from "@/components/user-permissions-editor";
import {
  Fingerprint, UserPlus, Mail, ShieldCheck, Search, X,
  User as UserIcon, FileText, CheckCircle, AlertCircle,
  Grid, List, History, ArrowUpRight, ArrowDownLeft,
  ScanFace, Lock, Download, Printer, Package, ClipboardList,
  Building2, Calendar, AlertTriangle, Send, Pencil, CheckCheck
} from 'lucide-react';
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EnrollmentWizard } from '@/components/enrollment-wizard';

// Cuentas de plataforma que no son "personal de faena": se ocultan de Gestión de Personal
// para todos salvo super-admin (que ve todo).
const platformRoles = new Set<UserRole>(["super-admin", "soporte-pagnol"]);



type DisplayTransaction = {
  id: string;
  type: "WITHDRAWAL" | "RETURN";
  timestamp: string;
  assetIds: string[];
  site: string;
  isApproved: boolean;
  employeeId: string;
  contractUrl?: string | null;
};

export default function PersonalPage() {
  const { users, requests, returnRequests, materials, addUser, enrollUser, eaDocuments, generateEADocument, confirmEASentToDT, updateTenant } = useAppState();
  const { user: currentUser, can } = useAuth();
  const { toast } = useToast();

  // Datos legales del tenant (cargados una vez al montar)
  const [currentTenant, setCurrentTenant] = useState<Partial<Tenant> | null>(null);
  const [tenantLegalForm, setTenantLegalForm] = useState({ rut: '', legalRepresentative: '', legalRepresentativeRut: '', address: '' });
  const [isSavingTenant, setIsSavingTenant] = useState(false);
  const [showTenantForm, setShowTenantForm] = useState(false);
  const [eaGenerating, setEAGenerating] = useState(false);
  const [eaConfirming, setEAConfirming] = useState(false);
  const [eaTab, setEaTab] = useState<'acta' | 'historial'>('acta');

  useEffect(() => {
    const tenantId = currentUser?.tenantId;
    if (!tenantId) return;
    supabase.from('tenants').select('id, name, rut, legal_representative, legal_representative_rut, address')
      .eq('id', tenantId).single()
      .then(({ data }) => {
        if (data) {
          const t: Partial<Tenant> = {
            id: data.id,
            name: data.name,
            rut: data.rut || '',
            legalRepresentative: data.legal_representative || '',
            legalRepresentativeRut: data.legal_representative_rut || '',
            address: data.address || '',
          };
          setCurrentTenant(t);
          setTenantLegalForm({
            rut: data.rut || '',
            legalRepresentative: data.legal_representative || '',
            legalRepresentativeRut: data.legal_representative_rut || '',
            address: data.address || '',
          });
        }
      });
  }, [currentUser?.tenantId]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUserForEnrollment, setSelectedUserForEnrollment] = useState<User | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedEmployeeForHistory, setSelectedEmployeeForHistory] = useState<User | null>(null);
  // Documentos KYC del empleado seleccionado (tabla protegida profile_documents).
  // RLS solo deja leerlos al dueño o a un admin del tenant; ya no viajan en el collection.
  const [employeeDocs, setEmployeeDocs] = useState<{ kyc_face_image?: string | null; kyc_id_front?: string | null; kyc_id_back?: string | null } | null>(null);

  useEffect(() => {
    const id = selectedEmployeeForHistory?.id;
    if (!id) { setEmployeeDocs(null); return; }
    setEmployeeDocs(null);
    supabase
      .from('profile_documents')
      .select('kyc_face_image, kyc_id_front, kyc_id_back')
      .eq('profile_id', id)
      .maybeSingle()
      .then(({ data }) => setEmployeeDocs(data ?? null));
  }, [selectedEmployeeForHistory?.id]);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);
  const [selectedUserForPermissions, setSelectedUserForPermissions] = useState<User | null>(null);
  const [permissionsOverride, setPermissionsOverride] = useState<Map<string, string[]>>(new Map());

  const getEffectivePermissions = (emp: User): string[] =>
    permissionsOverride.get(emp.id) ?? emp.grantedPermissions ?? [];

  // EA Modal state
  const [isEAModalOpen, setIsEAModalOpen] = useState(false);
  const [selectedEmployeeForEA, setSelectedEmployeeForEA] = useState<User | null>(null);

  // Puede enrolar quien gestiona usuarios O tiene el permiso específico de enrolar
  // (p.ej. Calidad, sin control total de usuarios).
  const canManageEmployees = can('users:create') || can('pagnol:enroll_personal');
  const canDelegatePermissions = can('permissions:manage');

  const generateInternalId = useCallback(() => generateUserInternalId(users), [users]);

  const handleOpenEnrollment = (emp?: User) => {
    setSelectedUserForEnrollment(emp || null);
    setIsModalOpen(true);
  };


  const filteredUsers = useMemo(() => {
    let userList: User[] = users || [];

    // Si el usuario actual no es super-admin, ocultamos solo las cuentas de plataforma
    // (super-admin/soporte-pagnol). Todo el resto del personal del tenant se muestra,
    // incluidos los invitados con cualquier rol del plan.
    if (currentUser?.role !== 'super-admin') {
      userList = userList.filter(emp => !platformRoles.has(emp.role));
    }

    // Aplicamos el filtro de búsqueda de texto
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      userList = userList.filter(emp =>
        emp.name.toLowerCase().includes(lowerFilter) ||
        (emp.rut || "").toLowerCase().includes(lowerFilter) ||
        (emp.internalId || "").toLowerCase().includes(lowerFilter)
      );
    }

    return userList;
  }, [users, filter, currentUser]);

  const transactions = useMemo(() => {
    const allTransactions: DisplayTransaction[] = [];
    (requests || []).forEach((r: MaterialRequest) => {
      allTransactions.push({
        id: r.id,
        type: 'WITHDRAWAL',
        timestamp: (r.createdAt as any)?.toDate ? (r.createdAt as any).toDate().toISOString() : new Date(r.createdAt as any).toISOString(),
        assetIds: (r.items || []).map(i => i.materialId),
        site: r.area,
        isApproved: r.status === 'approved',
        employeeId: r.supervisorId,
        contractUrl: r.contractUrl,
      });
    });
    (returnRequests || []).forEach((r: ReturnRequest) => {
      allTransactions.push({
        id: r.id,
        type: 'RETURN',
        timestamp: (r.createdAt as any)?.toDate ? (r.createdAt as any).toDate().toISOString() : new Date(r.createdAt as any).toISOString(),
        assetIds: [r.materialId],
        site: "Bodega",
        isApproved: r.status === 'completed',
        employeeId: r.supervisorId,
      });
    });
    return allTransactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [requests, returnRequests]);

  const materialsMap = useMemo(() => new Map((materials || []).map(a => [a.id, a])), [materials]);
  const getRoleDisplayName = (role: UserRole) => ROLES[role]?.label || role;

  const handleOpenPermissions = (emp: User) => {
    setSelectedUserForPermissions(emp);
    setIsPermissionsModalOpen(true);
  };


  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <PageHeader title="Gestión de Personal" description="Enrola, gestiona y consulta el historial de los trabajadores de la faena." />
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
        <div className="flex items-center gap-3 bg-card p-2 rounded-[1.5rem] border shadow-sm">
          <button onClick={() => setViewMode('grid')} className={`p-3 rounded-[1rem] transition-all ${viewMode === 'grid' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground'}`}><Grid size={20} /></button>
          <button onClick={() => setViewMode('list')} className={`p-3 rounded-[1rem] transition-all ${viewMode === 'list' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground'}`}><List size={20} /></button>
        </div>
        <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
          <div className="relative w-full md:w-[400px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input type="text" placeholder="Buscar por RUT, Nombre o ID..."
              className="pl-12 pr-6 py-4 h-12 bg-card border rounded-[1.5rem] focus:ring-4 focus:ring-primary/10 w-full"
              value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {canManageEmployees && (
            <Button onClick={() => handleOpenEnrollment()} className="w-full md:w-auto shrink-0 flex items-center justify-center gap-3 px-8 py-5 sm:py-4 rounded-[1.5rem] transform hover:scale-105 active:scale-95 shadow-lg shadow-primary/10">
              <UserPlus size={18} /> Enrolar Nuevo Empleado
            </Button>
          )}
        </div>
      </div>
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 pb-20">
          {filteredUsers.length === 0 ? (
            <div className="col-span-full py-20 text-center bg-card rounded-[2.5rem] border border-dashed">
              <UserIcon size={48} className="mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">No se encontraron empleados</p>
            </div>
          ) : (
            filteredUsers.map(emp => (
              <Card key={emp.id} className="p-8 rounded-[2.5rem] border-none shadow-xl shadow-black/5 bg-card flex flex-col justify-between h-full gap-6 group hover:shadow-2xl transition-all duration-500">
                <div>
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-5">
                      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center text-xl font-black text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-all duration-300 uppercase shrink-0">
                        {emp?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                      </div>
                      <div>
                        <h4 className="font-black text-foreground text-lg uppercase tracking-tight leading-tight line-clamp-2">{emp.name}</h4>
                        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-1">{emp.internalId}</p>
                      </div>
                    </div>
                    <div className={`p-3 rounded-2xl shrink-0 ${emp.biometric_template ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground/50'}`} title={emp.biometric_template ? 'Biometría enrolada' : 'Falta enrolar'}>
                      <Fingerprint size={24} />
                    </div>
                  </div>
                  <div className="space-y-3 px-1">
                    <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground">
                      <ShieldCheck size={16} /> <span>RUT: {emp.rut || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground">
                      <Mail size={16} /> <span className="truncate" title={emp.email}>{emp.email}</span>
                    </div>
                    {emp.enrolledBy && (
                      <div className="flex items-center gap-2 text-[9px] font-bold text-muted-foreground mt-2 bg-muted p-2 rounded-xl border">
                        <ShieldCheck size={12} className="text-pagnol-orange" />
                        <span className="leading-tight">Autorizado por: <b className="text-muted-foreground">{emp.enrolledBy}</b> el {new Date(emp.enrolledAt!).toLocaleDateString('es-CL')}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex gap-2">
                    {canDelegatePermissions && emp.id !== currentUser?.id && (() => {
                      const hasEnrollPerm = getEffectivePermissions(emp).includes('pagnol:enroll_personal');
                      return (
                        <Button
                          onClick={() => handleOpenPermissions(emp)}
                          variant="outline"
                          className={`flex-1 py-1 h-9 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${hasEnrollPerm
                            ? 'border-success/30 text-success-subtle-foreground bg-success-subtle hover:bg-success/10'
                            : 'border-pagnol-orange/20 text-pagnol-orange hover:bg-pagnol-orange/5'
                            }`}
                        >
                          {hasEnrollPerm ? <><CheckCircle size={12} /> Aprobado</> : <><Lock size={12} /> Permisos</>}
                        </Button>
                      );
                    })()}
                    <Button
                      onClick={() => { setSelectedEmployeeForEA(emp); setIsEAModalOpen(true); }}
                      variant="outline"
                      className="flex-1 py-1 h-9 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 border-info/30 text-info hover:bg-info-subtle"
                    >
                      <ClipboardList size={12} /> Acta EA
                    </Button>
                  </div>
                  {canManageEmployees && (
                    <Button
                      onClick={() => !emp.biometric_template && handleOpenEnrollment(emp)}
                      variant={emp.biometric_template ? 'ghost' : 'default'}
                      className={`w-full py-1 h-10 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all
                        ${emp.biometric_template
                          ? 'bg-success-subtle text-success-subtle-foreground hover:bg-success/10 cursor-default border border-success/30'
                          : 'bg-foreground text-background shadow-xl shadow-black/10 hover:bg-foreground/90'
                        }`}>
                      {emp.biometric_template ? <CheckCircle size={16} /> : <ScanFace size={16} />}
                      {emp.biometric_template ? 'Personal Enrolado Biométricamente' : 'Iniciar Enrolamiento Biométrico'}
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      ) : (
        <Card className="rounded-[2.5rem] border-none shadow-2xl shadow-black/5 bg-card overflow-hidden">
          <div className="overflow-x-auto no-scrollbar">
            <Table>
              <TableHeader className="min-w-[1000px]">
                <TableRow>
                  <TableHead>Personal / Identificación</TableHead><TableHead>RUT</TableHead><TableHead>ID Interno</TableHead>
                  <TableHead>Rol</TableHead><TableHead>Estado Biométrico</TableHead><TableHead className="text-center">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map(emp => (
                  <TableRow key={emp.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-xs font-black text-muted-foreground uppercase shrink-0">
                          {emp?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                        </div>
                        <div>
                          <div className="font-bold text-sm uppercase tracking-tight">{emp.name}</div>
                          <div className="text-[9px] text-muted-foreground font-bold uppercase mt-0.5">{emp.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{emp.rut}</TableCell>
                    <TableCell className="text-xs font-mono tracking-widest">{emp.internalId}</TableCell>
                    <TableCell><Badge variant="outline">{getRoleDisplayName(emp.role)}</Badge></TableCell>
                    <TableCell>
                      <div className={`flex items-center gap-2 text-[9px] font-black uppercase tracking-widest ${emp.biometric_template ? 'text-success' : 'text-muted-foreground'}`}>
                        <ScanFace size={14} /> {emp.biometric_template ? 'Enrolado / Activo' : 'Pendiente'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-3">
                        {/* <Button variant="ghost" size="icon" onClick={() => handleOpenHistory(emp)} title="Ver Historial"><History size={18} /></Button> */}
                        {canDelegatePermissions && emp.id !== currentUser?.id && (
                          <Button variant="ghost" size="icon" onClick={() => handleOpenPermissions(emp)} className="text-pagnol-orange" title="Delegar Permisos"><Lock size={18} /></Button>
                        )}
                        {canManageEmployees && !emp.biometric_template && (
                          <Button variant="ghost" size="icon" onClick={() => handleOpenEnrollment(emp)} title="Enrolar"><ScanFace size={18} /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}


      {/* NEW ENROLLMENT WIZARD */}
      <EnrollmentWizard
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedUser={selectedUserForEnrollment}
        generateInternalId={generateInternalId}
        onAddUser={addUser}
        onEnrollUser={enrollUser}
        tenantId={currentUser?.tenantId || null}
      />

      {isHistoryModalOpen && selectedEmployeeForHistory && (
        <Dialog open={isHistoryModalOpen} onOpenChange={setIsHistoryModalOpen}>
          <DialogContent className="max-w-5xl p-0 border-none bg-transparent overflow-hidden rounded-[3rem] shadow-3xl">
            <div className="flex flex-col max-h-[90vh] bg-card rounded-[3rem] overflow-hidden">
              <DialogHeader className="p-10 industrial-gradient text-white flex flex-row justify-between items-center shrink-0 relative">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 rounded-3xl bg-white/10 flex items-center justify-center text-xl font-black uppercase">
                    {selectedEmployeeForHistory?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                  </div>
                  <div>
                    <DialogTitle className="text-3xl font-black tracking-tighter uppercase leading-none font-outfit">{selectedEmployeeForHistory.name}</DialogTitle>
                    <DialogDescription className="text-white/40 text-[11px] font-black uppercase tracking-[0.2em] mt-2">ID: {selectedEmployeeForHistory.internalId} • Historial de Movimientos</DialogDescription>
                  </div>
                </div>
                <Button onClick={() => setIsHistoryModalOpen(false)} variant="ghost" size="icon" className="p-3 bg-white/5 rounded-2xl text-white/40 hover:text-white hover:bg-white/10 transition-all absolute top-10 right-10"><X size={24} /></Button>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-muted/50">
                <Tabs defaultValue="kyc" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-10 p-1 bg-muted rounded-2xl h-14">
                    <TabsTrigger value="history" className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                      <History size={14} /> Historial de Movimientos
                    </TabsTrigger>
                    <TabsTrigger value="kyc" className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                      <ShieldCheck size={14} /> Dossier de Identidad (KYC)
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="history" className="space-y-6">
                    <div className="flex flex-col sm:flex-row items-center gap-4 bg-muted p-4 rounded-3xl border shadow-sm">
                      <div className="relative flex-1 w-full">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                        <Input
                          placeholder="Buscar por activo, fecha o ID..."
                          className="pl-10 h-11 bg-background border-none rounded-2xl text-xs font-bold"
                          value={historySearch}
                          onChange={(e) => setHistorySearch(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-2xl text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                        <History size={12} /> {transactions.filter(t => t.employeeId === selectedEmployeeForHistory.id).length} Movimientos totales
                      </div>
                    </div>
                    <div className="space-y-4">
                      {transactions.filter(t => {
                        if (t.employeeId !== selectedEmployeeForHistory.id) return false;
                        if (!historySearch) return true;
                        const search = historySearch.toLowerCase();
                        const dateStr = new Date(t.timestamp).toLocaleDateString('es-CL');
                        const assetsNames = t.assetIds.map(id => materialsMap.get(id)?.name?.toLowerCase() || '').join(' ');
                        return t.id.toLowerCase().includes(search) || dateStr.includes(search) || assetsNames.includes(search);
                      }).length === 0 ? (
                        <div className="py-20 text-center"><History size={40} className="mx-auto text-muted-foreground/40 mb-4" /><p className="text-muted-foreground font-black uppercase tracking-widest text-[10px]">Sin movimientos registrados</p></div>
                      ) : (
                        transactions.filter(t => t.employeeId === selectedEmployeeForHistory.id).map(tx => (
                          <div key={tx.id} className="p-6 bg-muted border rounded-[2rem] flex items-center justify-between gap-6 hover:shadow-xl transition-all">
                            <div className="flex items-center gap-4">
                              <div className={`p-3 rounded-2xl ${tx.type === 'WITHDRAWAL' ? 'bg-pagnol-orange/10 text-pagnol-orange' : 'bg-success-subtle text-success'}`}>
                                {tx.type === 'WITHDRAWAL' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                              </div>
                              <div>
                                <p className="text-sm font-black text-foreground uppercase">#{tx.id}</p>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase">{new Date(tx.timestamp).toLocaleString('es-CL')}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {tx.assetIds.map(aid => <Badge key={aid} variant="secondary" className="text-[9px]">{materialsMap.get(aid)?.name}</Badge>)}
                            </div>
                            {tx.contractUrl && (
                              <a href={tx.contractUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] font-black text-pagnol-orange">
                                <Download size={14} /> Acta
                              </a>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="kyc">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                      <div className="space-y-6">
                        <h6 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                          <ScanFace size={14} /> Certificación Biométrica
                        </h6>
                        <div className="bg-muted p-8 rounded-[2.5rem] border shadow-sm space-y-8">
                          <div className="flex items-center gap-6">
                            <div className="w-24 h-24 rounded-3xl bg-muted border-2 border-border overflow-hidden shadow-inner">
                              {employeeDocs?.kyc_face_image ? (
                                <img src={employeeDocs.kyc_face_image} className="w-full h-full object-cover" alt="Biometric Face" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground/40"><ScanFace size={40} /></div>
                              )}
                            </div>
                            <div>
                              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Estado del Enrolamiento</p>
                              <div className="flex items-center gap-2 mt-1">
                                <div className={`w-2 h-2 rounded-full ${selectedEmployeeForHistory.biometric_template ? 'bg-success animate-pulse' : 'bg-muted-foreground/40'}`} />
                                <span className={`text-sm font-black uppercase tracking-tight ${selectedEmployeeForHistory.biometric_template ? 'text-success' : 'text-muted-foreground'}`}>
                                  {selectedEmployeeForHistory.biometric_template ? 'VALIDADO POR IA' : 'PENDIENTE'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="pt-4 border-t flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                            <span>Hash Biométrico</span>
                            <span className="font-mono text-muted-foreground/50">
                              {selectedEmployeeForHistory.biometric_template ? `SHA256-${selectedEmployeeForHistory.id.substring(0, 10)}...` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-6">
                        <h6 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                          <FileText size={14} /> Documentos KYC Capturados
                        </h6>
                        <div className="grid grid-cols-2 gap-4">
                          {[
                            { label: 'Cédula Frente', src: employeeDocs?.kyc_id_front },
                            { label: 'Cédula Reverso', src: employeeDocs?.kyc_id_back },
                          ].map(doc => (
                            <div key={doc.label} className="space-y-2">
                              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{doc.label}</p>
                              <div className="aspect-[1.586/1] bg-muted rounded-2xl border overflow-hidden">
                                {doc.src ? <img src={doc.src} className="w-full h-full object-cover" alt={doc.label} /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground/50 text-[10px] font-bold">Sin captura</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
              <DialogFooter className="p-10 border-t flex flex-row justify-end items-center shrink-0 bg-card">
                <Button onClick={() => setIsHistoryModalOpen(false)} className="px-10 py-6 rounded-2xl text-[11px] font-black uppercase tracking-widest bg-pagnol-dark hover:bg-black text-white shadow-xl">Cerrar</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* MODAL DE AUTORIZACIONES POR USUARIO */}
      {isPermissionsModalOpen && selectedUserForPermissions && (
        <Dialog open={isPermissionsModalOpen} onOpenChange={setIsPermissionsModalOpen}>
          <DialogContent className="max-w-2xl p-0 border-none bg-transparent overflow-hidden rounded-[2.5rem] shadow-3xl">
            <div className="flex flex-col bg-card rounded-[2.5rem] overflow-hidden max-h-[90vh]">
              <DialogHeader className="p-8 industrial-gradient text-white shrink-0 relative">
                <DialogTitle className="text-2xl font-black tracking-tighter uppercase leading-none font-outfit">Autorizaciones · {selectedUserForPermissions.name}</DialogTitle>
                <DialogDescription className="text-white/60 text-[10px] font-bold uppercase tracking-[0.1em] mt-2">Permisos específicos, adicionales a los de su rol</DialogDescription>
                <Button onClick={() => setIsPermissionsModalOpen(false)} variant="ghost" size="icon" className="p-2 bg-white/5 rounded-xl text-white/40 hover:text-white absolute top-6 right-6"><X size={20} /></Button>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto p-6 min-h-0">
                <UserPermissionsEditor
                  user={selectedUserForPermissions}
                  onSaved={(granted) => {
                    setPermissionsOverride(prev => new Map(prev).set(selectedUserForPermissions.id, granted));
                    setIsPermissionsModalOpen(false);
                  }}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {/* MODAL ENTREGA DE ACTIVOS (EA) — Código del Trabajo Chile Art. 11 */}
      {isEAModalOpen && selectedEmployeeForEA && (() => {
        const empAssets = transactions
          .filter(t => t.employeeId === selectedEmployeeForEA.id && t.type === 'WITHDRAWAL' && t.isApproved)
          .flatMap(t => t.assetIds)
          .filter((id, idx, arr) => arr.indexOf(id) === idx)
          .map(id => materialsMap.get(id))
          .filter(Boolean) as typeof materials;

        const allEmployeeEAs = eaDocuments
          .filter(d => d.employeeId === selectedEmployeeForEA.id)
          .sort((a, b) => new Date(b.generatedAt as string).getTime() - new Date(a.generatedAt as string).getTime());

        const existingEA = allEmployeeEAs.find(d => d.status === 'generated') ?? null;
        const sentEA = allEmployeeEAs.find(d => d.status === 'sent_to_dt') ?? null;

        const today = new Date();
        const deadline = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000);
        const deadlineStr = deadline.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });

        const missingLegalData = !currentTenant?.rut || !currentTenant?.legalRepresentative;

        const handleSaveTenantLegal = async () => {
          if (!currentTenant?.id) return;
          setIsSavingTenant(true);
          try {
            await updateTenant(currentTenant.id, tenantLegalForm);
            setCurrentTenant(prev => ({ ...prev, ...tenantLegalForm }));
            setShowTenantForm(false);
            toast({ title: 'Datos guardados', description: 'Información legal de la empresa actualizada.' });
          } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message });
          } finally {
            setIsSavingTenant(false);
          }
        };

        const handleGenerateEA = async () => {
          setEAGenerating(true);
          try {
            const blob = await generateEAPDF({
              employee: {
                name: selectedEmployeeForEA.name,
                rut: selectedEmployeeForEA.rut,
                role: selectedEmployeeForEA.role,
                internalId: selectedEmployeeForEA.internalId,
              },
              employeeSignatureUrl: selectedEmployeeForEA.signature || null,
              tenant: {
                name: currentTenant?.name || '',
                rut: currentTenant?.rut,
                legalRepresentative: currentTenant?.legalRepresentative,
                legalRepresentativeRut: currentTenant?.legalRepresentativeRut,
                address: currentTenant?.address,
              },
              assets: empAssets,
            });
            await generateEADocument(selectedEmployeeForEA.id, selectedEmployeeForEA.name, blob);
            toast({ title: 'Acta EA generada', description: 'El documento está disponible para descarga.' });
          } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error al generar', description: e.message });
          } finally {
            setEAGenerating(false);
          }
        };

        const handleConfirmSent = async (doc: typeof existingEA) => {
          if (!doc) return;
          setEAConfirming(true);
          try {
            await confirmEASentToDT(doc.id, doc.filePath || '');
            toast({ title: 'Envío confirmado', description: 'El acta fue eliminada del servidor. Registro guardado.' });
          } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message });
          } finally {
            setEAConfirming(false);
          }
        };

        const handlePrintEA = () => {
          const printContent = document.getElementById('ea-document-print');
          if (!printContent) return;
          const win = window.open('', '_blank', 'width=900,height=700');
          if (!win) return;
          win.document.write(`<!DOCTYPE html><html><head><title>Acta EA - ${selectedEmployeeForEA.name}</title><style>
            @page { margin: 25mm; } body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; }
            h1 { font-size: 14pt; text-align: center; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
            h2 { font-size: 10pt; text-align: center; color: #555; margin-bottom: 30px; }
            h3 { font-size: 10pt; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 9pt; }
            th { background: #f5f5f5; padding: 6px 10px; text-align: left; border: 1px solid #ddd; text-transform: uppercase; font-size: 8pt; letter-spacing: 1px; }
            td { padding: 6px 10px; border: 1px solid #ddd; }
            .firma-box { border-top: 1px solid #000; margin-top: 60px; padding-top: 8px; text-align: center; font-size: 9pt; width: 45%; display: inline-block; }
            .firmas { display: flex; justify-content: space-between; margin-top: 60px; }
            .nota { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; margin-top: 20px; font-size: 9pt; border-radius: 4px; }
            p { margin: 8px 0; }
          </style></head><body>${printContent.innerHTML}</body></html>`);
          win.document.close();
          win.focus();
          win.print();
          win.close();
        };

        return (
          <Dialog open={isEAModalOpen} onOpenChange={(o) => !o && setIsEAModalOpen(false)}>
            <DialogContent className="max-w-4xl p-0 border-none rounded-[2.5rem] overflow-hidden shadow-2xl">
              {/* Header */}
              <div className="bg-pagnol-dark text-white px-10 py-8 flex items-start justify-between gap-6">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300">
                    <ClipboardList size={28} />
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/40">Documento Legal Oficial</p>
                    <DialogTitle className="text-xl font-black uppercase tracking-tighter text-white mt-0.5">Acta de Entrega de Activos (EA)</DialogTitle>
                    <p className="text-[9px] font-bold text-white/40 mt-1">Art. 11 Código del Trabajo · Dirección del Trabajo Chile</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                  {/* Estado: enviado a DT */}
                  {sentEA && (
                    <span className="flex items-center gap-2 h-9 px-4 rounded-xl bg-green-600/20 text-green-400 text-[9px] font-black uppercase tracking-widest">
                      <CheckCheck size={14} /> Enviado a DT
                    </span>
                  )}
                  {/* Descargar si existe documento generado */}
                  {existingEA?.fileUrl && (
                    <a href={existingEA.fileUrl} target="_blank" rel="noreferrer">
                      <Button className="h-9 px-4 rounded-xl bg-success hover:bg-success/90 text-success-foreground text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
                        <Download size={14} /> Descargar Acta
                      </Button>
                    </a>
                  )}
                  {/* Confirmar envío a DT */}
                  {existingEA && (
                    <Button onClick={() => handleConfirmSent(existingEA)} disabled={eaConfirming} className="h-9 px-4 rounded-xl bg-info hover:bg-info/90 text-info-foreground text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Send size={14} /> {eaConfirming ? 'Confirmando...' : 'Ya envié a DT'}
                    </Button>
                  )}
                  {/* Generar PDF */}
                  {!existingEA && !sentEA && (
                    <Button onClick={handleGenerateEA} disabled={eaGenerating || missingLegalData} className="h-9 px-4 rounded-xl bg-pagnol-orange hover:bg-pagnol-orange/90 text-white text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
                      <FileText size={14} /> {eaGenerating ? 'Generando...' : 'Generar Acta PDF'}
                    </Button>
                  )}
                  {/* Regenerar si ya existe */}
                  {existingEA && (
                    <Button onClick={handleGenerateEA} disabled={eaGenerating} variant="outline" className="h-9 px-4 rounded-xl text-white border-white/20 hover:bg-white/10 text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
                      <FileText size={14} /> {eaGenerating ? 'Generando...' : 'Regenerar'}
                    </Button>
                  )}
                  <Button onClick={handlePrintEA} variant="ghost" className="h-9 px-4 rounded-xl text-white/60 hover:text-white hover:bg-white/10 text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
                    <Printer size={14} /> Imprimir
                  </Button>
                  <Button onClick={() => setIsEAModalOpen(false)} variant="ghost" size="icon" className="rounded-xl text-white/30 hover:text-white hover:bg-white/10">
                    <X size={18} />
                  </Button>
                </div>
              </div>

              {/* Banner: datos legales faltantes */}
              {missingLegalData && (
                <div className="bg-warning-subtle border-b border-warning/20 px-8 py-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[9px] font-black uppercase tracking-wide text-warning-subtle-foreground mb-2">
                        Completa los datos legales de tu empresa para auto-rellenar el acta
                      </p>
                      {!showTenantForm ? (
                        <Button onClick={() => setShowTenantForm(true)} size="sm" variant="outline" className="h-7 rounded-lg text-[9px] font-black uppercase tracking-widest border-warning/40 text-warning hover:bg-warning/10 flex items-center gap-2">
                          <Pencil size={12} /> Completar datos de empresa
                        </Button>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 mt-2">
                          {[
                            { key: 'rut', label: 'RUT Empresa (ej: 76.123.456-7)' },
                            { key: 'legalRepresentative', label: 'Nombre Representante Legal' },
                            { key: 'legalRepresentativeRut', label: 'RUT Representante Legal' },
                            { key: 'address', label: 'Domicilio Empresa' },
                          ].map(f => (
                            <div key={f.key}>
                              <p className="text-[8px] font-black uppercase text-warning mb-1">{f.label}</p>
                              <Input
                                value={(tenantLegalForm as any)[f.key]}
                                onChange={e => setTenantLegalForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                                className="h-8 rounded-xl text-xs border-warning/20"
                              />
                            </div>
                          ))}
                          <div className="col-span-2 flex gap-2">
                            <Button onClick={handleSaveTenantLegal} disabled={isSavingTenant} size="sm" className="h-7 rounded-lg text-[9px] font-black uppercase bg-warning hover:bg-warning/90 text-warning-foreground tracking-widest">
                              {isSavingTenant ? 'Guardando...' : 'Guardar Datos'}
                            </Button>
                            <Button onClick={() => setShowTenantForm(false)} variant="ghost" size="sm" className="h-7 rounded-lg text-[9px] font-black uppercase text-warning">Cancelar</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Legal notice bar */}
              <div className="bg-warning-subtle border-b border-warning/20 px-10 py-3 flex items-center gap-3">
                <AlertTriangle size={14} className="text-warning shrink-0" />
                <p className="text-[9px] font-bold text-warning-subtle-foreground uppercase tracking-wide">
                  Registrar en <b>Mi DT (dt.gob.cl)</b> dentro de <b>15 días hábiles</b> desde la firma. Plazo límite estimado: <b>{deadlineStr}</b>
                </p>
              </div>

              {/* Tabs: Acta / Historial */}
              <div className="px-10 pt-4 pb-0 bg-muted border-b flex gap-1">
                <button
                  onClick={() => setEaTab('acta')}
                  className={`px-5 py-2.5 text-[9px] font-black uppercase tracking-widest rounded-t-xl transition-all ${eaTab === 'acta' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <span className="flex items-center gap-2"><FileText size={12} /> Acta Actual</span>
                </button>
                <button
                  onClick={() => setEaTab('historial')}
                  className={`px-5 py-2.5 text-[9px] font-black uppercase tracking-widest rounded-t-xl transition-all flex items-center gap-2 ${eaTab === 'historial' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <History size={12} /> Historial
                  {allEmployeeEAs.length > 0 && (
                    <span className="bg-pagnol-orange text-white rounded-full w-4 h-4 flex items-center justify-center text-[8px] font-black">{allEmployeeEAs.length}</span>
                  )}
                </button>
              </div>

              {/* Historial de Actas */}
              {eaTab === 'historial' && (
                <div className="overflow-y-auto max-h-[65vh] bg-muted p-8 space-y-3">
                  {allEmployeeEAs.length === 0 ? (
                    <div className="py-16 text-center">
                      <History size={40} className="mx-auto text-muted-foreground/40 mb-3" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sin actas generadas aún</p>
                    </div>
                  ) : (
                    allEmployeeEAs.map((doc) => (
                      <div key={doc.id} className="p-5 bg-muted border rounded-2xl flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className={`p-2.5 rounded-xl ${doc.status === 'sent_to_dt' ? 'bg-success-subtle text-success' : 'bg-info-subtle text-info'}`}>
                            <FileText size={18} />
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-foreground">
                              {new Date(doc.generatedAt as string).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase ${doc.status === 'sent_to_dt' ? 'bg-success-subtle text-success-subtle-foreground' : 'bg-info-subtle text-info-subtle-foreground'}`}>
                              {doc.status === 'sent_to_dt' ? <><CheckCheck size={10} /> Enviado a DT</> : <><FileText size={10} /> Disponible</>}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {doc.fileUrl && (
                            <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                              <Button size="sm" className="h-8 px-3 rounded-xl bg-success hover:bg-success/90 text-success-foreground text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                <Download size={12} /> Descargar
                              </Button>
                            </a>
                          )}
                          {doc.status === 'generated' && doc.fileUrl && (
                            <Button
                              size="sm"
                              onClick={() => handleConfirmSent(doc)}
                              disabled={eaConfirming}
                              className="h-8 px-3 rounded-xl bg-info hover:bg-info/90 text-info-foreground text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5"
                            >
                              <Send size={12} /> {eaConfirming ? '...' : 'Ya envié a DT'}
                            </Button>
                          )}
                          {doc.status === 'sent_to_dt' && (
                            <span className="flex items-center gap-1 text-[8px] font-black uppercase text-muted-foreground">
                              {doc.confirmedAt ? new Date(doc.confirmedAt as string).toLocaleDateString('es-CL') : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Document body — printable */}
              {eaTab === 'acta' && <div className="overflow-y-auto max-h-[65vh] bg-card">
                <div id="ea-document-print" className="p-10 space-y-8">

                  {/* Title */}
                  <div className="text-center space-y-1 pb-6 border-b-2 border-foreground">
                    <h1 className="text-2xl font-black uppercase tracking-tighter">Anexo de Contrato de Trabajo</h1>
                    <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Acta de Entrega de Activos — (EA)</h2>
                    <p className="text-[10px] text-muted-foreground font-bold">Conforme al Artículo 11 del Código del Trabajo de Chile</p>
                  </div>

                  {/* Parties */}
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 flex items-center gap-2"><Building2 size={14} className="text-info" /> I. COMPARECENCIA</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-5 bg-muted rounded-2xl border space-y-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Empleador</p>
                        <p className="text-sm font-black text-foreground">{currentTenant?.name || '— completar —'}</p>
                        <p className="text-[10px] text-muted-foreground font-bold">RUT Empresa: {currentTenant?.rut || '_______________________'}</p>
                        <p className="text-[10px] text-muted-foreground font-bold">Representante Legal: {currentTenant?.legalRepresentative || '_______________________'}</p>
                        <p className="text-[10px] text-muted-foreground font-bold">RUT Rep. Legal: {currentTenant?.legalRepresentativeRut || '_______________________'}</p>
                        <p className="text-[10px] text-muted-foreground font-bold">Domicilio: {currentTenant?.address || '_______________________'}</p>
                      </div>
                      <div className="p-5 bg-info-subtle rounded-2xl border border-info/20 space-y-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-info">Trabajador</p>
                        <p className="text-sm font-black text-foreground">{selectedEmployeeForEA.name}</p>
                        <p className="text-[10px] text-muted-foreground font-bold">RUT: {selectedEmployeeForEA.rut || '___________________'}</p>
                        <p className="text-[10px] text-muted-foreground font-bold">Cargo: {selectedEmployeeForEA.role} · ID: {selectedEmployeeForEA.internalId}</p>
                      </div>
                    </div>
                  </div>

                  {/* Antecedentes */}
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2"><FileText size={14} className="text-info" /> II. ANTECEDENTES</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Las partes identificadas precedentemente, siendo el empleador y el trabajador designados en la cláusula anterior, suscriben el presente Anexo al Contrato de Trabajo vigente entre ellos, de conformidad con lo dispuesto en el artículo 11 del Código del Trabajo de Chile, con el objeto de dejar constancia de la entrega de los activos y herramientas de trabajo que se indican a continuación.
                    </p>
                  </div>

                  {/* Asset table */}
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2"><Package size={14} className="text-info" /> III. CLÁUSULA PRIMERA — DETALLE DE ACTIVOS ENTREGADOS</h3>
                    {empAssets.length === 0 ? (
                      <div className="py-10 text-center bg-muted rounded-2xl border-2 border-dashed border-border">
                        <Package size={32} className="mx-auto mb-3 text-muted-foreground/40" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sin activos aprobados registrados para este trabajador</p>
                        <p className="text-[9px] text-muted-foreground/50 mt-1">Realice una entrega aprobada desde el módulo de Movimientos</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-2xl border border-border">
                        <table className="w-full text-left">
                          <thead className="bg-muted border-b">
                            <tr>
                              {['N°', 'Descripción del Activo', 'Marca / Modelo', 'N° Serie', 'Clase', 'Tipo de Uso', 'Estado', 'Valor Ref.'].map(h => (
                                <th key={h} className="px-4 py-3 text-[8px] font-black uppercase tracking-widest text-muted-foreground">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {empAssets.map((asset, idx) => asset && (
                              <tr key={asset.id} className="hover:bg-muted transition-colors">
                                <td className="px-4 py-3 text-[10px] font-black text-muted-foreground">{idx + 1}</td>
                                <td className="px-4 py-3">
                                  <p className="text-[10px] font-black uppercase text-foreground leading-tight">{asset.name}</p>
                                  <p className="text-[8px] text-muted-foreground font-bold">{asset.category}</p>
                                </td>
                                <td className="px-4 py-3 text-[9px] font-bold text-muted-foreground">{asset.description || '—'}</td>
                                <td className="px-4 py-3 text-[9px] font-mono font-bold text-muted-foreground">{asset.serialNumber || 'N/A'}</td>
                                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-lg bg-muted text-[8px] font-black">{asset.class}</span></td>
                                <td className="px-4 py-3 text-[9px] font-bold text-muted-foreground">{asset.usageType}</td>
                                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-lg bg-success-subtle text-success-subtle-foreground text-[8px] font-black">Buen Estado</span></td>
                                <td className="px-4 py-3 text-[9px] font-black text-foreground">${(asset.unitCost || 0).toLocaleString('es-CL')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Legal clauses */}
                  <div className="space-y-4">
                    {[
                      { num: 'IV', title: 'CLÁUSULA SEGUNDA — USO Y DESTINO', text: `Los activos descritos se entregan al trabajador para el uso exclusivo en el desempeño de sus funciones laborales dentro de la empresa. El trabajador se compromete a utilizarlos únicamente para los fines estipulados en su contrato de trabajo y en conformidad con las instrucciones del empleador.` },
                      { num: 'V', title: 'CLÁUSULA TERCERA — OBLIGACIONES DE CUSTODIA', text: `El trabajador se obliga a mantener los activos entregados en buen estado de conservación, respondiendo por su pérdida, extravío o deterioro causado por negligencia o mal uso, conforme al artículo 61 del Código del Trabajo. El desgaste natural producto del uso normal no será imputable al trabajador.` },
                      { num: 'VI', title: 'CLÁUSULA CUARTA — DEVOLUCIÓN AL TÉRMINO DEL CONTRATO', text: `El trabajador deberá restituir todos los activos señalados en el presente Anexo al momento de cesar en sus funciones, cualquiera sea la causa del término de la relación laboral, o cuando el empleador lo requiera fundadamente. La devolución deberá acreditarse mediante Acta de Recepción firmada por ambas partes.` },
                    ].map(clause => (
                      <div key={clause.num} className="p-5 bg-muted rounded-2xl border">
                        <h4 className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">{clause.num}. {clause.title}</h4>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{clause.text}</p>
                      </div>
                    ))}
                  </div>

                  {/* Signature section */}
                  <div className="pt-8 border-t-2 border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar size={14} className="text-info" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">VII. FECHA Y FIRMAS</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-8">En _________________________, a {today.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })}, las partes suscriben el presente Anexo en dos ejemplares de un mismo tenor y fecha, quedando uno en poder de cada parte.</p>
                    <div className="grid grid-cols-2 gap-16">
                      {/* Firma empleador */}
                      <div className="text-center">
                        <div className="h-16 border-b-2 border-muted-foreground/40 mb-3"></div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Empleador / Representante Legal</p>
                        <p className="text-[8px] text-muted-foreground mt-1">{currentTenant?.legalRepresentative || 'Nombre, Firma y Timbre'}</p>
                      </div>
                      {/* Firma trabajador con imagen digital */}
                      <div className="text-center">
                        <div className="h-16 border-b-2 border-muted-foreground/40 mb-3 relative flex items-end justify-center overflow-hidden">
                          {selectedEmployeeForEA.signature ? (
                            <img
                              src={selectedEmployeeForEA.signature}
                              alt="Firma Digital"
                              className="h-14 object-contain mx-auto"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <p className="text-[8px] text-muted-foreground/50 font-bold uppercase tracking-widest">Sin firma registrada</p>
                            </div>
                          )}
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Trabajador: {selectedEmployeeForEA.name}</p>
                        {selectedEmployeeForEA.signature ? (
                          <p className="text-[8px] text-success font-black mt-1 flex items-center justify-center gap-1">
                            <CheckCircle size={10} /> Firma Digital Registrada — Identidad Biométricamente Validada
                          </p>
                        ) : (
                          <p className="text-[8px] text-warning font-bold mt-1">⚠ El trabajador no tiene firma digital guardada en su perfil</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actas firmadas por transacción */}
                  {(() => {
                    const signedContracts = transactions.filter(
                      t => t.employeeId === selectedEmployeeForEA.id && t.contractUrl && t.type === 'WITHDRAWAL'
                    );
                    if (signedContracts.length === 0) return null;
                    return (
                      <div className="pt-6 border-t border-border">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4 flex items-center gap-2">
                          <FileText size={14} className="text-pagnol-orange" /> VIII. ACTAS DE RECEPCIÓN BIOMÉTRICA POR TRANSACCIÓN
                        </h3>
                        <div className="space-y-2">
                          {signedContracts.map(tx => (
                            <div key={tx.id} className="flex items-center justify-between p-4 bg-pagnol-orange/10 rounded-2xl border border-pagnol-orange/20">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-pagnol-orange/10 rounded-xl">
                                  <FileText size={14} className="text-pagnol-orange" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase text-foreground">{(tx as any).internalCode || tx.id}</p>
                                  <p className="text-[9px] text-muted-foreground font-bold">
                                    {new Date(tx.timestamp).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                              </div>
                              <a href={tx.contractUrl!} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" className="h-8 px-4 rounded-xl bg-pagnol-orange hover:bg-pagnol-orange/90 text-white text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                  <Download size={12} /> Acta Firmada
                                </Button>
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* DT Notice */}
                  <div className="p-4 bg-warning-subtle border border-warning/20 rounded-2xl flex gap-3">
                    <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-warning-subtle-foreground">Obligación de Registro — Dirección del Trabajo</p>
                      <p className="text-[9px] text-warning leading-relaxed">
                        Este Anexo debe ser registrado en el <b>Portal Mi DT (dt.gob.cl)</b> dentro de los <b>15 días hábiles</b> siguientes a su firma, usando la ClaveÚnica del representante legal, conforme a la normativa vigente del Registro Electrónico Laboral.
                      </p>
                    </div>
                  </div>
                </div>
              </div>}
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}
