"use client"

import { useToast } from "@/modules/core/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Bell,
  Package
} from "lucide-react"

export function Toaster() {
  const { toasts } = useToast()

  const getIcon = (variant?: string) => {
    switch (variant) {
      case 'success': return <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
      case 'destructive': return <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
      case 'warning': return <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" />
      case 'info': return <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
      case 'pagnol': return <Package className="h-5 w-5 text-pagnol-orange" />
      default: return <Bell className="h-5 w-5 text-slate-400" />
    }
  }

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="flex gap-4 items-start">
              <div className="mt-0.5 shrink-0">
                {getIcon(variant as string)}
              </div>
              <div className="grid gap-1">
                {title && <ToastTitle className="text-sm font-black uppercase tracking-tight leading-none">{title}</ToastTitle>}
                {description && (
                  <ToastDescription className="text-xs font-medium opacity-70 leading-relaxed">
                    {description}
                  </ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose className="text-slate-400 hover:text-slate-900 dark:hover:text-white" />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
