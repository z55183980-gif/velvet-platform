import test from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors MediaController private-doc ACL for avatar paths. */
function needsMediaSignature(posixRel: string, isVideoExt: boolean): boolean {
  const isLegacyPublicAvatar = /^docs\/avatar-[^/]+$/i.test(posixRel);
  const isPrivateDoc =
    !isLegacyPublicAvatar &&
    (posixRel === 'docs' || posixRel.startsWith('docs/'));
  return isVideoExt || isPrivateDoc;
}

test('legacy docs/avatar-* paths are public (no signature)', () => {
  assert.equal(needsMediaSignature('docs/avatar-123.webp', false), false);
  assert.equal(needsMediaSignature('covers/avatar-123.webp', false), false);
});

test('KYC docs remain signature-gated', () => {
  assert.equal(needsMediaSignature('docs/cccd-front-1.jpg', false), true);
  assert.equal(needsMediaSignature('docs/secret.pdf', false), true);
});
