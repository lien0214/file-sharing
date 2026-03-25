'use client';

/**
 * Landing page — dual-purpose entry point.
 *
 * Visitors can either:
 * 1. Paste a file share link / 12-char slug to jump straight to the file.
 * 2. Navigate to the upload flow to create a new link.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';

export default function LandingPage() {
  const router = useRouter();
  const [slug, setSlug] = useState('');

  function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    const code = slug.trim().split('/').pop() ?? '';
    if (code) router.push(`/f/${code}`);
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 flex flex-col items-center justify-center px-4 gap-12">
        {/* Hero */}
        <div className="text-center max-w-xl">
          <h1 className="text-5xl font-bold mb-4 leading-tight">
            Share files.<br />
            <span className="text-indigo-400">Instantly.</span>
          </h1>
          <p className="text-gray-400 text-lg">
            Upload any file up to 1 GB — share with a single link.
            No account required for guests.
          </p>
        </div>

        {/* Dual-action card */}
        <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl">
          {/* Enter a link */}
          <div>
            <label className="text-sm font-medium text-gray-400 mb-2 block">
              Access a shared file
            </label>
            <form onSubmit={handleOpen} className="flex gap-2">
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="Paste link or 12-char code…"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition text-white"
              >
                Open
              </button>
            </form>
          </div>

          <div className="flex items-center gap-3 text-gray-600 text-xs">
            <div className="flex-1 h-px bg-gray-800" />
            <span>or</span>
            <div className="flex-1 h-px bg-gray-800" />
          </div>

          {/* Create a link */}
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-3">Want to share a file?</p>
            <a
              href="/upload"
              className="inline-block w-full py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm font-medium transition text-white"
            >
              Upload &amp; Create Link →
            </a>
          </div>
        </div>

        {/* Feature chips */}
        <div className="flex gap-3 flex-wrap justify-center text-xs text-gray-500">
          {[
            'Up to 1 GB',
            'Password protection',
            'TTL expiry',
            'SHA-256 verified',
            'Any file type',
          ].map((label) => (
            <span
              key={label}
              className="px-3 py-1 bg-gray-900 border border-gray-800 rounded-full"
            >
              {label}
            </span>
          ))}
        </div>
      </main>

      <footer className="text-center text-gray-700 text-xs py-4">
        © 2026 FileShare
      </footer>
    </>
  );
}
