import { Injectable } from '@nestjs/common';
import { DramaLockMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type LockAccessMode = DramaLockMode;

export const LOCK_ACCESS_MODES: LockAccessMode[] = ['FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE'];

export function isLockAccessMode(v: unknown): v is LockAccessMode {
  return typeof v === 'string' && (LOCK_ACCESS_MODES as string[]).includes(v);
}

/** Pure free-check under an already-resolved policy. */
export function isEpisodeFreeByPolicy(opts: {
  episodeIsFree: boolean;
  episodeNumber: number;
  mode: LockAccessMode;
  freeEpisodeCount: number;
}): boolean {
  if (opts.episodeIsFree) return true;
  if (opts.mode === 'ALL_FREE') return true;
  if (opts.mode === 'VIP_ALL') return false;
  return opts.episodeNumber <= Math.max(0, Math.floor(opts.freeEpisodeCount || 0));
}

@Injectable()
export class LockAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getGlobalPolicy(): Promise<{ mode: LockAccessMode; freeCount: number }> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: ['episodeLockMode', 'defaultFreeEpisodes'] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const rawMode = map.get('episodeLockMode');
    const mode = isLockAccessMode(rawMode) ? rawMode : 'FREE_FIRST_N';
    const rawCount = map.get('defaultFreeEpisodes');
    const freeCount = Number.isFinite(Number(rawCount)) ? Math.max(0, Math.floor(Number(rawCount))) : 3;
    return { mode, freeCount };
  }

  async resolveForDrama(drama: {
    lockMode?: LockAccessMode | null;
    freeEpisodeCount: number;
  }): Promise<{
    mode: LockAccessMode;
    freeCount: number;
    inherited: boolean;
    globalMode: LockAccessMode;
    globalFreeCount: number;
  }> {
    const global = await this.getGlobalPolicy();
    const inherited = drama.lockMode == null;
    return {
      mode: drama.lockMode ?? global.mode,
      freeCount: drama.freeEpisodeCount,
      inherited,
      globalMode: global.mode,
      globalFreeCount: global.freeCount,
    };
  }

  isFree(
    episode: { isFree: boolean; episodeNumber: number },
    policy: { mode: LockAccessMode; freeCount: number },
  ) {
    return isEpisodeFreeByPolicy({
      episodeIsFree: episode.isFree,
      episodeNumber: episode.episodeNumber,
      mode: policy.mode,
      freeEpisodeCount: policy.freeCount,
    });
  }
}
