
"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from "@/modules/core/lib/supabase";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Clock, User, Building2, CheckCircle2, AlertCircle, ExternalLink, Image as ImageIcon, X } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/modules/core/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
interface Feedback {
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    tenantId: string;
    description: string;
    image: string | null;
    createdAt: Date;
    status: 'pending' | 'resolved';
    url: string;
}

export default function FeedbackPage() {
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const { toast } = useToast();

    const fetchFeedbacks = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('feedbacks')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const mappedData = data.map(item => ({
                id: item.id,
                userId: item.user_id,
                userName: item.user_name,
                userEmail: item.user_email,
                tenantId: item.tenant_id,
                description: item.description,
                image: item.image,
                createdAt: new Date(item.created_at),
                status: item.status,
                url: item.url
            })) as Feedback[];

            setFeedbacks(mappedData);
        } catch (error) {
            console.error("Error fetching feedback:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudieron cargar los feedbacks.",
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchFeedbacks();
    }, [fetchFeedbacks]);

    const resolveFeedback = async (id: string) => {
        try {
            const { error } = await supabase
                .from('feedbacks')
                .update({ status: 'resolved' })
                .eq('id', id);

            if (error) throw error;

            setFeedbacks(prev => prev.map(f => f.id === id ? { ...f, status: 'resolved' } : f));
            toast({
                title: "Feedback Resuelto",
                description: "El reporte ha sido marcado como resuelto.",
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo actualizar el estado.",
            });
        }
    };

    return (
        <PageShell
            title="Centro de Feedback y Errores"
            description="Panel de control para gestionar reportes técnicos y sugerencias de la plataforma"
        >

            <div className="grid grid-cols-1 gap-6">
                {loading ? (
                    <LoadingState label="Cargando reportes…" />
                ) : feedbacks.length === 0 ? (
                    <EmptyState
                        icon={<MessageSquare size={36} />}
                        title="Sin reportes activos"
                        description="No se han recibido errores o feedback todavía."
                    />
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {feedbacks.map((item) => (
                            <motion.div
                                layout
                                key={item.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <Card className={`rounded-[1.5rem] bg-card shadow-lg overflow-hidden transition-all ${item.status === 'resolved' ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                                    <div className="p-8 space-y-6">
                                        <div className="flex flex-wrap items-start justify-between gap-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-3">
                                                    <Badge className={`border-none font-black text-[9px] uppercase px-3 py-1 rounded-full ${item.status === 'pending' ? 'badge-warning' : 'badge-success'}`}>
                                                        {item.status === 'pending' ? 'Pendiente' : 'Resuelto'}
                                                    </Badge>
                                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                                                        <Clock size={12} />
                                                        {format(item.createdAt, "PPP p", { locale: es })}
                                                    </span>
                                                </div>
                                                <h3 className="text-sm font-black text-foreground uppercase leading-snug mt-2">
                                                    {item.description.length > 100 ? item.description.substring(0, 100) + "..." : item.description}
                                                </h3>
                                            </div>
                                            {item.status === 'pending' && (
                                                <Button
                                                    onClick={() => resolveFeedback(item.id)}
                                                    variant="outline"
                                                    size="sm"
                                                    className="rounded-xl badge-success border-success/20 hover:bg-success/20 font-black text-[10px] uppercase"
                                                >
                                                    <CheckCircle2 size={14} className="mr-2" /> Marcar Resuelto
                                                </Button>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="p-4 bg-muted rounded-2xl border space-y-3">
                                                <div className="flex items-center gap-3 text-foreground">
                                                    <div className="p-2 bg-card rounded-xl shadow-sm"><User size={14} /></div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-black uppercase">{item.userName}</span>
                                                        <span className="text-[8px] font-bold opacity-60">{item.userEmail}</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 text-foreground">
                                                    <div className="p-2 bg-card rounded-xl shadow-sm"><Building2 size={14} /></div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-black uppercase">Tenant ID</span>
                                                        <span className="text-[8px] font-bold opacity-60 tracking-widest truncate max-w-[150px]">{item.tenantId}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="bg-muted p-4 rounded-2xl border relative group overflow-hidden">
                                                {item.image ? (
                                                    <div className="relative h-full min-h-[100px] cursor-pointer" onClick={() => setSelectedImage(item.image)}>
                                                        <img src={item.image} alt="Report attachment" className="absolute inset-0 w-full h-full object-cover rounded-xl" />
                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                                                            <ImageIcon className="text-white" size={24} />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center h-full min-h-[100px] opacity-20">
                                                        <ImageIcon size={32} />
                                                        <span className="text-[8px] font-bold uppercase mt-2">Sin Captura</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="pt-4 border-t flex items-center justify-between">
                                            <p className="text-[11px] font-medium text-muted-foreground whitespace-pre-wrap flex-1">{item.description}</p>
                                        </div>

                                        <div className="flex items-center gap-2 p-2 bg-muted rounded-xl border overflow-hidden">
                                            <ExternalLink size={12} className="text-muted-foreground shrink-0" />
                                            <span className="text-[8px] font-mono text-muted-foreground truncate">{item.url}</span>
                                        </div>
                                    </div>
                                </Card>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>

            {/* Simple Lightbox */}
            <AnimatePresence>
                {selectedImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-10"
                        onClick={() => setSelectedImage(null)}
                    >
                        <button className="absolute top-10 right-10 text-white hover:text-pagnol-orange transition-colors">
                            <X size={32} />
                        </button>
                        <motion.img
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            src={selectedImage}
                            alt="Visual Evidence"
                            className="max-w-full max-h-full object-contain rounded-3xl"
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </PageShell>
    );
}
