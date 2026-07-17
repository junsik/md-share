import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface DocumentMeta {
  id: string;
  title: string;
  originalFilename: string | null;
  createdAt: string;
  expiresAt: string | null;
  size: number;
}

interface StoredDocumentMeta extends DocumentMeta {
  manageTokenHash: string;
}

export interface StoredDocument {
  meta: DocumentMeta;
  markdown: string;
}

export interface CreateDocumentInput {
  markdown: string;
  title?: string;
  originalFilename?: string;
  ttlDays?: number | null;
}

export interface CreateDocumentResult {
  meta: DocumentMeta;
  manageToken?: string;
  replayed: boolean;
}

export interface StorageStats {
  documents: number;
  bytes: number;
  expiringDocuments: number;
}

export type ManagementResult<T> =
  | { status: "ok"; value: T }
  | { status: "not_found" | "forbidden" };

interface IdempotencyRecord {
  requestHash: string;
  documentId: string;
  state: "pending" | "complete";
  createdAt: string;
}

interface CreateDocumentOptions {
  afterBodyPublished?: () => void | Promise<void>;
}

export class IdempotencyConflictError extends Error {}
export class IdempotencyGoneError extends Error {}
export class IdempotencyBusyError extends Error {}

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

const ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;
const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const ORPHAN_STALE_MS = 5 * 60 * 1000;

function dataDir(): string {
  return process.env.MD_SHARE_DATA_DIR ?? path.join(process.cwd(), "data");
}

function markdownPath(id: string): string {
  return path.join(dataDir(), `${id}.md`);
}

function metaPath(id: string): string {
  return path.join(dataDir(), `${id}.json`);
}

function idempotencyDir(): string {
  return path.join(dataDir(), ".idempotency");
}

function idempotencyRecordPath(keyHash: string): string {
  return path.join(idempotencyDir(), `${keyHash}.json`);
}

function idempotencyLockPath(keyHash: string): string {
  return path.join(idempotencyDir(), `${keyHash}.lock`);
}

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function newId(): string {
  return crypto.randomBytes(9).toString("base64url");
}

function newManageToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function publicMeta(meta: StoredDocumentMeta): DocumentMeta {
  return {
    id: meta.id,
    title: meta.title,
    originalFilename: meta.originalFilename ?? null,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    size: meta.size
  };
}

function parseStoredMeta(raw: string): StoredDocumentMeta | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDocumentMeta>;
    if (
      typeof parsed.id !== "string" ||
      !isValidId(parsed.id) ||
      typeof parsed.title !== "string" ||
      typeof parsed.createdAt !== "string" ||
      (parsed.expiresAt !== null && typeof parsed.expiresAt !== "string") ||
      typeof parsed.size !== "number"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      title: parsed.title,
      originalFilename:
        typeof parsed.originalFilename === "string" ? parsed.originalFilename : null,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
      size: parsed.size,
      manageTokenHash:
        typeof parsed.manageTokenHash === "string" ? parsed.manageTokenHash : ""
    };
  } catch {
    return null;
  }
}

export function deriveTitle(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)/);
    if (heading) {
      return heading[1].replace(/[#*`_]/g, "").trim() || "Untitled";
    }
  }
  return "Untitled";
}

function defaultTtlDays(): number | null {
  const raw = process.env.MD_SHARE_DEFAULT_TTL_DAYS;
  if (!raw) return null;
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? days : null;
}

function expiresAt(now: Date, ttlDays: number | null | undefined): string | null {
  const effectiveTtl = ttlDays === undefined ? defaultTtlDays() : ttlDays;
  return effectiveTtl != null && effectiveTtl > 0
    ? new Date(now.getTime() + effectiveTtl * 24 * 60 * 60 * 1000).toISOString()
    : null;
}

function requestHash(input: CreateDocumentInput): string {
  return sha256(
    JSON.stringify({
      markdown: input.markdown,
      title: input.title?.trim() || null,
      originalFilename: input.originalFilename || null,
      ttlDays: input.ttlDays === undefined ? "default" : input.ttlDays
    })
  );
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const temporary = path.join(
    path.dirname(target),
    `.tmp-${path.basename(target)}-${crypto.randomBytes(6).toString("hex")}`
  );
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readStoredMeta(id: string): Promise<StoredDocumentMeta | null> {
  if (!isValidId(id)) return null;
  try {
    return parseStoredMeta(await fs.readFile(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}

function isExpired(meta: DocumentMeta): boolean {
  return meta.expiresAt != null && Date.parse(meta.expiresAt) <= Date.now();
}

async function removeDocumentFiles(id: string): Promise<void> {
  await fs.rm(metaPath(id), { force: true }).catch(() => undefined);
  await fs.rm(markdownPath(id), { force: true }).catch(() => undefined);
}

async function publishDocument(
  id: string,
  input: CreateDocumentInput,
  manageTokenHash: string,
  options: CreateDocumentOptions
): Promise<DocumentMeta> {
  const now = new Date();
  const meta: StoredDocumentMeta = {
    id,
    title: input.title?.trim() || deriveTitle(input.markdown),
    originalFilename: input.originalFilename || null,
    createdAt: now.toISOString(),
    expiresAt: expiresAt(now, input.ttlDays),
    size: Buffer.byteLength(input.markdown, "utf8"),
    manageTokenHash
  };
  await fs.mkdir(dataDir(), { recursive: true });
  try {
    await writeAtomic(markdownPath(meta.id), input.markdown);
    await options.afterBodyPublished?.();
    await writeAtomic(metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`);
  } catch (error) {
    await removeDocumentFiles(meta.id);
    throw error;
  }
  return publicMeta(meta);
}

async function readIdempotencyRecord(keyHash: string): Promise<IdempotencyRecord | null> {
  try {
    return JSON.parse(await fs.readFile(idempotencyRecordPath(keyHash), "utf8")) as IdempotencyRecord;
  } catch {
    return null;
  }
}

async function writeIdempotencyRecord(
  keyHash: string,
  record: IdempotencyRecord
): Promise<void> {
  await fs.mkdir(idempotencyDir(), { recursive: true });
  await writeAtomic(idempotencyRecordPath(keyHash), `${JSON.stringify(record, null, 2)}\n`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireIdempotencyLock(keyHash: string): Promise<() => Promise<void>> {
  await fs.mkdir(idempotencyDir(), { recursive: true });
  const lockPath = idempotencyLockPath(keyHash);
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(lockPath);
      return async () => {
        await fs.rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      await delay(25);
    }
  }
  throw new IdempotencyBusyError("idempotency key is busy");
}

export async function createDocument(
  input: CreateDocumentInput,
  idempotencyKey?: string,
  options: CreateDocumentOptions = {}
): Promise<CreateDocumentResult> {
  if (!idempotencyKey) {
    const manageToken = newManageToken();
    const meta = await publishDocument(newId(), input, sha256(manageToken), options);
    return { meta, manageToken, replayed: false };
  }

  const keyHash = sha256(idempotencyKey);
  const expectedHash = requestHash(input);
  const release = await acquireIdempotencyLock(keyHash);
  try {
    let record = await readIdempotencyRecord(keyHash);
    if (record && record.requestHash !== expectedHash) {
      throw new IdempotencyConflictError("idempotency key was used with another request");
    }
    if (record) {
      const existing = await getDocument(record.documentId);
      if (existing) {
        if (record.state !== "complete") {
          record = { ...record, state: "complete" };
          await writeIdempotencyRecord(keyHash, record);
        }
        return { meta: existing.meta, replayed: true };
      }
      if (record.state === "complete") {
        throw new IdempotencyGoneError("the idempotent document is no longer available");
      }
      await removeDocumentFiles(record.documentId);
    } else {
      record = {
        requestHash: expectedHash,
        documentId: newId(),
        state: "pending",
        createdAt: new Date().toISOString()
      };
      await writeIdempotencyRecord(keyHash, record);
    }

    const manageToken = newManageToken();
    const meta = await publishDocument(
      record.documentId,
      input,
      sha256(manageToken),
      options
    );
    await writeIdempotencyRecord(keyHash, { ...record, state: "complete" });
    return { meta, manageToken, replayed: false };
  } finally {
    await release();
  }
}

export async function getDocument(id: string): Promise<StoredDocument | null> {
  const storedMeta = await readStoredMeta(id);
  if (!storedMeta) return null;
  if (isExpired(storedMeta)) {
    await removeDocumentFiles(id);
    return null;
  }
  try {
    const markdown = await fs.readFile(markdownPath(id), "utf8");
    return { meta: publicMeta(storedMeta), markdown };
  } catch {
    return null;
  }
}

export async function listDocuments(limit = 50): Promise<DocumentMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dataDir());
  } catch {
    return [];
  }
  const metas: DocumentMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || !isValidId(entry.slice(0, -5))) continue;
    const meta = await readStoredMeta(entry.slice(0, -5));
    if (meta && !isExpired(meta)) metas.push(publicMeta(meta));
  }
  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return metas.slice(0, limit);
}

function tokenMatches(meta: StoredDocumentMeta, token: string): boolean {
  return Boolean(meta.manageTokenHash && token && safeEqual(meta.manageTokenHash, sha256(token)));
}

export async function updateDocumentExpiry(
  id: string,
  manageToken: string,
  ttlDays: number | null
): Promise<ManagementResult<DocumentMeta>> {
  const meta = await readStoredMeta(id);
  if (!meta || isExpired(meta)) return { status: "not_found" };
  if (!tokenMatches(meta, manageToken)) return { status: "forbidden" };
  const updated: StoredDocumentMeta = {
    ...meta,
    expiresAt: expiresAt(new Date(), ttlDays)
  };
  await writeAtomic(metaPath(id), `${JSON.stringify(updated, null, 2)}\n`);
  return { status: "ok", value: publicMeta(updated) };
}

export async function deleteDocument(
  id: string,
  manageToken: string
): Promise<ManagementResult<null>> {
  const meta = await readStoredMeta(id);
  if (!meta || isExpired(meta)) return { status: "not_found" };
  if (!tokenMatches(meta, manageToken)) return { status: "forbidden" };
  await removeDocumentFiles(id);
  return { status: "ok", value: null };
}

export async function deleteDocumentAsOperator(
  id: string
): Promise<ManagementResult<null>> {
  const meta = await readStoredMeta(id);
  if (!meta || isExpired(meta)) return { status: "not_found" };
  await removeDocumentFiles(id);
  return { status: "ok", value: null };
}

export async function getStorageStats(): Promise<StorageStats> {
  const documents = await listDocuments(Number.MAX_SAFE_INTEGER);
  return {
    documents: documents.length,
    bytes: documents.reduce((sum, document) => sum + document.size, 0),
    expiringDocuments: documents.filter((document) => document.expiresAt != null).length
  };
}

async function removeIfStale(filePath: string, now: number): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (now - stat.mtimeMs <= ORPHAN_STALE_MS) return false;
    await fs.rm(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function sweepExpired(): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(dataDir());
  } catch {
    return 0;
  }
  let removed = 0;
  const now = Date.now();
  for (const entry of entries) {
    const entryPath = path.join(dataDir(), entry);
    if (entry.startsWith(".tmp-")) {
      await removeIfStale(entryPath, now);
      continue;
    }
    if (entry.endsWith(".md")) {
      const id = entry.slice(0, -3);
      if (isValidId(id)) {
        try {
          await fs.access(metaPath(id));
        } catch {
          await removeIfStale(entryPath, now);
        }
      }
      continue;
    }
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5);
    const meta = await readStoredMeta(id);
    if (meta && isExpired(meta)) {
      await removeDocumentFiles(meta.id);
      removed += 1;
    }
  }
  return removed;
}
