"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import Image from "next/image";
import LogoutButton from "./LogoutButton";

export type ChatCharacter = {
  id: number;
  slug: string;
  display_name: string;
  image_file: string;
  position: number;
};

export type ChatTopic = {
  topicId: number;
  text: string;
  rotatedAt: string;
  nextRotateAt: string;
  now: string;
};

export type ChatMessage = {
  id: number;
  speakerKind: "user" | "character";
  speakerName: string;
  text: string;
  topicId: number | null;
  createdAt: string;
};

export default function ChatRoom(props: {
  login: string;
  characters: ChatCharacter[];
  initialTopic: ChatTopic;
  initialMessages: ChatMessage[];
}) {
  const [topic, setTopic] = useState(props.initialTopic);
  const [messages, setMessages] = useState(props.initialMessages);
  // SSRと初回クライアントレンダリングで now を揃えるため、サーバが渡したtopic.nowで初期化
  const [now, setNow] = useState(() => new Date(props.initialTopic.now).getTime());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [points, setPoints] = useState<Array<{ slug: string; display_name: string; points: number }>>([]);
  const [turnError, setTurnError] = useState<string | null>(null);

  // ハイドレーション後にリアルタイムクロックへ切替
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // 話題期限切れで再取得
  useEffect(() => {
    const nextAt = new Date(topic.nextRotateAt).getTime();
    if (now >= nextAt) {
      void refreshTopic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now >= new Date(topic.nextRotateAt).getTime()]);

  async function refreshTopic() {
    try {
      const res = await fetch("/api/topic/current", { cache: "no-store" });
      if (res.ok) setTopic(await res.json());
    } catch {
      /* noop */
    }
  }

  // 会話履歴ポーリング
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/conversations?limit=30", { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          const data = (await res.json()) as { items: ChatMessage[] };
          setMessages(data.items);
        }
      } catch {
        /* noop */
      }
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // ポイント初期取得
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/points", { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          const data = (await res.json()) as { points: typeof points };
          setPoints(data.points);
        }
      } catch {
        /* noop */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ターン自動進行ループ
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(() => resolve(), ms);
      });

    (async () => {
      while (!cancelled) {
        try {
          const res = await fetch("/api/turn/next", { method: "POST", cache: "no-store" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setTurnError(data.error ?? `turn error ${res.status}`);
            await wait(2500);
            continue;
          }
          setTurnError(null);
          const data = (await res.json()) as {
            spoke: null | {
              id: number;
              speakerSlug: string;
              speakerName: string;
              text: string;
              topicId: number | null;
              createdAt: string;
            };
            points: typeof points;
          };
          if (data.points) setPoints(data.points);
          if (data.spoke) {
            const spoke = data.spoke;
            setMessages((prev) => [
              ...prev,
              {
                id: spoke.id,
                speakerKind: "character",
                speakerName: spoke.speakerName,
                text: spoke.text,
                topicId: spoke.topicId,
                createdAt: spoke.createdAt,
              },
            ]);
            // 仮の発話時間：文字数 / 7文字毎秒 + 1秒の余白（TTS実装時に実音声長に差替）
            const charCount = [...spoke.text].length;
            const displayMs = Math.max(1500, charCount * (1000 / 7) + 1000);
            await wait(displayMs);
          } else {
            await wait(1000);
          }
        } catch (e) {
          setTurnError(e instanceof Error ? e.message : "loop error");
          await wait(2500);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isRunning]);

  const rotatedAtMs = new Date(topic.rotatedAt).getTime();
  const nextAtMs = new Date(topic.nextRotateAt).getTime();
  const totalMs = Math.max(1, nextAtMs - rotatedAtMs);
  const progressPct = Math.min(100, Math.max(0, ((now - rotatedAtMs) / totalMs) * 100));
  const remainSec = Math.max(0, Math.ceil((nextAtMs - now) / 1000));

  const left = useMemo(() => props.characters.filter((c) => c.position <= 2), [props.characters]);
  const right = useMemo(() => props.characters.filter((c) => c.position >= 3), [props.characters]);

  const latestByCharacter = useMemo(() => {
    const map: Record<string, ChatMessage | undefined> = {};
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.speakerKind !== "character") continue;
      if (!map[m.speakerName]) map[m.speakerName] = m;
    }
    return map;
  }, [messages]);

  const recentUserMessages = useMemo(
    () => messages.filter((m) => m.speakerKind === "user").slice(-2),
    [messages],
  );

  async function onSend(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSendError(data.error ?? "送信に失敗しました");
        return;
      }
      setInput("");
      const newMsg = (await res.json()) as ChatMessage;
      setMessages((prev) => [
        ...prev,
        {
          id: newMsg.id,
          speakerKind: "user",
          speakerName: newMsg.speakerName,
          text: newMsg.text,
          topicId: newMsg.topicId,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      setSendError("通信エラーが発生しました");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="relative mx-auto"
      style={{
        width: 1920,
        height: 1080,
        backgroundImage: "url(/sozai/nomikai.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* 右上 セッション + 開始/停止 + ログアウト */}
      <div className="absolute top-3 right-4 flex items-center gap-3 text-sm text-white/80 z-10">
        <span>user: {props.login}</span>
        <button
          onClick={() => setIsRunning((v) => !v)}
          className={`px-3 py-1 rounded border ${
            isRunning
              ? "bg-red-600/80 border-red-300/40 hover:bg-red-600"
              : "bg-emerald-600/80 border-emerald-300/40 hover:bg-emerald-600"
          }`}
        >
          {isRunning ? "停止" : "開始"}
        </button>
        <LogoutButton />
      </div>

      {/* 現在の話題バー */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 w-[1400px] z-10">
        <div className="rounded-md bg-black/55 border border-white/20 px-6 py-3 text-center">
          <span className="text-white/60 text-sm mr-3">現在の話題</span>
          <span className="text-2xl font-semibold">{topic.text}</span>
          <span className="text-white/40 text-xs ml-3">次の切替まで {remainSec}s</span>
        </div>
        <div className="h-2 mt-1 bg-white/10 rounded overflow-hidden">
          <div
            className="h-full bg-white/60 transition-[width] duration-200 linear"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {/* ポイント表示（デバッグ用） */}
        {points.length > 0 && (
          <div className="mt-2 flex gap-3 text-xs text-white/70 justify-center">
            {points.map((p) => (
              <span key={p.slug} className="bg-black/40 border border-white/10 px-2 py-0.5 rounded">
                {p.display_name}: <span className="font-mono">{p.points}</span>
              </span>
            ))}
          </div>
        )}
        {turnError && (
          <div className="mt-1 text-center text-xs text-red-300">{turnError}</div>
        )}
      </div>

      {/* キャラ会話 + 画像 */}
      <div className="absolute top-[160px] left-0 right-0 px-10">
        <div className="flex justify-between items-start">
          <CharacterColumn chars={left} latest={latestByCharacter} />
          <div className="w-[40px]" />
          <CharacterColumn chars={right} latest={latestByCharacter} />
        </div>
      </div>

      {/* ユーザー最近の発言（小さく） */}
      {recentUserMessages.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[88px] w-[1400px] z-10 space-y-1 text-right">
          {recentUserMessages.map((m) => (
            <div key={m.id} className="inline-block bg-white/15 border border-white/25 px-3 py-1 rounded text-sm">
              <span className="text-white/60 mr-2">{m.speakerName}:</span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* ユーザー入力欄 */}
      <form
        onSubmit={onSend}
        className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-black/70 border-t border-white/15 flex items-center gap-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力..."
          className="flex-1 h-12 px-4 rounded bg-black/60 border border-white/25 text-lg focus:outline-none focus:border-white/60"
          disabled={sending}
          maxLength={500}
        />
        <button
          type="submit"
          className="h-12 px-6 rounded bg-white text-black font-semibold disabled:opacity-50"
          disabled={sending || input.trim().length === 0}
        >
          {sending ? "送信中..." : "入力"}
        </button>
        <button
          type="button"
          className="h-12 px-6 rounded bg-red-500 text-white font-semibold disabled:opacity-50"
          disabled
          title="後で実装"
        >
          音声入力
        </button>
        {sendError && <span className="text-red-300 text-sm ml-2">{sendError}</span>}
      </form>
    </div>
  );
}

function CharacterColumn({
  chars,
  latest,
}: {
  chars: ChatCharacter[];
  latest: Record<string, ChatMessage | undefined>;
}) {
  return (
    <div className="flex gap-6">
      {chars.map((c) => {
        const msg = latest[c.display_name];
        return (
          <div key={c.id} className="w-[400px] flex flex-col items-center gap-3">
            <div className="w-full h-[180px] rounded-md bg-black/55 border border-white/20 p-4 text-lg overflow-hidden">
              <div className="text-white/60 text-sm mb-1">{c.display_name}</div>
              <div className="text-white/90 whitespace-pre-wrap leading-snug">
                {msg ? msg.text : ""}
              </div>
            </div>
            <div className="w-full h-[600px] rounded-md bg-black/40 border border-white/15 overflow-hidden flex items-end justify-center">
              <Image
                src={`/sozai/${c.image_file}`}
                alt={c.display_name}
                width={400}
                height={600}
                className="object-contain max-h-full max-w-full"
                unoptimized
                priority
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
