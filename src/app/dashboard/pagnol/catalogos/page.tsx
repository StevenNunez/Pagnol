
"use client";

import React, { useState, useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { MoreHorizontal, Edit, Trash2, Search, FolderOpen, FolderTree, CornerDownRight, Ruler as RulerIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { MaterialCategory, Unit } from "@/modules/core/lib/data";
import { CreateCategoryForm } from "@/components/admin/create-category-form";
import { EditCategoryForm } from "@/components/admin/edit-category-form";
import { CreateUnitForm } from "@/components/admin/create-unit-form";

// ────────────────────────────────────────────────────────────────────────────
// Catálogos del pañol: Categorías de materiales + Unidades de medida.
// Fusiona las antiguas páginas bodega/categories y bodega/units.
// ────────────────────────────────────────────────────────────────────────────

function CategoriesSection() {
    const { materialCategories, deleteMaterialCategory } = useAppState();
    const [editingCategory, setEditingCategory] = useState<MaterialCategory | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const { toast } = useToast();

    // Lista jerárquica: familias (sin padre) con sus subcategorías indentadas.
    // Con búsqueda activa la lista es plana (se indica la familia en cada fila).
    const categoryById = useMemo(
        () => new Map((materialCategories || []).map((c: MaterialCategory) => [c.id, c])),
        [materialCategories]
    );
    const filteredCategories = useMemo(() => {
        const all = materialCategories || [];
        if (searchTerm) {
            return all
                .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
                .map(c => ({ category: c, depth: 0 as const }));
        }
        const byName = (a: MaterialCategory, b: MaterialCategory) => a.name.localeCompare(b.name);
        const families = all.filter(c => !c.parentId).sort(byName);
        // Huérfanas defensivas: con parentId que ya no existe (padre borrado).
        const orphans = all.filter(c => c.parentId && !categoryById.has(c.parentId!)).sort(byName);
        const rows: { category: MaterialCategory; depth: 0 | 1 }[] = [];
        [...families, ...orphans].forEach(f => {
            rows.push({ category: f, depth: 0 });
            all.filter(c => c.parentId === f.id).sort(byName)
                .forEach(child => rows.push({ category: child, depth: 1 }));
        });
        return rows;
    }, [materialCategories, searchTerm, categoryById]);

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
        <>
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
                            <CardTitle>Añadir Familia o Subcategoría</CardTitle>
                            <CardDescription>Organiza los activos en 2 niveles: Familia (Herramientas) → Subcategoría (Eléctricas, Manuales…).</CardDescription>
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
                                    {filteredCategories.length > 0 ? filteredCategories.map(({ category, depth }) => (
                                        <div key={category.id} className={`flex items-center justify-between px-4 py-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors gap-4 ${depth === 1 ? "ml-8 border-dashed" : ""}`}>
                                            <div className="flex items-center gap-2 min-w-0">
                                                {depth === 1 && <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                                <p className={`text-sm truncate ${depth === 0 && !searchTerm ? "font-bold" : "font-medium"}`}>{category.name}</p>
                                                {searchTerm && category.parentId && categoryById.has(category.parentId) && (
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground shrink-0">
                                                        {categoryById.get(category.parentId)!.name}
                                                    </span>
                                                )}
                                            </div>
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
                                                                    Si es una familia, sus subcategorías quedarán como familias independientes.
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
                                        <EmptyState
                                            className="border-0 bg-transparent py-12"
                                            icon={<FolderOpen size={22} />}
                                            title={searchTerm ? "Sin resultados" : "No hay categorías aún"}
                                            description={searchTerm ? `No se encontró "${searchTerm}".` : undefined}
                                        />
                                    )}
                                </div>
                                <ScrollBar orientation="vertical" />
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}

function UnitsSection() {
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
                                    <EmptyState
                                        className="border-0 bg-transparent py-12"
                                        icon={<RulerIcon size={22} />}
                                        title={searchTerm ? "Sin resultados" : "No hay unidades aún"}
                                        description={searchTerm ? `No se encontró "${searchTerm}".` : undefined}
                                    />
                                )}
                            </div>
                            <ScrollBar orientation="vertical" />
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default function CatalogosPage() {
    const [section, setSection] = useState<'categorias' | 'unidades'>('categorias');

    return (
        <PageShell
            title="Catálogos"
            description="Administra las categorías de materiales y las unidades de medida del sistema."
        >
            <Tabs value={section} onValueChange={(v) => setSection(v as 'categorias' | 'unidades')} className="w-full">
                <TabsList className="grid w-full max-w-md grid-cols-2 p-1 bg-muted rounded-xl mb-6">
                    <TabsTrigger value="categorias" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm gap-2">
                        <FolderTree className="h-4 w-4" /> Categorías
                    </TabsTrigger>
                    <TabsTrigger value="unidades" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm gap-2">
                        <RulerIcon className="h-4 w-4" /> Unidades
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="categorias">
                    <CategoriesSection />
                </TabsContent>
                <TabsContent value="unidades">
                    <UnitsSection />
                </TabsContent>
            </Tabs>
        </PageShell>
    );
}
