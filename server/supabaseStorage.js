import { createClient } from "@supabase/supabase-js"
import fs from "fs"
import path from "path"
import { logStoragePersist, MASTRIFY_RESOURCE_DEBUG } from "./resourceUsageLog.js"

const DEFAULT_RETENTION_SEC = 60 * 60 * 12 // 12 hours
const DEFAULT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

let storageClient = null

function envTruthy(name) {
  const v = process.env[name]
  return v === "1" || v === "true" || v === "yes"
}

export function getMastersBucket() {
  return (
    process.env.SUPABASE_BUCKET_MASTERS ||
    process.env.SUPABASE_BUCKET ||
    process.env.SUPABASE_STORAGE_BUCKET ||
    "masters"
  )
}

export function isSupabaseStorageConfigured() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
}

export function isStorageRequired() {
  return envTruthy("MASTRIFY_STORAGE_REQUIRED")
}

export function isStorageFallbackEnabled() {
  return envTruthy("MASTRIFY_STORAGE_FALLBACK")
}

export function getSupabaseServiceClient() {
  if (!isSupabaseStorageConfigured()) {
    throw new Error("Supabase storage is not configured")
  }
  if (!storageClient) {
    storageClient = createClient(
      process.env.SUPABASE_URL.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    )
  }
  return storageClient
}

/** Safe object key inside the masters bucket (no path traversal). */
export function masterObjectKey(masterFileName) {
  const base = path.basename(String(masterFileName || ""))
  if (!base || base === "." || base.includes("..")) {
    throw new Error("Invalid master file name")
  }
  return base
}

export function safeUnlink(filePath) {
  if (!filePath) return
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (err) {
    console.warn("[storage] failed to unlink tmp file:", filePath, err?.message || err)
  }
}

/** Signed URL lifetime and Supabase object retention (same window). */
export function masterRetentionTtlSec() {
  const n = Number(process.env.MASTRIFY_RETENTION_SEC ?? process.env.MASTRIFY_SIGNED_URL_TTL_SEC)
  return Number.isFinite(n) && n > 60 ? Math.floor(n) : DEFAULT_RETENTION_SEC
}

export function signedUrlTtlSec() {
  return masterRetentionTtlSec()
}

export function masterCleanupIntervalMs() {
  const n = Number(process.env.MASTRIFY_STORAGE_CLEANUP_INTERVAL_MS)
  return Number.isFinite(n) && n >= 60_000 ? Math.floor(n) : DEFAULT_CLEANUP_INTERVAL_MS
}

export function signedUrlExpiresAt(from = new Date()) {
  return new Date(from.getTime() + signedUrlTtlSec() * 1000).toISOString()
}

export function previewObjectKeyForMaster(objectKey) {
  const base = masterObjectKey(objectKey)
  return base.replace(/\.wav$/i, "_preview.mp3")
}

/**
 * Upload a short mastered MP3 preview clip (pre-payment playback only).
 */
export async function uploadMasterPreviewMp3(localPath, objectKey) {
  const bucket = getMastersBucket()
  const key = previewObjectKeyForMaster(objectKey)
  const body = fs.readFileSync(localPath)
  const { error } = await getSupabaseServiceClient().storage.from(bucket).upload(key, body, {
    contentType: "audio/mpeg",
    upsert: true,
    cacheControl: "3600",
  })
  if (error) {
    throw new Error(`Supabase preview upload failed: ${error.message}`)
  }
  return { bucket, objectKey: key }
}

export async function createPreviewPlaybackSignedUrl(objectKey) {
  const bucket = getMastersBucket()
  const key = previewObjectKeyForMaster(objectKey)
  const expiresIn = signedUrlTtlSec()
  const { data, error } = await getSupabaseServiceClient()
    .storage.from(bucket)
    .createSignedUrl(key, expiresIn, { download: false })
  if (error || !data?.signedUrl) {
    throw new Error(`Supabase preview signed URL failed: ${error?.message || "missing signedUrl"}`)
  }
  return data.signedUrl
}

/**
 * Upload mastered WAV to private Supabase bucket.
 */
export async function uploadMasterWav(localPath, objectKey) {
  const bucket = getMastersBucket()
  const key = masterObjectKey(objectKey)
  const body = fs.readFileSync(localPath)
  if (MASTRIFY_RESOURCE_DEBUG) {
    console.log("[resource] Supabase upload (in-memory read)", {
      objectKey: key,
      masterBytes: body.length,
      bucket,
    })
  }
  const { error } = await getSupabaseServiceClient().storage.from(bucket).upload(key, body, {
    contentType: "audio/wav",
    upsert: true,
    cacheControl: "3600",
  })
  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`)
  }
  return { bucket, objectKey: key }
}

/**
 * Signed URL for inline playback (Range-friendly for Safari).
 */
function objectTimestampMs(item) {
  const raw = item?.updated_at || item?.created_at
  const ts = Date.parse(String(raw || ""))
  return Number.isFinite(ts) ? ts : null
}

/**
 * Delete mastered WAV/MP3 objects older than the retention window.
 * Also removes expired rows from mastered_exports when Supabase DB is configured.
 */
export async function purgeExpiredMasterStorage() {
  if (!isSupabaseStorageConfigured()) {
    return { deleted: 0, skipped: true, reason: "not_configured" }
  }

  const retentionMs = masterRetentionTtlSec() * 1000
  const cutoffMs = Date.now() - retentionMs
  const bucket = getMastersBucket()
  const client = getSupabaseServiceClient()
  const keysToDelete = []
  let offset = 0
  const pageSize = 100

  while (true) {
    const { data, error } = await client.storage.from(bucket).list("", {
      limit: pageSize,
      offset,
      sortBy: { column: "created_at", order: "asc" },
    })
    if (error) {
      throw new Error(`Supabase list failed: ${error.message}`)
    }
    if (!data?.length) break

    for (const item of data) {
      if (!item?.name || item.name.endsWith("/")) continue
      const ts = objectTimestampMs(item)
      if (ts == null || ts >= cutoffMs) continue
      keysToDelete.push(item.name)
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  if (keysToDelete.length) {
    const { error } = await client.storage.from(bucket).remove(keysToDelete)
    if (error) {
      throw new Error(`Supabase remove failed: ${error.message}`)
    }
  }

  let dbDeleted = 0
  try {
    const { error, count } = await client
      .from("mastered_exports")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString())
    if (error) {
      console.warn("[storage] mastered_exports cleanup:", error.message)
    } else {
      dbDeleted = count ?? 0
    }
  } catch (err) {
    console.warn("[storage] mastered_exports cleanup failed:", err?.message || err)
  }

  return {
    deleted: keysToDelete.length,
    keys: keysToDelete,
    dbDeleted,
    retentionSec: masterRetentionTtlSec(),
  }
}

export function startMasterStorageCleanupScheduler() {
  if (!isSupabaseStorageConfigured()) return

  const intervalMs = masterCleanupIntervalMs()
  const run = async () => {
    try {
      const result = await purgeExpiredMasterStorage()
      if (result.deleted > 0 || result.dbDeleted > 0) {
        console.log("[storage] retention cleanup", result)
      }
    } catch (err) {
      console.error("[storage] retention cleanup failed:", err?.message || err)
    }
  }

  void run()
  setInterval(run, intervalMs).unref?.()
  console.log("[storage] retention cleanup scheduled", {
    retentionSec: masterRetentionTtlSec(),
    intervalMs,
  })
}

export async function createMasterPlaybackSignedUrl(objectKey) {
  const bucket = getMastersBucket()
  const key = masterObjectKey(objectKey)
  const expiresIn = signedUrlTtlSec()
  const { data, error } = await getSupabaseServiceClient()
    .storage.from(bucket)
    .createSignedUrl(key, expiresIn, { download: false })
  if (error || !data?.signedUrl) {
    throw new Error(`Supabase signed URL failed: ${error?.message || "missing signedUrl"}`)
  }
  return data.signedUrl
}

/**
 * Persist master to Supabase when configured; optional Railway URL fallback.
 * Cleans up local tmp only after successful Supabase upload.
 */
export async function persistMasterExport({
  localMasterPath,
  localUploadPath,
  masterFileName,
  railwayPlaybackUrl,
  uploadBytes,
  masterBytes,
}) {
  const objectKey = masterObjectKey(masterFileName)
  const afterPath = `/masters/${objectKey}`

  if (!isSupabaseStorageConfigured()) {
    if (isStorageRequired()) {
      throw new Error("Supabase storage required but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing")
    }
    return {
      after: afterPath,
      afterUrl: railwayPlaybackUrl,
      fullUrl: railwayPlaybackUrl,
      storage: "railway",
      objectKey,
      expiresAt: null,
      signedUrlExpiresIn: null,
    }
  }

  try {
    await uploadMasterWav(localMasterPath, objectKey)
    const signedUrl = await createMasterPlaybackSignedUrl(objectKey)
    const expiresAt = signedUrlExpiresAt()
    safeUnlink(localMasterPath)
    safeUnlink(localUploadPath)
    console.log("[storage] master persisted to Supabase", {
      bucket: getMastersBucket(),
      objectKey,
      ttlSec: signedUrlTtlSec(),
    })
    logStoragePersist({
      storage: "supabase",
      objectKey,
      uploadBytes,
      masterBytes,
      localMasterDeleted: true,
      localUploadDeleted: true,
    })
    return {
      after: afterPath,
      afterUrl: signedUrl,
      fullUrl: signedUrl,
      storage: "supabase",
      objectKey,
      expiresAt,
      signedUrlExpiresIn: signedUrlTtlSec(),
    }
  } catch (err) {
    console.error("[storage] Supabase persist failed:", err?.message || err)
    if (isStorageFallbackEnabled()) {
      console.warn("[storage] MASTRIFY_STORAGE_FALLBACK=1 — serving master from Railway /tmp")
      logStoragePersist({
        storage: "railway-fallback",
        objectKey,
        uploadBytes,
        masterBytes,
        storageError: err?.message || String(err),
        localMasterKept: Boolean(localMasterPath && fs.existsSync(localMasterPath)),
        localUploadKept: Boolean(localUploadPath && fs.existsSync(localUploadPath)),
      })
      return {
        after: afterPath,
        afterUrl: railwayPlaybackUrl,
        fullUrl: railwayPlaybackUrl,
        storage: "railway-fallback",
        objectKey,
        expiresAt: null,
        signedUrlExpiresIn: null,
        storageError: err?.message || String(err),
      }
    }
    throw err
  }
}
