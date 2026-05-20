"use client";

import React from 'react';
import { useAuth } from '@/modules/auth/useAuth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { QrCode } from 'lucide-react';
import QRCode from "react-qr-code";
import { ROLES } from '@/modules/core/lib/permissions';
import { UserRole } from '@/modules/core/lib/data';

export function UserCredentialCard() {
  const { user } = useAuth();

  const getRoleDisplayName = (role: UserRole) => {
    return ROLES[role]?.label || role;
  }

  if (!user || !user.qrCode) return null;

  return (
    <Card className="bg-gradient-to-br from-primary/20 to-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><QrCode /> Mi Credencial Digital</CardTitle>
        <CardDescription>Usa este QR para registrar tu asistencia o el retiro y devolución de herramientas.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center text-center p-6 pt-0">
        <div className="p-2 bg-white rounded-lg">
          <QRCode value={user.qrCode} size={150} />
        </div>
        <p className="mt-4 font-bold text-lg">{user.name}</p>
        <p className="text-muted-foreground">{getRoleDisplayName(user.role)}</p>
      </CardContent>
    </Card>
  );
}
