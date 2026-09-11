/**
 * Master /analyze payloads must be JSON-serializable. NaN/Infinity stringify to `null`,
 * which breaks numeric comparison metrics in the client.
 *
 * "Clarity" is derived on the frontend from brightness + stereoWidth — not a backend field.
 */

/** UI comparison keys — must match MasterResultClient metric rows (excl. derived clarity). */
export const UI_COMPARISON_METRIC_KEYS = ["lufs", "dynamicRange", "stereoWidth", "bassWeight", "brightness"]

function finiteNum(v, fallback) {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.trim())
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function cloneJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

/**
 * Build a plain, JSON-safe analysis object with the same shape the UI expects.
 * Does not invent musical meaning: only normalizes types / non-finite numbers.
 */
export function serializeMasterAnalysisForJson(raw, label = "analysis") {
  if (raw == null) return null
  if (typeof raw !== "object") return null

  const issuesClone = cloneJsonSafe(raw.issues)
  const recClone = cloneJsonSafe(raw.recommendations)

  const lufsRmsProxy = finiteNum(raw.lufsRmsProxy, NaN)
  const targetLufsApplied = finiteNum(raw.targetLufsApplied, NaN)
  const targetLufsRequested = finiteNum(raw.targetLufsRequested, NaN)
  const adaptiveBackoffLu = finiteNum(raw.adaptiveBackoffLu, NaN)

  return {
    bpm: finiteNum(raw.bpm, 120),
    energy: typeof raw.energy === "string" ? raw.energy : "medium",
    lufs: finiteNum(raw.lufs, -60),
    targetLufs: finiteNum(raw.targetLufs, -14),
    ...(Number.isFinite(lufsRmsProxy) ? { lufsRmsProxy } : {}),
    ...(Number.isFinite(targetLufsApplied) ? { targetLufsApplied } : {}),
    ...(Number.isFinite(targetLufsRequested) ? { targetLufsRequested } : {}),
    ...(raw.adaptiveApplied === true ? { adaptiveApplied: true } : {}),
    ...(Number.isFinite(adaptiveBackoffLu) ? { adaptiveBackoffLu } : {}),
    ...(raw.transientProtectionActive === true ? { transientProtectionActive: true } : {}),
    lufsAdjustment: finiteNum(raw.lufsAdjustment, 0),
    peakDb: finiteNum(raw.peakDb, -60),
    headroomStatus: typeof raw.headroomStatus === "string" ? raw.headroomStatus : "OK",
    dynamicRange: finiteNum(raw.dynamicRange, 0),
    stereoWidth: finiteNum(raw.stereoWidth, 0),
    bassWeight: finiteNum(raw.bassWeight, 0),
    brightness: finiteNum(raw.brightness, 0),
    mixQuality: finiteNum(raw.mixQuality, 0),
    issues: Array.isArray(issuesClone) ? issuesClone : [],
    recommendations: Array.isArray(recClone) ? recClone : [],
  }
}
