#!/usr/bin/env node
// usage:
//   node --env-file=.env.local scripts/add-user.mjs <loginId> <password> <nickname>
//
// パスワードハッシュ形式は src/lib/password.ts と同形式（scrypt$salt$hash）
import mysql from "mysql2/promise";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${buf.toString("hex")}`;
}

const [, , loginId, password, nickname] = process.argv;

if (!loginId || !password || !nickname) {
  console.error(
    "usage: node --env-file=.env.local scripts/add-user.mjs <loginId> <password> <nickname>",
  );
  process.exit(1);
}

if (nickname.length > 32) {
  console.error("nickname must be <= 32 characters");
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4",
});

try {
  const hash = await hashPassword(password);
  await conn.query(
    "INSERT INTO users (login_id, password_hash, nickname) VALUES (?, ?, ?)",
    [loginId, hash, nickname],
  );
  console.log(`added: login_id=${loginId}, nickname=${nickname}`);
} catch (e) {
  if (e && e.code === "ER_DUP_ENTRY") {
    console.error(`login_id "${loginId}" は既に存在します`);
  } else {
    console.error("failed:", e?.message ?? e);
  }
  process.exitCode = 1;
} finally {
  await conn.end();
}
