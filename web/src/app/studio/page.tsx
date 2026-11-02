import type { Metadata } from "next";
import { Suspense } from "react";
import { Studio } from "@/components/studio/Studio";

export const metadata: Metadata = { title: "Studio · Auteur" };

export default function StudioPage() {
  // Studio reads ?recipe=, which needs a Suspense boundary under cacheComponents.
  return (
    <Suspense>
      <Studio />
    </Suspense>
  );
}
