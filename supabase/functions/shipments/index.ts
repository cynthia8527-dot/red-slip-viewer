import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
const secretKey = secretKeys['default'] || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(supabaseUrl, secretKey)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function requireFactoryUser(req: Request) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await admin.from('profiles').select('user_id,role,active').eq('user_id', user.id).eq('active', true).maybeSingle()
  return profile ? { user, profile } : null
}

function isKgUnit(unit: unknown) {
  const u = String(unit || '').trim().toLowerCase()
  return u === 'kg' || u === '公斤' || u === '千克'
}

function taipeiDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((x) => x.type === 'year')?.value || ''
  const m = parts.find((x) => x.type === 'month')?.value || ''
  const d = parts.find((x) => x.type === 'day')?.value || ''
  return `${y}-${m}-${d}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function requestFingerprint(body: unknown) {
  const bytes = new TextEncoder().encode(stableJson(body))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function requestId(req: Request) {
  const provided = (req.headers.get('Idempotency-Key') || '').trim().toLowerCase()
  if (!provided) return crypto.randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(provided)) return null
  return provided
}

async function priceSnapshot(vendorId: unknown, vendorName: unknown, productId: unknown, weight: unknown) {
  const vendor = String(vendorName || '').trim()
  const vendorMasterId = String(vendorId || '').trim()
  const product = String(productId || '').trim()
  if ((!vendor && !vendorMasterId) || !product) return {
    unit_price_snapshot: null,
    unit_snapshot: null,
    minimum_charge_snapshot: null,
    calculated_amount_snapshot: null,
  }
  const priceDate = taipeiDate()
  let q = admin.from('vendor_prices')
    .select('unit_price,unit,minimum_charge')
    .eq('product_id', product)
    .or(`effective_date.is.null,effective_date.lte.${priceDate}`)
    .or(`end_date.is.null,end_date.gte.${priceDate}`)
    .order('effective_date', { ascending: false, nullsFirst: false })
    .limit(1)
  q = vendorMasterId ? q.eq('vendor_id', vendorMasterId) : q.eq('vendor_name', vendor)
  let { data, error } = await q.maybeSingle()
  if (error) throw error
  if (!data && vendorMasterId && vendor) {
    const fallback = await admin.from('vendor_prices')
      .select('unit_price,unit,minimum_charge')
      .eq('vendor_name', vendor)
      .eq('product_id', product)
      .or(`effective_date.is.null,effective_date.lte.${priceDate}`)
      .or(`end_date.is.null,end_date.gte.${priceDate}`)
      .order('effective_date', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (fallback.error) throw fallback.error
    data = fallback.data
  }
  if (!data) return {
    unit_price_snapshot: null,
    unit_snapshot: null,
    minimum_charge_snapshot: null,
    calculated_amount_snapshot: null,
  }
  const unitPrice = data.unit_price == null ? null : Number(data.unit_price)
  const minimum = data.minimum_charge == null ? null : Number(data.minimum_charge)
  const w = weight == null || weight === '' ? null : Number(weight)
  let amount: number | null = null
  if (unitPrice != null && Number.isFinite(unitPrice) && w != null && Number.isFinite(w) && isKgUnit(data.unit)) {
    amount = unitPrice * w
    if (minimum != null && Number.isFinite(minimum)) amount = Math.max(amount, minimum)
  }
  return {
    unit_price_snapshot: unitPrice,
    unit_snapshot: data.unit || null,
    minimum_charge_snapshot: minimum,
    calculated_amount_snapshot: amount,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const actor = await requireFactoryUser(req)
    if (!actor) return json({ error: 'Unauthorized' }, 401)

    if (req.method === 'GET') {
      const { data, error } = await admin.from('shipments').select('*, intake_groups(id,label,received_date)').eq('is_demo', false).order('created_at', { ascending: true })
      if (error) throw error
      return json({ shipments: data ?? [] })
    }

    const body = await req.json().catch(() => ({}))

    if (req.method === 'POST') {
      const createRequestId = requestId(req)
      if (!createRequestId) return json({ error: 'Idempotency-Key must be a UUID' }, 400)
      const vendorName = String(body.vendor_name || '').trim()
      const itemName = String(body.item_name || '').trim()
      if (!vendorName || !itemName) return json({ error: 'vendor_name and item_name are required' }, 400)
      const shipped = body.status === '已出貨'
      const snapshot = shipped ? await priceSnapshot(body.vendor_id, body.vendor_name, body.product_id, body.weight_kg) : {}
      const row = {
        vendor_name: vendorName,
        vendor_id: body.vendor_id || null,
        item_name: itemName,
        product_id: body.product_id || null,
        material: body.material || null,
        process: body.process || null,
        boxes: body.boxes || null,
        weight_kg: body.weight_kg === '' || body.weight_kg == null ? null : Number(body.weight_kg),
        weigh_at: body.weigh_at || null,
        location: body.location || '蘆洲',
        status: body.status || '未開始',
        due_date: body.due_date || null,
        urgent: Boolean(body.urgent),
        note: body.note || null,
        shipped_at: shipped ? new Date().toISOString() : null,
        intake_group_id: body.intake_group_id || null,
        batch_label: String(body.batch_label || '').trim() || null,
        cannot_mix: Boolean(body.cannot_mix),
        is_demo: false,
        ...snapshot,
      }
      // The request key survives a client retry; the database serializes matching
      // keys and returns the first committed shipment instead of inserting again.
      const { data, error } = await admin.rpc('create_shipment_idempotent', {
        p_shipment: row,
        p_group_label: String(body.intake_group_label || '').trim() || null,
        p_received_date: body.received_date || new Date().toISOString().slice(0, 10),
        p_request_id: createRequestId,
        p_request_fingerprint: await requestFingerprint(body),
      })
      if (error?.code === '22023' && /Idempotency-Key/.test(error.message || '')) {
        return json({ error: error.message }, 409)
      }
      if (error) throw error
      return json({ shipment: data.shipment, replayed: Boolean(data.replayed) }, 201)
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '')
      if (!id) return json({ error: 'id is required' }, 400)
      const { data: existing, error: getErr } = await admin.from('shipments').select('*').eq('id', id).eq('is_demo', false).single()
      if (getErr || !existing) return json({ error: 'shipment not found' }, 404)

      if (body.action === 'void') {
        const patch = {
          voided_at: new Date().toISOString(),
          void_reason: String(body.void_reason || '').trim() || null,
          voided_by: actor.user.id,
          updated_at: new Date().toISOString(),
        }
        const { data, error } = await admin.from('shipments').update(patch).eq('id', id).eq('is_demo', false).select('*, intake_groups(id,label,received_date)').single()
        if (error) throw error
        return json({ shipment: data })
      }

      if (body.action === 'restore') {
        const patch = { voided_at: null, void_reason: null, voided_by: null, updated_at: new Date().toISOString() }
        const { data, error } = await admin.from('shipments').update(patch).eq('id', id).eq('is_demo', false).select('*, intake_groups(id,label,received_date)').single()
        if (error) throw error
        return json({ shipment: data })
      }

      if (existing.voided_at) return json({ error: 'voided shipment must be restored before editing' }, 409)

      const allowed = ['vendor_name','vendor_id','item_name','product_id','material','process','boxes','weight_kg','weigh_at','location','status','due_date','urgent','note','batch_label','cannot_mix']
      const patch: Record<string, unknown> = {}
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key] === '' ? null : body[key]
      if (Object.prototype.hasOwnProperty.call(body, 'weight_kg')) patch.weight_kg = body.weight_kg === '' || body.weight_kg == null ? null : Number(body.weight_kg)
      if (Object.prototype.hasOwnProperty.call(body, 'urgent')) patch.urgent = Boolean(body.urgent)
      if (Object.prototype.hasOwnProperty.call(body, 'cannot_mix')) patch.cannot_mix = Boolean(body.cannot_mix)
      const changesGroup = Object.prototype.hasOwnProperty.call(body, 'intake_group_label')

      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        if (body.status === '已出貨' && existing.status !== '已出貨') {
          patch.shipped_at = new Date().toISOString()
          const vendorId = body.vendor_id ?? existing.vendor_id
          const vendor = body.vendor_name ?? existing.vendor_name
          const product = body.product_id ?? existing.product_id
          const weight = Object.prototype.hasOwnProperty.call(body, 'weight_kg') ? body.weight_kg : existing.weight_kg
          Object.assign(patch, await priceSnapshot(vendorId, vendor, product, weight))
        }
        if (body.status !== '已出貨' && existing.status === '已出貨') {
          patch.shipped_at = null
          patch.unit_price_snapshot = null
          patch.unit_snapshot = null
          patch.minimum_charge_snapshot = null
          patch.calculated_amount_snapshot = null
        }
      }
      patch.updated_at = new Date().toISOString()
      if (changesGroup) {
        // Group creation and shipment update must commit or roll back together.
        const { data, error } = await admin.rpc('update_shipment_with_group', {
          p_id: id,
          p_patch: patch,
          p_requested_group_id: body.intake_group_id || null,
          p_group_label: String(body.intake_group_label || '').trim() || null,
          p_received_date: body.received_date || new Date().toISOString().slice(0, 10),
        })
        if (error) throw error
        return json({ shipment: data })
      }
      const { data, error } = await admin.from('shipments').update(patch).eq('id', id).eq('is_demo', false).select('*, intake_groups(id,label,received_date)').single()
      if (error) throw error
      return json({ shipment: data })
    }

    if (req.method === 'DELETE') {
      if (actor.profile.role !== 'admin') return json({ error: 'Admin only' }, 403)
      const id = String(body.id || '')
      if (!id) return json({ error: 'id is required' }, 400)
      const { data: existing, error: getErr } = await admin.from('shipments').select('id,voided_at').eq('id', id).eq('is_demo', false).single()
      if (getErr || !existing) return json({ error: 'shipment not found' }, 404)
      if (!existing.voided_at) return json({ error: 'void shipment before permanent delete' }, 409)

      const { data: photos, error: photosErr } = await admin.from('shipment_photos').select('storage_path').eq('shipment_id', id)
      if (photosErr) throw photosErr
      const paths = (photos || []).map((x:any)=>x.storage_path).filter(Boolean)
      if (paths.length) {
        const { error: storageErr } = await admin.storage.from('factory-photos').remove(paths)
        if (storageErr) throw storageErr
      }
      const { error: photoDeleteErr } = await admin.from('shipment_photos').delete().eq('shipment_id', id)
      if (photoDeleteErr) throw photoDeleteErr
      const { error } = await admin.from('shipments').delete().eq('id', id).eq('is_demo', false)
      if (error) throw error
      return json({ deleted: true, id })
    }

    return json({ error: 'method not allowed' }, 405)
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
