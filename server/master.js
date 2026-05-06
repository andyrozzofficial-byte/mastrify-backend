import ffmpeg from "fluent-ffmpeg"
import ffmpegPath from "ffmpeg-static"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { analyzeTrack } from "./analyze.js"


ffmpeg.setFfmpegPath(ffmpegPath)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)


const uploadsDir = "/tmp/uploads"
const mastersDir = "/tmp/masters"

// 🔥 FIX: skapa uploads
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// 🔥 FIX: skapa masters
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

// 🔥 FIX: rensa bort skräp som inte är riktiga filters

  console.log("⚙️ FILTERS:", filters)


  return new Promise((resolve, reject) => {

  console.log("🔥 START MASTER")
  console.log("📂 INPUT PATH:", input)
  console.log("📂 OUTPUT PATH:", outputPath)

  // 👇 HÄR EXAKT
  console.log("FILE EXISTS:", fs.existsSync(input))
  console.log("FILE SIZE:", fs.statSync(input).size)
  console.log("UPLOAD DIR:", fs.readdirSync("/tmp/uploads"))

  ffmpeg(input)
    // .audioFilters(filters.join(","))
    .audioCodec("pcm_s24le")
    .audioFrequency(44100)
    .audioChannels(2)
    .format("wav")
    .output(outputPath)

    .on("start", (cmd) => {
      console.log("🚀 FFMPEG CMD:", cmd)
    })

    .on("stderr", (line) => {
      console.log("📢 FFMPEG LOG:", line)
    })

    .on("end", () => {
      console.log("✅ CLEAN MASTER DONE")
      resolve({
        path: outputPath
      })
    })

    .on("error", err => {
  console.log("💥 FFMPEG CRASH:")
  console.log(err.message)
  console.log(err.stack)
  reject(err)
})

    .run()
})

}