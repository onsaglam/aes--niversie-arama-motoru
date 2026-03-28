import { NextResponse } from "next/server";
import path from "path";
import Database from "better-sqlite3";
import fs from "fs";
import { spawn } from "child_process";

const DB_PATH    = path.resolve(process.cwd(), "../aes-agent/programs.db");
const AGENT_DIR  = path.resolve(process.cwd(), "../aes-agent");
const SCRIPT     = path.join(AGENT_DIR, "enrich_db.py");

// Python yolunu sırayla dene
function findPython(): string {
  const candidates = [
    path.join(AGENT_DIR, "venv", "bin", "python3"),
    path.join(AGENT_DIR, "venv", "bin", "python"),
    "python3",
    "python",
  ];
  for (const p of candidates) {
    if (p.startsWith("/") && !fs.existsSync(p)) continue;
    return p;
  }
  return "python3";
}

function getDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

// ── GET: Zenginleştirme istatistikleri ─────────────────────────────────────
export async function GET() {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ needs_stage1: 0, needs_stage2: 0, total: 0 });
  }

  try {
    const row = db.prepare(`
      SELECT
        SUM(CASE WHEN url IS NULL OR url = '' THEN 1 ELSE 0 END) AS needs_stage1,
        SUM(
          CASE WHEN (url IS NOT NULL AND url != '')
                AND (
                     (deadline_wise IS NULL AND deadline_sose IS NULL)
                  OR (german_requirement IS NULL AND english_requirement IS NULL
                      AND lower(language) NOT LIKE '%english%'
                      AND lower(language) NOT LIKE '%ingilizce%')
                )
                AND source NOT LIKE '%university_official_site%'
          THEN 1 ELSE 0 END
        ) AS needs_stage2,
        COUNT(*) AS total
      FROM programs
    `).get() as { needs_stage1: number; needs_stage2: number; total: number };

    return NextResponse.json({
      needs_stage1: row.needs_stage1 ?? 0,
      needs_stage2: row.needs_stage2 ?? 0,
      total:        row.total        ?? 0,
    });
  } finally {
    db.close();
  }
}

// ── POST: Enrichment başlat ─────────────────────────────────────────────────
export async function POST(req: Request) {
  const body  = await req.json().catch(() => ({})) as Record<string, unknown>;
  const stage = (body.stage as string) ?? "all";   // "1" | "2" | "all"
  const batch = Number(body.batch ?? 20);

  if (!fs.existsSync(SCRIPT)) {
    return NextResponse.json(
      { error: "enrich_db.py bulunamadı. aes-agent dizinini kontrol edin." },
      { status: 404 }
    );
  }

  const args: string[] = [SCRIPT];
  if (stage === "all") {
    args.push("--all");
  } else {
    args.push("--stage", stage);
  }
  args.push("--batch", String(batch));

  const python = findPython();

  return new Promise<NextResponse>((resolve) => {
    const child = spawn(python, args, {
      cwd: AGENT_DIR,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    // 5 dakika zaman aşımı
    const timer = setTimeout(() => {
      child.kill();
      resolve(
        NextResponse.json(
          { success: false, error: "Zaman aşımı (5 dk). Daha küçük bir batch deneyin." },
          { status: 408 }
        )
      );
    }, 300_000);

    child.on("close", (code: number) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(
          NextResponse.json({
            success: true,
            output: stdout.slice(-3000),
          })
        );
      } else {
        resolve(
          NextResponse.json(
            {
              success: false,
              error: (stderr || stdout).slice(-1500),
              code,
            },
            { status: 500 }
          )
        );
      }
    });
  });
}
