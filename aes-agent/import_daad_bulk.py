"""
import_daad_bulk.py — DAAD'daki tüm ~2550 programı DB'ye aktar.

Kullanım:
  python import_daad_bulk.py           # Normal çalıştır
  python import_daad_bulk.py --clear   # Önce seed_db kayıtlarını sil
  python import_daad_bulk.py --stats   # Sadece istatistik
"""

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

DB_PATH = Path(__file__).parent / "programs.db"
NOW = datetime.now().isoformat()

DAAD_API = (
    "https://www2.daad.de/deutschland/studienangebote/"
    "international-programmes/api/solr/en/search.json"
)
DAAD_BASE = "https://www2.daad.de"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://www2.daad.de/deutschland/studienangebote/international-programmes/en/",
}

DEGREE_MAP = {
    1: "Bachelor",
    2: "Master",
    3: "PhD / Doctorate",
    4: "Preparation",
    5: "State Examination",
    6: "Other",
}


# ─── HTML → düz metin ────────────────────────────────────────────────────────

def strip_html(html: str | None) -> str | None:
    if not html:
        return None
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text or None


# ─── Deadline parse ───────────────────────────────────────────────────────────

def extract_deadlines(text: str | None) -> tuple[str | None, str | None]:
    """
    applicationDeadline alanından WiSe / SoSe son tarihlerini çıkar.
    Döner: (deadline_wise, deadline_sose)
    """
    if not text:
        return None, None

    clean = strip_html(text) or ""

    wise = None
    sose = None

    # "31 May" / "15 January" / "15.01." / "01.03" gibi kalıpları bul
    date_patterns = [
        r"\b(\d{1,2})[.\s/](\d{1,2})(?:[.\s/](\d{4}))?\b",  # 31.05 veya 31.05.2025
        r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b",
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b",
    ]

    month_map = {
        "january": "01", "february": "02", "march": "03", "april": "04",
        "may": "05", "june": "06", "july": "07", "august": "08",
        "september": "09", "october": "10", "november": "11", "december": "12",
    }

    lines = clean.lower().replace("\n", "|").split("|")

    for line in lines:
        is_wise = any(w in line for w in ("winter", "wise", "october", "oktober", "herbst"))
        is_sose = any(w in line for w in ("summer", "sose", "april", "spring", "früh"))

        # Tarih bul
        found_date = None
        # DD Month
        m = re.search(
            r"(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)",
            line,
        )
        if m:
            day = m.group(1).zfill(2)
            mon = month_map[m.group(2)]
            found_date = f"{day}.{mon}."

        # Month DD
        if not found_date:
            m = re.search(
                r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})",
                line,
            )
            if m:
                day = m.group(2).zfill(2)
                mon = month_map[m.group(1)]
                found_date = f"{day}.{mon}."

        # DD.MM
        if not found_date:
            m = re.search(r"\b(\d{1,2})\.(\d{1,2})\.?", line)
            if m:
                found_date = f"{m.group(1).zfill(2)}.{m.group(2).zfill(2)}."

        if found_date:
            if is_wise and not wise:
                wise = found_date
            elif is_sose and not sose:
                sose = found_date
            elif not wise:
                wise = found_date  # İlk bulunan → WiSe

    return wise, sose


# ─── Dil çıkarma ─────────────────────────────────────────────────────────────

def parse_languages(langs: list[str]) -> str:
    if not langs:
        return "Englisch"
    joined = ", ".join(langs)
    has_de = any("german" in l.lower() or "deutsch" in l.lower() for l in langs)
    has_en = any("english" in l.lower() or "englisch" in l.lower() for l in langs)
    if has_de and has_en:
        return "Deutsch / Englisch"
    if has_de:
        return "Deutsch"
    return "Englisch"


def parse_lang_requirement(level, lang: str) -> str | None:
    """languageLevelGerman / languageLevelEnglish → gereksinim metni"""
    if not level:
        return None
    if isinstance(level, list):
        level = " ".join(str(x) for x in level if x)
    level = str(level).strip()
    if lang == "german":
        if "c1" in level.lower() or "c2" in level.lower():
            return "DSH-2 / TestDaF 16 / Goethe C1"
        if "b2" in level.lower():
            return "DSH-1 / TestDaF 12 / Goethe B2"
        if "b1" in level.lower():
            return "Goethe B1"
        return level
    else:  # english
        if "c1" in level.lower() or "c2" in level.lower():
            return "IELTS 7.0 / TOEFL 100"
        if "b2" in level.lower():
            return "IELTS 6.5 / TOEFL 90"
        if "b1" in level.lower():
            return "IELTS 6.0 / TOEFL 79"
        return level


# ─── Kurs → DB kaydı ─────────────────────────────────────────────────────────

def course_to_record(c: dict) -> dict:
    url_path = c.get("link", "")
    url = (DAAD_BASE + url_path) if url_path else None

    pid = hashlib.md5(
        (url or f"{c.get('academy','')}||{c.get('courseName','')}").encode()
    ).hexdigest()[:16]

    lang_list = c.get("languages") or []
    language = parse_languages(lang_list)

    ger_req = parse_lang_requirement(c.get("languageLevelGerman"), "german")
    eng_req = parse_lang_requirement(c.get("languageLevelEnglish"), "english")

    # Dil gereksinimi yoksa tahmin et
    if not ger_req and not eng_req:
        if "Deutsch" in language:
            ger_req = "DSH-2 / TestDaF 16"
        else:
            eng_req = "IELTS 6.5 / TOEFL 90"

    dw, ds = extract_deadlines(c.get("applicationDeadline"))

    degree_raw = c.get("courseType")
    degree = DEGREE_MAP.get(degree_raw, "Master")

    fee_raw = c.get("tuitionFees") or ""
    nc = None
    if "none" in fee_raw.lower() or "no tuition" in fee_raw.lower():
        nc = "zulassungsfrei"

    # Güven skoru: DAAD'dan geldiği için yüksek
    confidence = 0.88

    return {
        "id":                    pid,
        "university":            c.get("academy") or "",
        "program":               c.get("courseName") or "",
        "city":                  c.get("city"),
        "language":              language,
        "degree":                degree,
        "deadline_wise":         dw,
        "deadline_sose":         ds,
        "german_requirement":    ger_req,
        "english_requirement":   eng_req,
        "nc_value":              nc,
        "min_gpa":               None,
        "uni_assist":            0,   # DAAD uluslararası programlar genellikle direkt
        "conditional_admission": 1,
        "url":                   url,
        "source":                "daad_api_bulk",
        "confidence":            confidence,
        "last_scraped":          NOW,
        "updated_at":            NOW,
    }


# ─── DAAD'dan tüm programları çek ────────────────────────────────────────────

def fetch_all_daad(batch: int = 100) -> list[dict]:
    all_courses = []
    start = 0
    total = None

    with httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        while True:
            params = {"q": "", "rows": str(batch), "start": str(start)}
            try:
                r = client.get(DAAD_API, params=params)
                r.raise_for_status()
                data = r.json()
            except Exception as e:
                print(f"\n⚠️  Hata (start={start}): {e}")
                time.sleep(3)
                continue

            courses = data.get("courses") or []
            if total is None:
                total = data.get("numResults", 0)
                print(f"   DAAD toplam program: {total}")

            all_courses.extend(courses)
            fetched = len(all_courses)
            pct = int(fetched / max(total, 1) * 50)
            bar = "█" * pct + "░" * (50 - pct)
            print(f"\r   [{bar}] {fetched}/{total}", end="", flush=True)

            if not courses or fetched >= total:
                break

            start += batch
            time.sleep(0.4)   # DAAD'a saygı göster

    print()
    return all_courses


# ─── DB'ye kaydet ─────────────────────────────────────────────────────────────

INSERT_SQL = """
    INSERT INTO programs
        (id, university, program, city, language, degree,
         deadline_wise, deadline_sose,
         german_requirement, english_requirement,
         nc_value, min_gpa, uni_assist, conditional_admission,
         url, source, confidence, last_scraped, updated_at)
    VALUES
        (:id, :university, :program, :city, :language, :degree,
         :deadline_wise, :deadline_sose,
         :german_requirement, :english_requirement,
         :nc_value, :min_gpa, :uni_assist, :conditional_admission,
         :url, :source, :confidence, :last_scraped, :updated_at)
    ON CONFLICT(id) DO UPDATE SET
        university            = excluded.university,
        program               = excluded.program,
        city                  = excluded.city,
        language              = excluded.language,
        degree                = excluded.degree,
        deadline_wise         = excluded.deadline_wise,
        deadline_sose         = excluded.deadline_sose,
        german_requirement    = excluded.german_requirement,
        english_requirement   = excluded.english_requirement,
        nc_value              = excluded.nc_value,
        min_gpa               = excluded.min_gpa,
        uni_assist            = excluded.uni_assist,
        conditional_admission = excluded.conditional_admission,
        url                   = excluded.url,
        source                = excluded.source,
        confidence            = excluded.confidence,
        last_scraped          = excluded.last_scraped,
        updated_at            = excluded.updated_at
"""

# URL unique index varken URL=NULL olan kayıtları çakışmadan eklemek için:
INSERT_NO_URL_SQL = INSERT_SQL.replace(
    "ON CONFLICT(id) DO UPDATE",
    "ON CONFLICT(id) DO UPDATE",
)


def save_records(conn: sqlite3.Connection, records: list[dict]) -> tuple[int, int]:
    ins = skp = 0
    for rec in records:
        try:
            conn.execute(INSERT_SQL, rec)
            ins += 1
        except sqlite3.IntegrityError:
            skp += 1
    conn.commit()
    return ins, skp


# ─── İstatistik ───────────────────────────────────────────────────────────────

def print_stats(conn: sqlite3.Connection):
    total = conn.execute("SELECT COUNT(*) FROM programs").fetchone()[0]
    by_src = conn.execute(
        "SELECT source, COUNT(*) cnt FROM programs GROUP BY source ORDER BY cnt DESC LIMIT 10"
    ).fetchall()
    by_lang = conn.execute(
        "SELECT language, COUNT(*) cnt FROM programs GROUP BY language ORDER BY cnt DESC"
    ).fetchall()
    by_deg = conn.execute(
        "SELECT degree, COUNT(*) cnt FROM programs GROUP BY degree ORDER BY cnt DESC"
    ).fetchall()
    top_unis = conn.execute(
        "SELECT university, COUNT(*) cnt FROM programs GROUP BY university ORDER BY cnt DESC LIMIT 10"
    ).fetchall()
    no_deadline = conn.execute(
        "SELECT COUNT(*) FROM programs WHERE deadline_wise IS NULL AND deadline_sose IS NULL"
    ).fetchone()[0]

    print(f"\n{'─'*55}")
    print(f"  Toplam kayıt       : {total:,}")
    print(f"  Deadline yok       : {no_deadline:,}")
    print(f"\n  Kaynağa göre:")
    for r in by_src:
        print(f"    {(r[0] or '(boş)')[:35]:35} {r[1]:>5}")
    print(f"\n  Dile göre:")
    for r in by_lang:
        print(f"    {(r[0] or '(boş)')[:30]:30} {r[1]:>5}")
    print(f"\n  Dereceye göre:")
    for r in by_deg:
        print(f"    {(r[0] or '(boş)')[:20]:20} {r[1]:>5}")
    print(f"\n  En çok program:")
    for r in top_unis:
        print(f"    {(r[0] or '(boş)')[:45]:45} {r[1]:>4}")
    print(f"{'─'*55}\n")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DAAD Bulk Import")
    parser.add_argument("--clear", action="store_true",
                        help="Önce seed_db kayıtlarını sil (DAAD kayıtlarına dokunmaz)")
    parser.add_argument("--stats", action="store_true",
                        help="Sadece istatistik göster")
    args = parser.parse_args()

    conn = sqlite3.connect(str(DB_PATH))

    if args.stats:
        print_stats(conn)
        conn.close()
        sys.exit(0)

    if args.clear:
        deleted = conn.execute(
            "DELETE FROM programs WHERE source = 'seed_db'"
        ).rowcount
        conn.commit()
        print(f"🗑  seed_db kayıtları silindi: {deleted:,}")

    print(f"\n🌍 DAAD Bulk Import — tüm programlar çekiliyor...")
    courses = fetch_all_daad()
    print(f"   Çekilen: {len(courses):,} program\n")

    records = [course_to_record(c) for c in courses]
    print(f"   DB'ye yazılıyor...", end="", flush=True)
    ins, skp = save_records(conn, records)
    print(f" Tamam!\n")
    print(f"   ✅ Eklenen/güncellenen : {ins:,}")
    print(f"   ⏭  Atlanan             : {skp:,}")

    print_stats(conn)
    conn.close()
