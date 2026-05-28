import { cookies } from "next/headers";

export const NOMIKAI_COOKIE_NAME = "hinayoi_nomikai";

export async function getNomikaiSessionId(): Promise<string | null> {
  const c = await cookies();
  return c.get(NOMIKAI_COOKIE_NAME)?.value ?? null;
}
