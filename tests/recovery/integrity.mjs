import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyArchive(manifest, dump, photos) {
  assert.equal(digest(dump),manifest.dump,'database archive checksum');
  assert.deepEqual([...photos.keys()].sort(),Object.keys(manifest.photos).sort(),'photo inventory');
  for(const [path,hash] of Object.entries(manifest.photos)) assert.equal(digest(photos.get(path)),hash,'photo checksum');
}
