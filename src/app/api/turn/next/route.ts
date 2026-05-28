import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getNomikaiSessionId } from "@/lib/nomikai";
import { runTurn } from "@/lib/turn";

export async function POST() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const nomikaiSessionId = await getNomikaiSessionId();
    const result = await runTurn(nomikaiSessionId, session.nickname);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
