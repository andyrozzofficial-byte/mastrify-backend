#!/usr/bin/env node
/**
 * Verifies POST /master receives settings and produces measurably different output.
 * Usage: node scripts/verify-master-settings-api.mjs [apiBase] [wavPath]
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = process.argv[2] || "http://localhost:3001"
const WAV = process.argv[3] || path.join(__dirname, "../.test-audio/test-mix.wav")
const TIMEOUT_MS = 180_000

const STYLES = ["STREAM", "WARM", "LOUD", "CLUB", "FESTIVAL"]
const STYLE_LABELS = {
  STREAM: "Balanced",
  WARM: "Warm",
  LOUD: "Punchy",
  CLUB: "Club",
  FESTIVAL: "Open",
}

function pickMetrics(data) {
  const a = data?.analysisAfter ?? {}
  const mi = data?.masteringInsights ?? {}
  return {
    lufs: num(a.lufs),
    targetLufsApplied: num(a.targetLufsApplied ?? mi.appliedLufs),
    stereoWidth: num(a.stereoWidth),
    bassWeight: num(a.bassWeight),
    brightness: num(a.brightness),
    dynamicRange: num(a.dynamicRange),
    afterUrl: data?.after ?? data?.afterUrl ?? null,
    previewUrl: data?.previewAfterMp3Url ?? data?.previewAfterMp3 ?? null,
    style: mi.style ?? null,
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function masterWithSettings(label, wavPath, settings) {
  const buf = fs.readFileSync(wavPath)
  const form = new FormData()
  form.append("file", new Blob([buf], { type: "audio/wav" }), path.basename(wavPath))
  form.append("stylePreset", settings.stylePreset)
  form.append("targetLufs", String(settings.targetLufs))
  form.append("stereoEnhance", String(settings.stereoEnhance))
  form.append("lowEndControl", String(settings.lowEndControl))
  form.append("clarityPresence", String(settings.clarityPresence))
  form.append("trackTitle", path.basename(wavPath))

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  const t0 = Date.now()
  let res
  try {
    res = await fetch(`${API}/master`, { method: "POST", body: form, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${label}: non-JSON HTTP ${res.status} (${elapsed}s): ${text.slice(0, 200)}`)
  }
  if (!res.ok || data.error) {
    throw new Error(`${label}: HTTP ${res.status} (${elapsed}s): ${data.error || text.slice(0, 200)}`)
  }
  const metrics = pickMetrics(data)
  let fileHash = null
  let fileBytes = null
  if (metrics.afterUrl) {
    try {
      const url = metrics.afterUrl.startsWith("http") ? metrics.afterUrl : `${API}${metrics.afterUrl}`
      const dl = await fetch(url)
      if (dl.ok) {
        const ab = Buffer.from(await dl.arrayBuffer())
        fileBytes = ab.length
        fileHash = crypto.createHash("sha256").update(ab).digest("hex").slice(0, 16)
      }
    } catch {
      /* playback URL may require auth — metrics still valid */
    }
  }
  return { label, elapsed, settings, metrics, fileHash, fileBytes, sent: { ...settings } }
}

function diffNote(a, b, keys) {
  const parts = []
  for (const k of keys) {
    const va = a[k]
    const vb = b[k]
    if (va == null || vb == null) continue
    const d = vb - va
    if (Math.abs(d) > 0.01) parts.push(`${k} Δ${d >= 0 ? "+" : ""}${d.toFixed(2)}`)
  }
  return parts.join(", ") || "no metric delta"
}

async function main() {
  if (!fs.existsSync(WAV)) {
    console.error("Missing test WAV:", WAV)
    process.exit(1)
  }
  console.log("API:", API)
  console.log("WAV:", WAV, `(${fs.statSync(WAV).size} bytes)\n`)

  const baseline = {
    stylePreset: "STREAM",
    targetLufs: -14,
    stereoEnhance: 50,
    lowEndControl: 50,
    clarityPresence: 50,
  }

  const results = []

  console.log("=== 1. Each mastering style (LUFS -14, sliders 50) ===")
  for (const style of STYLES) {
    const r = await masterWithSettings(`style:${STYLE_LABELS[style]}`, WAV, { ...baseline, stylePreset: style })
    results.push(r)
    console.log(
      `  ${STYLE_LABELS[style].padEnd(9)} sent=${style} → lufs=${r.metrics.lufs} stereo=${r.metrics.stereoWidth} bass=${r.metrics.bassWeight} bright=${r.metrics.brightness} hash=${r.fileHash ?? "n/a"} (${r.elapsed}s)`
    )
  }

  console.log("\n=== 2. LUFS targets (STREAM, sliders 50) ===")
  for (const lufs of [-14, -13, -11, -9]) {
    const r = await masterWithSettings(`lufs:${lufs}`, WAV, { ...baseline, targetLufs: lufs })
    results.push(r)
    console.log(
      `  ${String(lufs).padEnd(4)} sent=${lufs} applied=${r.metrics.targetLufsApplied} measured=${r.metrics.lufs} hash=${r.fileHash ?? "n/a"} (${r.elapsed}s)`
    )
  }

  console.log("\n=== 3. Advanced sliders (STREAM, LUFS -14) ===")
  const sliderTests = [
    ["stereo:10", { stereoEnhance: 10, lowEndControl: 50, clarityPresence: 50 }],
    ["stereo:90", { stereoEnhance: 90, lowEndControl: 50, clarityPresence: 50 }],
    ["low:10", { stereoEnhance: 50, lowEndControl: 10, clarityPresence: 50 }],
    ["low:90", { stereoEnhance: 50, lowEndControl: 90, clarityPresence: 50 }],
    ["clarity:10", { stereoEnhance: 50, lowEndControl: 50, clarityPresence: 10 }],
    ["clarity:90", { stereoEnhance: 50, lowEndControl: 50, clarityPresence: 90 }],
  ]
  const sliderResults = []
  for (const [label, sliders] of sliderTests) {
    const r = await masterWithSettings(label, WAV, { ...baseline, ...sliders })
    results.push(r)
    sliderResults.push(r)
    console.log(
      `  ${label.padEnd(12)} sent=${JSON.stringify(sliders)} → stereo=${r.metrics.stereoWidth} bass=${r.metrics.bassWeight} bright=${r.metrics.brightness} (${r.elapsed}s)`
    )
  }

  console.log("\n=== 4. Second file (repeat flow simulation) ===")
  const wavB = path.join(path.dirname(WAV), "test-mix-b.wav")
  if (fs.existsSync(wavB)) {
    const r1 = await masterWithSettings("fileB:STREAM", wavB, baseline)
    const r2 = await masterWithSettings("fileB:CLUB", wavB, { ...baseline, stylePreset: "CLUB", targetLufs: -9 })
    console.log(`  file B STREAM  hash=${r1.fileHash ?? "n/a"} lufs=${r1.metrics.lufs}`)
    console.log(`  file B CLUB    hash=${r2.fileHash ?? "n/a"} lufs=${r2.metrics.lufs}`)
    console.log(`  different output: ${r1.fileHash && r2.fileHash ? r1.fileHash !== r2.fileHash : "compare metrics"}`)
  }

  console.log("\n=== Summary ===")
  const styleRows = results.filter((r) => r.label.startsWith("style:"))
  const uniqueStyleHashes = new Set(styleRows.map((r) => r.fileHash).filter(Boolean))
  console.log(`Styles tested: ${styleRows.length}, unique output hashes: ${uniqueStyleHashes.size || "n/a"}`)

  const streamBase = styleRows.find((r) => r.settings.stylePreset === "STREAM")
  const club = styleRows.find((r) => r.settings.stylePreset === "CLUB")
  if (streamBase && club) {
    console.log(`STREAM vs CLUB: ${diffNote(streamBase.metrics, club.metrics, ["lufs", "stereoWidth", "bassWeight", "brightness"])}`)
    if (streamBase.fileHash && club.fileHash) {
      console.log(`  output files differ: ${streamBase.fileHash !== club.fileHash}`)
    }
  }

  const lufs14 = results.find((r) => r.label === "lufs:-14")
  const lufs9 = results.find((r) => r.label === "lufs:-9")
  if (lufs14 && lufs9) {
    console.log(`LUFS -14 vs -9: ${diffNote(lufs14.metrics, lufs9.metrics, ["lufs", "targetLufsApplied"])}`)
  }

  const st10 = sliderResults.find((r) => r.label === "stereo:10")
  const st90 = sliderResults.find((r) => r.label === "stereo:90")
  if (st10 && st90) {
    console.log(`Stereo 10 vs 90: ${diffNote(st10.metrics, st90.metrics, ["stereoWidth", "brightness"])}`)
  }

  const lo10 = sliderResults.find((r) => r.label === "low:10")
  const lo90 = sliderResults.find((r) => r.label === "low:90")
  if (lo10 && lo90) {
    console.log(`Low end 10 vs 90: ${diffNote(lo10.metrics, lo90.metrics, ["bassWeight", "dynamicRange"])}`)
  }

  const cl10 = sliderResults.find((r) => r.label === "clarity:10")
  const cl90 = sliderResults.find((r) => r.label === "clarity:90")
  if (cl10 && cl90) {
    console.log(`Clarity 10 vs 90: ${diffNote(cl10.metrics, cl90.metrics, ["brightness", "dynamicRange"])}`)
  }

  console.log("\nAll API calls completed successfully.")
  console.log("Sent fields on every request: stylePreset, targetLufs, stereoEnhance, lowEndControl, clarityPresence, file")
}

main().catch((err) => {
  console.error("\nFAILED:", err.message || err)
  process.exit(1)
})
