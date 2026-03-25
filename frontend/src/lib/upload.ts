/**
 * Chunked upload pipeline.
 *
 * Handles SHA-256 computation (streaming, 16 MB slices via @noble/hashes),
 * presigned-URL acquisition, per-chunk PUT requests, and multipart completion.
 *
 * Progress is reported via an optional `onProgress` callback that receives a
 * value in the range [0, 1].
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import axios from 'axios';
import {
  initUpload,
  getPresignedUrl,
  completeUpload,
  InitUploadResponse,
} from './api';

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB

export interface UploadOptions {
  file: File;
  expiresAt?: string;
  password?: string;
  onProgress?: (progress: number) => void;
}

export interface UploadResult {
  slug: string;
  url: string;
}

/**
 * Compute the SHA-256 hex digest of a File by reading it in 16 MB slices.
 * This avoids loading the entire file into memory at once.
 */
async function computeChecksum(
  file: File,
  onProgress?: (p: number) => void
): Promise<string> {
  const hash = sha256.create();
  let offset = 0;

  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    hash.update(new Uint8Array(buffer));
    offset += CHUNK_SIZE;
    onProgress?.(Math.min(offset / file.size, 1) * 0.1); // first 10% = hashing
  }

  return bytesToHex(hash.digest());
}

/**
 * Upload a single chunk to MinIO using its presigned PUT URL.
 * Returns the ETag from the response headers.
 */
async function uploadChunk(
  presignedUrl: string,
  chunk: Blob
): Promise<string> {
  const response = await axios.put(presignedUrl, chunk, {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  // MinIO returns the ETag in response headers
  const etag = response.headers['etag'] as string;
  return etag ?? '';
}

/**
 * Full upload flow:
 * 1. Hash the file (streaming SHA-256).
 * 2. Init multipart upload on the backend.
 * 3. Upload each chunk via presigned PUT URLs.
 * 4. Complete the upload and return the public slug/URL.
 */
export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  const { file, expiresAt, password, onProgress } = options;

  // Step 1 — compute checksum (first 10% of reported progress)
  const checksum = await computeChecksum(file, onProgress);

  // Step 2 — init upload
  const init: InitUploadResponse = await initUpload({
    fileName: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    checksum,
    ...(expiresAt ? { expiresAt } : {}),
    ...(password ? { password } : {}),
  });

  const { fileId, totalParts } = init;
  const parts: { partNumber: number; etag: string }[] = [];

  // Step 3 — upload chunks sequentially
  for (let i = 0; i < totalParts; i++) {
    const partNumber = i + 1;
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);

    // Part 1 presigned URL comes from the init response; subsequent parts need a separate request
    const presignedUrl =
      partNumber === 1
        ? init.presignedUrl
        : (await getPresignedUrl(fileId, partNumber)).presignedUrl;

    const etag = await uploadChunk(presignedUrl, chunk);
    parts.push({ partNumber, etag });

    // Progress: 10% (hashing) + 90% (upload), split evenly across parts
    onProgress?.(0.1 + (partNumber / totalParts) * 0.9);
  }

  // Step 4 — complete
  const result = await completeUpload(fileId, parts);
  onProgress?.(1);
  return result;
}
