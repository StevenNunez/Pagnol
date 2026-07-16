"use client";

import React, { useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { CreateSupplierForm } from "@/components/admin/create-supplier-form";
import { EditSupplierForm } from "@/components/admin/edit-supplier-form";
import { useToast } from "@/modules/core/hooks/use-toast";
import { compressImage } from "@/lib/compress-image";
import { cn } from "@/lib/utils";
import type {
    Supplier, SupplierContact, SupplierDocument, SupplierEvaluation, PurchaseOrder, SupplierPayment,
} from "@/modules/core/lib/data";
import {
    Building2, Plus, Search, Pencil, Trash2, Star, Phone, Mail, MapPin, FileText,
    Upload, Download, Users, ClipboardCheck, History, Loader2, Receipt, ShoppingCart, CreditCard,
} from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fmtDate = (iso?: string | Date) =>
    iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const newId = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const DOC_TYPES = ["Tributario", "Bancario", "Contrato", "Certificado", "Seguro", "Otro"];
const EVAL_DIMS: { key: keyof Pick<SupplierEvaluation, "quality" | "delivery" | "price" | "service">; label: string }[] = [
    { key: "quality", label: "Calidad" },
    { key: "delivery", label: "Plazos" },
    { key: "price", label: "Precio" },
    { key: "service", label: "Servicio" },
];

// ── Micro-label industrial (firma Pagnol) ──────────────────────────────────
function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

// ── Estrellas (display + input) ────────────────────────────────────────────
function Stars({ value, onChange, size = 16 }: { value: number; onChange?: (v: number) => void; size?: number }) {
    return (
        <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    disabled={!onChange}
                    onClick={() => onChange?.(n)}
                    className={cn(onChange ? "cursor-pointer" : "cursor-default")}
                >
                    <Star
                        style={{ width: size, height: size }}
                        className={cn(n <= Math.round(value) ? "fill-warning text-warning" : "text-muted-foreground/30")}
                    />
                </button>
            ))}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
export default function SuppliersPage() {
    const { suppliers, can } = useAppState();
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);

    const sorted = useMemo(
        () => [...(suppliers || [])].sort((a, b) => a.name.localeCompare(b.name)),
        [suppliers],
    );

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return sorted;
        return sorted.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                (s.rut || "").toLowerCase().includes(q) ||
                (s.categories || []).some((c) => c.toLowerCase().includes(q)),
        );
    }, [sorted, search]);

    const selected = useMemo(
        () => sorted.find((s) => s.id === selectedId) ?? null,
        [sorted, selectedId],
    );

    return (
        <PageShell
            title="Proveedores 360°"
            description="Ficha integral: datos comerciales, contactos, documentos, evaluación e historial de compras."
        >
            <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-6 items-start">
                {/* ── Lista (master) ─────────────────────────────────────── */}
                <Card className="rounded-[1.5rem] lg:sticky lg:top-4">
                    <CardContent className="p-4 space-y-4">
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Buscar proveedor…"
                                    className="pl-9 rounded-xl"
                                />
                            </div>
                            {can("suppliers:create") && (
                                <Button size="icon" className="rounded-xl shrink-0" onClick={() => setCreateOpen(true)} title="Nuevo proveedor">
                                    <Plus className="h-4 w-4" />
                                </Button>
                            )}
                        </div>

                        <div className="space-y-1 max-h-[70vh] overflow-auto no-scrollbar">
                            {filtered.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">Sin proveedores.</p>
                            ) : (
                                filtered.map((s) => (
                                    <button
                                        key={s.id}
                                        onClick={() => setSelectedId(s.id)}
                                        className={cn(
                                            "w-full text-left flex items-center gap-3 rounded-xl border p-3 transition-colors",
                                            selectedId === s.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted",
                                        )}
                                    >
                                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground shrink-0">
                                            <Building2 className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-semibold text-sm truncate">{s.name}</p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {s.categories?.length ? s.categories.join(", ") : "Sin categorías"}
                                            </p>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* ── Detalle ────────────────────────────────────────────── */}
                {selected ? (
                    <SupplierDetail key={selected.id} supplier={selected} />
                ) : (
                    <EmptyState
                        icon={<Building2 size={24} />}
                        title="Selecciona un proveedor"
                        description="Elige un proveedor de la lista para ver su ficha completa, o crea uno nuevo."
                    />
                )}
            </div>

            {/* Crear proveedor */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Nuevo Proveedor</DialogTitle>
                        <DialogDescription>Añade un proveedor al sistema.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[70vh] overflow-y-auto px-1">
                        <CreateSupplierForm />
                    </div>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
function SupplierDetail({ supplier }: { supplier: Supplier }) {
    const { deleteSupplier, can } = useAppState();
    const { toast } = useToast();
    const [editOpen, setEditOpen] = useState(false);

    const handleDelete = async () => {
        try {
            await deleteSupplier(supplier.id);
            toast({ title: "Proveedor eliminado", description: `${supplier.name} fue eliminado.` });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error al eliminar", description: e?.message || "No se pudo eliminar." });
        }
    };

    const evals = supplier.evaluations || [];
    const overall = evals.length
        ? evals.reduce((acc, ev) => acc + (ev.quality + ev.delivery + ev.price + ev.service) / 4, 0) / evals.length
        : 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <Card className="rounded-[1.5rem]">
                <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">
                        <Building2 className="h-7 w-7" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-foreground truncate">{supplier.name}</h2>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                            {supplier.rut && <span className="text-sm text-muted-foreground">{supplier.rut}</span>}
                            {evals.length > 0 && (
                                <span className="flex items-center gap-1">
                                    <Stars value={overall} size={14} />
                                    <span className="text-xs text-muted-foreground">{overall.toFixed(1)} · {evals.length} eval.</span>
                                </span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                            {(supplier.categories || []).map((c) => (
                                <Badge key={c} variant="outline" className="rounded-xl text-xs">{c}</Badge>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {can("suppliers:edit") && (
                            <Button variant="outline" className="rounded-xl" onClick={() => setEditOpen(true)}>
                                <Pencil className="h-4 w-4 mr-2" /> Editar
                            </Button>
                        )}
                        {can("suppliers:delete") && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="rounded-xl text-destructive">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>¿Eliminar a {supplier.name}?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Esta acción no se puede deshacer. Si el proveedor está asignado a materiales u órdenes, la acción fallará.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleDelete}>
                                            Sí, eliminar
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs defaultValue="general">
                <TabsList className="rounded-xl">
                    <TabsTrigger value="general" className="rounded-lg gap-1.5"><Receipt className="h-3.5 w-3.5" /> General</TabsTrigger>
                    <TabsTrigger value="contacts" className="rounded-lg gap-1.5"><Users className="h-3.5 w-3.5" /> Contactos</TabsTrigger>
                    <TabsTrigger value="documents" className="rounded-lg gap-1.5"><FileText className="h-3.5 w-3.5" /> Documentos</TabsTrigger>
                    <TabsTrigger value="evaluation" className="rounded-lg gap-1.5"><ClipboardCheck className="h-3.5 w-3.5" /> Evaluación</TabsTrigger>
                    <TabsTrigger value="history" className="rounded-lg gap-1.5"><History className="h-3.5 w-3.5" /> Historial</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="mt-6"><GeneralTab supplier={supplier} /></TabsContent>
                <TabsContent value="contacts" className="mt-6"><ContactsTab supplier={supplier} /></TabsContent>
                <TabsContent value="documents" className="mt-6"><DocumentsTab supplier={supplier} /></TabsContent>
                <TabsContent value="evaluation" className="mt-6"><EvaluationTab supplier={supplier} /></TabsContent>
                <TabsContent value="history" className="mt-6"><HistoryTab supplier={supplier} /></TabsContent>
            </Tabs>

            {editOpen && (
                <EditSupplierForm supplier={supplier} isOpen={editOpen} onClose={() => setEditOpen(false)} />
            )}
        </div>
    );
}

// ── Tab: General ────────────────────────────────────────────────────────────
function Field({ label, value, icon }: { label: string; value?: React.ReactNode; icon?: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <MicroLabel>{label}</MicroLabel>
            <p className="text-sm text-foreground flex items-center gap-2">
                {icon}
                {value || <span className="text-muted-foreground">—</span>}
            </p>
        </div>
    );
}

function GeneralTab({ supplier }: { supplier: Supplier }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="rounded-[1.5rem]">
                <CardContent className="p-6 space-y-4">
                    <MicroLabel>Datos comerciales</MicroLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="RUT" value={supplier.rut} />
                        <Field label="Email" value={supplier.email} icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />} />
                        <Field label="Teléfono" value={supplier.phone} icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />} />
                        <Field label="Dirección" value={supplier.address} icon={<MapPin className="h-3.5 w-3.5 text-muted-foreground" />} />
                    </div>
                </CardContent>
            </Card>
            <Card className="rounded-[1.5rem]">
                <CardContent className="p-6 space-y-4">
                    <MicroLabel>Datos bancarios</MicroLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Banco" value={supplier.bank} />
                        <Field label="Tipo de cuenta" value={supplier.accountType} />
                        <Field label="Nº de cuenta" value={supplier.accountNumber} />
                    </div>
                </CardContent>
            </Card>
            {supplier.notes && (
                <Card className="rounded-[1.5rem] md:col-span-2">
                    <CardContent className="p-6 space-y-2">
                        <MicroLabel>Notas internas</MicroLabel>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{supplier.notes}</p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

// ── Tab: Contactos ───────────────────────────────────────────────────────────
function ContactsTab({ supplier }: { supplier: Supplier }) {
    const { updateSupplier, can } = useAppState();
    const { toast } = useToast();
    const contacts = supplier.contacts || [];
    const editable = can("suppliers:edit");

    const [open, setOpen] = useState(false);
    const [form, setForm] = useState<SupplierContact>({ id: "", name: "", role: "", email: "", phone: "" });
    const [saving, setSaving] = useState(false);

    const openNew = () => { setForm({ id: "", name: "", role: "", email: "", phone: "" }); setOpen(true); };
    const openEdit = (c: SupplierContact) => { setForm({ ...c }); setOpen(true); };

    const persist = async (next: SupplierContact[]) => {
        await updateSupplier(supplier.id, { contacts: next });
    };

    const save = async () => {
        if (!form.name.trim()) {
            toast({ variant: "destructive", title: "Falta el nombre", description: "El contacto necesita un nombre." });
            return;
        }
        setSaving(true);
        try {
            let next: SupplierContact[];
            if (form.id) {
                next = contacts.map((c) => (c.id === form.id ? form : c));
            } else {
                next = [...contacts, { ...form, id: newId() }];
            }
            // Un solo principal
            if (form.isPrimary) next = next.map((c) => ({ ...c, isPrimary: c.id === (form.id || next[next.length - 1].id) }));
            await persist(next);
            setOpen(false);
            toast({ title: "Contacto guardado" });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e?.message || "No se pudo guardar." });
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id: string) => {
        try { await persist(contacts.filter((c) => c.id !== id)); toast({ title: "Contacto eliminado" }); }
        catch (e: any) { toast({ variant: "destructive", title: "Error", description: e?.message }); }
    };

    return (
        <div className="space-y-4">
            {editable && (
                <div className="flex justify-end">
                    <Button onClick={openNew} className="rounded-xl"><Plus className="h-4 w-4 mr-2" /> Añadir contacto</Button>
                </div>
            )}
            {contacts.length === 0 ? (
                <EmptyState icon={<Users size={24} />} title="Sin contactos" description="Registra las personas de contacto de este proveedor." />
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {contacts.map((c) => (
                        <Card key={c.id} className="rounded-[1.5rem]">
                            <CardContent className="p-5 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-semibold text-foreground">{c.name}</p>
                                            {c.isPrimary && <Badge className="badge-info rounded-xl text-[10px]">Principal</Badge>}
                                        </div>
                                        {c.role && <p className="text-xs text-muted-foreground">{c.role}</p>}
                                    </div>
                                    {editable && (
                                        <div className="flex gap-1">
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(c.id)}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-1 text-sm">
                                    {c.email && <p className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3.5 w-3.5" /> {c.email}</p>}
                                    {c.phone && <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> {c.phone}</p>}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{form.id ? "Editar contacto" : "Nuevo contacto"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Nombre</Label>
                            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Cargo / rol</Label>
                            <Input value={form.role || ""} placeholder="Ej: Ejecutivo de ventas" onChange={(e) => setForm({ ...form, role: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Teléfono</Label>
                                <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                            </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={!!form.isPrimary}
                                onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
                                className="h-4 w-4 rounded border-border accent-primary"
                            />
                            Marcar como contacto principal
                        </label>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                        <Button onClick={save} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ── Tab: Documentos ──────────────────────────────────────────────────────────
function docExpiryBadge(doc: SupplierDocument) {
    if (!doc.expiresAt) return null;
    const days = Math.ceil((new Date(doc.expiresAt).getTime() - Date.now()) / 86400000);
    if (days < 0) return <Badge className="badge-destructive rounded-xl text-[10px]">Vencido</Badge>;
    if (days <= 30) return <Badge className="badge-warning rounded-xl text-[10px]">Vence en {days}d</Badge>;
    return <Badge className="badge-success rounded-xl text-[10px]">Vigente</Badge>;
}

function DocumentsTab({ supplier }: { supplier: Supplier }) {
    const { updateSupplier, uploadSupplierDocument, deleteSupplierDocumentFile, can } = useAppState();
    const { toast } = useToast();
    const documents = supplier.documents || [];
    const editable = can("suppliers:edit");

    const [open, setOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState("");
    const [type, setType] = useState<string>(DOC_TYPES[0]);
    const [expiresAt, setExpiresAt] = useState("");
    const [uploading, setUploading] = useState(false);

    const reset = () => { setFile(null); setName(""); setType(DOC_TYPES[0]); setExpiresAt(""); };

    const upload = async () => {
        if (!file) { toast({ variant: "destructive", title: "Selecciona un archivo" }); return; }
        setUploading(true);
        try {
            const toUpload = file.type.startsWith("image/") ? await compressImage(file) : file;
            const doc = await uploadSupplierDocument(supplier.id, toUpload, {
                name: name.trim() || file.name,
                type,
                expiresAt: expiresAt || undefined,
            });
            await updateSupplier(supplier.id, { documents: [...documents, doc] });
            setOpen(false); reset();
            toast({ title: "Documento subido" });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error al subir", description: e?.message || "No se pudo subir." });
        } finally {
            setUploading(false);
        }
    };

    const remove = async (doc: SupplierDocument) => {
        try {
            await deleteSupplierDocumentFile(doc.path);
            await updateSupplier(supplier.id, { documents: documents.filter((d) => d.id !== doc.id) });
            toast({ title: "Documento eliminado" });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e?.message });
        }
    };

    return (
        <div className="space-y-4">
            {editable && (
                <div className="flex justify-end">
                    <Button onClick={() => setOpen(true)} className="rounded-xl"><Upload className="h-4 w-4 mr-2" /> Subir documento</Button>
                </div>
            )}
            {documents.length === 0 ? (
                <EmptyState icon={<FileText size={24} />} title="Sin documentos" description="Sube respaldos: ficha tributaria, datos bancarios, contratos, certificados, seguros." />
            ) : (
                <Card className="rounded-[1.5rem]">
                    <CardContent className="p-2">
                        {documents.map((doc) => (
                            <div key={doc.id} className="flex items-center gap-3 rounded-xl p-3 hover:bg-muted transition-colors">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground shrink-0">
                                    <FileText className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm truncate">{doc.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {doc.type || "Otro"} · {fmtDate(doc.uploadedAt)}
                                        {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ""}
                                    </p>
                                </div>
                                {docExpiryBadge(doc)}
                                <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                    <Button variant="ghost" size="icon" className="h-8 w-8"><Download className="h-4 w-4" /></Button>
                                </a>
                                {editable && (
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(doc)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Subir documento</DialogTitle>
                        <DialogDescription>PDF, imagen, Word o Excel (máx. 20 MB).</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Archivo</Label>
                            <Input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                                onChange={(e) => {
                                    const f = e.target.files?.[0] || null;
                                    setFile(f);
                                    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Nombre</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Certificado de cumplimiento 2026" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Tipo</Label>
                                <Select value={type} onValueChange={setType}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Vence (opcional)</Label>
                                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancelar</Button>
                        <Button onClick={upload} disabled={uploading || !file}>
                            {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Subir
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ── Tab: Evaluación ──────────────────────────────────────────────────────────
function EvaluationTab({ supplier }: { supplier: Supplier }) {
    const { updateSupplier, can } = useAppState();
    const { user } = useAuth();
    const { toast } = useToast();
    const evals = useMemo(
        () => [...(supplier.evaluations || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [supplier.evaluations],
    );
    const editable = can("suppliers:edit");

    const [open, setOpen] = useState(false);
    const [scores, setScores] = useState({ quality: 0, delivery: 0, price: 0, service: 0 });
    const [comment, setComment] = useState("");
    const [saving, setSaving] = useState(false);

    const averages = useMemo(() => {
        const base = { quality: 0, delivery: 0, price: 0, service: 0 };
        if (!evals.length) return { ...base, overall: 0 };
        for (const ev of evals) {
            base.quality += ev.quality; base.delivery += ev.delivery; base.price += ev.price; base.service += ev.service;
        }
        const n = evals.length;
        const r = { quality: base.quality / n, delivery: base.delivery / n, price: base.price / n, service: base.service / n };
        return { ...r, overall: (r.quality + r.delivery + r.price + r.service) / 4 };
    }, [evals]);

    const save = async () => {
        if (Object.values(scores).some((v) => v < 1)) {
            toast({ variant: "destructive", title: "Faltan puntajes", description: "Califica las 4 dimensiones (1 a 5)." });
            return;
        }
        setSaving(true);
        try {
            const ev: SupplierEvaluation = {
                id: newId(),
                date: new Date().toISOString(),
                userId: user?.id,
                userName: user?.name,
                ...scores,
                comment: comment.trim() || undefined,
            };
            await updateSupplier(supplier.id, { evaluations: [...(supplier.evaluations || []), ev] });
            setOpen(false); setScores({ quality: 0, delivery: 0, price: 0, service: 0 }); setComment("");
            toast({ title: "Evaluación registrada" });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error", description: e?.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* KPIs de promedio */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <Card className="rounded-[1.5rem] sm:col-span-1 col-span-2">
                    <CardContent className="p-5 flex flex-col gap-2">
                        <MicroLabel>Promedio global</MicroLabel>
                        <p className="text-3xl font-black text-foreground">{averages.overall.toFixed(1)}</p>
                        <Stars value={averages.overall} size={14} />
                        <p className="text-xs text-muted-foreground">{evals.length} evaluación(es)</p>
                    </CardContent>
                </Card>
                {EVAL_DIMS.map((d) => (
                    <Card key={d.key} className="rounded-[1.5rem]">
                        <CardContent className="p-5 flex flex-col gap-2">
                            <MicroLabel>{d.label}</MicroLabel>
                            <p className="text-2xl font-black text-foreground">{(averages as any)[d.key].toFixed(1)}</p>
                            <Stars value={(averages as any)[d.key]} size={12} />
                        </CardContent>
                    </Card>
                ))}
            </div>

            {editable && (
                <div className="flex justify-end">
                    <Button onClick={() => setOpen(true)} className="rounded-xl"><ClipboardCheck className="h-4 w-4 mr-2" /> Nueva evaluación</Button>
                </div>
            )}

            {/* Historial de evaluaciones */}
            {evals.length === 0 ? (
                <EmptyState icon={<ClipboardCheck size={24} />} title="Sin evaluaciones" description="Registra una evaluación para empezar a medir el desempeño del proveedor." />
            ) : (
                <div className="space-y-3">
                    {evals.map((ev) => (
                        <Card key={ev.id} className="rounded-[1.5rem]">
                            <CardContent className="p-5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-foreground">{ev.userName || "Usuario"}</p>
                                    <p className="text-xs text-muted-foreground">{fmtDate(ev.date)}</p>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {EVAL_DIMS.map((d) => (
                                        <div key={d.key} className="flex items-center justify-between gap-2">
                                            <span className="text-xs text-muted-foreground">{d.label}</span>
                                            <Stars value={ev[d.key]} size={12} />
                                        </div>
                                    ))}
                                </div>
                                {ev.comment && <p className="text-sm text-foreground/90 border-l-2 border-border pl-3">{ev.comment}</p>}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Nueva evaluación</DialogTitle>
                        <DialogDescription>Califica de 1 a 5 estrellas cada dimensión.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {EVAL_DIMS.map((d) => (
                            <div key={d.key} className="flex items-center justify-between">
                                <Label>{d.label}</Label>
                                <Stars value={(scores as any)[d.key]} size={22} onChange={(v) => setScores((s) => ({ ...s, [d.key]: v }))} />
                            </div>
                        ))}
                        <div className="space-y-2">
                            <Label>Comentario (opcional)</Label>
                            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Observaciones sobre el desempeño…" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                        <Button onClick={save} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Guardar evaluación
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ── Tab: Historial (derivado) ────────────────────────────────────────────────
const PO_STATUS_LABEL: Record<string, string> = {
    generated: "Generada", sent: "Enviada", completed: "Completada", cancelled: "Cancelada", issued: "Emitida",
};
const PAY_STATUS: Record<string, string> = { pending: "Pendiente", paid: "Pagada", overdue: "Vencida" };
const PAY_BADGE: Record<string, string> = { pending: "badge-warning", paid: "badge-success", overdue: "badge-destructive" };

function HistoryTab({ supplier }: { supplier: Supplier }) {
    const { purchaseOrders, supplierPayments } = useAppState();

    const orders = useMemo(
        () => (purchaseOrders || [])
            .filter((o) => o.supplierId === supplier.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        [purchaseOrders, supplier.id],
    );
    const payments = useMemo(
        () => (supplierPayments || [])
            .filter((p) => p.supplierId === supplier.id)
            .sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()),
        [supplierPayments, supplier.id],
    );

    const totalOrders = orders.filter((o) => o.status !== 'cancelled').reduce((acc, o) => acc + (o.totalAmount || 0), 0);
    const pendingPay = payments.filter((p) => p.status !== "paid").reduce((acc, p) => acc + (p.amount || 0), 0);

    const orderCols: DataTableColumn<PurchaseOrder>[] = [
        { key: "oc", header: "OC", cell: (o) => <span className="font-medium">{o.officialOCId || o.id.slice(0, 8)}</span> },
        { key: "date", header: "Fecha", cell: (o) => fmtDate(o.createdAt) },
        { key: "items", header: "Ítems", cell: (o) => (o.items?.length ?? 0) },
        { key: "status", header: "Estado", cell: (o) => <Badge variant="outline" className="rounded-xl text-xs">{PO_STATUS_LABEL[o.status] || o.status}</Badge> },
        { key: "amount", header: "Monto", cell: (o) => <span className="font-semibold">{o.totalAmount ? CLP.format(o.totalAmount) : "—"}</span>, className: "text-right", headerClassName: "text-right" },
    ];

    const payCols: DataTableColumn<SupplierPayment>[] = [
        { key: "inv", header: "Factura", cell: (p) => <span className="font-medium">{p.invoiceNumber || "—"}</span> },
        { key: "issue", header: "Emisión", cell: (p) => fmtDate(p.issueDate) },
        { key: "due", header: "Vence", cell: (p) => fmtDate(p.dueDate) },
        { key: "status", header: "Estado", cell: (p) => <Badge className={cn("rounded-xl text-xs", PAY_BADGE[p.status])}>{PAY_STATUS[p.status] || p.status}</Badge> },
        { key: "amount", header: "Monto", cell: (p) => <span className="font-semibold">{CLP.format(p.amount || 0)}</span>, className: "text-right", headerClassName: "text-right" },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card className="rounded-[1.5rem]"><CardContent className="p-5"><MicroLabel>Órdenes</MicroLabel><p className="text-2xl font-black mt-1">{orders.length}</p></CardContent></Card>
                <Card className="rounded-[1.5rem]"><CardContent className="p-5"><MicroLabel>Total comprado</MicroLabel><p className="text-2xl font-black mt-1">{CLP.format(totalOrders)}</p></CardContent></Card>
                <Card className="rounded-[1.5rem]"><CardContent className="p-5"><MicroLabel>Facturas</MicroLabel><p className="text-2xl font-black mt-1">{payments.length}</p></CardContent></Card>
                <Card className="rounded-[1.5rem]"><CardContent className="p-5"><MicroLabel>Por pagar</MicroLabel><p className="text-2xl font-black mt-1">{CLP.format(pendingPay)}</p></CardContent></Card>
            </div>

            <div className="space-y-3">
                <div className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-primary" /><MicroLabel>Órdenes de compra</MicroLabel></div>
                <DataTable
                    columns={orderCols}
                    data={orders}
                    rowKey={(o) => o.id}
                    empty={{ icon: <ShoppingCart size={24} />, title: "Sin órdenes", description: "Este proveedor no tiene órdenes de compra registradas." }}
                />
            </div>

            <div className="space-y-3">
                <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" /><MicroLabel>Facturas y pagos</MicroLabel></div>
                <DataTable
                    columns={payCols}
                    data={payments}
                    rowKey={(p) => p.id}
                    empty={{ icon: <Receipt size={24} />, title: "Sin facturas", description: "Este proveedor no tiene facturas registradas." }}
                />
            </div>
        </div>
    );
}
