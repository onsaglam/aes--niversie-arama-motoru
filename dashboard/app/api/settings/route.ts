/**
 * GET /api/settings → API anahtarı durumu + DB/öğrenci istatistikleri
 */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

function maskKey(val: string | undefined): string {
  if (!val || val.length < 10) return "—";
  return val.slice(0, 6) + "•".repeat(12) + val.slice(-4);
}

export async function GET() {
  const keys = {
    anthropic:  { label: "Anthropic Claude API", value: process.env.ANTHROPIC_API_KEY  ?? "", docs: "console.anthropic.com" },
    tavily:     { label: "Tavily (Web Arama)",    value: process.env.TAVILY_API_KEY     ?? "", docs: "app.tavily.com" },
    scraperapi: { label: "ScraperAPI (Anti-Bot)", value: process.env.SCRAPER_API_KEY    ?? "", docs: "dashboard.scraperapi.com" },
    serper:     { label: "Serper (Google Arama)", value: process.env.SERPER_API_KEY     ?? "", docs: "serper.dev" },
  };

  // DB istatistikleri — Neon'dan
  let programCount = 0;
  let studentCount = 0;
  try {
    const [pRes, sRes] = await Promise.all([
      sql`SELECT COUNT(*) AS cnt FROM programs`,
      sql`SELECT COUNT(*) AS cnt FROM students`,
    ]);
    programCount = parseInt(String(pRes[0]?.cnt ?? 0));
    studentCount = parseInt(String(sRes[0]?.cnt ?? 0));
  } catch { /* tablo henüz oluşturulmamış olabilir */ }

  return NextResponse.json({
    api_keys: Object.fromEntries(
      Object.entries(keys).map(([k, v]) => [
        k,
        {
          label:  v.label,
          status: v.value && v.value.length > 10 ? "ok" : "missing",
          masked: maskKey(v.value),
          docs:   v.docs,
        },
      ])
    ),
    db: {
      exists:        programCount > 0,
      size_mb:       null,          // Neon'da dosya boyutu yok
      program_count: programCount,
    },
    students:        studentCount,
    env_file_exists: false,         // Vercel'de .env dosyası yok, env vars kullan
    agent_dir:       process.env.VERCEL ? "(Vercel — yerel agent yok)" : "../aes-agent",
  });
}
