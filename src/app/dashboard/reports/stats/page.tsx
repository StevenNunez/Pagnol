
"use client";

import React, { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Download, CalendarIcon, Filter, TrendingUp, Package, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PurchaseRequest, User as UserType, Material } from '@/modules/core/lib/data';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const getDate = (date: Date | string | undefined | null) => {
    if (!date) return null;
    return new Date(date as any);
};

export default function ReportsWithCharts() {
  const { purchaseRequests = [], users = [], materials = [] } = useAppState();

  const [filters, setFilters] = useState({
    dateFrom: startOfMonth(new Date()),
    dateTo: endOfMonth(new Date()),
    supervisorId: 'all',
    materialId: 'all',
  });

  const [datePopover, setDatePopover] = useState<'from' | 'to' | null>(null);

  const userMap = useMemo(() => new Map(users.map((u: UserType) => [u.id, u])), [users]);

  const filteredRequests = useMemo(() => {
    return purchaseRequests.filter((req: PurchaseRequest) => {
      const reqDate = getDate(req.createdAt);
      if (!reqDate) return false;
      if (filters.dateFrom && reqDate < filters.dateFrom) return false;
      if (filters.dateTo && reqDate > filters.dateTo) return false;
      if (filters.supervisorId !== 'all' && req.supervisorId !== filters.supervisorId) return false;
      if (filters.materialId !== 'all') {
        const mat = materials.find((m: Material) => m.name === req.materialName);
        if (!mat || mat.id !== filters.materialId) return false;
      }
      return true;
    });
  }, [purchaseRequests, filters, materials]);

  // === DATOS PARA GRÁFICOS Y TABLAS ===
  const { topSupervisors, topMaterials } = useMemo(() => {
    const supervisorTotals = new Map<string, number>();
    const materialTotals = new Map<string, { quantity: number; unit: string }>();

    filteredRequests.forEach((req: PurchaseRequest) => {
      const quantity = Number(req.quantity) || 0;
      // Por supervisor
      const supervisorName = userMap.get(req.supervisorId)?.name || 'Sin asignar';
      supervisorTotals.set(supervisorName, (supervisorTotals.get(supervisorName) || 0) + quantity);

      // Por material
      const current = materialTotals.get(req.materialName) || { quantity: 0, unit: req.unit || 'und' };
      materialTotals.set(req.materialName, {
        quantity: current.quantity + quantity,
        unit: current.unit
      });
    });

    const sortedSupervisors = Array.from(supervisorTotals.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity);

    const sortedMaterials = Array.from(materialTotals.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.quantity - a.quantity);

    return {
      topSupervisors: sortedSupervisors,
      topMaterials: sortedMaterials,
    };
  }, [filteredRequests, userMap]);

  const chartDataSupervisors = useMemo(() => topSupervisors.slice(0, 10), [topSupervisors]);
  const chartDataMaterials = useMemo(() => topMaterials.slice(0, 8), [topMaterials]);

  const pieData = chartDataMaterials.map((item, i) => ({
    name: item.name,
    value: item.quantity,
    color: COLORS[i % COLORS.length]
  }));

  const monthlyEvolution = useMemo(() => {
    const monthly = new Map<string, number>();
    filteredRequests.forEach((req: PurchaseRequest) => {
      const reqDate = getDate(req.createdAt);
      if(!reqDate) return;
      const monthKey = format(reqDate, 'yyyy-MM');
      monthly.set(monthKey, (monthly.get(monthKey) || 0) + (Number(req.quantity) || 0));
    });
    return Array.from(monthly.entries())
      .map(([monthKey, quantity]) => ({ month: format(new Date(monthKey + '-02'), 'MMM yyyy', {locale: es}), quantity, date: new Date(monthKey+'-02') }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [filteredRequests]);

  // === RESUMEN ===
  const summary = useMemo(() => {
    const totalItems = filteredRequests.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    return {
      totalRequests: filteredRequests.length,
      totalItems,
      topSupervisor: topSupervisors[0]?.name || 'N/A',
      topSupervisorQty: topSupervisors[0]?.quantity || 0,
      topMaterial: topMaterials[0]?.name || 'N/A',
      topMaterialQty: topMaterials[0]?.quantity || 0,
      topMaterialUnit: topMaterials[0]?.unit || 'und',
      topSupervisors: topSupervisors,
      topMaterials: topMaterials,
    };
  }, [filteredRequests, topSupervisors, topMaterials]);

  const exportToExcelPRO = async () => {
    const dataForExport = filteredRequests.map(req => ({
      fecha: getDate(req.createdAt) ? format(getDate(req.createdAt)!, 'dd/MM/yyyy') : 'N/A',
      supervisor: userMap.get(req.supervisorId)?.name || 'Sin asignar',
      obra: req.area || 'No especificada',
      material: req.materialName,
      cantidad: req.quantity,
      unidad: req.unit || 'und',
      estado: req.status || 'Pendiente'
    }));
  
    const columns = [
      { header: 'Fecha', key: 'fecha', width: 15 },
      { header: 'Supervisor / APR', key: 'supervisor', width: 30 },
      { header: 'Obra', key: 'obra', width: 25 },
      { header: 'Material', key: 'material', width: 40 },
      { header: 'Cantidad', key: 'cantidad', width: 15 },
      { header: 'Unidad', key: 'unidad', width: 15 },
      { header: 'Estado', key: 'estado', width: 20 },
    ];
  
    const res = await fetch("/api/reports/export", {
      method: "POST",
      body: JSON.stringify({ data: dataForExport, columns: columns }),
      headers: { 'Content-Type': 'application/json' }
    });
  
    if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "reporte_solicitudes.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } else {
        alert('Error al generar el reporte.');
    }
  };
  
    const supervisors = (users || []).filter(u => ['supervisor','apr','administrador'].includes(u.role));


  return (
    <div className="flex flex-col gap-8 pb-12">
      <PageHeader
        title="Centro de Reportes Avanzado"
        description="Dashboard completo con gráficos en tiempo real, filtros y exportación."
      />

      {/* FILTROS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Filter className="h-5 w-5" /> Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>Desde</Label>
              <Popover open={datePopover === 'from'} onOpenChange={o => setDatePopover(o ? 'from' : null)}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dateFrom ? format(filters.dateFrom, 'dd/MM/yyyy', { locale: es }) : 'Fecha'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={filters.dateFrom}
                    onSelect={d => { setFilters(p => ({ ...p, dateFrom: d || startOfMonth(new Date()) })); setDatePopover(null); }} />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Hasta</Label>
              <Popover open={datePopover === 'to'} onOpenChange={o => setDatePopover(o ? 'to' : null)}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dateTo ? format(filters.dateTo, 'dd/MM/yyyy', { locale: es }) : 'Fecha'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={filters.dateTo}
                    onSelect={d => { setFilters(p => ({ ...p, dateTo: d || endOfMonth(new Date()) })); setDatePopover(null); }} />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Supervisor / APR</Label>
              <Select value={filters.supervisorId} onValueChange={v => setFilters(p => ({ ...p, supervisorId: v }))}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {supervisors.map((u: UserType) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button onClick={exportToExcelPRO} className="w-full gap-3 bg-green-600 hover:bg-green-700">
                <Download className="h-5 w-5" />
                Descargar Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CARDS RESUMEN */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Total Solicitudes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalRequests.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4" /> Unidades Totales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalItems.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <User className="h-4 w-4" /> Top Solicitante
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-semibold truncate">{summary.topSupervisor}</div>
            <p className="text-xs text-muted-foreground">{summary.topSupervisorQty.toLocaleString()} und</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4" /> Material Más Pedido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-semibold truncate">{summary.topMaterial}</div>
            <p className="text-xs text-muted-foreground">{summary.topMaterialQty.toLocaleString()} {summary.topMaterialUnit}</p>
          </CardContent>
        </Card>
      </div>

      {/* GRÁFICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Barras: Top 10 Solicitantes */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Solicitantes por Volumen</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartDataSupervisors}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} fontSize={12} />
                <YAxis />
                <Tooltip formatter={(v: any) => `${Number(v).toLocaleString()} und`} />
                <Bar dataKey="quantity" fill="#3b82f6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Torta: Materiales Más Pedidos */}
        <Card>
          <CardHeader>
            <CardTitle>Distribución por Material</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value.toLocaleString()}`}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Línea: Evolución Mensual */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Evolución Mensual de Solicitudes (unidades)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyEvolution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v: any) => `${Number(v).toLocaleString()} und`} />
                <Line type="monotone" dataKey="quantity" stroke="#10b981" strokeWidth={3} dot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* TABLAS DETALLADAS */}
      <Tabs defaultValue="supervisors" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="supervisors">Ranking por Persona</TabsTrigger>
          <TabsTrigger value="materials">Ranking por Material</TabsTrigger>
        </TabsList>

        <TabsContent value="supervisors">
          <Card>
            <CardHeader><CardTitle>Quién pide más y qué</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Supervisor</TableHead>
                    <TableHead className="text-right">Solicitudes</TableHead>
                    <TableHead className="text-right">Total Unidades</TableHead>
                    <TableHead>Material Más Pedido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.topSupervisors.map((s, i) => {
                    const topMat = filteredRequests
                      .filter(r => userMap.get(r.supervisorId)?.name === s.name)
                      .reduce((acc, r) => {
                        acc[r.materialName] = (acc[r.materialName] || 0) + r.quantity;
                        return acc;
                      }, {} as Record<string, number>);
                    const mat = Object.entries(topMat).sort((a: any, b: any) => b[1] - a[1])[0];
                    return (
                      <TableRow key={s.name}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-semibold">{s.name}</TableCell>
                        <TableCell className="text-right">{filteredRequests.filter(r => userMap.get(r.supervisorId)?.name === s.name).length}</TableCell>
                        <TableCell className="text-right font-mono text-lg">{s.quantity.toLocaleString()}</TableCell>
                        <TableCell><Badge variant="secondary">{mat?.[0] || 'Varios'}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="materials">
          <Card>
            <CardHeader><CardTitle>Materiales más solicitados</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Unidad</TableHead>
                    <TableHead className="text-right">Cantidad Total</TableHead>
                    <TableHead className="text-right">N° Solicitudes</TableHead>
                    <TableHead>Top 3 Solicitantes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.topMaterials.map((m, i) => {
                    const requesters = filteredRequests
                      .filter(r => r.materialName === m.name)
                      .reduce((acc, r) => {
                        const name = userMap.get(r.supervisorId)?.name || 'Desconocido';
                        acc[name] = (acc[name] || 0) + r.quantity;
                        return acc;
                      }, {} as Record<string, number>);

                    const top3 = Object.entries(requesters)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3)
                      .map(([name, qty]) => `${name} (${qty.toLocaleString()})`)
                      .join(', ');

                    return (
                      <TableRow key={m.name}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-semibold">{m.name}</TableCell>
                        <TableCell>{m.unit}</TableCell>
                        <TableCell className="text-right font-mono text-lg">{m.quantity.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{filteredRequests.filter(r => r.materialName === m.name).length}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-md truncate" title={top3}>
                          {top3 || 'Varios'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
