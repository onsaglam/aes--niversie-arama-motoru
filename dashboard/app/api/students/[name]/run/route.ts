import { spawn } from "child_process";
import path from "path";

const AGENT_DIR   = path.resolve(process.cwd(), "../aes-agent");
const VENV_PYTHON = path.join(AGENT_DIR, "venv/bin/python");

export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  const quick = new URL(_req.url).searchParams.get("quick") === "1";

  const args = ["src/agent.py", "--student", name];
  if (quick) args.push("--quick");

  return new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const proc = spawn(VENV_PYTHON, args, {
          cwd: AGENT_DIR,
          env: { ...process.env },
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
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}
