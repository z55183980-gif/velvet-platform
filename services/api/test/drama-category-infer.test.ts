import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CATEGORY_SLUGS,
  mapGenreLabelToSlug,
  resolveCategorySlugAlias,
  sanitizeCategorySlug,
} from '../src/admin/drama-category-infer.util';

test('resolveCategorySlugAlias maps legacy VI slugs to English', () => {
  assert.equal(resolveCategorySlugAlias('do_thi'), 'urban');
  assert.equal(resolveCategorySlugAlias('ngon_tinh'), 'romance');
  assert.equal(resolveCategorySlugAlias('hanh_dong'), 'action');
  assert.equal(resolveCategorySlugAlias('hai_huoc'), 'comedy');
  assert.equal(resolveCategorySlugAlias('tam_ly'), 'psychological');
  assert.equal(resolveCategorySlugAlias('co_trang'), 'costume');
  assert.equal(resolveCategorySlugAlias('romance'), 'romance');
});

test('sanitizeCategorySlug accepts legacy aliases against EN catalog', () => {
  const allowed = [...DEFAULT_CATEGORY_SLUGS];
  assert.equal(sanitizeCategorySlug('ngon_tinh', allowed), 'romance');
  assert.equal(sanitizeCategorySlug('都市', allowed), 'urban');
  assert.equal(sanitizeCategorySlug('romance', allowed), 'romance');
});

test('mapGenreLabelToSlug keeps VI labels working', () => {
  const allowed = [...DEFAULT_CATEGORY_SLUGS];
  assert.equal(mapGenreLabelToSlug('Ngôn tình', allowed), 'romance');
  assert.equal(mapGenreLabelToSlug('Đô thị', allowed), 'urban');
  assert.equal(mapGenreLabelToSlug('Action', allowed), 'action');
});
