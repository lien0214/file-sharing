import { IsString } from 'class-validator';

export class AccessFileDto {
  @IsString()
  password: string;
}
