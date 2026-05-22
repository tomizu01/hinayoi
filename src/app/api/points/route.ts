import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { catchupTick, getAllPoints } from "@/lib/points";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await catchupTick();
  const points = await getAllPoints();
  return NextResponse.json({
    points: points.map((p) => ({ slug: p.slug, display_name: p.display_name, points: p.points })),
  });
}
