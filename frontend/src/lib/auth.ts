/**
 * Thin wrappers around localStorage for JWT management.
 *
 * All helpers guard against SSR environments where `window` is undefined.
 */

const KEY = 'accessToken';

/** Persist the JWT returned by login / register. */
export function setToken(token: string): void {
  if (typeof window !== 'undefined') localStorage.setItem(KEY, token);
}

/** Read the stored JWT, or null if absent. */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}

/** Remove the stored JWT (logout). */
export function clearToken(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(KEY);
}

/** Returns true when a token is present. Does not validate expiry. */
export function isAuthenticated(): boolean {
  return getToken() !== null;
}
