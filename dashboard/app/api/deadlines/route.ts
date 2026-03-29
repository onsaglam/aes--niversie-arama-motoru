/**
 * GET /api/deadlines → Tüm öğrencilerin yaklaşan başvuru son tarihlerini toplar (Neon)
 */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

interface DeadlineItem {
  studentName:    string;
  university:     string;
  program:        string;
  city:           string;
  deadlineType:   "WiSe" | "SoSe";
  deadlineRaw:    string;
  deadlineParsed: string | null;
  daysLeft:       number | null;
  eligibility:    string;
  url:            string | null;
}

const MONTHS_DE: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  jan: 1, feb: 2, mär: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12,
};

function parseDeadline(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();

  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  m = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (m) {
    const now = new Date(); const year = now.getFullYear();
    const date = new Date(year, parseInt(m[2]) - 1, parseInt(m[1]));
    if (date < now) date.setFullYear(year + 1);
    return date.toISOString().slice(0, 10);
  }

  m = s.match(/^(\d{1,2})\.\s*([A-Za-zä]+)\s*(\d{4})?/i);
  if (m) {
    const day = parseInt(m[1]);
    const mon = MONTHS_DE[m[2].toLowerCase()];
    if (mon) {
      const now = new Date(); const year = m[3] ? parseInt(m[3]) : now.getFullYear();
      const date = new Date(year, mon - 1, day);
      if (!m[3] && date < now) date.setFullYear(year + 1);
      return date.toISOString().slice(0, 10);
    }
  }
  return null;
}

function daysUntil(iso: string): number {
  const target = new Date(iso + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

export async function GET() {
  try {
    // En son araştırma sonuçlarını tüm öğrenciler için çek
    const rows = await sql`
      SELECT DISTINCT ON (student_name) student_name, results
      FROM student_results
      ORDER BY student_name, id DESC
    ` as Array<{ student_name: string; results: Array<Record<string, unknown>> }>;

    const items: DeadlineItem[] = [];

    for (const row of rows) {
      const results = row.results ?? [];
      for (const p of results) {
        if (!["uygun", "sartli"].includes(String(p.eligibility ?? ""))) continue;

        for (const [type, rawVal] of [["WiSe", p.deadline_wise], ["SoSe", p.deadline_sose]] as [string, unknown][]) {
          if (!rawVal) continue;
          const raw    = String(rawVal);
          const parsed = parseDeadline(raw);
          const days   = parsed ? daysUntil(parsed) : null;
          if (days !== null && days >= -7 && days <= 90) {
            items.push({
              studentName:    row.student_name,
              university:     String(p.university ?? ""),
              program:        String(p.program ?? ""),
              city:           String(p.city ?? ""),
              deadlineType:   type as "WiSe" | "SoSe",
              deadlineRaw:    raw,
              deadlineParsed: parsed,
              daysLeft:       days,
              eligibility:    String(p.eligibility ?? ""),
              url:            p.url ? String(p.url) : null,
            });
          }
        }
      }
    }

    items.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
    return NextResponse.json(items);
  } catch (err) {
    console.error("[deadlines GET]", err);
    return NextResponse.json([]);
  }
}
