import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool } from "./db";

export type SpeakerKind = "user" | "character";

export type ConversationRow = {
  id: number;
  speakerKind: SpeakerKind;
  speakerName: string;
  text: string;
  topicId: number | null;
  createdAt: string; // ISO
};

type DbRow = RowDataPacket & {
  id: number;
  speaker_kind: SpeakerKind;
  speaker_name: string;
  text: string;
  topic_id: number | null;
  created_at: Date;
};

export async function getRecentConversations(limit = 30): Promise<ConversationRow[]> {
  const pool = getPool();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const [rows] = await pool.query<DbRow[]>(
    `SELECT id, speaker_kind, speaker_name, text, topic_id, created_at
       FROM conversations
       ORDER BY id DESC
       LIMIT ${safeLimit}`,
  );
  // 古い順に並べ替えて返す
  return rows
    .map((r) => ({
      id: r.id,
      speakerKind: r.speaker_kind,
      speakerName: r.speaker_name,
      text: r.text,
      topicId: r.topic_id,
      createdAt: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
    }))
    .reverse();
}

export async function insertConversation(input: {
  speakerKind: SpeakerKind;
  speakerName: string;
  text: string;
  topicId: number | null;
}): Promise<number> {
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversations (speaker_kind, speaker_name, text, topic_id)
     VALUES (?, ?, ?, ?)`,
    [input.speakerKind, input.speakerName, input.text, input.topicId],
  );
  return result.insertId;
}
