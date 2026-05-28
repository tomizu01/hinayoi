import type { RowDataPacket } from "mysql2";
import { getPool } from "./db";
import { ensureNomikaiSession } from "./nomikai";

const NORMAL_DURATION_MS = 1 * 60 * 4 * 1000;
const ORDER_DURATION_MS = 1 * 30 * 1000;
const NORMALS_BEFORE_ORDER = 3;
const ORDER_TIME_TEXT = "追加注文タイム";

// 飲み会の最大時間（α版は1時間固定）
const SESSION_MAX_MS = 60 * 60 * 1000;
// 締めの挨拶タイムの長さ
const CLOSING_DURATION_MS = 2 * 60 * 1000;
const CLOSING_TOPIC_TEXT = "飲み会終了";
// 終了状態は実質ローテートしない（十分に長い時間を返してクライアントポーリングを止める）
const ENDED_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export type TopicKind = "normal" | "order" | "closing" | "ended";

export type TopicInfo = {
  topicId: number;
  text: string;
  kind: TopicKind;
  rotatedAt: string; // ISO
  nextRotateAt: string; // ISO
  now: string; // ISO
  sessionEndAt: string; // ISO: 飲み会の終了予定時刻 (created_at + SESSION_MAX_MS)
};

type SessionRow = RowDataPacket & {
  current_topic_id: number | null;
  current_topic_kind: TopicKind;
  topic_rotated_at: Date | null;
  topic_normals_played: number;
  created_at: Date;
};

type TopicRow = RowDataPacket & { id: number; text: string };

async function readSession(sessionId: string): Promise<SessionRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<SessionRow[]>(
    `SELECT current_topic_id, current_topic_kind, topic_rotated_at, topic_normals_played, created_at
       FROM nomikai_sessions WHERE id = ? LIMIT 1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

async function updateSession(
  sessionId: string,
  fields: {
    currentTopicId?: number | null;
    currentTopicKind?: TopicKind;
    topicRotatedAt?: Date;
    topicNormalsPlayed?: number;
  },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.currentTopicId !== undefined) {
    sets.push("current_topic_id = ?");
    params.push(fields.currentTopicId);
  }
  if (fields.currentTopicKind !== undefined) {
    sets.push("current_topic_kind = ?");
    params.push(fields.currentTopicKind);
  }
  if (fields.topicRotatedAt !== undefined) {
    sets.push("topic_rotated_at = ?");
    params.push(fields.topicRotatedAt);
  }
  if (fields.topicNormalsPlayed !== undefined) {
    sets.push("topic_normals_played = ?");
    params.push(fields.topicNormalsPlayed);
  }
  if (sets.length === 0) return;
  params.push(sessionId);
  const pool = getPool();
  await pool.query(
    `UPDATE nomikai_sessions SET ${sets.join(", ")} WHERE id = ?`,
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
  if (kind === "closing") return CLOSING_DURATION_MS;
  if (kind === "order") return ORDER_DURATION_MS;
  if (kind === "ended") return ENDED_DURATION_MS;
  return NORMAL_DURATION_MS;
}

function buildInfo(
  topicId: number,
  text: string,
  kind: TopicKind,
  rotatedAt: Date,
  now: Date,
  sessionEndMs: number,
): TopicInfo {
  return {
    topicId,
    text,
    kind,
    rotatedAt: rotatedAt.toISOString(),
    nextRotateAt: new Date(rotatedAt.getTime() + durationFor(kind)).toISOString(),
    now: now.toISOString(),
    sessionEndAt: new Date(sessionEndMs).toISOString(),
  };
}

function fallbackInfo(now: Date): TopicInfo {
  return buildInfo(0, "（話題未設定）", "normal", now, now, now.getTime() + SESSION_MAX_MS);
}

export async function getCurrentTopic(sessionId: string | null): Promise<TopicInfo> {
  const now = new Date();
  if (!sessionId) return fallbackInfo(now);

  await ensureNomikaiSession(sessionId);
  const session = await readSession(sessionId);
  if (!session) return fallbackInfo(now);

  const sessionStartMs = session.created_at.getTime();
  const sessionEndMs = sessionStartMs + SESSION_MAX_MS;

  const storedKind = session.current_topic_kind;
  const storedRotatedAt = session.topic_rotated_at;
  const storedId = session.current_topic_id;
  const storedNormals = session.topic_normals_played;

  // 終了状態: 永続的に終了を返す（ローテートしない）
  if (storedKind === "ended") {
    const rotatedAt = storedRotatedAt ?? now;
    return buildInfo(0, CLOSING_TOPIC_TEXT, "ended", rotatedAt, now, sessionEndMs);
  }

  // 初期化: topic_rotated_at が NULL なら最初のローテーション扱い
  if (!storedRotatedAt) {
    // 何らかの理由で既に飲み会終了時刻を過ぎている場合は即 closing へ
    if (now.getTime() >= sessionEndMs) {
      await updateSession(sessionId, {
        currentTopicId: null,
        currentTopicKind: "closing",
        topicRotatedAt: now,
        topicNormalsPlayed: 0,
      });
      return buildInfo(0, CLOSING_TOPIC_TEXT, "closing", now, now, sessionEndMs);
    }
    const t = await pickRandomTopic();
    if (!t) return fallbackInfo(now);
    await updateSession(sessionId, {
      currentTopicId: t.id,
      currentTopicKind: "normal",
      topicRotatedAt: now,
      topicNormalsPlayed: 1,
    });
    return buildInfo(t.id, t.text, "normal", now, now, sessionEndMs);
  }

  const currentDuration = durationFor(storedKind);
  const expired = now.getTime() - storedRotatedAt.getTime() >= currentDuration;

  // 期限内: 現状を返す
  if (!expired) {
    if (storedKind === "closing") {
      return buildInfo(0, CLOSING_TOPIC_TEXT, "closing", storedRotatedAt, now, sessionEndMs);
    }
    if (storedKind === "order") {
      return buildInfo(0, ORDER_TIME_TEXT, "order", storedRotatedAt, now, sessionEndMs);
    }
    const t = storedId ? await getTopicById(storedId) : null;
    if (t) return buildInfo(t.id, t.text, "normal", storedRotatedAt, now, sessionEndMs);
    // 話題が削除されていた → 即時引き直し
    const fresh = await pickRandomTopic();
    if (!fresh) return fallbackInfo(now);
    await updateSession(sessionId, {
      currentTopicId: fresh.id,
      currentTopicKind: "normal",
      topicRotatedAt: now,
      topicNormalsPlayed: 1,
    });
    return buildInfo(fresh.id, fresh.text, "normal", now, now, sessionEndMs);
  }

  // ─── ローテーション ───

  // closing → ended（締めの挨拶タイム終了）
  if (storedKind === "closing") {
    await updateSession(sessionId, {
      currentTopicId: null,
      currentTopicKind: "ended",
      topicRotatedAt: now,
    });
    return buildInfo(0, CLOSING_TOPIC_TEXT, "ended", now, now, sessionEndMs);
  }

  // 飲み会の終了時刻を過ぎていれば次は closing に遷移（normal/order からの遷移）
  if (now.getTime() >= sessionEndMs) {
    await updateSession(sessionId, {
      currentTopicId: null,
      currentTopicKind: "closing",
      topicRotatedAt: now,
    });
    return buildInfo(0, CLOSING_TOPIC_TEXT, "closing", now, now, sessionEndMs);
  }

  // 通常 → 通常 or 通常 → order
  if (storedKind === "normal") {
    if (storedNormals >= NORMALS_BEFORE_ORDER) {
      await updateSession(sessionId, {
        currentTopicKind: "order",
        currentTopicId: null,
        topicRotatedAt: now,
      });
      return buildInfo(0, ORDER_TIME_TEXT, "order", now, now, sessionEndMs);
    }
    const t = await pickRandomTopicExcluding(storedId ?? 0);
    if (!t) return fallbackInfo(now);
    await updateSession(sessionId, {
      currentTopicId: t.id,
      currentTopicKind: "normal",
      topicRotatedAt: now,
      topicNormalsPlayed: storedNormals + 1,
    });
    return buildInfo(t.id, t.text, "normal", now, now, sessionEndMs);
  }

  // 追加注文 → 新しい通常話題（カウンタ 1 リセット）
  const t = await pickRandomTopic();
  if (!t) return fallbackInfo(now);
  await updateSession(sessionId, {
    currentTopicId: t.id,
    currentTopicKind: "normal",
    topicRotatedAt: now,
    topicNormalsPlayed: 1,
  });
  return buildInfo(t.id, t.text, "normal", now, now, sessionEndMs);
}

export const TOPIC_ROTATE_INTERVAL_MS = NORMAL_DURATION_MS;
