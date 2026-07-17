import { parseDocumentMetadata, type DocumentMetadata } from "@/lib/owned-documents";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export class DocumentManagementError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "MANAGEMENT_REQUEST_FAILED") {
    super(message);
    this.name = "DocumentManagementError";
    this.status = status;
    this.code = code;
  }
}

function endpoint(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}`;
}

async function errorFromResponse(response: Response): Promise<DocumentManagementError> {
  let code = "MANAGEMENT_REQUEST_FAILED";
  let message = `Request failed (HTTP ${response.status}).`;
  try {
    const body = (await response.json()) as {
      error?: string | { code?: string; message?: string };
    };
    if (typeof body.error === "string" && body.error) message = body.error;
    if (body.error && typeof body.error === "object") {
      if (body.error.code) code = body.error.code;
      if (body.error.message) message = body.error.message;
    }
  } catch {
    // Keep the stable HTTP fallback when the response is not JSON.
  }
  return new DocumentManagementError(message, response.status, code);
}

async function metadataFromResponse(response: Response): Promise<DocumentMetadata> {
  const metadata = parseDocumentMetadata(await response.json());
  if (!metadata) {
    throw new DocumentManagementError(
      "The server returned invalid document metadata.",
      response.status,
      "INVALID_RESPONSE"
    );
  }
  return metadata;
}

export async function getDocumentMetadata(
  id: string,
  fetcher: FetchLike = fetch
): Promise<DocumentMetadata | null> {
  const response = await fetcher(endpoint(id), {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFromResponse(response);
  return metadataFromResponse(response);
}

export async function updateDocumentExpiry(
  id: string,
  manageToken: string,
  ttlDays: number | null,
  fetcher: FetchLike = fetch
): Promise<DocumentMetadata> {
  const response = await fetcher(endpoint(id), {
    method: "PATCH",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${manageToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ ttlDays })
  });
  if (!response.ok) throw await errorFromResponse(response);
  return metadataFromResponse(response);
}

export async function deleteManagedDocument(
  id: string,
  manageToken: string,
  fetcher: FetchLike = fetch
): Promise<"deleted" | "missing"> {
  const response = await fetcher(endpoint(id), {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` }
  });
  if (response.status === 404) return "missing";
  if (!response.ok) throw await errorFromResponse(response);
  return "deleted";
}
