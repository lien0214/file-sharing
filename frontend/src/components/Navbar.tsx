'use client';

/**
 * Top navigation bar.
 *
 * Renders different link sets depending on whether the user is authenticated.
 * Authentication state is read from localStorage on mount.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearToken, isAuthenticated } from '@/lib/auth';

interface NavbarProps {
  /** Highlight one of the nav links as active. */
  active?: 'dashboard' | 'account';
}

export default function Navbar({ active }: NavbarProps) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(isAuthenticated());
  }, []);

  function handleLogout() {
    clearToken();
    router.push('/');
  }

  return (
    <nav className="flex items-center justify-between px-8 py-4 border-b border-gray-800 bg-gray-950">
      <Link href="/" className="flex items-center gap-2">
        <div className="w-7 h-7 bg-indigo-500 rounded-lg" />
        <span className="font-semibold text-lg tracking-tight text-white">
          FileShare
        </span>
      </Link>

      <div className="flex items-center gap-5">
        {authed ? (
          <>
            <Link
              href="/dashboard"
              className={`text-sm transition ${
                active === 'dashboard'
                  ? 'text-white font-medium border-b-2 border-indigo-500 pb-0.5'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              My Links
            </Link>
            <Link
              href="/account"
              className={`text-sm transition ${
                active === 'account'
                  ? 'text-white font-medium border-b-2 border-indigo-500 pb-0.5'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Account
            </Link>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-400 hover:text-red-400 transition"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="px-4 py-1.5 rounded-lg text-sm text-gray-300 hover:text-white transition"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="px-4 py-1.5 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 transition font-medium text-white"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
