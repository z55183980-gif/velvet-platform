import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSingleByteRange } from '../src/common/http-range.util';

test('parses explicit and open-ended byte ranges', () => {
  assert.deepEqual(parseSingleByteRange('bytes=10-19', 100), {
    kind: 'range',
    start: 10,
    end: 19,
  });
  assert.deepEqual(parseSingleByteRange('bytes=90-', 100), {
    kind: 'range',
    start: 90,
    end: 99,
  });
});

test('suffix ranges return the final bytes', () => {
  assert.deepEqual(parseSingleByteRange('bytes=-20', 100), {
    kind: 'range',
    start: 80,
    end: 99,
  });
  assert.deepEqual(parseSingleByteRange('bytes=-200', 100), {
    kind: 'range',
    start: 0,
    end: 99,
  });
});

test('rejects malformed, multiple, reversed, and out-of-bounds ranges', () => {
  for (const value of ['bytes=-0', 'bytes=20-10', 'bytes=100-', 'bytes=0-1,3-4', 'items=0-2']) {
    assert.deepEqual(parseSingleByteRange(value, 100), { kind: 'invalid' });
  }
});
