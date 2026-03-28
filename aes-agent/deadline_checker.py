#!/usr/bin/env python3
"""
deadline_checker.py — Günlük deadline kontrol scripti

Kullanım:
  python deadline_checker.py           # Normal çalıştır
  python deadline_checker.py --test    # Test maili gönder
  python deadline_checker.py --dry-run # Email göndermeden listele

Cron ile günlük çalıştırmak için:
  0 8 * * * cd /path/to/aes-agent && source venv/bin/activate && python deadline_checker.py
"""
import sys
import argparse
import logging
from pathlib import Path
from datetime import date

# Proje root'unu path'e ekle
sys.path.insert(0, str(Path(__file__).parent / "src"))

from dotenv import load_dotenv
load_dotenv()

from database import ProgramDatabase
from notifier import check_and_send_deadline_reminders, test_email, _smtp_ok, _parse_deadline_date

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def dry_run(db: ProgramDatabase):
    """Email göndermeden yaklaşan deadlineleri listele."""
    today     = date.today()
    all_progs = db.get_all(limit=2000)
    found: list[dict] = []

    for row in all_progs:
        for label, raw in [("WiSe", row.get("deadline_wise")), ("SoSe", row.get("deadline_sose"))]:
            if not raw:
                continue
            d = _parse_deadline_date(raw)
            if not d:
                continue
            delta = (d - today).days
            if 0 <= delta <= 60:
                found.append({
                    "university": row["university"],
                    "program":    row["program"][:40],
                    "semester":   label,
                    "deadline":   raw,
                    "days_left":  delta,
                })

    if not found:
        print("Onumuzdeki 60 gun icinde deadline yok.")
        return

    print(f"\nOnumuzdeki 60 gun icinde {len(found)} deadline:\n")
    print(f"{'Universite':<30} {'Program':<35} {'Som':<5} {'Tarih':<15} {'Kalan'}")
    print("-" * 100)
    for item in sorted(found, key=lambda x: x["days_left"]):
        urgency = "[ACIL]" if item["days_left"] <= 7 else "[YAKIN]" if item["days_left"] <= 14 else ""
        print(f"{item['university']:<30} {item['program']:<35} {item['semester']:<5} "
              f"{item['deadline']:<15} {urgency} {item['days_left']} gun")


def main():
    parser = argparse.ArgumentParser(description="AES Deadline Checker")
    parser.add_argument("--test",    action="store_true", help="Test maili gönder")
    parser.add_argument("--dry-run", action="store_true", help="Email göndermeden listele")
    args = parser.parse_args()

    if args.test:
        test_email()
        return

    db = ProgramDatabase()

    if args.dry_run:
        dry_run(db)
        return

    # Email ayarları kontrol
    if not _smtp_ok():
        print("UYARI: .env'de SMTP_USER, SMTP_PASSWORD veya NOTIFY_EMAIL eksik")
        print("   Email gönderilemez. --dry-run ile listeleyebilirsiniz.")
        dry_run(db)
        return

    logger.info(f"Deadline kontrolü başlıyor — {date.today()}")
    sent = check_and_send_deadline_reminders(db, thresholds=[30, 14, 7, 1])
    logger.info(f"Tamamlandı — {sent} email gönderildi")


if __name__ == "__main__":
    main()
