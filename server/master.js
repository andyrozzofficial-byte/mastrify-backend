import ffmpeg from "fluent-ffmpeg"
import ffmpegStatic from "ffmpeg-static"
import ffprobePath from "ffprobe-static"
import fs from "fs"
import { analyzeTrack } from "./analyze.js"

// Ensure ffmpeg binary exists in deployments (e.g. Railway)
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}

// Ensure ffprobe binary exists in deployments (e.g. Railway)
if (ffprobePath?.path) {
  ffmpeg.setFfprobePath(ffprobePath.path)
}

const mastersDir = "/tmp/masters"
if (!fs.existsSync(mastersDir)) {
  fs.mkdirSync(mastersDir, { recursive: true })
}

export async function masterTrack({ file, output, reference, style, targetLufs, mode }) {
  console.log("REFERENCE IN MASTER:", reference)

  if (!file) throw new Error("File missing")

  if (!style) style = "STREAM"
  if (!mode) mode = "normal"

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

  if (!outputPath) {
    throw new Error("❌ Output path missing")
  }

  if (!fs.existsSync(input)) {
    throw new Error("Input file not found")
  }

  console.log("USING MINIMAL FFMPEG EXPORT")
  console.log("INPUT:", input)
  console.log("OUTPUT:", outputPath)

  await new Promise((resolve, reject) => {
    let settled = false
    let cmdRef = null
    const stderrLines = []

    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      console.log("⏱️ FFMPEG TIMEOUT")
      try {
        cmdRef?.kill("SIGKILL")
      } catch (e) {}
      reject(new Error("Mastering timed out"))
    }, 60_000)

    const proc = ffmpeg(input)
      .audioCodec("pcm_s16le")
      .format("wav")
      .on("start", (cmd) => {
        console.log("🚀 FFMPEG START:", cmd)
        cmdRef = proc
      })
      .on("stderr", (line) => {
        stderrLines.push(line)
        console.log("FFMPEG STDERR:", line)
      })
      .on("end", () => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        console.log("✅ FFMPEG END")
        console.log("FFMPEG STDERR FULL:\n", stderrLines.join("\n"))
        if (!fs.existsSync(outputPath)) {
          return reject(new Error("Master completed but output file missing"))
        }
        resolve()
      })
      .on("error", (err) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        console.log("❌ FFMPEG ERROR:", err)
        console.log("FFMPEG STDERR FULL:\n", stderrLines.join("\n"))
        reject(err)
      })

    cmdRef = proc
    proc.save(outputPath)
  })

  let referenceAnalysis = null

  if (reference) {
    const refPath = reference
    referenceAnalysis = await analyzeTrack(refPath)
  }

  if (referenceAnalysis?.lufs) {
    targetLufs = referenceAnalysis.lufs
  }

  const analysis = await analyzeTrack(input)

  console.log("TARGET LUFS:", targetLufs)
  console.log("REFERENCE LUFS:", referenceAnalysis?.lufs)
  console.log("🔥 USING FFMPEG MASTER")
  console.log("🎧 ANALYSIS:", analysis)
  console.log("SPECTRAL:", analysis.spectral)

  return { path: outputPath }
}
