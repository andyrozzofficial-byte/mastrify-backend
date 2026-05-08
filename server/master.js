import ffmpeg from "fluent-ffmpeg"
import ffmpegPath from "ffmpeg-static"
import ffprobePath from "ffprobe-static"
import fs from "fs"
import { spawn } from "child_process"
import { analyzeTrack } from "./analyze.js"

console.log("PLATFORM:", process.platform)
console.log("ARCH:", process.arch)
console.log("FFMPEG PATH:", ffmpegPath)

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

  console.log("INPUT PATH:", file)
  console.log("INPUT SIZE:", fs.statSync(file).size)

  if (!outputPath) {
    throw new Error("❌ Output path missing")
  }

  if (!fs.existsSync(input)) {
    throw new Error("Input file not found")
  }

  console.log("USING MINIMAL FFMPEG EXPORT")
  console.log("INPUT:", input)
  console.log("OUTPUT:", outputPath)
  console.log("USING FFMPEG-STATIC")

  const probeResult = await new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, data) => {
      console.log("FFPROBE ERROR:", err)
      console.log("FFPROBE DATA:", JSON.stringify(data, null, 2))
      resolve({ err, data })
    })
  })

  if (probeResult?.err) {
    throw new Error(`ffprobe failed: ${probeResult.err.message || probeResult.err}`)
  }

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

    console.log("INPUT EXISTS:", fs.existsSync(file))
    console.log("OUTPUT DIR EXISTS:", fs.existsSync("/tmp/masters"))

    // ls -l equivalent bits for the binary
    console.log("FFMPEG PATH:", ffmpegPath)
    const ffStat = fs.statSync(ffmpegPath)
    console.log("MODE:", ffStat.mode.toString(8))
    try {
      fs.chmodSync(ffmpegPath, 0o755)
    } catch (e) {
      console.log("CHMOD ERROR:", e?.message || e)
    }

    const args = [
      "-y",
      "-i",
      file,
      "-vn",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      outputPath,
    ]

    console.log("SPAWN FFMPEG:", ffmpegPath, args)

    const ff = spawn(ffmpegPath, args, { shell: false })
    cmdRef = ff

    ff.stderr.on("data", (d) => {
      console.log("FFMPEG STDERR:", d.toString())
    })

    ff.stdout.on("data", (d) => {
      console.log("FFMPEG STDOUT:", d.toString())
    })

    ff.on("close", (code) => {
      console.log("FFMPEG EXIT CODE:", code)
      if (settled) return
      settled = true
      clearTimeout(timeoutId)

      if (code === 0) {
        resolve({ path: outputPath })
      } else {
        reject(new Error("ffmpeg failed"))
      }
    })

    ff.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      console.error("SPAWN ERROR:", err)
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
