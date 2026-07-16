import { NextResponse } from "next/server";
import { checkUploadAuth } from "@/lib/auth";
import { getStorageStats } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkUploadAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "UPLOAD_AUTH_FAILED", message: auth.message } },
      { status: auth.status }
    );
  }
  try {
    return NextResponse.json({ status: "ok", storage: await getStorageStats() });
  } catch (error) {
    console.error("storage_status_failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json(
      { error: { code: "STORAGE_UNAVAILABLE", message: "storage status is unavailable" } },
      { status: 503 }
    );
  }
}
