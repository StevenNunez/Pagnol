
"use client";

import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Button } from './ui/button';
import { XCircle } from 'lucide-react';

interface SignaturePadProps {
  penColor?: string;
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
  onEnd?: (signature: string) => void;
}

const SignaturePad = forwardRef<any, SignaturePadProps>(
  ({ penColor = 'black', canvasProps = {}, onEnd }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const isDrawing = useRef(false);
    const lastPos = useRef<{ x: number; y: number } | null>(null);

    const getCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas not found');
      return canvas;
    };
    
    const getContext = () => {
      const ctx = getCanvas().getContext('2d');
      if (!ctx) throw new Error('2D context not found');
      return ctx;
    };

    const getMousePos = (e: MouseEvent | TouchEvent) => {
      const rect = getCanvas().getBoundingClientRect();
      const event = 'touches' in e ? e.touches[0] : e;
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const startDrawing = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      isDrawing.current = true;
      lastPos.current = getMousePos(e);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!isDrawing.current || !lastPos.current) return;
      const ctx = getContext();
      const currentPos = getMousePos(e);
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.stroke();
      lastPos.current = currentPos;
    };

    const stopDrawing = () => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      lastPos.current = null;
      if (onEnd) {
        const dataUrl = getTrimmedCanvas().toDataURL("image/png");
        onEnd(dataUrl);
      }
    };

    const clear = () => {
      const canvas = getCanvas();
      const ctx = getContext();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (onEnd) {
        onEnd("");
      }
    };
    
    const getTrimmedCanvas = (): HTMLCanvasElement => {
      const canvas = getCanvas();
      const ctx = getContext();
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const copyCtx = copy.getContext('2d')!;
      copyCtx.drawImage(canvas, 0, 0);

      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const l = pixels.data.length;
      let i;
      let bound = { top: canvas.height, left: canvas.width, right: 0, bottom: 0 };
      
      for (i = 0; i < l; i += 4) {
        if (pixels.data[i + 3] !== 0) {
          const x = (i / 4) % canvas.width;
          const y = Math.floor(i / 4 / canvas.width);

          if (y < bound.top) bound.top = y;
          if (y > bound.bottom) bound.bottom = y;
          if (x < bound.left) bound.left = x;
          if (x > bound.right) bound.right = x;
        }
      }

      const trimHeight = bound.bottom - bound.top + 1;
      const trimWidth = bound.right - bound.left + 1;
      const trimmed = ctx.getImageData(bound.left, bound.top, trimWidth, trimHeight);

      copy.width = trimWidth;
      copy.height = trimHeight;
      copyCtx.putImageData(trimmed, 0, 0);
      return copy;
    }


    useImperativeHandle(ref, () => ({
      clear,
      getTrimmedCanvas,
    }));

    useEffect(() => {
      const canvas = getCanvas();
      const ctx = getContext();
      
      // Set canvas size based on its container to make it responsive
      const resizeCanvas = () => {
        const parent = canvas.parentElement;
        if (parent) {
          canvas.width = parent.clientWidth;
          canvas.height = parent.clientHeight;
          ctx.strokeStyle = penColor;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        }
      };

      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      // Mouse events
      canvas.addEventListener('mousedown', startDrawing);
      canvas.addEventListener('mousemove', draw);
      canvas.addEventListener('mouseup', stopDrawing);
      canvas.addEventListener('mouseout', stopDrawing);

      // Touch events
      canvas.addEventListener('touchstart', startDrawing);
      canvas.addEventListener('touchmove', draw);
      canvas.addEventListener('touchend', stopDrawing);
      canvas.addEventListener('touchcancel', stopDrawing);

      return () => {
        window.removeEventListener('resize', resizeCanvas);
        canvas.removeEventListener('mousedown', startDrawing);
        canvas.removeEventListener('mousemove', draw);
        canvas.removeEventListener('mouseup', stopDrawing);
        canvas.removeEventListener('mouseout', stopDrawing);
        canvas.removeEventListener('touchstart', startDrawing);
        canvas.removeEventListener('touchmove', draw);
        canvas.removeEventListener('touchend', stopDrawing);
        canvas.removeEventListener('touchcancel', stopDrawing);
      };
    }, [penColor]);

    return (
        <canvas 
            ref={canvasRef} 
            {...canvasProps} 
            className={`touch-none ${canvasProps.className || ''}`}
        />
    );
  }
);

SignaturePad.displayName = 'SignaturePad';

export default SignaturePad;
