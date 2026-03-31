import fs from "fs"
import path from "path"
import ffmpeg from "fluent-ffmpeg"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"
import { fileURLToPath } from "url"

ffmpeg.setFfmpegPath(ffmpegInstaller.path)