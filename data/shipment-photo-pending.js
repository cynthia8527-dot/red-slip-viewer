export const PENDING_SHIPMENT_PHOTOS = 'factory-board:pending-shipment-photos';
export const SHIPMENT_PHOTO_UPLOAD_GRACE_MS = 2 * 60 * 1000;

function read(storage) {
  try {
    const value = JSON.parse(storage.getItem(PENDING_SHIPMENT_PHOTOS) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function pendingShipmentPhotos(storage, userId) {
  return read(storage).filter(job => job?.userId === userId);
}

export function rememberShipmentPhoto(storage, job) {
  const jobs = read(storage);
  if (jobs.some(item => item.path === job.path)) return;
  if (jobs.length >= 20) throw new Error('照片待處理清單已滿，請先重新開啟此頁完成照片關聯');
  storage.setItem(PENDING_SHIPMENT_PHOTOS, JSON.stringify([...jobs, { ...job, createdAt: Date.now() }]));
}

export function forgetShipmentPhoto(storage, path) {
  const jobs = read(storage).filter(job => job?.path !== path);
  if (jobs.length) storage.setItem(PENDING_SHIPMENT_PHOTOS, JSON.stringify(jobs));
  else storage.removeItem(PENDING_SHIPMENT_PHOTOS);
}

export async function recoverShipmentPhotos(storage, userId, attach, now = Date.now()) {
  const result = { completed: 0, missing: 0, pending: 0 };
  for (const job of pendingShipmentPhotos(storage, userId)) {
    try {
      await attach(job);
      forgetShipmentPhoto(storage, job.path);
      result.completed++;
    } catch (error) {
      const recent = Number.isFinite(job.createdAt) && now - job.createdAt < SHIPMENT_PHOTO_UPLOAD_GRACE_MS;
      if (error?.status === 409 && /uploaded photo object not found/.test(error.message || '') && !recent) {
        forgetShipmentPhoto(storage, job.path);
        result.missing++;
      } else result.pending++;
    }
  }
  return result;
}
