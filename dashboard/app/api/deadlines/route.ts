/**
 * GET /api/deadlines → Tüm öğrencilerin yaklaşan başvuru son tarihlerini toplar.
 * Deadline'ı olan, uygun veya şartlı programları döndürür.
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

interface DeadlineItem {
  studentName: string;
  university: string;
  program: string;
  city: string;
  deadlineType: "WiSe" | "SoSe";
  deadlineRaw: string;
  deadlineParsed: string | null; // ISO date string YYYY-MM-DD
  daysLeft: number | null;
  eligibility: string;
  url: string | null;
}

const MONTHS_DE: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  jan: 1, feb: 2, mär: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12,
};

function parseDeadline(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // DD.MM.YYYY
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;

  // DD.MM (no year — assume current or next year)
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (m) {
    const now = new Date();
    const year = now.getFullYear();
    const date = new Date(year, parseInt(m[2]) - 1, parseInt(m[1]));
    if (date < now) date.setFullYear(year + 1);
    return date.toISOString().slice(0, 10);
  }

  // "15. Januar" / "15. März YYYY"
  m = s.match(/^(\d{1,2})\.\s*([A-Za-zä]+)\s*(\d{4})?/i);
  if (m) {
    const day = parseInt(m[1]);
    const mon = MONTHS_DE[m[2].toLowerCase()];
    if (mon) {
      const now = new Date();
      const year = m[3] ? parseInt(m[3]) : now.getFullYear();
      const date = new Date(year, mon - 1, day);
      if (!m[3] && date < now) date.setFullYear(year + 1);
      return date.toISOString().slice(0, 10);
    }
  }

  return null;
}

function daysUntil(isoDate: string): number {
  const target = new Date(isoDate + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

export async function GET() {
  if (!fs.existsSync(STUDENTS_DIR)) return NextResponse.json([]);

  const items: DeadlineItem[] = [];

  const folders = fs.readdirSync(STUDENTS_DIR)
    .filter((f) => fs.statSync(path.join(STUDENTS_DIR, f)).isDirectory());

  for (const studentName of folders) {
    const folder = path.join(STUDENTS_DIR, studentName);
    const files = fs.readdirSync(folder)
      .filter((f) => f.startsWith("arastirma_") && f.endsWith(".json"))
      .sort().reverse();
    if (!files.length) continue;

    try {
      const data = JSON.parse(fs.readFileSync(path.join(folder, files[0]), "utf-8")) as Array<{
        university: string;
        program: string;
        city?: string;
        eligibility: string;
        deadline_wise?: string | null;
        deadline_sose?: string | null;
        url?: string | null;
      }>;

      for (const p of data) {
        if (!["uygun", "sartli"].includes(p.eligibility)) continue;

        for (const [type, raw] of [["WiSe", p.deadline_wise], ["SoSe", p.deadline_sose]] as [string, string | null | undefined][]) {
          if (!raw) continue;
          const parsed = parseDeadline(raw);
          const days = parsed ? daysUntil(parsed) : null;
          // Sadece gelecekteki (< 90 gün) deadline'ları göster
          if (days !== null && days >= -7 && days <= 90) {
            items.push({
              studentName,
              university: p.university,
              program: p.program,
              city: p.city ?? "",
              deadlineType: type as "WiSe" | "SoSe",
              deadlineRaw: raw,
              deadlineParsed: parsed,
              daysLeft: days,
              eligibility: p.eligibility,
              url: p.url ?? null,
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // En yakın deadline önce
  items.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  return NextResponse.json(items);
}
