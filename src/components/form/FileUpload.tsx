import React, { useRef, useState } from 'react';
import { DocumentKind, UploadedDocument } from '../../types/index.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png'
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns the MIME type to upload with, or an error message if the file is not allowed. */
function checkFile(file: File): { mimeType?: string; error?: string } {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mimeType = ALLOWED_TYPES[ext];
  if (!mimeType || (file.type && !Object.values(ALLOWED_TYPES).includes(file.type))) {
    return { error: `"${file.name}" is not a PDF, JPG or PNG file. Please choose a different file.` };
  }
  if (file.size === 0) return { error: `"${file.name}" is empty. Please choose a different file.` };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `"${file.name}" is ${formatFileSize(file.size)}. The largest file allowed is 5 MB.` };
  }
  return { mimeType };
}

const UploadIcon = () => (
  <svg className="rk-upload-icon" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false">
    <path d="M11 6h13l7 7v19a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
    <path d="M20 29V17m0 0l-5 5m5-5l5 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface FileUploadProps {
  id: string;
  label: string;
  hint?: string;
  kind: DocumentKind;
  partyId?: string;
  maxFiles?: number;
  /** Must be a functional update so uploads that finish after the page changes still land in the right place. */
  onAdd: (doc: UploadedDocument) => void;
  onRemove: (docId: string) => void;
  value: UploadedDocument[];
  onUploadingChange?: (uploading: boolean) => void;
}

interface Pending {
  key: string;
  fileName: string;
  progress: number;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  id, label, hint, kind, partyId, maxFiles = 4, value, onAdd, onRemove, onUploadingChange
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const slotsLeft = maxFiles - value.length - pending.length;

  const upload = (file: File, mimeType: string) => {
    const key = `${Date.now()}_${Math.random()}`;
    setPending(p => [...p, { key, fileName: file.name, progress: 0 }]);
    onUploadingChange?.(true);

    const finish = (message?: string) => {
      onUploadingChange?.(false);
      setPending(p => p.filter(x => x.key !== key));
      if (message) setErrors(e => [...e, message]);
    };

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?kind=${encodeURIComponent(kind)}`);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        setPending(p => p.map(x => (x.key === key ? { ...x, progress } : x)));
      }
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // handled below
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.success) {
        onAdd({ ...body.document, partyId });
        finish();
      } else {
        finish(`"${file.name}": ${body?.message || 'the upload failed. Please try again.'}`);
      }
    };
    xhr.onerror = () => finish(`"${file.name}": the upload failed. Please check your internet connection and try again.`);
    xhr.send(file);
  };

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const nextErrors: string[] = [];
    if (files.length > slotsLeft) {
      nextErrors.push(slotsLeft <= 0
        ? `You can upload up to ${maxFiles} files here. Remove one first to add another.`
        : `You can add ${slotsLeft} more file${slotsLeft === 1 ? '' : 's'} here. Only the first ${slotsLeft} will be uploaded.`);
    }
    files.slice(0, Math.max(0, slotsLeft)).forEach(file => {
      const { mimeType, error } = checkFile(file);
      if (error || !mimeType) nextErrors.push(error || 'This file cannot be used.');
      else upload(file, mimeType);
    });
    setErrors(nextErrors);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="rk-field">
      <p className="rk-question" id={`${id}-label`}>
        {label}<span className="rk-opt"> (optional)</span>
      </p>
      {hint && <p className="rk-hint rk-question-hint">{hint}</p>}

      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        className="rk-file-input"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        aria-labelledby={`${id}-label`}
        tabIndex={-1}
        onChange={e => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {slotsLeft > 0 && (
        <div
          className={`rk-dropzone${dragOver ? ' rk-dropzone-active' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <UploadIcon />
          <p>
            <button type="button" className="rk-btn rk-btn-secondary rk-upload-button" onClick={openPicker} aria-describedby={`${id}-label ${id}-rules`}>
              Choose files
            </button>
          </p>
          <p className="rk-upload-alternative">You can also drag and drop files here.</p>
          <p id={`${id}-rules`} className="rk-hint">PDF, JPG or PNG · up to 5 MB each · up to {maxFiles} files</p>
        </div>
      )}

      {(pending.length > 0 || value.length > 0) && (
        <ul className="rk-file-list" aria-live="polite">
          {pending.map(p => (
            <li key={p.key} className="rk-file">
              <div className="rk-file-main">
                <span className="rk-file-name">{p.fileName}</span>
                <span className="rk-file-status">Uploading… {p.progress}%</span>
                <span className="rk-progress" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${p.fileName}`}>
                  <span className="rk-progress-fill" style={{ width: `${p.progress}%` }} />
                </span>
              </div>
            </li>
          ))}
          {value.map(doc => (
            <li key={doc.id} className="rk-file rk-file-done">
              <div className="rk-file-main">
                <span className="rk-file-name">{doc.fileName}</span>
                <span className="rk-file-status rk-file-ok">Uploaded · {formatFileSize(doc.sizeBytes)}</span>
              </div>
              <button type="button" className="rk-link-button rk-danger" onClick={() => onRemove(doc.id)} aria-label={`Remove ${doc.fileName}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {errors.map((message, i) => (
        <p key={i} className="rk-error" role="alert">{message}</p>
      ))}
    </div>
  );
};
