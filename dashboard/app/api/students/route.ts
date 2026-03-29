import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export interface StudentSummary {
  name: string;
  hasProfile: boolean;
  hasResults: boolean;
  lastRun: string | null;
  isRunning: boolean;
  stats: {
    total: number;
    uygun: number;
    sartli: number;
    uygun_degil: number;
    veri_yok: number;
  } | null;
  field: string;
  degreeType: string;
  startSemester: string;
}

export async function GET() {
  try {
    // Tüm öğrencileri + en son araştırma sonuçlarını çek
    const students = await sql`SELECT name, profile, updated_at FROM students ORDER BY updated_at DESC`;

    // Her öğrencinin en son run'ını çek (tek sorgu)
    type LatestResult = { student_name: string; run_at: string; results: Array<{ eligibility: string }>; is_running: number };
    const latestResults = await sql`
      SELECT DISTINCT ON (student_name)
        student_name, run_at, results, is_running
      FROM student_results
      ORDER BY student_name, id DESC
    ` as LatestResult[];
    const resultMap = new Map(latestResults.map((r) => [r.student_name, r]));

    type StudentRow = { name: string; profile: Record<string, unknown>; updated_at: string };
    const summaries: StudentSummary[] = (students as StudentRow[]).map((s) => {
      const profile = s.profile as Record<string, unknown>;
      const latest = resultMap.get(s.name);
      let stats: StudentSummary["stats"] | null = null;
      let lastRun: string | null = null;

      if (latest) {
        const results = (latest.results as Array<{ eligibility: string }>) ?? [];
        stats = {
          total:       results.length,
          uygun:       results.filter((p) => p.eligibility === "uygun").length,
          sartli:      results.filter((p) => p.eligibility === "sartli").length,
          uygun_degil: results.filter((p) => p.eligibility === "uygun_degil").length,
          veri_yok:    results.filter((p) => ["veri_yok", "taranmadi"].includes(p.eligibility)).length,
        };
        lastRun = latest.run_at ? String(latest.run_at) : null;
      }

      return {
        name:          s.name,
        hasProfile:    !!profile && Object.keys(profile).length > 0,
        hasResults:    !!latest && (latest.results as unknown[]).length > 0,
        lastRun,
        isRunning:     latest?.is_running === 1,
        stats,
        field:         String(profile?.desired_field ?? ""),
        degreeType:    String(profile?.degree_type   ?? ""),
        startSemester: String(profile?.start_semester ?? ""),
      };
    });

    // Son araştırma tarihine göre sırala
    summaries.sort((a, b) => {
      if (a.lastRun && b.lastRun) return b.lastRun.localeCompare(a.lastRun);
      if (a.lastRun) return -1;
      if (b.lastRun) return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(summaries);
  } catch (err) {
    console.error("[students GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json() as { name: string };

    if (!name || !/^[\w\s\-çÇğĞıİöÖşŞüÜ]+$/.test(name) || name.length > 60) {
      return NextResponse.json({ error: "Geçersiz isim" }, { status: 400 });
    }

    // Klasör adı: boşlukları alt çizgiye çevir
    const folderName = name.trim().replace(/\s+/g, "_");

    // Zaten var mı?
    const existing = await sql`SELECT name FROM students WHERE name = ${folderName}`;
    if (existing.length > 0) {
      return NextResponse.json({ error: "Bu isimde öğrenci zaten var" }, { status: 409 });
    }

    const emptyProfile = {
      name:                  name.trim(),
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

    await sql`
      INSERT INTO students (name, profile)
      VALUES (${folderName}, ${JSON.stringify(emptyProfile)})
    `;

    return NextResponse.json({ ok: true, folderName });
  } catch (err) {
    console.error("[students POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
