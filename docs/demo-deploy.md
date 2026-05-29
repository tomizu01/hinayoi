# α版デモ環境 構築手順

2026-05-28 時点。現EC2を「開発環境」、新規EC2を「デモ環境」として分離するための手順。

## 0. 構成

| 項目 | 現EC2（開発環境化） | 新EC2（デモ環境） |
| --- | --- | --- |
| ドメイン | dev-hinayoi.mediowl.ai | hinayoi.mediowl.ai |
| アプリ起動 | `npm run start`（7500） | `npm run start`（7500） |
| nginx | 不使用 | 不使用 |
| DB | 現状のRDS | 新EC2ローカルのMySQL（インストール済） |
| ALBターゲット | 既存TG（dev用に切替） | 新規TG（demo用） |

API キー等はすべて現サーバの値をそのまま流用する。デモ専用アカウント発行はα版段階では行わない。

## 1. 事前準備（新EC2側で確認）

新EC2にSSHしてから以下を確認する。

```bash
# Node.js（現EC2は v22.22.0。同等以上であること）
node --version
# 22系でなければ nvm 等で導入：
#   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
#   nvm install 22 && nvm alias default 22

# MySQL（インストール済の想定）
mysql --version
sudo systemctl status mysqld   # 起動していなければ enable + start

# git
git --version
```

セキュリティグループは以下を許可：
- インバウンド `7500/tcp` を ALB のSG から
- インバウンド `22/tcp` を運用元IP から
- アウトバウンドは全許可（Gemini / ElevenLabs API への外向き通信）

## 2. アプリ配置（新EC2）

現EC2と同じ `/var/www/hinayoi` に配置する。

```bash
sudo mkdir -p /var/www
sudo chown ec2-user:ec2-user /var/www
cd /var/www

# git経由の場合（現EC2と同じリポジトリ）
git clone <リポジトリURL> hinayoi
cd hinayoi
git checkout main

# あるいは現EC2から rsync（node_modules / .next / .env.local は除外）
# 現EC2側で:
#   rsync -avz --exclude node_modules --exclude .next --exclude .env.local \
#     /var/www/hinayoi/ ec2-user@<新EC2>:/var/www/hinayoi/

npm install
```

## 3. データベース移行

### 3.1 現EC2側でdump

現EC2の `.env.local` から `DB_HOST / DB_USER / DB_PASSWORD / DB_NAME` を確認したうえで、

```bash
# 現EC2上で
cd /tmp
mysqldump \
  -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" \
  --single-transaction --routines --triggers \
  --default-character-set=utf8mb4 \
  "$DB_NAME" > hinayoi_$(date +%Y%m%d_%H%M).sql

# 新EC2へ転送
scp hinayoi_*.sql ec2-user@<新EC2>:/tmp/
```

### 3.2 新EC2側でrestore

```bash
# rootで MySQL に入り、DB とユーザーを作成
sudo mysql <<'EOS'
CREATE DATABASE IF NOT EXISTS hinayoi
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'ai'@'localhost' IDENTIFIED BY '<任意のパスワード>';
GRANT ALL PRIVILEGES ON hinayoi.* TO 'ai'@'localhost';
FLUSH PRIVILEGES;
EOS

# dump をリストア
mysql -u ai -p hinayoi < /tmp/hinayoi_*.sql

# 件数確認（現EC2と一致することを確認）
mysql -u ai -p hinayoi -e "
  SELECT 'users', COUNT(*) FROM users
  UNION SELECT 'characters', COUNT(*) FROM characters
  UNION SELECT 'nomikai_sessions', COUNT(*) FROM nomikai_sessions
  UNION SELECT 'conversations', COUNT(*) FROM conversations;"
```

## 4. 環境変数

`/var/www/hinayoi/.env.local` を新規作成。API キーは現EC2の同名ファイルから値をコピーする。

```ini
# DB（新EC2のローカルMySQLを指す）
DB_HOST=127.0.0.1
DB_NAME=hinayoi
DB_USER=ai
DB_PASSWORD=<3.2 で設定したパスワード>

# Session（現EC2と同じ値を流用してOK。差し替えると既存セッションが切れる）
SESSION_SECRET=<現EC2の値>

# Gemini
GEMINI_API_KEY=<現EC2の値>

# ElevenLabs
ELEVENLABS_API_KEY=<現EC2の値>
```

```bash
chmod 600 /var/www/hinayoi/.env.local
```

## 5. ビルド & 起動

`restart.sh` がそのまま使える（ポート7500のプロセスを落として `npm run build` → `npm run start` をバックグラウンド起動）。

```bash
cd /var/www/hinayoi
./restart.sh

# 起動確認
ss -tlnp | grep 7500
curl -sI http://127.0.0.1:7500/ | head -5
```

再起動時の自動起動が必要なら別途 systemd ユニット化する（α版段階では手動運用で可）。

## 6. ALB 設定変更

### 6.1 新規ターゲットグループ作成（demo 用）

- 名前: `hinayoi-demo-tg`（任意）
- プロトコル / ポート: HTTP / 7500
- ターゲットタイプ: instance
- VPC: ALB と同じ
- ヘルスチェック: HTTP / パス `/` / 成功コード `200,307`（Next.js のルートはリダイレクトを返すため `307` も成功扱いに含める）
- 新EC2のインスタンスを登録（ポート7500）
- ステータスが `healthy` になるのを確認

### 6.2 ALB リスナールール変更

既存の HTTPS:443 リスナーで、ホストヘッダのルーティングを以下のように差し替える。

| ホスト | 旧 | 新 |
| --- | --- | --- |
| `hinayoi.mediowl.ai` | 現EC2のTG | `hinayoi-demo-tg`（新EC2） |
| `dev-hinayoi.mediowl.ai` | （無し） | 現EC2のTG（既存のhinayoi用TG） |

手順：

1. 既存の `hinayoi.mediowl.ai → 現EC2 TG` ルールを編集し、転送先を `hinayoi-demo-tg` に変更。
2. 新規ルールを追加： `Host = dev-hinayoi.mediowl.ai` → 現EC2 TG。
3. ACM 証明書がワイルドカード（`*.mediowl.ai`）であればそのまま使える。SAN列挙型の場合は `dev-hinayoi.mediowl.ai` を SAN に追加した証明書を再発行し、リスナーにアタッチする。

### 6.3 Route 53

- `hinayoi.mediowl.ai` … 既存のALB向けエイリアスがあればそのまま（ALB側で振り分け済のため変更不要）。
- `dev-hinayoi.mediowl.ai` … 同じALBへの A レコード（エイリアス）を新規作成。

## 7. 動作確認

DNS伝播後に以下を確認：

```bash
# デモ環境
curl -sI https://hinayoi.mediowl.ai/ | head -3
# 開発環境
curl -sI https://dev-hinayoi.mediowl.ai/ | head -3
```

ブラウザ確認：

- `https://hinayoi.mediowl.ai/` … ログイン → 飲み会開始 → 会話再生まで通る
- `https://dev-hinayoi.mediowl.ai/` … 開発用として従来どおり動作
- 既存ユーザーでログインできること（SESSION_SECRETを流用していれば現セッションも維持）
- TTS（ElevenLabs）と LLM（Gemini）両方の API 呼び出しが新EC2から成功している（アプリログで確認）

## 8. 切替後の運用メモ

- **DB の同期は行わない**。デモ環境と開発環境は切替時点でフォークされた状態となり、以降は独立に更新される。デモで作られたデータを開発側に戻したい / 逆方向に同期したい場合は、その都度 dump & restore で個別対応する。
- 既知の残課題（α版で未対応）
  - レートリミット未実装（Gemini / ElevenLabs の従量課金が利用量次第で跳ねる可能性）
  - デモ用アカウント分離なし
- API キーは現EC2と同一のものを使い回しているため、片方で revoke すると両環境が止まる。β版以降でキー分割を検討する。
