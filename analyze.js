import fs from "fs"
import decodeAudio from "audio-decode"
import MusicTempo from "music-tempo"
import { fft } from "fft-js"

export async function analyzeTrack(file){

const buffer = fs.readFileSync(file)
const audioData = await decodeAudio(buffer)

const left = audioData.getChannelData(0)
const right = audioData.numberOfChannels > 1
  ? audioData.getChannelData(1)
  : left


// ================= BPM =================

let bpm = 120
try {
  const mt = new MusicTempo(left)
  bpm = Math.round(mt.tempo)
} catch {}


// ================= ENERGY =================

let energy = 0
for(let i=0;i<left.length;i++){
  energy += Math.abs(left[i])
}
energy = energy / left.length

let energyLevel = "Low"
if(energy > 0.15) energyLevel = "Medium"
if(energy > 0.3) energyLevel = "High"


// ================= RMS =================

let rms = 0
for(let i=0;i<left.length;i++){
  rms += left[i]*left[i]
}
rms = Math.sqrt(rms/left.length)


// ================= LOUDNESS =================

let lufs = rms > 0.0001
  ? 20 * Math.log10(rms)
  : -60


// ================= PEAK =================

let peak = 0
for(let i=0;i<left.length;i++){
  const v = Math.abs(left[i])
  if(v > peak) peak = v
}


// ================= DYNAMIC =================

let dynamicRange = (peak > 0 && rms > 0)
  ? 20 * Math.log10(peak / rms)
  : 0


// ================= FFT =================

const slice = left.slice(0, 2048)
const spectrum = fft(slice).map(x => Math.abs(x[0]))

let low = 0
let mid = 0
let high = 0

for(let i=0;i<spectrum.length;i++){
  if(i < spectrum.length*0.2) low += spectrum[i]
  else if(i < spectrum.length*0.6) mid += spectrum[i]
  else high += spectrum[i]
}

const totalSpec = low + mid + high || 1

const lowEnergy = low / totalSpec
const highEnergy = high / totalSpec


// ================= STEREO =================

let stereo = 0
for (let i = 0; i < left.length; i++) {
  stereo += Math.abs(left[i] - right[i])
}
stereo = stereo / left.length

const stereoWidth = Math.min(1, stereo * 5)


// ================= MIX QUALITY =================

let mixQuality = 60
mixQuality += stereoWidth * 20
mixQuality += Math.min(20, dynamicRange * 2)

if (lowEnergy > 0.15 && lowEnergy < 0.45) mixQuality += 10
if (highEnergy > 0.15 && highEnergy < 0.45) mixQuality += 10

mixQuality = Math.max(0, Math.min(98, mixQuality))


// ================= ISSUES =================

let issues = []

// 🎧 STEREO
if (stereoWidth < 0.25) {
  issues.push({
    type: "stereo",
    level: "medium",
    text: "Stereo field is too narrow — mix feels centered",
    impact: Math.min(25, Math.round((0.25 - stereoWidth) * 120))
  })
}

// 🔊 DYNAMICS
if (dynamicRange < 5) {
  issues.push({
    type: "dynamics",
    level: "high",
    text: "Dynamic range is limited — mix feels over-compressed",
    impact: Math.min(30, Math.round((5 - dynamicRange) * 6))
  })
}

// 🔥 LOW END (muddy)
if (lowEnergy > 0.55) {
  issues.push({
    type: "lowend",
    level: "medium",
    text: "Low-end is muddy and overlapping",
    impact: Math.min(20, Math.round((lowEnergy - 0.55) * 40))
  })
}

// 🔉 LOW END (weak)
if (lowEnergy < 0.15) {
  issues.push({
    type: "lowend_weak",
    level: "medium",
    text: "Low-end feels weak",
    impact: Math.min(18, Math.round((0.15 - lowEnergy) * 80))
  })
}

// ⚡ HIGH END (harsh)
if (highEnergy > 0.55) {
  issues.push({
    type: "harsh",
    level: "medium",
    text: "High-end is harsh",
    impact: Math.min(18, Math.round((highEnergy - 0.55) * 40))
  })
}

// ✨ BRIGHTNESS
if (highEnergy < 0.15) {
  issues.push({
    type: "brightness",
    level: "low",
    text: "Mix lacks brightness",
    impact: Math.min(12, Math.round((0.15 - highEnergy) * 60))
  })
}

// 🚀 ENERGY
if (energy < 0.12) {
  issues.push({
    type: "energy",
    level: "medium",
    text: "Track lacks energy",
    impact: Math.min(25, Math.round((0.12 - energy) * 120))
  })
}


// ================= RECOMMENDATIONS =================

function getRecommendations(type) {

  switch (type) {

    case "stereo":
      return {
        title: "Increase stereo width",
        steps: [
          "Widen pads and atmospheric elements",
          "Use Haas delay (10–30ms)",
          "Keep bass mono for stability"
        ]
      }

    case "dynamics":
      return {
        title: "Restore dynamics",
        steps: [
          "Reduce master limiter by 2–4 dB",
          "Lower compression on drums",
          "Use transient shaper"
        ]
      }

    case "lowend":
      return {
        title: "Clean up low-end",
        steps: [
          "Cut 150–300 Hz",
          "Reduce sub frequencies",
          "Sidechain bass to kick"
        ]
      }

    case "lowend_weak":
      return {
        title: "Strengthen low-end",
        steps: [
          "Layer sub bass",
          "Boost 50–80 Hz",
          "Balance kick and bass"
        ]
      }

    case "harsh":
      return {
        title: "Control harsh high-end",
        steps: [
          "Reduce 8–12 kHz",
          "Use de-esser",
          "Soften hi-hats"
        ]
      }

    case "brightness":
      return {
        title: "Add brightness",
        steps: [
          "Boost 10–12 kHz",
          "Add exciter",
          "Use saturation"
        ]
      }

    case "energy":
      return {
        title: "Increase energy",
        steps: [
          "Boost upper mids",
          "Enhance transients",
          "Add saturation"
        ]
      }

    default:
      return null
  }
}


// 👉 SKAPA recommendations EFTER issues (VIKTIGT)

let recommendations = issues
  .map(issue => getRecommendations(issue.type))
  .filter(Boolean)

recommendations.push({
  title: "Pro enhancement",
  steps: [
    "Enhance stereo image slightly",
    "Add top-end air (12kHz shelf)",
    "Fine-tune transient balance"
  ]
})


// 🔥 PRIORITY SORT (VIKTIGAST FÖRST)
const priority = {
  high: 3,
  medium: 2,
  low: 1
}

issues.sort((a, b) => priority[b.level] - priority[a.level])

// 🔥 LIMITERA EFTER SORT
issues = issues.slice(0, 3)


// ================= RETURN =================

const maxImprovement = 100 - mixQuality

return {
  bpm,
  energy: energyLevel,
  lufs: Number.isFinite(lufs) ? lufs : -60,
  dynamicRange: Number.isFinite(dynamicRange) ? dynamicRange : 0,
  stereoWidth: Number.isFinite(stereoWidth) ? stereoWidth : 0,
  bassWeight: Number.isFinite(lowEnergy) ? lowEnergy : 0,
  brightness: Number.isFinite(highEnergy) ? highEnergy : 0,
  mixQuality: Number.isFinite(mixQuality) ? mixQuality : 0,
  issues: issues.map(issue => ({
  ...issue,
  realImpact: Math.min(issue.impact || 0, maxImprovement)
})),
  recommendations
}
}