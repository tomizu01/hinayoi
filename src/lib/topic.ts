import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";

const TOPIC_ROTATE_MS = 4 * 60 * 1000;

const KEY_TOPIC_ID = "current_topic_id";
const KEY_ROTATED_AT = "topic_rotated_at";

export type TopicInfo = {
  topicId: number;
  text: string;
  rotatedAt: string; // ISO
  nextRotateAt: string; // ISO
  now: string; // ISO
};

type StateRow = RowDataPacket & { k: string; v: string };
type TopicRow = RowDataPacket & { id: number; text: string };

async function readState() {
  const pool = getPool();
  const [rows] = await pool.query<StateRow[]>(
    "SELECT k, v FROM app_state WHERE k IN (?, ?)",
    [KEY_TOPIC_ID, KEY_ROTATED_AT],
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.k] = r.v;
  return map;
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
  // フォールバック：他に話題がなければ同じ話題を返す
  return pickRandomTopic();
}

async function saveState(topicId: number, rotatedAt: Date) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO app_state (k, v) VALUES (?, ?), (?, ?)
     ON DUPLICATE KEY UPDATE v = VALUES(v)`,
    [KEY_TOPIC_ID, String(topicId), KEY_ROTATED_AT, rotatedAt.toISOString()],
  );
}

async function getTopicById(id: number): Promise<TopicRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<TopicRow[]>(
    "SELECT id, text FROM topics WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ?? null;
}

export async function getCurrentTopic(): Promise<TopicInfo> {
  const now = new Date();
  const state = await readState();

  const storedId = state[KEY_TOPIC_ID] ? Number(state[KEY_TOPIC_ID]) : null;
  const storedRotatedAt = state[KEY_ROTATED_AT] ? new Date(state[KEY_ROTATED_AT]) : null;

  const expired =
    !storedId ||
    !storedRotatedAt ||
    isNaN(storedRotatedAt.getTime()) ||
    now.getTime() - storedRotatedAt.getTime() >= TOPIC_ROTATE_MS;

  let topic: TopicRow | null = null;
  let rotatedAt: Date;

  if (expired) {
    topic = storedId ? await pickRandomTopicExcluding(storedId) : await pickRandomTopic();
    rotatedAt = now;
    if (topic) {
      await saveState(topic.id, rotatedAt);
    }
  } else {
    topic = await getTopicById(storedId!);
    rotatedAt = storedRotatedAt!;
    if (!topic) {
      // 削除されていた場合は引き直し
      topic = await pickRandomTopic();
      rotatedAt = now;
      if (topic) await saveState(topic.id, rotatedAt);
    }
  }

  if (!topic) {
    return {
      topicId: 0,
      text: "（話題未設定）",
      rotatedAt: now.toISOString(),
      nextRotateAt: new Date(now.getTime() + TOPIC_ROTATE_MS).toISOString(),
      now: now.toISOString(),
    };
  }

  return {
    topicId: topic.id,
    text: topic.text,
    rotatedAt: rotatedAt.toISOString(),
    nextRotateAt: new Date(rotatedAt.getTime() + TOPIC_ROTATE_MS).toISOString(),
    now: now.toISOString(),
  };
}

export const TOPIC_ROTATE_INTERVAL_MS = TOPIC_ROTATE_MS;
