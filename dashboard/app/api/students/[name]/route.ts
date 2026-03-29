import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { listDocuments } from "@/lib/blob";

function safeName(name: string): boolean {
  return /^[\w\-çÇğĞıİöÖşŞüÜ][\w\s\-çÇğĞıİöÖşŞüÜ]{0,60}$/.test(name) && !name.includes("..");
}

export interface ProgramResult {
  university: string;
  program: string;
  city: string;
  eligibility: string;
  url: string;
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });

  // Öğrenci var mı?
  const studentRows = await sql`SELECT name FROM students WHERE name = ${name}`;
  if (studentRows.length === 0) {
    return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });
  }

  // En son araştırma sonuçları
  type ResultRow = { run_at: string; results: ProgramResult[]; is_running: number };
  const latestRows = await sql`
    SELECT run_at, results, is_running
    FROM student_results
    WHERE student_name = ${name}
    ORDER BY id DESC
    LIMIT 1
  ` as ResultRow[];

  const latest = latestRows[0] ?? null;
  const programs: ProgramResult[] = latest?.results ?? [];
  const lastRun: string | null = latest?.run_at ?? null;
  const isRunning = latest?.is_running === 1;

  // Belgeler — Blob veya local fallback
  const docs = await listDocuments(name);
  const docNames = new Set(docs.map((d) => d.filename));
  const documents = {
    profil:     docNames.has("profil.docx") || docNames.has("profil.json"),
    transkript: docNames.has("transkript.pdf"),
    dilBelgesi: docNames.has("dil_belgesi.pdf"),
    motivasyon: docNames.has("motivasyon.docx"),
    cv:         docNames.has("cv.pdf"),
  };

  // Rapor dosyaları (docx / xlsx)
  const reports = docs
    .filter((d) => d.filename.endsWith(".docx") || d.filename.endsWith(".xlsx"))
    .map((d) => d.filename);

  return NextResponse.json({ name, programs, lastRun, reports, documents, isRunning });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });

  const existing = await sql`SELECT name FROM students WHERE name = ${name}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });
  }

  // Cascade: student_results ve student_tracking da silinir (FK yoksa manuel sil)
  await sql`DELETE FROM student_tracking WHERE student_name = ${name}`;
  await sql`DELETE FROM student_results  WHERE student_name = ${name}`;
  await sql`DELETE FROM students          WHERE name = ${name}`;

  return NextResponse.json({ ok: true });
}
