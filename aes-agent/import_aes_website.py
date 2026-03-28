"""
import_aes_website.py — AES danışmanlık web sitesindeki üniversite verisini programs.db'ye aktar.

Çalıştır:
  cd aes-agent
  source venv/bin/activate
  python import_aes_website.py
"""

import hashlib
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "programs.db"

# ── Türkçe ay → MM ─────────────────────────────────────────────────────────
TURKISH_MONTHS = {
    "ocak": "01", "şubat": "02", "mart": "03", "nisan": "04",
    "mayıs": "05", "haziran": "06", "temmuz": "07", "ağustos": "08",
    "eylül": "09", "ekim": "10", "kasım": "11", "aralık": "12",
}

def parse_deadline(raw: str | None) -> str | None:
    """'15 Temmuz' → '15.07'  |  'Rolling admissions' → None"""
    if not raw:
        return None
    raw = raw.strip()
    if any(x in raw.lower() for x in ("rolling", "ilan", "yok", "—", "-")):
        return None
    # "DD Ay" formatı
    m = re.match(r"(\d{1,2})\s+(\w+)", raw, re.IGNORECASE)
    if m:
        day = m.group(1).zfill(2)
        month_tr = m.group(2).lower().replace("i", "i").replace("ı", "i")
        # Normalize Turkish chars for lookup
        month_key = m.group(2).lower()
        mm = TURKISH_MONTHS.get(month_key)
        if mm:
            return f"{day}.{mm}"
    return raw  # fallback: ham metni sakla


def parse_language(language_level: str | None) -> tuple[str | None, str | None]:
    """
    'Almanca DSH-2 veya İngilizce B2' → ('DSH-2', 'B2')
    Returns (german_req, english_req)
    """
    if not language_level:
        return None, None
    german = None
    english = None

    # Almanca
    m = re.search(
        r"(DSH[-\s]?\d|TestDaF\s*\d[×x]\d|TestDaF\s*\d|Goethe\s*[A-C]\d|telc\s*[A-C]\d|[A-C][12])",
        language_level, re.IGNORECASE
    )
    if m and "almanca" in language_level.lower()[:language_level.lower().find(m.group())]:
        german = m.group().strip()
    elif m:
        # If no "Almanca" prefix, still try to capture if it's clearly German
        if any(x in m.group().upper() for x in ("DSH", "TESTDAF", "GOETHE", "TELC")):
            german = m.group().strip()

    # More targeted German search
    gm = re.search(r"(DSH[-\s]?\d|TestDaF\s*(?:\d[×x]\d|\d+))", language_level, re.IGNORECASE)
    if gm:
        german = gm.group().strip()

    # English
    em = re.search(
        r"(IELTS\s*[\d.]+|TOEFL\s*\d+|[A-C][12](?:\+)?(?:\s|$))",
        language_level, re.IGNORECASE
    )
    if em and "ingilizce" in language_level.lower():
        english = em.group().strip()

    # B2/C1 after "İngilizce"
    em2 = re.search(r"ingilizce\s+([A-C][12](?:\+)?)", language_level, re.IGNORECASE)
    if em2:
        english = em2.group(1).strip()

    return german, english


def parse_gpa(gpa_str: str | None) -> float | None:
    """'Min. 3.0 (Alman Notu)' → 3.0 | 'Min. 2.0-2.5 ...' → 2.0"""
    if not gpa_str:
        return None
    m = re.search(r"(\d+[.,]\d+)", gpa_str)
    if m:
        try:
            return float(m.group(1).replace(",", "."))
        except ValueError:
            pass
    return None


def make_id(university: str, program: str) -> str:
    key = f"{university.lower().strip()}||{program.lower().strip()}"
    return hashlib.md5(key.encode()).hexdigest()[:16]


# ── Web sitesindeki üniversite verisini Python dict olarak tanımla ────────────
# Bu liste universities.ts dosyasından dönüştürülmüştür.
UNIVERSITIES = [
    # ── GRUP 1: SIFIR ALMANCA ──────────────────────────────────────────────────
    {
        "id": "uni-duisburg-essen",
        "name": "Universität Duisburg-Essen",
        "city": "Essen/Duisburg",
        "websiteUrl": "https://www.uni-due.de",
        "languages": ["İngilizce"],
        "programs": ["Bilgisayar Mühendisliği", "Elektrik Mühendisliği", "Makine Mühendisliği",
                     "İşletme", "Ekonomi", "Uluslararası İşletme"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "İngilizce B2/C1 (bazı programlar Almanca gerektirmez)",
        "gpa": "Min. 2.5-3.0 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "tu-dortmund",
        "name": "TU Dortmund",
        "city": "Dortmund",
        "websiteUrl": "https://www.tu-dortmund.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Bilgisayar Bilimi", "Veri Bilimi", "Makine Mühendisliği",
                     "Elektrik Mühendisliği", "Kimya", "İnşaat Mühendisliği",
                     "Lojistik", "İşletme", "Matematik", "Fizik"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce B2-C1",
        "gpa": "Min. 2.5-3.0 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-paderborn",
        "name": "Universität Paderborn",
        "city": "Paderborn",
        "websiteUrl": "https://www.uni-paderborn.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Bilgisayar Bilimi", "Elektrik Mühendisliği", "Makine Mühendisliği",
                     "İşletme", "Ekonomi", "Matematik", "Fizik", "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce B2-C1",
        "gpa": "Min. 2.5-3.0 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    # ── GRUP 2: TU9 ────────────────────────────────────────────────────────────
    {
        "id": "tum",
        "name": "Technische Universität München",
        "city": "München",
        "websiteUrl": "https://www.tum.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "Bilişim", "Fizik", "Kimya", "İşletme", "Matematik", "Biyomühendislik",
                     "Havacılık Mühendisliği", "Tıp Bilişimi"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Ocak", "summer": "15 Temmuz"},
        "languageLevel": "Almanca DSH-2 / TestDaF 16 veya İngilizce B2-C1",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "rwth-aachen",
        "name": "RWTH Aachen",
        "city": "Aachen",
        "websiteUrl": "https://www.rwth-aachen.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "İnşaat Mühendisliği", "Kimya Mühendisliği", "Fizik", "Matematik",
                     "İşletme", "Metalurji", "Endüstri Mühendisliği"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Ocak", "summer": "15 Temmuz"},
        "languageLevel": "Almanca DSH-2 / TestDaF 16 veya İngilizce C1",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "tu-berlin",
        "name": "Technische Universität Berlin",
        "city": "Berlin",
        "websiteUrl": "https://www.tu.berlin",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Bilgisayar Bilimi", "Elektrik Mühendisliği", "Makine Mühendisliği",
                     "Planlama Bilimleri", "İşletme", "Matematik", "Fizik",
                     "Mimarlık", "Ekonomi"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF 16 veya İngilizce C1",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "tu-darmstadt",
        "name": "TU Darmstadt",
        "city": "Darmstadt",
        "websiteUrl": "https://www.tu-darmstadt.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Elektrik Mühendisliği", "Makine Mühendisliği", "Bilgisayar Bilimi",
                     "İnşaat Mühendisliği", "Kimya Mühendisliği", "Fizik", "Matematik",
                     "İşletme"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF 4x4 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "kit",
        "name": "Karlsruher Institut für Technologie (KIT)",
        "city": "Karlsruhe",
        "websiteUrl": "https://www.kit.edu",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "Fizik", "Kimya", "İnşaat Mühendisliği", "Matematik", "İşletme",
                     "Endüstri Mühendisliği"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "tu-dresden",
        "name": "Technische Universität Dresden",
        "city": "Dresden",
        "websiteUrl": "https://tu-dresden.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "İnşaat Mühendisliği", "Mimarlık", "Tıp", "Hukuk", "Ekonomi",
                     "Biyomühendislik", "Orman Mühendisliği"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-stuttgart",
        "name": "Universität Stuttgart",
        "city": "Stuttgart",
        "websiteUrl": "https://www.uni-stuttgart.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "Havacılık Mühendisliği", "İnşaat Mühendisliği", "Mimarlık",
                     "Fizik", "Kimya", "Matematik", "İşletme"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-hannover",
        "name": "Leibniz Universität Hannover",
        "city": "Hannover",
        "websiteUrl": "https://www.uni-hannover.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Mühendisliği",
                     "İnşaat Mühendisliği", "Mimarlık", "Matematik", "Fizik", "Hukuk",
                     "Ekonomi", "İşletme"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF 4x4 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "tu-braunschweig",
        "name": "Technische Universität Braunschweig",
        "city": "Braunschweig",
        "websiteUrl": "https://www.tu-braunschweig.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Havacılık Mühendisliği", "Otomotiv Mühendisliği",
                     "Elektrik Mühendisliği", "Bilgisayar Bilimi", "Mimarlık",
                     "İnşaat Mühendisliği", "Eczacılık", "Matematik", "Fizik"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF 4x4 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    # ── GRUP 3: ŞARTLı KABUL YOK, PRESTİJLİ ──────────────────────────────────
    {
        "id": "uni-hamburg",
        "name": "Universität Hamburg",
        "city": "Hamburg",
        "websiteUrl": "https://www.uni-hamburg.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Hukuk", "Ekonomi", "İşletme", "Fizik", "Kimya", "Biyoloji",
                     "Matematik", "Bilgisayar Bilimi", "Tıp", "Tarih", "Felsefe",
                     "Psikoloji", "Sosyoloji", "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-heidelberg",
        "name": "Universität Heidelberg",
        "city": "Heidelberg",
        "websiteUrl": "https://www.uni-heidelberg.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Biyoloji", "Kimya", "Fizik", "Matematik", "Hukuk",
                     "Felsefe", "Tarih", "Psikoloji", "Ekonomi", "İşletme"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF 16 veya İngilizce C1",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "mhh-hannover",
        "name": "Medizinische Hochschule Hannover (MHH)",
        "city": "Hannover",
        "websiteUrl": "https://www.mhh.de",
        "languages": ["Almanca"],
        "programs": ["Tıp", "Diş Hekimliği", "Biyomedikal Bilimler", "Hemşirelik",
                     "Sağlık Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 1.0-1.5 (Alman Notu) - Tıp için yüksek",
        "conditionalAcceptance": False,
    },
    {
        "id": "lmu-muenchen",
        "name": "Ludwig-Maximilians-Universität München",
        "city": "München",
        "websiteUrl": "https://www.lmu.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "İşletme", "Fizik", "Kimya",
                     "Biyoloji", "Felsefe", "Tarih", "Psikoloji", "Sosyoloji",
                     "Siyaset Bilimi", "Matematik", "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "30 Nisan", "summer": "30 Kasım"},
        "languageLevel": "Almanca DSH-2 / TestDaF 16 veya İngilizce C1",
        "gpa": "Min. 1.5-2.0 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-freiburg",
        "name": "Albert-Ludwigs-Universität Freiburg",
        "city": "Freiburg",
        "websiteUrl": "https://www.uni-freiburg.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "Biyoloji", "Kimya", "Fizik",
                     "Matematik", "Felsefe", "Tarih", "Sosyoloji", "Psikoloji",
                     "Bilgisayar Bilimi", "Çevre Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-tuebingen",
        "name": "Eberhard Karls Universität Tübingen",
        "city": "Tübingen",
        "websiteUrl": "https://uni-tuebingen.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "Biyoloji", "Kimya", "Fizik",
                     "Matematik", "Felsefe", "Tarih", "Psikoloji", "Sosyoloji",
                     "Bilgisayar Bilimi", "Teoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-muenster",
        "name": "Westfälische Wilhelms-Universität Münster",
        "city": "Münster",
        "websiteUrl": "https://www.uni-muenster.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "İşletme", "Kimya", "Biyoloji",
                     "Matematik", "Fizik", "Bilgisayar Bilimi", "Tarih", "Felsefe",
                     "Teoloji", "Psikoloji", "Sosyoloji", "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-goettingen",
        "name": "Georg-August-Universität Göttingen",
        "city": "Göttingen",
        "websiteUrl": "https://www.uni-goettingen.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "İşletme", "Fizik", "Kimya",
                     "Biyoloji", "Tarım", "Ormancılık", "Matematik", "Bilgisayar Bilimi",
                     "Felsefe", "Tarih", "Psikoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "fu-berlin",
        "name": "Freie Universität Berlin",
        "city": "Berlin",
        "websiteUrl": "https://www.fu-berlin.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Hukuk", "Tıp", "Veterinerlik", "Eczacılık", "Ekonomi",
                     "Bilgisayar Bilimi", "Felsefe", "Tarih", "Siyaset Bilimi",
                     "Sosyoloji", "Fizik", "Kimya", "Biyoloji", "Matematik",
                     "Psikoloji", "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 / TestDaF 16 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "hu-berlin",
        "name": "Humboldt-Universität zu Berlin",
        "city": "Berlin",
        "websiteUrl": "https://www.hu-berlin.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Felsefe", "Hukuk", "Fizik", "Kimya", "Matematik", "Biyoloji",
                     "Bilgisayar Bilimi", "İşletme", "İktisat", "Sosyal Bilimler",
                     "Siyaset Bilimi", "Psikoloji", "Tarih", "Dil Bilimleri",
                     "Nörobilim", "Veri Bilimi"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Program bazlı – NC programlarda yüksek",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-koeln",
        "name": "Universität zu Köln",
        "city": "Köln",
        "websiteUrl": "https://www.uni-koeln.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "İşletme", "Kimya", "Biyoloji",
                     "Matematik", "Fizik", "Psikoloji", "Tarih", "Felsefe",
                     "Sosyoloji", "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-bonn",
        "name": "Rheinische Friedrich-Wilhelms-Universität Bonn",
        "city": "Bonn",
        "websiteUrl": "https://www.uni-bonn.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "İşletme", "Fizik", "Kimya",
                     "Biyoloji", "Matematik", "Tarım", "Tarih", "Felsefe",
                     "Psikoloji", "Bilgisayar Bilimi"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-frankfurt",
        "name": "Goethe-Universität Frankfurt",
        "city": "Frankfurt",
        "websiteUrl": "https://www.goethe-university-frankfurt.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "İşletme", "Finans", "Kimya",
                     "Biyoloji", "Fizik", "Matematik", "Bilgisayar Bilimi",
                     "Psikoloji", "Felsefe", "Tarih", "Sosyoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-erlangen",
        "name": "Friedrich-Alexander-Universität Erlangen-Nürnberg",
        "city": "Erlangen/Nürnberg",
        "websiteUrl": "https://www.fau.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "Tıp", "Hukuk", "Ekonomi", "İşletme", "Fizik", "Kimya",
                     "Biyoloji", "Matematik", "Psikoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-leipzig",
        "name": "Universität Leipzig",
        "city": "Leipzig",
        "websiteUrl": "https://www.uni-leipzig.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Hukuk", "Ekonomi", "İşletme", "Kimya", "Biyoloji",
                     "Fizik", "Matematik", "Tarih", "Felsefe", "Psikoloji",
                     "Bilgisayar Bilimi", "Sosyoloji", "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-mannheim",
        "name": "Universität Mannheim",
        "city": "Mannheim",
        "websiteUrl": "https://www.uni-mannheim.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["İşletme", "Ekonomi", "Finans", "Hukuk", "Sosyoloji",
                     "Siyaset Bilimi", "Psikoloji", "Matematik", "Bilgisayar Bilimi",
                     "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.0 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "charite",
        "name": "Charité – Universitätsmedizin Berlin",
        "city": "Berlin",
        "websiteUrl": "https://www.charite.de",
        "languages": ["Almanca"],
        "programs": ["Tıp", "Diş Hekimliği", "Nörobilim", "Tıp Bilişimi",
                     "Biyomedikal Bilimler"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 1.0-1.5 (Alman Notu) - Tıp için çok yüksek",
        "conditionalAcceptance": False,
    },
    # ── GRUP 4: ŞARTLI KABUL VAR ───────────────────────────────────────────────
    {
        "id": "uni-bremen",
        "name": "Universität Bremen",
        "city": "Bremen",
        "websiteUrl": "https://www.uni-bremen.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Bilgisayar Bilimi", "Elektrik Mühendisliği", "Makine Mühendisliği",
                     "İnşaat Mühendisliği", "Fizik", "Kimya", "Biyoloji", "Matematik",
                     "Ekonomi", "İşletme", "Hukuk", "Sosyoloji", "Psikoloji",
                     "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4 / İngilizce C1 (YL)",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-wuppertal",
        "name": "Bergische Universität Wuppertal",
        "city": "Wuppertal",
        "websiteUrl": "https://www.uni-wuppertal.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "İnşaat Mühendisliği",
                     "Mimarlık", "Tasarım", "Güvenlik Mühendisliği", "Ekonomi",
                     "İşletme", "Eğitim Bilimleri", "Matematik", "Fizik",
                     "Kimya", "Biyoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4 / İngilizce IELTS 6.0+",
        "gpa": "Min. 2.5-3.0 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-giessen",
        "name": "Justus-Liebig-Universität Gießen",
        "city": "Giessen",
        "websiteUrl": "https://www.uni-giessen.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Diş Hekimliği", "Veterinerlik", "Eczacılık",
                     "Tarım Bilimleri", "Gıda Bilimleri", "Hukuk", "Ekonomi",
                     "İşletme", "Psikoloji", "Biyoloji", "Kimya", "Fizik", "Matematik"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-siegen",
        "name": "Universität Siegen",
        "city": "Siegen",
        "websiteUrl": "https://www.uni-siegen.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "İnşaat Mühendisliği",
                     "Mimarlık", "Medya Bilimleri", "Ekonomi", "İşletme",
                     "Bilgisayar Bilimi", "Psikoloji", "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce B2",
        "gpa": "Min. 2.5-3.0 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-oldenburg",
        "name": "Carl von Ossietzky Universität Oldenburg",
        "city": "Oldenburg",
        "websiteUrl": "https://uol.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Yenilenebilir Enerji", "Sürdürülebilirlik", "Deniz Bilimleri",
                     "Tıp", "Diş Hekimliği", "Bilgisayar Bilimi", "Eğitim Bilimleri",
                     "Fizik", "Kimya", "Biyoloji", "Matematik", "Ekonomi", "İşletme"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-marburg",
        "name": "Philipps-Universität Marburg",
        "city": "Marburg",
        "websiteUrl": "https://www.uni-marburg.de",
        "languages": ["Almanca"],
        "programs": ["Tıp", "Diş Hekimliği", "Eczacılık", "Biyoloji", "Kimya",
                     "Fizik", "Matematik", "Felsefe", "Tarih", "Hukuk",
                     "Ekonomi", "Psikoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-bochum",
        "name": "Ruhr-Universität Bochum",
        "city": "Bochum",
        "websiteUrl": "https://www.ruhr-uni-bochum.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "İnşaat Mühendisliği",
                     "Bilgisayar Bilimi", "IT Güvenliği", "Tıp", "Biyoloji", "Kimya",
                     "Fizik", "Matematik", "Hukuk", "Ekonomi", "İşletme", "Psikoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4 / İngilizce IELTS 6.5+",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    # ── GRUP 5: HOCHSCHULE'LER ─────────────────────────────────────────────────
    {
        "id": "hochschule-munich",
        "name": "Hochschule München (HM)",
        "city": "München",
        "websiteUrl": "https://www.hm.edu",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "Mimarlık", "İşletme", "Tasarım", "Sosyal Hizmet",
                     "Biyoteknoloji", "Geomatik"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce B2",
        "gpa": "Min. 3.0 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "hs-esslingen",
        "name": "Hochschule Esslingen",
        "city": "Esslingen",
        "websiteUrl": "https://www.hs-esslingen.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Otomotiv Mühendisliği", "Mekatronik", "Makine Mühendisliği",
                     "Elektrik Mühendisliği", "Bilgisayar Bilimi", "İşletme",
                     "Sosyal Hizmet", "Biyoteknoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce B2",
        "gpa": "Min. 3.0 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "hs-darmstadt",
        "name": "Hochschule Darmstadt",
        "city": "Darmstadt",
        "websiteUrl": "https://h-da.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Bilgisayar Bilimi", "Yazılım Mühendisliği", "Makine Mühendisliği",
                     "Elektrik Mühendisliği", "Tasarım", "Görsel İletişim", "Medya",
                     "Mimarlık", "Ekonomi", "İşletme", "Kimya Mühendisliği"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce B2",
        "gpa": "Min. 3.0 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "htw-berlin",
        "name": "Hochschule für Technik und Wirtschaft Berlin (HTW)",
        "city": "Berlin",
        "websiteUrl": "https://www.htw-berlin.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Bilgisayar Bilimi", "Yazılım Mühendisliği", "Makine Mühendisliği",
                     "Elektrik Mühendisliği", "Enerji Mühendisliği", "Tasarım",
                     "İşletme", "Uluslararası İşletme"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce B2",
        "gpa": "Min. 3.0 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    # ── GRUP 6: DİĞER DEVLET ÜNİVERSİTELERİ ─────────────────────────────────
    {
        "id": "uni-saarland",
        "name": "Universität des Saarlandes",
        "city": "Saarbrücken",
        "websiteUrl": "https://www.uni-saarland.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Bilgisayar Bilimi", "Yapay Zeka", "Veri Bilimi", "Siber Güvenlik",
                     "Yazılım Mühendisliği", "Makine Öğrenmesi", "Tıp", "Hukuk",
                     "Ekonomi", "İşletme", "Biyoinformatik", "Matematik", "Fizik"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-potsdam",
        "name": "Universität Potsdam",
        "city": "Potsdam",
        "websiteUrl": "https://www.uni-potsdam.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Hukuk", "Ekonomi", "İşletme", "Bilgisayar Bilimi",
                     "Yazılım Mühendisliği", "Veri Bilimi", "Dijital Mühendislik",
                     "Matematik", "Fizik", "Kimya", "Biyoloji", "Psikoloji",
                     "Eğitim Bilimleri"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "tu-clausthal",
        "name": "Technische Universität Clausthal",
        "city": "Clausthal-Zellerfeld",
        "websiteUrl": "https://www.tu-clausthal.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Maden Mühendisliği", "Hammadde Mühendisliği", "Malzeme Bilimi",
                     "Enerji Teknolojileri", "Kimya Mühendisliği", "Makine Mühendisliği",
                     "Bilgisayar Bilimi", "Matematik", "Fizik", "Kimya",
                     "Ekonomi", "Çevre Mühendisliği"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.5-3.0 (Alman Notu)",
        "conditionalAcceptance": True,
    },
    {
        "id": "uni-magdeburg",
        "name": "Otto-von-Guericke-Universität Magdeburg",
        "city": "Magdeburg",
        "websiteUrl": "https://www.ovgu.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "Proses Mühendisliği", "Tıp", "Nörobilim", "Matematik", "Fizik",
                     "Ekonomi", "İşletme", "Psikoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-konstanz",
        "name": "Universität Konstanz",
        "city": "Konstanz",
        "websiteUrl": "https://www.uni-konstanz.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Biyoloji", "Kimya", "Fizik", "Matematik", "Bilgisayar Bilimi",
                     "Psikoloji", "Ekonomi", "İşletme", "Hukuk", "Siyaset Bilimi",
                     "Sosyoloji", "Felsefe"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-ulm",
        "name": "Universität Ulm",
        "city": "Ulm",
        "websiteUrl": "https://www.uni-ulm.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Moleküler Tıp", "Biyoloji", "Fizik", "Kimya",
                     "Matematik", "Bilgisayar Bilimi", "Yazılım Mühendisliği",
                     "Psikoloji", "Ekonomi", "Elektrik Mühendisliği",
                     "Makine Mühendisliği", "Mekatronik"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-wurzburg",
        "name": "Julius-Maximilians-Universität Würzburg",
        "city": "Würzburg",
        "websiteUrl": "https://www.uni-wuerzburg.de",
        "languages": ["Almanca"],
        "programs": ["Tıp", "Diş Hekimliği", "Eczacılık", "Hukuk", "Fizik",
                     "Biyoloji", "Kimya", "Matematik", "Bilgisayar Bilimi",
                     "Yapay Zekâ ve Veri Bilimi", "Oyun Mühendisliği",
                     "Psikoloji", "Ekonomi", "İşletme"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.0-2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "uni-mainz",
        "name": "Johannes Gutenberg-Universität Mainz",
        "city": "Mainz",
        "websiteUrl": "https://www.uni-mainz.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Tıp", "Diş Hekimliği", "Hukuk", "Ekonomi", "İşletme",
                     "Fizik", "Kimya", "Biyoloji", "Matematik", "Bilgisayar Bilimi",
                     "Felsefe", "Tarih", "Sosyoloji", "Psikoloji"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "tuhh",
        "name": "Technische Universität Hamburg (TUHH)",
        "city": "Hamburg",
        "websiteUrl": "https://www.tuhh.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "Kimya Mühendisliği", "Gemi İnşaatı ve Deniz Teknolojisi",
                     "Lojistik", "İşletme", "Biyomühendislik", "Çevre Mühendisliği"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    # ── Diğer önemli üniversiteler ────────────────────────────────────────────
    {
        "id": "hs-bremen",
        "name": "Hochschule Bremen",
        "city": "Bremen",
        "websiteUrl": "https://www.hs-bremen.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Havacılık ve Uzay Mühendisliği", "Makine Mühendisliği",
                     "Mekatronik", "Elektroteknik", "Bilgisayar Bilimi",
                     "İşletme", "Uluslararası İşletme", "Mimarlık",
                     "İnşaat Mühendisliği", "Sosyal Hizmet", "Lojistik Yönetimi"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya TestDaF 4x4",
        "gpa": "Vorpraktikum (8 hafta) mühendislik için zorunlu",
        "conditionalAcceptance": False,
    },
    {
        "id": "rptu-kaiserslautern",
        "name": "RPTU Kaiserslautern-Landau",
        "city": "Kaiserslautern",
        "websiteUrl": "https://www.rptu.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Makine Mühendisliği", "Elektrik Mühendisliği", "Bilgisayar Bilimi",
                     "Matematik", "Fizik", "Kimya", "Biyoloji", "İşletme",
                     "Biyomühendislik", "Mimarlık"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "15 Temmuz", "summer": "15 Ocak"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Min. 2.5 (Alman Notu)",
        "conditionalAcceptance": False,
    },
    {
        "id": "bauhaus-weimar",
        "name": "Bauhaus-Universität Weimar",
        "city": "Weimar",
        "websiteUrl": "https://www.uni-weimar.de",
        "languages": ["Almanca", "İngilizce"],
        "programs": ["Mimarlık", "Şehir Planlama", "Sanat", "Tasarım",
                     "Medya Tasarımı", "Dijital Tasarım", "Sanat Tarihi",
                     "Mühendislik", "İnşaat Mühendisliği"],
        "degreeTypes": ["Lisans", "Yüksek Lisans"],
        "deadlines": {"winter": "1 Mayıs", "summer": "1 Kasım"},
        "languageLevel": "Almanca DSH-2 veya İngilizce C1",
        "gpa": "Portfolyo zorunlu",
        "conditionalAcceptance": False,
    },
]


def init_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
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
            last_scraped          TEXT NOT NULL,
            created_at            TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at            TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prog_lang   ON programs(language)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prog_degree ON programs(degree)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prog_uni    ON programs(university)")
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prog_url
        ON programs(url) WHERE url IS NOT NULL
    """)
    conn.commit()
    return conn


def import_universities(conn: sqlite3.Connection) -> tuple[int, int]:
    """Üniversite verisini DB'ye aktar. (inserted, updated) döndürür."""
    now = datetime.now().isoformat()
    inserted = 0
    updated = 0

    for uni in UNIVERSITIES:
        german_req, english_req = parse_language(uni.get("languageLevel"))
        deadline_wise = parse_deadline(uni.get("deadlines", {}).get("winter"))
        deadline_sose = parse_deadline(uni.get("deadlines", {}).get("summer"))
        min_gpa = parse_gpa(uni.get("gpa"))
        language_str = " / ".join(uni.get("languages", []))
        degree_str = " / ".join(uni.get("degreeTypes", []))
        conditional = 1 if uni.get("conditionalAcceptance") else 0

        for program in uni.get("programs", []):
            pid = make_id(uni["name"], program)

            # Mevcut mi kontrol et
            existing = conn.execute(
                "SELECT id FROM programs WHERE id = ?", (pid,)
            ).fetchone()

            record = (
                pid,
                uni["name"],
                program,
                uni.get("city"),
                language_str,
                degree_str,
                deadline_wise,
                deadline_sose,
                german_req,
                english_req,
                None,    # nc_value
                min_gpa,
                0,       # uni_assist (unknown)
                conditional,
                None,    # url — website URL is per uni, not per program
                "aes_website",
                0.8,     # confidence (manually curated)
                now,
                now,
            )

            if existing:
                conn.execute("""
                    UPDATE programs SET
                        university=?, program=?, city=?, language=?, degree=?,
                        deadline_wise=?, deadline_sose=?,
                        german_requirement=?, english_requirement=?,
                        nc_value=?, min_gpa=?, uni_assist=?, conditional_admission=?,
                        url=?, source=?, confidence=?, last_scraped=?, updated_at=?
                    WHERE id=?
                """, record[1:] + (pid,))
                updated += 1
            else:
                conn.execute("""
                    INSERT INTO programs
                        (id, university, program, city, language, degree,
                         deadline_wise, deadline_sose,
                         german_requirement, english_requirement,
                         nc_value, min_gpa, uni_assist, conditional_admission,
                         url, source, confidence, last_scraped, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, record)
                inserted += 1

    conn.commit()
    return inserted, updated


def main():
    print(f"📦 AES Web Sitesi Verisi → programs.db")
    print(f"   DB yolu: {DB_PATH}\n")

    conn = init_db(DB_PATH)
    inserted, updated = import_universities(conn)
    conn.close()

    # İstatistik
    conn2 = sqlite3.connect(str(DB_PATH))
    total = conn2.execute("SELECT COUNT(*) FROM programs").fetchone()[0]
    by_uni = conn2.execute(
        "SELECT university, COUNT(*) c FROM programs WHERE source='aes_website' "
        "GROUP BY university ORDER BY c DESC LIMIT 10"
    ).fetchall()
    conn2.close()

    print(f"✅ Tamamlandı!")
    print(f"   Yeni kayıt: {inserted}")
    print(f"   Güncellenen: {updated}")
    print(f"   Toplam DB kaydı: {total}")
    print(f"\n📊 Üniversite başına program sayısı (ilk 10):")
    for uni_name, count in by_uni:
        print(f"   {count:3d}  {uni_name}")


if __name__ == "__main__":
    main()
