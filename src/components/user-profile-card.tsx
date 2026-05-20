"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { User } from 'lucide-react';

export function UserProfileCard() {
  return (
    <Link href="/dashboard/profile" className="group">
      <Card className="h-full transition-all duration-300 ease-in-out hover:border-primary hover:shadow-lg hover:-translate-y-1">
        <CardHeader className="flex flex-row items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <User className="h-8 w-8 transition-transform group-hover:scale-110" />
          </div>
          <div>
            <CardTitle>Mi Perfil</CardTitle>
            <CardDescription className="mt-1">
              Consulta tu información personal, de contacto y de planilla.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
