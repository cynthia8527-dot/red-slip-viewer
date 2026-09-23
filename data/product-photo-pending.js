export const PENDING_PRODUCT_PHOTOS = 'factory-calculator:pending-product-photos';
// A Storage upload can finish after a page reload and an early missing-object check.
export const PRODUCT_PHOTO_UPLOAD_GRACE_MS = 2 * 60 * 1000;

function read(storage) {
  try {
    const value = JSON.parse(storage.getItem(PENDING_PRODUCT_PHOTOS) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function pendingProductPhotos(storage, userId) {
  return read(storage).filter(job => job?.userId === userId);
}

export function rememberProductPhoto(storage, job) {
  const jobs = read(storage);
  if (jobs.some(item => item.path === job.path)) return;
  if (jobs.length >= 20) throw new Error('照片待處理清單已滿，請先重新開啟此頁完成照片關聯');
  storage.setItem(PENDING_PRODUCT_PHOTOS, JSON.stringify([...jobs, { ...job, createdAt: Date.now() }]));
}

export function forgetProductPhoto(storage, path) {
  const remaining = read(storage).filter(job => job?.path !== path);
  if (remaining.length) storage.setItem(PENDING_PRODUCT_PHOTOS, JSON.stringify(remaining));
  else storage.removeItem(PENDING_PRODUCT_PHOTOS);
}

// A recent missing-object response can race with an upload still finishing.
// Network and server errors retain the job for the next page load.
export async function recoverProductPhotos(storage, userId, attach, now = Date.now()) {
  const result = { completed: 0, missing: 0, pending: 0 };
  for (const job of pendingProductPhotos(storage, userId)) {
    try {
      const linked = await attach(job);
      if (linked?.previous_cleanup_pending) result.pending++;
      else {
        forgetProductPhoto(storage, job.path);
        result.completed++;
      }
    } catch (error) {
      const recentUpload = Number.isFinite(job.createdAt) &&
        now - job.createdAt < PRODUCT_PHOTO_UPLOAD_GRACE_MS;
      if (error?.status === 409 && /uploaded photo object not found/.test(error.message || '') && !recentUpload) {
        forgetProductPhoto(storage, job.path);
        result.missing++;
      } else result.pending++;
    }
  }
  return result;
}
