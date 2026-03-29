/**
 * POST /api/students/run-all — Tüm öğrenciler için ajanı sıraya alır (sadece local)
 * GET  /api/students/run-all — Bekleyen öğrenci sayısını döndürür
 */
import { NextResponse } from "next/server";
import { spawn, execFileSync } from "child_process";
import { sql } from "@/lib/db";
import path from "path";
import fs from "fs";

const AGENT_DIR   = path.resolve(process.cwd(), "../aes-agent");
const VENV_PYTHON = path.join(AGENT_DIR, "venv/bin/python");

function resolvePython(): string {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  try { execFileSync("python3", ["--version"], { stdio: "ignore" }); return "python3"; } catch { /* */ }
  try { execFileSync("python",  ["--version"], { stdio: "ignore" }); return "python";  } catch { /* */ }
  return VENV_PYTHON;
}

async function getStaleStudents(): Promise<string[]> {
  // 7+ gündür çalışmamış veya hiç çalışmamış öğrenciler
  const rows = await sql`
    SELECT s.name
    FROM students s
    LEFT JOIN (
      SELECT DISTINCT ON (student_name) student_name, run_at
      FROM student_results
      ORDER BY student_name, id DESC
    ) r ON r.student_name = s.name
    WHERE r.run_at IS NULL
       OR r.run_at < to_char(NOW() - INTERVAL '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  `;
  return rows.map((r) => (r as { name: string }).name);
}

async function getAllStudents(): Promise<string[]> {
  const rows = await sql`SELECT name FROM students ORDER BY name`;
  return rows.map((r) => (r as { name: string }).name);
}

async function getRunningStudents(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT ON (student_name) student_name
    FROM student_results
    WHERE is_running = 1
    ORDER BY student_name, id DESC
  `;
  return rows.map((r) => (r as { student_name: string }).student_name);
}

export async function GET() {
  try {
    const stale   = await getStaleStudents();
    const running = await getRunningStudents();
    const queue   = stale.filter((n) => !running.includes(n));
    return NextResponse.json({ pending: queue.length, queue });
  } catch (err) {
    return NextResponse.json({ pending: 0, queue: [], error: String(err) });
  }
}

export async function POST(req: Request) {
  // Vercel'de Python subprocess çalıştırılamaz
  if (process.env.VERCEL) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: "error", message: "Ajan çalıştırma özelliği yalnızca yerel ortamda kullanılabilir. Terminalde: cd aes-agent && python src/agent.py --all" })}\n\n`
        ));
        ctrl.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  const url   = new URL(req.url);
  const mode  = url.searchParams.get("mode") ?? "stale";
  const quick = url.searchParams.get("quick") === "1";

  const running = await getRunningStudents();
  const allNames = mode === "all" ? await getAllStudents() : await getStaleStudents();
  const queue = allNames.filter((n) => !running.includes(n));

  if (queue.length === 0) {
    return NextResponse.json({ message: "Çalıştırılacak öğrenci yok", queue: [] });
  }

  const python  = resolvePython();
  const encoder = new TextEncoder();
  function sse(data: object) { return encoder.encode(`data: ${JSON.stringify(data)}\n\n`); }

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
          proc.stdout.on("data", (d: Buffer) => controller.enqueue(sse({ type: "log", name, text: d.toString() })));
          proc.stderr.on("data", (d: Buffer) => controller.enqueue(sse({ type: "log", name, text: d.toString() })));
          proc.on("close", (code) => {
            controller.enqueue(sse({ type: "student_done", name, exitCode: code, success: code === 0 }));
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
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
}
