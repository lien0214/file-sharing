/**
 * Axios API client.
 *
 * Reads the JWT from localStorage and injects it as an Authorization header
 * on every request. All API calls in the app go through this module.
 */

import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
});

api.interceptors.request.use((config) => {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auth ─────────────────────────────────────────────────────────────────────

/** Register a new account and return an access token. */
export async function register(email: string, password: string) {
  const { data } = await api.post<{ accessToken: string }>('/auth/register', {
    email,
    password,
  });
  return data;
}

/** Log in and return an access token. */
export async function login(email: string, password: string) {
  const { data } = await api.post<{ accessToken: string }>('/auth/login', {
    email,
    password,
  });
  return data;
}

export interface UserProfile {
  id: string;
  email: string;
  storageLimit: number;
  usedStorage: number;
}

/** Fetch the authenticated user's profile and quota. */
export async function getMe(): Promise<UserProfile> {
  const { data } = await api.get<UserProfile>('/auth/me');
  return data;
}

// ── Files ─────────────────────────────────────────────────────────────────────

export interface FileRecord {
  id: string;
  slug: string;
  fileName: string;
  size: number;
  status: 'PENDING' | 'READY' | 'DELETED';
  expiresAt: string | null;
  isPasswordProtected: boolean;
  createdAt: string;
}

export interface PublicFileMeta {
  slug: string;
  fileName: string;
  size: number;
  mimeType: string;
  isPasswordProtected: boolean;
  expiresAt: string | null;
  createdAt: string;
}

/** List all files owned by the authenticated user. */
export async function listFiles(): Promise<FileRecord[]> {
  const { data } = await api.get<FileRecord[]>('/files');
  return data;
}

/** Fetch public metadata for a file by slug. */
export async function getFileMeta(slug: string): Promise<PublicFileMeta> {
  const { data } = await api.get<PublicFileMeta>(`/files/${slug}`);
  return data;
}

/** Verify the password for a protected file; returns a short-lived access token. */
export async function accessFile(
  slug: string,
  password: string
): Promise<{ accessToken: string }> {
  const { data } = await api.post<{ accessToken: string }>(
    `/files/${slug}/access`,
    { password }
  );
  return data;
}

/** Update a file's password or expiry. Owner only. */
export async function patchFile(
  id: string,
  payload: { password?: string | null; expiresAt?: string | null }
): Promise<FileRecord> {
  const { data } = await api.patch<FileRecord>(`/files/${id}`, payload);
  return data;
}

/** Permanently delete a file. Owner only. */
export async function deleteFile(id: string): Promise<void> {
  await api.delete(`/files/${id}`);
}

// ── Upload pipeline ───────────────────────────────────────────────────────────

export interface InitUploadResponse {
  fileId: string;
  slug: string;
  totalParts: number;
  presignedUrl: string;
  partNumber: number;
}

/** Initialise a multipart upload session. */
export async function initUpload(payload: {
  fileName: string;
  size: number;
  mimeType: string;
  checksum: string;
  expiresAt?: string;
  password?: string;
}): Promise<InitUploadResponse> {
  const { data } = await api.post<InitUploadResponse>(
    '/files/upload/init',
    payload
  );
  return data;
}

/** Fetch the presigned PUT URL for a given chunk. */
export async function getPresignedUrl(
  fileId: string,
  partNumber: number
): Promise<{ presignedUrl: string }> {
  const { data } = await api.get<{ presignedUrl: string }>(
    `/files/upload/${fileId}/presign/${partNumber}`
  );
  return data;
}

/** Finalise a multipart upload with the collected ETags. */
export async function completeUpload(
  fileId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<{ slug: string; url: string }> {
  const { data } = await api.post<{ slug: string; url: string }>(
    `/files/upload/${fileId}/complete`,
    { parts }
  );
  return data;
}
