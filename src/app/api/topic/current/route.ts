import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getCurrentTopic } from "@/lib/topic";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const topic = await getCurrentTopic();
  return NextResponse.json(topic);
}
