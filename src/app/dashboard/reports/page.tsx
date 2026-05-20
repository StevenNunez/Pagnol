
"use client";

import React, { useState, useMemo, useCallback } from 'react';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer
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
import {
  Download,
  CalendarIcon,
  Filter,
  TrendingUp,
  Package,
  User,
  XCircle,
  BarChart3,
  PieChart as PieChartIcon,
  FileSpreadsheet,
  SearchX
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PurchaseRequest, User as UserType, Material } from '@/modules/core/lib/data';
import { useToast } from '@/modules/core/hooks/use-toast';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const getDate = (date: Date | string | undefined | null): Date | null => {
  if (!date) return null;
  return new Date(date as any);
};

export default function ReportsWithCharts() {
  const { purchaseRequests = [], users = [], materials = [] } = useAppState();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  // Estado inicial de filtros
  const initialFilters = {
    dateFrom: startOfMonth(new Date()),
    dateTo: endOfMonth(new Date()),
    supervisorId: 'all',
    materialId: 'all',
  };

  const [filters, setFilters] = useState(initialFilters);
  const [datePopover, setDatePopover] = useState<'from' | 'to' | null>(null);

  // Memoizar mapa de usuarios para acceso O(1)
  const userMap = useMemo(() => {
    const map = new Map<string, UserType>();
    users.forEach((u: UserType) => map.set(u.id, u));
    return map;
  }, [users]);

  // OPTIMIZACIÓN CRÍTICA: Pre-calcular el nombre del material seleccionado para evitar .find() dentro del loop
  const selectedMaterialName = useMemo(() => {
    if (filters.materialId === 'all') return null;
    return materials.find((m: Material) => m.id === filters.materialId)?.name || null;
  }, [filters.materialId, materials]);

  // Filtrado optimizado
  const filteredRequests = useMemo(() => {
    // Si no hay rango de fechas, retornamos vacío o todo según lógica de negocio. Aquí asumo que siempre hay fechas por defecto.
    if (!filters.dateFrom || !filters.dateTo) return [];

    return purchaseRequests.filter((req: PurchaseRequest) => {
      const reqDate = getDate(req.createdAt);
      if (!reqDate) return false;

      // 1. Filtro de Fechas (usando timestamps para comparación rápida)
      if (reqDate < filters.dateFrom || reqDate > filters.dateTo) return false;

      // 2. Filtro de Supervisor
      if (filters.supervisorId !== 'all' && req.supervisorId !== filters.supervisorId) return false;

      // 3. Filtro de Material (comparación directa de string, mucho más rápido)
      if (selectedMaterialName && req.materialName !== selectedMaterialName) return false;

      return true;
    });
  }, [purchaseRequests, filters, selectedMaterialName]);

  // === CÁLCULOS DE ESTADÍSTICAS ===
  const { topSupervisors, topMaterials, monthlyEvolution, summary } = useMemo(() => {
    const supervisorTotals = new Map<string, number>();
    const materialTotals = new Map<string, { quantity: number; unit: string; count: number }>();
    const monthlyTotals = new Map<string, number>();
    let totalItems = 0;

    filteredRequests.forEach((req: PurchaseRequest) => {
      const quantity = Number(req.quantity) || 0;
      totalItems += quantity;

      // Totales por Supervisor
      const supervisorName = userMap.get(req.supervisorId)?.name || 'Sin asignar';
      supervisorTotals.set(supervisorName, (supervisorTotals.get(supervisorName) || 0) + quantity);

      // Totales por Material
      const currentMat = materialTotals.get(req.materialName) || { quantity: 0, unit: req.unit || 'und', count: 0 };
      materialTotals.set(req.materialName, {
        quantity: currentMat.quantity + quantity,
        unit: currentMat.unit,
        count: currentMat.count + 1
      });

      // Evolución Mensual
      const reqDate = getDate(req.createdAt);
      if (reqDate) {
        const monthKey = format(reqDate, 'yyyy-MM');
        monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) || 0) + quantity);
      }
    });

    // Ordenamiento y Formateo
    const sortedSupervisors = Array.from(supervisorTotals.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity);

    const sortedMaterials = Array.from(materialTotals.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.quantity - a.quantity);

    const monthlyData = Array.from(monthlyTotals.entries())
      .map(([monthKey, quantity]) => {
        // Crear fecha segura usando el primer día del mes para evitar problemas de zona horaria al formatear solo mes
        const [year, month] = monthKey.split('-').map(Number);
        const dateObj = new Date(year, month - 1, 2);
        return {
          monthKey,
          label: format(dateObj, 'MMM yyyy', { locale: es }),
          quantity,
          date: dateObj
        };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    return {
      topSupervisors: sortedSupervisors,
      topMaterials: sortedMaterials,
      monthlyEvolution: monthlyData,
      summary: {
        totalRequests: filteredRequests.length,
        totalItems,
        topSupervisor: sortedSupervisors[0],
        topMaterial: sortedMaterials[0]
      }
    };
  }, [filteredRequests, userMap]);

  const chartDataSupervisors = topSupervisors.slice(0, 10);
  const chartDataMaterials = topMaterials.slice(0, 8);

  const pieData = chartDataMaterials.map((item, i) => ({
    name: item.name,
    value: item.quantity,
    color: COLORS[i % COLORS.length]
  }));

  // === FUNCIONES DE UI ===

  const resetFilters = () => {
    setFilters(initialFilters);
    toast({ description: "Filtros restablecidos" });
  };

  const exportToExcelPRO = async () => {
    if (filteredRequests.length === 0) {
      toast({ variant: "destructive", title: "Sin datos", description: "No hay datos para exportar con los filtros actuales." });
      return;
    }

    setIsExporting(true);
    try {
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
        a.download = `reporte_solicitudes_${format(new Date(), 'dd-MM-yyyy')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        toast({ title: "Éxito", description: "Reporte descargado correctamente." });
      } else {
        throw new Error('Error en el servidor');
      }
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Error de exportación",
        description: "No se pudo generar el Excel. Verifica tu conexión."
      });
    } finally {
      setIsExporting(false);
    }
  };

  const supervisors = useMemo(() =>
    (users || []).filter(u => ['supervisor', 'apr', 'administrador'].includes(u.role)),
    [users]);

  // Si no hay datos (Empty State)
  const isEmpty = filteredRequests.length === 0;

  return (
    <div className="flex flex-col gap-8 pb-12 fade-in">
      <PageHeader
        title="Centro de Reportes Avanzado"
        description="Dashboard completo con gráficos en tiempo real, filtros inteligentes y exportación de datos."
      />

      {/* FILTROS */}
      <Card className="border-l-4 border-l-primary/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><Filter className="h-4 w-4 text-primary" /> Filtros de Búsqueda</span>
            {(filters.materialId !== 'all' || filters.supervisorId !== 'all') && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 text-muted-foreground hover:text-destructive">
                <XCircle className="mr-2 h-3.5 w-3.5" /> Limpiar filtros
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Fecha Inicio</Label>
              <Popover open={datePopover === 'from'} onOpenChange={o => setDatePopover(o ? 'from' : null)}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-9">
                    <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                    {filters.dateFrom ? format(filters.dateFrom, 'dd/MM/yyyy', { locale: es }) : 'Seleccionar'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={filters.dateFrom}
                    onSelect={d => { if (d) { setFilters(p => ({ ...p, dateFrom: d })); setDatePopover(null); } }} />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Fecha Fin</Label>
              <Popover open={datePopover === 'to'} onOpenChange={o => setDatePopover(o ? 'to' : null)}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-9">
                    <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                    {filters.dateTo ? format(filters.dateTo, 'dd/MM/yyyy', { locale: es }) : 'Seleccionar'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={filters.dateTo}
                    onSelect={d => { if (d) { setFilters(p => ({ ...p, dateTo: d })); setDatePopover(null); } }} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="lg:col-span-1">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Supervisor</Label>
              <Select value={filters.supervisorId} onValueChange={v => setFilters(p => ({ ...p, supervisorId: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los supervisores</SelectItem>
                  {supervisors.map((u: UserType) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="lg:col-span-1">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Material</Label>
              <Select value={filters.materialId} onValueChange={v => setFilters(p => ({ ...p, materialId: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los materiales</SelectItem>
                  {materials.map((m: Material) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={exportToExcelPRO}
                className="w-full gap-2 bg-green-600 hover:bg-green-700 h-9"
                disabled={isExporting || isEmpty}
              >
                {isExporting ? <span className="animate-spin">⏳</span> : <FileSpreadsheet className="h-4 w-4" />}
                Exportar Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
          <SearchX className="h-16 w-16 mb-4 opacity-20" />
          <h3 className="text-xl font-semibold text-foreground">Sin resultados</h3>
          <p className="max-w-sm text-center mt-2">No se encontraron solicitudes que coincidan con los filtros seleccionados. Intenta ampliar el rango de fechas.</p>
          <Button variant="link" onClick={resetFilters} className="mt-4">Restablecer filtros</Button>
        </div>
      ) : (
        <>
          {/* CARDS RESUMEN */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-700 dark:text-blue-400">
                  <TrendingUp className="h-4 w-4" /> Total Solicitudes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalRequests.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Package className="h-4 w-4" /> Unidades Totales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalItems.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" /> Top Solicitante
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-semibold truncate">{summary.topSupervisor?.name || 'N/A'}</div>
                <p className="text-xs text-muted-foreground">{summary.topSupervisor?.quantity?.toLocaleString() ?? 0} unidades</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Package className="h-4 w-4" /> Material Top
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-semibold truncate">{summary.topMaterial?.name || 'N/A'}</div>
                <p className="text-xs text-muted-foreground">
                  {summary.topMaterial?.quantity?.toLocaleString() ?? 0} {summary.topMaterial?.unit ?? 'und'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* GRÁFICOS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Barras: Top 10 Solicitantes */}
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-muted-foreground" /> Ranking Solicitantes</CardTitle>
                <CardDescription>Top 10 usuarios con mayor volumen de pedidos</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartDataSupervisors} layout="vertical" margin={{ left: 40, right: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
                      <RechartsTooltip
                        formatter={(v: any) => [`${Number(v).toLocaleString()} und`, 'Cantidad']}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="quantity" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20}>
                        {chartDataSupervisors.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Torta: Materiales Más Pedidos */}
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><PieChartIcon className="h-5 w-5 text-muted-foreground" /> Distribución por Material</CardTitle>
                <CardDescription>Proporción de volumen de los 8 materiales principales</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={110}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={`cell-${i}`} fill={entry.color} strokeWidth={1} />
                        ))}
                      </Pie>
                      <RechartsTooltip formatter={(v: number) => `${v.toLocaleString()} und`} />
                      <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '11px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Línea: Evolución Mensual */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Tendencia Mensual</CardTitle>
                <CardDescription>Evolución de la cantidad total solicitada en el tiempo</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyEvolution} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: '#888' }}
                        dy={10}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: '#888' }}
                      />
                      <RechartsTooltip
                        contentStyle={{ borderRadius: '8px' }}
                        formatter={(v: any) => [`${Number(v).toLocaleString()} und`, 'Total']}
                      />
                      <Line
                        type="monotone"
                        dataKey="quantity"
                        stroke="#10b981"
                        strokeWidth={3}
                        dot={{ r: 4, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* TABLAS DETALLADAS */}
          <Tabs defaultValue="supervisors" className="w-full">
            <TabsList className="grid w-full grid-cols-2 max-w-md mb-4">
              <TabsTrigger value="supervisors">Ranking por Persona</TabsTrigger>
              <TabsTrigger value="materials">Ranking por Material</TabsTrigger>
            </TabsList>

            <TabsContent value="supervisors">
              <Card>
                <CardHeader>
                  <CardTitle>Detalle por Solicitante</CardTitle>
                  <CardDescription>Desglose de actividad por cada supervisor o APR.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">#</TableHead>
                        <TableHead>Supervisor</TableHead>
                        <TableHead className="text-right">N° Solicitudes</TableHead>
                        <TableHead className="text-right">Volumen Total</TableHead>
                        <TableHead>Material Preferido</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topSupervisors.map((s, i) => {
                        // Calcular material preferido para este usuario específico
                        // Nota: Hacemos esto aquí para mostrar el dato curioso, aunque no es performante para miles de usuarios,
                        // para un top list está bien.
                        const userRequests = filteredRequests.filter(r => userMap.get(r.supervisorId)?.name === s.name);
                        const matCounts = userRequests.reduce((acc, r) => {
                          acc[r.materialName] = (acc[r.materialName] || 0) + r.quantity;
                          return acc;
                        }, {} as Record<string, number>);
                        const favMat = Object.entries(matCounts).sort((a, b) => b[1] - a[1])[0];

                        return (
                          <TableRow key={s.name}>
                            <TableCell className="font-mono text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{s.name}</TableCell>
                            <TableCell className="text-right">{userRequests.length}</TableCell>
                            <TableCell className="text-right font-bold">{s.quantity.toLocaleString()}</TableCell>
                            <TableCell>
                              {favMat ? (
                                <Badge variant="secondary" className="font-normal">
                                  {favMat[0]} <span className="ml-1 opacity-50">({favMat[1]})</span>
                                </Badge>
                              ) : '-'}
                            </TableCell>
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
                <CardHeader>
                  <CardTitle>Detalle por Material</CardTitle>
                  <CardDescription>Inventario de necesidades y consumidores principales.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">#</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Unidad</TableHead>
                        <TableHead className="text-right">Volumen Total</TableHead>
                        <TableHead className="text-right">Frecuencia</TableHead>
                        <TableHead>Consumidores Principales</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topMaterials.map((m, i) => {
                        // Calcular top consumidores de este material
                        const consumers = filteredRequests
                          .filter(r => r.materialName === m.name)
                          .reduce((acc, r) => {
                            const name = userMap.get(r.supervisorId)?.name || 'Desconocido';
                            acc[name] = (acc[name] || 0) + r.quantity;
                            return acc;
                          }, {} as Record<string, number>);

                        const topConsumers = Object.entries(consumers)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 2) // Solo mostrar top 2 para no saturar la tabla
                          .map(([name, qty]) => `${name.split(' ')[0]} (${qty})`)
                          .join(', ');

                        return (
                          <TableRow key={m.name}>
                            <TableCell className="font-mono text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{m.name}</TableCell>
                            <TableCell className="text-muted-foreground">{m.unit}</TableCell>
                            <TableCell className="text-right font-bold text-lg">{m.quantity.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{m.count}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {topConsumers || '-'}
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
        </>
      )}
    </div>
  );
}
