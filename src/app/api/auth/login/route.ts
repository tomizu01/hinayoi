import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getPool } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/session";

type UserRow = RowDataPacket & {
  id: number;
  login_id: string;
  password_hash: string;
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!loginId || !password) {
    return NextResponse.json({ error: "ログインIDとパスワードを入力してください" }, { status: 400 });
  }

  const pool = getPool();
  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, login_id, password_hash FROM users WHERE login_id = ? LIMIT 1",
    [loginId],
  );

  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: "ログインIDまたはパスワードが違います" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "ログインIDまたはパスワードが違います" }, { status: 401 });
  }

  await setSessionCookie({ uid: user.id, login: user.login_id });
  return NextResponse.json({ ok: true });
}
