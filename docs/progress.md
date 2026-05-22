# hinayoi 開発進捗

最終更新: 2026-05-22（ステップ3完了）

仕様書: [docs/hinayoi.md](./hinayoi.md)
TTS仕様: [docs/elevenlabs-tts-api.md](./elevenlabs-tts-api.md)

---

## 完了

### 環境・基盤
- [x] Next.js 15 + TypeScript + Tailwind プロジェクト構築（`/var/www/hinayoi/`）
- [x] dev サーバはポート 7500（`npm run dev`）
- [x] `.env.local`：DB / SESSION_SECRET / GEMINI_API_KEY / ELEVENLABS_API_KEY
- [x] 素材ディレクトリの公開：`/public/sozai` → `/home/ec2-user/sozai` シンボリックリンク

### DB（hinayoi）
- [x] スキーマ作成（`sql/schema.sql`）
  - `users` / `characters` / `topics` / `conversations` / `tts_replacements` / `asr_replacements` / `app_state`
- [x] seed
  - キャラ4人（ひより／みさき／こはる／ひな、VoiceID + 画像ファイル付き）
  - 話題5件
  - TTS置換例（頑張ろう→がんばろう）
  - ASR置換例（陽菜→ひな、小春→こはる）
  - admin ユーザー（パスワード scrypt ハッシュ）

### 認証
- [x] ログインID/パスワード固定（admin / hinayoi2026）。新規登録なし
- [x] scrypt + jose の JWT セッション Cookie（`hinayoi_session`、7日）
- [x] middleware で未認証は `/login` にリダイレクト（`/api` は除外し、route 側で 401）
- [x] `/api/auth/login`, `/api/auth/logout`

### 画面（1920×1080 固定）
- [x] 背景 `nomikai.png` 全面表示
- [x] 上部：現在の話題バー + 切替までの進捗バー + 残り秒数
- [x] 左2 / 右2 のキャラエリア（各カードに発言枠 + 画像枠）
- [x] 下部：テキスト入力 + 入力ボタン + 音声入力ボタン（後者は disabled）
- [x] ユーザー直近発言を入力欄上に小さく表示
- [x] ハイドレーションエラー対策（サーバ時刻でクライアント `now` を初期化）

### API
- [x] `GET /api/topic/current` — 3分超過で自動切替・state永続化・直前と同じ話題は除外
- [x] `GET /api/conversations?limit=30` — 古い順
- [x] `POST /api/conversations` — ユーザー発言保存。ASR 置換を保存前に適用、現在の話題IDを紐付け
- [x] ASR/TTS 置換リストはDB保管、30秒キャッシュ、長い文字列優先

### クライアント側
- [x] ChatRoom（クライアントコンポーネント）に状態集約
- [x] 進捗バーを 250ms 毎更新、満了時に話題再取得
- [x] 1.5秒毎に会話履歴ポーリング、キャラ毎の最新発言を表示
- [x] テキスト送信 → POST → 即時UI反映

### ステップ2: 会話ポイント管理
- [x] 10秒毎 +15（catchup方式、`app_state.points_last_tick_at`）
- [x] 初期値0-100ランダム（初回呼び出し時に `points_initialized` フラグで一度だけ）
- [x] 名前含み判定で +100（**自分自身は除外**）
- [x] 話者発言後 -100（最低0）
- [x] 話者選定：100超ならその中からランダム、いなければ最大値（同値ランダム）

### ステップ3: 話者決定 + Gemini 3.5 Flash 連携
- [x] `gemini-3.5-flash` REST呼び出し（systemInstruction + user message形式、thinkingBudget=0、maxOutputTokens=2048）
- [x] プロンプト組み立て（common + persona + 現在話題 + 履歴30件）
- [x] サニタイズ（接頭辞除去、60字超切り詰め）
- [x] 履歴DB保存 → 名前+100適用 → 話者-100適用
- [x] `POST /api/turn/next` で1ターン進行
- [x] ユーザー名 `とみん` で履歴保存（ひなの「お兄ちゃん」呼びはプロンプト側で処理）
- [x] `都民→とみん` を asr_replacements に追加

### UI
- [x] 右上の「開始 / 停止」トグル → クライアント側ループで `/api/turn/next` を呼び続ける
- [x] 仮の発話時間 = 文字数 / 7文字毎秒 + 1秒余白で次ターンを待機（後でTTS再生終了に置換）
- [x] ポイント表示（デバッグ用、トピックバー下）
- [x] turn エラー表示

---

## 未着手

### ステップ4: ElevenLabs TTS（次のターゲット）
- [ ] サーバプロキシ `/api/tts`（API キーをクライアントに露出させない）
- [ ] TTS 置換適用後のテキストを渡す
- [ ] `eleven_v3` / `stability=1.0` / 50文字以下推奨 / タイムアウト
- [ ] mp3 を取得→ クライアント再生
- [ ] 並列呼び出しのウエイト調整（必要に応じて）

### ステップ5: タイプライター表示 + 音声再生の同時開始
- [ ] 表示は 7文字/秒
- [ ] 再生開始と表示開始を同時にトリガー
- [ ] 再生タイムアウト（想定再生時間の2〜3倍）

### ステップ6: ユーザー音声入力
- [ ] Web Speech API（Chrome）
- [ ] 認識結果に ASR 置換を適用してから保存・ポイント判定
- [ ] 入力中UI（マイクアイコン、ON/OFFトグル）

### その他（後回し）
- [ ] APNG 対応の確認・口パク差し替えなどの演出
- [ ] レート制限の監視（Gemini 3.5 Flash / ElevenLabs Pro）
- [ ] 長時間連続テスト用のセーフガード（コスト・ハルシネーション）

---

## 主要ファイル

```
/var/www/hinayoi/
├── docs/
│   ├── hinayoi.md            # 仕様書
│   ├── elevenlabs-tts-api.md
│   └── progress.md           # ← このファイル
├── prompts/                  # 後で本文差し込み
│   ├── common.md
│   ├── hina.md
│   ├── koharu.md
│   ├── misaki.md
│   └── hiyori.md
├── sql/schema.sql
├── public/sozai -> /home/ec2-user/sozai
├── src/
│   ├── middleware.ts
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                  # サーバ：初期データ取得 → ChatRoomへ
│   │   ├── ChatRoom.tsx              # クライアント：話題/履歴/入力/ターンループ
│   │   ├── LogoutButton.tsx
│   │   ├── login/page.tsx
│   │   └── api/
│   │       ├── auth/login/route.ts
│   │       ├── auth/logout/route.ts
│   │       ├── topic/current/route.ts
│   │       ├── conversations/route.ts
│   │       ├── points/route.ts        # GET 現在ポイント
│   │       └── turn/next/route.ts     # POST 1ターン進行
│   └── lib/
│       ├── db.ts             # mysql2 プール
│       ├── password.ts       # scrypt
│       ├── session.ts        # JWT Cookie
│       ├── topic.ts          # 3分ローテ管理
│       ├── conversation.ts   # 履歴 GET/INSERT
│       ├── replacements.ts   # ASR/TTS 置換、30sキャッシュ
│       ├── points.ts         # tick / +100 / -100 / 話者選定
│       ├── prompts.ts        # prompts/*.md 読み込み（5sキャッシュ）
│       ├── gemini.ts         # gemini-3.5-flash REST
│       └── turn.ts           # 1ターン進行ロジック
└── .env.local                # 機密。DB / SESSION / GEMINI / ELEVENLABS
```

---

## 検証結果（ステップ3まで）

| 項目 | 結果 |
|---|---|
| 未ログイン `GET /` | 307 → `/login` |
| 正しい資格情報でログイン | 200, Cookie発行 |
| 間違いログイン | 401 |
| ログアウト後 `GET /` | 307 → `/login` |
| 未認証 `GET /api/conversations` | 401 JSON |
| `GET /api/topic/current` | 3分超過時に別話題に切替＋state永続化 |
| `POST /api/conversations` | ASR置換適用（陽菜→ひな、都民→とみん）、空文字は400、名前マッチ+100 |
| ブラウザ画面 | 1920×1080 でハイドレーションエラーなく描画 |
| `GET /api/points` | 初回でランダム初期化、以降経過秒数を10秒+15でcatchup |
| `POST /api/turn/next` | Geminiが性格通りに発言生成、自然な対話継続、ポイント±適用 |
| 自分の名前マッチ除外 | ひなが自分の発言に「ひな」を含めてもひなには+100されない ✓ |

---

## 次に決めること（ステップ4以降）

1. **TTS再生方式**：MP3 を Blob で受けてクライアントで `<audio>` 再生。生成→再生終了をターンループの待機トリガーに変える
2. **再生中の表示**：タイプライター7文字/秒。発話中のキャラを強調（枠の色変える等）するかどうか
3. **コスト管理**：開発中は「開始/停止」ボタンでループを切れる現状でOK。本格テスト時のレート上限・ウエイト調整は実機で
4. **ユーザー音声入力 (Web Speech API)**：マイクトグルを入力欄に追加、認識結果に asr_replacements を適用してから POST
