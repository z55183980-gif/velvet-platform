import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentController } from '../src/admin/content.controller';

const GLOBAL_SKIP_METADATA = 'THROTTLER:SKIPglobal';

test('long-running transfer status polling bypasses the global request bucket', () => {
  assert.equal(
    Reflect.getMetadata(
      GLOBAL_SKIP_METADATA,
      ContentController.prototype.ytdlpTransferJob,
    ),
    true,
  );
  assert.equal(
    Reflect.getMetadata(
      GLOBAL_SKIP_METADATA,
      ContentController.prototype.telegramTransferJob,
    ),
    true,
  );
});
