"use client";

import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";

/** Logo Pagnol incrustado en el centro del código QR para activos */
export function QRWithPagnolLogo({
  value,
  size = 200,
  className = "",
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const logoSize = Math.round(size * 0.28);
  const [logoUrl, setLogoUrl] = useState("/logo1.png");

  useEffect(() => {
    setLogoUrl(`${window.location.origin}/logo1.png`);
  }, []);

  return (
    <div className={className} style={{ position: "relative" }}>
      <QRCodeSVG
        value={value}
        size={size}
        level="H"
        includeMargin={true}
        imageSettings={{
          src: logoUrl,
          height: logoSize,
          width: logoSize,
          excavate: true,
        }}
      />
    </div>
  );
}
