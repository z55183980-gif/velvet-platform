import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import { UploadService } from './upload.service';
import { CreatorService } from '../creator/creator.service';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';

@Controller('v1/creator')
@UseGuards(AuthGuard)
export class UploadController {
  constructor(
    private readonly upload: UploadService,
    private readonly creator: CreatorService,
    private readonly prisma: PrismaService,
  ) {}

  /** multipart 视频上传 → storage/uploads，可选立即入队转码 */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 512 * 1024 * 1024 }, // 512MB
    }),
  )
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
    @Body() body: { episodeId?: string; transcode?: string },
  ) {
    await this.creator.ensureCreator(user.userId);
    const saved = this.upload.saveUpload(file);

    let job: ReturnType<UploadService['enqueueTranscode']> | null = null;
    if (body?.episodeId) {
      const ep = await this.prisma.episode.findUnique({
        where: { id: BigInt(body.episodeId) },
        include: { drama: true },
      });
      if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
      const creator = await this.creator.ensureCreator(user.userId);
      if (ep.drama.creatorId !== creator.id) {
        throw new BizException(BizCode.FORBIDDEN, 'common.forbidden');
      }
      await this.prisma.episode.update({
        where: { id: ep.id },
        data: {
          originalUrl: saved.relativePath,
          hlsUrl: saved.relativePath,
          uploadStatus: 'COMPLETED',
          transcodeStatus: 'PENDING',
        },
      });
      job = this.upload.enqueueTranscode(saved.relativePath, String(ep.id));
    } else if (body?.transcode === '1' || body?.transcode === 'true') {
      job = this.upload.enqueueTranscode(saved.relativePath);
    }

    return ok({
      ...saved,
      jobId: job?.id ?? null,
      transcodeStatus: job?.status ?? null,
      ffmpegReady: !!(await this.upload.detectFfmpeg()),
    });
  }

  @Post('transcode')
  async startTranscode(
    @CurrentUser() user: AuthUser,
    @Body() body: { relativePath: string; episodeId?: string },
  ) {
    await this.creator.ensureCreator(user.userId);
    if (!body?.relativePath) {
      throw new BizException(BizCode.BAD_REQUEST, 'relativePath required');
    }
    if (body.episodeId) {
      const ep = await this.prisma.episode.findUnique({
        where: { id: BigInt(body.episodeId) },
        include: { drama: true },
      });
      if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
      const creator = await this.creator.ensureCreator(user.userId);
      if (ep.drama.creatorId !== creator.id) {
        throw new BizException(BizCode.FORBIDDEN, 'common.forbidden');
      }
      await this.prisma.episode.update({
        where: { id: ep.id },
        data: {
          originalUrl: body.relativePath,
          uploadStatus: 'COMPLETED',
          transcodeStatus: 'PENDING',
        },
      });
    }
    const job = this.upload.enqueueTranscode(body.relativePath, body.episodeId);
    return ok(job);
  }

  @Get('transcode/:jobId')
  async jobStatus(@Param('jobId') jobId: string, @CurrentUser() _user: AuthUser) {
    const job = this.upload.getJob(jobId);
    if (!job) throw new BizException(BizCode.NOT_FOUND, 'job not found');
    return ok(job);
  }

  /** KYC 证件照上传（jpg/png/webp，5MB） */
  @Post('kyc-doc')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new Error(`mime không hợp lệ: ${file.mimetype}`), ok);
      },
    }),
  )
  async uploadKycDoc(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
    @Body() body: { kind?: 'cccd-front' | 'cccd-back' },
  ) {
    await this.creator.ensureCreator(user.userId);
    const kind = body?.kind === 'cccd-back' ? 'cccd-back' : 'cccd-front';
    const saved = this.upload.saveDocument(file, kind);
    return ok({
      ...saved,
      kind,
    });
  }

  /** 用户头像（jpg/png/webp，2MB） */
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new Error(`mime không hợp lệ: ${file.mimetype}`), ok);
      },
    }),
  )
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    const saved = this.upload.saveDocument(file, 'avatar');
    const avatarUrl = `/api/v1/media/${saved.relativePath}`;
    await this.prisma.user.update({
      where: { id: user.userId },
      data: { avatarUrl },
    });
    return ok({ ...saved, avatarUrl });
  }
}
