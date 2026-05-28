"use client";

import { useEffect, useMemo, useRef, useState, FormEvent } from "react";
import Image from "next/image";
import LogoutButton from "./LogoutButton";

// Web Speech API の最小型定義（標準DOM型に未収録のため）
type SRAlternative = { transcript: string };
type SRResult = { 0: SRAlternative; isFinal: boolean; length: number };
type SREvent = { results: ArrayLike<SRResult>; resultIndex: number };
type SRErrorEvent = { error: string; message?: string };
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

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
  kind: "normal" | "order" | "closing" | "ended";
  rotatedAt: string;
  nextRotateAt: string;
  now: string;
  sessionEndAt: string;
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
  // 起動時点の会話IDを記録し、UI表示ではこれらを除外する（前回会話の残留対策）
  const [preSessionIds] = useState<Set<number>>(
    () => new Set(props.initialMessages.map((m) => m.id)),
  );
  // SSRと初回クライアントレンダリングで now を揃えるため、サーバが渡したtopic.nowで初期化
  const [now, setNow] = useState(() => new Date(props.initialTopic.now).getTime());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [points, setPoints] = useState<Array<{ slug: string; display_name: string; points: number }>>([]);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [currentSpeech, setCurrentSpeech] = useState<{
    slug: string;
    displayName: string;
    text: string;
    startedAt: number;
  } | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState("");
  // 表示用の各キャラ最新セリフ。messages とは独立にターンループが明示的に更新する
  // （ポーリング由来の messages 更新で「音声再生前にバブル満杯」になる事故を防ぐ）
  const [displayedLatest, setDisplayedLatest] = useState<Record<string, ChatMessage>>({});
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isListeningRef = useRef(false);
  const sendingRef = useRef(false);
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // ハイドレーション後にリアルタイムクロックへ切替
  useEffect(() => {
    setNow(Date.now());
    // 7文字/sのタイプライターを滑らかに描画するため 100ms 周期
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  // 話題期限切れで再取得。
  // サーバ側 getCurrentTopic はリクエスト時に時計を見てローテートする方式なので、
  // クライアント時計がサーバより僅かに先行しているときに refreshTopic を1回だけ呼ぶと
  // 「サーバ的にはまだ期限切れていない」と判定され同じ topic が返り、以降取りに行かなくなる。
  // 期限切れの間は topic.nextRotateAt が進むまで1秒ごとに再取得を続ける。
  useEffect(() => {
    const nextAt = new Date(topic.nextRotateAt).getTime();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pollAfterExpiry = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        await refreshTopic();
        if (!cancelled) pollAfterExpiry();
      }, 1000);
    };
    const initialDelay = Math.max(0, nextAt - Date.now());
    timer = setTimeout(async () => {
      if (cancelled) return;
      await refreshTopic();
      if (!cancelled) pollAfterExpiry();
    }, initialDelay);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [topic.nextRotateAt]);

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

  const isEnded = topic.kind === "ended";
  const isClosing = topic.kind === "closing";

  // 飲み会終了になったら音声認識・自動進行をすべて止める
  useEffect(() => {
    if (!isEnded) return;
    isListeningRef.current = false;
    setIsListening(false);
    setInterim("");
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
    setIsRunning(false);
  }, [isEnded]);

  // ターン自動進行ループ（TTS再生終了で次へ）
  useEffect(() => {
    if (!isRunning) return;
    if (isEnded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activeAudio: HTMLAudioElement | null = null;
    let activeUrl: string | null = null;

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(() => resolve(), ms);
      });

    async function fetchAudio(speakerSlug: string, text: string): Promise<HTMLAudioElement> {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakerSlug, text }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`tts ${res.status} ${detail.slice(0, 120)}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      activeUrl = url;
      const audio = new Audio(url);
      audio.preload = "auto";
      return audio;
    }

    function playAndWait(
      audio: HTMLAudioElement,
      fallbackMs: number,
      onStart?: () => void,
    ): Promise<void> {
      return new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try {
            audio.pause();
          } catch {
            /* noop */
          }
          resolve();
        };
        audio.onended = finish;
        audio.onerror = finish;
        if (onStart) audio.onplay = onStart;
        const cap = setTimeout(finish, fallbackMs);
        audio.addEventListener("ended", () => clearTimeout(cap), { once: true });
        audio.play().catch(() => finish());
      });
    }

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

          if (!data.spoke) {
            await wait(1000);
            continue;
          }

          const spoke = data.spoke;

          // 音声準備（取得中はキャラ枠を更新しない）
          let audio: HTMLAudioElement | null = null;
          try {
            audio = await fetchAudio(spoke.speakerSlug, spoke.text);
            activeAudio = audio;
          } catch (e) {
            setTurnError(e instanceof Error ? e.message : "tts error");
            // 音声取得失敗時はテキストのみ表示
          }

          const msgForDisplay: ChatMessage = {
            id: spoke.id,
            speakerKind: "character",
            speakerName: spoke.speakerName,
            text: spoke.text,
            topicId: spoke.topicId,
            createdAt: spoke.createdAt,
          };

          // 音声再生開始時にタイプライタ表示を開始（フェッチ中・再生待ちは何も表示しない）
          const reveal = () => {
            setCurrentSpeech({
              slug: spoke.speakerSlug,
              displayName: spoke.speakerName,
              text: spoke.text,
              startedAt: Date.now(),
            });
          };

          if (audio) {
            // 文字数 × 0.5s を最低保証、25s をハードキャップ（ハルシネーション暴走対策）
            const charCount = [...spoke.text].length;
            const fallback = Math.min(25_000, Math.max(charCount * 500, 8_000));
            let revealed = false;
            await playAndWait(audio, fallback, () => {
              if (revealed) return;
              revealed = true;
              reveal();
            });
            if (!revealed) {
              // 音声が再生されなかった場合（失敗・即中断）でもテキストは表示
              revealed = true;
              reveal();
              const displayMs = Math.max(1500, charCount * (1000 / 7) + 1000);
              await wait(displayMs);
            }
            if (activeUrl) {
              URL.revokeObjectURL(activeUrl);
              activeUrl = null;
            }
            activeAudio = null;
          } else {
            // フォールバック：テキストの長さで待機
            reveal();
            const charCount = [...spoke.text].length;
            const displayMs = Math.max(1500, charCount * (1000 / 7) + 1000);
            await wait(displayMs);
          }

          if (cancelled) break;
          // 発話終了：表示用latestを更新し、同じバッチで currentSpeech をクリアする
          // （isSpeaking=false への遷移と「latestに新セリフが入る」を同一レンダで起こすため）
          setDisplayedLatest((prev) => ({ ...prev, [spoke.speakerName]: msgForDisplay }));
          setCurrentSpeech(null);
        } catch (e) {
          setTurnError(e instanceof Error ? e.message : "loop error");
          await wait(2500);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (activeAudio) {
        try {
          activeAudio.pause();
        } catch {
          /* noop */
        }
      }
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
      }
      setCurrentSpeech(null);
    };
  }, [isRunning, isEnded]);

  const rotatedAtMs = new Date(topic.rotatedAt).getTime();
  const nextAtMs = new Date(topic.nextRotateAt).getTime();
  const totalMs = Math.max(1, nextAtMs - rotatedAtMs);
  const progressPct = Math.min(100, Math.max(0, ((now - rotatedAtMs) / totalMs) * 100));
  const remainSec = Math.max(0, Math.ceil((nextAtMs - now) / 1000));

  // 飲み会セッション全体の残り時間
  const sessionEndMs = new Date(topic.sessionEndAt).getTime();
  const sessionRemainMs = Math.max(0, sessionEndMs - now);
  // 通常/追加注文タイム中、かつ残り5分以下の場合に「残り5分」を予告表示する
  const showFiveMinWarning =
    !isClosing && !isEnded && sessionRemainMs > 0 && sessionRemainMs <= 5 * 60 * 1000;

  const left = useMemo(() => props.characters.filter((c) => c.position <= 2), [props.characters]);
  const right = useMemo(() => props.characters.filter((c) => c.position >= 3), [props.characters]);

  // バブル表示は displayedLatest（ターンループが明示的に管理）にのみ依存させる
  // ポーリングや起動時の messages からは派生させない
  const latestByCharacter = displayedLatest;

  const recentUserMessages = useMemo(
    () =>
      messages
        .filter((m) => m.speakerKind === "user" && !preSessionIds.has(m.id))
        .slice(-2),
    [messages, preSessionIds],
  );

  async function sendUserText(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSendError(data.error ?? "送信に失敗しました");
        return false;
      }
      const newMsg = (await res.json()) as ChatMessage & {
        points?: typeof points;
      };
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
      if (newMsg.points) setPoints(newMsg.points);
      return true;
    } catch {
      setSendError("通信エラーが発生しました");
      return false;
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  async function onSend(e?: FormEvent) {
    e?.preventDefault();
    const ok = await sendUserText(input);
    if (ok) setInput("");
  }

  function stopListening() {
    isListeningRef.current = false;
    setIsListening(false);
    setInterim("");
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
  }

  function startListening() {
    if (isListeningRef.current) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSendError("このブラウザは音声認識に未対応です（Chrome Desktopで開いてください）");
      return;
    }
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i] as SRResult;
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalText += t;
        else interimText += t;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        setInterim("");
        void sendUserText(finalText);
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setSendError("マイク権限が許可されていません");
        stopListening();
      } else if (ev.error === "audio-capture") {
        setSendError("マイクが見つかりません");
        stopListening();
      } else if (ev.error === "no-speech") {
        // 無音タイムアウト。継続するため何もしない（onendで再起動される）
      }
    };
    rec.onend = () => {
      setInterim("");
      // Chrome は数十秒で自動停止するので、ユーザーが止めていなければ再開
      if (isListeningRef.current) {
        try {
          rec.start();
        } catch {
          /* すぐにrestartできない時は次のonend待ち */
        }
      }
    };
    try {
      rec.start();
      recognitionRef.current = rec;
      isListeningRef.current = true;
      setIsListening(true);
      setSendError(null);
    } catch {
      setSendError("音声認識の起動に失敗しました");
    }
  }

  function toggleListening() {
    if (isListeningRef.current) stopListening();
    else startListening();
  }

  // アンマウント時は確実に停止
  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      if (rec) {
        rec.onend = null;
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

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
      {/* 左上 残り時間警告（残り5分以下で表示） */}
      {showFiveMinWarning && (
        <div className="absolute top-3 left-4 z-20 select-none animate-pulse">
          <div className="bg-black/80 border-2 border-red-400 text-red-400 font-bold px-4 py-2 rounded-md shadow-lg" style={{ fontSize: "1.5rem" }}>
            ⚠ お会計まで残り5分
          </div>
        </div>
      )}

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
          <CharacterColumn chars={left} latest={latestByCharacter} current={currentSpeech} now={now} />
          <div className="w-[40px]" />
          <CharacterColumn chars={right} latest={latestByCharacter} current={currentSpeech} now={now} />
        </div>
      </div>

      {/* ユーザー最近の発言（小さく） + 音声認識interim */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[88px] w-[1400px] z-10 space-y-1 text-right pointer-events-none">
        {recentUserMessages.map((m) => (
          <div key={m.id} className="inline-block bg-white/15 border border-white/25 px-3 py-1 rounded" style={{ fontSize: "1.3125rem" }}>
            <span className="text-white/60 mr-2">{m.speakerName}:</span>
            <span>{m.text}</span>
          </div>
        ))}
        {isListening && (
          <div className="inline-block bg-black/80 border border-red-300/80 px-3 py-1 rounded" style={{ fontSize: "1.3125rem" }}>
            <span className="text-red-300 mr-2 animate-pulse">● 認識中</span>
            <span className="text-white">{interim || "（話してください）"}</span>
          </div>
        )}
      </div>

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
          disabled={sending || isEnded}
          maxLength={500}
        />
        <button
          type="submit"
          className="h-12 px-6 rounded bg-white text-black font-semibold disabled:opacity-50"
          disabled={sending || isEnded || input.trim().length === 0}
        >
          {sending ? "送信中..." : "入力"}
        </button>
        <button
          type="button"
          onClick={toggleListening}
          disabled={isEnded}
          className={`h-12 px-6 rounded font-semibold border transition-colors disabled:opacity-50 ${
            isListening
              ? "bg-red-600 text-white border-red-300 ring-2 ring-red-300/60 animate-pulse"
              : "bg-red-500 text-white border-red-300/40 hover:bg-red-600"
          }`}
          title={isListening ? "音声入力を停止" : "音声入力を開始"}
        >
          {isListening ? "🎤 認識中..." : "🎤 音声入力"}
        </button>
        {sendError && <span className="text-red-300 text-sm ml-2">{sendError}</span>}
      </form>

      {/* 飲み会終了オーバーレイ */}
      {isEnded && (
        <div className="absolute inset-0 bg-black/55 z-50 flex items-center justify-center">
          <div className="text-white text-5xl font-bold tracking-wide drop-shadow-lg">
            この飲み会は終了しました
          </div>
        </div>
      )}
    </div>
  );
}

const TYPEWRITER_CPS = 7;

function CharacterColumn({
  chars,
  latest,
  current,
  now,
}: {
  chars: ChatCharacter[];
  latest: Record<string, ChatMessage | undefined>;
  current: {
    slug: string;
    displayName: string;
    text: string;
    startedAt: number;
  } | null;
  now: number;
}) {
  return (
    <div className="flex gap-6">
      {chars.map((c) => {
        const isSpeaking = current?.slug === c.slug;
        let bubbleText = "";
        if (isSpeaking && current) {
          const fullChars = [...current.text];
          const visible = Math.max(
            0,
            Math.min(fullChars.length, Math.floor(((now - current.startedAt) / 1000) * TYPEWRITER_CPS)),
          );
          bubbleText = fullChars.slice(0, visible).join("");
        } else {
          bubbleText = latest[c.display_name]?.text ?? "";
        }
        const bubbleBorder = isSpeaking
          ? "border-yellow-300/80 ring-2 ring-yellow-300/40"
          : "border-white/20";
        const imageBorder = isSpeaking
          ? "border-yellow-300/80 ring-2 ring-yellow-300/40"
          : "border-white/15";
        return (
          <div key={c.id} className="w-[400px] flex flex-col items-center gap-3">
            <div className={`w-full h-[180px] rounded-md bg-black/55 border ${bubbleBorder} p-4 text-lg overflow-hidden transition-all`}>
              <div className="text-white/60 text-sm mb-1 flex items-center gap-2">
                <span className="font-bold" style={{ fontSize: "1.75rem" }}>{c.display_name}</span>
                {isSpeaking && <span className="text-yellow-300 text-xs">● 発言中</span>}
              </div>
              <div className="text-white/95 whitespace-pre-wrap leading-snug" style={{ fontSize: "1.5rem" }}>
                {bubbleText}
                {isSpeaking && bubbleText.length < (current ? [...current.text].length : 0) && (
                  <span className="inline-block w-1 h-5 bg-white/70 ml-0.5 align-middle animate-pulse" />
                )}
              </div>
            </div>
            <div className={`w-full h-[600px] rounded-md bg-black/40 border ${imageBorder} overflow-hidden flex items-end justify-center transition-all`}>
              <Image
                src={`/sozai/${c.slug}_${isSpeaking ? "talk" : "default"}.png`}
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
