const MODEL = "gemini-3.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

type Part = { text?: string };
type Candidate = { content?: { parts?: Part[] } };
type Response = { candidates?: Candidate[] };

export async function generateContent(input: {
  systemInstruction: string;
  userMessage: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: input.userMessage }] }],
      generationConfig: {
        temperature: input.temperature ?? 0.85,
        // Gemini 3.x系はthinkingにトークンを使うため余裕を持たせる
        maxOutputTokens: input.maxOutputTokens ?? 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 400)}`);
  }

  const data = (await res.json()) as Response;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  return text.trim();
}
