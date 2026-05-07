import ffmpeg from "fluent-ffmpeg"
import ffmpegStatic from "ffmpeg-static"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { analyzeTrack } from "./analyze.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Ensure ffmpeg binary exists in deployments (e.g. Railway)
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}


const uploadsDir = "/tmp/uploads"
const mastersDir = "/tmp/masters"
if (!fs.existsSync(mastersDir)) {
  fs.mkdirSync(mastersDir, { recursive: true })
}

export async function masterTrack({ file, output, reference, style, targetLufs, mode }) {

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

  const input = file
const outputPath = output

// 🔥 DEBUG + SKYDD
if (!outputPath) {
  throw new Error("❌ Output path missing")
}

console.log("INPUT:", input)
console.log("OUTPUT:", outputPath)

  if (!fs.existsSync(input)) {
    throw new Error("Input file not found")
  }

  const analysis = await analyzeTrack(input)

  let referenceAnalysis = null

if (reference) {
  const refPath = reference
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
  console.log("SPECTRAL:", analysis.spectral)

  let filters = []

/* CLEAN */
filters.push("highpass=f=30")

/* LOW END (tightare, mindre boom) */
filters.push("equalizer=f=90:t=q:w=1:g=0.3")

/* REMOVE MUD */
filters.push("equalizer=f=300:t=q:w=1:g=-1.2")

// 🧠 REFERENCE MATCH CALC
const spectral = analysis.spectral || {
  low: 0.2,
  mid: 0.2,
  high: 0.2
}

const diffLow = target.low - spectral.low
const diffMid = target.mid - spectral.mid
const diffHigh = target.high - spectral.high

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

// 🎧 HIGH (lite mildare nu)
if (Math.abs(diffHigh) > 0.02) {
  const gain = clamp(diffHigh * 6, -1.5, 1.5)
}


// 🎧 LOW TIGHT
filters.push("equalizer=f=60:t=q:w=1:g=0.3")

// 🎧 PRESENCE
filters.push("equalizer=f=3000:t=q:w=1:g=0.8")

// 🎧 AIR (MYCKET mildare)
filters.push("equalizer=f=12000:t=q:w=1:g=0.1")
filters.push("equalizer=f=14000:t=q:w=1:g=0.15")

// 🔥 NY (RADIO SHINE)
filters.push("equalizer=f=10000:t=q:w=1:g=0.3")

// 🎧 EXCITER (sänkt)
filters.push("aexciter=amount=0.4")

// 🎧 DE-ESS (fake via EQ)
filters.push("equalizer=f=7500:t=q:w=1:g=-0.5")

// PRE-LIMITER CONTROL
filters.push("acompressor=threshold=-8dB:ratio=2:attack=10:release=80")

// DRIVE
filters.push("volume=8.5dB")

// LIMITER (ALLTID SIST)
filters.push("alimiter=limit=0.92")



  console.log("⚙️ FILTERS:", filters)

  return new Promise((resolve, reject) => {
    let settled = false
    let cmdRef = null

    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      console.log("⏱️ FFMPEG TIMEOUT")
      try {
        cmdRef?.kill("SIGKILL")
      } catch (e) {
        // ignore kill errors
      }
      reject(new Error("Mastering timed out"))
    }, 60_000)

    const command = ffmpeg(input)
      .audioFilters(filters)
      .audioCodec("pcm_s16le")
      .audioFrequency(44100)
      .audioChannels(2)
      .format("wav")
      .output(outputPath)
      .on("start", (cmd) => {
        console.log("🚀 FFMPEG START:", cmd)
        cmdRef = command
      })
      .on("stderr", (line) => {
        console.log("FFMPEG STDERR:", line)
      })

      .on("end", () => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        console.log("✅ FFMPEG END")
        if (!fs.existsSync(outputPath)) {
          return reject(new Error("Master completed but output file missing"))
        }
        resolve({
  path: outputPath
})
      })

      .on("error", err => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        console.log("❌ FFMPEG ERROR:", err)
        reject(err)
      })

    cmdRef = command
    command.run()

  })

}