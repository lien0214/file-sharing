import {
  Injectable,
  NotFoundException,
  GoneException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { FileStatus, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, CompletedPart } from '../storage/storage.service';
import { InitUploadDto } from './dto/init-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { UpdateFileDto } from './dto/update-file.dto';

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
const SLUG_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generateSlug = customAlphabet(SLUG_ALPHABET, 12);

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jwt: JwtService,
  ) {}

  // ---------------------------------------------------------------------------
  // Upload pipeline
  // ---------------------------------------------------------------------------

  /**
   * Initiates a multipart upload.
   * For authenticated users: enforces storage quota before creating any records.
   * Returns the File record, session, and presigned URL for part 1.
   */
  async initUpload(dto: InitUploadDto, user: User | null) {
    if (!user && !dto.expiresAt) {
      this.logger.warn(`Anonymous upload rejected — missing expiresAt for "${dto.fileName}"`);
      throw new BadRequestException(
        'Anonymous uploads must have an expiry (expiresAt is required)',
      );
    }

    if (user) {
      const wouldExceed =
        BigInt(user.usedStorage) + BigInt(dto.size) > BigInt(user.storageLimit);
      if (wouldExceed) {
        this.logger.warn(`Quota exceeded for user ${user.id} — tried to upload ${dto.size} bytes`);
        throw new ForbiddenException('Storage quota exceeded');
      }
    }

    // Retry on slug collision (negligible probability but handle anyway).
    let slug: string;
    for (;;) {
      slug = generateSlug();
      const existing = await this.prisma.file.findUnique({ where: { slug } });
      if (!existing) break;
    }

    const s3Key = `uploads/${crypto.randomUUID()}`;
    const totalParts = Math.ceil(dto.size / CHUNK_SIZE);

    const s3UploadId = await this.storage.createMultipartUpload(
      s3Key,
      dto.mimeType,
    );

    let passwordHash: string | null = null;
    if (dto.password) {
      passwordHash = await argon2.hash(dto.password);
    }

    const file = await this.prisma.file.create({
      data: {
        slug,
        fileName: dto.fileName,
        s3Key,
        size: BigInt(dto.size),
        mimeType: dto.mimeType,
        checksum: dto.checksum,
        passwordHash,
        isAnonymous: !user,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        ownerId: user?.id ?? null,
        uploadSession: {
          create: { s3UploadId, totalParts },
        },
      },
    });

    const presignedUrl = await this.storage.presignPart(s3Key, s3UploadId, 1);

    this.logger.log(
      `Upload init: "${dto.fileName}" (${dto.size} bytes, ${totalParts} parts) slug=${file.slug} owner=${user?.id ?? 'anonymous'}`,
    );

    return {
      fileId: file.id,
      slug: file.slug,
      totalParts,
      presignedUrl,
      partNumber: 1,
    };
  }

  /**
   * Returns a presigned PUT URL for a specific multipart part.
   * Any caller who knows the fileId may fetch a presign URL —
   * the upload session acts as the implicit auth token for anonymous uploads.
   */
  async presignPart(fileId: string, partNumber: number) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { fileId },
      include: { file: true },
    });
    if (!session) throw new NotFoundException('Upload session not found');

    const presignedUrl = await this.storage.presignPart(
      session.file.s3Key!,
      session.s3UploadId,
      partNumber,
    );
    return { presignedUrl };
  }

  /**
   * Finalizes the multipart upload.
   * Verifies the stored checksum against the completed object's checksum
   * (when MinIO exposes it). On mismatch the upload is aborted and a 422 is returned.
   */
  async completeUpload(fileId: string, dto: CompleteUploadDto) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { fileId },
      include: { file: true },
    });
    if (!session) throw new NotFoundException('Upload session not found');

    const { file } = session;

    const parts: CompletedPart[] = dto.parts.map((p) => ({
      PartNumber: p.partNumber,
      ETag: p.etag,
    }));

    await this.storage.completeMultipartUpload(
      file.s3Key!,
      session.s3UploadId,
      parts,
    );

    // Verify checksum when MinIO returns one; fall back gracefully if not set.
    const { checksumSha256 } = await this.storage.headObject(file.s3Key!);
    if (checksumSha256 && checksumSha256 !== file.checksum) {
      this.logger.warn(`Checksum mismatch for file ${fileId}`);
      await this.storage.abortMultipartUpload(file.s3Key!, session.s3UploadId);
      await this.prisma.uploadSession.delete({ where: { fileId } });
      await this.prisma.file.update({
        where: { id: fileId },
        data: { status: 'DELETED' },
      });
      throw new UnprocessableEntityException('Checksum mismatch');
    }

    // Mark file READY and update owner quota if applicable.
    await this.prisma.$transaction(async (tx) => {
      await tx.file.update({
        where: { id: fileId },
        data: { status: 'READY' },
      });
      await tx.uploadSession.delete({ where: { fileId } });
      if (file.ownerId) {
        await tx.user.update({
          where: { id: file.ownerId },
          data: { usedStorage: { increment: file.size } },
        });
      }
    });

    this.logger.log(`Upload complete: slug=${file.slug} file=${fileId}`);
    return { slug: file.slug, url: `/f/${file.slug}` };
  }

  // ---------------------------------------------------------------------------
  // Read & access
  // ---------------------------------------------------------------------------

  /**
   * Returns public metadata for a file.
   * Performs lazy expiry: if expiresAt < now, cleans up and returns 410.
   */
  async getBySlug(slug: string) {
    const file = await this.prisma.file.findUnique({ where: { slug } });

    if (!file || file.status !== 'READY') {
      throw new NotFoundException('File not found');
    }

    if (file.expiresAt && file.expiresAt < new Date()) {
      this.logger.log(`File expired on access: slug=${slug}`);
      await this.expireFile(file);
      throw new GoneException('File has expired');
    }

    return {
      slug: file.slug,
      fileName: file.fileName,
      size: file.size,
      mimeType: file.mimeType,
      isPasswordProtected: !!file.passwordHash,
      expiresAt: file.expiresAt,
      createdAt: file.createdAt,
    };
  }

  /**
   * Verifies the file password and returns a short-lived (5 min) access token.
   * Always returns 403 on failure to avoid leaking file existence.
   */
  async verifyAccess(slug: string, password: string) {
    const file = await this.prisma.file.findUnique({ where: { slug } });

    const GENERIC_ERROR = new ForbiddenException('Access denied');

    if (!file || file.status !== 'READY' || !file.passwordHash) {
      throw GENERIC_ERROR;
    }

    const valid = await argon2.verify(file.passwordHash, password);
    if (!valid) {
      this.logger.warn(`Wrong password attempt for slug=${slug}`);
      throw GENERIC_ERROR;
    }

    const accessToken = this.jwt.sign(
      { sub: file.id, slug: file.slug, type: 'file-access' },
      { expiresIn: '5m' },
    );

    return { accessToken };
  }

  /**
   * Issues a short-lived presigned GET URL for the file and returns a 302 redirect.
   * If the file is password-protected, validates the access token passed as
   * `?token=<accessToken>` or `Authorization: Bearer <accessToken>`.
   */
  async getDownloadUrl(
    slug: string,
    token: string | undefined,
  ): Promise<string> {
    const file = await this.prisma.file.findUnique({ where: { slug } });

    if (!file || file.status !== 'READY') {
      throw new NotFoundException('File not found');
    }

    if (file.expiresAt && file.expiresAt < new Date()) {
      await this.expireFile(file);
      throw new GoneException('File has expired');
    }

    if (file.passwordHash) {
      if (!token) throw new ForbiddenException('Access token required');
      try {
        const payload = this.jwt.verify(token) as {
          sub: string;
          slug: string;
          type: string;
        };
        if (payload.type !== 'file-access' || payload.slug !== slug) {
          throw new ForbiddenException('Invalid access token');
        }
      } catch {
        throw new ForbiddenException('Invalid or expired access token');
      }
    }

    this.logger.log(`Download issued: slug=${slug} file="${file.fileName}"`);
    return this.storage.presignDownload(file.s3Key!, file.fileName, 60);
  }

  // ---------------------------------------------------------------------------
  // Management (authenticated, owner-only)
  // ---------------------------------------------------------------------------

  /** Lists all READY or PENDING files owned by the user. */
  async listByOwner(userId: string) {
    const files = await this.prisma.file.findMany({
      where: {
        ownerId: userId,
        status: { in: ['READY', 'PENDING'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    return files.map((f) => ({
      id: f.id,
      slug: f.slug,
      fileName: f.fileName,
      size: f.size,
      status: f.status,
      expiresAt: f.expiresAt,
      isPasswordProtected: !!f.passwordHash,
      createdAt: f.createdAt,
    }));
  }

  /** Updates the password and/or expiry of a file. Owner only. */
  async updateFile(fileId: string, userId: string, dto: UpdateFileDto) {
    const file = await this.findOwnedFile(fileId, userId);

    const data: Record<string, unknown> = {};

    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    if (dto.password !== undefined) {
      data.passwordHash = dto.password
        ? await argon2.hash(dto.password)
        : null;
    }

    return this.prisma.file.update({ where: { id: file.id }, data });
  }

  /**
   * Soft-deletes a file: removes the object from MinIO, sets status=DELETED,
   * nulls s3Key (confirming S3 cleanup), and decrements the owner's usedStorage.
   */
  async deleteFile(fileId: string, userId: string): Promise<void> {
    const file = await this.findOwnedFile(fileId, userId);
    this.logger.log(`File deleted: slug=${file.slug} file=${fileId} owner=${userId}`);

    await this.storage.deleteObject(file.s3Key!);

    await this.prisma.$transaction(async (tx) => {
      await tx.file.update({
        where: { id: file.id },
        data: { status: 'DELETED', s3Key: null },
      });
      if (file.status === 'READY') {
        await tx.user.update({
          where: { id: userId },
          data: { usedStorage: { decrement: file.size } },
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Background cleanup
  // ---------------------------------------------------------------------------

  /**
   * Hourly cron: cleans up expired files that were never accessed.
   * Processes up to 500 per run to bound memory usage.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredFiles(): Promise<void> {
    const expired = await this.prisma.file.findMany({
      where: { status: 'READY', expiresAt: { lt: new Date() } },
      take: 500,
    });

    if (expired.length === 0) return;
    this.logger.log(`Sweeping ${expired.length} expired file(s)`);

    for (const file of expired) {
      await this.expireFile(file);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async findOwnedFile(fileId: string, userId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.ownerId !== userId) {
      throw new NotFoundException('File not found');
    }
    if (file.status === FileStatus.DELETED) {
      throw new NotFoundException('File not found');
    }
    return file;
  }

  /**
   * Cleans up an expired file: deletes from MinIO, marks DELETED, decrements quota.
   * Nulls s3Key only on successful S3 deletion — a non-null s3Key on a DELETED
   * file signals an orphaned object for the reconciliation cron to retry.
   */
  private async expireFile(file: {
    id: string;
    s3Key: string | null;
    ownerId: string | null;
    size: bigint;
  }): Promise<void> {
    let s3Deleted = file.s3Key === null; // already clean if key is gone

    if (file.s3Key) {
      try {
        await this.storage.deleteObject(file.s3Key);
        s3Deleted = true;
      } catch (err) {
        this.logger.warn(`Failed to delete expired object ${file.s3Key}: ${err}`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.file.updateMany({
        where: { id: file.id, status: 'READY' },
        data: s3Deleted
          ? { status: 'DELETED', s3Key: null }
          : { status: 'DELETED' },
      });
      if (count > 0 && file.ownerId) {
        await tx.user.update({
          where: { id: file.ownerId },
          data: { usedStorage: { decrement: file.size } },
        });
      }
    });
  }

  /**
   * Daily cron (3 AM): retries S3 deletion for DELETED files whose s3Key is
   * still set, meaning a previous deletion attempt failed and left an orphan.
   * DeleteObject is idempotent — safe to call even if the object is already gone.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async reconcileOrphanedObjects(): Promise<void> {
    const orphans = await this.prisma.file.findMany({
      where: { status: 'DELETED', s3Key: { not: null } },
      take: 1000,
    });

    if (orphans.length === 0) return;
    this.logger.log(`Reconciling ${orphans.length} orphaned S3 object(s)`);

    let purged = 0;
    for (const file of orphans) {
      try {
        await this.storage.deleteObject(file.s3Key!);
        await this.prisma.file.update({
          where: { id: file.id },
          data: { s3Key: null },
        });
        purged++;
      } catch (err) {
        this.logger.warn(`Reconcile: failed to purge ${file.s3Key}: ${err}`);
      }
    }
    this.logger.log(`Reconcile complete: ${purged}/${orphans.length} purged`);
  }
}
