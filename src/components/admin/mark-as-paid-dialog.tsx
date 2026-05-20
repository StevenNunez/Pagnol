
'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { CalendarIcon, Loader2, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { SupplierPayment } from '@/modules/core/lib/data';

const Calendar = dynamic(() => import('@/components/ui/calendar').then(mod => mod.Calendar), { ssr: false });

const FormSchema = z.object({
  paymentDate: z.date({ required_error: "La fecha de pago es obligatoria." }),
  paymentMethod: z.string().min(1, "Debes seleccionar un método de pago."),
});

type FormData = z.infer<typeof FormSchema>;

interface MarkAsPaidDialogProps {
  isOpen: boolean;
  onClose: () => void;
  payment: SupplierPayment | null;
  onConfirm: (details: { paymentDate: Date; paymentMethod: string }) => Promise<void>;
}

const PAYMENT_METHODS = [
  "Transferencia",
  "Webpay",
  "Cheque",
  "Efectivo",
  "Tarjeta de Crédito",
  "Bitcoin",
];

export function MarkAsPaidDialog({ isOpen, onClose, payment, onConfirm }: MarkAsPaidDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      paymentDate: new Date(),
      paymentMethod: '',
    },
  });

  useEffect(() => {
    if (!isOpen) {
      reset({ paymentDate: new Date(), paymentMethod: '' });
    }
  }, [isOpen, reset]);

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    try {
      await onConfirm(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar Pago de Factura</DialogTitle>
          <DialogDescription>
            Confirma los detalles del pago para la factura <strong>{payment?.invoiceNumber}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="paymentDate">Fecha de Pago</Label>
            <Controller
                name="paymentDate"
                control={control}
                render={({ field }) => (
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className={cn(
                                "w-full justify-start text-left font-normal",
                                !field.value && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, "PPP", { locale: es }) : <span>Selecciona una fecha</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                )}
            />
            {errors.paymentDate && <p className="text-xs text-destructive">{errors.paymentDate.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Método de Pago</Label>
            <Controller
                name="paymentMethod"
                control={control}
                render={({ field }) => (
                     <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                            <SelectValue placeholder="Selecciona un método..." />
                        </SelectTrigger>
                        <SelectContent>
                            {PAYMENT_METHODS.map(method => (
                                <SelectItem key={method} value={method}>{method}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            />
             {errors.paymentMethod && <p className="text-xs text-destructive">{errors.paymentMethod.message}</p>}
          </div>
          
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <CheckCircle className="mr-2 h-4 w-4" />}
              Confirmar Pago
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
