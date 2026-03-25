import { IsOptional, IsString, IsDateString } from 'class-validator';

export class UpdateFileDto {
  /**
   * New password for the file. Pass null to remove the existing password.
   * Pass a non-empty string to set/replace the password.
   */
  @IsOptional()
  @IsString()
  password?: string | null;

  /** New expiry datetime. Pass null to make the file never expire. */
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
