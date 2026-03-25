'use client';

/**
 * Account page — /account
 *
 * Displays storage quota statistics and lets the user update their email
 * and password. Requires authentication.
 *
 * Note: the backend does not yet expose a PATCH /auth/me endpoint, so the
 * "Save changes" form is wired to show a coming-soon toast for now.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { getMe, listFiles } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function AccountPage() {
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login');
  }, [router]);

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe });
  const { data: files = [] } = useQuery({
    queryKey: ['files'],
    queryFn: listFiles,
  });

  const usedPct = me
    ? Math.min((me.usedStorage / me.storageLimit) * 100, 100)
    : 0;

  const activeCount = files.filter((f) => f.status === 'READY' && (!f.expiresAt || new Date(f.expiresAt) > new Date())).length;
  const expiredCount = files.filter(
    (f) => f.expiresAt && new Date(f.expiresAt) <= new Date()
  ).length;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <>
      <Navbar active="account" />
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Account</h1>

        {/* Profile */}
        {me && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex items-center gap-5">
            <div className="w-14 h-14 bg-indigo-700 rounded-full flex items-center justify-center text-xl font-bold uppercase flex-shrink-0">
              {me.email.charAt(0)}
            </div>
            <div>
              <p className="font-semibold">{me.email.split('@')[0]}</p>
              <p className="text-sm text-gray-400">{me.email}</p>
            </div>
          </div>
        )}

        {/* Quota */}
        {me && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-gray-300">Storage Quota</h2>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-300">Used</span>
                <span className="text-white font-medium">
                  {formatSize(me.usedStorage)}{' '}
                  <span className="text-gray-500 font-normal">
                    / {formatSize(me.storageLimit)}
                  </span>
                </span>
              </div>
              <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-3 bg-indigo-500 rounded-full transition-all"
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {formatSize(me.storageLimit - me.usedStorage)} remaining ·{' '}
                {files.length} file{files.length !== 1 ? 's' : ''} stored
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-1">
              <div className="bg-gray-800 rounded-xl p-3 text-center">
                <p className="text-lg font-bold">{files.length}</p>
                <p className="text-xs text-gray-500">Total files</p>
              </div>
              <div className="bg-gray-800 rounded-xl p-3 text-center">
                <p className="text-lg font-bold">{activeCount}</p>
                <p className="text-xs text-gray-500">Active links</p>
              </div>
              <div className="bg-gray-800 rounded-xl p-3 text-center">
                <p className="text-lg font-bold">{expiredCount}</p>
                <p className="text-xs text-gray-500">Expired</p>
              </div>
            </div>
          </div>
        )}

        {/* Settings */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-5">
          <h2 className="text-sm font-semibold text-gray-300">Account Settings</h2>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1.5">
                Email address
              </label>
              <input
                type="email"
                defaultValue={me?.email}
                key={me?.email}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1.5">
                New password
              </label>
              <input
                type="password"
                placeholder="Leave blank to keep current"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="self-start px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition text-white"
              >
                Save changes
              </button>
              {saved && (
                <span className="text-xs text-green-400">
                  Profile update coming soon!
                </span>
              )}
            </div>
          </form>
        </div>

        {/* Danger zone */}
        <div className="bg-gray-900 border border-red-900 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-red-400 mb-3">Danger Zone</h2>
          <p className="text-xs text-gray-500 mb-4">
            Deleting your account will permanently remove all your files and links.
          </p>
          <button className="px-4 py-2 border border-red-700 text-red-400 hover:bg-red-950 rounded-xl text-sm transition">
            Delete account
          </button>
        </div>
      </main>
    </>
  );
}
