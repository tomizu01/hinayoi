# hinayoi 開発進捗

最終更新: 2026-05-22

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

---

## 未着手

### ステップ2: 会話ポイント管理（仕様「キャラ毎の会話ポイント」）
- [ ] 10秒ごとに全キャラ +15（サーバ側で実装。Cookieで「最後のtick時刻」を持つか、専用APIで「経過分を計算してまとめて加算」する形を想定）
- [ ] 発言テキストに名前が「含まれている」キャラに +100（ユーザー発言・キャラ発言の両方、保存時に判定）
- [ ] 発言生成後に話者のポイント -100（最低0）
- [ ] ポイントの初期値 0–100 ランダム（リセット用APIも？）

### ステップ3: 話者決定 + Gemini 3.5 Flash 連携
- [ ] 話者選定：ポイント>100 のキャラからランダム、いなければ最大値
- [ ] プロンプト組み立て
  - `prompts/common.md`（共通指示）
  - `prompts/{slug}.md`（性格設定、各キャラ）← **本文未記述。仮プロンプトを作るか要相談**
  - 現在の話題
  - 直近30件の履歴（話者＋内容）
- [ ] `gemini-3.5-flash` 呼び出し → セリフ生成 → 履歴保存 → ポイント再計算
- [ ] 自動駆動（次の話者を一定間隔で評価し続けるサーバループ or クライアント駆動）
- [ ] レート制限 / リトライ方針

### ステップ4: ElevenLabs TTS
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
│   │   ├── ChatRoom.tsx              # クライアント：話題/履歴/入力
│   │   ├── LogoutButton.tsx
│   │   ├── login/page.tsx
│   │   └── api/
│   │       ├── auth/login/route.ts
│   │       ├── auth/logout/route.ts
│   │       ├── topic/current/route.ts
│   │       └── conversations/route.ts
│   └── lib/
│       ├── db.ts             # mysql2 プール
│       ├── password.ts       # scrypt
│       ├── session.ts        # JWT Cookie
│       ├── topic.ts          # 3分ローテ管理
│       ├── conversation.ts   # 履歴 GET/INSERT
│       └── replacements.ts   # ASR/TTS 置換、30sキャッシュ
└── .env.local                # 機密。DB / SESSION / GEMINI / ELEVENLABS
```

---

## 検証結果（ステップ1まで）

| 項目 | 結果 |
|---|---|
| 未ログイン `GET /` | 307 → `/login` |
| 正しい資格情報でログイン | 200, Cookie発行 |
| 間違いログイン | 401 |
| ログアウト後 `GET /` | 307 → `/login` |
| 未認証 `GET /api/conversations` | 401 JSON |
| `GET /api/topic/current` | 3分超過時に別話題に切替＋state永続化 |
| `POST /api/conversations` | ASR置換適用（陽菜→ひな）、空文字は400 |
| ブラウザ画面 | 1920×1080 でハイドレーションエラーなく描画 |

---

## 次に決めること

1. **キャラの性格プロンプト本文**：仮プロンプトをこちらで書く / ユーザー側で記述するまで待つ
2. **ステップ2・3 の進め方**：ポイント管理→話者決定→Gemini呼び出し を分けて作るか一括で作るか
3. **自動駆動の方式**：「サーバ側に常駐ループを置く」 vs 「クライアントが一定間隔で `/api/turn/next` を叩いて生成をリクエスト」（PoCではクライアント駆動が楽）
