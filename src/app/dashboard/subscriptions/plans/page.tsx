"use client";

import React, { useMemo } from "react";
import { PageShell } from "@/components/page-shell";
import { useAuth, useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, Crown, ShieldCheck } from "lucide-react";
import { EditPlanForm } from "@/components/admin/edit-plan-form";
import { SubscriptionPlan } from "@/modules/core/lib/data";
import { PLANS } from "@/modules/core/lib/permissions";

// Mapa estático: las clases construidas con template strings se purgan en producción.
const planColors: Record<string, { bg: string; icon: string; border: string }> = {
  starter: { bg: "bg-muted", icon: "text-muted-foreground", border: "border-border" },
  professional: { bg: "bg-info-subtle", icon: "text-info-subtle-foreground", border: "border-info/20" },
  enterprise: { bg: "bg-primary/5", icon: "text-primary", border: "border-primary/20" },
};

export default function SubscriptionPlansPage() {
  const { can } = useAuth();
  const { subscriptionPlans } = useAppState();

  const plans = useMemo(() => {
    const source = subscriptionPlans || PLANS;
    return (Object.keys(source) as Array<keyof typeof source>).map((key) => ({
      id: key as string,
      ...(source[key] as any),
    })) as (SubscriptionPlan & { id: string })[];
  }, [subscriptionPlans]);

  if (!can("module_subscriptions:view")) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle size={36} />
        <p className="font-bold uppercase tracking-widest text-sm">Acceso denegado</p>
      </div>
    );
  }

  return (
    <PageShell
      title="Planes y Permisos"
      description="Define qué permisos están disponibles en cada plan de suscripción."
    >

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const colors = planColors[plan.id] ?? planColors.starter;
          return (
            <Card
              key={plan.id}
              className={`rounded-[1.5rem] border bg-card overflow-hidden ${colors.border}`}
            >
              <CardHeader className={`p-6 pb-4 ${colors.bg}`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-2xl bg-card shadow-sm ${colors.icon}`}>
                    <Crown size={18} />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-black uppercase capitalize">{plan.plan ?? plan.id}</CardTitle>
                    <CardDescription className="text-[10px] uppercase font-bold tracking-widest">
                      {(plan.allowedPermissions as string[] | undefined)?.length ?? 0} permisos habilitados
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <EditPlanForm plan={plan} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}
