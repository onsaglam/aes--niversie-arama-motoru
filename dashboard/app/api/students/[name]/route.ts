import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

export interface ProgramResult {
  university: string;
  program: string;
  city: string;
  eligibility: string;
  url: string;
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const folder = path.join(STUDENTS_DIR, name);

  if (!fs.existsSync(folder)) {
    return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });
  }

  // En son sonuç dosyasını bul
  const files = fs
    .readdirSync(folder)
    .filter((f) => f.startsWith("arastirma_") && f.endsWith(".json"))
    .sort()
    .reverse();

  let programs: ProgramResult[] = [];
  let lastRun: string | null = null;

  if (files.length) {
    programs = JSON.parse(fs.readFileSync(path.join(folder, files[0]), "utf-8"));
    const m = files[0].match(/arastirma_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
    if (m) lastRun = `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
  }

  // Rapor dosyaları
  const reports = fs.readdirSync(folder).filter(
    (f) => f.endsWith(".docx") || f.endsWith(".xlsx")
  );

  // Mevcut belgeler
  const documents = {
    profil: fs.existsSync(path.join(folder, "profil.docx")) || fs.existsSync(path.join(folder, "profil.json")),
    transkript: fs.existsSync(path.join(folder, "transkript.pdf")),
    dilBelgesi: fs.existsSync(path.join(folder, "dil_belgesi.pdf")),
    motivasyon: fs.existsSync(path.join(folder, "motivasyon.docx")),
    cv: fs.existsSync(path.join(folder, "cv.pdf")),
  };

  return NextResponse.json({ name, programs, lastRun, reports, documents });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const folder = path.join(STUDENTS_DIR, name);

  if (!fs.existsSync(folder)) {
    return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });
  }

  fs.rmSync(folder, { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
