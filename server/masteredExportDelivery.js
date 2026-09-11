import { getSupabaseServiceClient, isSupabaseStorageConfigured } from "./supabaseStorage.js"

function normalizeEmail(email) {
  const value = typeof email === "string" ? email.trim().toLowerCase() : ""
  if (!value) return ""
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : ""
}

const EXPIRY_COPY = "Your secure download link remains active for 12 hours."

async function storeMasteredExport({ email, objectKey, expiresAt }) {
  if (!isSupabaseStorageConfigured()) return { stored: false, reason: "supabase_not_configured" }

  const createdAt = new Date().toISOString()
  const { error } = await getSupabaseServiceClient()
    .from("mastered_exports")
    .insert({
      email,
      object_key: objectKey,
      created_at: createdAt,
      expires_at: expiresAt,
    })

  if (error) throw new Error(`mastered_exports insert failed: ${error.message}`)
  return { stored: true, createdAt }
}

function cleanTrackTitle(trackTitle) {
  const value = typeof trackTitle === "string" ? trackTitle.trim() : ""
  return value.replace(/\s+/g, " ").slice(0, 120)
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

async function sendMasterReadyEmail({ email, playbackUrl, expiresAt, trackTitle }) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return { sent: false, reason: "resend_not_configured" }

  const from = process.env.MASTRIFY_EMAIL_FROM?.trim() || "Mastrify <masters@mastrify.com>"
  const replyTo = process.env.MASTRIFY_EMAIL_REPLY_TO?.trim() || "support@mastrify.com"
  const title = cleanTrackTitle(trackTitle)
  const escapedTitle = escapeHtml(title)
  const escapedPlaybackUrl = escapeHtml(playbackUrl)
  const heading = title ? `Your master of '${escapedTitle}' is ready` : "Your master is ready"
  const subject = title ? `Your master of '${title}' is ready` : "Your master is ready"
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          @media screen and (max-width: 480px) {
            .email-shell { padding: 24px 14px !important; }
            .email-card { padding: 28px 20px !important; border-radius: 22px !important; }
            .email-brand { font-size: 19px !important; }
            .email-heading { font-size: 25px !important; line-height: 1.18 !important; }
            .email-copy { font-size: 15px !important; line-height: 1.75 !important; }
            .primary-cta { display:block !important; padding: 17px 22px !important; min-height: 22px !important; text-align:center !important; }
            .secondary-cta { display:block !important; text-align:center !important; }
          }
          .primary-cta:hover { box-shadow: 0 16px 38px rgba(99,102,241,0.34) !important; filter: brightness(1.05); }
        </style>
      </head>
      <body style="margin:0;background:#030308;color:#f8fafc;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your Mastrify master is ready. Open your secure 12-hour download link.</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#030308;margin:0;padding:0;">
          <tr>
            <td class="email-shell" align="center" style="padding:38px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
                <tr>
                  <td class="email-card" style="border:1px solid rgba(255,255,255,0.11);border-radius:26px;background:#080811;background-image:radial-gradient(circle at 14% 0%,rgba(124,58,237,0.24),transparent 38%),radial-gradient(circle at 88% 6%,rgba(37,99,235,0.18),transparent 34%),linear-gradient(180deg,rgba(255,255,255,0.075),rgba(5,5,12,0.96));box-shadow:0 24px 78px rgba(0,0,0,0.46);padding:36px 32px;text-align:left;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td>
                          <p class="email-brand" style="margin:0 0 20px;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.035em;line-height:1.1;text-shadow:0 0 18px rgba(139,92,246,0.24);">Mastrify</p>
                          <h1 class="email-heading" style="margin:0;color:#ffffff;font-size:29px;line-height:1.14;letter-spacing:-0.035em;font-weight:800;overflow-wrap:break-word;word-break:break-word;">${heading}</h1>
                          <p class="email-copy" style="margin:18px 0 26px;color:rgba(255,255,255,0.72);font-size:15px;line-height:1.72;">Your mastered track is ready. Open the secure link below to download the final WAV export. ${EXPIRY_COPY}</p>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding:0;">
                          <a class="primary-cta" href="${escapedPlaybackUrl}" style="display:inline-block;border-radius:999px;background:#6d5dfc;background-image:linear-gradient(90deg,#8b5cf6,#2563eb);color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;letter-spacing:-0.01em;line-height:20px;padding:16px 24px;box-shadow:0 12px 30px rgba(79,70,229,0.26);transition:box-shadow 180ms ease,filter 180ms ease;">Open secure download</a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:30px 0 18px;">
                          <div style="height:1px;background:rgba(255,255,255,0.12);background-image:linear-gradient(90deg,transparent,rgba(255,255,255,0.13),transparent);line-height:1px;font-size:1px;">&nbsp;</div>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <p style="margin:0;color:rgba(255,255,255,0.38);font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Sent by Mastrify Audio Engine</p>
                          <p style="margin:12px 0 0;color:rgba(255,255,255,0.36);font-size:12px;line-height:1.6;">You are receiving this transactional email because this address was used to request a mastered export from Mastrify.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
  const textHeading = title ? `Your master of '${title}' is ready` : "Your master is ready"
  const text = `${textHeading}\n\nYour mastered track is ready. Open your secure 12-hour download link:\n${playbackUrl}\n\n${EXPIRY_COPY}\n\nSent by Mastrify Audio Engine`

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject,
      html,
      text,
      reply_to: replyTo,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Resend failed (${res.status}): ${detail}`)
  }

  const data = await res.json().catch(() => null)
  return { sent: true, id: data?.id ?? null }
}

/**
 * Best-effort delivery: never block a successful master response if DB/email fails.
 */
export async function deliverMasterExportEmail({ email, objectKey, playbackUrl, expiresAt, trackTitle }) {
  const to = normalizeEmail(email)
  if (!to) return { requested: false }
  if (!objectKey || !playbackUrl) return { requested: true, delivered: false, reason: "missing_export_link" }

  const result = { requested: true, email: to, objectKey, expiresAt }

  try {
    result.storage = await storeMasteredExport({ email: to, objectKey, expiresAt })
  } catch (err) {
    result.storage = { stored: false, error: err?.message || String(err) }
    console.warn("[delivery] failed to store mastered export:", result.storage.error)
  }

  try {
    result.email = await sendMasterReadyEmail({ email: to, playbackUrl, expiresAt, trackTitle })
  } catch (err) {
    result.email = { sent: false, error: err?.message || String(err) }
    console.warn("[delivery] failed to send master email:", result.email.error)
  }

  return result
}
