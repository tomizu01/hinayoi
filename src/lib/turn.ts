import { getCurrentTopic } from "./topic";
import { getRecentConversations, insertConversation } from "./conversation";
import {
  catchupTick,
  pickSpeaker,
  applyMentionBonus,
  resetSpeakerPoints,
  getAllPoints,
  type CharPoint,
} from "./points";
import { getCommonPrompt, getCharacterPrompt } from "./prompts";
import { generateContent } from "./gemini";

export type TurnResult = {
  spoke: {
    id: number;
    speakerSlug: string;
    speakerName: string;
    text: string;
    topicId: number | null;
    createdAt: string;
  } | null;
  points: Array<Pick<CharPoint, "slug" | "display_name" | "points">>;
  topic: { topicId: number; text: string };
};

function projectPoints(arr: CharPoint[]) {
  return arr.map((p) => ({ slug: p.slug, display_name: p.display_name, points: p.points }));
}

function sanitizeText(raw: string, speakerName: string): string {
  let t = raw.trim();
  // よくある接頭辞除去（"ひな:" "ひな：" "【ひな】" "「" 等）
  t = t.replace(/^[「『"'`]+/, "").replace(/[」』"'`]+$/, "");
  t = t.replace(/^[【\[]?(?:ひな|こはる|みさき|ひより|とみん)[】\]]?\s*[:：]\s*/u, "");
  t = t.replace(/^[「『"'`]+/, "").replace(/[」』"'`]+$/, "");
  // 60文字超なら末尾を切る
  if ([...t].length > 60) {
    t = [...t].slice(0, 60).join("");
  }
  // 空ならフォールバック
  if (!t) t = `（${speakerName}は言葉に詰まった）`;
  return t;
}

export async function runTurn(): Promise<TurnResult> {
  await catchupTick();
  const topic = await getCurrentTopic();
  const speaker = await pickSpeaker();

  if (!speaker) {
    const points = await getAllPoints();
    return { spoke: null, points: projectPoints(points), topic: { topicId: topic.topicId, text: topic.text } };
  }

  const [history, common, persona] = await Promise.all([
    getRecentConversations(30),
    getCommonPrompt(),
    getCharacterPrompt(speaker.slug),
  ]);

  const systemInstruction = [
    "あなたはAI飲み会アプリのキャラクターとして自然な会話を行います。",
    "",
    "## 共通ルール",
    common,
    "",
    "## あなたの性格設定",
    persona,
    "",
    "## 出力ルール",
    "- セリフを1回分だけ出力。鍵括弧や『キャラ名:』のような接頭辞は付けない",
    "- 60文字以内、口語で自然に",
    "- 直前の会話が自分への呼びかけだった場合は必ずそれに返答すること",
  ].join("\n");

  const historyText =
    history.length === 0
      ? "（まだ会話はありません。最初の一言として、現在の話題に触れてください）"
      : history.map((m) => `${m.speakerName}: ${m.text}`).join("\n");

  const userMessage = [
    "## 現在の話題",
    topic.text,
    "",
    "## 会話履歴（古い→新しい）",
    historyText,
    "",
    "## 指示",
    `次に話すのは「${speaker.display_name}」（あなた）です。状況に合わせた自然なセリフを1回分だけ出力してください。`,
  ].join("\n");

  let raw = "";
  try {
    raw = await generateContent({ systemInstruction, userMessage });
  } catch (e) {
    console.error("Gemini failed:", e);
    const points = await getAllPoints();
    return { spoke: null, points: projectPoints(points), topic: { topicId: topic.topicId, text: topic.text } };
  }

  const text = sanitizeText(raw, speaker.display_name);

  const id = await insertConversation({
    speakerKind: "character",
    speakerName: speaker.display_name,
    text,
    topicId: topic.topicId || null,
  });

  await applyMentionBonus(text, speaker.slug); // 自分自身は除外、後半のみ判定
  await resetSpeakerPoints(speaker.slug);

  const points = await getAllPoints();

  return {
    spoke: {
      id,
      speakerSlug: speaker.slug,
      speakerName: speaker.display_name,
      text,
      topicId: topic.topicId || null,
      createdAt: new Date().toISOString(),
    },
    points: projectPoints(points),
    topic: { topicId: topic.topicId, text: topic.text },
  };
}
