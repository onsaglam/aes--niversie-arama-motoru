import { NextResponse } from "next/server";
import { getLocalDocument } from "@/lib/blob";
import path from "path";

function safeName(n: string): boolean {
  return /^[\w\-çÇğĞıİöÖşŞüÜ][\w\s\-çÇğĞıİöÖşŞüÜ]{0,60}$/.test(n) && !n.includes("..");
}

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });

  const file = new URL(req.url).searchParams.get("file");
  if (!file || file.includes("..") || file.includes("/")) {
    return NextResponse.json({ error: "Geçersiz dosya adı" }, { status: 400 });
  }

  // Vercel'de local dosya sistemi yok; yalnızca local ortamda çalışır
  const bytes = await getLocalDocument(name, file);
  if (!bytes) {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }

  const ext = path.extname(file).toLowerCase();
  const mime =
    ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
    ext === ".xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :
    "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file)}"`,
    },
  });
}
