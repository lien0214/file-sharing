import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { FilesService } from './files.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

jest.mock('argon2');

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

const makeFile = (overrides: Record<string, unknown> = {}) => ({
  id: 'file-id',
  slug: 'testSlug1234',
  fileName: 'test.png',
  s3Key: 'uploads/test-key',
  size: BigInt(1024),
  mimeType: 'image/png',
  checksum: 'abc123',
  passwordHash: null,
  isAnonymous: false,
  status: 'READY',
  expiresAt: null,
  ownerId: 'user-id',
  createdAt: new Date(),
  ...overrides,
});

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-id',
  email: 'test@example.com',
  passwordHash: 'hashed',
  storageLimit: BigInt(5 * 1024 * 1024 * 1024),
  usedStorage: BigInt(0),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

const mockPrisma = {
  file: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  uploadSession: {
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockStorage = {
  createMultipartUpload: jest.fn(),
  presignPart: jest.fn(),
  completeMultipartUpload: jest.fn(),
  headObject: jest.fn(),
  abortMultipartUpload: jest.fn(),
  deleteObject: jest.fn(),
  presignDownload: jest.fn(),
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('signed-token'),
  verify: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('FilesService', () => {
  let service: FilesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  // ---------------------------------------------------------------------------
  // initUpload
  // ---------------------------------------------------------------------------

  describe('initUpload', () => {
    const dto = {
      fileName: 'test.png',
      size: 1024,
      mimeType: 'image/png',
      checksum: 'abc123',
      expiresAt: undefined as string | undefined,
      password: undefined as string | undefined,
    };

    it('throws BadRequestException when anonymous and expiresAt is missing', async () => {
      await expect(service.initUpload({ ...dto }, null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when authenticated user exceeds quota', async () => {
      const user = makeUser({
        storageLimit: BigInt(1000),
        usedStorage: BigInt(900),
      });

      await expect(
        service.initUpload({ ...dto, size: 200 }, user as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns fileId, slug, totalParts and presignedUrl on success', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(null); // no slug collision
      mockStorage.createMultipartUpload.mockResolvedValue('s3-upload-id');
      mockPrisma.file.create.mockResolvedValue(
        makeFile({ id: 'new-file-id', slug: 'newSlug12345' }),
      );
      mockStorage.presignPart.mockResolvedValue('https://presigned.url/part1');

      const user = makeUser();
      const result = await service.initUpload(
        { ...dto, expiresAt: '2030-01-01T00:00:00Z' },
        user as any,
      );

      expect(result).toMatchObject({
        fileId: 'new-file-id',
        slug: 'newSlug12345',
        totalParts: 1,
        presignedUrl: 'https://presigned.url/part1',
        partNumber: 1,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getBySlug
  // ---------------------------------------------------------------------------

  describe('getBySlug', () => {
    it('throws NotFoundException when file does not exist', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(null);

      await expect(service.getBySlug('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when file status is not READY', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(makeFile({ status: 'PENDING' }));

      await expect(service.getBySlug('testSlug1234')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('triggers expiry cleanup and throws GoneException for expired file', async () => {
      const expiredFile = makeFile({
        expiresAt: new Date(Date.now() - 1000),
      });
      mockPrisma.file.findUnique.mockResolvedValue(expiredFile);
      mockStorage.deleteObject.mockResolvedValue(undefined);
      mockPrisma.$transaction.mockImplementation((cb: (tx: any) => Promise<void>) =>
        cb({
          file: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          user: { update: jest.fn() },
        }),
      );

      await expect(service.getBySlug('testSlug1234')).rejects.toThrow(
        GoneException,
      );
      expect(mockStorage.deleteObject).toHaveBeenCalledWith(expiredFile.s3Key);
    });

    it('returns public metadata for a valid file', async () => {
      const file = makeFile();
      mockPrisma.file.findUnique.mockResolvedValue(file);

      const result = await service.getBySlug('testSlug1234');

      expect(result).toMatchObject({
        slug: file.slug,
        fileName: file.fileName,
        isPasswordProtected: false,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verifyAccess
  // ---------------------------------------------------------------------------

  describe('verifyAccess', () => {
    it('throws ForbiddenException when file is not found', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(null);

      await expect(service.verifyAccess('missing', 'pass')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when file has no passwordHash', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(makeFile({ passwordHash: null }));

      await expect(service.verifyAccess('testSlug1234', 'pass')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException on wrong password', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(
        makeFile({ passwordHash: 'hashed-pass' }),
      );
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.verifyAccess('testSlug1234', 'wrong')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns an accessToken on correct password', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(
        makeFile({ passwordHash: 'hashed-pass' }),
      );
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.verifyAccess('testSlug1234', 'correct');

      expect(result).toEqual({ accessToken: 'signed-token' });
    });
  });

  // ---------------------------------------------------------------------------
  // listByOwner
  // ---------------------------------------------------------------------------

  describe('listByOwner', () => {
    it('queries with an expiry filter so expired files are excluded', async () => {
      mockPrisma.file.findMany.mockResolvedValue([makeFile()]);

      await service.listByOwner('user-id');

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // sweepExpiredFiles
  // ---------------------------------------------------------------------------

  describe('sweepExpiredFiles', () => {
    it('does nothing when no expired files exist', async () => {
      mockPrisma.file.findMany.mockResolvedValue([]);

      await service.sweepExpiredFiles();

      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('nulls s3Key in the update when S3 deletion succeeds', async () => {
      const expiredFile = makeFile({ expiresAt: new Date(Date.now() - 1000) });
      mockPrisma.file.findMany.mockResolvedValue([expiredFile]);
      mockStorage.deleteObject.mockResolvedValue(undefined);
      const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      mockPrisma.$transaction.mockImplementation((cb: (tx: any) => Promise<void>) =>
        cb({ file: { updateMany: txUpdateMany }, user: { update: jest.fn() } }),
      );

      await service.sweepExpiredFiles();

      expect(txUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DELETED', s3Key: null } }),
      );
    });

    it('does not set s3Key null when S3 deletion fails', async () => {
      const expiredFile = makeFile({ expiresAt: new Date(Date.now() - 1000) });
      mockPrisma.file.findMany.mockResolvedValue([expiredFile]);
      mockStorage.deleteObject.mockRejectedValue(new Error('MinIO down'));
      const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      mockPrisma.$transaction.mockImplementation((cb: (tx: any) => Promise<void>) =>
        cb({ file: { updateMany: txUpdateMany }, user: { update: jest.fn() } }),
      );

      await service.sweepExpiredFiles();

      expect(txUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DELETED' } }),
      );
      expect(txUpdateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ s3Key: null }) }),
      );
    });

    it('does not decrement quota when file was already deleted (count=0)', async () => {
      const expiredFile = makeFile({ expiresAt: new Date(Date.now() - 1000) });
      mockPrisma.file.findMany.mockResolvedValue([expiredFile]);
      mockStorage.deleteObject.mockResolvedValue(undefined);
      const txUserUpdate = jest.fn();
      mockPrisma.$transaction.mockImplementation((cb: (tx: any) => Promise<void>) =>
        cb({
          file: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          user: { update: txUserUpdate },
        }),
      );

      await service.sweepExpiredFiles();

      expect(txUserUpdate).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // reconcileOrphanedObjects
  // ---------------------------------------------------------------------------

  describe('reconcileOrphanedObjects', () => {
    it('does nothing when no orphaned objects exist', async () => {
      mockPrisma.file.findMany.mockResolvedValue([]);

      await service.reconcileOrphanedObjects();

      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
    });

    it('purges each orphaned S3 object and nulls the s3Key', async () => {
      const orphan = makeFile({ status: 'DELETED', s3Key: 'uploads/orphan-key' });
      mockPrisma.file.findMany.mockResolvedValue([orphan]);
      mockStorage.deleteObject.mockResolvedValue(undefined);
      mockPrisma.file.update.mockResolvedValue({ ...orphan, s3Key: null });

      await service.reconcileOrphanedObjects();

      expect(mockStorage.deleteObject).toHaveBeenCalledWith('uploads/orphan-key');
      expect(mockPrisma.file.update).toHaveBeenCalledWith({
        where: { id: orphan.id },
        data: { s3Key: null },
      });
    });

    it('continues with remaining files when one S3 deletion fails', async () => {
      const orphan1 = makeFile({ id: 'file-1', s3Key: 'uploads/key-1', status: 'DELETED' });
      const orphan2 = makeFile({ id: 'file-2', s3Key: 'uploads/key-2', status: 'DELETED' });
      mockPrisma.file.findMany.mockResolvedValue([orphan1, orphan2]);
      mockStorage.deleteObject
        .mockRejectedValueOnce(new Error('MinIO unavailable'))
        .mockResolvedValueOnce(undefined);
      mockPrisma.file.update.mockResolvedValue(undefined);

      await service.reconcileOrphanedObjects();

      expect(mockStorage.deleteObject).toHaveBeenCalledTimes(2);
      expect(mockPrisma.file.update).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteFile
  // ---------------------------------------------------------------------------

  describe('deleteFile', () => {
    it('throws NotFoundException when file does not belong to user', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(
        makeFile({ ownerId: 'other-user-id' }),
      );

      await expect(service.deleteFile('file-id', 'user-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes object from storage and marks file as DELETED', async () => {
      const file = makeFile();
      mockPrisma.file.findUnique.mockResolvedValue(file);
      mockStorage.deleteObject.mockResolvedValue(undefined);
      mockPrisma.$transaction.mockImplementation((cb: (tx: any) => Promise<void>) =>
        cb({
          file: { update: jest.fn() },
          user: { update: jest.fn() },
        }),
      );

      await service.deleteFile('file-id', 'user-id');

      expect(mockStorage.deleteObject).toHaveBeenCalledWith(file.s3Key);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });
});
