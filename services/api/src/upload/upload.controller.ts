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
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import { UploadService } from './upload.service';
import { CreatorService } from '../creator/creator.service';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, BizCode } from '../common/biz.exception';
import {
  cleanupMultipartFiles,
  videoDiskStorage,
  videoFileFilter,
  VIDEO_UPLOAD_MAX_BYTES,
} from './multer-options';

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
  @Throttle({ global: { limit: 6, ttl: 10 * 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: videoDiskStorage,
      fileFilter: videoFileFilter,
      limits: { fileSize: VIDEO_UPLOAD_MAX_BYTES },
    }),
  )
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
    @Body() body: { episodeId?: string; transcode?: string },
  ) {
    try {
      const creator = await this.creator.ensureCreator(user.userId);
      let episode: any = null;
      if (body?.episodeId) {
        episode = await this.prisma.episode.findUnique({
          where: { id: BigInt(body.episodeId) },
          include: { drama: true },
        });
        if (!episode) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
        if (episode.drama.creatorId !== creator.id) {
          throw new BizException(BizCode.FORBIDDEN, 'common.forbidden');
        }
        if (episode.drama.status !== 'DRAFT' && episode.drama.status !== 'REJECTED') {
          throw new BizException(BizCode.CONFLICT, '审核中或已上线的作品不能替换片源');
        }
      }

      const saved = this.upload.saveUpload(file);
      let job: Awaited<ReturnType<UploadService['enqueueTranscode']>> | null = null;
      if (episode) {
        await this.prisma.episode.update({
          where: { id: episode.id },
          data: {
            originalUrl: saved.relativePath,
            hlsUrl: saved.relativePath,
            uploadStatus: 'COMPLETED',
            transcodeStatus: 'PENDING',
          },
        });
        job = await this.upload.enqueueTranscode(saved.relativePath, String(episode.id));
      } else if (body?.transcode === '1' || body?.transcode === 'true') {
        job = await this.upload.enqueueTranscode(saved.relativePath);
      }

      return ok({
        ...saved,
        jobId: job?.id ?? null,
        transcodeStatus: job?.status ?? null,
        ffmpegReady: !!(await this.upload.detectFfmpeg()),
      });
    } finally {
      cleanupMultipartFiles(file);
    }
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
    if (!body.episodeId) {
      throw new BizException(BizCode.BAD_REQUEST, 'episodeId required');
    }
    const rel = String(body.relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
    if (
      rel.includes('..') ||
      !(rel.startsWith('uploads/') || rel.startsWith('hls/') || rel.startsWith('import/'))
    ) {
      throw new BizException(BizCode.BAD_REQUEST, 'relativePath không hợp lệ');
    }
    // Touch path under storage roots (throws on traversal).
    this.upload.resolveAbs(rel);
    const ep = await this.prisma.episode.findUnique({
      where: { id: BigInt(body.episodeId) },
      include: { drama: true },
    });
    if (!ep) throw new BizException(BizCode.NOT_FOUND, 'episode.notFound');
    const creator = await this.creator.ensureCreator(user.userId);
    if (ep.drama.creatorId !== creator.id) {
      throw new BizException(BizCode.FORBIDDEN, 'common.forbidden');
    }
    if (ep.drama.status !== 'DRAFT' && ep.drama.status !== 'REJECTED') {
      throw new BizException(BizCode.CONFLICT, '审核中或已上线的作品不能启动转码');
    }
    await this.prisma.episode.update({
      where: { id: ep.id },
      data: {
        originalUrl: rel,
        uploadStatus: 'COMPLETED',
        transcodeStatus: 'PENDING',
      },
    });
    const job = await this.upload.enqueueTranscode(rel, body.episodeId);
    return ok(job);
  }

  @Get('transcode/:jobId')
  async jobStatus(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    const job = await this.upload.getJob(jobId);
    if (!job) throw new BizException(BizCode.NOT_FOUND, 'job not found');
    if (job.episodeId) {
      const ep = await this.prisma.episode.findUnique({
        where: { id: BigInt(job.episodeId) },
        include: { drama: true },
      });
      const creator = await this.creator.ensureCreator(user.userId);
      if (!ep || ep.drama.creatorId !== creator.id) {
        throw new BizException(BizCode.FORBIDDEN, 'common.forbidden');
      }
    }
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
