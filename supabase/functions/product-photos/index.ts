import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
const secretKey = secretKeys['default'] || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(supabaseUrl, secretKey)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function requireFactoryAdmin(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await admin.from('profiles')
    .select('user_id,role,active').eq('user_id', user.id).eq('active', true).maybeSingle()
  return profile?.role === 'admin' ? user : null
}

async function removeUploadedObject(id: string, path: string) {
  // A committed DB retirement prevents a later request from relinking this path.
  // Fail closed: a missing RPC/permission error must never fall through to Storage.
  const claim = await admin.rpc('claim_product_photo_cleanup', { p_product_id: id, p_storage_path: path })
  if (claim.error) throw claim.error
  if (claim.data !== true) return 'referenced'
  const { error } = await admin.storage.from('factory-photos').remove([path])
  return error ? 'failed' : null
}

// HEAD-based exists() can lose the JSON NoSuchKey body on an HTTP 400.
// Only the precise missing-object error is a 409; permission/service errors still fail.
function isMissingStorageObject(error: { code?: string; status?: number; statusCode?: string | number; message?: string }) {
  const status = Number(error.status ?? error.statusCode)
  return [400, 404].includes(status) && (error.code === 'NoSuchKey' ||
    (!error.code && String(error.statusCode) === '404' && error.message === 'Object not found'))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    if (!await requireFactoryAdmin(req)) return json({ error: 'Admin only' }, 403)

    const body = await req.json().catch(() => ({}))
    const id = String(body.id || '').trim()
    const storagePath = String(body.storage_path || '').trim()
    const expectedPrefix = `products/${id}/`
    const previousPath = body.previous_storage_path == null ? null : String(body.previous_storage_path).trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
        !storagePath || !storagePath.startsWith(expectedPrefix) || storagePath.length === expectedPrefix.length) {
      return json({ error: 'id and matching product photo path are required' }, 400)
    }
    if (previousPath && (!previousPath.startsWith(expectedPrefix) || previousPath.length === expectedPrefix.length)) {
      return json({ error: 'previous product photo path does not match product' }, 400)
    }

    const getProduct = async () => admin.from('products')
      .select('id,reference_photo_path').eq('id', id).maybeSingle()
    const cleanupPreviousPhoto = () => removeUploadedObject(id, previousPath!)
    const firstLookup = await getProduct()
    if (firstLookup.error) throw firstLookup.error
    if (!firstLookup.data) return json({ error: 'product not found' }, 404)

    if (firstLookup.data.reference_photo_path === storagePath) {
      if (previousPath && previousPath !== storagePath) {
        const cleanup = await cleanupPreviousPhoto()
        if (cleanup) return json({ product: firstLookup.data, replayed: true, previous_cleanup_pending: true, photo_change_pending: cleanup === 'referenced' }, 202)
      }
      return json({ product: firstLookup.data, replayed: true, previous_cleanup_pending: false })
    }
    if ((firstLookup.data.reference_photo_path || null) !== previousPath) {
      const cleanupError = await removeUploadedObject(id, storagePath)
      if (cleanupError === 'failed') return json({ error: 'product changed and uploaded object cleanup failed' }, 500)
      return json({ error: 'product photo changed before this upload was linked' }, 409)
    }

    const info = await admin.storage.from('factory-photos').info(storagePath)
    if (info.error && !isMissingStorageObject(info.error)) throw info.error
    if (info.error) return json({ error: 'uploaded photo object not found' }, 409)
    if (!info.data) throw new Error('Storage returned no object metadata')

    let update = admin.from('products').update({ reference_photo_path: storagePath }).eq('id', id)
    update = previousPath ? update.eq('reference_photo_path', previousPath) : update.is('reference_photo_path', null)
    const linked = await update.select('id,reference_photo_path').maybeSingle()
    if (linked.error || !linked.data) {
      const retryLookup = await getProduct()
      if (retryLookup.error) throw retryLookup.error
      if (retryLookup.data?.reference_photo_path === storagePath) {
        return json({ product: retryLookup.data, replayed: true, previous_cleanup_pending: false })
      }
      const cleanupError = await removeUploadedObject(id, storagePath)
      if (cleanupError === 'failed') return json({ error: 'photo link failed and uploaded object cleanup failed' }, 500)
      if (linked.error?.code === '22023') return json({ error: linked.error.message }, 409)
      if (linked.error) throw linked.error
      return json({ error: 'product photo changed before this upload was linked' }, 409)
    }

    if (previousPath && previousPath !== storagePath) {
      const cleanup = await cleanupPreviousPhoto()
      if (cleanup) return json({ product: linked.data, replayed: false, previous_cleanup_pending: true, photo_change_pending: cleanup === 'referenced' }, 202)
    }
    return json({ product: linked.data, replayed: false, previous_cleanup_pending: false }, 201)
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
