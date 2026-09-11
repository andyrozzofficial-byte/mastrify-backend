import { createClient } from "@supabase/supabase-js"

const DISCOUNT_REDEMPTIONS_TABLE = "discount_redemptions"

function getSupabase() {
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Verify a 100% discount free order for master delivery.
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export async function verifyFreeOrderForObjectKey(freeOrderId, objectKey) {
  const supabase = getSupabase()
  if (!supabase) {
    return { ok: false, status: 503, error: "Discount verification unavailable" }
  }

  const id = typeof freeOrderId === "string" ? freeOrderId.trim() : ""
  const key = typeof objectKey === "string" ? objectKey.trim() : ""

  if (!id.startsWith("free_")) {
    return { ok: false, status: 400, error: "Invalid free order reference" }
  }
  if (!key) {
    return { ok: false, status: 400, error: "Missing objectKey" }
  }

  const { data, error } = await supabase
    .from(DISCOUNT_REDEMPTIONS_TABLE)
    .select("id, object_key, final_amount_cents")
    .eq("free_order_id", id)
    .maybeSingle()

  if (error || !data) {
    return { ok: false, status: 402, error: "Free order could not be verified" }
  }
  if (String(data.object_key) !== key) {
    return { ok: false, status: 403, error: "Free order does not match this master" }
  }
  if (Number(data.final_amount_cents) !== 0) {
    return { ok: false, status: 402, error: "Invalid free order amount" }
  }

  return { ok: true }
}
