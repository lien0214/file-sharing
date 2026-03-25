'use client';

/**
 * Upload page — /upload
 *
 * Guides the user through a 4-step flow:
 * 1. Select file (drag-and-drop or browse).
 * 2. Configure link settings (storage type, TTL, optional password).
 * 3. Upload (chunked, with progress bar and SHA-256 pre-computation).
 * 4. Share — display the generated link.
 *
 * Works for both anonymous guests and authenticated users.
 */

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { uploadFile } from '@/lib/upload';

type Step = 'select' | 'configure' | 'uploading' | 'done';

const TTL_OPTIONS = [
  { label: '1 hour', value: 1 },
  { label: '24 hours', value: 24 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
];

/** Returns a Date string `hours` from now in ISO format. */
function hoursFromNow(hours: number): string {
  const d = new Date();
  d.setTime(d.getTime() + hours * 3_600_000);
  return d.toISOString();
}

/** Human-readable size */
function formatSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const STEP_LABELS = ['Select file', 'Configure', 'Upload', 'Share'];

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  // Config
  const [permanent, setPermanent] = useState(true);
  const [ttlHours, setTtlHours] = useState(24);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');

  // Upload state
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [resultSlug, setResultSlug] = useState('');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setStep('configure'); }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setStep('configure'); }
  }, []);

  async function startUpload() {
    if (!file) return;
    setStep('uploading');
    setError('');
    setProgress(0);
    try {
      const result = await uploadFile({
        file,
        expiresAt: permanent ? undefined : hoursFromNow(ttlHours),
        password: passwordEnabled && password ? password : undefined,
        onProgress: setProgress,
      });
      setResultSlug(result.slug);
      setStep('done');
    } catch {
      setError('Upload failed. Please try again.');
      setStep('configure');
    }
  }

  const stepIndex = ['select', 'configure', 'uploading', 'done'].indexOf(step);
  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/f/${resultSlug}`;

  return (
    <>
      {/* Minimal navbar */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-gray-800 bg-gray-950">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-500 rounded-lg" />
          <span className="font-semibold text-lg tracking-tight text-white">FileShare</span>
        </Link>
        <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition">
          ← Dashboard
        </Link>
      </nav>

      <main className="flex-1 max-w-xl mx-auto w-full px-6 py-10 flex flex-col gap-7">
        <h1 className="text-2xl font-bold">Upload &amp; Create Link</h1>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className={`px-2.5 py-1 rounded-full font-medium ${
                  i === stepIndex
                    ? 'bg-indigo-600 text-white'
                    : i < stepIndex
                    ? 'bg-gray-700 text-gray-300'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                {i + 1} {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <div className="flex-1 h-px bg-gray-800 w-4" />
              )}
            </div>
          ))}
        </div>

        {/* ── Step 1: Select ─────────────────────────────────────────────── */}
        {step === 'select' && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-4 transition cursor-pointer bg-gray-900/30 ${
              dragging ? 'border-indigo-500' : 'border-gray-700 hover:border-indigo-500'
            }`}
          >
            <div className="w-14 h-14 bg-gray-800 rounded-xl flex items-center justify-center text-3xl">
              📂
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-200">Drop your file here</p>
              <p className="text-xs text-gray-500 mt-1">
                or click to browse — any format, up to 1 GB
              </p>
            </div>
            <button
              type="button"
              className="px-5 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm font-medium hover:bg-gray-700 transition text-white"
            >
              Browse file
            </button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* ── Step 2: Configure ──────────────────────────────────────────── */}
        {step === 'configure' && file && (
          <>
            {/* Selected file summary */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-3">
              <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center text-lg">📄</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
              </div>
              <button
                onClick={() => { setFile(null); setStep('select'); }}
                className="text-xs text-gray-500 hover:text-white transition"
              >
                Change
              </button>
            </div>

            {/* Settings */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-5">
              <h2 className="text-sm font-semibold text-gray-300">Link settings</h2>

              {/* Storage type */}
              <div>
                <label className="text-xs font-medium text-gray-400 mb-2 block">Storage</label>
                <div className="flex gap-3">
                  <label
                    className={`flex-1 flex items-center gap-2 rounded-xl px-4 py-3 cursor-pointer text-sm ${
                      permanent
                        ? 'bg-indigo-950 border border-indigo-700 text-indigo-300'
                        : 'bg-gray-800 border border-gray-700 text-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="storage"
                      checked={permanent}
                      onChange={() => setPermanent(true)}
                      className="accent-indigo-500"
                    />
                    Permanent quota
                  </label>
                  <label
                    className={`flex-1 flex items-center gap-2 rounded-xl px-4 py-3 cursor-pointer text-sm ${
                      !permanent
                        ? 'bg-indigo-950 border border-indigo-700 text-indigo-300'
                        : 'bg-gray-800 border border-gray-700 text-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="storage"
                      checked={!permanent}
                      onChange={() => setPermanent(false)}
                      className="accent-indigo-500"
                    />
                    Temporary (TTL)
                  </label>
                </div>
              </div>

              {/* TTL selector */}
              <div className={permanent ? 'opacity-40 pointer-events-none' : ''}>
                <label className="text-xs font-medium text-gray-400 mb-2 block">Expiry</label>
                <select
                  value={ttlHours}
                  onChange={(e) => setTtlHours(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {TTL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Password toggle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-400">
                    Password protection
                  </label>
                  <button
                    type="button"
                    onClick={() => setPasswordEnabled((v) => !v)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${
                      passwordEnabled ? 'bg-indigo-600' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                        passwordEnabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                {passwordEnabled && (
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Set a password…"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                  />
                )}
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              onClick={startUpload}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold transition text-white"
            >
              Start Upload →
            </button>
          </>
        )}

        {/* ── Step 3: Uploading ──────────────────────────────────────────── */}
        {step === 'uploading' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 flex flex-col items-center gap-6">
            <div className="w-14 h-14 bg-gray-800 rounded-xl flex items-center justify-center text-3xl">
              ⬆️
            </div>
            <div className="w-full">
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span>
                  {progress < 0.1
                    ? 'Computing checksum…'
                    : 'Uploading…'}
                </span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-2 bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 text-center">
              Please keep this tab open while uploading.
            </p>
          </div>
        )}

        {/* ── Step 4: Done ───────────────────────────────────────────────── */}
        {step === 'done' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 flex flex-col items-center gap-6 text-center">
            <div className="w-14 h-14 bg-green-900 rounded-xl flex items-center justify-center text-3xl">
              ✅
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">Link created!</h2>
              <p className="text-sm text-gray-400">Share this link with anyone.</p>
            </div>
            <div className="w-full flex gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
              />
              <button
                onClick={() => navigator.clipboard.writeText(shareUrl)}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition text-white"
              >
                Copy
              </button>
            </div>
            <div className="flex gap-3 w-full">
              <Link
                href="/upload"
                onClick={() => {
                  setStep('select');
                  setFile(null);
                  setResultSlug('');
                  setProgress(0);
                }}
                className="flex-1 py-2 border border-gray-700 rounded-xl text-sm text-gray-400 hover:text-white transition text-center"
              >
                Upload another
              </Link>
              <Link
                href="/dashboard"
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm font-medium transition text-white text-center"
              >
                My Links
              </Link>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
