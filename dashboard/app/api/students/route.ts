import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

export interface StudentSummary {
  name: string;
  hasProfile: boolean;
  hasResults: boolean;
  lastRun: string | null;
  stats: {
    total: number;
    uygun: number;
    sartli: number;
    uygun_degil: number;
    veri_yok: number;
  } | null;
  field: string;
  degreeType: string;
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
      return {
        name,
        hasProfile: fs.existsSync(path.join(folder, "profil.docx")),
        hasResults: fs.readdirSync(folder).some((f) => f.startsWith("arastirma_")),
        lastRun: getLastRunDate(folder),
        stats: parseResultsJson(folder),
        field: "",
        degreeType: "",
      };
    });

    return NextResponse.json(students);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
