import Editor from "@/components/Editor";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <Editor anonymousUploads={process.env.MD_SHARE_ALLOW_ANONYMOUS_UPLOADS === "true"} />;
}
