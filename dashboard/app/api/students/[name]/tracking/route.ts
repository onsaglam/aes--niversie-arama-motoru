/**
 * Başvuru takip sistemi — Neon student_tracking tablosu
 * GET    /api/students/[name]/tracking
 * POST   /api/students/[name]/tracking  → { university, program, status, notes }
 * DELETE /api/students/[name]/tracking  → { university, program }
 */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

type TrackingStatus = "inceleniyor" | "basvurulacak" | "basvuruldu" | "kabul" | "red" | "beklemede";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const rows = await sql`
    SELECT university, program, status, notes, updated_at
    FROM student_tracking
    WHERE student_name = ${name}
    ORDER BY updated_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const { university, program, status, notes = "" } = await req.json() as {
    university: string; program: string; status: TrackingStatus; notes?: string;
  };

  if (!university || !program || !status) {
    return NextResponse.json({ error: "university, program, status zorunlu" }, { status: 400 });
  }

  const now = new Date().toISOString();

  await sql`
    INSERT INTO student_tracking (student_name, university, program, status, notes, updated_at)
    VALUES (${name}, ${university}, ${program}, ${status}, ${notes}, ${now})
    ON CONFLICT (student_name, university, program) DO UPDATE
      SET status     = EXCLUDED.status,
          notes      = EXCLUDED.notes,
          updated_at = EXCLUDED.updated_at
  `;

  return NextResponse.json({ ok: true, entry: { university, program, status, notes, updated_at: now } });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const { university, program } = await req.json() as { university: string; program: string };

  await sql`
    DELETE FROM student_tracking
    WHERE student_name = ${name}
      AND lower(university) = lower(${university})
      AND lower(substring(program, 1, 40)) = lower(substring(${program}, 1, 40))
  `;
  return NextResponse.json({ ok: true });
}
