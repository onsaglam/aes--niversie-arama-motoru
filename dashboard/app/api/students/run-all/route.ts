/**
 * POST /api/students/run-all
 * Profili hazır olan ama sonucu olmayan (veya eski) öğrencileri sıraya alır
 * ve ajanı sırayla çalıştırır (SSE akışı ile ilerleme bildirir).
 *
 * Query params:
 *  ?mode=stale  → sadece 7+ gündür çalışmamışları (default)
 *  ?mode=all    → araştırma sonucu olanları da dahil et
 *  ?quick=1     → her öğrenci için --quick flag
 */
import { NextResponse } from "next/server";
import { spawn, execFileSync } from "child_process";
import path from "path";
import fs from "fs";

const AGENT_DIR    = path.resolve(process.cwd(), "../aes-agent");
const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");
const VENV_PYTHON  = path.join(AGENT_DIR, "venv/bin/python");

function resolvePython(): string {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  try { execFileSync("python3", ["--version"], { stdio: "ignore" }); return "python3"; } catch { /* */ }
  try { execFileSync("python",  ["--version"], { stdio: "ignore" }); return "python";  } catch { /* */ }
  return VENV_PYTHON;
}

function isStale(folder: string): boolean {
  const files = fs.readdirSync(folder)
    .filter((f) => f.startsWith("arastirma_") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) return true; // hiç sonuç yok → eski sayılır
  const stat = fs.statSync(path.join(folder, files[0]));
  const daysSince = (Date.now() - stat.mtimeMs) / 86400000;
  return daysSince >= 7;
}

export async function POST(req: Request) {
  if (!fs.existsSync(STUDENTS_DIR)) {
    return NextResponse.json({ error: "Öğrenci dizini bulunamadı" }, { status: 404 });
  }

  const url   = new URL(req.url);
  const mode  = url.searchParams.get("mode") ?? "stale";
  const quick = url.searchParams.get("quick") === "1";

  // Öğrenci listesini belirle
  const allFolders = fs.readdirSync(STUDENTS_DIR)
    .filter((f) => fs.statSync(path.join(STUDENTS_DIR, f)).isDirectory());

  const queue = allFolders.filter((name) => {
    const folder = path.join(STUDENTS_DIR, name);
    // Profil.docx yoksa atla
    if (!fs.existsSync(path.join(folder, "profil.docx"))) return false;
    // .running kilidi varsa atla
    const runFile = path.join(folder, ".running");
    if (fs.existsSync(runFile)) {
      const ageMins = (Date.now() - fs.statSync(runFile).mtimeMs) / 60000;
      if (ageMins < 120) return false;
    }
    if (mode === "all") return true;
    return isStale(folder); // mode=stale
  });

  if (queue.length === 0) {
    return NextResponse.json({ message: "Çalıştırılacak öğrenci yok", queue: [] });
  }

  const python = resolvePython();

  // SSE stream: her öğrenci için satır satır log aktar
  const encoder = new TextEncoder();

  function sse(data: object) {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse({ type: "start", total: queue.length, queue }));

      for (let i = 0; i < queue.length; i++) {
        const name = queue[i];
        controller.enqueue(sse({ type: "student_start", name, index: i + 1, total: queue.length }));

        await new Promise<void>((resolve) => {
          const args = ["src/agent.py", "--student", name];
          if (quick) args.push("--quick");

          const proc = spawn(python, args, {
            cwd: AGENT_DIR,
            env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
          });

          proc.stdout.on("data", (d: Buffer) => {
            controller.enqueue(sse({ type: "log", name, text: d.toString() }));
          });
          proc.stderr.on("data", (d: Buffer) => {
            controller.enqueue(sse({ type: "log", name, text: d.toString() }));
          });
          proc.on("close", (code) => {
            controller.enqueue(sse({
              type: "student_done",
              name,
              exitCode: code,
              success: code === 0,
            }));
            resolve();
          });
          proc.on("error", (err) => {
            controller.enqueue(sse({ type: "error", name, message: err.message }));
            resolve();
          });
        });
      }

      controller.enqueue(sse({ type: "done", total: queue.length }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

/** GET /api/students/run-all → sıradaki öğrenci sayısını döndür */
export async function GET() {
  if (!fs.existsSync(STUDENTS_DIR)) return NextResponse.json({ pending: 0, queue: [] });

  const allFolders = fs.readdirSync(STUDENTS_DIR)
    .filter((f) => fs.statSync(path.join(STUDENTS_DIR, f)).isDirectory());

  const queue = allFolders.filter((name) => {
    const folder = path.join(STUDENTS_DIR, name);
    if (!fs.existsSync(path.join(folder, "profil.docx"))) return false;
    const runFile = path.join(folder, ".running");
    if (fs.existsSync(runFile)) {
      const ageMins = (Date.now() - fs.statSync(runFile).mtimeMs) / 60000;
      if (ageMins < 120) return false;
    }
    return isStale(folder);
  });

  return NextResponse.json({ pending: queue.length, queue });
}
