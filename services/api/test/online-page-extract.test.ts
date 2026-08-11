import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMetaFromNextData } from '../src/admin/online-page-extract.util';

test('NetShort RSC extract emits episode pages and records first locked episode', () => {
  const detail = {
    shortPlayDetailVo: {
      shortPlayName: 'Example Drama',
      shortPlayUrl: '/episode/example-drama-2084484326627127298',
      shortPlayCover: 'https://awscover.netshort.com/example.webp',
      shotIntroduce: 'Example synopsis',
      shortPlayLabels: { Revenge: '/drama/revenge' },
      videoEpisodeInfos: [
        { episodeNo: 1, isLock: false },
        { episodeNo: 2, isLock: true },
        { episodeNo: 3, isLock: true },
      ],
    },
  };
  const { meta, episodes } = extractMetaFromNextData(
    `<script>${JSON.stringify(detail)}</script>`,
    'https://netshort.com/episode/example-drama-2084484326627127298',
  );

  assert.equal(meta.title, 'Example Drama');
  assert.equal(meta.chapterCount, 3);
  assert.equal(meta.paidStart, 2);
  assert.deepEqual(meta.genreLabels, ['Revenge']);
  assert.deepEqual(
    episodes.map((episode) => [episode.episodeNumber, episode.sourceUrl]),
    [
      [
        1,
        'https://netshort.com/episode/example-drama-2084484326627127298',
      ],
      [
        2,
        'https://netshort.com/episode/example-drama-2084484326627127298-ep-2',
      ],
      [
        3,
        'https://netshort.com/episode/example-drama-2084484326627127298-ep-3',
      ],
    ],
  );
});
