import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import ffmpegPath from "ffmpeg-static"
import { isMastrifyDebugOn } from "./mastrifyDebug.js"

/** Env MASTRIFY_CHAIN_DEBUG=1 enables chain isolation + movement probes */
export const MASTRIFY_CHAIN_DEBUG = isMastrifyDebugOn(process.env.MASTRIFY_CHAIN_DEBUG)

/** Short-term LUFS variance increase vs source that flags PUMPING RISK. */
export const PUMPING_RISK_VARIANCE_INCREASE_PCT = 25

export const CHAIN_DEBUG_MODES = {
  A: {
    id: "A",
    label: "EQ only",
    stageKey: "eq",
    stages: { eq: true, comp: false, limiter: false, loudnorm: false, pregain: false },
  },
  B: {
    id: "B",
    label: "EQ + loudnorm only",
    stageKey: "loudnorm",
    stages: { eq: true, comp: false, limiter: false, loudnorm: true, pregain: false },
  },
  C: {
    id: "C",
    label: "EQ + limiter only",
    stageKey: "limiter",
    stages: { eq: true, comp: false, limiter: true, loudnorm: false, pregain: false },
  },
  D: {
    id: "D",
    label: "EQ + compressor only",
    stageKey: "compressor",
    stages: { eq: true, comp: true, limiter: false, loudnorm: false, pregain: false },
  },
  E: {
    id: "E",
    label: "Full production chain",
    stageKey: "full",
    stages: { eq: true, comp: true, limiter: true, loudnorm: true, pregain: true },
  },
}

CHAIN_DEBUG_MODES.full = CHAIN_DEBUG_MODES.E

const SWEEP_MODE_IDS = ["A", "B", "C", "D", "E"]

const MODE_ALIASES = {
  a: "A",
  eq: "A",
  "eq-only": "A",
  b: "B",
  loudnorm: "B",
  "eq-loudnorm": "B",
  c: "C",
  limiter: "C",
  "eq-limiter": "C",
  d: "D",
  compressor: "D",
  comp: "D",
  "eq-compressor": "D",
  e: "E",
  full: "E",
}

/**
 * @returns {null | { id: string, label: string, stages: object }}
 */
export function parseChainDebugMode(raw) {
  if (raw == null || raw === "") return null
  const s = String(raw).trim()
  if (!s) return null
  const key = MODE_ALIASES[s.toLowerCase()] ?? s.toUpperCase()
  return CHAIN_DEBUG_MODES[key] ?? null
}

export function chainDebugEnabled(optsMode, envMode = process.env.MASTRIFY_CHAIN_MODE) {
  if (parseChainDebugMode(optsMode)) return true
  if (parseChainDebugMode(envMode)) return true
  return MASTRIFY_CHAIN_DEBUG
}

export function resolveChainDebugMode(optsMode, envMode = process.env.MASTRIFY_CHAIN_MODE) {
  return parseChainDebugMode(optsMode) ?? parseChainDebugMode(envMode) ?? null
}

/** Full A–E sweep runs only when MASTRIFY_CHAIN_SWEEP=1 (internal debug). */
export function isChainDebugSweepRequested() {
  return process.env.MASTRIFY_CHAIN_SWEEP === "1"
}

/** Parse ebur128 framelog=verbose lines: M = momentary, S = short-term (LUFS). */
export function parseEbur128VerboseSeries(stderr) {
  const momentary = []
  const shortTerm = []
  if (!stderr || typeof stderr !== "string") {
    return { momentary, shortTerm }
  }
  const lineRe = /^\s*t:\s*[\d.]+\s+M:\s*([-.\d]+|inf)\s+S:\s*([-.\d]+|inf)/gm
  let m
  while ((m = lineRe.exec(stderr)) !== null) {
    const mv = m[1] === "inf" ? null : parseFloat(m[1])
    const sv = m[2] === "inf" ? null : parseFloat(m[2])
    if (Number.isFinite(mv)) momentary.push(mv)
    if (Number.isFinite(sv)) shortTerm.push(sv)
  }
  return { momentary, shortTerm }
}

export function summarizeGainMovement(values) {
  const finite = (values || []).filter((v) => Number.isFinite(v))
  if (finite.length < 4) return null
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length
  const variance = finite.reduce((a, v) => a + (v - mean) ** 2, 0) / finite.length
  const std = Math.sqrt(variance)
  const swingLu = max - min
  return {
    windows: finite.length,
    minLu: Number(min.toFixed(2)),
    maxLu: Number(max.toFixed(2)),
    meanLu: Number(mean.toFixed(2)),
    stdLu: Number(std.toFixed(3)),
    varianceLu2: Number(variance.toFixed(4)),
    swingLu: Number(swingLu.toFixed(2)),
    pumpingScore: Number((std * 1.25 + swingLu * 0.4).toFixed(3)),
  }
}

function pctIncreaseVsSource(renderVal, sourceVal) {
  if (sourceVal == null || renderVal == null || !Number.isFinite(sourceVal) || sourceVal <= 0) {
    return null
  }
  return Number((((renderVal - sourceVal) / sourceVal) * 100).toFixed(1))
}

/**
 * Movement score for one render vs source baseline.
 */
export function computePumpingMovementScore({ momentary, shortTerm, sourceMetrics, trackAnalysis = null }) {
  const momentaryStats = summarizeGainMovement(momentary)
  const shortTermStats = summarizeGainMovement(shortTerm)
  const srcMom = sourceMetrics?.momentary ?? null
  const srcSt = sourceMetrics?.shortTerm ?? null

  const transientSwingDeltaLu =
    momentaryStats && srcMom
      ? Number((momentaryStats.swingLu - srcMom.swingLu).toFixed(2))
      : null
  const shortTermSwingDeltaLu =
    shortTermStats && srcSt
      ? Number((shortTermStats.swingLu - srcSt.swingLu).toFixed(2))
      : null

  const shortTermVarianceIncreasePct = pctIncreaseVsSource(
    shortTermStats?.varianceLu2,
    srcSt?.varianceLu2
  )
  const momentaryVarianceIncreasePct = pctIncreaseVsSource(
    momentaryStats?.varianceLu2,
    srcMom?.varianceLu2
  )

  const pumpingRisk =
    (shortTermVarianceIncreasePct != null &&
      shortTermVarianceIncreasePct > PUMPING_RISK_VARIANCE_INCREASE_PCT) ||
    (momentaryVarianceIncreasePct != null &&
      momentaryVarianceIncreasePct > PUMPING_RISK_VARIANCE_INCREASE_PCT) ||
    (transientSwingDeltaLu != null && transientSwingDeltaLu > 3.5)

  let crestFactorDelta = null
  if (trackAnalysis && sourceMetrics?.trackAnalysis) {
    const srcCrest =
      sourceMetrics.trackAnalysis.peakDb != null && sourceMetrics.trackAnalysis.lufs != null
        ? sourceMetrics.trackAnalysis.peakDb - sourceMetrics.trackAnalysis.lufs
        : sourceMetrics.trackAnalysis.dynamicRange
    const outCrest =
      trackAnalysis.peakDb != null && trackAnalysis.lufs != null
        ? trackAnalysis.peakDb - trackAnalysis.lufs
        : trackAnalysis.dynamicRange
    if (srcCrest != null && outCrest != null) {
      crestFactorDelta = Number((outCrest - srcCrest).toFixed(2))
    }
  }

  const compositeScore = Number(
    (
      (momentaryStats?.pumpingScore ?? 0) * 0.4 +
      (shortTermStats?.pumpingScore ?? 0) * 0.45 +
      Math.max(0, transientSwingDeltaLu ?? 0) * 0.35 +
      Math.max(0, shortTermSwingDeltaLu ?? 0) * 0.25
    ).toFixed(3)
  )

  return {
    momentary: momentaryStats,
    shortTerm: shortTermStats,
    shortTermVarianceIncreasePct,
    momentaryVarianceIncreasePct,
    transientSwingDeltaLu,
    shortTermSwingDeltaLu,
    crestFactorDelta,
    compositeScore,
    pumpingRisk,
    pumpingRiskLabel: pumpingRisk ? "PUMPING RISK" : "OK",
  }
}

/**
 * Attribute marginal movement to loudnorm / compressor / limiter / interaction.
 */
export function buildCulpritSummary(modeResults, sourceCompositeScore = 0) {
  const byId = Object.fromEntries(modeResults.map((m) => [m.mode, m]))
  const score = (id) => byId[id]?.movementScore?.compositeScore ?? sourceCompositeScore
  const base = score("A")

  const loudnormMarg = Math.max(0, score("B") - base)
  const limiterMarg = Math.max(0, score("C") - base)
  const compressorMarg = Math.max(0, score("D") - base)
  const fullMarg = Math.max(0, score("E") - base)
  const interactionMarg = Math.max(0, fullMarg - (loudnormMarg + limiterMarg + compressorMarg))

  const total = loudnormMarg + limiterMarg + compressorMarg + interactionMarg
  const pct = (v) => (total > 0.001 ? Number(((v / total) * 100).toFixed(0)) : 0)

  const attribution = {
    loudnorm: pct(loudnormMarg),
    compressor: pct(compressorMarg),
    limiter: pct(limiterMarg),
    interaction: pct(interactionMarg),
  }

  const ranked = [
    { stage: "loudnorm", pct: attribution.loudnorm, marginalScore: Number(loudnormMarg.toFixed(3)) },
    { stage: "compressor", pct: attribution.compressor, marginalScore: Number(compressorMarg.toFixed(3)) },
    { stage: "limiter", pct: attribution.limiter, marginalScore: Number(limiterMarg.toFixed(3)) },
    { stage: "interaction", pct: attribution.interaction, marginalScore: Number(interactionMarg.toFixed(3)) },
  ].sort((a, b) => b.pct - a.pct)

  const top = ranked[0]
  const summaryLine =
    total > 0.001
      ? `Most likely pumping source: ${top.stage} (~${top.pct}%)`
      : "No significant marginal movement detected between isolated stages."

  return {
    attribution,
    marginalScores: {
      baselineA: Number(base.toFixed(3)),
      loudnorm: Number(loudnormMarg.toFixed(3)),
      limiter: Number(limiterMarg.toFixed(3)),
      compressor: Number(compressorMarg.toFixed(3)),
      fullChain: Number(fullMarg.toFixed(3)),
      interaction: Number(interactionMarg.toFixed(3)),
    },
    ranked,
    mostLikely: top,
    summaryLine,
    breakdown: `loudnorm: ${attribution.loudnorm}% | compressor: ${attribution.compressor}% | limiter: ${attribution.limiter}% | interaction: ${attribution.interaction}%`,
  }
}

/**
 * Probe momentary / short-term loudness movement through an ffmpeg -af chain (null output).
 */
export async function probeMomentaryLufsSeries(filePath, audioFilter = "") {
  if (!ffmpegPath || !filePath) {
    return { momentary: [], shortTerm: [], stderr: "", code: -1 }
  }
  const trimmed = String(audioFilter || "").replace(/,\s*$/, "").trim()
  const af = trimmed
    ? `${trimmed},ebur128=framelog=verbose:metadata=0`
    : "ebur128=framelog=verbose:metadata=0"
  const args = [
    "-hide_banner",
    "-nostats",
    "-i",
    filePath,
    "-vn",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-af",
    af,
    "-f",
    "null",
    "-",
  ]
  return new Promise((resolve) => {
    const ff = spawn(ffmpegPath, args, { shell: false })
    let stderr = ""
    ff.stderr?.on("data", (d) => {
      stderr += d.toString()
    })
    ff.once("error", () => resolve({ momentary: [], shortTerm: [], stderr, code: -1 }))
    ff.once("close", (code) => {
      const series = parseEbur128VerboseSeries(stderr)
      resolve({ ...series, stderr, code })
    })
  })
}

export function buildLoudnormGainReport(pass1Json, measuredOpts = null) {
  if (!pass1Json) return null
  const num = (k) => {
    const v = parseFloat(String(pass1Json[k] ?? "").replace(/"/g, "").trim())
    return Number.isFinite(v) ? v : null
  }
  const inputI = num("input_i")
  const outputI = num("output_i")
  const offsetRaw = num("target_offset") ?? num("offset")
  const offsetApplied = measuredOpts?.offset != null ? parseFloat(measuredOpts.offset) : null
  return {
    inputIntegratedLu: inputI,
    outputIntegratedLu: outputI,
    integratedLiftLu:
      inputI != null && outputI != null ? Number((outputI - inputI).toFixed(2)) : null,
    offsetRawDb: offsetRaw,
    offsetAppliedDb: Number.isFinite(offsetApplied) ? offsetApplied : null,
    offsetStatic: measuredOpts?.staticPass2 === true,
    inputTpDb: num("input_tp"),
    inputLraLu: num("input_lra"),
    outputLraLu: num("output_lra"),
  }
}

export function estimateStageGainSwing(beforeSeries, afterSeries) {
  const b = summarizeGainMovement(beforeSeries?.momentary)
  const a = summarizeGainMovement(afterSeries?.momentary)
  if (!b || !a) return null
  return {
    baselineSwingLu: b.swingLu,
    afterSwingLu: a.swingLu,
    addedSwingLu: Number((a.swingLu - b.swingLu).toFixed(2)),
    addedPumpingScore: Number((a.pumpingScore - b.pumpingScore).toFixed(3)),
    baselineStdLu: b.stdLu,
    afterStdLu: a.stdLu,
  }
}

/**
 * Full raw isolation sweep: render WAV per stage, score movement, rank, culprit summary.
 * NO adaptive processing — caller must pass raw filters only.
 */
export async function runFullChainSweepExport({
  inputFile,
  outputDir,
  resolveFilterForMode,
  encodeWav,
  analyzeTrackFn = null,
  fileNameForMode = (modeId) => `chain-${modeId}.wav`,
  publicUrlBase = null,
}) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const sourceProbe = await probeMomentaryLufsSeries(inputFile, "")
  let sourceTrackAnalysis = null
  if (analyzeTrackFn) {
    try {
      sourceTrackAnalysis = await analyzeTrackFn(inputFile)
    } catch {
      sourceTrackAnalysis = null
    }
  }

  const sourceMetrics = {
    momentary: summarizeGainMovement(sourceProbe.momentary),
    shortTerm: summarizeGainMovement(sourceProbe.shortTerm),
    trackAnalysis: sourceTrackAnalysis,
  }
  const sourceMovementScore = computePumpingMovementScore({
    momentary: sourceProbe.momentary,
    shortTerm: sourceProbe.shortTerm,
    sourceMetrics: { momentary: null, shortTerm: null },
    trackAnalysis: sourceTrackAnalysis,
  })

  const renders = []

  for (const modeId of SWEEP_MODE_IDS) {
    const modeDef = CHAIN_DEBUG_MODES[modeId]
    const resolved = await resolveFilterForMode(modeId)
    const filter = resolved?.audioFilter ?? ""
    const wavFileName = fileNameForMode(modeId)
    const wavPath = path.join(outputDir, wavFileName)
    let encodeError = null
    try {
      await encodeWav(filter, wavPath, modeId, resolved?.comp ?? null)
    } catch (err) {
      encodeError = err.chainSweepDebug ?? {
        mode: modeId,
        filter,
        ffmpegExitCode: null,
        stderr: err.message,
        outputBytes: 0,
        comp: resolved?.comp ?? null,
      }
      console.error("[master] chain sweep render failed", encodeError)
      renders.push({
        mode: modeId,
        label: modeDef?.label,
        error: "encode_failed",
        encodeDebug: encodeError,
        wavPath: null,
        audioFilter: filter,
      })
      continue
    }

    const probe = await probeMomentaryLufsSeries(wavPath, "")
    let trackAnalysis = null
    if (analyzeTrackFn) {
      try {
        trackAnalysis = await analyzeTrackFn(wavPath)
      } catch {
        trackAnalysis = null
      }
    }

    const movementScore = computePumpingMovementScore({
      momentary: probe.momentary,
      shortTerm: probe.shortTerm,
      sourceMetrics,
      trackAnalysis,
    })

    const publicPath = `/masters/${wavFileName}`
    renders.push({
      mode: modeId,
      label: modeDef?.label ?? modeId,
      stageKey: modeDef?.stageKey,
      stages: modeDef?.stages,
      wavPath,
      wavFile: wavFileName,
      url: publicUrlBase ? `${publicUrlBase}${publicPath}` : publicPath,
      audioFilter: filter,
      loudnorm: resolved?.loudnorm ?? null,
      movementScore,
      vsSource: {
        compositeScoreDelta: Number(
          (movementScore.compositeScore - sourceMovementScore.compositeScore).toFixed(3)
        ),
        transientSwingDeltaLu: movementScore.transientSwingDeltaLu,
        shortTermVarianceIncreasePct: movementScore.shortTermVarianceIncreasePct,
      },
    })
  }

  renders.sort(
    (a, b) =>
      (a.movementScore?.compositeScore ?? 0) - (b.movementScore?.compositeScore ?? 0)
  )

  const ranking = renders.map((r, i) => ({
    rank: i + 1,
    mode: r.mode,
    label: r.label,
    compositeScore: r.movementScore?.compositeScore ?? null,
    pumpingRisk: r.movementScore?.pumpingRisk ?? false,
    pumpingRiskLabel: r.movementScore?.pumpingRiskLabel ?? null,
    shortTermVarianceIncreasePct: r.movementScore?.shortTermVarianceIncreasePct,
    wavFile: r.wavFile,
    url: r.url,
  }))

  const culpritSummary = buildCulpritSummary(renders, sourceMovementScore.compositeScore)

  const pumpingRiskModes = renders
    .filter((r) => r.movementScore?.pumpingRisk)
    .map((r) => r.mode)

  return {
    rawIsolation: true,
    outputDir,
    pumpingRiskThresholdPct: PUMPING_RISK_VARIANCE_INCREASE_PCT,
    source: {
      movementScore: sourceMovementScore,
      metrics: sourceMetrics,
    },
    renders,
    ranking,
    leastMovement: ranking[0] ?? null,
    mostMovement: ranking[ranking.length - 1] ?? null,
    culpritSummary,
    pumpingRiskModes,
    consoleReport: formatSweepConsoleReport({
      ranking,
      culpritSummary,
      pumpingRiskModes,
    }),
  }
}

export function formatSweepConsoleReport({ ranking, culpritSummary, pumpingRiskModes }) {
  const lines = [
    "════════ CHAIN SWEEP (raw isolation) ════════",
    culpritSummary.summaryLine,
    culpritSummary.breakdown,
    "",
    "Rank (least → most movement):",
  ]
  for (const r of ranking) {
    lines.push(
      `  ${r.rank}. [${r.mode}] ${r.label} — score ${r.compositeScore} ${r.pumpingRisk ? "⚠ PUMPING RISK" : "OK"} (+${r.shortTermVarianceIncreasePct ?? "?"}% ST variance)`
    )
  }
  if (pumpingRiskModes.length) {
    lines.push("", `PUMPING RISK modes: ${pumpingRiskModes.join(", ")}`)
  }
  lines.push("════════════════════════════════════════════")
  return lines.join("\n")
}

export async function runChainIsolationSweep({ file, resolveFilterForMode }) {
  const inputProbe = await probeMomentaryLufsSeries(file, "")
  const inputMovement = summarizeGainMovement(inputProbe.momentary)

  const modes = []
  for (const id of SWEEP_MODE_IDS) {
    const resolved = await resolveFilterForMode(id)
    const filter = resolved?.audioFilter ?? ""
    const probe = await probeMomentaryLufsSeries(file, filter)
    const movement = summarizeGainMovement(probe.momentary)
    const shortTermMovement = summarizeGainMovement(probe.shortTerm)
    const vsInput = estimateStageGainSwing(inputProbe, probe)
    modes.push({
      mode: id,
      label: CHAIN_DEBUG_MODES[id]?.label ?? id,
      audioFilter: filter,
      loudnorm: resolved?.loudnorm ?? null,
      stages: CHAIN_DEBUG_MODES[id]?.stages ?? null,
      movement,
      shortTermMovement,
      vsInput,
    })
  }

  modes.sort((a, b) => (b.movement?.pumpingScore ?? 0) - (a.movement?.pumpingScore ?? 0))
  const ranked = modes.map((m, i) => ({
    rank: i + 1,
    mode: m.mode,
    label: m.label,
    pumpingScore: m.movement?.pumpingScore ?? null,
    swingLu: m.movement?.swingLu ?? null,
    addedSwingVsInputLu: m.vsInput?.addedSwingLu ?? null,
  }))

  return {
    inputBaseline: inputMovement,
    modes,
    ranking: ranked,
    likelySuspect: ranked[0] ?? null,
    hint:
      "Highest pumpingScore / swingLu usually indicates the stage introducing audible gain movement.",
  }
}

export function logChainDebug(payload) {
  console.log("[master] chain debug", payload)
}
