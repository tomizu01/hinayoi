import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getNomikaiSessionId } from "@/lib/nomikai";
import { getRecentConversations, insertConversation } from "@/lib/conversation";
import { applyReplacements, getAsrReplacements } from "@/lib/replacements";
import { getCurrentTopic } from "@/lib/topic";
import { applyMentionBonus, catchupTick, getAllPoints } from "@/lib/points";

export async function GET(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 30;
  const nomikaiSessionId = await getNomikaiSessionId();
  const items = await getRecentConversations(
    nomikaiSessionId,
    Number.isFinite(limit) ? limit : 30,
  );
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const rawText = typeof body?.text === "string" ? body.text : "";
  const trimmed = rawText.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "本文が空です" }, { status: 400 });
  }
  if (trimmed.length > 500) {
    return NextResponse.json({ error: "本文が長すぎます" }, { status: 400 });
  }

  // ASR置換を保存前に適用（仕様: 置換後にDB保存・ポイント判定を行う）
  const pairs = await getAsrReplacements();
  const replaced = applyReplacements(trimmed, pairs);

  const nomikaiSessionId = await getNomikaiSessionId();
  const topic = await getCurrentTopic(nomikaiSessionId);
  const speakerName = session.nickname;
  // ポイントtickをキャッチアップ → 保存 → 名前+100（ユーザーは自分判定対象外なので全員チェック）
  await catchupTick(nomikaiSessionId);
  const id = await insertConversation({
    speakerKind: "user",
    speakerName,
    text: replaced,
    topicId: topic.topicId || null,
    nomikaiSessionId,
  });
  await applyMentionBonus(nomikaiSessionId, replaced);
  const points = await getAllPoints(nomikaiSessionId);

  return NextResponse.json({
    id,
    speakerKind: "user",
    speakerName,
    text: replaced,
    topicId: topic.topicId || null,
    points: points.map((p) => ({ slug: p.slug, display_name: p.display_name, points: p.points })),
  });
}
