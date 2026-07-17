import type { Metadata } from "next";
import AdminConsole from "@/components/AdminConsole";

export const metadata: Metadata = { title: "Operations console · md-share" };
export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminConsole />;
}
