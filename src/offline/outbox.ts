import { db, type OutboxCaseEventAction, type OutboxPhoto, type OutboxPhotoKind } from "./db";
import { savePhotoFile, deletePhotoFile } from "../native/photoFiles";

/**
 * Persist a captured photo locally and enqueue it for upload. Returns the outbox
 * id. The sync manager uploads it and registers it in Convex when online — so
 * capture never blocks on connectivity. `kind` selects the Convex flow
 * (inspector photo vs. homeowner fix photo).
 */
export async function enqueuePhoto(input: {
  propertyId: string;
  section: string;
  file: File;
  kind?: OutboxPhotoKind;
}): Promise<string> {
  const id = crypto.randomUUID();
  const fileRef = id;
  await savePhotoFile(fileRef, input.file);
  const row: OutboxPhoto = {
    id,
    kind: input.kind ?? "inspectorPhoto",
    propertyId: input.propertyId,
    section: input.section,
    fileRef,
    fileName: input.file.name || `${id}.jpg`,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
    nextAttemptAt: 0,
  };
  await db.outboxPhotos.add(row);
  return id;
}

export async function markPhotoDone(id: string): Promise<void> {
  const row = await db.outboxPhotos.get(id);
  if (row) await deletePhotoFile(row.fileRef);
  await db.outboxPhotos.delete(id);
}

/** Coalesced note draft: one pending row per property, latest content wins. */
export async function enqueueNote(input: {
  propertyId: string;
  front: string;
  side: string;
  back: string;
}): Promise<void> {
  await db.outboxNotes.put({
    propertyId: input.propertyId,
    front: input.front,
    side: input.side,
    back: input.back,
    status: "pending",
    attempts: 0,
    updatedAt: Date.now(),
    nextAttemptAt: 0,
  });
}

/**
 * Enqueue a case action captured in the field (open a case / add an
 * observation). The sync manager drains these BEFORE photos so the case exists
 * by the time photo events attach to it.
 */
export async function enqueueCaseEvent(input: {
  propertyId: string;
  action: OutboxCaseEventAction;
  payload: Record<string, string>;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.outboxCaseEvents.add({
    id,
    propertyId: input.propertyId,
    action: input.action,
    payload: input.payload,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
    nextAttemptAt: 0,
  });
  return id;
}

/** Pending (not yet synced) photos for one property — for queued-tile previews. */
export async function listPendingPhotosForProperty(
  propertyId: string,
): Promise<Array<{ id: string; section: string }>> {
  const rows = await db.outboxPhotos
    .where("propertyId")
    .equals(propertyId)
    .and((r) => r.status !== "done" && r.kind === "inspectorPhoto")
    .toArray();
  return rows.map((r) => ({ id: r.id, section: r.section }));
}

export async function pendingPhotoCount(): Promise<number> {
  return db.outboxPhotos.where("status").notEqual("done").count();
}

export async function pendingNoteCount(): Promise<number> {
  return db.outboxNotes.where("status").notEqual("done").count();
}

export async function pendingCaseEventCount(): Promise<number> {
  return db.outboxCaseEvents.where("status").notEqual("done").count();
}
