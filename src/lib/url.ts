export function publicBaseUrl(request: Request): string {
  const configured = process.env.MD_SHARE_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    return `${proto}://${forwardedHost}`;
  }
  return url.origin;
}

export function shareUrls(baseUrl: string, id: string): { url: string; rawUrl: string } {
  return {
    url: `${baseUrl}/d/${id}`,
    rawUrl: `${baseUrl}/api/documents/${id}/raw`
  };
}
