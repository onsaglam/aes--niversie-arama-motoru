import { spawn, execFileSync } from "child_process";
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

function safeName(name: string): boolean {
  return /^[\w\-çÇğĞıİöÖşŞüÜ][\w\s\-çÇğĞıİöÖşŞüÜ]{0,60}$/.test(name) && !name.includes("..");
}

export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return new Response("Geçersiz öğrenci adı", { status: 400 });

  // Vercel'de Python subprocess çalıştırılamaz
  if (process.env.VERCEL) {
    return new Response(
      "⚠️ Ajan çalıştırma özelliği yalnızca yerel ortamda kullanılabilir.\n" +
      "Terminalde şunu çalıştırın:\n\n" +
      `  cd aes-agent\n  python src/agent.py --student "${name}"\n`,
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const quick  = new URL(_req.url).searchParams.get("quick") === "1";
  const python = resolvePython();
  const args   = ["src/agent.py", "--student", name];
  if (quick) args.push("--quick");

  return new Response(
    new ReadableStream({
      start(controller) {
        const enc  = new TextEncoder();
        const proc = spawn(python, args, {
          cwd: AGENT_DIR,
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
        });
        proc.stdout.on("data", (d: Buffer) => controller.enqueue(enc.encode(d.toString())));
        proc.stderr.on("data", (d: Buffer) => controller.enqueue(enc.encode(d.toString())));
        proc.on("close", (code) => {
          controller.enqueue(enc.encode(`\n__EXIT_CODE__:${code}\n`));
          controller.close();
        });
        proc.on("error", (err) => {
          controller.enqueue(enc.encode(`\nHATA: ${err.message}\n`));
          controller.close();
        });
      },
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } }
  );
}
