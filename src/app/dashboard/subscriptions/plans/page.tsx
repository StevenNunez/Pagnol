"use client";

import React, { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAuth, useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, Crown, ShieldCheck } from "lucide-react";
import { EditPlanForm } from "@/components/admin/edit-plan-form";
import { SubscriptionPlan } from "@/modules/core/lib/data";
import { PLANS } from "@/modules/core/lib/permissions";

const planColors: Record<string, { bg: string; icon: string; border: string }> = {
  starter: { bg: "bg-slate-100 dark:bg-slate-800", icon: "text-muted-foreground", border: "border-slate-200 dark:border-white/10" },
  professional: { bg: "bg-blue-50 dark:bg-blue-900/20", icon: "text-blue-500", border: "border-blue-200 dark:border-blue-800/40" },
  enterprise: { bg: "bg-pagnol-orange/5", icon: "text-pagnol-orange", border: "border-pagnol-orange/20" },
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
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Gestión de Planes"
        description="Define qué permisos están disponibles en cada plan de suscripción."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const colors = planColors[plan.id] ?? planColors.starter;
          return (
            <Card
              key={plan.id}
              className={`rounded-[2rem] border shadow-lg bg-slate-100 dark:bg-card overflow-hidden ${colors.border}`}
            >
              <CardHeader className={`p-6 pb-4 ${colors.bg}`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-2xl bg-white dark:bg-black/20 shadow-sm ${colors.icon}`}>
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
    </div>
  );
}
