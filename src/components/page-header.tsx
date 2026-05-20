'use client';

import { useEffect } from "react";
import { useAuth } from "@/modules/core/contexts/app-provider";

interface PageHeaderProps {
  title: string;
  description?: string;
  className?: string; // Keep className prop to avoid breaking existing calls
}

export function PageHeader({ title, description }: PageHeaderProps) {
  const { setPageHeader } = useAuth();

  useEffect(() => {
    // Set the header details in the parent layout
    if (title || description) {
      setPageHeader(prev => {
        if (prev.title === title && prev.description === description) return prev;
        return { title, description: description || '' };
      });
    }
    
    // Cleanup function to reset header when component unmounts
    return () => {
      setPageHeader({ title: '', description: '' });
    };
  }, [title, description, setPageHeader]);

  // This component renders nothing itself
  return null;
}
