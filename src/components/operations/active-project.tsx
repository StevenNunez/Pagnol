'use client';

import React from 'react';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useAppIsLoading } from '@/modules/data/DataProvider';
import type { WorkProject } from '@/modules/core/lib/data';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HardHat } from 'lucide-react';

/**
 * Obra activa del módulo Control de Obras (RFC-006 F1).
 *
 * Antes, cada pantalla mostraba TODAS las obras del inquilino a la vez: el panel
 * promediaba obras distintas en un solo "Avance General" y el Gantt dibujaba las
 * programaciones encimadas. Todo el módulo trabaja ahora sobre una obra a la vez.
 *
 * La elección se guarda en `localStorage` (mismo patrón que el selector de
 * empresa del super-admin) para que cambiar de página no la pierda.
 */

const STORAGE_KEY = 'pagnol.activeWorkProjectId';

type ActiveProjectValue = {
    projectId: string | null;
    project: WorkProject | null;
    projects: WorkProject[];
    setProjectId: (id: string | null) => void;
    /** true mientras el estado global aún no trae las obras (ADR-014). */
    isLoading: boolean;
};

const ActiveProjectContext = React.createContext<ActiveProjectValue | null>(null);

export function ActiveProjectProvider({ children }: { children: React.ReactNode }) {
    const { workProjects } = useAppState();
    const appIsLoading = useAppIsLoading();
    const [stored, setStored] = React.useState<string | null>(null);

    // Leer localStorage en un efecto y no en el render inicial: en SSR no existe,
    // y leerlo durante el render daría un HTML distinto al del cliente.
    React.useEffect(() => {
        try {
            setStored(window.localStorage.getItem(STORAGE_KEY));
        } catch {
            /* modo incógnito o almacenamiento bloqueado: se sigue sin persistencia */
        }
    }, []);

    const setProjectId = React.useCallback((id: string | null) => {
        setStored(id);
        try {
            if (id) window.localStorage.setItem(STORAGE_KEY, id);
            else window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* idem */
        }
    }, []);

    const projects = React.useMemo(() => {
        return [...(workProjects || [])].sort((a, b) => a.name.localeCompare(b.name));
    }, [workProjects]);

    // La obra vigente se DERIVA en el render, no se copia a un estado con un
    // efecto: si la guardada ya no existe (borrada, o cambio de empresa) se cae
    // a la primera disponible sin un parpadeo intermedio.
    const project = React.useMemo(() => {
        if (projects.length === 0) return null;
        return projects.find(p => p.id === stored) ?? projects[0];
    }, [projects, stored]);

    const value = React.useMemo<ActiveProjectValue>(() => ({
        projectId: project?.id ?? null,
        project,
        projects,
        setProjectId,
        // ADR-014: "aún no llegan las obras" y "no hay obras" se ven idénticos
        // —una lista vacía— y afirmar lo segundo mientras carga es mentir.
        isLoading: appIsLoading,
    }), [project, projects, setProjectId, appIsLoading]);

    return <ActiveProjectContext.Provider value={value}>{children}</ActiveProjectContext.Provider>;
}

export function useActiveProject(): ActiveProjectValue {
    const ctx = React.useContext(ActiveProjectContext);
    if (!ctx) {
        throw new Error('useActiveProject debe usarse dentro de <ActiveProjectProvider> (layout de construction-control).');
    }
    return ctx;
}

/** Filtra una lista de partidas a la obra activa. */
export function useProjectWorkItems<T extends { workProjectId?: string | null }>(items: T[] | undefined): T[] {
    const { projectId } = useActiveProject();
    return React.useMemo(() => {
        if (!items) return [];
        if (!projectId) return [];
        return items.filter(i => i.workProjectId === projectId);
    }, [items, projectId]);
}

/** Selector de obra para la barra de herramientas de cada página del módulo. */
export function ProjectSwitcher({ className }: { className?: string }) {
    const { projectId, projects, setProjectId } = useActiveProject();

    // Con una sola obra el selector no aporta nada: se muestra su nombre.
    if (projects.length <= 1) {
        return (
            <div className={`flex items-center gap-2 text-sm font-bold ${className ?? ''}`}>
                <HardHat className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{projects[0]?.name ?? 'Sin obras'}</span>
            </div>
        );
    }

    return (
        <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className={`w-full sm:w-[280px] rounded-xl ${className ?? ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                    <HardHat className="h-4 w-4 text-primary shrink-0" />
                    <SelectValue placeholder="Elige una obra" />
                </div>
            </SelectTrigger>
            <SelectContent>
                {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                        {p.code ? `${p.code} · ${p.name}` : p.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
