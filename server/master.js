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

  const runFfmpeg = ({ label, filters, outPath }) =>
    new Promise((resolve, reject) => {
      let settled = false
      let cmdRef = null
      const stderrLines = []

      const timeoutId = setTimeout(() => {
        if (settled) return
        settled = true
        console.log(`⏱️ FFMPEG TIMEOUT (${label})`)
        try {
          cmdRef?.kill("SIGKILL")
        } catch (e) {}
        reject(new Error("Mastering timed out"))
      }, 60_000)

      const command = ffmpeg(input)
        .audioCodec("pcm_s16le")
        .audioFrequency(44100)
        .audioChannels(2)
        .format("wav")
        .output(outPath)
        .on("start", (cmd) => {
          console.log(`🚀 FFMPEG START (${label}):`, cmd)
          cmdRef = command
        })
        .on("stderr", (line) => {
          stderrLines.push(line)
          console.log(`FFMPEG STDERR (${label}):`, line)
        })
        .on("end", () => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          console.log(`✅ FFMPEG END (${label})`)
          if (!fs.existsSync(outPath)) {
            return reject(new Error("Master completed but output file missing"))
          }
          resolve({ path: outPath, stderrLines })
        })
        .on("error", (err) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          console.log(`❌ FFMPEG ERROR (${label}):`, err)
          console.log(`❌ FFMPEG STDERR (last 40) (${label}):`)
          for (const l of stderrLines.slice(-40)) console.log(l)
          reject(err)
        })

      if (filters?.length) {
        command.audioFilters(filters)
      }

      cmdRef = command
      command.run()
    })

  const filterlessPath = outputPath.replace(/\.wav$/i, ".diag0.wav")
  const volumeOnlyPath = outputPath.replace(/\.wav$/i, ".diag1.wav")

  try {
    // 3. Verify input format (best-effort)
    try {
      ffmpeg.ffprobe(input, (err, data) => {
        if (err) return console.log("FFPROBE ERROR:", err.message)
        console.log("FFPROBE INPUT:", JSON.stringify(data?.format || {}, null, 2))
        console.log("FFPROBE STREAMS:", JSON.stringify(data?.streams || [], null, 2))
      })
    } catch (e) {}

    // 5. filterless conversion
    await runFfmpeg({ label: "filterless", filters: null, outPath: filterlessPath })

    // 6. volume-only
    await runFfmpeg({ label: "volume-only", filters: ["volume=2dB"], outPath: volumeOnlyPath })

    // 7. test chain (current)
    const filters = ["highpass=f=200", "lowpass=f=4000", "volume=15dB"]
    console.log("USING TEST MASTER CHAIN")
    console.log("FILTERS:", filters)

    await runFfmpeg({ label: "test-chain", filters, outPath: outputPath })

    return { path: outputPath }
  } catch (err) {
    throw err
  }

}