import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(__dirname, "../../../../../../../aes-agent/ogrenciler");

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = new URL(req.url).searchParams.get("file");

  if (!file || file.includes("..")) {
    return NextResponse.json({ error: "Geçersiz dosya adı" }, { status: 400 });
  }

  const filePath = path.join(STUDENTS_DIR, name, file);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }

  const ext = path.extname(file).toLowerCase();
  const mime =
    ext === ".docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : ext === ".xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/octet-stream";

  const bytes = fs.readFileSync(filePath);
  return new Response(bytes, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file)}"`,
    },
  });
}
