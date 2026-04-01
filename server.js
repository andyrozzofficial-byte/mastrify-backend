import express from "express"
import cors from "cors"
import multer from "multer"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT:", err)
})

process.on("unhandledRejection", (err) => {
  console.error("💥 PROMISE ERROR:", err)
})

// import { analyzeTrack } from "./analyze.js"
// import { masterTrack } from "./master.js"
// import { aiMixAssistant } from "./ai.js"
// import { buildMasteringChain } from "./masteringEngine.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

app.use(cors())
app.use(express.json())

// ✅ LÄGG TILL DENNA
app.get("/", (req, res) => {
  res.send("Mastrify backend is live 🚀")
})

// absolute paths
const uploadsDir = "/tmp/uploads"
const mastersDir = "/tmp/masters"
console.log("Uploads exists:", fs.existsSync(uploadsDir))
console.log("Masters exists:", fs.existsSync(mastersDir))
console.log("MASTERS DIR:", mastersDir)

// ensure folders exist
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true })
  }

  if (!fs.existsSync(mastersDir)) {
    fs.mkdirSync(mastersDir, { recursive: true })
  }
} catch (err) {
  console.log("Folder error:", err)
}

// serve masters folder
app.use("/masters", express.static(mastersDir))
app.use("/uploads", express.static(uploadsDir))
const upload = multer({
  dest: "/tmp"
})

// cache analysis
const analysisCache = {}


/*
GENERATE MIX INSIGHTS
Creates mix score + tips
*/

function generateMixInsights(analysis){

let score = 75
const tips = []

// LOUDNESS

if(analysis.lufs){

if(analysis.lufs > -7){
tips.push("Track extremely loud – limiter may be working hard")
score -= 5
}

else if(analysis.lufs > -10){
tips.push("Track already very loud – mastering headroom limited")
score -= 3
}

else if(analysis.lufs < -18){
tips.push("Mix very quiet – significant gain will be added")
score -= 3
}

}


// LOW END

if(analysis.lowEnergy && analysis.lowEnergy > 0.75){
tips.push("Low end may be muddy – check kick/bass balance")
score -= 4
}

else if(analysis.lowEnergy && analysis.lowEnergy > 0.6){
tips.push("Low end slightly muddy")
score -= 2
}


// HIGH END

if(analysis.highEnergy && analysis.highEnergy < 0.15){
tips.push("High frequencies lacking – mix could use brightness")
score -= 3
}

else if(analysis.highEnergy && analysis.highEnergy < 0.25){
tips.push("High end could use more brightness around 10kHz")
score -= 2
}


// STEREO WIDTH

if(analysis.stereoWidth && analysis.stereoWidth < 0.25){
tips.push("Stereo field very narrow – mix may feel centered")
score -= 4
}

else if(analysis.stereoWidth && analysis.stereoWidth < 0.4){
tips.push("Stereo image slightly narrow – consider widening")
score -= 2
}

else if(analysis.stereoWidth > 0.85){
tips.push("Stereo image very wide – check mono compatibility")
score -= 1
}


// DYNAMICS

if(analysis.dynamicRange){

if(analysis.dynamicRange < 4){
tips.push("Mix heavily compressed – transients may be lost")
score -= 5
}

else if(analysis.dynamicRange < 7){
tips.push("Dynamics slightly compressed")
score -= 2
}

else if(analysis.dynamicRange > 15){
tips.push("Very dynamic mix – may feel quieter than commercial tracks")
score -= 1
}

}


// clamp score
score = Math.max(0, Math.min(100, Math.round(score)))

// remove duplicates
const uniqueTips = [...new Set(tips)]

// limit tips
const finalTips = uniqueTips.slice(0,4)

return {
mixScore: score,
mixTips: finalTips
}

}


/*
AI MASTER PLAN
Creates mastering strategy
*/

function generateMasterPlan(analysis,targetLufs){

const plan = []

if(analysis.lowEnergy && analysis.lowEnergy > 0.6){
plan.push("tighten low end")
}

if(analysis.stereoWidth && analysis.stereoWidth < 0.35){
plan.push("widen stereo image")
}

if(analysis.lufs && analysis.lufs > -8){
plan.push("reduce loudness slightly")
}

if(analysis.lufs && analysis.lufs < -18){
plan.push("increase loudness significantly")
}

if(analysis.dynamicRange && analysis.dynamicRange < 6){
plan.push("restore dynamics with gentle compression")
}

if(analysis.dynamicRange && analysis.dynamicRange > 15){
plan.push("control dynamics for more consistent level")
}

plan.push(`target loudness ${targetLufs} LUFS`)

return plan

}

function calculateMixScore(a){

  let score = 100

  const targetLufs = -14
  const targetDynamicMin = 6
  const targetDynamicMax = 12
  const targetStereoMin = 0.4
  const targetStereoMax = 0.8

  /* ---------------- SAFE VALUES ---------------- */

  const lufs = Number(a.lufs)
  const dynamic = Number(a.dynamicRange)
  const stereo = Number(a.stereoWidth)
  const low = Number(a.lowEnergy)
  const high = Number(a.highEnergy)

  /* ---------------- LOUDNESS ---------------- */

  if(!isNaN(lufs)){

  // 🎯 perfekt mix range
  if(lufs >= -18 && lufs <= -12){
    score += 10
  }

  // 🔇 för tyst
  else if(lufs < -18){
    score -= Math.min(20, (-18 - lufs) * 1.5)
  }

  // 🔊 för loud (börjar bli master)
  else if(lufs > -12){
    score -= Math.min(25, (lufs + 12) * 2)
  }

  // 🚨 limiter = big penalty
  if(lufs > -9){
    score -= 15
  }

}

/* ---------------- BALANCE BONUS ---------------- */

if(!isNaN(dynamic)){
  if(dynamic >= 6 && dynamic <= 12){
    score += 5
  }
}

if(!isNaN(stereo)){
  if(stereo >= 0.4 && stereo <= 0.8){
    score += 5
  }
}

  /* ---------------- DYNAMICS ---------------- */

  if(!isNaN(dynamic)){
    if(dynamic < targetDynamicMin){
      score -= Math.min(20, (targetDynamicMin - dynamic) * 3)
    } 
    else if(dynamic > targetDynamicMax){
      score -= Math.min(10, (dynamic - targetDynamicMax) * 1.5)
    }
  }

  /* ---------------- STEREO ---------------- */

  if(!isNaN(stereo)){
    if(stereo < targetStereoMin){
      score -= Math.min(15, (targetStereoMin - stereo) * 30)
    } 
    else if(stereo > targetStereoMax){
      score -= Math.min(8, (stereo - targetStereoMax) * 20)
    }
  }

  /* ---------------- LOW END ---------------- */

  if(!isNaN(low)){
    if(low > 0.7) score -= 10
    else if(low < 0.2) score -= 8
  }

  /* ---------------- HIGH END ---------------- */

  if(!isNaN(high)){
    if(high < 0.15) score -= 8
    else if(high > 0.35) score -= 6
  }

  /* ---------------- FINAL ---------------- */

  const finalScore = Math.max(0, Math.min(100, Math.round(score)))

console.log("INPUT:", a)
console.log("LUFS:", lufs)
console.log("FINAL SCORE:", finalScore)

return finalScore
}

function generateFullAnalysis(a){

let score = calculateMixScore(a)

const feedback = []
const fixes = []
const plan = []

const targetLufs = -9   // 👈 LÄGG TILL DENNA

/* LOUDNESS */

const lufs = Number(a.lufs)

if(!isNaN(lufs)){

  if(lufs > -7){
    feedback.push("Track is too loud / over-compressed")
    fixes.push("Reduce limiter input by 2–4 dB")
    plan.push("reduce loudness slightly")
  }

  else if(lufs < -20){
    feedback.push("Low output level")

    const neededGain = Math.round(targetLufs - lufs)

    fixes.push("Boost loudness to commercial level")

    plan.push("increase loudness significantly")
  }

  else if(lufs < -12){
    feedback.push("Good level — mastering will enhance it")
  }

}

/* LOW END */

if(a.lowEnergy > 0.7){
feedback.push("Low end muddy")
fixes.push("Reduce 60–120 Hz")
plan.push("tighten low end")
}

else if(a.lowEnergy < 0.2){
feedback.push("Low end weak")
fixes.push("Boost sub (40–80 Hz)")
}

/* osv... */

return {
score,
status: score < 50 ? "❌ Not ready"
: score < 75 ? "⚠️ Needs work"
: score < 90 ? "👍 Almost ready"
: "🔥 Ready",

feedback,
fixes,
plan
}
}


/*
UPLOAD TRACK
*/

app.post(
"/upload",
upload.fields([
{ name:"track", maxCount:1 },
{ name:"reference", maxCount:1 }
]),
async (req,res)=>{

try {

const track = req.files["track"]?.[0]
const reference = req.files["reference"]?.[0]

if(!track){
return res.status(400).json({error:"No track uploaded"})
}

// rename uploaded file
const fileName = track.filename + ".wav"
const newPath = track.path + ".wav"

fs.renameSync(track.path, newPath)

console.log("Uploaded:", fileName)

// const analysis = await analyzeTrack(newPath)
const analysis = {}

let referenceAnalysis = null

if(reference){
// referenceAnalysis = await analyzeTrack(reference.path)
referenceAnalysis = null
}

// cache analysis
analysisCache[fileName] = analysis

const ai = {}

const full = generateFullAnalysis(analysis) // 🔥 FLYTTA UPP

ai.message = full.status

const masteringChain = {}

const loudness = {
original: analysis.lufs || -18,
target: ai?.targetLufs || -10,
dynamicRange: analysis.dynamicRange || 8
}

res.json({
  file: fileName,

  analysis: {
    energy: analysis.energy,
    bpm: analysis.bpm,
    lufs: analysis.lufs,
    dynamicRange: analysis.dynamicRange,
    stereoWidth: analysis.stereoWidth
  },

  // 🔥 RÄTT PLATS (INUTI objektet)
  mixQuality: analysis.mixQuality,
  loudnessScore: analysis.loudnessScore,
  masterPotential: analysis.masterPotential,
  potentialLabel: analysis.potentialLabel,

  referenceAnalysis,
  ai,

  score: full.score,
  status: full.status,
  feedback: full.feedback,
  fixes: full.fixes,
  masterPlan: full.plan,

  masteringChain,
  loudness
})

} catch (err) {

console.log(err)

res.status(500).json({
error:"Upload failed"
})

}

})



/* ANALYZE TRACK */

app.post("/analyze", upload.single("file"), async (req, res) => {
  try {
    console.log("🔥 HIT /analyze")

    console.log("FILE:", req.file)

    if (!req.file) {
      console.log("❌ NO FILE RECEIVED")
      return res.status(400).json({ error: "No file uploaded" })
    }

    console.log("FILE PATH:", req.file.path)

    return res.json({ success: true })

  } catch (err) {
    console.error("❌ ERROR:", err)
    res.status(500).json({ error: "server crash" })
  }
})

function generateDynamicFixes(analysis){

  if(!analysis){
  console.log("❌ ANALYSIS UNDEFINED")
  return []
}

  const fixes = []

  const lufs = analysis?.lufs ?? -12

  let issueText = ""

if(lufs > -9){
  issueText = `Mix too loud (${Math.round(lufs)} LUFS)`
}
else if(lufs < -16){
  issueText = `Low energy mix`
}
else{
  issueText = "Well balanced mix"
}

  if(typeof lufs === "number" && (lufs > -9 || lufs < -14)){

  const targetMin = -18
const targetMax = -12

let target = -14 // mitten

if(lufs < targetMin){
  target = -16
}
else if(lufs > targetMax){
  target = -14
}

const diff = Math.abs(lufs - target)
const db = Math.round(diff)

fixes.push({
  issue: issueText,
  fix: lufs > targetMax
  ? "Slightly reduce loudness for better dynamics"
  : "Optimize loudness for a stronger, more impactful mix",

proTip: "Balanced loudness will improve clarity and punch"
})

}

  if(analysis.lowEnergy > 0.7){
    fixes.push({
      issue: "Low end muddy",
      fix: "Reduce 60–120Hz",
      proTip: "Separate kick & bass"
    })
  }

  if(analysis.highEnergy < 0.2){
    fixes.push({
      issue: "Lacking brightness",
      fix: "Boost 10kHz",
      proTip: "Add air carefully"
    })
  }

  if(analysis.stereoWidth < 0.35){
    fixes.push({
      issue: "Stereo too narrow",
      fix: "Widen pads",
      proTip: "Keep low-end mono"
    })
  }

  if(analysis.dynamicRange < 5){
    fixes.push({
      issue: "Overcompressed",
      fix: "Reduce compression",
      proTip: "Bring back transients"
    })
  }

  return fixes.slice(0,4)
}


/*
MASTER TRACK
*/

app.post("/master",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "reference", maxCount: 1 }
  ]),
  async (req, res) => {

    try {

      const file = req.files["file"]?.[0]
const referenceFile = req.files["reference"]?.[0]

if (!file) {
  return res.status(400).json({ error: "No file uploaded" })
}

// convert to wav
const fileName = file.filename + ".wav"
const newPath = file.path + ".wav"

fs.renameSync(file.path, newPath)

const result = { url: "/masters/test.wav" }

      res.json({
        before: `/uploads/${file.filename}`,
        after: result.url
      })

    } catch (err) {
      console.log(err)
      res.status(500).json({ error: "Master failed" })
    }

  }
)

app.post("/fix-mix", upload.single("track"), async (req, res) => {

  try {

    const file = req.file

    if (!file) {
      return res.status(400).json({ error: "No track uploaded" })
    }

    const filePath = file.path + ".wav"

    fs.renameSync(file.path, filePath)

    const analysis = {}

    const fixes = generateDynamicFixes(analysis)

    res.json({ fixes })

  } catch (err) {
    console.log(err)
    res.status(500).json({ error: "Fix failed" })
  }

})



/* START SERVER */

app.post("/waitlist", (req, res) => {
  const { email } = req.body
  console.log("🔥 New signup:", email)
  res.json({ success: true })
})

app.get("/test", (req, res) => {
  res.send("TEST OK")
})

const PORT = process.env.PORT

if (!PORT) {
  console.error("❌ NO PORT PROVIDED")
  process.exit(1)
}

// 🔥 VIKTIG: snabb health response innan allt annat
app.get("/health", (req, res) => {
  res.status(200).send("OK")
})

// 🔥 STARTA SERVER DIREKT
app.listen(PORT, "0.0.0.0", () => {
  console.log("🔥 Server running on port", PORT)
})