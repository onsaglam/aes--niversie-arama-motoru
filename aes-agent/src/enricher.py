"""
enricher.py — 2 Aşamalı DB Zenginleştirici

Aşama 1 (URL Bulma):  URL'si olmayan programlar için üniversitenin
                       resmi program sayfasını veya DAAD sayfasını bul.
Aşama 2 (Detay Kazıma): URL'si olan ama detayları eksik programlar için
                         tam sayfa kazıma + Claude ile veri çıkarma.
"""
import os
import sys
import asyncio
import logging
import time
from pathlib import Path
from datetime import datetime
from typing import Optional, Callable

sys.path.insert(0, str(Path(__file__).parent))

from database import ProgramDatabase
from searcher import search
from scraper  import fetch_page
from parser   import extract_program_data

logger = logging.getLogger(__name__)

# ── Sorgular ────────────────────────────────────────────────────────────────

_STATS_SQL = """
SELECT
    SUM(CASE WHEN url IS NULL OR url = '' THEN 1 ELSE 0 END)              AS needs_stage1,
    SUM(
        CASE WHEN (url IS NOT NULL AND url != '')
              AND (
                   (deadline_wise IS NULL AND deadline_sose IS NULL)
                OR (german_requirement IS NULL AND english_requirement IS NULL
                    AND lower(language) NOT LIKE '%english%'
                    AND lower(language) NOT LIKE '%ingilizce%')
              )
              AND source NOT LIKE '%university_official_site%'
        THEN 1 ELSE 0 END
    )                                                                       AS needs_stage2,
    COUNT(*)                                                                AS total
FROM programs
"""

_STAGE1_SQL = """
SELECT id, university, program, city, language, degree, source
FROM programs
WHERE url IS NULL OR url = ''
ORDER BY confidence DESC, university
LIMIT ?
"""

_STAGE2_SQL = """
SELECT id, university, program, city, language, degree, url, source, confidence
FROM programs
WHERE (url IS NOT NULL AND url != '')
  AND (
       (deadline_wise IS NULL AND deadline_sose IS NULL)
    OR (german_requirement IS NULL AND english_requirement IS NULL
        AND lower(language) NOT LIKE '%english%'
        AND lower(language) NOT LIKE '%ingilizce%')
  )
  AND source NOT LIKE '%university_official_site%'
ORDER BY confidence DESC, university
LIMIT ?
"""

# DAAD URL prefix — bu URL'ler zaten DAAD kaynağı, resmi üniversite sayfası değil
_DAAD_PREFIX = "daad.de/deutschland/studienangebote"


# ── Yardımcı Fonksiyonlar ────────────────────────────────────────────────────

def get_enrichment_stats(db: ProgramDatabase) -> dict:
    """Zenginleştirme ihtiyacı olan program sayısını döndür."""
    with db._conn() as conn:
        row = conn.execute(_STATS_SQL).fetchone()
    return {
        "needs_stage1": row["needs_stage1"] or 0,
        "needs_stage2": row["needs_stage2"] or 0,
        "total":        row["total"] or 0,
    }


def get_stage1_queue(db: ProgramDatabase, batch: int = 20) -> list[dict]:
    with db._conn() as conn:
        rows = conn.execute(_STAGE1_SQL, (batch,)).fetchall()
    return [dict(r) for r in rows]


def get_stage2_queue(db: ProgramDatabase, batch: int = 10) -> list[dict]:
    with db._conn() as conn:
        rows = conn.execute(_STAGE2_SQL, (batch,)).fetchall()
    return [dict(r) for r in rows]


def _update_url(db: ProgramDatabase, program_id: str, url: str) -> None:
    """Programın URL'sini ve source alanını güncelle."""
    now = datetime.now().isoformat()
    with db._conn() as conn:
        conn.execute(
            "UPDATE programs SET url = ?, updated_at = ? WHERE id = ?",
            (url, now, program_id),
        )


def _update_details(db: ProgramDatabase, program_id: str,
                    existing_source: str, detail) -> None:
    """Claude'dan çıkarılan detayları DB'ye yaz (sadece boş alanları doldur)."""
    now = datetime.now().isoformat()

    fields: dict = {}
    if detail.city:                  fields["city"]                  = detail.city
    if detail.deadline_wise:         fields["deadline_wise"]         = detail.deadline_wise
    if detail.deadline_sose:         fields["deadline_sose"]         = detail.deadline_sose
    if detail.german_requirement:    fields["german_requirement"]    = detail.german_requirement
    if detail.english_requirement:   fields["english_requirement"]   = detail.english_requirement
    if detail.nc_value:              fields["nc_value"]              = detail.nc_value
    if detail.min_gpa:               fields["min_gpa"]               = detail.min_gpa
    fields["uni_assist"]             = int(detail.uni_assist_required)
    fields["conditional_admission"]  = int(detail.conditional_admission)
    fields["confidence"]             = round(max(detail.confidence, 0.5), 2)
    fields["last_scraped"]           = now
    fields["updated_at"]             = now

    # source güncelle
    if "university_official_site" not in existing_source:
        fields["source"] = (existing_source + ", university_official_site").lstrip(", ")

    if not fields:
        return

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values     = list(fields.values()) + [program_id]
    with db._conn() as conn:
        conn.execute(f"UPDATE programs SET {set_clause} WHERE id = ?", values)


# ── Stage 1: URL Bulma ───────────────────────────────────────────────────────

def _find_url_for_program(program: dict) -> Optional[str]:
    """
    Tavily ile programın URL'sini bul.
    Öncelik: DAAD sayfası > üniversitenin resmi program sayfası.
    """
    uni    = program.get("university", "")
    prog   = program.get("program", "")
    degree = program.get("degree") or "Master"

    # İnce arama sorguları — en spesifikten en genele
    queries = [
        f'"{uni}" "{prog}" site:daad.de',
        f'"{uni}" {prog} {degree} DAAD',
        f'{uni} {prog} {degree} Bewerbung Zulassung',
    ]

    daad_url_keywords    = ("daad.de", )
    uni_page_keywords    = ("bewerbung", "application", "admission",
                            "zulassung", "studiengang", "programme")

    for query in queries:
        try:
            results = search(query, max_results=5)
            for r in results:
                url = (r.get("url") or "").strip()
                if not url:
                    continue

                # DAAD sayfası — en güvenilir kaynak
                if any(kw in url for kw in daad_url_keywords):
                    logger.info(f"Stage1 DAAD URL: {uni[:40]} → {url[:60]}")
                    return url

                # Üniversitenin resmi sayfası
                title = r.get("title", "").lower()
                if any(kw in url.lower() for kw in uni_page_keywords):
                    uni_key = uni.lower().split()[0][:6]
                    if uni_key in url.lower() or uni_key in title:
                        logger.info(f"Stage1 Uni URL: {uni[:40]} → {url[:60]}")
                        return url

            time.sleep(1.5)  # Tavily rate limit
        except Exception as e:
            logger.warning(f"Stage1 arama hatası ({uni}): {e}")
            continue

    return None


async def run_stage1(
    db: ProgramDatabase,
    batch: int = 20,
    progress_cb: Optional[Callable] = None,
) -> dict:
    """Stage 1: URL bul, DB'ye kaydet."""
    queue  = get_stage1_queue(db, batch)
    found  = 0
    failed = 0

    logger.info(f"Stage 1 başlıyor — {len(queue)} program")

    for i, program in enumerate(queue):
        if progress_cb:
            progress_cb(i + 1, len(queue), program.get("university", ""))

        url = _find_url_for_program(program)
        if url:
            _update_url(db, program["id"], url)
            found += 1
        else:
            failed += 1
            logger.debug(
                f"Stage1 URL yok: {program.get('university')} — {program.get('program')}"
            )

        time.sleep(2)  # Tavily rate limit

    return {"processed": len(queue), "found": found, "failed": failed}


# ── Stage 2: Detay Kazıma ────────────────────────────────────────────────────

async def _enrich_single(program: dict, db: ProgramDatabase) -> bool:
    """
    Tek program için Stage 2:
    URL'yi tara → Claude ile veri çıkar → DB'ye yaz.
    """
    uni  = program.get("university", "")
    prog = program.get("program", "")
    url  = program.get("url", "")
    pid  = program.get("id", "")

    if not url:
        return False

    try:
        html = await fetch_page(url)
        if not html or len(html) < 500:
            logger.warning(f"Stage2 içerik yetersiz: {url[:60]}")
            return False

        detail = extract_program_data(html, uni, prog, url)
        if detail.confidence < 0.35:
            logger.warning(f"Stage2 düşük güven ({detail.confidence:.2f}): {uni}")
            return False

        _update_details(db, pid, program.get("source", ""), detail)
        logger.info(f"Stage2 ✓ {uni[:40]} — {prog[:40]}")
        return True

    except Exception as e:
        logger.error(f"Stage2 hata ({uni[:30]} — {prog[:30]}): {e}")
        return False


async def run_stage2(
    db: ProgramDatabase,
    batch: int = 10,
    progress_cb: Optional[Callable] = None,
) -> dict:
    """Stage 2: Detayları tara, DB'ye kaydet."""
    queue   = get_stage2_queue(db, batch)
    success = 0
    failed  = 0

    logger.info(f"Stage 2 başlıyor — {len(queue)} program")

    for i, program in enumerate(queue):
        if progress_cb:
            progress_cb(i + 1, len(queue), program.get("university", ""))

        ok = await _enrich_single(program, db)
        if ok:
            success += 1
        else:
            failed += 1

        await asyncio.sleep(3)  # Playwright / Claude rate limit

    return {"processed": len(queue), "success": success, "failed": failed}
