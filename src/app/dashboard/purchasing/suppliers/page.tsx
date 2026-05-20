
"use client";

import React, { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateSupplierForm } from "@/components/admin/create-supplier-form";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Briefcase, MoreHorizontal, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { Supplier } from "@/modules/core/lib/data";
import { EditSupplierForm } from "@/components/admin/edit-supplier-form";

export default function SuppliersPage() {
    const { suppliers, deleteSupplier, can } = useAppState();
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const { toast } = useToast();

    const handleDeleteSupplier = async (supplierId: string, supplierName: string) => {
        try {
            await deleteSupplier(supplierId);
            toast({
                title: "Proveedor Eliminado",
                description: `El proveedor ${supplierName} ha sido eliminado correctamente.`
            });
        } catch (error: any) {
             toast({
                variant: "destructive",
                title: "Error al eliminar",
                description: error?.message || "No se pudo eliminar el proveedor."
            });
        }
    }

    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Gestión de Proveedores"
                description="Crea nuevos proveedores y visualiza todos los perfiles registrados en el sistema."
            />
            
            {editingSupplier && (
                <EditSupplierForm
                    supplier={editingSupplier}
                    isOpen={!!editingSupplier}
                    onClose={() => setEditingSupplier(null)}
                />
            )}

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                {can('suppliers:create') && (
                    <div className="lg:col-span-1">
                        <Card>
                            <CardHeader>
                                <CardTitle>Añadir Nuevo Proveedor</CardTitle>
                                <CardDescription>Añade nuevos proveedores al sistema para que aparezcan en las opciones de órdenes de compra.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <CreateSupplierForm />
                            </CardContent>
                        </Card>
                    </div>
                )}
                <div className={can('suppliers:create') ? "lg:col-span-2" : "lg:col-span-3"}>
                     <Card>
                        <CardHeader>
                            <CardTitle>Lista de Proveedores</CardTitle>
                            <CardDescription>Todos los proveedores registrados en el sistema.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[calc(80vh-10rem)] border rounded-md">
                                <div className="space-y-4 p-4">
                                    {(suppliers || []).map((supplier: Supplier) => (
                                        <div key={supplier.id} className="flex flex-col sm:flex-row sm:items-start sm:justify-between p-4 rounded-lg border gap-4">
                                            <div className="flex items-center gap-4 flex-grow">
                                                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                                                    <Briefcase className="h-6 w-6"/>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <p className="font-semibold">{supplier.name}</p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {supplier.categories.map((cat: string) => (
                                                            <Badge key={cat} variant="outline" className="text-xs">{cat}</Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <span className="sr-only">Abrir menu</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {can('suppliers:edit') && (
                                                        <DropdownMenuItem onClick={() => setEditingSupplier(supplier)}>
                                                            <Edit className="mr-2 h-4 w-4"/>
                                                            <span>Editar</span>
                                                        </DropdownMenuItem>
                                                    )}
                                                    {can('suppliers:delete') && (
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                                                    <Trash2 className="mr-2 h-4 w-4"/>
                                                                    <span className="text-destructive">Eliminar</span>
                                                                </DropdownMenuItem>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>¿Seguro que quieres eliminar a {supplier.name}?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        Esta acción no se puede deshacer. Se eliminará permanentemente al proveedor. Si está asignado a algún material, la acción fallará.
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                    <AlertDialogAction 
                                                                        className="bg-destructive hover:bg-destructive/90"
                                                                        onClick={() => handleDeleteSupplier(supplier.id, supplier.name)}>
                                                                        Sí, eliminar proveedor
                                                                    </AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    ))}
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

    