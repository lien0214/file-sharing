'use client';

/**
 * Public file access page — /f/:slug
 *
 * Fetches public file metadata and, if the file is password-protected,
 * shows a password gate before triggering the download redirect.
 *
 * Handles `404` (not found) and `410` (expired) gracefully.
 */

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getFileMeta, accessFile } from '@/lib/api';

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function expiryLabel(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `Expires in ${Math.floor(h / 24)}d`;
  if (h > 0) return `Expires in ${h}h ${m}m`;
  return `Expires in ${m}m`;
}

export default function FilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data: file, error, isLoading } = useQuery({
    queryKey: ['file', slug],
    queryFn: () => getFileMeta(slug),
    retry: false,
  });

  /** Trigger a download — redirects through the backend presigned URL. */
  async function triggerDownload(accessToken?: string) {
    setDownloading(true);
    const url = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/files/${slug}/download${
      accessToken ? `?accessToken=${accessToken}` : ''
    }`;
    window.location.href = url;
    setTimeout(() => setDownloading(false), 2000);
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');
    setUnlocking(true);
    try {
      const { accessToken } = await accessFile(slug, password);
      await triggerDownload(accessToken);
    } catch {
      setPasswordError('Incorrect password. Please try again.');
    } finally {
      setUnlocking(false);
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    );
  }

  // Error states
  const statusCode = (error as { response?: { status: number } })?.response?.status;
  if (statusCode === 410 || statusCode === 404) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-950 gap-6">
        <div className="text-center">
          <p className="text-5xl mb-4">{statusCode === 410 ? '⏰' : '🔍'}</p>
          <h1 className="text-xl font-semibold mb-2">
            {statusCode === 410 ? 'This link has expired' : 'Link not found'}
          </h1>
          <p className="text-sm text-gray-400">
            {statusCode === 410
              ? 'The file owner set a time limit on this link.'
              : "This link doesn't exist or has been deleted."}
          </p>
        </div>
        <Link
          href="/"
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition text-white"
        >
          Back to home
        </Link>
      </div>
    );
  }

  if (!file) return null;

  const expiry = expiryLabel(file.expiresAt);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-950">
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="w-7 h-7 bg-indigo-500 rounded-lg" />
          <span className="font-semibold text-lg tracking-tight text-white">
            FileShare
          </span>
        </Link>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl flex flex-col gap-6">
          {/* File info */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gray-800 rounded-xl flex items-center justify-center text-3xl flex-shrink-0">
              📄
            </div>
            <div className="min-w-0">
              <p className="font-semibold truncate">{file.fileName}</p>
              <p className="text-sm text-gray-400 mt-0.5">
                {formatSize(file.size)} · {file.mimeType}
              </p>
              {expiry && (
                <p className="text-xs mt-1">
                  <span
                    className={
                      expiry === 'Expired' ? 'text-red-400' : 'text-yellow-400'
                    }
                  >
                    {expiry}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Password gate */}
          {file.isPasswordProtected ? (
            <div className="border-t border-gray-800 pt-5 flex flex-col gap-3">
              <p className="text-sm text-gray-300 flex items-center gap-2">
                <span>🔒</span> This file is password protected
              </p>
              <form onSubmit={handleUnlock} className="flex flex-col gap-3">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                />
                {passwordError && (
                  <p className="text-xs text-red-400">{passwordError}</p>
                )}
                <button
                  type="submit"
                  disabled={unlocking}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition text-white"
                >
                  {unlocking ? 'Verifying…' : 'Unlock & Download'}
                </button>
              </form>
            </div>
          ) : (
            <button
              onClick={() => triggerDownload()}
              disabled={downloading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition text-white"
            >
              {downloading ? 'Preparing download…' : 'Download file'}
            </button>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-5">
          Shared via{' '}
          <span className="text-gray-500">FileShare</span> ·{' '}
          <Link href="/" className="text-indigo-500 hover:text-indigo-400">
            Share your own files
          </Link>
        </p>
      </div>
    </div>
  );
}
