import express from "express"

const app = express()

// 🔥 ROOT (detta är ALLT Railway bryr sig om)
app.get("/", (req, res) => {
  res.send("OK")
})

// 🔥 PORT
const PORT = process.env.PORT || 3000

app.listen(PORT, "0.0.0.0", () => {
  console.log("RUNNING ON", PORT)
})