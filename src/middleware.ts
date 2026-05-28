import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "hinayoi_session";
const NOMIKAI_COOKIE = "hinayoi_nomikai";

async function isAuthed(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = await isAuthed(req);

  if (pathname === "/login") {
    if (authed) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (!authed) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }

  // 飲み会セッションIDが無ければ新規発行（ブラウザセッションクッキー）
  const existing = req.cookies.get(NOMIKAI_COOKIE)?.value;
  if (existing) return NextResponse.next();

  const id = crypto.randomUUID();
  // request 側にも入れて同一リクエスト内の Server Component / API でも読めるようにする
  req.cookies.set(NOMIKAI_COOKIE, id);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(NOMIKAI_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    // maxAge / expires は付けない → ブラウザ終了で消える
  });
  return res;
}

export const config = {
  matcher: [
    // 認証対象： /, /login, それ以外も基本的に対象。静的・APIの一部だけ除外。
    "/((?!api|_next/static|_next/image|favicon.ico|sozai|.*\\..*).*)",
  ],
};
