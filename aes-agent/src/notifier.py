"""
notifier.py — AES Email Bildirimleri (Gmail SMTP)

Tetikleyiciler:
  1. Analiz tamamlandı  → rapor dosyalarıyla birlikte email gönder
  2. Deadline yaklaşıyor → günlük kontrol scripti tarafından çağrılır

.env gereksinimleri:
  SMTP_USER      = gonderici@gmail.com
  SMTP_PASSWORD  = xxxx xxxx xxxx xxxx   (Gmail App Password)
  NOTIFY_EMAIL   = danismanlik@almanyaegitimseruveni.com
  SMTP_HOST      = smtp.gmail.com        (opsiyonel, default: smtp.gmail.com)
  SMTP_PORT      = 587                   (opsiyonel, default: 587)
"""
import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from datetime import date, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

SMTP_HOST    = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT    = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER    = os.getenv("SMTP_USER", "")
SMTP_PASS    = os.getenv("SMTP_PASSWORD", "")
NOTIFY_EMAIL = os.getenv("NOTIFY_EMAIL", "")


def _smtp_ok() -> bool:
    return bool(SMTP_USER and SMTP_PASS and NOTIFY_EMAIL)


def _connect():
    server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15)
    server.ehlo()
    server.starttls()
    server.login(SMTP_USER, SMTP_PASS)
    return server


def _build_msg(to: str, subject: str, html: str, attachments: list[Path] = None) -> MIMEMultipart:
    msg = MIMEMultipart("mixed")
    msg["From"]    = f"AES Araştırma Ajanı <{SMTP_USER}>"
    msg["To"]      = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html, "html", "utf-8"))
    for fpath in (attachments or []):
        if not fpath.exists():
            continue
        with open(fpath, "rb") as f:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{fpath.name}"')
        msg.attach(part)
    return msg


def _send(msg: MIMEMultipart) -> bool:
    try:
        server = _connect()
        server.sendmail(SMTP_USER, msg["To"], msg.as_string())
        server.quit()
        logger.info(f"Email gönderildi → {msg['To']} | {msg['Subject']}")
        return True
    except Exception as e:
        logger.error(f"Email gönderilemedi: {e}")
        return False


# ─── 1. Analiz Tamamlandı ─────────────────────────────────────────────────────

def send_completion_email(
    student_name: str,
    programs_summary: str,
    report_files: list[Path],
    eligible_count: int = 0,
    conditional_count: int = 0,
) -> bool:
    """Analiz tamamlandığında rapor dosyalarıyla birlikte email gönder."""
    if not _smtp_ok():
        logger.warning("Email ayarları eksik (.env: SMTP_USER, SMTP_PASSWORD, NOTIFY_EMAIL)")
        return False

    status_color = "#16a34a" if eligible_count > 0 else "#d97706"
    html = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:640px;margin:0 auto;">
      <div style="background:#1e3a5f;color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:20px;">AES Üniversite Araştırma Ajanı</h2>
        <p style="margin:6px 0 0;opacity:0.75;font-size:13px;">Analiz Tamamlandı — {date.today().strftime('%d.%m.%Y')}</p>
      </div>
      <div style="padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;background:#fff;">
        <h3 style="margin:0 0 12px;color:#1e3a5f;">{student_name}</h3>
        <div style="display:flex;gap:12px;margin-bottom:16px;">
          <div style="background:{status_color};color:white;padding:10px 16px;border-radius:6px;font-size:14px;">
            <strong>{eligible_count}</strong> Uygun Program
          </div>
          <div style="background:#d97706;color:white;padding:10px 16px;border-radius:6px;font-size:14px;">
            <strong>{conditional_count}</strong> Şartlı Uygun
          </div>
        </div>
        <pre style="background:#f8fafc;padding:14px;border-radius:6px;font-size:12px;
                    white-space:pre-wrap;border:1px solid #e2e8f0;line-height:1.5;">{programs_summary}</pre>
        <p style="margin:16px 0 0;color:#64748b;font-size:12px;border-top:1px solid #f1f5f9;padding-top:12px;">
          Detaylı rapor ve Excel listesi ekte yer almaktadır.<br>
          <strong>AES — Almanya Eğitim Serüveni</strong> · Bremen
        </p>
      </div>
    </body></html>
    """

    msg = _build_msg(
        to          = NOTIFY_EMAIL,
        subject     = f"[AES] {student_name} — Analiz Tamamlandı ({eligible_count} uygun program)",
        html        = html,
        attachments = report_files,
    )
    return _send(msg)


# ─── 2. Deadline Hatırlatma ────────────────────────────────────────────────────

_DEADLINE_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "januar": 1, "februar": 2, "märz": 3, "april": 4,
    "mai": 5, "juni": 6, "juli": 7, "august": 8,
    "september": 9, "oktober": 10, "november": 11, "dezember": 12,
}


def _parse_deadline_date(raw: str) -> Optional[date]:
    """'15 July', '01. März', '15.07.2026' vb. → date objesine çevir."""
    import re
    if not raw:
        return None
    raw = raw.strip()
    today = date.today()

    # DD.MM.YYYY
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", raw)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass

    # DD. MonthName (YYYY)
    m = re.match(r"(\d{1,2})\.?\s+([A-Za-zä]+)(?:\s+(\d{4}))?", raw)
    if m:
        mo = _DEADLINE_MONTHS.get(m.group(2).lower())
        if mo:
            yr = int(m.group(3)) if m.group(3) else today.year
            try:
                d = date(yr, mo, int(m.group(1)))
                if not m.group(3) and d < today:
                    d = date(yr + 1, mo, int(m.group(1)))
                return d
            except ValueError:
                pass

    # DD.MM
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.?$", raw.strip())
    if m:
        try:
            d = date(today.year, int(m.group(2)), int(m.group(1)))
            if d < today:
                d = date(today.year + 1, int(m.group(2)), int(m.group(1)))
            return d
        except ValueError:
            pass

    return None


def check_and_send_deadline_reminders(
    db,
    thresholds: list[int] = [30, 14, 7, 1],
) -> int:
    """
    DB'deki tüm programların deadlinelarını kontrol et.
    threshold gün kaldıysa hatırlatma maili gönder.
    Döndürür: gönderilen email sayısı
    """
    if not _smtp_ok():
        logger.warning("Email ayarları eksik — deadline hatırlatmaları gönderilemez")
        return 0

    today     = date.today()
    all_progs = db.get_all(limit=2000)
    urgent: list[dict] = []

    for row in all_progs:
        for label, raw in [("WiSe", row.get("deadline_wise")), ("SoSe", row.get("deadline_sose"))]:
            if not raw:
                continue
            d = _parse_deadline_date(raw)
            if not d:
                continue
            delta = (d - today).days
            if 0 <= delta <= max(thresholds):
                # En yakın eşiği bul
                threshold_hit = next((t for t in sorted(thresholds) if delta <= t), None)
                if threshold_hit is not None:
                    urgent.append({
                        "university":  row["university"],
                        "program":     row["program"],
                        "city":        row.get("city") or "—",
                        "semester":    label,
                        "deadline":    raw,
                        "days_left":   delta,
                        "threshold":   threshold_hit,
                        "url":         row.get("url") or "",
                    })

    if not urgent:
        logger.info("Yaklaşan deadline yok — email gönderilmedi")
        return 0

    # Threshold gruplarına göre email gönder
    sent = 0
    for threshold in thresholds:
        group = [u for u in urgent if u["threshold"] == threshold]
        if not group:
            continue
        sent += _send_deadline_group(group, threshold, today)

    return sent


def _send_deadline_group(items: list[dict], days: int, today: date) -> int:
    if not items:
        return 0

    urgency_emoji = "(!)" if days <= 7 else "(!!)" if days <= 14 else "(i)"
    urgency_text  = f"{days} gün kaldı" if days > 1 else "BUGÜN son gün!"

    rows_html = ""
    for item in sorted(items, key=lambda x: x["days_left"]):
        color = "#dc2626" if item["days_left"] <= 7 else "#d97706" if item["days_left"] <= 14 else "#1e3a5f"
        link  = f'<a href="{item["url"]}" style="color:{color}">Başvur</a>' if item["url"] else "—"
        rows_html += f"""
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 12px;font-weight:500;">{item['university']}</td>
          <td style="padding:8px 12px;color:#475569;">{item['program'][:50]}</td>
          <td style="padding:8px 12px;color:#475569;">{item['city']}</td>
          <td style="padding:8px 12px;font-weight:600;color:{color};">
            {item['deadline']} ({item['days_left']} gün)
          </td>
          <td style="padding:8px 12px;">{link}</td>
        </tr>"""

    html = f"""
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:800px;margin:0 auto;">
      <div style="background:#1e3a5f;color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">AES Deadline Hatırlatma</h2>
        <p style="margin:6px 0 0;opacity:0.75;font-size:13px;">
          {len(items)} program için son başvuru tarihi yaklaşıyor — {today.strftime('%d.%m.%Y')}
        </p>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">
        <div style="background:#fef3c7;padding:12px 16px;font-size:14px;color:#92400e;">
          Aşağıdaki programlar için son başvuru tarihine <strong>{urgency_text}</strong>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
              <th style="padding:10px 12px;text-align:left;">Üniversite</th>
              <th style="padding:10px 12px;text-align:left;">Program</th>
              <th style="padding:10px 12px;text-align:left;">Şehir</th>
              <th style="padding:10px 12px;text-align:left;">Deadline</th>
              <th style="padding:10px 12px;text-align:left;">Başvuru</th>
            </tr>
          </thead>
          <tbody>{rows_html}</tbody>
        </table>
        <p style="margin:0;padding:12px 16px;color:#64748b;font-size:12px;border-top:1px solid #f1f5f9;">
          AES — Almanya Eğitim Serüveni · Bremen · almanyaegitimseruveni.com
        </p>
      </div>
    </body></html>
    """

    msg = _build_msg(
        to      = NOTIFY_EMAIL,
        subject = f"[AES] Deadline Hatırlatma — {len(items)} program için {urgency_text} ({today.strftime('%d.%m')})",
        html    = html,
    )
    return 1 if _send(msg) else 0


# ─── Test ─────────────────────────────────────────────────────────────────────

def test_email() -> bool:
    """Bağlantı testi — ayarlar doğru mu kontrol eder."""
    if not _smtp_ok():
        print("HATA: .env'de SMTP_USER, SMTP_PASSWORD veya NOTIFY_EMAIL eksik")
        return False
    html = """
    <html><body style="font-family:Arial,sans-serif;padding:20px;">
      <h2>AES Email Sistemi Çalışıyor</h2>
      <p>Bu test maili başarıyla gönderildi. Email bildirimleri aktif.</p>
      <p style="color:#666;font-size:12px;">AES — Almanya Eğitim Serüveni · Bremen</p>
    </body></html>
    """
    msg = _build_msg(
        to      = NOTIFY_EMAIL,
        subject = "[AES] Email Test — Sistem Çalışıyor",
        html    = html,
    )
    ok = _send(msg)
    print("Test maili gönderildi!" if ok else "HATA: Email gönderilemedi — SMTP ayarlarını kontrol et")
    return ok
