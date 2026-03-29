/**
 * POST   /api/students/[name]/documents  → belge yükle (Vercel Blob / local fallback)
 * GET    /api/students/[name]/documents  → belge listesi
 * DELETE /api/students/[name]/documents?filename=... → belge sil
 */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { uploadDocument, listDocuments, deleteDocument } from "@/lib/blob";

const TYPE_MAP: Record<string, string> = {
  transkript: "transkript.pdf",
  dilBelgesi: "dil_belgesi.pdf",
  cv:         "cv.pdf",
};

const ALLOWED_EXT = [".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png"];
const PROTECTED   = ["profil.json"];

function safeName(name: string): boolean {
  return /^[\w\-çÇğĞıİöÖşŞüÜ][\w\s\-çÇğĞıİöÖşŞüÜ]{0,60}$/.test(name) && !name.includes("..");
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\.çğışöüÇĞİŞÖÜ]/g, "_").replace(/\.{2,}/g, "_");
}

async function studentExists(name: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM students WHERE name = ${name} LIMIT 1`;
  return rows.length > 0;
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });
  if (!(await studentExists(name))) return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });

  const files = await listDocuments(name);
  return NextResponse.json({ files });
}

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });
  if (!(await studentExists(name))) return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "Form verisi okunamadı" }, { status: 400 }); }

  const file = formData.get("file") as File | null;
  const type = (formData.get("type") as string | null) ?? "";

  if (!file || file.size === 0) return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Dosya boyutu 20 MB'yi aşıyor" }, { status: 400 });

  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return NextResponse.json({ error: `İzin verilmeyen uzantı: ${ext}` }, { status: 400 });

  let filename: string;
  if (TYPE_MAP[type]) filename = TYPE_MAP[type];
  else if (type === "diger") filename = safeFilename(file.name);
  else return NextResponse.json({ error: "Geçersiz belge türü" }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const result = await uploadDocument(name, filename, bytes, file.type || "application/octet-stream");

  return NextResponse.json({ ok: true, filename: result.filename, size: file.size });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });

  const url = new URL(req.url);
  const filename = url.searchParams.get("filename");
  if (!filename) return NextResponse.json({ error: "Dosya adı belirtilmedi" }, { status: 400 });

  const safeFn = safeFilename(filename);
  if (safeFn !== filename || filename.includes("/") || filename.includes("..")) {
    return NextResponse.json({ error: "Geçersiz dosya adı" }, { status: 400 });
  }
  if (PROTECTED.includes(filename)) return NextResponse.json({ error: "Bu dosya silinemez" }, { status: 403 });

  await deleteDocument(name, filename);
  return NextResponse.json({ ok: true });
}
