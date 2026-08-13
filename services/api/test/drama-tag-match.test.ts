import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapLabelToClosestTag,
  mapLabelsToExistingTags,
  scoreLabelAgainstTag,
  type DramaTagCatalogEntry,
} from '../src/admin/drama-tag-match.util';

const CATALOG: DramaTagCatalogEntry[] = [
  { key: 'Romance', nameEn: 'Romance', nameZh: '言情', nameFr: 'Romance' },
  { key: 'Urban', nameEn: 'Urban', nameZh: '都市', nameFr: null },
  { key: 'Action', nameEn: 'Action', nameZh: '动作', nameFr: 'Action' },
  { key: 'Comedy', nameEn: 'Comedy', nameZh: '喜剧', nameFr: 'Comédie' },
  { key: 'Costume', nameEn: 'Costume', nameZh: '古装', nameFr: null },
];

test('exact key / localized name match', () => {
  assert.equal(mapLabelToClosestTag('romance', CATALOG)?.key, 'Romance');
  assert.equal(mapLabelToClosestTag('言情', CATALOG)?.key, 'Romance');
  assert.equal(mapLabelToClosestTag('都市', CATALOG)?.key, 'Urban');
  assert.equal(mapLabelToClosestTag('Comédie', CATALOG)?.key, 'Comedy');
});

test('closest fuzzy English match', () => {
  assert.equal(mapLabelToClosestTag('romantic', CATALOG)?.key, 'Romance');
  assert.equal(mapLabelToClosestTag('CEO Romance drama', CATALOG)?.key, 'Romance');
  assert.ok((scoreLabelAgainstTag('romantic', CATALOG[0]) ?? 0) >= 0.62);
});

test('legacy VI / alias resolves onto catalog', () => {
  assert.equal(mapLabelToClosestTag('ngôn tình', CATALOG)?.key, 'Romance');
  assert.equal(mapLabelToClosestTag('do_thi', CATALOG)?.key, 'Urban');
  assert.equal(mapLabelToClosestTag('cổ trang', CATALOG)?.key, 'Costume');
});

test('unmatched labels are dropped', () => {
  assert.equal(mapLabelToClosestTag('totally-unknown-xyz', CATALOG), null);
  assert.deepEqual(
    mapLabelsToExistingTags(['Romance', 'xyz-nope', 'Action', '???'], CATALOG),
    ['Romance', 'Action'],
  );
});

test('dedupes when several source labels collapse to one key', () => {
  assert.deepEqual(
    mapLabelsToExistingTags(['Romance', '言情', 'romantic'], CATALOG),
    ['Romance'],
  );
});

test('empty catalog yields no tags', () => {
  assert.deepEqual(mapLabelsToExistingTags(['Romance'], []), []);
});
