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

  /** RMS-proxy level from analyze.js — good enough to trim hot/quiet mixes before the chain */
  let stagingDb = 0
  let preAnalysis = null
  try {
    preAnalysis = await analyzeTrack(input)
    const raw = typeof preAnalysis.lufs === "number" ? preAnalysis.lufs : -18
    const stagingTarget = -15
    stagingDb = stagingTarget - raw
    stagingDb = Math.max(-12, Math.min(6, stagingDb))
    console.log("INPUT STAGING:", { rawLevelDb: raw, stagingDb })
  } catch (e) {
    console.log("PRE-ANALYSIS STAGING SKIP:", e?.message || e)
  }

  /** Cap hottest integrated target at -9 LUFS (prevents accidental ~-5 unless we raise this later) */
  const safeIntegratedLufs = Math.min(targetLufs, -9)

  const tone =
    style === "WARM"
      ? {
          lowHz: 72,
          lowGain: 1.12,
          mudGain: -1.15,
          mudWideGain: -0.45,
          airHz: 12500,
          airGain: 0.16,
          dipAboveAirHz: 15500,
          dipAboveAirGain: -0.35,
        }
      : style === "LOUD" || style === "FESTIVAL"
        ? {
            lowHz: 82,
            lowGain: 1.02,
            mudGain: -1.25,
            mudWideGain: -0.5,
            airHz: 13000,
            airGain: 0.18,
            dipAboveAirHz: 15500,
            dipAboveAirGain: -0.45,
          }
        : {
            lowHz: 78,
            lowGain: 1.06,
            mudGain: -1.12,
            mudWideGain: -0.4,
            airHz: 13000,
            airGain: 0.2,
            dipAboveAirHz: 15500,
            dipAboveAirGain: -0.38,
          }

  const volumeStaging =
    stagingDb === 0 ? "" : `volume=${stagingDb.toFixed(2)}dB,`

  const audioFilter =
    `highpass=f=25,` +
    volumeStaging +
    `equalizer=f=200:t=q:w=1:g=${tone.mudGain},` +
    `equalizer=f=320:t=q:w=1:g=${tone.mudWideGain},` +
    `equalizer=f=${tone.lowHz}:t=q:w=0.92:g=${tone.lowGain},` +
    `equalizer=f=9800:t=q:w=1:g=0.32,` +
    `acompressor=threshold=-18dB:ratio=1.55:attack=30:release=240,` +
    `equalizer=f=${tone.airHz}:t=q:w=1.15:g=${tone.airGain},` +
    `equalizer=f=${tone.dipAboveAirHz}:t=q:w=1:g=${tone.dipAboveAirGain},` +
    `loudnorm=I=${safeIntegratedLufs}:LRA=10:TP=-1:linear=true`

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
      "-af",
      audioFilter,
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

  let analysis = preAnalysis
  try {
    analysis = await analyzeTrack(outputPath)
  } catch (e) {
    console.log("OUTPUT ANALYSIS FALLBACK:", e?.message || e)
  }

  console.log("TARGET LUFS:", targetLufs)
  console.log("SAFE INTEGRATED LUFS (loudnorm):", safeIntegratedLufs)
  console.log("REFERENCE LUFS:", referenceAnalysis?.lufs)
  console.log("🔥 USING FFMPEG MASTER")
  console.log("🎧 ANALYSIS:", analysis)
  console.log("SPECTRAL:", analysis.spectral)

  return { path: outputPath }
}
