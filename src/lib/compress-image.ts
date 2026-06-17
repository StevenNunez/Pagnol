// Compresión/redimensionado de imágenes en el cliente (canvas) antes de subir.
// Reduce el peso en Storage y el tamaño del PDF (las fotos se embeben en él).
// Se ejecuta solo en el navegador.

export interface CompressOptions {
  maxDimension?: number; // lado mayor máximo en px
  quality?: number;      // 0..1 para JPEG
  mimeType?: string;     // tipo de salida
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  const maxDimension = opts.maxDimension ?? 1600;
  const quality = opts.quality ?? 0.72;
  const mimeType = opts.mimeType ?? 'image/jpeg';

  // Solo se comprimen imágenes raster; cualquier otra cosa pasa sin tocar.
  if (typeof window === 'undefined' || !file.type.startsWith('image/')) return file;

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });

    let { width, height } = img;
    if (!width || !height) return file;

    if (width > maxDimension || height > maxDimension) {
      if (width >= height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // Fondo blanco para evitar negro al pasar PNG con transparencia a JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
    if (!blob) return file;

    // Si comprimir no ayudó (ya venía optimizada), conserva el original.
    if (blob.size >= file.size) return file;

    const newName = file.name.replace(/\.(png|webp|heic|heif|bmp|tiff?|jpeg)$/i, '.jpg');
    return new File([blob], newName, { type: mimeType, lastModified: Date.now() });
  } catch {
    // Formatos que el navegador no puede decodificar (p. ej. algunos HEIC): se sube el original.
    return file;
  }
}
