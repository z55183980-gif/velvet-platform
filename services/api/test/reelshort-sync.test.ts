import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reelshortBookIdFromUrl,
  reelshortExternalRefFor,
} from '../src/admin/reelshort-sync.util';

test('ReelShort movie URLs map to distinct book-based external refs', () => {
  const first = reelshortExternalRefFor(
    'https://www.reelshort.com/movie/we-re-your-parents-68e9aa284838ef5d700ef20a',
  );
  const second = reelshortExternalRefFor(
    'https://www.reelshort.com/movie/son-in-law-s-revenge-635a3436503d9c47e1014621',
  );

  assert.equal(first, 'ytdlp:html:reelshort_68e9aa284838ef5d700ef20a');
  assert.equal(second, 'ytdlp:html:reelshort_635a3436503d9c47e1014621');
  assert.notEqual(first, second);
});

test('ReelShort episode URLs resolve to the parent drama book id', () => {
  const url =
    'https://www.reelshort.com/episodes/episode-1-we-re-your-parents-68e9aa284838ef5d700ef20a-bbxjli84ai';
  assert.equal(reelshortBookIdFromUrl(url), '68e9aa284838ef5d700ef20a');
  assert.equal(
    reelshortExternalRefFor(url),
    'ytdlp:html:reelshort_68e9aa284838ef5d700ef20a',
  );
});

test('catalog book id hint is preferred and URL fallback hashes the full identity', () => {
  assert.equal(
    reelshortExternalRefFor(
      'https://www.reelshort.com/movie/title-without-id',
      '635A3436503D9C47E1014621',
    ),
    'ytdlp:html:reelshort_635a3436503d9c47e1014621',
  );
  assert.notEqual(
    reelshortExternalRefFor('https://www.reelshort.com/movie/alpha'),
    reelshortExternalRefFor('https://www.reelshort.com/movie/beta'),
  );
});
