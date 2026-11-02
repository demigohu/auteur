import { Suspense } from "react";
import { Editor, EditorSkeleton } from "@/components/editor/Editor";

export default function EditorPage({ params }: PageProps<"/p/[id]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditorRoute params={params} />
    </Suspense>
  );
}

async function EditorRoute({ params }: { params: PageProps<"/p/[id]">["params"] }) {
  const { id } = await params;
  return <Editor projectId={id} />;
}
