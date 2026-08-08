import { Injectable } from '@nestjs/common';
import { DramaLockMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type LockAccessMode = DramaLockMode;

export const LOCK_ACCESS_MODES: LockAccessMode[] = ['FREE_FIRST_N', 'VIP_ALL', 'ALL_FREE'];

export function isLockAccessMode(v: unknown): v is LockAccessMode {
  return typeof v === 'string' && (LOCK_ACCESS_MODES as string[]).includes(v);
}

/** Pure free-check under an already-resolved policy.
 * Drama lockMode is authoritative; episode.isFree is denormalized cache for admin UI. */
export function isEpisodeFreeByPolicy(opts: {
  episodeIsFree: boolean;
  episodeNumber: number;
  mode: LockAccessMode;
  freeEpisodeCount: number;
}): boolean {
  if (opts.mode === 'ALL_FREE') return true;
  if (opts.mode === 'VIP_ALL') return false;
  // FREE_FIRST_N — do not let stale episode.isFree unlock paid episodes
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

  /**
   * Sync denormalized episode.isFree / prices from drama lock policy.
   * Call whenever lockMode or freeEpisodeCount changes.
   */
  async syncEpisodeAccessFlags(
    dramaId: bigint,
    opts?: { paidCredits?: bigint; paidVnd?: bigint },
  ): Promise<number> {
    const drama = await this.prisma.drama.findUnique({
      where: { id: dramaId },
      select: { lockMode: true, freeEpisodeCount: true },
    });
    if (!drama) return 0;
    const policy = await this.resolveForDrama(drama);
    const episodes = await this.prisma.episode.findMany({
      where: { dramaId },
      select: {
        id: true,
        episodeNumber: true,
        isFree: true,
        priceCredits: true,
        priceVnd: true,
      },
      orderBy: { episodeNumber: 'asc' },
    });
    if (!episodes.length) return 0;

    let paidCredits = opts?.paidCredits;
    let paidVnd = opts?.paidVnd;
    if (paidCredits == null || paidVnd == null) {
      const paidSample = episodes.find((e) => !e.isFree && e.priceCredits > 0n);
      paidCredits = paidCredits ?? (paidSample?.priceCredits && paidSample.priceCredits > 0n
        ? paidSample.priceCredits
        : 10n);
      paidVnd = paidVnd ?? (paidSample?.priceVnd && paidSample.priceVnd > 0n
        ? paidSample.priceVnd
        : paidCredits);
    }

    let updated = 0;
    for (const ep of episodes) {
      const shouldFree = isEpisodeFreeByPolicy({
        episodeIsFree: false,
        episodeNumber: ep.episodeNumber,
        mode: policy.mode,
        freeEpisodeCount: policy.freeCount,
      });
      const nextCredits = shouldFree ? 0n : paidCredits;
      const nextVnd = shouldFree ? 0n : paidVnd;
      if (
        ep.isFree === shouldFree &&
        ep.priceCredits === nextCredits &&
        ep.priceVnd === nextVnd
      ) {
        continue;
      }
      await this.prisma.episode.update({
        where: { id: ep.id },
        data: {
          isFree: shouldFree,
          priceCredits: nextCredits,
          priceVnd: nextVnd,
          ...(shouldFree ? { previewSeconds: 0 } : {}),
        },
      });
      updated += 1;
    }
    return updated;
  }
}
