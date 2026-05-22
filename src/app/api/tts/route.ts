import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getPool } from "@/lib/db";
import { readSession } from "@/lib/session";
import { applyReplacements, getTtsReplacements } from "@/lib/replacements";

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech/";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TEXT_LEN = 200;

type CharRow = RowDataPacket & { voice_id: string };

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const slug = typeof body?.speakerSlug === "string" ? body.speakerSlug : "";
  if (!text || !slug) {
    return NextResponse.json({ error: "text と speakerSlug が必要" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LEN) {
    return NextResponse.json({ error: "テキストが長すぎます" }, { status: 400 });
  }

  const pool = getPool();
  const [rows] = await pool.query<CharRow[]>(
    "SELECT voice_id FROM characters WHERE slug = ? LIMIT 1",
    [slug],
  );
  const voiceId = rows[0]?.voice_id;
  if (!voiceId) return NextResponse.json({ error: "unknown speaker" }, { status: 400 });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  // TTS置換適用（画面表示テキストは置き換え前のもの＝そのまま、音声だけ置換版を渡す）
  const pairs = await getTtsReplacements();
  const replaced = applyReplacements(text, pairs);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${ENDPOINT}${encodeURIComponent(voiceId)}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: replaced,
        model_id: "eleven_v3",
        language_code: "ja",
        output_format: "mp3_44100_64",
        voice_settings: {
          stability: 1.0,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `ElevenLabs ${res.status}`, detail: detail.slice(0, 400) },
        { status: 502 },
      );
    }

    const mp3 = await res.arrayBuffer();
    return new NextResponse(mp3, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Length": String(mp3.byteLength),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tts error";
    return NextResponse.json({ error: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
