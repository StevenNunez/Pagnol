"use client";

import { useAuth } from "@/modules/core/contexts/app-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, Check } from "lucide-react";
import type { Tenant } from "@/modules/core/lib/data";

export function TenantSwitcher() {
  const { user, tenants, currentTenantId, setCurrentTenantId } = useAuth();

  if (user?.role !== "super-admin" || !tenants || tenants.length === 0) return null;

  const currentTenant = tenants.find((t: Tenant) => t.id === currentTenantId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 bg-white/5 hover:bg-white/10 hover:text-white rounded-2xl h-14 border border-white/5 px-4 shadow-sm group transition-all"
        >
          <div className="p-2 bg-pagnol-orange/10 rounded-xl text-pagnol-orange group-hover:bg-pagnol-orange group-hover:text-white transition-all">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="flex flex-col items-start overflow-hidden">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-300 transition-colors">Empresa Actual</span>
            <span className="font-bold text-[11px] truncate w-full text-left uppercase tracking-tight">{currentTenant?.name || "Seleccionar empresa"}</span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-2xl shadow-3xl border-slate-100 p-2">
        <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-3">Cambiar de empresa</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-slate-50" />
        <div className="max-h-[300px] overflow-y-auto no-scrollbar">
          {tenants.map((tenant: Tenant) => (
            <DropdownMenuItem
              key={tenant.id}
              onClick={() => setCurrentTenantId(tenant.id)}
              className="flex items-center justify-between rounded-xl px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
            >
              <div className="overflow-hidden">
                <p className="font-black text-[11px] uppercase tracking-tight truncate">{tenant.name}</p>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{tenant.tenantId}</p>
              </div>
              {currentTenantId === tenant.id && (
                <div className="p-1 bg-pagnol-orange/10 rounded-lg text-pagnol-orange ml-2">
                  <Check className="h-4 w-4" />
                </div>
              )}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
