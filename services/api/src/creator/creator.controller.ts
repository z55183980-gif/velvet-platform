import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import { CreatorService } from './creator.service';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

class CreateEpisodeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  episodeNumber!: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  isFree?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceVnd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceCredits?: number;

  @IsOptional()
  @IsString()
  hlsUrl?: string;

  @IsOptional()
  @IsString()
  originalUrl?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  transcodeStatus?: string;
}

class SubmitKycDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{9}$|^\d{12}$/, { message: 'cccdNumber phải là 9 hoặc 12 chữ số' })
  cccdNumber!: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^(https?:\/\/|\/api\/v1\/media\/)/i, {
    message: 'cccdFrontUrl phải là https:// hoặc /api/v1/media/',
  })
  cccdFrontUrl!: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^(https?:\/\/|\/api\/v1\/media\/)/i, {
    message: 'cccdBackUrl phải là https:// hoặc /api/v1/media/',
  })
  cccdBackUrl!: string;

  @Transform(({ value }) => value === true || value === 'true' || value === 1)
  @IsBoolean()
  faceVerified!: boolean;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  taxCode!: string;

  @IsNotEmpty()
  bankAccount!: string | Record<string, unknown>;
}

class CreateDramaDto {
  @IsNotEmpty()
  @IsString()
  titleVi!: string;

  @IsOptional()
  @IsString()
  titleZh?: string;

  @IsOptional()
  @IsString()
  descriptionVi?: string;

  @IsOptional()
  @IsString()
  descriptionZh?: string;

  @IsNotEmpty()
  @IsString()
  categorySlug!: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  freeEpisodeCount?: number;
}

class UpdateDramaDto {
  @IsOptional()
  @IsString()
  titleVi?: string;

  @IsOptional()
  @IsString()
  titleZh?: string;

  @IsOptional()
  @IsString()
  descriptionVi?: string;

  @IsOptional()
  @IsString()
  descriptionZh?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  freeEpisodeCount?: number;
}

@Controller('v1/creator')
@UseGuards(AuthGuard)
export class CreatorController {
  constructor(private readonly creator: CreatorService) {}

  @Get('dashboard')
  async dashboard(@CurrentUser() user: AuthUser) {
    return ok(await this.creator.getDashboard(user.userId));
  }

  @Get('earnings')
  async earnings(@CurrentUser() user: AuthUser, @Query('page') page?: string) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    return ok(await this.creator.getEarnings(user.userId, p));
  }

  /** 按日聚合收益；支持 from&to 或 days */
  @Get('earnings/daily')
  async dailyEarnings(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('days') days?: string,
  ) {
    const n = days != null ? Math.min(180, Math.max(1, parseInt(days, 10) || 30)) : undefined;
    return ok(
      await this.creator.getDailyEarnings(user.userId, {
        from,
        to,
        days: from || to ? undefined : n ?? 30,
      }),
    );
  }

  @Get('earnings/orders')
  async earningsOrders(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    return ok(
      await this.creator.getEarningsOrders(user.userId, { from, to, page: p }),
    );
  }

  @Get('withdraws')
  async withdraws(@CurrentUser() user: AuthUser, @Query('page') page?: string) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    return ok(await this.creator.listWithdraws(user.userId, p));
  }

  @Post('withdraws')
  async createWithdraw(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return ok(await this.creator.createWithdraw(user.userId, dto.amountVnd, dto.bankInfo));
  }

  @Get('dramas')
  async myDramas(@CurrentUser() user: AuthUser) {
    return ok(await this.creator.listMyDramas(user.userId));
  }

  @Post('dramas')
  async createDrama(@Body() dto: CreateDramaDto, @CurrentUser() user: AuthUser) {
    return ok(await this.creator.createDrama(user.userId, dto));
  }

  @Patch('dramas/:id')
  async updateDrama(
    @Param('id') id: string,
    @Body() dto: UpdateDramaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.creator.updateDrama(user.userId, id, dto));
  }

  @Delete('dramas/:id')
  async deleteDrama(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.creator.deleteDrama(user.userId, id));
  }

  @Post('dramas/:id/offline')
  async offlineDrama(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.creator.offlineDrama(user.userId, id));
  }

  @Post('dramas/:id/submit-review')
  async submitReview(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.creator.submitReview(user.userId, id));
  }

  @Post('dramas/:id/episodes')
  async createEpisode(
    @Param('id') id: string,
    @Body() dto: CreateEpisodeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.creator.createEpisode(user.userId, { ...dto, dramaId: id }));
  }

  @Delete('episodes/:id')
  async deleteEpisode(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.creator.deleteEpisode(user.userId, id));
  }

  @Get('kyc/status')
  async kycStatus(@CurrentUser() user: AuthUser) {
    return ok(await this.creator.getKycStatus(user.userId));
  }

  @Post('kyc/submit')
  async submitKyc(@Body() dto: SubmitKycDto, @CurrentUser() user: AuthUser) {
    return ok(await this.creator.submitKyc(user.userId, dto));
  }
}
