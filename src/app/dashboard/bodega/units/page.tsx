
"use client";

import React, { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Trash2, Search, Ruler as RulerIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Unit } from "@/modules/core/lib/data";
import { CreateUnitForm } from "@/components/admin/create-unit-form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";


export default function AdminUnitsPage() {
    const { units, deleteUnit, can } = useAppState();
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState("");

    const filteredUnits = useMemo(() => {
        if (!searchTerm) return units || [];
        return (units || []).filter(u =>
            u.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [units, searchTerm]);

    const handleDeleteUnit = async (unitId: string, unitName: string) => {
        try {
            await deleteUnit(unitId);
            toast({
                title: "Unidad Eliminada",
                description: `La unidad ${unitName} ha sido eliminada correctamente.`
            });
        } catch (error: any) {
             toast({
                variant: "destructive",
                title: "Error al eliminar",
                description: error?.message || "No se pudo eliminar la unidad."
            });
        }
    }
    
    const canCreate = can('units:create');
    const canDelete = can('units:delete');


    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Gestión de Unidades de Medida"
                description="Crea y gestiona las unidades (ej: kg, m2, unidad) que se usarán en los materiales."
            />

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                {canCreate && (
                    <div className="lg:col-span-1">
                        <Card className="border-l-4 border-l-primary shadow-sm">
                            <CardHeader>
                                <CardTitle>Añadir Unidad</CardTitle>
                                <CardDescription>Ej: kg, m², ml, unidad, litro, hora.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <CreateUnitForm />
                            </CardContent>
                        </Card>
                    </div>
                )}
                <div className={canCreate ? "lg:col-span-2" : "lg:col-span-3"}>
                    <Card className="shadow-sm">
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>Unidades ({filteredUnits.length}{searchTerm ? ` de ${units?.length ?? 0}` : ""})</CardTitle>
                                    <CardDescription>Unidades de medida registradas en el sistema.</CardDescription>
                                </div>
                            </div>
                            <div className="relative mt-2">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar unidad..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[500px] border rounded-md">
                                <div className="space-y-2 p-3">
                                    {filteredUnits.length > 0 ? filteredUnits.map((unit: Unit) => (
                                        <div key={unit.id} className="flex items-center justify-between px-4 py-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors gap-4">
                                            <p className="font-medium text-sm">{unit.name}</p>
                                            {canDelete && (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0">
                                                            <Trash2 className="h-4 w-4"/>
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>¿Eliminar unidad "{unit.name}"?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Esta acción no se puede deshacer. Fallará si algún material está usando esta unidad.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                className="bg-destructive hover:bg-destructive/90"
                                                                onClick={() => handleDeleteUnit(unit.id, unit.name)}>
                                                                Sí, eliminar
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            )}
                                        </div>
                                    )) : (
                                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                            <RulerIcon className="h-10 w-10 mb-2 opacity-30" />
                                            <p className="text-sm">{searchTerm ? `Sin resultados para "${searchTerm}"` : "No hay unidades aún."}</p>
                                        </div>
                                    )}
                                </div>
                                <ScrollBar orientation="vertical" />
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
