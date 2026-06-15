
"use client";

import React from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Briefcase } from "lucide-react";
import type { Supplier } from "@/modules/core/lib/data";


export default function SupervisorSuppliersPage() {
    const { suppliers } = useAppState();

    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Proveedores Disponibles"
                description="Consulta los proveedores con los que trabajamos y las categorías de materiales que ofrecen."
            />
            
            <Card>
                <CardHeader>
                    <CardTitle>Lista de Proveedores</CardTitle>
                    <CardDescription>Explora nuestros proveedores y sus especialidades.</CardDescription>
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
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
