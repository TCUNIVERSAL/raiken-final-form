import React, { useCallback, useEffect, useRef, useState } from 'react';

type SignatureMode = 'draw' | 'upload';

interface SignaturePadProps {
  id: string;
  value: string;           // data:image/png;base64,… or ''
  error?: string;
  onChange: (dataUrl: string) => void;
}

/**
 * Signature pad with two modes:
 *  • Draw  — freehand canvas signature
 *  • Upload — upload a signature image (PNG, JPG, etc.)
 */
export const SignaturePad: React.FC<SignaturePadProps> = ({ id, value, error, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<SignatureMode>('draw');
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(Boolean(value));
  const [uploadedPreview, setUploadedPreview] = useState<string>('');
  const [uploadFileName, setUploadFileName] = useState('');
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  // ─── Coordinate helpers ────────────────────────────────────────────────
  const getPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement> | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const dpr = window.devicePixelRatio || 1;
    const logicalW = canvas.width / dpr;
    const logicalH = canvas.height / dpr;
    return {
      x: (e.clientX - rect.left) * (logicalW / rect.width),
      y: (e.clientY - rect.top) * (logicalH / rect.height)
    };
  }, []);

  // ─── Resize canvas to fill its container ───────────────────────────────
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGuide(ctx, w, h);
    // Restore existing signature image if there is one and we're in draw mode
    if (value && mode === 'draw' && hasStrokes) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, w, h);
      };
      img.src = value;
    }
  }, [value, mode, hasStrokes]);

  useEffect(() => {
    if (mode === 'draw') {
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
      return () => window.removeEventListener('resize', resizeCanvas);
    }
  }, [resizeCanvas, mode]);

  // ─── Signature guide line and × mark ───────────────────────────────────
  function drawGuide(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    const lineY = h * 0.78;
    const padX = 24;
    ctx.strokeStyle = '#b7b6c4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, lineY);
    ctx.lineTo(w - padX, lineY);
    ctx.stroke();

    const xCenter = padX + 8;
    const xSize = 6;
    ctx.strokeStyle = '#8c8b9c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xCenter - xSize, lineY - xSize);
    ctx.lineTo(xCenter + xSize, lineY + xSize);
    ctx.moveTo(xCenter + xSize, lineY - xSize);
    ctx.lineTo(xCenter - xSize, lineY + xSize);
    ctx.stroke();
  }

  // ─── Draw strokes (Pointer Events for mouse, pen, stylus & touch) ─────
  const startDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // safe fallback if pointer capture fails
    }

    setDrawing(true);
    const pt = getPoint(e);
    lastPoint.current = pt;

    // Immediately draw a point for single taps / dots (e.g. dotting an "i")
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#1c1b29';
      ctx.fillStyle = '#1c1b29';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1, 0, Math.PI * 2);
      ctx.fill();
      setHasStrokes(true);
    }
  }, [getPoint, mode]);

  const moveDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !lastPoint.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);

    ctx.strokeStyle = '#1c1b29';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();

    lastPoint.current = pt;
    setHasStrokes(true);
  }, [drawing, getPoint]);

  const endDraw = useCallback((e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    setDrawing(false);
    lastPoint.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      if (e?.pointerId && canvas.hasPointerCapture?.(e.pointerId)) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      onChange(canvas.toDataURL('image/png'));
    }
  }, [drawing, onChange]);

  useEffect(() => {
    const handleUp = () => { if (drawing) endDraw(); };
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [drawing, endDraw]);

  // ─── Upload mode ──────────────────────────────────────────────────────
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, etc.).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('The image is too large. Please use a file under 5 MB.');
      return;
    }
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setUploadedPreview(dataUrl);
      onChange(dataUrl);
    };
    reader.readAsDataURL(file);
  }, [onChange]);

  // ─── Clear ─────────────────────────────────────────────────────────────
  const clear = useCallback(() => {
    if (mode === 'draw') {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawGuide(ctx, container.clientWidth, container.clientHeight);
    }
    setHasStrokes(false);
    setUploadedPreview('');
    setUploadFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    onChange('');
  }, [onChange, mode]);

  // ─── Mode switch ──────────────────────────────────────────────────────
  const switchMode = useCallback((newMode: SignatureMode) => {
    clear();
    setMode(newMode);
  }, [clear]);

  const hasValue = mode === 'upload' ? Boolean(uploadedPreview) : hasStrokes;

  return (
    <div
      className={`rk-field rk-signature-field${error ? ' rk-invalid' : ''}`}
      id={id}
      role="group"
      tabIndex={0}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
      aria-invalid={Boolean(error)}
    >
      <p id={`${id}-label`} className="rk-question">
        Signature<span className="rk-req" aria-hidden="true">*</span><span className="sr-only"> (required)</span>
      </p>
      <p id={`${id}-hint`} className="rk-hint rk-question-hint">Draw with your mouse or finger, or upload an image of your signature.</p>

      {/* Mode switcher tabs */}
      <div className="rk-signature-tabs" role="group" aria-label="Signature method">
        <button
          type="button"
          aria-pressed={mode === 'draw'}
          className={`rk-signature-tab${mode === 'draw' ? ' rk-signature-tab-active' : ''}`}
          onClick={() => switchMode('draw')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
          Draw
        </button>
        <button
          type="button"
          aria-pressed={mode === 'upload'}
          className={`rk-signature-tab${mode === 'upload' ? ' rk-signature-tab-active' : ''}`}
          onClick={() => switchMode('upload')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload
        </button>
      </div>

      {mode === 'draw' ? (
        /* ─── Draw mode: canvas ──────────────────────────────────── */
        <div id={`${id}-draw`} className="rk-signature-pad" ref={containerRef}>
          <canvas
            ref={canvasRef}
            className="rk-signature-canvas"
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
            role="img"
            aria-label="Signature drawing area. Use your mouse or finger to sign."
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          />
          {!hasStrokes && (
            <div className="rk-signature-placeholder" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#8c8b9c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </div>
          )}
        </div>
      ) : (
        /* ─── Upload mode: file picker + preview ─────────────────── */
        <div id={`${id}-upload`} className="rk-signature-upload-area">
          {uploadedPreview ? (
            <div className="rk-signature-upload-preview">
              <img src={uploadedPreview} alt="Uploaded signature" className="rk-signature-upload-img" />
              <p className="rk-hint">{uploadFileName}</p>
            </div>
          ) : (
            <div className="rk-signature-upload-dropzone">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8c8b9c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <button
                type="button"
                className="rk-btn rk-btn-secondary rk-upload-button"
                aria-describedby={`${id}-upload-rules${error ? ` ${id}-error` : ''}`}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose signature image
              </button>
              <span id={`${id}-upload-rules`} className="rk-hint">PNG, JPG, GIF or WebP · up to 5 MB</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            id={`${id}-file`}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="rk-signature-upload-input"
            aria-label="Upload signature image"
            tabIndex={-1}
            onChange={handleFileSelect}
          />
        </div>
      )}

      {hasValue && (
        <button type="button" className="rk-signature-clear" onClick={clear} aria-label="Clear signature">
          Clear signature
        </button>
      )}
      {error && <p id={`${id}-error`} className="rk-error" role="alert">{error}</p>}
    </div>
  );
};
