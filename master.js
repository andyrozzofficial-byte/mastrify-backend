import ffmpeg from "fluent-ffmpeg"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { analyzeTrack } from "./analyze.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)


const uploadsDir = path.join(__dirname, "uploads")
const mastersDir = path.join(__dirname, "masters")

export async function masterTrack({ file, reference, style, targetLufs, mode }) {

  console.log("REFERENCE IN MASTER:", reference)

  if (!file) throw new Error("File missing")

  if (!style) style = "STREAM"
  if (!mode) mode = "normal"
  
// 🎯 TARGET LUFS (only if no reference loaded)
if (!reference) {
  if (style === "STREAM") targetLufs = -14
  if (style === "CLUB") targetLufs = -11
  if (style === "LOUD") targetLufs = -10
  if (style === "WARM") targetLufs = -13
  if (style === "FESTIVAL") targetLufs = -9
}

  targetLufs = parseFloat(targetLufs || -14)

  const input = path.join(uploadsDir, file)
  const outputName = `master_${Date.now()}.wav`
  const output = path.join(mastersDir, outputName)

  if (!fs.existsSync(input)) {
    throw new Error("Input file not found")
  }

  const analysis = await analyzeTrack(input)

  let referenceAnalysis = null

if (reference) {
  const refPath = path.join(uploadsDir, reference)
  referenceAnalysis = await analyzeTrack(refPath)
}

// 🎯 MATCH LOUDNESS TO REFERENCE
if (referenceAnalysis?.lufs) {
  targetLufs = referenceAnalysis.lufs
}

// 🎯 DEBUG
console.log("TARGET LUFS:", targetLufs)
console.log("REFERENCE LUFS:", referenceAnalysis?.lufs)

const target = referenceAnalysis?.spectral || {
  low: 0.22,
  mid: 0.18,
  high: 0.20
}

  console.log("🔥 USING FFMPEG MASTER")
  console.log("🎧 ANALYSIS:", analysis)

  let filters = []

/* CLEAN */
filters.push("highpass=f=30")

/* LOW END */
filters.push("equalizer=f=90:t=q:w=1:g=0.5")

/* AIR */
filters.push("equalizer=f=12000:t=q:w=1:g=1")


// 🔥 remove mud / boxiness
filters.push("equalizer=f=300:t=q:w=1:g=-1.5")

// 🧠 REFERENCE MATCH CALC
const diffLow = target.low - analysis.spectral.low
const diffMid = target.mid - analysis.spectral.mid
const diffHigh = target.high - analysis.spectral.high

const clamp = (val, min, max) => Math.max(min, Math.min(max, val))

// 🎧 LOW
if (Math.abs(diffLow) > 0.02) {
  const gain = clamp(diffLow * 10, -2, 2)
  filters.push(`equalizer=f=80:t=q:w=1:g=${gain}`)
}

// 🎧 MID
if (Math.abs(diffMid) > 0.02) {
  const gain = clamp(diffMid * 8, -2, 2)
  filters.push(`equalizer=f=1000:t=q:w=1:g=${gain}`)
}

// 🎧 HIGH
if (Math.abs(diffHigh) > 0.02) {
  const gain = clamp(diffHigh * 10, -2, 2)
  filters.push(`equalizer=f=12000:t=q:w=1:g=${gain}`)
}


/* ---------------- SMART AI FIXES ---------------- */

// 🎧 Stereo width
if (analysis.stereoWidth < 0.4) {
  // filters.push("stereotools=mlev=0.2")
}

// 🎚 Low-end fix
if (analysis.lowEnergy > 0.7) {
  filters.push("equalizer=f=120:t=q:w=1:g=-2")
}

// ✨ High-end boost
if (analysis.highEnergy < 0.2) {
  filters.push("equalizer=f=10000:t=q:w=1:g=2")
}

// 🔥 Drop punch
if (analysis.energy === "Low" || analysis.dynamicRange > 15) {
 // filters.push("acompressor=threshold=-18dB:ratio=1.5:attack=20:release=120")
}


/* ---------------- GAIN ---------------- */
let gainDb = targetLufs - (analysis.lufs || -14)

// fallback för väldigt låg mix
if (analysis.lufs < -20) {
  gainDb += (mode === "pro" ? 10 : 5)
}

// safety limits
if (mode === "pro") {
  if (gainDb > 7) gainDb = 7
} else {
  if (gainDb > 5) gainDb = 5
}
if (gainDb < -3) gainDb = -3



// 🧠 AI COMPRESSOR
let comp


// 🔥 punch EQ (behåll)
filters.push("equalizer=f=90:t=q:w=1:g=1.2")
filters.push("equalizer=f=3500:t=q:w=1:g=0.7")

// 🔥 NY: saturation (ger pro känsla)
filters.push("dynaudnorm=f=200:g=5")

// 🎯 GAIN (push in i limitern)
filters.push(`volume=${gainDb}dB`)

// 🔥 AI LIMITER (RÄTT)
let limiter = "alimiter=limit=0.96:attack=10:release=180"

if (analysis.dynamicRange > 18) {
  limiter = "alimiter=limit=0.96:attack=15:release=200"
}
else if (analysis.dynamicRange > 12) {
  limiter = "alimiter=limit=0.96:attack=10:release=180"
}
else {
  limiter = "alimiter=limit=0.96:attack=5:release=120"
}

filters.push(limiter)

// 🎯 OUTPUT CEILING (ALLTID SIST)
filters.push("volume=-0.8dB")


  console.log("⚙️ FILTERS:", filters)

  return new Promise((resolve, reject) => {

    ffmpeg(input)
      .audioFilters(filters)
      .audioCodec("pcm_s24le")
      .audioFrequency(44100)
      .audioChannels(2)
      .format("wav")
      .output(output)

      .on("end", () => {
        console.log("✅ CLEAN MASTER DONE")
        resolve({
          master: outputName,
          url: `/masters/${outputName}`
        })
      })

      .on("error", err => {
        console.log("❌ ERROR:", err)
        reject(err)
      })

      .run()

  })

}