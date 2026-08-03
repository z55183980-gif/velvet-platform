import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { memoryStorage } from 'multer';
import { BizCode, BizException } from '../common/biz.exception';
import { ok } from '../common/response';
import { AdminRoleGuard, AdminRoles } from './admin-role.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { ContentService } from './content.service';
import { AdminEpisodesService } from './episodes.service';
import { AdminOpsService } from './ops.service';

function getActor(req: any): bigint | undefined {
  return req?.adminId as bigint | undefined;
}

class ReasonDto {
  @IsOptional() @IsString() reason?: string;
}

class LocalImportDto {
  @IsOptional() @IsString() rootPath?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  dryRun?: boolean;
}

class BannerDto {
  @IsNotEmpty() @IsString() titleVi!: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsNotEmpty() @IsString() imageUrl!: string;
  @IsOptional() @IsString() linkUrl?: string;
  @IsOptional() @IsString() dramaId?: string;
  @IsNotEmpty() @IsString() startAt!: string;
  @IsNotEmpty() @IsString() endAt!: string;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isActive?: boolean;
}

class CategoryDto {
  @IsNotEmpty() @IsString() slug!: string;
  @IsNotEmpty() @IsString() nameVi!: string;
  @IsNotEmpty() @IsString() nameZh!: string;
  @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isActive?: boolean;
}

class DramaUpdateDto {
  @IsOptional() @IsString() titleVi?: string;
  @IsOptional() @IsString() titleZh?: string;
  @IsOptional() @IsString() descriptionVi?: string;
  @IsOptional() @IsString() descriptionZh?: string;
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @Type(() => Number) @IsNumber() freeEpisodeCount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() sortWeight?: number;
  @IsOptional() buyoutCredits?: number | string | null;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isFeatured?: boolean;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isOfficial?: boolean;
}

class BatchDramasDto {
  @IsNotEmpty() ids!: (string | number)[];
  @IsOptional() @Type(() => Number) @IsNumber() freeEpisodeCount?: number;
  @IsOptional() priceCredits?: number | string;
  @IsOptional() buyoutCredits?: number | string | null;
}

class EpisodeUpdateDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isFree?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceCredits?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) priceVnd?: number;
  @IsOptional() @IsString() thumbnailUrl?: string;
  @IsOptional() @IsString() transcodeStatus?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

class ReorderDto {
  @IsNotEmpty() ids!: string[];
}

@Controller('v1/admin')
@UseGuards(AdminGuard, AdminRoleGuard)
export class ContentController {
  constructor(
    private readonly admin: AdminService,
    private readonly content: ContentService,
    private readonly episodes: AdminEpisodesService,
    private readonly ops: AdminOpsService,
  ) {}

  @Get('dramas')
  async listDramas(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('categorySlug') categorySlug?: string,
    @Query('isOfficial') isOfficial?: string,
    @Query('isFeatured') isFeatured?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(await this.content.list({
      q,
      status: (status as any) || 'ALL',
      categorySlug,
      isOfficial: isOfficial as any,
      isFeatured: isFeatured as any,
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

  @Patch('dramas/batch')
  @AdminRoles('SUPER_ADMIN')
  async batchDramas(@Body() dto: BatchDramasDto, @Req() req: any) {
    return ok(await this.ops.batchUpdateDramas(dto, getActor(req)));
  }

  @Get('dramas/:id')
  async getDrama(@Param('id') id: string) {
    return ok(await this.content.detail(id));
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

  @Post('dramas/:id/delete')
  async deleteDrama(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return ok(await this.admin.deleteDrama(id, dto.reason, getActor(req)));
  }

  @Get('dramas/:id/episodes')
  async dramaEpisodes(@Param('id') id: string) {
    return ok(await this.episodes.listByDrama(id));
  }

  @Post('episodes/:id/update')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async updateEpisode(@Param('id') id: string, @Body() dto: EpisodeUpdateDto, @Req() req: any) {
    return ok(await this.episodes.update(id, dto as any, getActor(req)));
  }

  @Post('dramas/:id/episodes/reorder')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async reorderEpisodes(@Param('id') id: string, @Body() dto: ReorderDto, @Req() req: any) {
    return ok(await this.episodes.reorder(id, dto.ids, getActor(req)));
  }

  @Post('episodes/:id/transcode-retry')
  @AdminRoles('SUPER_ADMIN', 'OPS')
  async retryTranscode(@Param('id') id: string, @Req() req: any) {
    return ok(await this.episodes.retryTranscode(id, getActor(req)));
  }

  @Post('import/local')
  async importLocal(@Body() dto: LocalImportDto) {
    return ok(await this.admin.importLocal({ rootPath: dto.rootPath, dryRun: dto.dryRun }));
  }

  @Post('import/upload')
  @UseInterceptors(FilesInterceptor('files', 200, {
    storage: memoryStorage(),
    limits: { fileSize: 512 * 1024 * 1024, files: 200 },
  }))
  async importUpload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { relativePaths?: string | string[]; dryRun?: string | boolean },
  ) {
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
    return ok(await this.admin.importUploadedFiles(files, relativePaths, dryRun));
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
}
