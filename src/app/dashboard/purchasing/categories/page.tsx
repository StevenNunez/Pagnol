
"use client";

import React, { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { MoreHorizontal, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MaterialCategory } from "@/modules/core/lib/data";
import { CreateCategoryForm } from "@/components/admin/create-category-form";
import { EditCategoryForm } from "@/components/admin/edit-category-form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";

export default function CategoriesPage() {
    const { materialCategories, deleteMaterialCategory, can } = useAppState();
    const [editingCategory, setEditingCategory] = useState<MaterialCategory | null>(null);
    const { toast } = useToast();

    const handleDelete = async (categoryId: string, categoryName: string) => {
        try {
            await deleteMaterialCategory(categoryId);
            toast({ title: "Categoría Eliminada", description: `La categoría "${categoryName}" fue eliminada.` });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error al eliminar", description: error.message });
        }
    };

    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Gestión de Categorías"
                description="Crea, edita y gestiona todas las categorías de materiales del sistema."
            />
            
            {editingCategory && (
                <EditCategoryForm
                    category={editingCategory}
                    isOpen={!!editingCategory}
                    onClose={() => setEditingCategory(null)}
                />
            )}

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                {can('categories:create') && (
                    <div className="lg:col-span-1">
                        <Card>
                            <CardHeader>
                                <CardTitle>Añadir Nueva Categoría</CardTitle>
                                <CardDescription>Añade una nueva categoría para organizar los materiales y proveedores.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <CreateCategoryForm />
                            </CardContent>
                        </Card>
                    </div>
                )}
                <div className={can('categories:create') ? "lg:col-span-2" : "lg:col-span-3"}>
                     <Card>
                        <CardHeader>
                            <CardTitle>Lista de Categorías</CardTitle>
                            <CardDescription>Todas las categorías registradas en el sistema.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[calc(80vh-10rem)] border rounded-md">
                                <div className="space-y-4 p-4">
                                    {(materialCategories || []).map((category: MaterialCategory) => (
                                        <div key={category.id} className="flex items-center justify-between p-4 rounded-lg border gap-4">
                                            <p className="font-semibold">{category.name}</p>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <span className="sr-only">Abrir menu</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {can('categories:edit') && (
                                                        <DropdownMenuItem onClick={() => setEditingCategory(category)}>
                                                            <Edit className="mr-2 h-4 w-4"/>
                                                            <span>Editar</span>
                                                        </DropdownMenuItem>
                                                    )}
                                                    {can('categories:delete') && (
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive">
                                                                    <Trash2 className="mr-2 h-4 w-4"/>
                                                                    <span>Eliminar</span>
                                                                </DropdownMenuItem>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>¿Eliminar "{category.name}"?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        Esta acción es permanente. Las solicitudes existentes no se verán afectadas, pero la categoría se eliminará de los filtros.
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleDelete(category.id, category.name)} className="bg-destructive hover:bg-destructive/90">
                                                                        Sí, eliminar
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

    