-- AlterTable: make s3Key nullable so DELETED files with s3Key IS NOT NULL
-- can be identified as orphaned objects still pending S3 cleanup.
ALTER TABLE "File" ALTER COLUMN "s3Key" DROP NOT NULL;
