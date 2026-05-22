import { readFile } from "fs/promises";
import path from "path";

const PROMPT_DIR = path.join(process.cwd(), "prompts");
const CACHE_TTL_MS = 5_000;

const cache = new Map<string, { at: number; text: string }>();

async function readCached(name: string): Promise<string> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
  const file = path.join(PROMPT_DIR, name);
  const text = await readFile(file, "utf-8");
  cache.set(name, { at: Date.now(), text });
  return text;
}

export async function getCommonPrompt(): Promise<string> {
  return readCached("common.md");
}

export async function getCharacterPrompt(slug: string): Promise<string> {
  return readCached(`${slug}.md`);
}
