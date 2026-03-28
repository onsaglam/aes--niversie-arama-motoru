/**
 * GET /api/settings → API anahtarı durumu (değerleri değil, var/yok bilgisi)
 */
import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const AGENT_DIR = path.resolve(process.cwd(), "../aes-agent");
const DB_PATH   = path.resolve(process.cwd(), "../aes-agent/programs.db");

function maskKey(val: string | undefined): string {
  if (!val || val.length < 10) return "—";
  return val.slice(0, 6) + "•".repeat(12) + val.slice(-4);
}

export async function GET() {
  // .env dosyasını oku (process.env zaten yüklü olabilir, ama maskelenmiş göstermek için)
  const envPath = path.join(AGENT_DIR, ".env");
  const envVars: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (m) envVars[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }

  const getVal = (key: string) => envVars[key] || process.env[key] || "";

  const keys = {
    anthropic:  { label: "Anthropic Claude API", value: getVal("ANTHROPIC_API_KEY"),  docs: "console.anthropic.com" },
    tavily:     { label: "Tavily (Web Arama)",    value: getVal("TAVILY_API_KEY"),     docs: "app.tavily.com" },
    scraperapi: { label: "ScraperAPI (Anti-Bot)", value: getVal("SCRAPER_API_KEY"),    docs: "dashboard.scraperapi.com" },
    serper:     { label: "Serper (Google Arama)", value: getVal("SERPER_API_KEY"),     docs: "serper.dev" },
  };

  // DB istatistikleri
  const dbStats = { exists: false, size_mb: 0, program_count: 0 };
  if (fs.existsSync(DB_PATH)) {
    dbStats.exists = true;
    dbStats.size_mb = Math.round(fs.statSync(DB_PATH).size / 1024 / 1024 * 10) / 10;
    // Program sayısı — hızlı sql yerine dosya boyutundan tahmin et (DB açmadan)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require("better-sqlite3")(DB_PATH, { readonly: true });
      dbStats.program_count = (db.prepare("SELECT COUNT(*) as cnt FROM programs").get() as { cnt: number }).cnt;
      db.close();
    } catch { /* ignore */ }
  }

  // ogrenciler klasörü bilgisi
  const studentsDir = path.resolve(process.cwd(), "../aes-agent/ogrenciler");
  let studentCount = 0;
  if (fs.existsSync(studentsDir)) {
    studentCount = fs.readdirSync(studentsDir).filter((f) =>
      fs.statSync(path.join(studentsDir, f)).isDirectory()
    ).length;
  }

  return NextResponse.json({
    api_keys: Object.fromEntries(
      Object.entries(keys).map(([k, v]) => [
        k,
        {
          label:   v.label,
          status:  v.value && v.value.length > 10 ? "ok" : "missing",
          masked:  maskKey(v.value),
          docs:    v.docs,
        },
      ])
    ),
    db: dbStats,
    students: studentCount,
    env_file_exists: fs.existsSync(envPath),
    agent_dir: AGENT_DIR,
  });
}
