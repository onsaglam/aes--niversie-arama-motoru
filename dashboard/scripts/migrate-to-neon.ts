/**
 * migrate-to-neon.ts — Yerel SQLite + JSON verilerini Neon Postgres'e taşır
 *
 * Çalıştırma:
 *   cd dashboard
 *   DATABASE_URL="postgresql://..." npm run migrate
 *
 * Taşınan veriler:
 *   1. programs.db (SQLite)              → Neon programs tablosu
 *   2. ogrenciler/[ad]/profil.json       → Neon students tablosu
 *   3. ogrenciler/[ad]/arastirma_*.json  → Neon student_results tablosu
 */

import { sql, initSchema } from "../lib/db";
import * as fs from "fs";
import * as path from "path";

// better-sqlite3 sadece migration zamanında kullanılır — npm install -D better-sqlite3 @types/better-sqlite3
let Database: any;
try {
  Database = require("better-sqlite3");
} catch {
  console.error(
    "better-sqlite3 bulunamadı. Migration için yükleyin:\n  npm install -D better-sqlite3 @types/better-sqlite3"
  );
  process.exit(1);
}

const AGENT_DIR = path.resolve(__dirname, "../../aes-agent");
const DB_PATH   = path.join(AGENT_DIR, "programs.db");
const STUDENTS  = path.join(AGENT_DIR, "ogrenciler");

async function migratePrograms() {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`programs.db bulunamadı (${DB_PATH}) — programlar atlandı`);
    return 0;
  }

  const db   = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare("SELECT * FROM programs").all() as Record<string, unknown>[];
  db.close();

  if (rows.length === 0) {
    console.log("programs.db boş — atlandı");
    return 0;
  }

  console.log(`programs.db'den ${rows.length} program okundu, Neon'a yazılıyor...`);
  let inserted = 0;

  for (const row of rows) {
    try {
      await sql`
        INSERT INTO programs
          (id, university, program, city, language, degree,
           deadline_wise, deadline_sose,
           german_requirement, english_requirement,
           nc_value, min_gpa, uni_assist, conditional_admission,
           url, source, confidence, last_scraped, updated_at)
        VALUES
          (${row.id as string},
           ${row.university as string},
           ${row.program as string},
           ${row.city as string | null},
           ${row.language as string | null},
           ${row.degree as string | null},
           ${row.deadline_wise as string | null},
           ${row.deadline_sose as string | null},
           ${row.german_requirement as string | null},
           ${row.english_requirement as string | null},
           ${row.nc_value as string | null},
           ${row.min_gpa as number | null},
           ${row.uni_assist as number ?? 0},
           ${row.conditional_admission as number ?? 0},
           ${row.url as string | null},
           ${row.source as string | null},
           ${row.confidence as number ?? 0.5},
           ${row.last_scraped as string},
           ${row.updated_at as string})
        ON CONFLICT(id) DO UPDATE SET
          university            = EXCLUDED.university,
          program               = EXCLUDED.program,
          city                  = EXCLUDED.city,
          language              = EXCLUDED.language,
          degree                = EXCLUDED.degree,
          deadline_wise         = EXCLUDED.deadline_wise,
          deadline_sose         = EXCLUDED.deadline_sose,
          german_requirement    = EXCLUDED.german_requirement,
          english_requirement   = EXCLUDED.english_requirement,
          nc_value              = EXCLUDED.nc_value,
          min_gpa               = EXCLUDED.min_gpa,
          uni_assist            = EXCLUDED.uni_assist,
          conditional_admission = EXCLUDED.conditional_admission,
          url                   = EXCLUDED.url,
          source                = EXCLUDED.source,
          confidence            = EXCLUDED.confidence,
          last_scraped          = EXCLUDED.last_scraped,
          updated_at            = EXCLUDED.updated_at
      `;
      inserted++;
    } catch (err) {
      console.error(`  ✗ Program hatası (${row.university} — ${row.program}):`, err);
    }
  }

  console.log(`  ✅ ${inserted}/${rows.length} program Neon'a yazıldı`);
  return inserted;
}

async function migrateStudents() {
  if (!fs.existsSync(STUDENTS)) {
    console.log(`ogrenciler/ klasörü bulunamadı — öğrenciler atlandı`);
    return 0;
  }

  const folders = fs
    .readdirSync(STUDENTS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (folders.length === 0) {
    console.log("Hiç öğrenci klasörü yok — atlandı");
    return 0;
  }

  console.log(`${folders.length} öğrenci bulundu, Neon'a yazılıyor...`);
  let inserted = 0;

  for (const folder of folders) {
    const profilePath = path.join(STUDENTS, folder, "profil.json");
    if (!fs.existsSync(profilePath)) {
      console.log(`  ⚠  ${folder}: profil.json yok — atlandı`);
      continue;
    }

    let profile: Record<string, unknown>;
    try {
      profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    } catch (err) {
      console.error(`  ✗ ${folder} profil.json parse hatası:`, err);
      continue;
    }

    const studentName = folder;
    const now = new Date().toISOString();

    try {
      await sql`
        INSERT INTO students (name, profile, updated_at)
        VALUES (${studentName}, ${JSON.stringify(profile)}::jsonb, ${now})
        ON CONFLICT(name) DO UPDATE SET
          profile    = EXCLUDED.profile,
          updated_at = EXCLUDED.updated_at
      `;
      inserted++;
    } catch (err) {
      console.error(`  ✗ ${folder} students insert hatası:`, err);
      continue;
    }

    // En yeni arastirma_*.json dosyasını bul
    const resultFiles = fs
      .readdirSync(path.join(STUDENTS, folder))
      .filter((f) => f.startsWith("arastirma_") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (resultFiles.length === 0) continue;

    const latestFile = path.join(STUDENTS, folder, resultFiles[0]);
    let results: unknown[];
    try {
      results = JSON.parse(fs.readFileSync(latestFile, "utf-8"));
    } catch (err) {
      console.error(`  ✗ ${folder} araştırma JSON parse hatası:`, err);
      continue;
    }

    // Dosya adından tarih çek: arastirma_YYYYMMDD_HHMM.json
    const dateMatch = resultFiles[0].match(/arastirma_(\d{8})_(\d{4})/);
    let runAt = now;
    if (dateMatch) {
      const d = dateMatch[1];
      const t = dateMatch[2];
      runAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`;
    }

    try {
      await sql`
        INSERT INTO student_results (student_name, run_at, results, is_running)
        VALUES (${studentName}, ${runAt}, ${JSON.stringify(results)}::jsonb, 0)
      `;
    } catch (err) {
      console.error(`  ✗ ${folder} student_results insert hatası:`, err);
    }
  }

  console.log(`  ✅ ${inserted}/${folders.length} öğrenci Neon'a yazıldı`);
  return inserted;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL ortam değişkeni eksik!");
    console.error("Kullanım: DATABASE_URL=\"postgresql://...\" npm run migrate");
    process.exit(1);
  }

  console.log("🚀 Neon migration başlıyor...\n");

  console.log("📐 Schema oluşturuluyor...");
  await initSchema();
  console.log("  ✅ Tablolar hazır\n");

  console.log("📦 Programs taşınıyor...");
  await migratePrograms();

  console.log("\n👤 Öğrenciler taşınıyor...");
  await migrateStudents();

  console.log("\n✅ Migration tamamlandı!");
}

main().catch((err) => {
  console.error("Migration hatası:", err);
  process.exit(1);
});
