/**
 * lib/db.ts — Neon Postgres bağlantısı + schema başlatma
 *
 * Kullanım:
 *   import { sql, initSchema } from "@/lib/db";
 *   const rows = await sql`SELECT * FROM programs LIMIT 10`;
 */
import { neon, neonConfig } from "@neondatabase/serverless";

// neon() sadece URL'yi saklar, bağlantıyı sorgu anında kurar.
// Build zamanında DATABASE_URL olmayabilir; placeholder ile yükle,
// gerçek sorgu zamanında ortam değişkeni kontrol edilir.
export const sql = neon(
  process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@placeholder/placeholder"
);

// ─── Schema ──────────────────────────────────────────────────────────────────
// Tüm tablolar CREATE TABLE IF NOT EXISTS ile güvenli şekilde oluşturulur.

export async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS programs (
      id                    TEXT PRIMARY KEY,
      university            TEXT NOT NULL,
      program               TEXT NOT NULL,
      city                  TEXT,
      language              TEXT,
      degree                TEXT,
      deadline_wise         TEXT,
      deadline_sose         TEXT,
      german_requirement    TEXT,
      english_requirement   TEXT,
      nc_value              TEXT,
      min_gpa               REAL,
      uni_assist            INTEGER DEFAULT 0,
      conditional_admission INTEGER DEFAULT 0,
      url                   TEXT,
      source                TEXT,
      confidence            REAL DEFAULT 0.5,
      last_scraped          TEXT,
      created_at            TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      updated_at            TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_prog_lang   ON programs(language)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prog_degree ON programs(degree)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prog_uni    ON programs(university)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prog_url ON programs(url)
    WHERE url IS NOT NULL AND url != ''
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS students (
      name       TEXT PRIMARY KEY,
      profile    JSONB NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      updated_at TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS student_results (
      id           SERIAL PRIMARY KEY,
      student_name TEXT NOT NULL,
      run_at       TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      results      JSONB NOT NULL DEFAULT '[]',
      is_running   INTEGER DEFAULT 0
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_res_student ON student_results(student_name)`;

  await sql`
    CREATE TABLE IF NOT EXISTS student_tracking (
      id           SERIAL PRIMARY KEY,
      student_name TEXT NOT NULL,
      university   TEXT NOT NULL,
      program      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'inceleniyor',
      notes        TEXT DEFAULT '',
      updated_at   TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      UNIQUE(student_name, university, program)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_track_student ON student_tracking(student_name)`;
}

// ─── Yardımcı tipler ──────────────────────────────────────────────────────────
export interface Program {
  id: string;
  university: string;
  program: string;
  city: string | null;
  language: string | null;
  degree: string | null;
  deadline_wise: string | null;
  deadline_sose: string | null;
  german_requirement: string | null;
  english_requirement: string | null;
  nc_value: string | null;
  min_gpa: number | null;
  uni_assist: number;
  conditional_admission: number;
  url: string | null;
  source: string | null;
  confidence: number;
  last_scraped: string;
  created_at: string;
  updated_at: string;
}

export interface StudentProfile {
  name: string;
  nationality?: string;
  current_university?: string;
  department?: string;
  gpa_turkish?: string;
  graduation_date?: string;
  diploma_status?: string;
  german_level?: string;
  english_level?: string;
  desired_field?: string;
  degree_type?: string;
  program_language?: string;
  preferred_cities?: string;
  start_semester?: string;
  free_tuition_important?: boolean;
  university_type?: string;
  accept_nc?: boolean;
  conditional_admission?: boolean;
  advisor_notes?: string;
}
