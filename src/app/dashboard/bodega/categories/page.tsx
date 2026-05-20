
"use client";

import React, { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { MoreHorizontal, Edit, Trash2, Search, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { MaterialCategory } from "@/modules/core/lib/data";
import { CreateCategoryForm } from "@/components/admin/create-category-form";
import { EditCategoryForm } from "@/components/admin/edit-category-form";


export default function AdminCategoriesPage() {
    const { materialCategories, deleteMaterialCategory } = useAppState();
    const [editingCategory, setEditingCategory] = useState<MaterialCategory | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const { toast } = useToast();

    const filteredCategories = useMemo(() => {
        if (!searchTerm) return materialCategories || [];
        return (materialCategories || []).filter(c =>
            c.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [materialCategories, searchTerm]);

    const handleDeleteCategory = async (categoryId: string, categoryName: string) => {
        try {
            await deleteMaterialCategory(categoryId);
            toast({
                title: "Categoría Eliminada",
                description: `La categoría ${categoryName} ha sido eliminada correctamente.`
            });
        } catch (error: any) {
             toast({
                variant: "destructive",
                title: "Error al eliminar",
                description: error?.message || "No se pudo eliminar la categoría."
            });
        }
    }


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
                <div className="lg:col-span-1">
                    <Card className="border-l-4 border-l-primary shadow-sm">
                        <CardHeader>
                            <CardTitle>Añadir Categoría</CardTitle>
                            <CardDescription>Organiza los materiales por tipo o área de uso.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <CreateCategoryForm />
                        </CardContent>
                    </Card>
                </div>
                <div className="lg:col-span-2">
                    <Card className="shadow-sm">
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>Categorías ({filteredCategories.length}{searchTerm ? ` de ${materialCategories?.length ?? 0}` : ""})</CardTitle>
                                    <CardDescription>Todas las categorías registradas en el sistema.</CardDescription>
                                </div>
                            </div>
                            <div className="relative mt-2">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar categoría..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[500px] border rounded-md">
                                <div className="space-y-2 p-3">
                                    {filteredCategories.length > 0 ? filteredCategories.map((category: MaterialCategory) => (
                                        <div key={category.id} className="flex items-center justify-between px-4 py-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors gap-4">
                                            <p className="font-medium text-sm">{category.name}</p>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0 shrink-0">
                                                        <span className="sr-only">Abrir menu</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => setEditingCategory(category)}>
                                                        <Edit className="mr-2 h-4 w-4"/>
                                                        <span>Editar</span>
                                                    </DropdownMenuItem>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                                                <Trash2 className="mr-2 h-4 w-4 text-destructive"/>
                                                                <span className="text-destructive">Eliminar</span>
                                                            </DropdownMenuItem>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>¿Eliminar "{category.name}"?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Esta acción no se puede deshacer. Fallará si algún material o proveedor usa esta categoría.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    className="bg-destructive hover:bg-destructive/90"
                                                                    onClick={() => handleDeleteCategory(category.id, category.name)}>
                                                                    Sí, eliminar
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    )) : (
                                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                            <FolderOpen className="h-10 w-10 mb-2 opacity-30" />
                                            <p className="text-sm">{searchTerm ? `Sin resultados para "${searchTerm}"` : "No hay categorías aún."}</p>
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
