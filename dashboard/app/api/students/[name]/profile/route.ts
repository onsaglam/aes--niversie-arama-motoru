import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

function safeName(name: string): boolean {
  return /^[\w\-çÇğĞıİöÖşŞüÜ][\w\s\-çÇğĞıİöÖşŞüÜ]{0,60}$/.test(name) && !name.includes("..");
}

function emptyProfile(name: string) {
  return {
    name:                  name.replace(/_/g, " "),
    nationality:           "Türk",
    current_university:    "",
    department:            "",
    gpa_turkish:           "",
    graduation_date:       "",
    diploma_status:        "",
    german_level:          "",
    english_level:         "",
    desired_field:         "",
    degree_type:           "Master",
    program_language:      "",
    preferred_cities:      "",
    start_semester:        "",
    free_tuition_important: true,
    university_type:       "",
    accept_nc:             true,
    conditional_admission: true,
    advisor_notes:         "",
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });

  const rows = await sql`SELECT profile FROM students WHERE name = ${name}`;
  if (rows.length === 0) return NextResponse.json(emptyProfile(name));

  const profile = (rows[0] as { profile: Record<string, unknown> }).profile;
  return NextResponse.json(profile && Object.keys(profile).length > 0 ? profile : emptyProfile(name));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });

  const body = await req.json();

  await sql`
    INSERT INTO students (name, profile, updated_at)
    VALUES (${name}, ${JSON.stringify(body)}, to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    ON CONFLICT (name) DO UPDATE
      SET profile    = EXCLUDED.profile,
          updated_at = EXCLUDED.updated_at
  `;

  return NextResponse.json({ ok: true });
}
