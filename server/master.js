import ffmpegStatic from "ffmpeg-static"
import fs from "fs"
import { spawn } from "child_process"
import { analyzeTrack } from "./analyze.js"

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

    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      console.log("⏱️ FFMPEG TIMEOUT")
      try {
        cmdRef?.kill("SIGKILL")
      } catch (e) {}
      reject(new Error("Mastering timed out"))
    }, 60_000)

    console.log("INPUT EXISTS:", fs.existsSync(input))
    console.log("INPUT SIZE:", fs.statSync(input).size)

    const ffmpegBin = ffmpegStatic || "ffmpeg"
    const ff = spawn(ffmpegBin, [
      "-i", input,
      "-vn",
      "-ac", "2",
      "-ar", "44100",
      "-c:a", "pcm_s16le",
      outputPath
    ])

    cmdRef = ff

    ff.stderr.on("data", (d) => {
      console.log("RAW FFMPEG:", d.toString())
    })

    ff.on("close", (code) => {
      console.log("FFMPEG EXIT CODE:", code)
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (code === 0) {
        console.log("✅ FFMPEG END")
        if (!fs.existsSync(outputPath)) {
          return reject(new Error("Master completed but output file missing"))
        }
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`))
      }
    })

    ff.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      console.log("❌ FFMPEG ERROR:", err)
      reject(err)
    })
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
