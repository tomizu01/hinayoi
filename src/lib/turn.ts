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
  t = t.replace(/^[【\[]?(?:ひな|こはる|みさき|ひより)[】\]]?\s*[:：]\s*/u, "");
  t = t.replace(/^[「『"'`]+/, "").replace(/[」』"'`]+$/, "");
  // 60文字超なら末尾を切る
  if ([...t].length > 60) {
    t = [...t].slice(0, 60).join("");
  }
  // 空ならフォールバック
  if (!t) t = `（${speakerName}は言葉に詰まった）`;
  return t;
}

function applyPromptVars(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}

export async function runTurn(
  nomikaiSessionId: string | null,
  nickname: string,
): Promise<TurnResult> {
  await catchupTick(nomikaiSessionId);
  const topic = await getCurrentTopic(nomikaiSessionId);
  const speaker = await pickSpeaker(nomikaiSessionId);

  if (!speaker) {
    const points = await getAllPoints(nomikaiSessionId);
    return { spoke: null, points: projectPoints(points), topic: { topicId: topic.topicId, text: topic.text } };
  }

  const [history, commonRaw, personaRaw] = await Promise.all([
    getRecentConversations(nomikaiSessionId, 30),
    getCommonPrompt(),
    getCharacterPrompt(speaker.slug),
  ]);

  const promptVars = { nickname };
  const common = applyPromptVars(commonRaw, promptVars);
  const persona = applyPromptVars(personaRaw, promptVars);

  // 直近のキャラ発言が追加注文タイム中（topicId=null）かつ現在は通常モード
  // → 注文の流れから通常会話へ戻す高優先指示を入れる
  const lastCharMessage = [...history].reverse().find((m) => m.speakerKind === "character");
  const isPostOrderTransition =
    topic.kind === "normal" && lastCharMessage?.topicId === null;

  const priorityBlock: string[] = [];
  if (topic.kind === "order") {
    priorityBlock.push(
      "## 【最優先】追加注文タイム",
      "- 今は追加注文タイムです。今までの話題から、追加の飲み物または食べ物を注文する話に行移行してください",
      "- 自分の好きなものを注文した後に、他のキャラまたはユーザーに何を注文するか聞いてください",
      "",
    );
  } else if (isPostOrderTransition) {
    priorityBlock.push(
      "## 【最優先】話題切替",
      `- 直前まで追加注文タイムでしたが、今は新しい話題「${topic.text}」に切り替わりました。`,
      "- 注文を終わらせて、新しい話題に沿った会話を自然な流れで始めてください。",
      "",
    );
  }

  const systemInstruction = [
    "あなたはAI飲み会アプリのキャラクターとして自然な会話を行います。",
    "",
    ...priorityBlock,
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
    const points = await getAllPoints(nomikaiSessionId);
    return { spoke: null, points: projectPoints(points), topic: { topicId: topic.topicId, text: topic.text } };
  }

  const text = sanitizeText(raw, speaker.display_name);

  const id = await insertConversation({
    speakerKind: "character",
    speakerName: speaker.display_name,
    text,
    topicId: topic.topicId || null,
    nomikaiSessionId,
  });

  await applyMentionBonus(nomikaiSessionId, text, speaker.slug); // 自分自身は除外、後半のみ判定
  await resetSpeakerPoints(nomikaiSessionId, speaker.slug);

  const points = await getAllPoints(nomikaiSessionId);

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
