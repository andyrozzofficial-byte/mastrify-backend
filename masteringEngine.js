export function buildMasteringChain(analysis){

  const chain = []

  const lufs = analysis.lufs || -14
  const dynamic = analysis.dynamicRange || 8

  /* ---------------- LIGHT COMPRESSION ---------------- */

  // Bara om mixen är för dynamisk
  if(dynamic > 12){
    chain.push({
      type:"compressor",
      ratio:1.3,
      threshold:-22
    })
  }

  /* ---------------- SMART GAIN ---------------- */

  const targetLufs = -10
  let gain = targetLufs - lufs

  // 🔥 clamp så vi inte dödar mixen
  if(gain > 3) gain = 3
  if(gain < -2) gain = -2

  chain.push({
    type:"gain",
    value: gain
  })

  /* ---------------- SOFT LIMITER ---------------- */

  chain.push({
    type:"limiter",
    ceiling:-1
  })

  return chain
}