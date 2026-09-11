import Stripe from "stripe"

let stripeClient = null

export function getStripeServer() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) return null
  if (!stripeClient) {
    stripeClient = new Stripe(secretKey)
  }
  return stripeClient
}

/**
 * Verify a Checkout Session is paid and bound to the requested master objectKey.
 * @returns {{ ok: true, session: Stripe.Checkout.Session } | { ok: false, status: number, error: string }}
 */
export async function verifyPaidCheckoutForObjectKey(stripeSessionId, objectKey) {
  const stripe = getStripeServer()
  if (!stripe) {
    return { ok: false, status: 503, error: "Payments are not configured" }
  }

  const sessionId = typeof stripeSessionId === "string" ? stripeSessionId.trim() : ""
  const requestedKey = typeof objectKey === "string" ? objectKey.trim() : ""

  if (!sessionId) {
    return { ok: false, status: 400, error: "Missing stripeSessionId" }
  }
  if (!requestedKey) {
    return { ok: false, status: 400, error: "Missing objectKey" }
  }

  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (err) {
    console.error("[stripe] session retrieve failed:", err?.message || err)
    return { ok: false, status: 400, error: "Invalid Stripe checkout session" }
  }

  if (session.payment_status !== "paid") {
    return { ok: false, status: 402, error: "Payment is not complete" }
  }

  const metadataKey = typeof session.metadata?.objectKey === "string" ? session.metadata.objectKey.trim() : ""
  if (!metadataKey) {
    return { ok: false, status: 400, error: "Checkout session is missing master metadata" }
  }
  if (metadataKey !== requestedKey) {
    return { ok: false, status: 403, error: "Payment does not match this master" }
  }

  return { ok: true, session }
}
