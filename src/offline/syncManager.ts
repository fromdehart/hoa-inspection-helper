import { convex } from "@/lib/convexClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { uploadPhoto } from "@/lib/uploadClient";
import { buildInspectorThumbnailJpeg } from "@/lib/thumbnailImage";
import { runPool } from "@/lib/runPool";
import { db, type OutboxPhoto } from "./db";
import { markPhotoDone } from "./outbox";
import { readPhotoFile } from "../native/photoFiles";
import { isOnline, onNetworkChange, initNetwork } from "../native/network";

const UPLOAD_CONCURRENCY = 4;
const MAX_BACKOFF_MS = 60_000;

export interface SyncStatus {
  syncing: boolean;
  pendingPhotos: number;
  pendingNotes: number;
  lastError: string | null;
  lastSyncAt: number | null;
}

let status: SyncStatus = {
  syncing: false,
  pendingPhotos: 0,
  pendingNotes: 0,
  lastError: null,
  lastSyncAt: null,
};
const statusListeners = new Set<(s: SyncStatus) => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const l of statusListeners) l(status);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function onSyncStatus(listener: (s: SyncStatus) => void): () => void {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}

function backoff(attempts: number): number {
  return Date.now() + Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
}

async function refreshCounts() {
  const [pendingPhotos, pendingNotes] = await Promise.all([
    db.outboxPhotos.where("status").notEqual("done").count(),
    db.outboxNotes.where("status").notEqual("done").count(),
  ]);
  setStatus({ pendingPhotos, pendingNotes });
}

async function syncOnePhoto(row: OutboxPhoto): Promise<void> {
  await db.outboxPhotos.update(row.id, { status: "inflight" });
  const propertyId = row.propertyId as Id<"properties">;
  try {
    const file = await readPhotoFile(row.fileRef, row.fileName);

    // If a prior attempt already created the Convex record, only finish the full upload.
    let photoId = row.photoId as Id<"photos"> | undefined;

    if (!photoId) {
      try {
        const thumbFile = await buildInspectorThumbnailJpeg(file);
        const thumb = await uploadPhoto(thumbFile, row.propertyId, row.section);
        photoId = await convex.mutation(api.photos.create, {
          propertyId,
          section: row.section as "front" | "side" | "back",
          thumbnailFilePath: thumb.filePath,
          thumbnailPublicUrl: thumb.publicUrl,
        });
        await db.outboxPhotos.update(row.id, { photoId, thumbUploaded: true });
      } catch {
        // Thumbnail path failed — upload the full image only and finish in one shot.
        const full = await uploadPhoto(file, row.propertyId, row.section);
        await convex.mutation(api.photos.create, {
          propertyId,
          section: row.section as "front" | "side" | "back",
          filePath: full.filePath,
          publicUrl: full.publicUrl,
        });
        await markPhotoDone(row.id);
        return;
      }
    }

    const full = await uploadPhoto(file, row.propertyId, row.section);
    await convex.mutation(api.photos.setFullImage, {
      id: photoId,
      propertyId,
      filePath: full.filePath,
      publicUrl: full.publicUrl,
    });
    await markPhotoDone(row.id);
  } catch (e) {
    const attempts = row.attempts + 1;
    await db.outboxPhotos.update(row.id, {
      status: "failed",
      attempts,
      nextAttemptAt: backoff(attempts),
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

async function drainPhotos(): Promise<void> {
  const now = Date.now();
  const rows = (await db.outboxPhotos.where("status").notEqual("done").toArray()).filter(
    (r) => r.status !== "inflight" && r.nextAttemptAt <= now,
  );
  if (rows.length === 0) return;
  await runPool(rows, UPLOAD_CONCURRENCY, async (row) => {
    try {
      await syncOnePhoto(row);
    } catch {
      // per-row error already recorded; continue the pool
    }
  });
}

async function drainNotes(): Promise<void> {
  const now = Date.now();
  const rows = (await db.outboxNotes.where("status").notEqual("done").toArray()).filter(
    (r) => r.status !== "inflight" && r.nextAttemptAt <= now,
  );
  for (const row of rows) {
    await db.outboxNotes.update(row.propertyId, { status: "inflight" });
    try {
      await convex.mutation(api.properties.updateInspectorNotes, {
        id: row.propertyId as Id<"properties">,
        inspectorNotesFront: row.front,
        inspectorNotesSide: row.side,
        inspectorNotesBack: row.back,
      });
      await db.outboxNotes.delete(row.propertyId);
    } catch (e) {
      const attempts = row.attempts + 1;
      await db.outboxNotes.update(row.propertyId, {
        status: "failed",
        attempts,
        nextAttemptAt: backoff(attempts),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

let running = false;

/** Drain the outbox once. Safe to call repeatedly; no-op when offline or already running. */
export async function syncNow(): Promise<void> {
  if (running || !isOnline()) return;
  running = true;
  setStatus({ syncing: true, lastError: null });
  try {
    await drainNotes();
    await drainPhotos();
    setStatus({ lastSyncAt: Date.now() });
  } catch (e) {
    setStatus({ lastError: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
    await refreshCounts();
    setStatus({ syncing: false });
    // If items became due (backoff) or new ones queued while running, they'll be
    // picked up on the next trigger (network change, capture, or interval).
  }
}

let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Wire up network + periodic sync. Call once at app startup. */
export function startSyncManager(): void {
  if (started) return;
  started = true;
  initNetwork();
  void refreshCounts();
  onNetworkChange((online) => {
    if (online) void syncNow();
  });
  // Periodic retry catches backed-off items and flaky uplinks.
  intervalId = setInterval(() => {
    if (isOnline()) void syncNow();
  }, 15_000);
  if (isOnline()) void syncNow();
}

export function stopSyncManager(): void {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  started = false;
}
