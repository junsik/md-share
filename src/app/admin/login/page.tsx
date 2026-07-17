import type { Metadata } from "next";
import AdminLoginForm from "@/components/AdminLoginForm";

export const metadata: Metadata = { title: "Administrator sign in · md-share" };

export default function AdminLoginPage() {
  return <AdminLoginForm />;
}
