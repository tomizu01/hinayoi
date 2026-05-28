import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { ensureNomikaiSession } from "./nomikai";

const TICK_MS = 10_000;
const TICK_GAIN = 10;
const MENTION_GAIN = 100;
const SPEAKER_THRESHOLD = 100;

type CharPointRow = RowDataPacket & {
  id: number;
  slug: string;
  display_name: string;
  points: number;
};

type SessionTickRow = RowDataPacket & {
  points_last_tick_at: Date | null;
};

export type CharPoint = {
  id: number;
  slug: string;
  display_name: string;
  points: number;
};

async function readLastTickAt(sessionId: string): Promise<Date | null> {
  const pool = getPool();
  const [rows] = await pool.query<SessionTickRow[]>(
    "SELECT points_last_tick_at FROM nomikai_sessions WHERE id = ? LIMIT 1",
    [sessionId],
  );
  return rows[0]?.points_last_tick_at ?? null;
}

export async function catchupTick(sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  await ensureNomikaiSession(sessionId);
  const last = await readLastTickAt(sessionId);
  if (!last) return;
  const now = Date.now();
  const elapsed = now - last.getTime();
  const fullTicks = Math.floor(elapsed / TICK_MS);
  if (fullTicks <= 0) return;
  const gain = TICK_GAIN * fullTicks;
  const newLast = new Date(last.getTime() + fullTicks * TICK_MS);
  const pool = getPool();
  await pool.query(
    `UPDATE nomikai_session_character_points
        SET points = points + ?
      WHERE nomikai_session_id = ?`,
    [gain, sessionId],
  );
  await pool.query(
    "UPDATE nomikai_sessions SET points_last_tick_at = ? WHERE id = ?",
    [newLast, sessionId],
  );
}

export async function getAllPoints(sessionId: string | null): Promise<CharPoint[]> {
  if (!sessionId) return [];
  await ensureNomikaiSession(sessionId);
  const pool = getPool();
  const [rows] = await pool.query<CharPointRow[]>(
    `SELECT c.id, c.slug, c.display_name, COALESCE(p.points, 0) AS points
       FROM characters c
       LEFT JOIN nomikai_session_character_points p
         ON p.character_id = c.id AND p.nomikai_session_id = ?
      ORDER BY c.position ASC`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    display_name: r.display_name,
    points: r.points,
  }));
}

export async function applyMentionBonus(
  sessionId: string | null,
  text: string,
  excludeSlug?: string,
): Promise<void> {
  if (!sessionId) return;
  await ensureNomikaiSession(sessionId);
  const pool = getPool();
  const [chars] = await pool.query<CharPointRow[]>(
    "SELECT id, slug, display_name FROM characters",
  );
  // キャラ発言時は文の後半のみ判定（末尾の問いかけを拾う）
  let target = text;
  if (excludeSlug) {
    const arr = [...text];
    const start = Math.floor(arr.length / 2);
    target = arr.slice(start).join("");
  }
  for (const c of chars) {
    if (excludeSlug && c.slug === excludeSlug) continue;
    if (target.includes(c.display_name)) {
      await pool.query(
        `UPDATE nomikai_session_character_points
            SET points = points + ?
          WHERE nomikai_session_id = ? AND character_id = ?`,
        [MENTION_GAIN, sessionId, c.id],
      );
    }
  }
}

export async function resetSpeakerPoints(
  sessionId: string | null,
  slug: string,
): Promise<void> {
  if (!sessionId) return;
  const pool = getPool();
  await pool.query(
    `UPDATE nomikai_session_character_points p
       JOIN characters c ON c.id = p.character_id
        SET p.points = 0
      WHERE p.nomikai_session_id = ? AND c.slug = ?`,
    [sessionId, slug],
  );
}

export async function pickSpeaker(sessionId: string | null): Promise<CharPoint | null> {
  if (!sessionId) return null;
  const all = await getAllPoints(sessionId);
  if (all.length === 0) return null;
  const over = all.filter((c) => c.points > SPEAKER_THRESHOLD);
  if (over.length > 0) {
    return over[Math.floor(Math.random() * over.length)];
  }
  const max = Math.max(...all.map((c) => c.points));
  const top = all.filter((c) => c.points === max);
  return top[Math.floor(Math.random() * top.length)];
}
