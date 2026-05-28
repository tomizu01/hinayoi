import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

const NORMAL_DURATION_MS = 1 * 60 * 4 * 1000;
const ORDER_DURATION_MS = 1 * 30 * 1000;
const NORMALS_BEFORE_ORDER = 3;
const ORDER_TIME_TEXT = "追加注文タイム";

const KEY_TOPIC_ID = "current_topic_id";
const KEY_TOPIC_KIND = "current_topic_kind"; // 'normal' | 'order'
const KEY_ROTATED_AT = "topic_rotated_at";
const KEY_NORMALS_PLAYED = "topic_normals_played";

export type TopicKind = "normal" | "order";

export type TopicInfo = {
  topicId: number;
  text: string;
  kind: TopicKind;
  rotatedAt: string; // ISO
  nextRotateAt: string; // ISO
  now: string; // ISO
};

type StateRow = RowDataPacket & { k: string; v: string };
type TopicRow = RowDataPacket & { id: number; text: string };

async function readState(): Promise<Record<string, string>> {
  const pool = getPool();
  const [rows] = await pool.query<StateRow[]>(
    "SELECT k, v FROM app_state WHERE k IN (?, ?, ?, ?)",
    [KEY_TOPIC_ID, KEY_TOPIC_KIND, KEY_ROTATED_AT, KEY_NORMALS_PLAYED],
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.k] = r.v;
  return map;
}

async function saveState(updates: Record<string, string>) {
  const entries = Object.entries(updates);
  if (entries.length === 0) return;
  const pool = getPool();
  const placeholders = entries.map(() => "(?, ?)").join(", ");
  const params = entries.flatMap(([k, v]) => [k, v]);
  await pool.query(
    `INSERT INTO app_state (k, v) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE v = VALUES(v)`,
    params,
  );
}

async function pickRandomTopic(): Promise<TopicRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<TopicRow[]>(
    "SELECT id, text FROM topics WHERE is_active = 1 ORDER BY RAND() LIMIT 1",
  );
  return rows[0] ?? null;
}

async function pickRandomTopicExcluding(currentId: number): Promise<TopicRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<TopicRow[]>(
    "SELECT id, text FROM topics WHERE is_active = 1 AND id <> ? ORDER BY RAND() LIMIT 1",
    [currentId],
  );
  if (rows[0]) return rows[0];
  return pickRandomTopic();
}

async function getTopicById(id: number): Promise<TopicRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<TopicRow[]>(
    "SELECT id, text FROM topics WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ?? null;
}

function durationFor(kind: TopicKind): number {
  return kind === "order" ? ORDER_DURATION_MS : NORMAL_DURATION_MS;
}

function buildInfo(
  topicId: number,
  text: string,
  kind: TopicKind,
  rotatedAt: Date,
  now: Date,
): TopicInfo {
  return {
    topicId,
    text,
    kind,
    rotatedAt: rotatedAt.toISOString(),
    nextRotateAt: new Date(rotatedAt.getTime() + durationFor(kind)).toISOString(),
    now: now.toISOString(),
  };
}

function fallbackInfo(now: Date): TopicInfo {
  return buildInfo(0, "（話題未設定）", "normal", now, now);
}

export async function getCurrentTopic(): Promise<TopicInfo> {
  const now = new Date();
  const state = await readState();

  const storedId = state[KEY_TOPIC_ID] ? Number(state[KEY_TOPIC_ID]) : null;
  const storedKindRaw = state[KEY_TOPIC_KIND];
  const storedKind: TopicKind | null =
    storedKindRaw === "normal" || storedKindRaw === "order" ? storedKindRaw : null;
  const storedRotatedAt = state[KEY_ROTATED_AT] ? new Date(state[KEY_ROTATED_AT]) : null;
  const storedNormals = state[KEY_NORMALS_PLAYED] ? Number(state[KEY_NORMALS_PLAYED]) : 0;

  const hasState =
    storedKind !== null &&
    storedRotatedAt !== null &&
    !isNaN(storedRotatedAt.getTime());

  // 初期化: 通常話題から開始
  if (!hasState) {
    const t = await pickRandomTopic();
    if (!t) return fallbackInfo(now);
    await saveState({
      [KEY_TOPIC_ID]: String(t.id),
      [KEY_TOPIC_KIND]: "normal",
      [KEY_ROTATED_AT]: now.toISOString(),
      [KEY_NORMALS_PLAYED]: "1",
    });
    return buildInfo(t.id, t.text, "normal", now, now);
  }

  const currentDuration = durationFor(storedKind!);
  const expired = now.getTime() - storedRotatedAt!.getTime() >= currentDuration;

  // 期限内: 現状を返す
  if (!expired) {
    if (storedKind === "order") {
      return buildInfo(0, ORDER_TIME_TEXT, "order", storedRotatedAt!, now);
    }
    const t = storedId ? await getTopicById(storedId) : null;
    if (t) {
      return buildInfo(t.id, t.text, "normal", storedRotatedAt!, now);
    }
    // DBから消えていた → 引き直し（即時ローテーション扱い）
    const fresh = await pickRandomTopic();
    if (!fresh) return fallbackInfo(now);
    await saveState({
      [KEY_TOPIC_ID]: String(fresh.id),
      [KEY_TOPIC_KIND]: "normal",
      [KEY_ROTATED_AT]: now.toISOString(),
      [KEY_NORMALS_PLAYED]: "1",
    });
    return buildInfo(fresh.id, fresh.text, "normal", now, now);
  }

  // ローテーション
  if (storedKind === "normal") {
    if (storedNormals >= NORMALS_BEFORE_ORDER) {
      // 通常 → 追加注文タイム
      await saveState({
        [KEY_TOPIC_KIND]: "order",
        [KEY_ROTATED_AT]: now.toISOString(),
      });
      return buildInfo(0, ORDER_TIME_TEXT, "order", now, now);
    }
    // 通常 → 次の通常話題
    const t = await pickRandomTopicExcluding(storedId ?? 0);
    if (!t) return fallbackInfo(now);
    await saveState({
      [KEY_TOPIC_ID]: String(t.id),
      [KEY_TOPIC_KIND]: "normal",
      [KEY_ROTATED_AT]: now.toISOString(),
      [KEY_NORMALS_PLAYED]: String(storedNormals + 1),
    });
    return buildInfo(t.id, t.text, "normal", now, now);
  }

  // 追加注文 → 新しい通常話題（カウンタは 1 にリセット）
  const t = await pickRandomTopic();
  if (!t) return fallbackInfo(now);
  await saveState({
    [KEY_TOPIC_ID]: String(t.id),
    [KEY_TOPIC_KIND]: "normal",
    [KEY_ROTATED_AT]: now.toISOString(),
    [KEY_NORMALS_PLAYED]: "1",
  });
  return buildInfo(t.id, t.text, "normal", now, now);
}

export const TOPIC_ROTATE_INTERVAL_MS = NORMAL_DURATION_MS;
