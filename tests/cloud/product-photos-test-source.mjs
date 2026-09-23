import { readFileSync } from 'node:fs';

const testProject = 'zfcsuxihpakrsohvcwlr';
const mainBucketCall = "admin.storage.from('factory-photos')";
const testBucketCall = "admin.storage.from('factory-photos-test')";

export function buildTestProductPhotosSource(projectId) {
  if (projectId !== testProject) throw new Error('Only the dedicated test project is allowed');
  const original = readFileSync(new URL('../../supabase/functions/product-photos/index.ts', import.meta.url), 'utf8');
  if (original.split(mainBucketCall).length !== 3 || original.includes(testBucketCall)) {
    throw new Error('Unexpected product-photos source: review the bucket mapping before deployment');
  }
  return original.replaceAll(mainBucketCall, testBucketCall);
}
