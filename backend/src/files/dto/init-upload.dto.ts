import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsDateString,
  Max,
  MinLength,
} from 'class-validator';

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB

export class InitUploadDto {
  @IsString()
  @MinLength(1)
  fileName: string;

  @IsNumber()
  @IsPositive()
  @Max(MAX_FILE_SIZE)
  size: number;

  @IsString()
  @MinLength(1)
  mimeType: string;

  /** SHA-256 hex digest of the full file, computed client-side. */
  @IsString()
  @MinLength(64)
  checksum: string;

  /** ISO 8601 datetime string. Null means the file never expires. */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  /** Plaintext password. Hashed server-side with Argon2 before storage. */
  @IsOptional()
  @IsString()
  password?: string;
}
