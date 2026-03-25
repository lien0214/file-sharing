import { IsArray, ValidateNested, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class PartDto {
  @IsNumber()
  partNumber: number;

  /** ETag returned by MinIO after the part was PUT. */
  @IsString()
  etag: string;
}

export class CompleteUploadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartDto)
  parts: PartDto[];
}
