import type { Metadata } from "next";
import { Suspense } from "react";
import { PhoneUpload } from "@/components/editor/PhoneUpload";

export const metadata: Metadata = { title: "Upload from phone · Auteur" };

/** Opened from the editor's QR code: pick footage or photos on the phone; they land in the project. */
export default function PhoneUploadPage({ params }: PageProps<"/p/[id]/upload">) {
  return (
    <Suspense fallback={null}>
      <Route params={params} />
    </Suspense>
  );
}

async function Route({ params }: { params: PageProps<"/p/[id]/upload">["params"] }) {
  const { id } = await params;
  return <PhoneUpload projectId={id} />;
}
