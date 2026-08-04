import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ok } from '../common/response';
import { UsersService } from './users.service';
import { UploadService } from '../upload/upload.service';
import { PrismaService } from '../prisma/prisma.service';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  nickname?: string;
  @IsOptional()
  @IsString()
  avatarUrl?: string;
  @IsOptional()
  @IsString()
  locale?: string;
}

class UpdateLocaleDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['en', 'zh', 'fr'])
  locale!: string;
}

class AddFavDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class UpdateFavDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  group?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@Controller('v1')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly upload: UploadService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('users/me')
  async me(@CurrentUser() user: AuthUser) {
    return ok(await this.users.getMe(user.userId));
  }

  @Patch('users/me')
  async updateMe(@Body() dto: UpdateMeDto, @CurrentUser() user: AuthUser) {
    return ok(await this.users.updateMe(user.userId, dto));
  }

  @Patch('users/me/locale')
  async updateLocale(@Body() dto: UpdateLocaleDto, @CurrentUser() user: AuthUser) {
    return ok(await this.users.updateMe(user.userId, { locale: dto.locale }));
  }

  /** 用户头像上传（jpg/png/webp，2MB） */
  @Post('users/me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(okMime ? null : new Error(`mime không hợp lệ: ${file.mimetype}`), okMime);
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

  @Get('users/me/favorites')
  async favorites(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('group') group?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    return ok(await this.users.listFavorites(user.userId, p, undefined, group));
  }

  @Get('users/me/favorites/groups')
  async favGroups(@CurrentUser() user: AuthUser) {
    return ok(await this.users.listFavoriteGroups(user.userId));
  }

  @Get('users/me/favorites/:dramaId')
  async favStatus(@Param('dramaId') dramaId: string, @CurrentUser() user: AuthUser) {
    return ok(await this.users.isFavorited(user.userId, dramaId));
  }

  @Post('users/me/favorites/:dramaId')
  async addFav(
    @Param('dramaId') dramaId: string,
    @Body() dto: AddFavDto,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.users.addFavorite(user.userId, dramaId, dto));
  }

  @Patch('users/me/favorites/:dramaId')
  async updateFav(
    @Param('dramaId') dramaId: string,
    @Body() dto: UpdateFavDto,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.users.updateFavorite(user.userId, dramaId, dto));
  }

  @Delete('users/me/favorites/:dramaId')
  async delFav(@Param('dramaId') dramaId: string, @CurrentUser() user: AuthUser) {
    return ok(await this.users.removeFavorite(user.userId, dramaId));
  }

  @Get('users/me/likes')
  async likes(@CurrentUser() user: AuthUser, @Query('page') page?: string) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    return ok(await this.users.listLikes(user.userId, p));
  }

  @Get('users/me/likes/:dramaId')
  async likeStatus(@Param('dramaId') dramaId: string, @CurrentUser() user: AuthUser) {
    return ok(await this.users.isLiked(user.userId, dramaId));
  }

  @Post('users/me/likes/:dramaId')
  async addLike(@Param('dramaId') dramaId: string, @CurrentUser() user: AuthUser) {
    return ok(await this.users.addLike(user.userId, dramaId));
  }

  @Delete('users/me/likes/:dramaId')
  async delLike(@Param('dramaId') dramaId: string, @CurrentUser() user: AuthUser) {
    return ok(await this.users.removeLike(user.userId, dramaId));
  }

  @Get('users/me/history')
  async history(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('dramaId') dramaId?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    return ok(await this.users.listHistory(user.userId, p, undefined, dramaId));
  }

  @Delete('users/me/history')
  async clearHistory(@CurrentUser() user: AuthUser) {
    return ok(await this.users.clearHistory(user.userId));
  }
}
