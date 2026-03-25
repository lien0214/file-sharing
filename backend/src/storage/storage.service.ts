import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

/**
 * Wraps all MinIO/S3 operations.
 * Uses two endpoints:
 *  - internalClient: for server-to-MinIO calls (service name in Docker).
 *  - publicEndpoint: for generating presigned URLs the browser can reach.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly internalClient: S3Client;
  private readonly bucket: string;
  private readonly publicEndpoint: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = config.getOrThrow<string>('MINIO_ENDPOINT');
    this.publicEndpoint = config.getOrThrow<string>('MINIO_PUBLIC_ENDPOINT');
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');

    this.internalClient = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.getOrThrow<string>('MINIO_ROOT_USER'),
        secretAccessKey: config.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
      },
      forcePathStyle: true,
    });
  }

  /** Initiates a multipart upload and returns the uploadId. */
  async createMultipartUpload(s3Key: string, mimeType: string): Promise<string> {
    const res = await this.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: s3Key,
        ContentType: mimeType,
      }),
    );
    return res.UploadId!;
  }

  /**
   * Returns a presigned PUT URL for a single multipart part.
   * URL hostname is rewritten to publicEndpoint so browsers can reach MinIO.
   */
  async presignPart(
    s3Key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    const { UploadPartCommand } = await import('@aws-sdk/client-s3');

    // Build a public-facing client so the presigned URL uses the external host.
    const publicClient = new S3Client({
      endpoint: this.publicEndpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('MINIO_ROOT_USER'),
        secretAccessKey: this.config.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
      },
      forcePathStyle: true,
    });

    return getSignedUrl(
      publicClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: s3Key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: 3600 },
    );
  }

  /** Completes the multipart upload and returns the ETag of the assembled object. */
  async completeMultipartUpload(
    s3Key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<string | undefined> {
    const res = await this.internalClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: s3Key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    return res.ETag;
  }

  /** Aborts an in-progress multipart upload, freeing any stored parts. */
  async abortMultipartUpload(s3Key: string, uploadId: string): Promise<void> {
    await this.internalClient.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: s3Key,
        UploadId: uploadId,
      }),
    );
  }

  /**
   * Retrieves object metadata. Returns the ChecksumSHA256 header if MinIO
   * stored it (requires the client to have sent x-amz-checksum-sha256 during upload).
   */
  async headObject(s3Key: string): Promise<{ checksumSha256?: string }> {
    const res = await this.internalClient.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );
    return { checksumSha256: res.ChecksumSHA256 };
  }

  /** Permanently removes an object from the bucket. */
  async deleteObject(s3Key: string): Promise<void> {
    await this.internalClient.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );
  }

  /**
   * Generates a short-lived presigned GET URL for downloading an object.
   * URL uses the public endpoint so browsers can reach MinIO.
   */
  async presignDownload(s3Key: string, expiresIn = 60): Promise<string> {
    const publicClient = new S3Client({
      endpoint: this.publicEndpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('MINIO_ROOT_USER'),
        secretAccessKey: this.config.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
      },
      forcePathStyle: true,
    });

    return getSignedUrl(
      publicClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
      { expiresIn },
    );
  }
}
