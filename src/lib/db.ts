import mysql from "mysql2/promise";

declare global {
  // eslint-disable-next-line no-var
  var __hinayoiPool: mysql.Pool | undefined;
}

export function getPool(): mysql.Pool {
  if (!global.__hinayoiPool) {
    global.__hinayoiPool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: "utf8mb4",
      waitForConnections: true,
      connectionLimit: 8,
    });
  }
  return global.__hinayoiPool;
}
