/**
 * Başvuru takip sistemi — öğrenci başına program durumu izleme
 * GET  /api/students/[name]/tracking       → tracking.json döndür
 * POST /api/students/[name]/tracking       → { university, program, status } → güncelle
 * DELETE /api/students/[name]/tracking     → { university, program } → kaydı sil
 *
 * Durumlar: "inceleniyor" | "basvurulacak" | "basvuruldu" | "kabul" | "red" | "beklemede"
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

type TrackingStatus = "inceleniyor" | "basvurulacak" | "basvuruldu" | "kabul" | "red" | "beklemede";

interface TrackingEntry {
  university: string;
  program: string;
  status: TrackingStatus;
  notes: string;
  updated_at: string;
}

function trackingPath(name: string): string {
  return path.join(STUDENTS_DIR, name, "tracking.json");
}

function readTracking(name: string): TrackingEntry[] {
  const p = trackingPath(name);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as TrackingEntry[];
  } catch {
    return [];
  }
}

function writeTracking(name: string, entries: TrackingEntry[]) {
  fs.writeFileSync(trackingPath(name), JSON.stringify(entries, null, 2), "utf-8");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const folder = path.join(STUDENTS_DIR, name);
  if (!fs.existsSync(folder)) {
    return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });
  }
  return NextResponse.json(readTracking(name));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const folder = path.join(STUDENTS_DIR, name);
  if (!fs.existsSync(folder)) {
    return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });
  }

  const { university, program, status, notes = "" } = await req.json() as {
    university: string;
    program: string;
    status: TrackingStatus;
    notes?: string;
  };

  if (!university || !program || !status) {
    return NextResponse.json({ error: "university, program, status zorunlu" }, { status: 400 });
  }

  const entries = readTracking(name);
  const key = (u: string, p: string) => `${u.toLowerCase()}::${p.toLowerCase().slice(0, 40)}`;
  const idx = entries.findIndex((e) => key(e.university, e.program) === key(university, program));

  const entry: TrackingEntry = {
    university,
    program,
    status,
    notes,
    updated_at: new Date().toISOString(),
  };

  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  writeTracking(name, entries);
  return NextResponse.json({ ok: true, entry });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const { university, program } = await req.json() as { university: string; program: string };

  const entries = readTracking(name);
  const key = (u: string, p: string) => `${u.toLowerCase()}::${p.toLowerCase().slice(0, 40)}`;
  const filtered = entries.filter((e) => key(e.university, e.program) !== key(university, program));
  writeTracking(name, filtered);
  return NextResponse.json({ ok: true });
}
