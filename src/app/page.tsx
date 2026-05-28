import type { RowDataPacket } from "mysql2";
import { readSession } from "@/lib/session";
import { getNomikaiSessionId } from "@/lib/nomikai";
import { getPool } from "@/lib/db";
import { getCurrentTopic } from "@/lib/topic";
import { getRecentConversations } from "@/lib/conversation";
import ChatRoom, { type ChatCharacter } from "./ChatRoom";

type CharacterRow = RowDataPacket & ChatCharacter;

async function loadCharacters(): Promise<ChatCharacter[]> {
  const pool = getPool();
  const [rows] = await pool.query<CharacterRow[]>(
    "SELECT id, slug, display_name, image_file, position FROM characters ORDER BY position ASC",
  );
  return rows;
}

export default async function HomePage() {
  const session = await readSession();
  const nomikaiSessionId = await getNomikaiSessionId();
  const [characters, topic, messages] = await Promise.all([
    loadCharacters(),
    getCurrentTopic(),
    getRecentConversations(nomikaiSessionId, 30),
  ]);
  return (
    <ChatRoom
      login={session?.login ?? ""}
      characters={characters}
      initialTopic={topic}
      initialMessages={messages}
    />
  );
}
