# hinayoi 開発進捗

最終更新: 2026-05-22（ステップ5完了）

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
- [x] ポイント表示（デバッグ用、トピックバー下）
- [x] turn エラー表示

### ステップ4: ElevenLabs TTS + タイプライター
- [x] `POST /api/tts` プロキシ（`{speakerSlug, text}` → voice_id 引き → TTS置換適用 → ElevenLabs呼び出し → mp3ストリーム返却）
- [x] `eleven_v3` / `language_code=ja` / `stability=1.0` / `mp3_44100_64` / 30sタイムアウト
- [x] クライアント：fetch → Blob → `Audio` → play、再生終了で次ターンへ
- [x] ハードキャップ（文字数×0.5sの最低8s、上限25s）でハルシネーション暴走から保護
- [x] タイプライター 7文字/s で表示開始と再生開始を同時にトリガー
- [x] 発言中のキャラを枠＋黄リングで強調＋「● 発言中」表示＋カーソル点滅
- [x] tick 100ms に短縮（タイプライター滑らか化）

### ステップ5: ユーザー音声入力（Web Speech API）
- [x] `webkitSpeechRecognition` / `ja-JP` / 連続認識 + interim結果取得
- [x] 音声入力ボタンを有効化、認識中は赤くパルス
- [x] interim を入力欄上に「● 認識中: …」で表示
- [x] final セグメントごとに自動で `POST /api/conversations` 送信（ASR置換はサーバ側で適用）
- [x] Chrome の自動停止に対応：`onend` で再起動、ユーザーが止めたら再起動しない
- [x] 権限エラー / マイク無し のメッセージ表示
- [x] アンマウント時に確実に停止

---

## 未着手

### その他（後回し）
- [ ] APNG 対応の確認・口パク差し替えなどの演出
- [ ] レート制限の監視（Gemini 3.5 Flash / ElevenLabs Pro）
- [ ] 長時間連続テスト用のセーフガード（コスト・ハルシネーション）
- [ ] TTS再生中はマイクをミュート（エコーフィードバック防止）するか、ヘッドホン運用とするか

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
│   │       ├── turn/next/route.ts     # POST 1ターン進行
│   │       └── tts/route.ts           # POST 音声生成プロキシ
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

## 検証結果（ステップ4まで）

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
| `GET /api/points` | 初回でランダム初期化、以降経過秒数を10秒+1でcatchup |
| `POST /api/turn/next` | Geminiが性格通りに発言生成、自然な対話継続、ポイント±適用 |
| 自分の名前マッチ除外 | ひなが自分の発言に「ひな」を含めてもひなには+100されない ✓ |
| `POST /api/tts` | mp3バイナリ返却（23KB / `audio/mpeg`）、不正slug 400、空文字 400 |
| UIで「開始」ボタン押下 | キャラが声付きでターン進行、発言中は黄リング＋タイプライター ✓（ユーザー確認済み） |

ステップ5（音声入力）はサーバ・UIの実装と非マイクテストまで完了。**マイクからの認識動作の実機確認はまだ**。

---

## 現在のセッション状態（次回再開時の参照用）

- dev サーバ：ポート 7500 でバックグラウンド稼働中（`/tmp/hinayoi-dev.log`にログ）
- ALB設定済み、ブラウザから接続可能
- ログイン情報：`admin` / `hinayoi2026`
- ポイントtick：10秒あたり **+1**（旧+15から下方修正済み）
- ユーザーによるポイント手動リセット実施済み
- 「TICK_GAIN=1」の挙動確認：いい感じに会話してくれることをユーザー確認済み
- TTS再生：ユーザー画面で確認済み
- 音声入力：実装完了 / ブラウザ側マイクでの動作確認は次回ユーザー側で実施予定

### Git 状態（2026-05-22 打ち合わせ前時点）

- 既存コミット: `8cd154c first commit` → `b84e458 char talk`
- **未コミットの変更**（ステップ4+5 の成果）
  - `M docs/progress.md`
  - `M src/app/ChatRoom.tsx` （TTS再生 + タイプライター + 音声入力）
  - `M src/lib/points.ts` （TICK_GAIN 15→1）
  - `?? src/app/api/tts/` （新規TTSルート）
- 次回コミットする際は、最低限ステップ4（TTS）とステップ5（音声入力）を分けると履歴が読みやすい

---

## 確認・調整したいこと（次回以降）

1. **音声入力の実機テスト**（Chrome Desktop、マイク権限、interim表示、自動送信、ASR置換、エコーフィードバック観察）
2. **TTS再生中のマイク自動ミュート**：エコー対策が必要なら実装
3. **プロンプト微調整**：会話の自然さ・文字数・呼びかけ・キャラの個性差を見ながら
4. **話題（topics）の追加**：現在5件のみ
5. **APNG / 口パク等の演出**：素材があれば差し替え
6. **長時間運用テスト**：レートリミット観察・コスト確認
