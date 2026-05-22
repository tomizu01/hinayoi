import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

const TICK_MS = 10_000;
const TICK_GAIN = 15;
const MENTION_GAIN = 100;
const SPEAKER_LOSS = -100;
const INIT_MIN = 0;
const INIT_MAX = 100;
const SPEAKER_THRESHOLD = 100;

const KEY_INITIALIZED = "points_initialized";
const KEY_LAST_TICK = "points_last_tick_at";

type CharRow = RowDataPacket & {
  id: number;
  slug: string;
  display_name: string;
  points: number;
};

type StateRow = RowDataPacket & { k: string; v: string };

export type CharPoint = {
  id: number;
  slug: string;
  display_name: string;
  points: number;
};

async function readStateMap(): Promise<Record<string, string>> {
  const pool = getPool();
  const [rows] = await pool.query<StateRow[]>(
    "SELECT k, v FROM app_state WHERE k IN (?, ?)",
    [KEY_INITIALIZED, KEY_LAST_TICK],
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.k] = r.v;
  return map;
}

async function setState(k: string, v: string) {
  const pool = getPool();
  await pool.query(
    "INSERT INTO app_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
    [k, v],
  );
}

export async function ensureInitialized(): Promise<void> {
  const state = await readStateMap();
  if (state[KEY_INITIALIZED] === "1") return;

  const pool = getPool();
  const [chars] = await pool.query<CharRow[]>("SELECT id FROM characters");
  for (const c of chars) {
    const v = Math.floor(Math.random() * (INIT_MAX - INIT_MIN + 1)) + INIT_MIN;
    await pool.query("UPDATE characters SET points = ? WHERE id = ?", [v, c.id]);
  }
  await setState(KEY_INITIALIZED, "1");
  await setState(KEY_LAST_TICK, String(Date.now()));
}

export async function catchupTick(): Promise<void> {
  await ensureInitialized();
  const state = await readStateMap();
  const now = Date.now();
  const last = Number(state[KEY_LAST_TICK]) || now;
  const elapsed = now - last;
  const fullTicks = Math.floor(elapsed / TICK_MS);
  if (fullTicks <= 0) return;
  const gain = TICK_GAIN * fullTicks;
  const pool = getPool();
  await pool.query("UPDATE characters SET points = points + ?", [gain]);
  await setState(KEY_LAST_TICK, String(last + fullTicks * TICK_MS));
}

export async function getAllPoints(): Promise<CharPoint[]> {
  const pool = getPool();
  const [rows] = await pool.query<CharRow[]>(
    "SELECT id, slug, display_name, points FROM characters ORDER BY position ASC",
  );
  return rows;
}

export async function applyMentionBonus(text: string, excludeSlug?: string): Promise<void> {
  const pool = getPool();
  const [chars] = await pool.query<CharRow[]>(
    "SELECT id, slug, display_name FROM characters",
  );
  for (const c of chars) {
    if (excludeSlug && c.slug === excludeSlug) continue;
    if (text.includes(c.display_name)) {
      await pool.query(
        "UPDATE characters SET points = points + ? WHERE id = ?",
        [MENTION_GAIN, c.id],
      );
    }
  }
}

export async function applySpeakerLoss(slug: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "UPDATE characters SET points = GREATEST(0, points + ?) WHERE slug = ?",
    [SPEAKER_LOSS, slug],
  );
}

export async function pickSpeaker(): Promise<CharPoint | null> {
  const all = await getAllPoints();
  if (all.length === 0) return null;
  const over = all.filter((c) => c.points > SPEAKER_THRESHOLD);
  if (over.length > 0) {
    return over[Math.floor(Math.random() * over.length)];
  }
  const max = Math.max(...all.map((c) => c.points));
  const top = all.filter((c) => c.points === max);
  return top[Math.floor(Math.random() * top.length)];
}
