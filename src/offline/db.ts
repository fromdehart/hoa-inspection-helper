import Dexie, { type Table } from "dexie";

/** A cached query result, keyed by a stable string (e.g. "streets.list", "street:<id>"). */
export interface CacheEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

export type OutboxStatus = "pending" | "inflight" | "failed" | "done";

export type OutboxPhotoKind = "inspectorPhoto" | "fixPhoto";

/** A photo captured offline (or online) that must be uploaded + registered in Convex. */
export interface OutboxPhoto {
  id: string; // uuid
  /** Which Convex flow registers this photo once uploaded. */
  kind: OutboxPhotoKind;
  propertyId: string;
  section: string;
  /** Reference to the locally-stored image bytes (see native/photoFiles). */
  fileRef: string;
  fileName: string;
  status: OutboxStatus;
  attempts: number;
  /** Convex photo id once the thumbnail record is created (for the follow-up full upload). */
  photoId?: string;
  thumbUploaded?: boolean;
  error?: string;
  createdAt: number;
  nextAttemptAt: number;
}

/** Coalesced inspector-note draft per property (latest wins). */
export interface OutboxNote {
  propertyId: string; // primary key
  front: string;
  side: string;
  back: string;
  status: OutboxStatus;
  attempts: number;
  updatedAt: number;
  nextAttemptAt: number;
  error?: string;
}

/** Locally-stored image bytes for the web fallback (native uses Filesystem instead). */
export interface PhotoBlob {
  ref: string;
  blob: Blob;
}

class HappierBlockDB extends Dexie {
  cache!: Table<CacheEntry, string>;
  outboxPhotos!: Table<OutboxPhoto, string>;
  outboxNotes!: Table<OutboxNote, string>;
  photoBlobs!: Table<PhotoBlob, string>;

  constructor() {
    super("happier-block-offline");
    this.version(1).stores({
      cache: "key, updatedAt",
      outboxPhotos: "id, propertyId, status, nextAttemptAt",
      outboxNotes: "propertyId, status, nextAttemptAt",
      photoBlobs: "ref",
    });
  }
}

export const db = new HappierBlockDB();
