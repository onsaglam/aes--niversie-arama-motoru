import { NextResponse } from "next/server";
import path from "path";
import Database from "better-sqlite3";
import fs from "fs";

const DB_PATH = path.resolve(process.cwd(), "../aes-agent/programs.db");

function getDb(readonly = true) {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") ?? "stats";

  const db = getDb();
  if (!db) {
    return NextResponse.json({ total: 0, fresh: 0, stale: 0, by_language: [], by_source: [], top_unis: [], last_updated: null });
  }

  try {
    if (mode === "list") {
      const limit   = parseInt(searchParams.get("limit")  ?? "5000");
      const offset  = parseInt(searchParams.get("offset") ?? "0");
      const lang    = searchParams.get("lang")   ?? "";
      const degree  = searchParams.get("degree") ?? "";
      const search  = searchParams.get("search") ?? "";

      const clauses: string[] = [];
      const params: (string | number)[] = [];

      if (lang) {
        const ll = lang.toLowerCase();
        const isEn = ["ingilizce", "english", "englisch"].some(x => ll.includes(x));
        const isDe = ["almanca", "german", "deutsch"].some(x => ll.includes(x));
        if (isEn) {
          clauses.push("(lower(language) LIKE '%ingilizce%' OR lower(language) LIKE '%english%' OR lower(language) LIKE '%englisch%')");
        } else if (isDe) {
          clauses.push("(lower(language) LIKE '%almanca%' OR lower(language) LIKE '%german%' OR lower(language) LIKE '%deutsch%')");
        }
      }

      if (degree) {
        clauses.push("lower(degree) LIKE ?");
        params.push(`%${degree.toLowerCase()}%`);
      }

      if (search) {
        clauses.push("(lower(university) LIKE ? OR lower(program) LIKE ? OR lower(city) LIKE ?)");
        const s = `%${search.toLowerCase()}%`;
        params.push(s, s, s);
      }

      const where  = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
      const rows   = db.prepare(
        `SELECT * FROM programs ${where} ORDER BY university, program LIMIT ? OFFSET ?`
      ).all(...params, limit, offset) as Record<string, unknown>[];
      const total  = (db.prepare(`SELECT COUNT(*) as cnt FROM programs ${where}`).get(...params) as { cnt: number }).cnt;
      return NextResponse.json({ rows, total });
    }

    // stats (default)
    const total     = (db.prepare("SELECT COUNT(*) as cnt FROM programs").get() as { cnt: number }).cnt;
    const freshness = db.prepare(`
      SELECT
        SUM(CASE WHEN last_scraped >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS fresh,
        SUM(CASE WHEN last_scraped <  datetime('now','-30 days') THEN 1 ELSE 0 END) AS stale
      FROM programs
    `).get() as { fresh: number; stale: number };
    const by_language = db.prepare(
      "SELECT language, COUNT(*) cnt FROM programs GROUP BY language ORDER BY cnt DESC"
    ).all();
    const by_source   = db.prepare(
      "SELECT source, COUNT(*) cnt FROM programs GROUP BY source ORDER BY cnt DESC"
    ).all();
    const by_degree   = db.prepare(
      "SELECT degree, COUNT(*) cnt FROM programs WHERE degree IS NOT NULL AND degree != '' GROUP BY degree ORDER BY cnt DESC"
    ).all();
    const top_unis    = db.prepare(
      "SELECT university, COUNT(*) cnt FROM programs GROUP BY university ORDER BY cnt DESC LIMIT 15"
    ).all();
    const uni_count   = (db.prepare("SELECT COUNT(DISTINCT university) as cnt FROM programs").get() as { cnt: number }).cnt;
    const last_updated = (db.prepare("SELECT MAX(updated_at) as ts FROM programs").get() as { ts: string | null }).ts;

    return NextResponse.json({
      total,
      fresh:        freshness?.fresh  ?? 0,
      stale:        freshness?.stale  ?? 0,
      uni_count,
      by_language,
      by_degree,
      by_source,
      top_unis,
      last_updated,
    });
  } finally {
    db.close();
  }
}

// Eski (30+ gün) kayıtları sil
export async function DELETE() {
  const db = getDb(false);
  if (!db) return NextResponse.json({ deleted: 0 });
  try {
    const result = db.prepare(
      "DELETE FROM programs WHERE last_scraped < datetime('now', '-30 days')"
    ).run();
    db.exec("VACUUM");
    return NextResponse.json({ deleted: result.changes });
  } finally {
    db.close();
  }
}
