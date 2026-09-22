import { readFileSync } from 'node:fs';

const testProject = 'zfcsuxihpakrsohvcwlr';
const mainBucketCall = "admin.storage.from('factory-photos').remove(paths)";
const testBucketCall = "admin.storage.from('factory-photos-test').remove(paths)";

// Build the test deployment from the tracked function source. Never deploy
// this result to the main project, and never mutate the reference snapshot.
export function buildTestShipmentsSource(projectId) {
  if (projectId !== testProject) throw new Error('Only the dedicated test project is allowed');
  const original = readFileSync(new URL('../../supabase/functions/shipments/index.ts', import.meta.url), 'utf8');
  if (original.split(mainBucketCall).length !== 2 || original.includes(testBucketCall)) {
    throw new Error('Unexpected shipments source: review the bucket mapping before deployment');
  }
  return original.replace(mainBucketCall, testBucketCall);
}
