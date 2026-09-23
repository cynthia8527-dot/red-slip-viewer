export const PENDING_PRODUCT_PHOTOS = 'factory-calculator:pending-product-photos';

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
  storage.setItem(PENDING_PRODUCT_PHOTOS, JSON.stringify([...jobs, job]));
}

export function forgetProductPhoto(storage, path) {
  const remaining = read(storage).filter(job => job?.path !== path);
  if (remaining.length) storage.setItem(PENDING_PRODUCT_PHOTOS, JSON.stringify(remaining));
  else storage.removeItem(PENDING_PRODUCT_PHOTOS);
}

// Only a confirmed missing object or a completed link may be forgotten.
// Network and server errors retain the job for the next page load.
export async function recoverProductPhotos(storage, userId, attach) {
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
      if (error?.status === 409 && /uploaded photo object not found/.test(error.message || '')) {
        forgetProductPhoto(storage, job.path);
        result.missing++;
      } else result.pending++;
    }
  }
  return result;
}
