import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { User } from '@prisma/client';
import { FilesService } from './files.service';
import { InitUploadDto } from './dto/init-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { AccessFileDto } from './dto/access-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // ---------------------------------------------------------------------------
  // Upload pipeline
  // ---------------------------------------------------------------------------

  /** POST /files/upload/init — start a multipart upload. Auth is optional. */
  @Post('upload/init')
  @UseGuards(OptionalJwtGuard)
  initUpload(@Body() dto: InitUploadDto, @CurrentUser() user: User | null) {
    return this.filesService.initUpload(dto, user ?? null);
  }

  /** GET /files/upload/:fileId/presign/:partNumber — get presigned URL for a part. */
  @Get('upload/:fileId/presign/:partNumber')
  presignPart(
    @Param('fileId') fileId: string,
    @Param('partNumber') partNumber: string,
  ) {
    return this.filesService.presignPart(fileId, parseInt(partNumber, 10));
  }

  /** POST /files/upload/:fileId/complete — finalize the multipart upload. */
  @Post('upload/:fileId/complete')
  completeUpload(
    @Param('fileId') fileId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.filesService.completeUpload(fileId, dto);
  }

  // ---------------------------------------------------------------------------
  // Read & access
  // ---------------------------------------------------------------------------

  /** GET /files/:slug — public file metadata with lazy expiry check. */
  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.filesService.getBySlug(slug);
  }

  /** POST /files/:slug/access — verify password, return short-lived access token. */
  @Post(':slug/access')
  @HttpCode(HttpStatus.OK)
  verifyAccess(@Param('slug') slug: string, @Body() dto: AccessFileDto) {
    return this.filesService.verifyAccess(slug, dto.password);
  }

  /**
   * GET /files/:slug/download — redirect to a presigned MinIO GET URL.
   * Accepts access token via ?accessToken= query param or Authorization header.
   */
  @Get(':slug/download')
  async download(
    @Param('slug') slug: string,
    @Query('accessToken') queryToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    const token = queryToken ?? headerToken;
    const url = await this.filesService.getDownloadUrl(slug, token);
    return res.redirect(302, url);
  }

  // ---------------------------------------------------------------------------
  // Management (auth required)
  // ---------------------------------------------------------------------------

  /** GET /files — list all files owned by the current user. */
  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: User) {
    return this.filesService.listByOwner(user.id);
  }

  /** PATCH /files/:id — update password or expiry. Owner only. */
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateFileDto,
  ) {
    return this.filesService.updateFile(id, user.id, dto);
  }

  /** DELETE /files/:id — delete the file. Owner only. Returns 204. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.filesService.deleteFile(id, user.id);
  }
}
