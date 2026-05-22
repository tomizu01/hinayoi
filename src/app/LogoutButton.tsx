"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function onClick() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/20 disabled:opacity-50"
    >
      ログアウト
    </button>
  );
}
