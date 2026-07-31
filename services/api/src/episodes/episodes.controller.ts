import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import { EpisodesService } from './episodes.service';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

class ProgressDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  progressSec!: number;
}

@Controller('v1')
@UseGuards(AuthGuard)
export class EpisodesController {
  constructor(private readonly episodes: EpisodesService) {}

  @Get('episodes/:id/play')
  async play(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.episodes.getPlayUrl(BigInt(id), user.userId));
  }

  @Post('episodes/:id/progress')
  async progress(
    @Param('id') id: string,
    @Body() dto: ProgressDto,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.episodes.reportProgress(user.userId, BigInt(id), dto.progressSec));
  }
}
