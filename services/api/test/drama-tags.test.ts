import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDramaSystemTag,
  mergeDramaSourceTags,
  toPublicDramaTags,
} from '../src/dramas/drama-tags';

test('strips member-facing operational tags regardless of case', () => {
  const tags = [
    'Romance',
    'DEMO',
    'Online',
    'LOCAL',
    'type:vertical',
    'Status:published',
    'source:manual',
    'completion:complete',
    'ytdlp:youtube',
  ];

  assert.deepEqual(toPublicDramaTags(tags), ['Romance']);
});

test('keeps display labels and deduplicates them case-insensitively', () => {
  assert.deepEqual(toPublicDramaTags(['Romance', ' romance ', '悬疑', '悬疑']), [
    'Romance',
    '悬疑',
  ]);
});

test('treats blank and workflow metadata as system tags', () => {
  for (const tag of ['', ' ', 'workflow:review', 'visibility:public', 'orientation:portrait']) {
    assert.equal(isDramaSystemTag(tag), true);
  }
  assert.equal(isDramaSystemTag('Comedy'), false);
});

test('limits member-facing drama labels to six', () => {
  const labels = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
  assert.deepEqual(toPublicDramaTags(labels), labels.slice(0, 6));
  assert.deepEqual(
    mergeDramaSourceTags(['upload'], [...labels, 'type:真人短剧']),
    ['upload', ...labels.slice(0, 6), 'type:真人短剧'],
  );
});
