"""
database.py — AES Program Veritabanı (SQLite)

Her tarama sonucu programs.db'ye kaydedilir.
Aynı URL 30 gün içinde tekrar istenirse scraping atlanır → token & zaman tasarrufu.
"""
import hashlib
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DB_PATH      = Path(__file__).parent.parent / "programs.db"
CACHE_TTL_DAYS = 30


class ProgramDatabase:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self):
        with self._conn() as conn:
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
            # URL benzersizliği (NULL URL'ler hariç)
            conn.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_prog_url
                ON programs(url) WHERE url IS NOT NULL
            """)

    # ── ID ──────────────────────────────────────────────────────────────────────

    def _make_id(self, url: str = "", university: str = "", program: str = "") -> str:
        key = url or f"{university.lower().strip()}||{program.lower().strip()}"
        return hashlib.md5(key.encode()).hexdigest()[:16]

    # ── Okuma ───────────────────────────────────────────────────────────────────

    def get_by_url(self, url: str, ttl_days: int = CACHE_TTL_DAYS) -> Optional[dict]:
        """URL varsa ve TTL süresi dolmamışsa önbellek kaydını döndür."""
        if not url:
            return None
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM programs WHERE url = ?", (url,)
            ).fetchone()
        if not row:
            return None
        last = datetime.fromisoformat(row["last_scraped"])
        if datetime.now() - last > timedelta(days=ttl_days):
            logger.debug(f"DB cache expired ({ttl_days}g): {url[:60]}")
            return None
        return dict(row)

    def search(
        self,
        *,
        language: str = None,
        degree: str = None,
        field_keywords: list = None,
        ttl_days: int = CACHE_TTL_DAYS,
    ) -> list[dict]:
        """Dil / derece / alan anahtar kelimelerine göre DB'de program ara."""
        cutoff   = (datetime.now() - timedelta(days=ttl_days)).isoformat()
        clauses  = ["last_scraped >= ?"]
        params   = [cutoff]

        if language:
            ll = language.lower()
            if any(x in ll for x in ("ingilizce", "english")):
                clauses.append(
                    "(lower(language) LIKE '%ingilizce%' OR lower(language) LIKE '%english%')"
                )
            elif any(x in ll for x in ("almanca", "german")):
                clauses.append(
                    "(lower(language) LIKE '%almanca%' OR lower(language) LIKE '%german%')"
                )

        if degree:
            clauses.append("lower(degree) LIKE ?")
            params.append(f"%{degree.lower()}%")

        if field_keywords:
            kw_clauses = " OR ".join(["lower(program) LIKE ?" for _ in field_keywords])
            clauses.append(f"({kw_clauses})")
            params.extend(f"%{k.lower()}%" for k in field_keywords)

        sql = (
            "SELECT * FROM programs WHERE " + " AND ".join(clauses)
            + " ORDER BY confidence DESC, university"
        )
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def get_all(self, limit: int = 500, offset: int = 0) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM programs ORDER BY university, program LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_stats(self) -> dict:
        with self._conn() as conn:
            total     = conn.execute("SELECT COUNT(*) FROM programs").fetchone()[0]
            by_lang   = conn.execute(
                "SELECT language, COUNT(*) cnt FROM programs GROUP BY language ORDER BY cnt DESC"
            ).fetchall()
            by_src    = conn.execute(
                "SELECT source, COUNT(*) cnt FROM programs GROUP BY source ORDER BY cnt DESC"
            ).fetchall()
            freshness = conn.execute("""
                SELECT
                    SUM(CASE WHEN last_scraped >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS fresh,
                    SUM(CASE WHEN last_scraped <  datetime('now','-30 days') THEN 1 ELSE 0 END) AS stale
                FROM programs
            """).fetchone()
            top_unis  = conn.execute(
                "SELECT university, COUNT(*) cnt FROM programs GROUP BY university ORDER BY cnt DESC LIMIT 15"
            ).fetchall()
            last_upd  = conn.execute(
                "SELECT MAX(updated_at) FROM programs"
            ).fetchone()[0]
        return {
            "total":        total,
            "fresh":        freshness["fresh"] or 0,
            "stale":        freshness["stale"] or 0,
            "by_language":  [dict(r) for r in by_lang],
            "by_source":    [dict(r) for r in by_src],
            "top_unis":     [dict(r) for r in top_unis],
            "last_updated": last_upd,
        }

    # ── Yazma ───────────────────────────────────────────────────────────────────

    def save_program(self, data: dict) -> None:
        """Programı DB'ye ekle veya güncelle (upsert)."""
        url = data.get("url") or None
        pid = self._make_id(url or "", data.get("university", ""), data.get("program", ""))
        now = datetime.now().isoformat()

        record = {
            "id":                    pid,
            "university":            data.get("university", ""),
            "program":               data.get("program", ""),
            "city":                  data.get("city"),
            "language":              data.get("language"),
            "degree":                data.get("degree"),
            "deadline_wise":         data.get("deadline_wise"),
            "deadline_sose":         data.get("deadline_sose"),
            "german_requirement":    data.get("german_requirement"),
            "english_requirement":   data.get("english_requirement"),
            "nc_value":              data.get("nc_value"),
            "min_gpa":               data.get("min_gpa"),
            "uni_assist":            int(bool(data.get("uni_assist_required") or data.get("uni_assist"))),
            "conditional_admission": int(bool(data.get("conditional_admission"))),
            "url":                   url,
            "source":                data.get("source", ""),
            "confidence":            float(data.get("confidence", 0.5)),
            "last_scraped":          now,
            "updated_at":            now,
        }

        with self._conn() as conn:
            conn.execute("""
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
            """, record)
        logger.debug(f"DB saved: {data.get('university')} — {data.get('program')}")
