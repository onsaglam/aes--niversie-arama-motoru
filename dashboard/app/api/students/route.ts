import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

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

function parseResultsJson(folder: string): StudentSummary["stats"] | null {
  try {
    const files = fs.readdirSync(folder).filter((f) => f.startsWith("arastirma_") && f.endsWith(".json"));
    if (!files.length) return null;
    // En son dosyayı al
    const latest = files.sort().reverse()[0];
    const data = JSON.parse(fs.readFileSync(path.join(folder, latest), "utf-8")) as Array<{
      eligibility: string;
    }>;
    return {
      total: data.length,
      uygun: data.filter((p) => p.eligibility === "uygun").length,
      sartli: data.filter((p) => p.eligibility === "sartli").length,
      uygun_degil: data.filter((p) => p.eligibility === "uygun_degil").length,
      veri_yok: data.filter((p) => ["veri_yok", "taranmadi"].includes(p.eligibility)).length,
    };
  } catch {
    return null;
  }
}

function getLastRunDate(folder: string): string | null {
  try {
    const files = fs.readdirSync(folder).filter((f) => f.startsWith("arastirma_") && f.endsWith(".json"));
    if (!files.length) return null;
    const latest = files.sort().reverse()[0];
    // arastirma_20260326_1300.json → "26.03.2026 13:00"
    const m = latest.match(/arastirma_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    if (!fs.existsSync(STUDENTS_DIR)) {
      return NextResponse.json([]);
    }

    const folders = fs
      .readdirSync(STUDENTS_DIR)
      .filter((f) => fs.statSync(path.join(STUDENTS_DIR, f)).isDirectory());

    const students: StudentSummary[] = folders.map((name) => {
      const folder = path.join(STUDENTS_DIR, name);
      let field = "";
      let degreeType = "";
      let startSemester = "";
      try {
        const profilePath = path.join(folder, "profil.json");
        if (fs.existsSync(profilePath)) {
          const p = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
          field = p.desired_field ?? "";
          degreeType = p.degree_type ?? "";
          startSemester = p.start_semester ?? "";
        }
      } catch { /* ignore */ }
      // .running dosyası varsa ve 2 saatten yeni ise ajan çalışıyordur
      const runFile = path.join(folder, ".running");
      let isRunning = false;
      if (fs.existsSync(runFile)) {
        const ageMins = (Date.now() - fs.statSync(runFile).mtimeMs) / 60000;
        isRunning = ageMins < 120;
      }
      return {
        name,
        hasProfile: fs.existsSync(path.join(folder, "profil.docx")) || fs.existsSync(path.join(folder, "profil.json")),
        hasResults: fs.readdirSync(folder).some((f) => f.startsWith("arastirma_")),
        lastRun: getLastRunDate(folder),
        isRunning,
        stats: parseResultsJson(folder),
        field,
        degreeType,
        startSemester,
      };
    });

    // Son araştırma tarihine göre sırala (en yeni üstte), araştırılmayanlar sona
    students.sort((a, b) => {
      if (a.lastRun && b.lastRun) return b.lastRun.localeCompare(a.lastRun);
      if (a.lastRun) return -1;
      if (b.lastRun) return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(students);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json() as { name: string };

    // Ad doğrulama: sadece harf, rakam, boşluk, tire, alt çizgi
    if (!name || !/^[\w\s\-çÇğĞıİöÖşŞüÜ]+$/.test(name) || name.length > 60) {
      return NextResponse.json({ error: "Geçersiz isim" }, { status: 400 });
    }

    // Klasör adı: boşlukları alt çizgiye çevir
    const folderName = name.trim().replace(/\s+/g, "_");
    const folder = path.join(STUDENTS_DIR, folderName);

    if (fs.existsSync(folder)) {
      return NextResponse.json({ error: "Bu isimde öğrenci zaten var" }, { status: 409 });
    }

    fs.mkdirSync(folder, { recursive: true });

    // Boş profil.json oluştur
    const emptyProfile = {
      name: name.trim(),
      nationality: "Türk",
      current_university: "",
      department: "",
      gpa_turkish: "",
      graduation_date: "",
      diploma_status: "",
      german_level: "",
      english_level: "",
      desired_field: "",
      degree_type: "Master",
      program_language: "",
      preferred_cities: "",
      start_semester: "",
      free_tuition_important: true,
      university_type: "",
      accept_nc: true,
      conditional_admission: true,
      advisor_notes: "",
    };
    fs.writeFileSync(path.join(folder, "profil.json"), JSON.stringify(emptyProfile, null, 2), "utf-8");

    return NextResponse.json({ ok: true, folderName });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
