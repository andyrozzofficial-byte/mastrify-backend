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

  // DEBUG: brutally obvious chain to verify processing
  const filters = [
    // make it immediately audible that filters apply
    "highpass=f=200",

    // extreme EQ swings
    "equalizer=f=80:t=q:w=1:g=12",
    "equalizer=f=3500:t=q:w=1:g=10",
    "equalizer=f=12000:t=q:w=1:g=12",

    // smash dynamics hard
    // use only widely supported options (avoid makeup param)
    "acompressor=threshold=-35dB:ratio=20:attack=1:release=50",

    // push into limiter
    "volume=20dB",
    "alimiter=limit=0.25",
  ]

  console.log("USING TEST MASTER CHAIN")
  console.log("FILTERS:", filters)

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