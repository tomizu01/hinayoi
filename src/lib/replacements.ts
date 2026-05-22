import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

type ReplRow = RowDataPacket & { src: string; dst: string };

let asrCache: { at: number; pairs: Array<[string, string]> } | null = null;
let ttsCache: { at: number; pairs: Array<[string, string]> } | null = null;
const CACHE_TTL_MS = 30_000;

async function loadPairs(table: "asr_replacements" | "tts_replacements") {
  const pool = getPool();
  // 長い方から置換するため長さ降順
  const [rows] = await pool.query<ReplRow[]>(
    `SELECT src, dst FROM ${table} ORDER BY CHAR_LENGTH(src) DESC`,
  );
  return rows.map((r) => [r.src, r.dst] as [string, string]);
}

export async function getAsrReplacements(): Promise<Array<[string, string]>> {
  const now = Date.now();
  if (asrCache && now - asrCache.at < CACHE_TTL_MS) return asrCache.pairs;
  const pairs = await loadPairs("asr_replacements");
  asrCache = { at: now, pairs };
  return pairs;
}

export async function getTtsReplacements(): Promise<Array<[string, string]>> {
  const now = Date.now();
  if (ttsCache && now - ttsCache.at < CACHE_TTL_MS) return ttsCache.pairs;
  const pairs = await loadPairs("tts_replacements");
  ttsCache = { at: now, pairs };
  return pairs;
}

export function applyReplacements(text: string, pairs: Array<[string, string]>): string {
  let out = text;
  for (const [src, dst] of pairs) {
    if (!src) continue;
    out = out.split(src).join(dst);
  }
  return out;
}
