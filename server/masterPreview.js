import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import ffmpegPath from "ffmpeg-static"

/** Matches lib/audioPreviewTimeline.ts — 30s clip starting at 60s. */
export const PREVIEW_CLIP_START_SEC = 60
export const PREVIEW_CLIP_DURATION_SEC = 30

export function previewFileNameForMaster(masterFileName) {
  return String(masterFileName || "").replace(/\.wav$/i, "_preview.mp3")
}

export async function generateMasterPreviewMp3(masterWavPath, outputPath) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is not available")
  }
  if (!fs.existsSync(masterWavPath)) {
    throw new Error("Master WAV missing for preview generation")
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })

  try {
    fs.chmodSync(ffmpegPath, 0o755)
  } catch {
    /* ignore chmod errors */
  }

  await new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-ss",
      String(PREVIEW_CLIP_START_SEC),
      "-t",
      String(PREVIEW_CLIP_DURATION_SEC),
      "-i",
      masterWavPath,
      "-vn",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-b:a",
      "320k",
      "-c:a",
      "libmp3lame",
      "-f",
      "mp3",
      outputPath,
    ]

    const ff = spawn(ffmpegPath, args, { shell: false })
    ff.stderr.on("data", () => {})
    ff.on("close", (code) => {
      if (code === 0) resolve(null)
      else reject(new Error(`mp3 preview ffmpeg failed with code ${code}`))
    })
    ff.on("error", reject)
  })

  if (!fs.existsSync(outputPath)) {
    throw new Error("MP3 preview file was not created")
  }
}
