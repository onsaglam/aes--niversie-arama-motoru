/**
 * POST /api/notify          → deadline digest emaili gönder
 * POST /api/notify?test=1   → test emaili gönder (bağlantı kontrolü)
 * GET  /api/notify          → email konfigürasyonu durumunu döndür
 *
 * Gerekli .env değişkenleri:
 *   NOTIFY_EMAIL_HOST    smtp.gmail.com
 *   NOTIFY_EMAIL_PORT    587
 *   NOTIFY_EMAIL_USER    kullanici@gmail.com
 *   NOTIFY_EMAIL_PASS    uygulama-sifresi
 *   NOTIFY_EMAIL_TO      alici@example.com  (boşlukla birden fazla)
 */
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

// ─── Konfigürasyon ────────────────────────────────────────────────────────────

function getTransporter() {
  const host = process.env.NOTIFY_EMAIL_HOST;
  const port = parseInt(process.env.NOTIFY_EMAIL_PORT ?? "587");
  const user = process.env.NOTIFY_EMAIL_USER;
  const pass = process.env.NOTIFY_EMAIL_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

function getRecipients(): string[] {
  const raw = process.env.NOTIFY_EMAIL_TO ?? "";
  return raw.split(/[\s,]+/).filter(Boolean);
}

function isConfigured(): boolean {
  return !!(
    process.env.NOTIFY_EMAIL_HOST &&
    process.env.NOTIFY_EMAIL_USER &&
    process.env.NOTIFY_EMAIL_PASS &&
    process.env.NOTIFY_EMAIL_TO
  );
}

// ─── Deadline verisi ──────────────────────────────────────────────────────────

interface DeadlineItem {
  studentName: string;
  university: string;
  program: string;
  deadlineType: string;
  deadlineRaw: string;
  daysLeft: number;
  eligibility: string;
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
    const now = new Date();
    const year = now.getFullYear();
    const date = new Date(year, parseInt(m[2]) - 1, parseInt(m[1]));
    if (date < now) date.setFullYear(year + 1);
    return date.toISOString().slice(0, 10);
  }
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

function collectDeadlines(maxDays = 30): DeadlineItem[] {
  if (!fs.existsSync(STUDENTS_DIR)) return [];
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
        university: string; program: string; eligibility: string;
        deadline_wise?: string | null; deadline_sose?: string | null;
      }>;
      for (const p of data) {
        if (!["uygun", "sartli"].includes(p.eligibility)) continue;
        for (const [type, raw] of [["WiSe", p.deadline_wise], ["SoSe", p.deadline_sose]] as [string, string | null | undefined][]) {
          if (!raw) continue;
          const parsed = parseDeadline(raw);
          const days = parsed ? daysUntil(parsed) : null;
          if (days !== null && days >= 0 && days <= maxDays) {
            items.push({ studentName, university: p.university, program: p.program, deadlineType: type, deadlineRaw: raw, daysLeft: days, eligibility: p.eligibility });
          }
        }
      }
    } catch { /* ignore */ }
  }

  return items.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ─── HTML email şablonu ───────────────────────────────────────────────────────

function buildHtml(deadlines: DeadlineItem[], isTest = false): string {
  const rows = deadlines.map((d) => {
    const urgency = d.daysLeft <= 7 ? "#dc2626" : d.daysLeft <= 14 ? "#ea580c" : "#d97706";
    const eligBadge = d.eligibility === "uygun"
      ? `<span style="color:#16a34a;font-weight:600">✅ Uygun</span>`
      : `<span style="color:#d97706;font-weight:600">⚠️ Şartlı</span>`;
    return `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:10px 12px;font-weight:700;color:${urgency}">
          ${d.daysLeft === 0 ? "Bugün!" : `${d.daysLeft} gün`}
        </td>
        <td style="padding:10px 12px;color:#1e293b">${d.studentName.replace(/_/g, " ")}</td>
        <td style="padding:10px 12px;color:#1e293b">${d.university}</td>
        <td style="padding:10px 12px;color:#475569">${d.program}</td>
        <td style="padding:10px 12px;color:#64748b">${d.deadlineType} · ${d.deadlineRaw}</td>
        <td style="padding:10px 12px">${eligBadge}</td>
      </tr>`;
  }).join("");

  const today = new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:780px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <!-- Header -->
    <div style="background:#1e3a5f;padding:24px 32px;display:flex;align-items:center;gap:16px">
      <div style="background:#fff;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#1e3a5f;font-size:13px">AES</div>
      <div>
        <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700">Yaklaşan Başvuru Deadline&apos;ları</h1>
        <p style="margin:4px 0 0;color:#93c5fd;font-size:12px">${today}${isTest ? " · TEST EMAİLİ" : ""}</p>
      </div>
    </div>
    <!-- Body -->
    <div style="padding:24px 32px">
      ${deadlines.length === 0
        ? `<p style="color:#64748b;text-align:center;padding:32px 0">Şu anda yaklaşan deadline bulunmuyor.</p>`
        : `
      <p style="color:#475569;font-size:14px;margin:0 0 20px">
        Önümüzdeki <strong>30 gün</strong> içinde <strong>${deadlines.length} başvuru deadline'ı</strong> var.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
            <th style="text-align:left;padding:10px 12px;color:#64748b;font-weight:600">Kalan</th>
            <th style="text-align:left;padding:10px 12px;color:#64748b;font-weight:600">Öğrenci</th>
            <th style="text-align:left;padding:10px 12px;color:#64748b;font-weight:600">Üniversite</th>
            <th style="text-align:left;padding:10px 12px;color:#64748b;font-weight:600">Program</th>
            <th style="text-align:left;padding:10px 12px;color:#64748b;font-weight:600">Dönem</th>
            <th style="text-align:left;padding:10px 12px;color:#64748b;font-weight:600">Durum</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`}
    </div>
    <!-- Footer -->
    <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
      <p style="margin:0;font-size:11px;color:#94a3b8">
        AES — Almanya Eğitim Serüveni · almanyaegitimseruveni.com · Bremen, Germany
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── API handlers ─────────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    configured: isConfigured(),
    host:       process.env.NOTIFY_EMAIL_HOST    ? "✓ set" : "missing",
    user:       process.env.NOTIFY_EMAIL_USER    ? "✓ set" : "missing",
    pass:       process.env.NOTIFY_EMAIL_PASS    ? "✓ set" : "missing",
    to:         process.env.NOTIFY_EMAIL_TO      ? "✓ set" : "missing",
    recipients: getRecipients(),
  });
}

export async function POST(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Email konfigürasyonu eksik. .env dosyasına NOTIFY_EMAIL_* değişkenlerini ekleyin." },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const isTest = url.searchParams.get("test") === "1";

  const transporter = getTransporter();
  if (!transporter) {
    return NextResponse.json({ error: "SMTP bağlantısı kurulamadı" }, { status: 500 });
  }

  const deadlines = isTest ? [] : collectDeadlines(30);
  const html      = buildHtml(deadlines, isTest);
  const subject   = isTest
    ? "AES · Test Emaili — Bağlantı Başarılı"
    : `AES · ${deadlines.length} Yaklaşan Deadline — ${new Date().toLocaleDateString("tr-TR")}`;

  try {
    const info = await transporter.sendMail({
      from:    `"AES Araştırma Paneli" <${process.env.NOTIFY_EMAIL_USER}>`,
      to:      getRecipients().join(", "),
      subject,
      html,
    });

    return NextResponse.json({
      success: true,
      messageId: info.messageId,
      recipients: getRecipients(),
      deadlineCount: deadlines.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
