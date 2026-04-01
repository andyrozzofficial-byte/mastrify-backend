import express from "express"
import cors from "cors"
import multer from "multer"
import fs from "fs"

// 🔥 ERROR HANDLING (så servern inte dör)
process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT:", err)
})

process.on("unhandledRejection", (err) => {
  console.error("💥 PROMISE ERROR:", err)
})

const app = express()

app.use(cors())
app.use(express.json())

// 🔥 KRITISKT – ROOT (Railway behöver detta)
app.get("/", (req, res) => {
  res.status(200).send("Mastrify backend is live 🚀")
})

// 🔥 HEALTH CHECK
app.get("/health", (req, res) => {
  res.status(200).send("OK")
})

// 🔥 TEST ROUTE
app.get("/test", (req, res) => {
  res.send("TEST OK")
})

// 🔥 TEMP FOLDERS (Railway-safe)
const uploadsDir = "/tmp/uploads"
const mastersDir = "/tmp/masters"

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

// 🔥 STATIC FILES
app.use("/uploads", express.static(uploadsDir))
app.use("/masters", express.static(mastersDir))

// 🔥 MULTER (ENKEL VERSION – STABIL)
const upload = multer({ dest: "/tmp" })

// 🔥 UPLOAD TEST
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" })
    }

    const newPath = req.file.path + ".wav"
    fs.renameSync(req.file.path, newPath)

    res.json({
      success: true,
      file: newPath
    })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Upload failed" })
  }
})

// 🔥 MASTER TEST
app.post("/master", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" })
    }

    res.json({
      before: "/uploads/test.wav",
      after: "/masters/test.wav"
    })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Master failed" })
  }
})

// 🔥 WAITLIST
app.post("/waitlist", (req, res) => {
  const { email } = req.body
  console.log("🔥 New signup:", email)
  res.json({ success: true })
})

// 🔥 PORT (VIKTIGAST)
const PORT = process.env.PORT || 3000

console.log("PORT VALUE:", PORT)

// 🔥 START SERVER
app.listen(PORT, "0.0.0.0", () => {
  console.log("🔥 Server running on port", PORT)
})