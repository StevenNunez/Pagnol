
"use client";

import React, { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, X, Camera, Send, Loader2, Image as ImageIcon } from "lucide-react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetFooter,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/modules/core/hooks/use-toast";
import { useAuth } from "@/modules/auth/useAuth";
import { motion, AnimatePresence } from "framer-motion";

export function FeedbackButton() {
    const { user, currentTenantId } = useAuth();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [description, setDescription] = useState("");
    const [image, setImage] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImage(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async () => {
        if (!description.trim()) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "Por favor describe el problema.",
            });
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: user?.id,
                    user_name: user?.name,
                    user_email: user?.email,
                    tenant_id: currentTenantId,
                    description,
                    image,
                    url: window.location.href,
                }),
            });

            if (!res.ok) throw new Error('Error del servidor');

            toast({
                title: "Reporte Enviado",
                description: "Gracias por ayudarnos a mejorar Pagnol.",
            });
            setDescription("");
            setImage(null);
            setIsOpen(false);
        } catch (error) {
            console.error("Error submitting feedback:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo enviar el reporte.",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed bottom-6 left-6 z-50">
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="flex items-center gap-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-5 py-3 rounded-full shadow-2xl shadow-slate-400 group border border-slate-700/50"
                    >
                        <MessageSquarePlus size={20} className="group-hover:rotate-12 transition-transform" />
                        <span className="text-xs font-black uppercase tracking-widest">Reportar Error</span>
                    </motion.button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[400px] sm:w-[540px] border-none bg-slate-50 dark:bg-slate-950 p-0 overflow-hidden">
                    <div className="h-full flex flex-col">
                        <div className="p-8 bg-white dark:bg-slate-900 border-b dark:border-slate-800">
                            <SheetHeader>
                                <SheetTitle className="text-2xl font-black uppercase font-outfit text-slate-800 dark:text-slate-100">Feedback System</SheetTitle>
                                <SheetDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                    Reporta errores o sugiere mejoras con capturas de pantalla
                                </SheetDescription>
                            </SheetHeader>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 space-y-8">
                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2">
                                    <MessageSquarePlus size={14} /> ¿Qué sucedió?
                                </Label>
                                <Textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Describe brevemente el error o sugerencia..."
                                    className="min-h-[150px] rounded-2xl border-none shadow-sm bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-pagnol-orange/20"
                                />
                            </div>

                            <div className="space-y-3">
                                <Label className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2">
                                    <Camera size={14} /> Captura de Pantalla
                                </Label>
                                <div className="space-y-4">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        ref={fileInputRef}
                                        onChange={handleImageChange}
                                    />

                                    {!image ? (
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="w-full py-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-3 hover:border-slate-400 dark:hover:border-slate-600 transition-colors group bg-white dark:bg-slate-900"
                                        >
                                            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-full text-slate-400 group-hover:scale-110 transition-transform">
                                                <ImageIcon size={24} />
                                            </div>
                                            <div className="text-center">
                                                <p className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">Añadir Imagen</p>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase">Screenshot del problema</p>
                                            </div>
                                        </button>
                                    ) : (
                                        <div className="relative rounded-2xl overflow-hidden shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2">
                                            <img src={image} alt="Preview" className="w-full aspect-video object-cover rounded-xl" />
                                            <button
                                                onClick={() => setImage(null)}
                                                className="absolute top-4 right-4 bg-red-500 text-white p-2 rounded-full shadow-lg hover:bg-red-600 transition-colors"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-8 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
                            <Button
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                                className="w-full py-7 rounded-[1.2rem] bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-black text-white shadow-xl flex items-center gap-3 group overflow-hidden relative"
                            >
                                <AnimatePresence mode="wait">
                                    {isSubmitting ? (
                                        <motion.div
                                            key="loading"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="flex items-center gap-2"
                                        >
                                            <Loader2 size={18} className="animate-spin" />
                                            <span className="font-black text-[10px] uppercase tracking-widest">Enviando...</span>
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="submit"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="flex items-center gap-2"
                                        >
                                            <Send size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                                            <span className="font-black text-[10px] uppercase tracking-widest">Enviar Reporte</span>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </Button>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
