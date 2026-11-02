import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";

export const metadata: Metadata = { title: "Create account · Auteur" };

export default function Page() {
  // AuthScreen reads ?next=, which needs a Suspense boundary under cacheComponents.
  return (
    <Suspense>
      <AuthScreen mode="signup" />
    </Suspense>
  );
}
