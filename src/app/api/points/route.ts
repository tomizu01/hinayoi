import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getNomikaiSessionId } from "@/lib/nomikai";
import { catchupTick, getAllPoints } from "@/lib/points";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const nomikaiSessionId = await getNomikaiSessionId();
  await catchupTick(nomikaiSessionId);
  const points = await getAllPoints(nomikaiSessionId);
  return NextResponse.json({
    points: points.map((p) => ({ slug: p.slug, display_name: p.display_name, points: p.points })),
  });
}
