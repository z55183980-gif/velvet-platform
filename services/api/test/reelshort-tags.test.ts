import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMetaFromNextData,
  extractReelshortFixedTagLabels,
} from '../src/admin/online-page-extract.util';

test('ReelShort fixed /tags/ anchors are extracted exactly', () => {
  const html = [
    '<a href="/tags/movie-moods/violent-movies-id">Violent</a>',
    '<a href="/tags/story-regions/usa-movies-id"><span>USA</span></a>',
    '<a href="/movie/not-a-tag">More</a>',
  ].join('');
  assert.deepEqual(extractReelshortFixedTagLabels(html), ['Violent', 'USA']);
});

test('ReelShort fixed tags are attached to default page metadata', () => {
  const html = [
    '<script id="__NEXT_DATA__">',
    JSON.stringify({ props: { pageProps: { data: { book_title: 'Example' } } } }),
    '</script>',
    '<a href="/tags/movie-moods/violent-movies-id">Violent</a>',
    '<a href="/tags/movie-identities/athlete-movies-id">Athlete</a>',
  ].join('');
  const { meta } = extractMetaFromNextData(
    html,
    'https://www.reelshort.com/movie/example-id',
  );
  assert.deepEqual(meta.fixedTagLabels, ['Violent', 'Athlete']);
});
