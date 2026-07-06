import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface DocumentMeta {
  id: string;
  title: string;
  createdAt: string;
  expiresAt: string | null;
  size: number;
}

export interface StoredDocument {
  meta: DocumentMeta;
  markdown: string;
}

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

const ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

function dataDir(): string {
  return process.env.MD_SHARE_DATA_DIR ?? path.join(process.cwd(), "data");
}

function markdownPath(id: string): string {
  return path.join(dataDir(), `${id}.md`);
}

function metaPath(id: string): string {
  return path.join(dataDir(), `${id}.json`);
}

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function newId(): string {
  return crypto.randomBytes(9).toString("base64url");
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

export interface CreateDocumentInput {
  markdown: string;
  title?: string;
  ttlDays?: number;
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentMeta> {
  const ttlDays = input.ttlDays ?? defaultTtlDays();
  const now = new Date();
  const meta: DocumentMeta = {
    id: newId(),
    title: input.title?.trim() || deriveTitle(input.markdown),
    createdAt: now.toISOString(),
    expiresAt:
      ttlDays != null && ttlDays > 0
        ? new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
    size: Buffer.byteLength(input.markdown, "utf8")
  };
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(markdownPath(meta.id), input.markdown, "utf8");
  await fs.writeFile(metaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

function isExpired(meta: DocumentMeta): boolean {
  return meta.expiresAt != null && Date.parse(meta.expiresAt) <= Date.now();
}

async function removeDocumentFiles(id: string): Promise<void> {
  await Promise.allSettled([fs.rm(markdownPath(id)), fs.rm(metaPath(id))]);
}

export async function getDocument(id: string): Promise<StoredDocument | null> {
  if (!isValidId(id)) return null;
  let metaRaw: string;
  let markdown: string;
  try {
    [metaRaw, markdown] = await Promise.all([
      fs.readFile(metaPath(id), "utf8"),
      fs.readFile(markdownPath(id), "utf8")
    ]);
  } catch {
    return null;
  }
  const meta = JSON.parse(metaRaw) as DocumentMeta;
  if (isExpired(meta)) {
    await removeDocumentFiles(id);
    return null;
  }
  return { meta, markdown };
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
    if (!entry.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(dataDir(), entry), "utf8")) as DocumentMeta;
      if (!isExpired(meta)) metas.push(meta);
    } catch {
      // skip unreadable metadata files
    }
  }
  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return metas.slice(0, limit);
}

export async function sweepExpired(): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(dataDir());
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(dataDir(), entry), "utf8")) as DocumentMeta;
      if (isExpired(meta)) {
        await removeDocumentFiles(meta.id);
        removed += 1;
      }
    } catch {
      // skip unreadable metadata files
    }
  }
  return removed;
}
