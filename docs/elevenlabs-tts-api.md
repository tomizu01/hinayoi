# ElevenLabs Text-to-Speech API リファレンス

## 概要

ElevenLabs の TTS API を使って、テキストから高品質な音声を生成する。
日本語音声にも対応しており、キャラクター音声やナレーションなどに利用可能。

---

## 使い方

### エンドポイント

```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
```

### リクエストヘッダー

| ヘッダー | 値 |
|---|---|
| `xi-api-key` | ElevenLabs の API キー |
| `Content-Type` | `application/json` |

### リクエストボディ

```json
{
  "text": "読み上げるテキスト",
  "model_id": "eleven_v3",
  "language_code": "ja",
  "output_format": "mp3_44100_64",
  "voice_settings": {
    "stability": 1.0,
    "similarity_boost": 0.75,
    "style": 0.0,
    "use_speaker_boost": true
  }
}
```

### レスポンス

- **Content-Type**: `audio/mpeg`
- ボディに MP3 バイナリが返る

### 最小実装例（Node.js）

```typescript
const voiceId = 'your-voice-id';
const res = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
  {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: 'こんにちは、今日もいい天気だね',
      model_id: 'eleven_v3',
      language_code: 'ja',
      output_format: 'mp3_44100_64',
      voice_settings: {
        stability: 1.0,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  },
);

const mp3 = await res.arrayBuffer();
// mp3 を保存・再生する
```

### Next.js API Route でプロキシする例

クライアントに API キーを露出させないため、サーバー側でプロキシする。

```typescript
// app/api/elevenlabs/route.ts
import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.ELEVENLABS_API_KEY ?? '';

export async function POST(req: NextRequest) {
  const { text, voiceId } = await req.json();

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_v3',
        language_code: 'ja',
        output_format: 'mp3_44100_64',
        voice_settings: {
          stability: 1.0,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    },
  );

  const mp3Buffer = await res.arrayBuffer();
  return new NextResponse(mp3Buffer, {
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}
```

---

## パラメータ詳細

### model_id

| モデル | 特徴 |
|---|---|
| `eleven_v3` | 最新の Alpha モデル。表現力が高い。日本語対応。ただしハルシネーション（後述）のリスクあり |
| `eleven_multilingual_v2` | 安定版の多言語モデル。v3 より表現力は劣るが安定性は高い |

### language_code

多言語モデル使用時に指定。日本語なら `"ja"`。

### output_format

| フォーマット | 説明 |
|---|---|
| `mp3_44100_64` | MP3 44.1kHz 64kbps。軽量で十分な品質 |
| `mp3_44100_128` | MP3 44.1kHz 128kbps。高品質 |
| `mp3_44100_192` | MP3 44.1kHz 192kbps。最高品質 |
| `pcm_16000` | PCM 16kHz。後処理が必要な場合向け |
| `pcm_22050` | PCM 22.05kHz |
| `pcm_24000` | PCM 24kHz |
| `pcm_44100` | PCM 44.1kHz |

### voice_settings

| パラメータ | 型 | 範囲 | 推奨値 | 説明 |
|---|---|---|---|---|
| `stability` | float | 0.0 - 1.0 | **1.0** | 音声の安定性。0=Creative、0.5=Natural、1.0=Robust。**ハルシネーション対策のため 1.0 を強く推奨** |
| `similarity_boost` | float | 0.0 - 1.0 | 0.75 | 元ボイスへの類似度。高くすると忠実だがアーティファクトが増える可能性 |
| `style` | float | 0.0 - 1.0 | 0.0 | スタイル表現の強さ。上げると表現豊かだが不安定になりやすい |
| `use_speaker_boost` | bool | - | true | スピーカーの音質補正 |

---

## 推奨パラメータ（実運用で検証済み）

```json
{
  "model_id": "eleven_v3",
  "language_code": "ja",
  "output_format": "mp3_44100_64",
  "voice_settings": {
    "stability": 1.0,
    "similarity_boost": 0.75,
    "style": 0.0,
    "use_speaker_boost": true
  }
}
```

この設定を選んだ理由:

- **stability=1.0 (Robust)**: ハルシネーション抑制に最も効果が大きい
- **similarity_boost=0.75**: ボイスの個性を保ちつつ安定性とのバランスを取る
- **style=0.0**: 安定性を最優先。表現力が必要なら 0.2〜0.4 程度まで上げてもよいが、ハルシネーションリスクが上がる
- **mp3_44100_64**: Web 再生には十分な品質で、レスポンスサイズも小さい

---

## 注意事項

### 1. ハルシネーション（音声の暴走）

**eleven_v3 の最大の注意点。** 入力テキストの内容と無関係な音声が延々と生成されることがある。

- **発生条件**: 長文ほど発生しやすい。100文字のテキストに対して 5MB（約650秒）の音声が返った実例あり
- **対策（すべて併用を推奨）**:
  1. **stability=1.0 (Robust)** を必ず設定する — これだけで大幅に抑制される
  2. **入力テキストを短く保つ** — 50文字以下を推奨。長文は分割して複数回呼ぶ
  3. **再生時にタイムアウトを設ける** — 想定再生時間の2〜3倍を上限とし、超えたら強制停止する

```typescript
// 再生タイムアウトの実装例
function playWithTimeout(audio: HTMLAudioElement, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      audio.pause();
      resolve();
    }, maxMs);
    audio.onended = () => { clearTimeout(timer); resolve(); };
    audio.play();
  });
}

// 20秒でタイムアウト
await playWithTimeout(audio, 20000);
```

### 2. API キーの管理

- `ELEVENLABS_API_KEY` はサーバー側のみで使用する（`NEXT_PUBLIC_` を付けない）
- クライアントから直接 ElevenLabs API を呼ばず、API Route でプロキシする

### 3. レート制限・クォータ

- プランごとに月間の文字数上限がある
- 並列リクエスト数にも制限あり（プランによる）
- 429 (Too Many Requests) が返ったらリトライ間隔を空ける

### 4. Voice ID の取得

ElevenLabs のダッシュボード、または API で取得:

```bash
curl -s https://api.elevenlabs.io/v1/voices \
  -H "xi-api-key: $ELEVENLABS_API_KEY" | jq '.voices[] | {voice_id, name}'
```

Voice Library から追加したボイスや、自分でクローンしたボイスの ID もここで確認できる。

### 5. ブラウザでの音声再生

- `fetch` → `res.blob()` → `URL.createObjectURL()` → `new Audio(url)` → `audio.play()` の流れ
- 再生前に `audio.load()` + `canplaythrough` イベントを待つと、再生開始のラグを減らせる
- 使い終わったら `URL.revokeObjectURL()` でメモリを解放する
- ユーザー操作を起点にしないと `audio.play()` がブラウザにブロックされる場合がある（autoplay policy）

### 6. エラーハンドリング

| ステータス | 原因 | 対処 |
|---|---|---|
| 401 | API キーが無効 | キーを確認 |
| 422 | リクエストボディが不正（voice_id が存在しない等） | パラメータを確認 |
| 429 | レート制限 | 間隔を空けてリトライ |
| 500/503 | ElevenLabs 側の障害 | 時間を空けてリトライ、またはフォールバック音声エンジンに切替 |
