import { randomUUID } from 'node:crypto';

// Do not equate a generic 400/404, missing bucket, or access failure with a missing object.
export function storageObjectPresent({ status, data }) {
  if (status === 200) return true;
  if ([400, 404].includes(status) && (data?.code === 'NoSuchKey' ||
      (!data?.code && String(data?.statusCode) === '404' &&
       data?.error === 'not_found' && data?.message === 'Object not found'))) return false;
  throw new Error(`Storage object inspection HTTP ${status}; code=${data?.code || 'unknown'}`);
}

export function createStorageProbe(request, bucket, {
  delays = [0, 250, 500, 1000, 2000, 4000],
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const inspect = async (path, token, info = false) => storageObjectPresent(await request(
    `/storage/v1/object/${info ? 'info/' : ''}${bucket}/${path}?probe=${randomUUID()}`, { token }));
  return {
    // A successful metadata lookup alone does not prove that the image can be read.
    isPresent: (path, token) => inspect(path, token),
    async waitForAbsent(path, token) {
      for (const delay of delays) {
        if (delay) await sleep(delay);
        // Check both metadata and actual bytes. Persistent presence remains a failure.
        const metadata = await inspect(path, token, true);
        const downloadable = await inspect(path, token);
        if (!metadata && !downloadable) return true;
      }
      throw new Error('Storage object still present after bounded cleanup verification');
    },
  };
}
