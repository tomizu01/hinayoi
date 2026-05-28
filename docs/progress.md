# hinayoi 開発進捗

最終更新: 2026-05-28（飲み会セッション導入 + 複数アカウント対応 + 追加注文タイム + per-session state 化 + ラストオーダー/終了イベント）

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
- [x] `GET /api/topic/current` — 4分超過で自動切替・state永続化・直前と同じ話題は除外
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

### 飲み会セッション・複数アカウント・追加注文タイム・per-session 化（2026-05-28）

#### 飲み会セッション
- [x] `hinayoi_nomikai` cookie（UUID, ブラウザセッションクッキー）を middleware で発行
- [x] ブラウザ再起動で新 ID, リロードでは継続
- [x] `conversations.nomikai_session_id` カラム追加。`getRecentConversations` でセッション内のみ取得
- [x] turn 生成のプロンプト履歴も現セッションのみに限定

#### 複数アカウント対応
- [x] `users.nickname` カラム追加（DEFAULT ''）
- [x] CLI: `scripts/add-user.mjs`（`node --env-file=.env.local scripts/add-user.mjs <loginId> <password> <nickname>`）
- [x] `SessionPayload.nickname` を追加し JWT に乗せる（旧JWT互換: nickname無いなら login_id をフォールバック）
- [x] `USER_SPEAKER_NAME="とみん"` のハードコードを廃止 → `session.nickname` を speaker_name に保存
- [x] prompts/*.md に `{nickname}` プレースホルダ。turn.ts で common/persona に置換
- [x] sanitizeText の接頭辞除去 regex から `とみん` を削除

#### 追加注文タイム（話題切替フック）
- [x] 通常話題 4 分 × 3回 → 追加注文タイム 30 秒 → 新しい通常 4 分 …のループ
- [x] 追加注文タイムでは topicId=0, text="追加注文タイム", kind="order" を返す
- [x] turn.ts のプロンプト分岐
  - order 中: 「## 【最優先】追加注文タイム」（注文セリフのみ、互いに何を頼むか聞く流れ）
  - post-order 検出（直近キャラ発言の topicId が NULL && 現在 normal）: 「## 【最優先】話題切替」を入れる
- [x] `ChatTopic.kind` を型に追加

#### per-session 状態化（B案、複数同時利用対応）
- [x] 新テーブル `nomikai_sessions`（current_topic_id/kind, topic_rotated_at, topic_normals_played, points_last_tick_at）
- [x] 新テーブル `nomikai_session_character_points`（session × character の pt 行）
- [x] `characters.points` カラム廃止（DROP）
- [x] `app_state` の topic 系・points 系キーは廃止（DELETE 対象）
- [x] `lib/nomikai.ts` に `ensureNomikaiSession(sessionId)` を追加。INSERT IGNORE + 初期 pt 0–100 乱数 seed
- [x] `lib/topic.ts` / `lib/points.ts` の全 public API に `sessionId` 引数を伝播
- [x] page.tsx と全 API ルートで cookie 経由の sessionId を配線

#### マイグレーション SQL（既存DBに対し一度だけ実行）
```sql
ALTER TABLE users ADD COLUMN nickname VARCHAR(32) NOT NULL DEFAULT '' AFTER login_id;
UPDATE users SET nickname='とみん' WHERE id=1;  -- 既存ユーザーのニックネーム埋め

ALTER TABLE conversations
  ADD COLUMN nomikai_session_id VARCHAR(36) NULL AFTER topic_id,
  ADD KEY idx_conversations_nomikai_session (nomikai_session_id, id);

CREATE TABLE nomikai_sessions (
  id VARCHAR(36) NOT NULL,
  user_id INT UNSIGNED NULL,
  current_topic_id INT UNSIGNED NULL,
  current_topic_kind ENUM('normal','order') NOT NULL DEFAULT 'normal',
  topic_rotated_at DATETIME(3) NULL,
  topic_normals_played INT UNSIGNED NOT NULL DEFAULT 0,
  points_last_tick_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE nomikai_session_character_points (
  nomikai_session_id VARCHAR(36) NOT NULL,
  character_id INT UNSIGNED NOT NULL,
  points INT NOT NULL DEFAULT 0,
  PRIMARY KEY (nomikai_session_id, character_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE characters DROP COLUMN points;
DELETE FROM app_state WHERE k IN (
  'points_initialized', 'points_last_tick_at',
  'current_topic_id', 'current_topic_kind', 'topic_rotated_at', 'topic_normals_played'
);
```

### ラストオーダー/終了イベント（2026-05-28 追加）

α版仕様: セッション最大時間を 1 時間固定とし、自然な流れで飲み会を終了させる。

- [x] `current_topic_kind` ENUM に `closing` / `ended` を追加（schema.sql 更新 + 既存DBに ALTER 適用）
- [x] `TopicInfo` に `sessionEndAt` を追加。`getCurrentTopic` で `nomikai_sessions.created_at + 1時間` をセッション終了予定時刻として算出
- [x] 残り5分以下で話題バーの左隣に「残り5分▼」赤バッジ（fixed配置・パルス点滅、`closing`/`ended` 中は非表示）
- [x] セッション終了予定時刻を超えた次の話題ローテーション時に `closing` に遷移し、`text="飲み会終了"` で 2 分間継続
- [x] `closing` 中は turn.ts のプロンプト最優先で「楽しかった気持ち・感謝・別れの挨拶」を指示
- [x] 2 分経過で `ended` に遷移（永続終端、ローテートしない）
- [x] `ended` でクライアントが画面全面に半透明グレーのオーバーレイ + 「この飲み会は終了しました」表示
- [x] `ended` 中は自動進行ループ・音声認識・テキスト入力・送信ボタン全て無効化
- [x] `ended` 遷移時に発話中の音声を即停止、キャラ画像も `_default` に戻す
  - `playAndWait` で `audio.onpause` を resolve トリガに追加（外部 pause で即座にループ脱出）
  - `fetchAudio` await 直後の `cancelled` チェックで、終了遷移直後に取得完了した音声を再生させない
  - `reveal()` 内の `cancelled` チェックでクリーンアップ後の currentSpeech 再セットを抑止
- [x] サーバ API ガード: `POST /api/turn/next` は `ended` で `spoke: null`、`POST /api/conversations` は `ended` で 403

マイグレーション SQL:
```sql
ALTER TABLE nomikai_sessions
  MODIFY current_topic_kind ENUM('normal','order','closing','ended') NOT NULL DEFAULT 'normal';
```

テスト方法（手動UPDATE）:
```sql
-- ①「残り5分」表示
UPDATE nomikai_sessions SET created_at = DATE_SUB(NOW(3), INTERVAL 56 MINUTE) WHERE id='<SID>';
-- ② 即 closing 遷移
UPDATE nomikai_sessions
   SET created_at = DATE_SUB(NOW(3), INTERVAL 61 MINUTE),
       topic_rotated_at = DATE_SUB(NOW(3), INTERVAL 10 MINUTE)
 WHERE id='<SID>';
-- ③ 即 ended 遷移（closing 行で実行）
UPDATE nomikai_sessions
   SET current_topic_kind='closing',
       topic_rotated_at = DATE_SUB(NOW(3), INTERVAL 3 MINUTE),
       current_topic_id = NULL
 WHERE id='<SID>';
-- やり直し
UPDATE nomikai_sessions
   SET created_at = NOW(3),
       current_topic_kind = 'normal',
       current_topic_id = NULL,
       topic_rotated_at = NULL,
       topic_normals_played = 0
 WHERE id='<SID>';
```

### APNG対応・表示調整・話題ローテ修正（2026-05-23）
- [x] キャラ画像を `{slug}_default.png` / `{slug}_talk.png` の2系統に分離（ChatRoom.tsx の CharacterColumn）
  - 通常時は `_default`、`currentSpeech.slug === c.slug` の間だけ `_talk` に差し替え
  - APNG のループは画像ファイル側のループカウントに任せ、ブラウザに自動再生させる（`unoptimized` 指定済み）
  - src 切替時にフレーム0から再生されるため、発話開始と口パク開始がそろう
- [x] セリフ欄キャラ名を 1.75rem + bold（元の text-sm の約2倍）
- [x] セリフ本体フォントを 1.5rem（元の text-lg の約1.3倍、当初1.5倍で枠を僅かにはみ出したため微調整）
- [x] ユーザー直近発言／音声認識 interim 表示を 1.3125rem（元の text-sm の1.5倍）
- [x] **bugfix**：話題が残り0秒になっても表示が切替らない不具合を修正
  - 旧実装は `useEffect` の依存配列を `now >= nextRotateAt` の **真偽値** にしていた
  - クライアント時計がサーバより数百ms先行していると、最初の `refreshTopic()` でサーバが「まだ期限切れていない」と判定して同じ topic を返し、`topic.nextRotateAt` が変わらず dep が `true` のまま固定 → 二度と再取得しなくなる
  - 修正後は `topic.nextRotateAt` ちょうどに setTimeout で1回目を発火し、同じ topic が返ってきた場合は 1 秒間隔で `refreshTopic()` をリトライ。新しい `nextRotateAt` が返るとエフェクトが再 mount してリトライ停止

---

## 未着手

### その他（後回し）
- [ ] レート制限の監視（Gemini 3.5 Flash / ElevenLabs Pro）
- [ ] 長時間連続テスト用のセーフガード（コスト・ハルシネーション）
- [ ] TTS再生中はマイクをミュート（エコーフィードバック防止）するか、ヘッドホン運用とするか
- [ ] `/api/turn/next` のレスポンスに含まれる topic 情報を ChatRoom 側でも `setTopic` して、`/api/topic/current` への往復を減らす（任意の最適化）
- [ ] characters.image_file カラムは現状未参照になっているので、整理（カラム削除 or default/talk 両方を持たせる）するか判断

---

## 主要ファイル

```
/var/www/hinayoi/
├── docs/
│   ├── hinayoi.md            # 仕様書
│   ├── elevenlabs-tts-api.md
│   └── progress.md           # ← このファイル
├── prompts/                  # キャラ性格設定（{nickname} 置換対応）
│   ├── common.md
│   ├── hina.md
│   ├── koharu.md
│   ├── misaki.md
│   └── hiyori.md
├── scripts/
│   └── add-user.mjs          # ユーザー追加CLI（node --env-file=.env.local で実行）
├── sql/schema.sql
├── public/sozai -> /home/ec2-user/sozai
├── src/
│   ├── middleware.ts         # 認証 + hinayoi_nomikai cookie 発行
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                  # サーバ：初期データ取得（sessionId 経由）→ ChatRoomへ
│   │   ├── ChatRoom.tsx              # クライアント：話題/履歴/入力/ターンループ
│   │   ├── LogoutButton.tsx
│   │   ├── login/page.tsx
│   │   └── api/
│   │       ├── auth/login/route.ts
│   │       ├── auth/logout/route.ts
│   │       ├── topic/current/route.ts
│   │       ├── conversations/route.ts
│   │       ├── points/route.ts
│   │       ├── turn/next/route.ts
│   │       └── tts/route.ts
│   └── lib/
│       ├── db.ts             # mysql2 プール
│       ├── password.ts       # scrypt
│       ├── session.ts        # JWT Cookie（nickname 同梱）
│       ├── nomikai.ts        # 飲み会セッション cookie 読み + ensureNomikaiSession
│       ├── topic.ts          # 話題ローテ（通常4分 / 追加注文30秒、per-session）
│       ├── conversation.ts   # 履歴 GET/INSERT（nomikai_session_id 必須）
│       ├── replacements.ts   # ASR/TTS 置換、30sキャッシュ
│       ├── points.ts         # tick / +100 / -100 / 話者選定（per-session）
│       ├── prompts.ts        # prompts/*.md 読み込み（5sキャッシュ）
│       ├── gemini.ts         # gemini-3.5-flash REST
│       └── turn.ts           # 1ターン進行（order/post-order プロンプト分岐）
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
| `GET /api/topic/current` | 4分超過時に別話題に切替＋state永続化 |
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

- dev サーバ：ポート 7500
- ログインユーザー（DB現状）
  - `admin` / nickname=`との`
  - `tomi` / nickname=`とみん`
- 話題ローテ：通常 4 分、追加注文タイム 30 秒（3 通常 → 1 追加注文）
- ポイントtick：10秒あたり +10
- 飲み会セッション: ブラウザ起動で新規 UUID, リロードで継続
- 直前の不具合: 「音声が出ない」→ Windows のオーディオ出力デバイス切替に起因（おま環）、Windows 再起動で対処予定

### Git 状態（2026-05-28 時点・打ち合わせ前から大量に未コミット）

- 既存コミット最新: `092d5ea 20260526_01`
- 未コミットの変更（今日の作業）
  - 飲み会セッション導入（cookie、conversations 紐付け）
  - 複数アカウント対応（nickname カラム、CLI、JWT 拡張）
  - 追加注文タイム（topic 種別 + プロンプト分岐）
  - per-session state 化（nomikai_sessions / nomikai_session_character_points 新設、`characters.points` 廃止）
- 既存DBへの ALTER/CREATE/ALTER/DELETE は実行済み（ユーザー手動）

---

## 確認・調整したいこと（次回以降）

1. **音声入力の実機テスト**（Chrome Desktop、マイク権限、interim表示、自動送信、ASR置換、エコーフィードバック観察）
2. **TTS再生中のマイク自動ミュート**：エコー対策が必要なら実装
3. **プロンプト微調整**：会話の自然さ・文字数・呼びかけ・キャラの個性差を見ながら
4. **話題（topics）の追加**：現在5件のみ
5. **APNG / 口パク等の演出**：素材があれば差し替え
6. **長時間運用テスト**：レートリミット観察・コスト確認
7. **話題切替の通常4分が一時的に短縮中**: `src/lib/topic.ts` の `NORMAL_DURATION_MS` を本番値に戻す（4分）
8. **古いセッション行のクリーンアップ**: `nomikai_sessions` を期限切れで掃除する仕組み（任意）
9. ~~ラストオーダー/終了イベント~~（2026-05-28 完了）
