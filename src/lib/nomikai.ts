import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { cookies } from "next/headers";
import { getPool } from "./db";

export const NOMIKAI_COOKIE_NAME = "hinayoi_nomikai";

const POINTS_INIT_MIN = 0;
const POINTS_INIT_MAX = 100;

export async function getNomikaiSessionId(): Promise<string | null> {
  const c = await cookies();
  return c.get(NOMIKAI_COOKIE_NAME)?.value ?? null;
}

type CharIdRow = RowDataPacket & { id: number };

// 飲み会セッション行と各キャラの初期ポイント行を冪等に作る。
// 既存セッションなら何もしない（INSERT IGNORE）。
export async function ensureNomikaiSession(sessionId: string): Promise<void> {
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO nomikai_sessions (id, points_last_tick_at)
     VALUES (?, NOW(3))`,
    [sessionId],
  );
  if (result.affectedRows === 0) return;

  const [chars] = await pool.query<CharIdRow[]>("SELECT id FROM characters");
  for (const c of chars) {
    const v =
      Math.floor(Math.random() * (POINTS_INIT_MAX - POINTS_INIT_MIN + 1)) +
      POINTS_INIT_MIN;
    await pool.query(
      `INSERT IGNORE INTO nomikai_session_character_points
        (nomikai_session_id, character_id, points)
       VALUES (?, ?, ?)`,
      [sessionId, c.id, v],
    );
  }
}
