"use client";

import { useState } from 'react';
import { useAuth } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    History, Search, Users, Printer, LayoutGrid, Wrench,
} from 'lucide-react';
import { ReportTab } from '@/components/pagnol-reports/report-utils';
import { useReportData } from '@/components/pagnol-reports/use-report-data';
import { InventoryTab } from '@/components/pagnol-reports/inventory-tab';
import { PeopleTab } from '@/components/pagnol-reports/people-tab';
import { TrailTab } from '@/components/pagnol-reports/trail-tab';
import { AuditTab } from '@/components/pagnol-reports/audit-tab';
import { MaintenanceTab } from '@/components/pagnol-reports/maintenance-tab';

// Impresión scoped a esta página: solo se imprime .printable-area (con su
// encabezado propio), sin sidebar ni chrome del dashboard.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  .printable-area, .printable-area * { visibility: visible; }
  .printable-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0 16px; }
  .print-header { display: block !important; }
}
`;

export default function ReportsPage() {
    const { user: currentUser } = useAuth();
    const data = useReportData();
    const [activeTab, setActiveTab] = useState<ReportTab>('INVENTORY');

    const tabs: { id: ReportTab; label: string; icon: any }[] = [
        { id: 'INVENTORY', label: 'Inventario', icon: LayoutGrid },
        { id: 'PEOPLE', label: 'Personal', icon: Users },
        { id: 'ASSET_TRAIL', label: 'Trazabilidad', icon: Search },
        { id: 'MAINTENANCE_LOG', label: 'Mantenimiento', icon: Wrench },
        { id: 'AUDIT', label: 'Auditoría', icon: History },
    ];

    const activeLabel = tabs.find(t => t.id === activeTab)?.label;

    return (
        <div className="space-y-8 animate-in fade-in duration-700 pb-20">
            <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 print:hidden">
                <PageHeader title="CENTRO DE REPORTES ESTRATÉGICOS" description="CONTROL PATRIMONIAL Y AUDITORÍA DE ACTIVOS" />
                <Button onClick={() => window.print()} variant="outline" className="rounded-2xl h-12 px-6 gap-2 border-border">
                    <Printer size={16} /> Imprimir
                </Button>
            </div>

            {/* TAB SELECTOR */}
            <div className="flex items-center gap-2 bg-muted p-2 rounded-[2rem] border shadow-inner overflow-x-auto no-scrollbar print:hidden">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                'flex items-center gap-3 px-6 py-4 rounded-[1.5rem] text-[11px] font-black uppercase tracking-[0.1em] transition-all whitespace-nowrap',
                                activeTab === tab.id
                                    ? 'bg-card text-foreground shadow-xl'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                            )}
                        >
                            <Icon size={16} className={activeTab === tab.id ? 'text-pagnol-orange' : ''} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <div className="printable-area space-y-10">
                {/* Encabezado SOLO para impresión */}
                <div className="print-header hidden border-b-2 border-black pb-4 mb-6">
                    <p className="text-2xl font-black uppercase tracking-tighter">PAGNOL — Centro de Reportes</p>
                    <p className="text-xs font-bold uppercase tracking-widest mt-1">
                        {activeLabel} · Emitido el {new Date().toLocaleDateString('es-CL')} {new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        {currentUser?.name ? ` · por ${currentUser.name}` : ''}
                    </p>
                </div>

                {activeTab === 'INVENTORY' && <InventoryTab data={data} />}
                {activeTab === 'PEOPLE' && <PeopleTab data={data} />}
                {activeTab === 'ASSET_TRAIL' && <TrailTab data={data} />}
                {activeTab === 'MAINTENANCE_LOG' && <MaintenanceTab data={data} />}
                {activeTab === 'AUDIT' && <AuditTab data={data} />}
            </div>
        </div>
    );
}
