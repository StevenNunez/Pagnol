'use client';

import * as React from 'react';
import { getBlob } from '@/modules/offline/blob-store';
import type { WorkReportPhoto } from '@/modules/core/lib/data';

/**
 * <img> que muestra una foto resolviendo su origen:
 *  - si ya tiene `url` (subida) → la usa;
 *  - si es local (`localBlobId`, aún sin subir) → genera un object URL desde el
 *    Blob guardado en IndexedDB y lo libera al desmontar.
 */
export function OfflinePhotoImg({
  photo,
  className,
  alt,
}: {
  photo: WorkReportPhoto;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = React.useState<string>(photo.url || '');

  React.useEffect(() => {
    if (photo.url) {
      setSrc(photo.url);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    if (photo.localBlobId) {
      void getBlob(photo.localBlobId).then((rec) => {
        if (rec && !cancelled) {
          objectUrl = URL.createObjectURL(rec.blob);
          setSrc(objectUrl);
        }
      });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.url, photo.localBlobId]);

  return <img src={src} alt={alt || photo.description || 'Foto'} className={className} />;
}
