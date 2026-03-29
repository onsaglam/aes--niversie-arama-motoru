import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") ?? "stats";

  try {
    if (mode === "list") {
      const limit  = parseInt(searchParams.get("limit")  ?? "5000");
      const offset = parseInt(searchParams.get("offset") ?? "0");
      const lang   = searchParams.get("lang")   ?? "";
      const degree = searchParams.get("degree") ?? "";
      const search = searchParams.get("search") ?? "";

      // Dinamik WHERE koşulları — Postgres parametreleri $1, $2, ... şeklinde
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (lang) {
        const ll = lang.toLowerCase();
        const isEn = ["ingilizce", "english", "englisch"].some(x => ll.includes(x));
        const isDe = ["almanca", "german", "deutsch"].some(x => ll.includes(x));
        if (isEn) {
          conditions.push(`(lower(language) LIKE '%ingilizce%' OR lower(language) LIKE '%english%' OR lower(language) LIKE '%englisch%')`);
        } else if (isDe) {
          conditions.push(`(lower(language) LIKE '%almanca%' OR lower(language) LIKE '%german%' OR lower(language) LIKE '%deutsch%')`);
        }
      }

      if (degree) {
        params.push(`%${degree.toLowerCase()}%`);
        conditions.push(`lower(degree) LIKE $${params.length}`);
      }

      if (search) {
        const s = `%${search.toLowerCase()}%`;
        params.push(s, s, s);
        const n = params.length;
        conditions.push(`(lower(university) LIKE $${n - 2} OR lower(program) LIKE $${n - 1} OR lower(city) LIKE $${n})`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countParams = [...params];
      const countRows = await sql(
        `SELECT COUNT(*) AS cnt FROM programs ${whereClause}`,
        countParams
      );
      const total = parseInt(String(countRows[0]?.cnt ?? 0));

      params.push(limit, offset);
      const rows = await sql(
        `SELECT * FROM programs ${whereClause} ORDER BY university, program LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return NextResponse.json({ rows, total });
    }

    // ─── Stats modu ───────────────────────────────────────────────────────────
    const [countRes, freshRes, byLang, bySrc, byDeg, topUnis, uniCount, lastUpd] = await Promise.all([
      sql`SELECT COUNT(*) AS cnt FROM programs`,
      sql`
        SELECT
          SUM(CASE WHEN last_scraped >= to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') THEN 1 ELSE 0 END) AS fresh,
          SUM(CASE WHEN last_scraped <  to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') THEN 1 ELSE 0 END) AS stale
        FROM programs
      `,
      sql`SELECT language, COUNT(*) cnt FROM programs GROUP BY language ORDER BY cnt DESC`,
      sql`SELECT source,   COUNT(*) cnt FROM programs GROUP BY source   ORDER BY cnt DESC`,
      sql`SELECT degree,   COUNT(*) cnt FROM programs WHERE degree IS NOT NULL AND degree != '' GROUP BY degree ORDER BY cnt DESC`,
      sql`SELECT university, COUNT(*) cnt FROM programs GROUP BY university ORDER BY cnt DESC LIMIT 15`,
      sql`SELECT COUNT(DISTINCT university) AS cnt FROM programs`,
      sql`SELECT MAX(updated_at) AS ts FROM programs`,
    ]);

    return NextResponse.json({
      total:        parseInt(String(countRes[0]?.cnt ?? 0)),
      fresh:        parseInt(String(freshRes[0]?.fresh ?? 0)),
      stale:        parseInt(String(freshRes[0]?.stale ?? 0)),
      uni_count:    parseInt(String(uniCount[0]?.cnt ?? 0)),
      by_language:  byLang,
      by_degree:    byDeg,
      by_source:    bySrc,
      top_unis:     topUnis,
      last_updated: lastUpd[0]?.ts ?? null,
    });
  } catch (err) {
    console.error("[programs GET]", err);
    return NextResponse.json(
      { total: 0, fresh: 0, stale: 0, uni_count: 0, by_language: [], by_degree: [], by_source: [], top_unis: [], last_updated: null },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const res = await sql`
      DELETE FROM programs
      WHERE last_scraped < to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      RETURNING id
    `;
    return NextResponse.json({ deleted: res.length });
  } catch (err) {
    console.error("[programs DELETE]", err);
    return NextResponse.json({ error: "Silinemedi" }, { status: 500 });
  }
}
