import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { memoryStorage } from 'multer';
import { BizCode, BizException } from '../common/biz.exception';
import { ok } from '../common/response';
import { UploadService } from '../upload/upload.service';
import {
  cleanupMultipartFiles,
  multipartDiskStorage,
  videoDiskStorage,
  videoFileFilter,
  VIDEO_UPLOAD_MAX_BYTES,
} from '../upload/multer-options';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { ContentService } from './content.service';
import { AdminEpisodesService } from './episodes.service';
import { AdminOpsService } from './ops.service';
import { YtdlpImportService } from './ytdlp-import.service';
import { TelegramImportService } from './telegram-import.service';
import { OpenaiService } from '../common/openai.service';

function getActor(req: any): bigint | undefined {
  return req?.adminId as bigint | undefined;
}

function parseWatermarkOpts(body?: {
  watermarkEnabled?: string | boolean;
  watermarkX?: string | number;
  watermarkY?: string | number;
  watermarkScale?: string | number;
  preferR2?: string | boolean;
}) {
  if (!body) return undefined;
  const enabled =
    body.watermarkEnabled === true ||
    body.watermarkEnabled === 'true' ||
    body.watermarkEnabled === '1';
  const num = (v: string | number | undefined) => {
    if (v == null || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const preferR2 =
    body.preferR2 === true || body.preferR2 === 'true'
      ? true
      : body.preferR2 === false || body.preferR2 === 'false'
        ? false
        : undefined;
  if (!enabled && preferR2 == null) return undefined;
  return {
    ...(preferR2 != null ? { preferR2 } : {}),
    watermarkEnabled: enabled,
    watermarkX: num(body.watermarkX),
    watermarkY: num(body.watermarkY),
    watermarkScale: num(body.watermarkScale),
  };
}

class TranslateTitlesDto {
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() titleEn?: string;
  @IsOptional() @IsString() titleFr?: string;
}

class ReasonDto {
  @IsOptional() @IsString() reason?: string;
}

class R2PresignDto {
  @IsNotEmpty() @IsString() filename!: string;
  @IsOptional() @IsString() contentType?: string;
}

class R2DirectEpisodeDto {
  @IsNotEmpty() @IsString() key!: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() episodeNumber?: string | number;
  @IsOptional() isFree?: string | boolean;
  @IsOptional() previewSeconds?: string | number;
  @IsOptional() priceCredits?: string | number;
  @IsOptional() @IsString() thumbnailUrl?: string;
  @IsOptional() watermarkEnabled?: string | boolean;
  @IsOptional() watermarkX?: string | number;
  @IsOptional() watermarkY?: string | number;
  @IsOptional() watermarkScale?: string | number;
}

class R2AttachEpisodeDto {
  @IsNotEmpty() @IsString() key!: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() watermarkEnabled?: string | boolean;
  @IsOptional() watermarkX?: string | number;
  @IsOptional() watermarkY?: string | number;
  @IsOptional() watermarkScale?: string | number;
}

class LocalImportDto {
  @IsOptional() @IsString() rootPath?: string;
  @IsOptional() @IsString() targetDramaId?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  dryRun?: boolean;
}

class BannerDto {
  @IsNotEmpty() @IsString() titleEn!: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsNotEmpty() @IsString() imageUrl!: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsString()
  linkUrl?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && String(v).trim() !== '')
  @IsString()
  dramaId?: string;
  @IsNotEmpty() @IsString() startAt!: string;
  @IsNotEmpty() @IsString() endAt!: string;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional() @Type(() => Number) @IsNumber() focusX?: number;
  @IsOptional() @Type(() => Number) @IsNumber() focusY?: number;
  @IsOptional() @Type(() => Number) @IsNumber() focusZoom?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isActive?: boolean;
}

class CategoryDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,47}$/, {
    message: 'slug must be English snake_case (e.g. romance)',
  })
  slug!: string;
  @IsNotEmpty() @IsString() nameEn!: string;
  @IsOptional() @IsString() nameZh?: string | null;
  @IsOptional() @IsString() nameFr?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isActive?: boolean;
}

class DramaUpdateDto {
  @IsOptional() @IsString() titleEn?: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() titleFr?: string;
  @IsOptional() @IsString() descriptionEn?: string;
  @IsOptional() @IsString() descriptionZh?: string;
  @IsOptional() @IsString() categorySlug?: string;
  /** When set (non-empty), reassign owner; empty/omitted keeps current creator. */
  @IsOptional() @IsString() creatorId?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsIn(['UNKNOWN', 'PUBLIC_DOMAIN', 'CC0', 'CC_BY', 'CC_BY_SA', 'AUTHORIZED', 'OWNED'])
  licenseType?: 'UNKNOWN' | 'PUBLIC_DOMAIN' | 'CC0' | 'CC_BY' | 'CC_BY_SA' | 'AUTHORIZED' | 'OWNED';
  @IsOptional() @IsString() sourcePublisher?: string;
  @IsOptional() @IsString() attributionText?: string;
  @IsOptional() @IsString() rightsProofUrl?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  rightsVerified?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() freeEpisodeCount?: number;
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsIn(['FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE', 'INHERIT'])
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
  @IsOptional() @Type(() => Number) @IsNumber() sortWeight?: number;
  @IsOptional() buyoutCredits?: number | string | null;
  /** Absolute display counters — admin can set for ops (does not rewrite like/favorite rows). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) likeCount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) favoriteCount?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isFeatured?: boolean;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isOfficial?: boolean;
  /** Display tags + optional `type:` / `completion:` markers; provenance tags are preserved server-side. */
  @IsOptional() @IsArray() @IsString({ each: true }) sourceTags?: string[];
}

class BatchDramasDto {
  @IsNotEmpty() ids!: (string | number)[];
  @IsOptional() @Type(() => Number) @IsNumber() freeEpisodeCount?: number;
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsIn(['FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE', 'INHERIT'])
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
  @IsOptional() priceCredits?: number | string;
  @IsOptional() buyoutCredits?: number | string | null;
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : value === true || value === 'true' || value === 1 || value === '1',
  )
  @IsBoolean()
  isFeatured?: boolean;
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : value === true || value === 'true' || value === 1 || value === '1',
  )
  @IsBoolean()
  isOfficial?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() sortWeight?: number;
}

class BatchDramaLifecycleDto {
  @IsArray()
  @ArrayMinSize(1)
  ids!: (string | number)[];
  @IsIn(['offline', 'online', 'delete'])
  action!: 'offline' | 'online' | 'delete';
  @IsOptional() @IsString() reason?: string;
}

class EpisodeUpdateDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isFree?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceCredits?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceVnd?: number;
  /** Trailer/preview length for paid episodes; free episodes force 0 server-side. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) previewSeconds?: number;
  @IsOptional() @IsString() thumbnailUrl?: string;
  @IsOptional() @IsString() sourceUrl?: string;
  @IsOptional() @IsString() hlsUrl?: string;
  @IsOptional() @IsString() originalUrl?: string;
  @IsOptional() @IsString() transcodeStatus?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

class EpisodeCreateDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) episodeNumber?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isFree?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceCredits?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceVnd?: number;
  @IsOptional() @IsString() thumbnailUrl?: string;
  @IsOptional() @IsString() sourceUrl?: string;
  @IsOptional() @IsString() hlsUrl?: string;
  @IsOptional() @IsString() originalUrl?: string;
}

class EpisodeBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  ids!: (string | number)[];
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isFree?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceCredits?: number;
}

class ReorderDto {
  @IsNotEmpty() ids!: string[];
}

class OnlineEpisodeDto {
  @IsNotEmpty() @IsString() sourceUrl!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) episodeNumber?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isFree?: boolean;
  /** First-frame (or uploaded) episode poster — not the drama cover. */
  @IsOptional() @IsString() thumbnailUrl?: string;
}

class CreateOnlineDramaDto {
  @IsNotEmpty() @IsString() titleEn!: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() titleFr?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() descriptionZh?: string;
  @IsOptional() @IsString() descriptionEn?: string;
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() creatorId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) freeEpisodeCount?: number;
  @IsOptional() @IsIn(['FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE', 'INHERIT'])
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
  @IsOptional() buyoutCredits?: number | string | null;
  @IsOptional() @IsIn(['DRAFT'])
  status?: 'DRAFT';
  @IsOptional() @IsString() externalRef?: string;
  /** Accept signed/CDN URLs without media extension (same as yt-dlp import). */
  @IsOptional() @IsBoolean() relaxedPlayUrl?: boolean;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnlineEpisodeDto)
  episodes!: OnlineEpisodeDto[];
}

class CreateLocalUploadDramaDto {
  @IsNotEmpty() @IsString() titleEn!: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() titleFr?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() descriptionZh?: string;
  @IsOptional() @IsString() descriptionEn?: string;
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() creatorId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) freeEpisodeCount?: number;
  @IsOptional() @IsIn(['FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE', 'INHERIT'])
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
  @IsOptional() buyoutCredits?: number | string | null;
  @IsOptional() @IsIn(['DRAFT'])
  status?: 'DRAFT';
  @IsOptional() @IsArray() @IsString({ each: true }) sourceTags?: string[];
  @IsOptional() @IsIn(['LOCAL', 'R2'])
  sourceType?: 'LOCAL' | 'R2';
  @IsOptional() @IsString() externalRef?: string;
  /** Announced/planned episode count (serialization); must be > uploaded if set by admin UI. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) totalEpisodes?: number;
}

class YtdlpAuthFields {
  /** Basename or path under STORAGE_ROOT/secrets/cookies (e.g. reelshort.com.txt) */
  @IsOptional() @IsString() cookiesFile?: string;
  /** Optional Bearer token → Authorization header */
  @IsOptional() @IsString() authBearer?: string;
}

class YtdlpProbeDto extends YtdlpAuthFields {
  @IsNotEmpty() @IsString() url!: string;
}

class YtdlpAiExtractDto extends YtdlpAuthFields {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) maxEpisodes?: number;
}

class YtdlpInferCategoryDto {
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) pageLabels?: string[];
}

class YtdlpResolveDto extends YtdlpAuthFields {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @IsIn(['best_hls', 'best_mp4', 'best'])
  formatPreference?: 'best_hls' | 'best_mp4' | 'best';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) playlistIndex?: number;
}

class YtdlpPreviewFrameDto extends YtdlpAuthFields {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @IsIn(['best_hls', 'best_mp4', 'best'])
  formatPreference?: 'best_hls' | 'best_mp4' | 'best';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) playlistIndex?: number;
}

class YtdlpResolveBatchItemDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) index?: number;
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) playlistIndex?: number;
}

class YtdlpResolveBatchDto extends YtdlpAuthFields {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => YtdlpResolveBatchItemDto)
  episodes!: YtdlpResolveBatchItemDto[];

  @IsOptional() @IsIn(['best_hls', 'best_mp4', 'best'])
  formatPreference?: 'best_hls' | 'best_mp4' | 'best';

  /** Max items to resolve (default: all, hard-capped server-side). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) maxEpisodes?: number;
}

class YtdlpBrowserDownloadDto extends YtdlpAuthFields {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @IsIn(['best_hls', 'best_mp4', 'best'])
  formatPreference?: 'best_hls' | 'best_mp4' | 'best';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) playlistIndex?: number;
  /** Suggested download filename (sanitized server-side). */
  @IsOptional() @IsString() filenameHint?: string;
}

class YtdlpImportDto extends YtdlpAuthFields {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() titleEn?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) maxEpisodes?: number;
  @IsOptional() @IsIn(['best_hls', 'best_mp4', 'best'])
  formatPreference?: 'best_hls' | 'best_mp4' | 'best';
}

class YtdlpTransferEpisodeDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) episodeNumber?: number;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() webpageUrl?: string;
  @IsOptional() @IsString() sourceUrl?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) playlistIndex?: number;
  @IsOptional() @Type(() => Number) @IsNumber() durationSec?: number;
}

class YtdlpTransferDto extends YtdlpAuthFields {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @IsString() categorySlug?: string;
  @IsNotEmpty() @IsIn(['local', 'r2'])
  target!: 'local' | 'r2';
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() titleEn?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() descriptionEn?: string;
  @IsOptional() @IsString() descriptionZh?: string;
  @IsOptional() @IsString() creatorId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) maxEpisodes?: number;
  @IsOptional() @IsIn(['best_hls', 'best_mp4', 'best'])
  formatPreference?: 'best_hls' | 'best_mp4' | 'best';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) freeEpisodeCount?: number;
  @IsOptional() @IsIn(['FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE', 'INHERIT'])
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
  @IsOptional() buyoutCredits?: number | string | null;
  /** Explicit episode list — skips playlist probe; honors AI/manual selection. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => YtdlpTransferEpisodeDto)
  episodes?: YtdlpTransferEpisodeDto[];
  @IsOptional() watermarkEnabled?: boolean | string;
  @IsOptional() @Type(() => Number) @IsNumber() watermarkX?: number;
  @IsOptional() @Type(() => Number) @IsNumber() watermarkY?: number;
  @IsOptional() @Type(() => Number) @IsNumber() watermarkScale?: number;
}

class YtdlpAppendDto extends YtdlpAuthFields {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) maxEpisodes?: number;
  @IsOptional() @IsIn(['best_hls', 'best_mp4', 'best'])
  formatPreference?: 'best_hls' | 'best_mp4' | 'best';
}

class TelegramProbeDto {
  @IsNotEmpty() @IsString() channel!: string;
  @IsOptional() @IsIn(['recent', 'range'])
  mode?: 'recent' | 'range';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) recentN?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) fromId?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) toId?: number;
  @IsOptional() mediaOnly?: boolean | string;
}

class TelegramThumbDto {
  @IsNotEmpty() @IsString() channel!: string;
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(1) messageId!: number;
}

class TelegramTransferEpisodeDto {
  @IsNotEmpty() @Type(() => Number) @IsNumber() @Min(1) messageId!: number;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() webpageUrl?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) episodeNumber?: number;
  @IsOptional() @Type(() => Number) @IsNumber() durationSec?: number;
}

class TelegramTransferDto {
  @IsNotEmpty() @IsString() channel!: string;
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() titleEn?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() descriptionEn?: string;
  @IsOptional() @IsString() descriptionZh?: string;
  @IsOptional() @IsString() creatorId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) freeEpisodeCount?: number;
  @IsOptional() @IsIn(['FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE', 'INHERIT'])
  lockMode?: 'FREE_FIRST_N' | 'VIP_ALL' | 'ALL_FREE' | 'INHERIT' | null;
  @IsOptional() buyoutCredits?: number | string | null;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TelegramTransferEpisodeDto)
  episodes!: TelegramTransferEpisodeDto[];
  @IsOptional() watermarkEnabled?: boolean | string;
  @IsOptional() @Type(() => Number) @IsNumber() watermarkX?: number;
  @IsOptional() @Type(() => Number) @IsNumber() watermarkY?: number;
  @IsOptional() @Type(() => Number) @IsNumber() watermarkScale?: number;
  /** Optional fixed-duration cut (seconds). Empty = one TG post → one episode. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(30)
  @Max(600)
  segmentSeconds?: number;
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class ContentController {
  constructor(
    private readonly admin: AdminService,
    private readonly content: ContentService,
    private readonly episodes: AdminEpisodesService,
    private readonly ops: AdminOpsService,
    private readonly ytdlp: YtdlpImportService,
    private readonly telegram: TelegramImportService,
    private readonly upload: UploadService,
    private readonly openai: OpenaiService,
  ) {}

  /** 以英文标题为源，LLM 一次返回并覆盖中/法标题。 */
  @Post('translate/titles')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async translateTitles(@Body() dto: TranslateTitlesDto) {
    return ok(await this.openai.completeTitles(dto));
  }

  /** 管理端封面/缩略图上传 → 实例 STORAGE_ROOT/covers，返回 /api/v1/media/... */
  @Post('upload/image')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(okMime ? null : new Error(`无效图片类型: ${file.mimetype}`), okMime);
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { kind?: string },
  ) {
    const kindRaw = (body?.kind || 'cover').trim();
    const kind =
      kindRaw === 'thumbnail' || kindRaw === 'image' || kindRaw === 'cover'
        ? kindRaw
        : 'cover';
    const saved = await this.upload.saveImage(file, kind);
    return ok(saved);
  }

  @Get('storage/status')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async storageStatus() {
    const status = this.upload.storageStatus();
    const ffmpegReady = !!(await this.upload.detectFfmpeg());
    return ok({ ...status, ffmpegReady });
  }

  /** Live R2 bucket reachability (ListObjectsV2 MaxKeys=1) + latency + storage size. */
  @Get('storage/probe')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async storageProbe() {
    return ok(await this.upload.storageProbe());
  }

  /** 预签名：浏览器直传 R2（velvet-uploads），不经 Next/API 代理传大文件 */
  @Post('uploads/presign')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async presignDirectUpload(@Body() dto: R2PresignDto, @Req() req: any) {
    return ok(
      await this.upload.createPresignedDirectUpload({
        filename: dto.filename,
        contentType: dto.contentType,
        actorId: getActor(req),
      }),
    );
  }

  /**
   * 确认直传：API 从 R2 拉取对象落盘 → 建集 → 排队转码。
   * 浏览器只 PUT 到 R2；此接口为小 JSON。
   */
  @Post('dramas/:id/episodes/from-r2')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async createEpisodeFromR2(@Param('id') id: string, @Body() dto: R2DirectEpisodeDto, @Req() req: any) {
    const wm = parseWatermarkOpts(dto);
    return ok(
      await this.episodes.createWithR2DirectUpload(
        id,
        {
          key: dto.key,
          filename: dto.filename,
          title: dto.title,
          episodeNumber: dto.episodeNumber != null ? Number(dto.episodeNumber) : undefined,
          isFree: dto.isFree === true || dto.isFree === 'true' || dto.isFree === '1',
          previewSeconds: dto.previewSeconds != null ? Number(dto.previewSeconds) : undefined,
          priceCredits: dto.priceCredits != null ? Number(dto.priceCredits) : undefined,
          thumbnailUrl: dto.thumbnailUrl,
          watermarkEnabled: wm?.watermarkEnabled,
          watermarkX: wm?.watermarkX,
          watermarkY: wm?.watermarkY,
          watermarkScale: wm?.watermarkScale,
        },
        getActor(req),
      ),
    );
  }

  @Get('transcode/:jobId')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async transcodeJob(@Param('jobId') jobId: string) {
    const job = await this.upload.getJob(jobId);
    if (!job) throw new BizException(BizCode.NOT_FOUND, 'job not found');
    return ok(job);
  }

  @Get('dramas/:id/storage')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async dramaStorage(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeTotals') includeTotals?: string,
  ) {
    return ok(
      await this.episodes.listStorage(id, {
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 10,
        includeTotals:
          includeTotals == null || includeTotals === ''
            ? false
            : !['0', 'false', 'no'].includes(includeTotals.toLowerCase()),
      }),
    );
  }

  /**
   * 确认直传到已有分集：浏览器 PUT velvet-uploads 后，API 拉取落盘 → 排队转码。
   */
  @Post('episodes/:id/from-r2')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async attachEpisodeFromR2(
    @Param('id') id: string,
    @Body() dto: R2AttachEpisodeDto,
    @Req() req: any,
  ) {
    return ok(
      await this.episodes.attachDirectUpload(
        id,
        dto.key,
        dto.filename,
        getActor(req),
        parseWatermarkOpts(dto),
      ),
    );
  }

  /** multipart 视频上传到已有分集（无 R2 直传时的回退） */
  @Post('episodes/:id/upload')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: videoDiskStorage,
      fileFilter: videoFileFilter,
      limits: { fileSize: VIDEO_UPLOAD_MAX_BYTES },
    }),
  )
  async uploadEpisodeVideo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      watermarkEnabled?: string | boolean;
      watermarkX?: string | number;
      watermarkY?: string | number;
      watermarkScale?: string | number;
    },
    @Req() req: any,
  ) {
    try {
      return ok(
        await this.episodes.uploadVideo(id, file, getActor(req), parseWatermarkOpts(body)),
      );
    } finally {
      cleanupMultipartFiles(file);
    }
  }

  /** 新建分集并上传视频（可无播放 URL） */
  @Post('dramas/:id/episodes/upload')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: videoDiskStorage,
      fileFilter: videoFileFilter,
      limits: { fileSize: VIDEO_UPLOAD_MAX_BYTES },
    }),
  )
  async createEpisodeWithUpload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      title?: string;
      episodeNumber?: string | number;
      isFree?: string | boolean;
      previewSeconds?: string | number;
      priceCredits?: string | number;
      thumbnailUrl?: string;
      watermarkEnabled?: string | boolean;
      watermarkX?: string | number;
      watermarkY?: string | number;
      watermarkScale?: string | number;
    },
    @Req() req: any,
  ) {
    try {
      const wm = parseWatermarkOpts(body);
      return ok(
        await this.episodes.createWithUpload(
          id,
          file,
          {
            title: body?.title,
            episodeNumber: body?.episodeNumber != null ? Number(body.episodeNumber) : undefined,
            isFree: body?.isFree === true || body?.isFree === 'true' || body?.isFree === '1',
            previewSeconds: body?.previewSeconds != null ? Number(body.previewSeconds) : undefined,
            priceCredits: body?.priceCredits != null ? Number(body.priceCredits) : undefined,
            thumbnailUrl: body?.thumbnailUrl,
            watermarkEnabled: wm?.watermarkEnabled,
            watermarkX: wm?.watermarkX,
            watermarkY: wm?.watermarkY,
            watermarkScale: wm?.watermarkScale,
          },
          getActor(req),
        ),
      );
    } finally {
      cleanupMultipartFiles(file);
    }
  }

  @Post('episodes/:id/media/purge')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async purgeEpisodeMedia(@Param('id') id: string, @Req() req: any) {
    return ok(await this.episodes.purgeMedia(id, getActor(req)));
  }

  @Get('dramas')
  async listDramas(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('categorySlug') categorySlug?: string,
    @Query('creatorId') creatorId?: string,
    @Query('isOfficial') isOfficial?: string,
    @Query('isFeatured') isFeatured?: string,
    @Query('isHottest') isHottest?: string,
    @Query('mediaKind') mediaKind?: string,
    @Query('sort') sort?: string,
    @Query('dateField') dateField?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const kind =
      mediaKind === 'owned' ||
      mediaKind === 'online' ||
      mediaKind === 'r2' ||
      mediaKind === 'local'
        ? mediaKind
        : undefined;
    const sortKey =
      sort === 'latest' ||
      sort === 'views' ||
      sort === 'unlocks' ||
      sort === 'created' ||
      sort === 'weight'
        ? sort
        : 'weight';
    return ok(await this.content.list({
      q,
      status: (status as any) || 'ALL',
      categorySlug,
      creatorId: creatorId || undefined,
      isOfficial: isOfficial as any,
      isFeatured: isFeatured as any,
      isHottest: isHottest as any,
      mediaKind: kind,
      sort: sortKey,
      dateField: dateField === 'createdAt' ? 'createdAt' : 'publishedAt',
      dateFrom,
      dateTo,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    }));
  }

  @Get('dramas/pending')
  async pendingDramas() {
    return ok(await this.admin.pendingDramas());
  }

  @Get('dramas/ranking')
  async ranking() {
    return ok(await this.content.ranking());
  }

  @Get('dramas/hottest')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async listHottest() {
    return ok(await this.content.listHottest());
  }

  @Post('dramas/online')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async createOnlineDrama(@Body() dto: CreateOnlineDramaDto, @Req() req: any) {
    if (!Array.isArray(dto?.episodes) || dto.episodes.length === 0) {
      throw new BizException(BizCode.BAD_REQUEST, '至少填写一集播放链接');
    }
    return ok(await this.admin.createOnlineDrama(dto as any, getActor(req)));
  }

  /** 创建本地/R2 托管剧壳，随后用 episodes/upload 逐集上传视频 */
  @Post('dramas/upload')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async createUploadDrama(@Body() dto: CreateLocalUploadDramaDto, @Req() req: any) {
    return ok(await this.admin.createLocalUploadDrama(dto as any, getActor(req)));
  }

  /**
   * 一步创建剧集并上传多个视频文件（按文件名排序）。
   * 大文件建议改用 dramas/upload + dramas/:id/episodes/upload 逐集上传。
   */
  @Post('dramas/upload-with-files')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  @UseInterceptors(
    FilesInterceptor('files', 30, {
      storage: videoDiskStorage,
      fileFilter: videoFileFilter,
      limits: { fileSize: VIDEO_UPLOAD_MAX_BYTES, files: 30 },
    }),
  )
  async createUploadDramaWithFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      titleEn?: string;
      titleZh?: string;
      titleFr?: string;
      slug?: string;
      descriptionZh?: string;
      descriptionEn?: string;
      categorySlug?: string;
      coverUrl?: string;
      creatorId?: string;
      freeEpisodeCount?: string | number;
      lockMode?: string;
      status?: string;
      isFree?: string | boolean;
      priceCredits?: string | number;
    },
    @Req() req: any,
  ) {
    try {
      if (!files?.length) {
        throw new BizException(BizCode.BAD_REQUEST, '请至少上传一个视频文件');
      }
      const drama = await this.admin.createLocalUploadDrama(
        {
          titleEn: body.titleEn || '',
          titleZh: body.titleZh,
          titleFr: body.titleFr,
          slug: body.slug,
          descriptionZh: body.descriptionZh,
          descriptionEn: body.descriptionEn,
          categorySlug: body.categorySlug || '',
          coverUrl: body.coverUrl,
          creatorId: body.creatorId,
          freeEpisodeCount:
            body.freeEpisodeCount != null ? Number(body.freeEpisodeCount) : undefined,
          lockMode: body.lockMode as any,
          // 与 createLocalUploadDrama 一致：创建强制草稿
          status: 'DRAFT',
        },
        getActor(req),
      );
      const sorted = [...files].sort((a, b) =>
        String(a.originalname).localeCompare(String(b.originalname), undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
      const isFree = body.isFree === true || body.isFree === 'true' || body.isFree === '1';
      const priceCredits =
        body.priceCredits != null && body.priceCredits !== ''
          ? Number(body.priceCredits)
          : isFree
            ? 0
            : 10;
      const jobs: Array<{ episodeId: string; jobId: string; filename: string }> = [];
      for (let i = 0; i < sorted.length; i++) {
        const file = sorted[i];
        const uploaded = await this.episodes.createWithUpload(
          drama.id,
          file,
          {
            title: file.originalname.replace(/\.[^.]+$/, '') || `第${i + 1}集`,
            episodeNumber: i + 1,
            isFree,
            priceCredits,
          },
          getActor(req),
        );
        jobs.push({
          episodeId: uploaded.episode.id,
          jobId: uploaded.jobId,
          filename: file.originalname,
        });
      }
      return ok({
        ...drama,
        totalEpisodes: jobs.length,
        jobs,
        ffmpegReady: !!(await this.upload.detectFfmpeg()),
      });
    } finally {
      cleanupMultipartFiles(files);
    }
  }

  /** 公开链接解析（本地 yt-dlp，无需 API Key） */
  @Get('ytdlp/status')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpStatus() {
    return ok(await this.ytdlp.status());
  }

  @Post('ytdlp/probe')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpProbe(@Body() dto: YtdlpProbeDto) {
    return ok(
      await this.ytdlp.probe(dto.url, {
        cookiesFile: dto.cookiesFile,
        bearerToken: dto.authBearer,
      }),
    );
  }

  /** Path B: HTML + OpenAI 抽取分集（复用公开页解析面板）。 */
  @Post('ytdlp/ai-extract')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpAiExtract(@Body() dto: YtdlpAiExtractDto) {
    return ok(
      await this.ytdlp.aiExtract({
        url: dto.url,
        maxEpisodes: dto.maxEpisodes,
        cookiesFile: dto.cookiesFile,
        authBearer: dto.authBearer,
      }),
    );
  }

  /** Infer catalog category for Apply-to-main when probe/AI did not already set one. */
  @Post('ytdlp/infer-category')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpInferCategory(@Body() dto: YtdlpInferCategoryDto) {
    return ok(
      await this.ytdlp.inferCategory({
        categorySlug: dto.categorySlug,
        title: dto.title,
        description: dto.description,
        pageLabels: dto.pageLabels,
      }),
    );
  }

  @Post('ytdlp/resolve')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpResolve(@Body() dto: YtdlpResolveDto) {
    return ok(
      await this.ytdlp.resolve(dto.url, dto.formatPreference, dto.playlistIndex, {
        cookiesFile: dto.cookiesFile,
        bearerToken: dto.authBearer,
      }),
    );
  }

  /** Resolve (if needed) + ffmpeg first frame for watermark placement (not cover art). */
  @Post('ytdlp/preview-frame')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpPreviewFrame(@Body() dto: YtdlpPreviewFrameDto) {
    return ok(
      await this.ytdlp.previewFrame({
        url: dto.url,
        formatPreference: dto.formatPreference,
        playlistIndex: dto.playlistIndex,
        cookiesFile: dto.cookiesFile,
        authBearer: dto.authBearer,
      }),
    );
  }

  /** After AI extract: batch yt-dlp resolve episode page URLs → playable media URLs. */
  @Post('ytdlp/resolve-batch')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpResolveBatch(@Body() dto: YtdlpResolveBatchDto) {
    return ok(
      await this.ytdlp.resolveBatch({
        episodes: dto.episodes,
        formatPreference: dto.formatPreference,
        maxEpisodes: dto.maxEpisodes,
        cookiesFile: dto.cookiesFile,
        authBearer: dto.authBearer,
      }),
    );
  }

  /**
   * yt-dlp 在服务端拉成实体文件，再作为附件触发浏览器「另存为」。
   * 用于越过外链 CORS/防盗链；下载完成后删除临时文件。
   */
  @Post('ytdlp/download')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpBrowserDownload(
    @Body() dto: YtdlpBrowserDownloadDto,
    @Res({ passthrough: false }) res: Response,
  ) {
    const file = await this.ytdlp.downloadEpisodeForBrowser({
      url: dto.url,
      formatPreference: dto.formatPreference,
      playlistIndex: dto.playlistIndex,
      filenameHint: dto.filenameHint,
      cookiesFile: dto.cookiesFile,
      authBearer: dto.authBearer,
    });

    const asciiName = file.filename.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');

    const stream = fs.createReadStream(file.absPath);
    const cleanup = () => {
      try {
        fs.unlinkSync(file.absPath);
      } catch {
        /* ignore */
      }
    };
    stream.on('close', cleanup);
    stream.on('error', () => {
      cleanup();
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  }

  /** Upload Netscape cookies.txt for a source hostname (saved as {host}.txt). */
  @Post('ytdlp/cookies')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async ytdlpUploadCookies(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { hostname?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BizException(BizCode.BAD_REQUEST, '请上传 cookies.txt 文件');
    }
    const hostname =
      String(body?.hostname || '').trim() ||
      String(file.originalname || '')
        .replace(/\.txt$/i, '')
        .trim();
    return ok(await this.ytdlp.saveCookies(hostname, file.buffer));
  }

  @Post('ytdlp/import')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpImport(@Body() dto: YtdlpImportDto, @Req() req: any) {
    return ok(await this.ytdlp.importDrama(dto, getActor(req)));
  }

  /** yt-dlp 下载落盘 → 转码 HLS → 本地或 R2（异步任务，立刻返回 jobId） */
  @Post('ytdlp/transfer')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpTransfer(@Body() dto: YtdlpTransferDto, @Req() req: any) {
    const wm = parseWatermarkOpts(dto);
    return ok(
      await this.ytdlp.transferDrama(
        {
          url: dto.url,
          categorySlug: dto.categorySlug,
          target: dto.target,
          titleZh: dto.titleZh,
          titleEn: dto.titleEn,
          coverUrl: dto.coverUrl,
          descriptionEn: dto.descriptionEn,
          descriptionZh: dto.descriptionZh,
          creatorId: dto.creatorId,
          maxEpisodes: dto.maxEpisodes,
          formatPreference: dto.formatPreference,
          cookiesFile: dto.cookiesFile,
          authBearer: dto.authBearer,
          episodes: dto.episodes,
          freeEpisodeCount: dto.freeEpisodeCount,
          lockMode: dto.lockMode,
          buyoutCredits: dto.buyoutCredits,
          watermarkEnabled: wm?.watermarkEnabled,
          watermarkX: wm?.watermarkX,
          watermarkY: wm?.watermarkY,
          watermarkScale: wm?.watermarkScale,
        },
        getActor(req),
      ),
    );
  }

  @Get('ytdlp/transfer/:jobId')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpTransferJob(@Param('jobId') jobId: string) {
    return ok(await this.ytdlp.getTransferJob(jobId));
  }

  @Get('telegram/status')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async telegramStatus() {
    return ok(await this.telegram.status());
  }

  @Post('telegram/probe')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async telegramProbe(@Body() dto: TelegramProbeDto) {
    const mediaOnly =
      dto.mediaOnly === undefined
        ? true
        : !(dto.mediaOnly === false || dto.mediaOnly === 'false' || dto.mediaOnly === '0');
    return ok(
      await this.telegram.probe({
        channel: dto.channel,
        mode: dto.mode,
        recentN: dto.recentN,
        fromId: dto.fromId,
        toId: dto.toId,
        mediaOnly,
      }),
    );
  }

  @Post('telegram/thumb')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async telegramThumb(@Body() dto: TelegramThumbDto) {
    return ok(
      await this.telegram.thumb({
        channel: dto.channel,
        messageId: dto.messageId,
      }),
    );
  }

  @Post('telegram/transfer')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async telegramTransfer(@Body() dto: TelegramTransferDto, @Req() req: any) {
    const wm = parseWatermarkOpts(dto);
    return ok(
      await this.telegram.transferDrama(
        {
          channel: dto.channel,
          categorySlug: dto.categorySlug,
          titleZh: dto.titleZh,
          titleEn: dto.titleEn,
          coverUrl: dto.coverUrl,
          descriptionEn: dto.descriptionEn,
          descriptionZh: dto.descriptionZh,
          creatorId: dto.creatorId,
          freeEpisodeCount: dto.freeEpisodeCount,
          lockMode: dto.lockMode,
          buyoutCredits: dto.buyoutCredits,
          episodes: dto.episodes || [],
          watermarkEnabled: wm?.watermarkEnabled,
          watermarkX: wm?.watermarkX,
          watermarkY: wm?.watermarkY,
          watermarkScale: wm?.watermarkScale,
          segmentSeconds: dto.segmentSeconds,
        },
        getActor(req),
      ),
    );
  }

  @Get('telegram/transfer/:jobId')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async telegramTransferJob(@Param('jobId') jobId: string) {
    return ok(await this.telegram.getTransferJob(jobId));
  }

  /**
   * Resume a COMPLETED/FAILED transfer: realign episode numbers to sourceIndex
   * (optional) and start a gap-fill job for selected items that never landed.
   */
  @Post('ytdlp/transfer/:jobId/resume')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpTransferResume(
    @Param('jobId') jobId: string,
    @Body() body: { realignEpisodeNumbers?: boolean },
    @Req() req: any,
  ) {
    return ok(
      await this.ytdlp.resumeTransferJob(
        jobId,
        {
          realignEpisodeNumbers: body?.realignEpisodeNumbers !== false,
        },
        getActor(req),
      ),
    );
  }

  @Post('dramas/:id/ytdlp/append')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async ytdlpAppend(
    @Param('id') id: string,
    @Body() dto: YtdlpAppendDto,
    @Req() req: any,
  ) {
    return ok(await this.ytdlp.appendToDrama(id, dto, getActor(req)));
  }

  @Post('dramas/hottest/reorder')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async reorderHottest(@Body() dto: ReorderDto, @Req() req: any) {
    const ids = Array.isArray(dto?.ids) ? dto.ids.map(String) : [];
    return ok(await this.content.reorderHottest(ids, getActor(req)));
  }

  @Patch('dramas/batch')
  @AdminRoles('SUPER_ADMIN')
  async batchDramas(@Body() dto: BatchDramasDto, @Req() req: any) {
    return ok(await this.ops.batchUpdateDramas(dto, getActor(req)));
  }

  @Post('dramas/batch-lifecycle')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async batchDramaLifecycle(@Body() dto: BatchDramaLifecycleDto, @Req() req: any) {
    // Hard-delete is SUPER_ADMIN only; offline/online remain SUPER_ADMIN | OPS.
    if (dto.action === 'delete' && req?.adminRole !== 'SUPER_ADMIN') {
      throw new BizException(BizCode.FORBIDDEN, 'admin.roleRequired', undefined, {
        roles: 'SUPER_ADMIN',
      });
    }
    return ok(
      await this.admin.batchLifecycle(dto.action, dto.ids, dto.reason, getActor(req)),
    );
  }

  @Get('dramas/:id')
  async getDrama(@Param('id') id: string) {
    return ok(await this.content.detail(id));
  }

  @Post('dramas/:id/submit-review')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async submitDramaReview(@Param('id') id: string, @Req() req: any) {
    return ok(await this.admin.submitDramaReview(id, getActor(req)));
  }

  @Post('dramas/:id/approve')
  async approveDrama(@Param('id') id: string, @Req() req: any) {
    return ok(await this.admin.approveDrama(id, getActor(req)));
  }

  @Post('dramas/:id/reject')
  async rejectDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.rejectDrama(id, dto.reason, getActor(req)));
  }

  @Post('dramas/:id/update')
  async updateDrama(@Param('id') id: string, @Body() dto: DramaUpdateDto, @Req() req: any) {
    return ok(await this.admin.updateDrama(id, dto, getActor(req)));
  }

  @Post('dramas/:id/offline')
  async offlineDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.offlineDrama(id, dto.reason, getActor(req)));
  }

  @Post('dramas/:id/online')
  async onlineDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.onlineDrama(id, dto.reason, getActor(req)));
  }

  @Post('dramas/:id/featured')
  async setFeatured(@Param('id') id: string, @Body() body: { value: boolean }, @Req() req: any) {
    return ok(await this.content.setFeatured(id, !!body?.value, getActor(req)));
  }

  @Post('dramas/:id/official')
  async setOfficial(@Param('id') id: string, @Body() body: { value: boolean }, @Req() req: any) {
    return ok(await this.content.setOfficial(id, !!body?.value, getActor(req)));
  }

  @Post('dramas/:id/sort-weight')
  async setSortWeight(
    @Param('id') id: string,
    @Body() body: { weight: number },
    @Req() req: any,
  ) {
    return ok(await this.content.setSortWeight(id, Number(body?.weight ?? 0), getActor(req)));
  }

  @Post('dramas/:id/hottest')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async setHottest(@Param('id') id: string, @Body() body: { value: boolean }, @Req() req: any) {
    return ok(await this.content.setHottest(id, !!body?.value, getActor(req)));
  }

  @Post('dramas/:id/hottest-sort')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async setHottestSort(
    @Param('id') id: string,
    @Body() body: { sortOrder: number },
    @Req() req: any,
  ) {
    return ok(
      await this.content.setHottestSortOrder(id, Number(body?.sortOrder ?? 0), getActor(req)),
    );
  }

  @Post('dramas/:id/delete')
  @AdminRoles('SUPER_ADMIN')
  async deleteDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.deleteDrama(id, dto.reason, getActor(req)));
  }

  @Get('dramas/:id/episodes')
  async dramaEpisodes(@Param('id') id: string) {
    return ok(await this.episodes.listByDrama(id));
  }

  @Post('dramas/:id/episodes')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async createEpisode(@Param('id') id: string, @Body() dto: EpisodeCreateDto, @Req() req: any) {
    return ok(await this.episodes.create(id, dto as any, getActor(req)));
  }

  @Post('dramas/:id/episodes/batch')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async batchEpisodes(@Param('id') id: string, @Body() dto: EpisodeBatchDto, @Req() req: any) {
    return ok(await this.episodes.batchUpdate(id, dto as any, getActor(req)));
  }

  @Post('episodes/:id/update')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async updateEpisode(@Param('id') id: string, @Body() dto: EpisodeUpdateDto, @Req() req: any) {
    return ok(await this.episodes.update(id, dto as any, getActor(req)));
  }

  @Post('episodes/:id/delete')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async deleteEpisode(@Param('id') id: string, @Req() req: any) {
    return ok(await this.episodes.delete(id, getActor(req)));
  }

  @Post('dramas/:id/episodes/reorder')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async reorderEpisodes(@Param('id') id: string, @Body() dto: ReorderDto, @Req() req: any) {
    return ok(await this.episodes.reorder(id, dto.ids, getActor(req)));
  }

  @Post('episodes/:id/transcode-retry')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async retryTranscode(
    @Param('id') id: string,
    @Body()
    body: {
      watermarkEnabled?: boolean;
      watermarkX?: number;
      watermarkY?: number;
      watermarkScale?: number;
      preferR2?: boolean;
    },
    @Req() req: any,
  ) {
    return ok(await this.episodes.retryTranscode(id, getActor(req), body));
  }

  @Post('episodes/:id/first-frame')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async episodeFirstFrame(@Param('id') id: string) {
    return ok(await this.episodes.firstFrame(id));
  }

  @Post('import/local')
  async importLocal(@Body() dto: LocalImportDto) {
    return ok(
      await this.admin.importLocal({
        rootPath: dto.rootPath,
        dryRun: dto.dryRun,
        targetDramaId: dto.targetDramaId,
      }),
    );
  }

  @Post('import/upload')
  @UseInterceptors(FilesInterceptor('files', 200, {
    storage: multipartDiskStorage,
    limits: { fileSize: VIDEO_UPLOAD_MAX_BYTES, files: 200 },
  }))
  async importUpload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      relativePaths?: string | string[];
      dryRun?: string | boolean;
      targetDramaId?: string;
    },
  ) {
    try {
      const raw = body?.relativePaths;
      const relativePaths = Array.isArray(raw)
        ? raw.map(String)
        : raw != null && raw !== ''
          ? [String(raw)]
          : [];
      const dryRun = body?.dryRun === true || body?.dryRun === 'true' || body?.dryRun === '1';
      if (!files?.length) {
        throw new BizException(BizCode.BAD_REQUEST, '请选择要导入的文件夹');
      }
      return ok(
        await this.admin.importUploadedFiles(
          files,
          relativePaths,
          dryRun,
          body?.targetDramaId?.trim() || undefined,
        ),
      );
    } finally {
      cleanupMultipartFiles(files);
    }
  }

  @Get('banners')
  async listBanners(@Query('all') all?: string) {
    return ok(await this.admin.listBanners(all === '1' || all === 'true'));
  }

  @Post('banners')
  async createBanner(@Body() dto: BannerDto, @Req() req: any) {
    return ok(await this.admin.createBanner(dto, getActor(req)));
  }

  @Post('banners/:id')
  async updateBanner(@Param('id') id: string, @Body() dto: Partial<BannerDto>, @Req() req: any) {
    return ok(await this.admin.updateBanner(id, dto, getActor(req)));
  }

  @Post('banners/:id/delete')
  async deleteBanner(@Param('id') id: string, @Req() req: any) {
    return ok(await this.admin.deleteBanner(id, getActor(req)));
  }

  @Get('categories')
  async listCategories(@Query('all') all?: string) {
    return ok(await this.admin.listCategories(all === '1' || all === 'true'));
  }

  @Post('categories')
  async createCategory(@Body() dto: CategoryDto, @Req() req: any) {
    return ok(await this.admin.createCategory(dto, getActor(req)));
  }

  @Post('categories/:slug')
  async updateCategory(
    @Param('slug') slug: string,
    @Body() dto: Partial<CategoryDto>,
    @Req() req: any,
  ) {
    return ok(await this.admin.updateCategory(slug, dto, getActor(req)));
  }

  @Post('categories/:slug/delete')
  async deleteCategory(@Param('slug') slug: string, @Req() req: any) {
    return ok(await this.admin.deleteCategory(slug, getActor(req)));
  }

  @Get('drama-tags')
  async listDramaTags() {
    return ok(await this.admin.listDramaTags());
  }

  @Post('drama-tags/rename')
  async renameDramaTag(
    @Body() body: { from?: string; to?: string },
    @Req() req: any,
  ) {
    return ok(
      await this.admin.renameDramaTag(String(body?.from || ''), String(body?.to || ''), getActor(req)),
    );
  }

  @Post('drama-tags/delete')
  async deleteDramaTag(@Body() body: { tag?: string }, @Req() req: any) {
    return ok(await this.admin.deleteDramaTag(String(body?.tag || ''), getActor(req)));
  }
}
