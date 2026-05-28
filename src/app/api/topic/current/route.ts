import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getNomikaiSessionId } from "@/lib/nomikai";
import { getCurrentTopic } from "@/lib/topic";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const nomikaiSessionId = await getNomikaiSessionId();
  const topic = await getCurrentTopic(nomikaiSessionId);
  return NextResponse.json(topic);
}
