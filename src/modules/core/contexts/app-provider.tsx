
"use client";

import { AuthProvider } from "@/modules/auth/AuthProvider";
import { useAuth } from "@/modules/auth/useAuth";
import { DataProvider } from "@/modules/data/DataProvider";
import { useAppState } from "@/modules/data/useData";

// Este componente ya no se usa, pero se mantiene por si acaso
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        {children}
      </DataProvider>
    </AuthProvider>
  );
}

// Re-export hooks for easy consumption
export { useAuth, useAppState };
