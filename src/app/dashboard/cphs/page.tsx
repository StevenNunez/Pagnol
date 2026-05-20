"use client";

import React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  FileUp,
  ListChecks,
  ShieldCheck,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";

interface ActionCardProps {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
}

const ActionCard: React.FC<ActionCardProps> = ({
  href,
  icon: Icon,
  title,
  description,
}) => (
  <Link href={href} className="group">
    <Card className="h-full transition-all duration-300 ease-in-out hover:border-primary hover:shadow-lg hover:-translate-y-1">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </CardHeader>
    </Card>
  </Link>
);

export default function CphsDashboardPage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Panel del Comité Paritario"
        description={`Bienvenido, ${user?.name}. Accede a las herramientas de gestión de seguridad.`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <ActionCard
          href="/dashboard/safety/templates"
          icon={FileUp}
          title="Gestión de Plantillas"
          description="Crea y edita las plantillas para checklists e inspecciones."
        />
        <ActionCard
          href="/dashboard/safety/templates"
          icon={ListChecks}
          title="Asignar Checklists"
          description="Asigna plantillas a los supervisores para que las completen."
        />
        <ActionCard
          href="/dashboard/safety/review-checklists"
          icon={ShieldCheck}
          title="Revisar Checklists"
          description="Aprueba o rechaza los formularios completados."
        />
        <ActionCard
          href="/dashboard/safety/inspection"
          icon={ShieldAlert}
          title="Crear Inspección"
          description="Registra una nueva observación de seguridad en terreno."
        />
        <ActionCard
          href="/dashboard/safety/review-inspections"
          icon={ShieldCheck}
          title="Revisar Inspecciones"
          description="Da seguimiento a las soluciones de las inspecciones."
        />
      </div>
    </div>
  );
}