"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { signOut } from "@/lib/auth";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    // Sign out using Better Auth and redirect to the home page
    signOut().then(() => {
      router.push("/");
    });
  }, [router]);

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Logging out...</h1>
        <p className="mt-2 text-muted-foreground">
          You will be redirected shortly.
        </p>
      </div>
    </div>
  );
}
