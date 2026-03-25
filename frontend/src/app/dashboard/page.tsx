'use client';

/**
 * Dashboard — /dashboard
 *
 * Lists the authenticated user's files with metadata, quota bar, and
 * edit / delete actions. Requires authentication; redirects to /login otherwise.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { listFiles, deleteFile, patchFile, getMe, FileRecord } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';

/** Human-readable byte size. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Returns a human-friendly expiry label or null for permanent files. */
function expiryLabel(record: FileRecord): string | null {
  if (!record.expiresAt) return null;
  const diff = new Date(record.expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `Expires in ${Math.floor(h / 24)}d`;
  if (h > 0) return `Expires in ${h}h ${m}m`;
  return `Expires in ${m}m`;
}

/** Inline edit modal for changing expiry / password. */
function EditModal({
  file,
  onClose,
}: {
  file: FileRecord;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [expiresAt, setExpiresAt] = useState(
    file.expiresAt ? file.expiresAt.slice(0, 16) : ''
  );
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);

  const { mutate, isPending, isError } = useMutation({
    mutationFn: () =>
      patchFile(file.id, {
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : { expiresAt: null }),
        ...(removePassword
          ? { password: null }
          : password
          ? { password }
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Edit link</h2>
        <p className="text-xs text-gray-500 truncate">{file.fileName}</p>

        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1.5">
            Expiry (leave blank for permanent)
          </label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {file.isPasswordProtected ? (
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={removePassword}
              onChange={(e) => setRemovePassword(e.target.checked)}
              className="accent-indigo-500"
            />
            Remove password protection
          </label>
        ) : (
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1.5">
              Set password (optional)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password…"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
            />
          </div>
        )}

        {isError && (
          <p className="text-xs text-red-400">Failed to save changes.</p>
        )}

        <div className="flex gap-3 mt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-700 rounded-xl text-sm text-gray-400 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            onClick={() => mutate()}
            disabled={isPending}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-medium text-white transition"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<FileRecord | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login');
  }, [router]);

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe });
  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files'],
    queryFn: listFiles,
  });

  const { mutate: remove } = useMutation({
    mutationFn: deleteFile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });

  const usedPct = me
    ? Math.min((me.usedStorage / me.storageLimit) * 100, 100)
    : 0;

  return (
    <>
      {editTarget && (
        <EditModal file={editTarget} onClose={() => setEditTarget(null)} />
      )}
      <Navbar active="dashboard" />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">My Links</h1>
          <Link
            href="/upload"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition text-white"
          >
            <span className="text-lg leading-none">+</span> Create Link
          </Link>
        </div>

        {/* Quota bar */}
        {me && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Storage used</span>
              <span>
                {formatSize(me.usedStorage)} / {formatSize(me.storageLimit)}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-2 bg-indigo-500 rounded-full transition-all"
                style={{ width: `${usedPct}%` }}
              />
            </div>
          </div>
        )}

        {/* File list */}
        {isLoading && (
          <p className="text-sm text-gray-500 text-center py-10">Loading…</p>
        )}
        {!isLoading && files.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <p className="text-sm">No links yet.</p>
            <Link href="/upload" className="text-indigo-400 text-sm mt-1 inline-block">
              Create your first link →
            </Link>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {files.map((file) => {
            const expiry = expiryLabel(file);
            const expired = expiry === 'Expired';
            return (
              <div
                key={file.id}
                className={`bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4 ${expired ? 'opacity-50' : ''}`}
              >
                <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center text-lg flex-shrink-0">
                  {file.isPasswordProtected ? '🔒' : '📄'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.fileName}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatSize(file.size)} ·{' '}
                    {expiry ? (
                      <span className={expired ? 'text-red-400' : expiry.includes('Expires') ? 'text-yellow-400' : ''}>
                        {expiry}
                      </span>
                    ) : (
                      'Permanent'
                    )}{' '}
                    {file.isPasswordProtected && '· Password protected'}
                  </p>
                </div>
                <div className="text-xs text-gray-500 hidden md:block shrink-0">
                  /f/{file.slug}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    disabled={expired}
                    onClick={() => setEditTarget(file)}
                    className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${file.fileName}"?`)) remove(file.id);
                    }}
                    className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-red-900 border border-gray-700 hover:border-red-700 rounded-lg transition text-gray-300 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
