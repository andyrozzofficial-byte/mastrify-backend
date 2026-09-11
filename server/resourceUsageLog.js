/**
 * Temporary Railway resource investigation logging.
 * Enable with MASTRIFY_RESOURCE_DEBUG=1 (no logs in production by default).
 *
 * Optional:
 * - MASTRIFY_RESOURCE_IDLE_LOG=1 — RSS sample every 60s when no jobs (log volume)
 * - MASTRIFY_RESOURCE_MEMORY_FOLLOWUP=1 — RSS at +5s / +30s / +120s after each master
 */
import { isMastrifyDebugOn } from "./mastrifyDebug.js"

export const MASTRIFY_RESOURCE_DEBUG = isMastrifyDebugOn(process.env.MASTRIFY_RESOURCE_DEBUG)
export const MASTRIFY_RESOURCE_IDLE_LOG = isMastrifyDebugOn(process.env.MASTRIFY_RESOURCE_IDLE_LOG)
export const MASTRIFY_RESOURCE_MEMORY_FOLLOWUP = isMastrifyDebugOn(
  process.env.MASTRIFY_RESOURCE_MEMORY_FOLLOWUP
)

const PREFIX = "[resource]"
const activeJobs = new Map()
let idleTimer = null
let jobSeq = 0

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "?"
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function memSnapshot() {
  const m = process.memoryUsage()
  return {
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
    arrayBuffers: m.arrayBuffers,
    rssHuman: formatBytes(m.rss),
    heapUsedHuman: formatBytes(m.heapUsed),
  }
}

function memDelta(start, end) {
  if (!start || !end) return null
  return {
    rssDelta: end.rss - start.rss,
    rssDeltaHuman: formatBytes(end.rss - start.rss),
    heapUsedDelta: end.heapUsed - start.heapUsed,
    heapUsedDeltaHuman: formatBytes(end.heapUsed - start.heapUsed),
  }
}

export function logResource(event, fields = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG) return
  console.log(PREFIX, event, {
    at: new Date().toISOString(),
    pid: process.pid,
    activeMasterJobs: activeJobs.size,
    ...fields,
  })
}

export function logHttpRequest(req) {
  if (!MASTRIFY_RESOURCE_DEBUG) return
  const path = req.path || req.url || ""
  if (path === "/health" || path === "/") return
  logResource("HTTP request", {
    method: req.method,
    path,
    hasRange: Boolean(req.headers?.range),
    query: Object.keys(req.query || {}).length ? req.query : undefined,
  })
}

function scheduleMemoryFollowups(jobId, label) {
  if (!MASTRIFY_RESOURCE_MEMORY_FOLLOWUP) return
  for (const delaySec of [5, 30, 120]) {
    setTimeout(() => {
      logResource("RAM after master (follow-up)", {
        jobId,
        label,
        delaySec,
        activeMasterJobs: activeJobs.size,
        ...memSnapshot(),
      })
    }, delaySec * 1000).unref?.()
  }
}

export function beginMasterJob(meta = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG) return null
  const jobId = `master-${Date.now()}-${++jobSeq}`
  const memStart = memSnapshot()
  const startedAt = Date.now()
  activeJobs.set(jobId, { startedAt, memStart, ...meta })
  logResource("Master started", {
    jobId,
    uploadBytes: meta.uploadBytes ?? null,
    uploadBytesHuman: meta.uploadBytes != null ? formatBytes(meta.uploadBytes) : null,
    originalName: meta.originalName ?? null,
    stylePreset: meta.stylePreset ?? null,
    ...memStart,
  })
  return jobId
}

export function endMasterJob(jobId, fields = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG || !jobId) return
  const job = activeJobs.get(jobId)
  const endedAt = Date.now()
  const memEnd = memSnapshot()
  const processingTimeMs = job ? endedAt - job.startedAt : fields.processingTimeMs ?? null
  const delta = job ? memDelta(job.memStart, memEnd) : null
  activeJobs.delete(jobId)
  logResource("Master completed", {
    jobId,
    processingTimeMs,
    processingTimeSec:
      processingTimeMs != null ? Number((processingTimeMs / 1000).toFixed(2)) : null,
    masterBytes: fields.masterBytes ?? null,
    masterBytesHuman:
      fields.masterBytes != null ? formatBytes(fields.masterBytes) : null,
    uploadBytes: fields.uploadBytes ?? job?.uploadBytes ?? null,
    storage: fields.storage ?? null,
    objectKey: fields.objectKey ?? null,
    localMasterDeleted: fields.localMasterDeleted ?? null,
    localUploadDeleted: fields.localUploadDeleted ?? null,
    ...memEnd,
    ...(delta || {}),
    ...fields,
  })
  scheduleMemoryFollowups(jobId, "post-complete")
}

export function failMasterJob(jobId, err, fields = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG || !jobId) return
  const job = activeJobs.get(jobId)
  activeJobs.delete(jobId)
  logResource("Master failed", {
    jobId,
    error: err?.message || String(err),
    processingTimeMs: job ? Date.now() - job.startedAt : null,
    ...memSnapshot(),
    ...fields,
  })
}

export function logFileSizes(label, sizes = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG) return
  const human = {}
  for (const [k, v] of Object.entries(sizes)) {
    if (v == null) continue
    human[`${k}Human`] = formatBytes(v)
  }
  logResource(label, { ...sizes, ...human, ...memSnapshot() })
}

export function logStoragePersist(fields = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG) return
  logResource("Storage persist", {
    ...fields,
    uploadBytesHuman:
      fields.uploadBytes != null ? formatBytes(fields.uploadBytes) : undefined,
    masterBytesHuman:
      fields.masterBytes != null ? formatBytes(fields.masterBytes) : undefined,
    egressNote:
      fields.storage === "supabase"
        ? "Upload bytes count toward Railway egress; playback usually from Supabase signed URL"
        : fields.storage === "railway" || fields.storage === "railway-fallback"
          ? "Playback/download served from Railway /masters (egress + disk)"
          : undefined,
    ...memSnapshot(),
  })
}

export function logEgressServe(fields = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG) return
  logResource("Egress: master file serve", {
    ...fields,
    bytesHuman: fields.bytes != null ? formatBytes(fields.bytes) : undefined,
    fileSizeHuman: fields.fileSize != null ? formatBytes(fields.fileSize) : undefined,
  })
}

export function logDownloadTriggered(fields = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG) return
  logResource("Download triggered", fields)
}

export function logAnalyzeRequest(fields = {}) {
  if (!MASTRIFY_RESOURCE_DEBUG) return
  logResource("Analyze request", {
    ...fields,
    uploadBytesHuman:
      fields.uploadBytes != null ? formatBytes(fields.uploadBytes) : undefined,
    ...memSnapshot(),
  })
}

export function initResourceUsageLog() {
  if (!MASTRIFY_RESOURCE_DEBUG) return
  logResource("Resource debug enabled", {
    idleLog: MASTRIFY_RESOURCE_IDLE_LOG,
    memoryFollowup: MASTRIFY_RESOURCE_MEMORY_FOLLOWUP,
    node: process.version,
    ...memSnapshot(),
  })
  if (MASTRIFY_RESOURCE_IDLE_LOG) {
    idleTimer = setInterval(() => {
      logResource("Idle memory sample", {
        activeMasterJobs: activeJobs.size,
        uptimeSec: Math.round(process.uptime()),
        ...memSnapshot(),
      })
    }, 60_000)
    idleTimer.unref?.()
  }
}

export function shutdownResourceUsageLog() {
  if (idleTimer) clearInterval(idleTimer)
}
