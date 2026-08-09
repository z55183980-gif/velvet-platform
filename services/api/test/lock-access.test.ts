import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEpisodeFreeByPolicy,
  resolveInheritedFreeCount,
} from '../src/common/lock-access.service';

test('isEpisodeFreeByPolicy: FREE_FIRST_N uses freeCount, not episode.isFree', () => {
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: true,
      episodeNumber: 4,
      mode: 'FREE_FIRST_N',
      freeEpisodeCount: 3,
    }),
    false,
  );
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: false,
      episodeNumber: 3,
      mode: 'FREE_FIRST_N',
      freeEpisodeCount: 3,
    }),
    true,
  );
});

test('isEpisodeFreeByPolicy: ALL_FREE / VIP_ALL ignore freeCount', () => {
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: false,
      episodeNumber: 99,
      mode: 'ALL_FREE',
      freeEpisodeCount: 0,
    }),
    true,
  );
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: true,
      episodeNumber: 1,
      mode: 'VIP_ALL',
      freeEpisodeCount: 46,
    }),
    false,
  );
});

test('resolveInheritedFreeCount: Follow Global uses global freeCount', () => {
  // Stale stamp from prior ALL_FREE (total episodes) must not win when inheriting.
  assert.equal(
    resolveInheritedFreeCount({
      inherited: true,
      dramaFreeEpisodeCount: 46,
      globalFreeCount: 3,
    }),
    3,
  );
  assert.equal(
    resolveInheritedFreeCount({
      inherited: false,
      dramaFreeEpisodeCount: 46,
      globalFreeCount: 3,
    }),
    46,
  );
});

test('inheritance + FREE_FIRST_N: only first N free when drama stamped total', () => {
  const freeCount = resolveInheritedFreeCount({
    inherited: true,
    dramaFreeEpisodeCount: 46,
    globalFreeCount: 3,
  });
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: true,
      episodeNumber: 1,
      mode: 'FREE_FIRST_N',
      freeEpisodeCount: freeCount,
    }),
    true,
  );
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: true,
      episodeNumber: 46,
      mode: 'FREE_FIRST_N',
      freeEpisodeCount: freeCount,
    }),
    false,
  );
});

test('ALL_FREE keeps late appends free even when freeCount stamp is 0', () => {
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: false,
      episodeNumber: 100,
      mode: 'ALL_FREE',
      freeEpisodeCount: 0,
    }),
    true,
  );
});

test('inherit ALL_FREE: mode wins over stale FREE_FIRST_N freeCount stamp', () => {
  // Runtime resolve uses global mode ALL_FREE; freeCount stamp may be 0 or old N.
  const freeCount = resolveInheritedFreeCount({
    inherited: true,
    dramaFreeEpisodeCount: 3,
    globalFreeCount: 0,
  });
  assert.equal(freeCount, 0);
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: false,
      episodeNumber: 50,
      mode: 'ALL_FREE',
      freeEpisodeCount: freeCount,
    }),
    true,
  );
});

test('inherit FREE_FIRST_N: appended episode beyond N is paid', () => {
  const freeCount = resolveInheritedFreeCount({
    inherited: true,
    dramaFreeEpisodeCount: 999,
    globalFreeCount: 3,
  });
  assert.equal(
    isEpisodeFreeByPolicy({
      episodeIsFree: true,
      episodeNumber: 4,
      mode: 'FREE_FIRST_N',
      freeEpisodeCount: freeCount,
    }),
    false,
  );
});
