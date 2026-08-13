import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReelshortDramaCatalog,
  extractMetaFromNextData,
  extractReelshortFixedTagLabels,
  isReelshortCatalogUrl,
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

test('ReelShort update_status 1 maps to completed', () => {
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { data: { book_title: 'Complete', update_status: 1 } } },
  })}</script>`;
  const { meta } = extractMetaFromNextData(
    html,
    'https://www.reelshort.com/movie/complete-635a3436503d9c47e1014621',
  );
  assert.equal(meta.completion, '已完结');
});

test('ReelShort non-1 update_status maps to ongoing', () => {
  for (const updateStatus of [0, 2, null, '']) {
    const html = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: {
        pageProps: { data: { book_title: 'Ongoing', update_status: updateStatus } },
      },
    })}</script>`;
    const { meta } = extractMetaFromNextData(
      html,
      'https://www.reelshort.com/movie/ongoing-635a3436503d9c47e1014621',
    );
    assert.equal(meta.completion, '连载中');
  }
});

test('ReelShort missing update_status defaults to ongoing', () => {
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { data: { book_title: 'No status' } } },
  })}</script>`;
  const { meta } = extractMetaFromNextData(
    html,
    'https://www.reelshort.com/movie/no-status-635a3436503d9c47e1014621',
  );
  assert.equal(meta.completion, '连载中');
});

test('ReelShort /tags/ pages are identified without matching drama pages', () => {
  assert.equal(
    isReelshortCatalogUrl('https://www.reelshort.com/tags/story-beats'),
    true,
  );
  assert.equal(
    isReelshortCatalogUrl('https://www.reelshort.com/tags/story-beats/2'),
    true,
  );
  assert.equal(
    isReelshortCatalogUrl('https://www.reelshort.com/movie/example-id'),
    false,
  );
});

test('ReelShort catalog parser returns independent selectable dramas and paging', () => {
  const bookId = '635a3436503d9c47e1014621';
  const html = [
    '<script id="__NEXT_DATA__">',
    JSON.stringify({
      props: {
        pageProps: {
          path: 'story-beats',
          page: 1,
          total: 3455,
          totalPage: 346,
          prevPageLink: '',
          nextPageLink: 'https://www.reelshort.com/tags/story-beats/2',
          tagBooks: {
            tag_name: '',
            books: [
              {
                book_id: bookId,
                book_title: "Son in Law's Revenge",
                book_pic: 'https://img.example/cover.jpg',
                special_desc: 'A revenge story.',
                chapter_count: 55,
                update_status: 1,
              },
            ],
          },
        },
      },
    }),
    '</script>',
    `<a href="/movie/son-in-law-s-revenge-${bookId}">Son in Law's Revenge</a>`,
  ].join('');

  const catalog = extractReelshortDramaCatalog(
    html,
    'https://www.reelshort.com/tags/story-beats',
  );
  assert.ok(catalog);
  assert.equal(catalog.title, 'Story Beats');
  assert.equal(catalog.page, 1);
  assert.equal(catalog.totalPages, 346);
  assert.equal(catalog.nextPageUrl, 'https://www.reelshort.com/tags/story-beats/2');
  assert.deepEqual(catalog.items, [
    {
      id: bookId,
      title: "Son in Law's Revenge",
      webpageUrl: `https://www.reelshort.com/movie/son-in-law-s-revenge-${bookId}`,
      coverUrl: 'https://img.example/cover.jpg',
      description: 'A revenge story.',
      chapterCount: 55,
      completion: '已完结',
    },
  ]);
});
