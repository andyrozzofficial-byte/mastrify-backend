export async function masterTrackReal(inputPath, outputPath, chain){

  const fs = await import("fs")
  const decodeAudio = (await import("audio-decode")).default
  const encodeWav = (await import("audiobuffer-to-wav")).default

  const file = fs.readFileSync(inputPath)
  const audioData = await decodeAudio(file)

  const sampleRate = audioData.sampleRate

  let buffer = []

  for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
    buffer.push(audioData.getChannelData(ch))
  }

  /* ---------------- PROCESS CHAIN ---------------- */

  for(const step of chain){

    if(step.type === "gain"){
      applyGain(buffer, step.value)
    }

    if(step.type === "compressor"){
      applyCompressor(buffer, step.threshold, step.ratio)
    }

    if(step.type === "limiter"){
      applyLimiter(buffer, step.ceiling)
    }

  }

  /* ---------------- EXPORT ---------------- */

  const wav = encodeWav({
    sampleRate,
    length: buffer[0].length,
    numberOfChannels: buffer.length,
    getChannelData: (ch) => buffer[ch]
  })

  fs.writeFileSync(outputPath, Buffer.from(wav))
}


/* ---------------- DSP ---------------- */

function applyGain(buffer, gainDb){
  const gain = Math.pow(10, gainDb / 20)

  for(const ch of buffer){
    for(let i = 0; i < ch.length; i++){
      ch[i] *= gain
    }
  }
}


/* 🔥 MYCKET MJUKARE COMP */
function applyCompressor(buffer, thresholdDb, ratio){

  const threshold = Math.pow(10, thresholdDb / 20)

  for(const ch of buffer){
    for(let i = 0; i < ch.length; i++){

      const sample = ch[i]
      const abs = Math.abs(sample)

      if(abs > threshold){

        const excess = abs - threshold
        const compressed = threshold + excess / ratio

        ch[i] = Math.sign(sample) * compressed
      }

    }
  }
}


/* 🔥 SOFT LIMITER (inte distortion) */
function applyLimiter(buffer, ceilingDb){

  const ceiling = Math.pow(10, ceilingDb / 20)

  for(const ch of buffer){
    for(let i = 0; i < ch.length; i++){

      if(ch[i] > ceiling){
        ch[i] = ceiling + (ch[i] - ceiling) * 0.2
      }

      if(ch[i] < -ceiling){
        ch[i] = -ceiling + (ch[i] + ceiling) * 0.2
      }

    }
  }
}