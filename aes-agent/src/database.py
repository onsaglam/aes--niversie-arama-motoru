"""
database.py — AES Program Veritabanı (SQLite + Neon Postgres)

Her tarama sonucu programs.db'ye kaydedilir.
DATABASE_URL ortam değişkeni varsa Neon Postgres'e de dual-write yapılır.
Aynı URL 30 gün içinde tekrar istenirse scraping atlanır → token & zaman tasarrufu.
"""
import hashlib
import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DB_PATH        = Path(__file__).parent.parent / "programs.db"
CACHE_TTL_DAYS = 30

# ── Özel / ücretli üniversite kara listesi ──────────────────────────────────
# Bu üniversitelerin programları veritabanına kaydedilmez.
# Kural: yalnızca devlet üniversiteleri (staatliche Hochschulen) kabul edilir.
PRIVATE_UNIVERSITY_BLACKLIST: frozenset[str] = frozenset({
    # Özel üniversiteler (Privatuniversitäten)
    "Constructor University",
    "Bucerius Law School",
    "HHL Leipzig Graduate School of Management",
    "Frankfurt School of Finance & Management",
    "EBS Universität für Wirtschaft und Recht",
    "ESCP Berlin Campus",
    "ESCP Business School",
    "WHU - Otto Beisheim School of Management",
    "Zeppelin University",
    "Witten/Herdecke University",
    "Universität Witten/Herdecke",
    "accadis Hochschule Bad Homburg | University of Applied Sciences",
    "accadis Hochschule Bad Homburg",
    "Berlin International University of Applied Sciences",
    "Hochschule Fresenius - University of Applied Sciences",
    "Hochschule Fresenius",
    "SRH Distance Learning University",
    "SRH University",
    "SRH Hochschule Berlin",
    "SRH Hochschule Hamburg",
    "SRH Hochschule Heidelberg",
    "Dresden International University",
    "Hertie School",
    "Friedensau Adventist University",
    "Catholic University of Eichstätt-Ingolstadt",
    "Katholische Universität Eichstätt-Ingolstadt",
    "Catholic University of Applied Sciences North Rhine-Westphalia",
    "Katholische Hochschule Nordrhein-Westfalen",
    "bbw Hochschule - University of Applied Sciences",
    "bbw Hochschule",
    "University of Applied Management Studies",
    "Hochschule für angewandtes Management",
    "Fachhochschule Wedel University of Applied Sciences",
    "Fachhochschule Wedel",
    "ifs Internationale Filmschule Köln",
    "Bavarian University of Business and Technology (HDBW)",
    "HDBW Hochschule der Bayerischen Wirtschaft",
    "ASH Berlin",
    "Alice Salomon Hochschule Berlin",
    "International School of Management",
    "ISM International School of Management",
    "Macromedia University of Applied Sciences",
    "Hochschule Macromedia",
    "IU International University of Applied Sciences",
    "IU Internationale Hochschule",
    "Diploma Hochschule",
    "AKAD University",
    "EU Business School",
    "Schiller International University",
    "Touro College Berlin",
    "AMD Akademie Mode & Design",
    "Mediadesign Hochschule",
    "Hochschule für Kommunikation und Gestaltung",
    "Steinbeis University Berlin",
    "Steinbeis-Hochschule",
    # Araştırma enstitüleri (üniversite değil)
    "Daad",
    "German Academic Exchange Service (DAAD)",
    "Helmholtz Centre for Environmental Research - UFZ",
    "Helmholtz-Zentrum für Umweltforschung",
    "German Cancer Research Center (DKFZ) Heidelberg",
    "Deutsches Krebsforschungszentrum",
    "Deutsches Elektronen-Synchrotron DESY",
    "The Max Planck Institute for Neurobiology of Behavior – caesar",
    "Helmholtz-Zentrum Dresden-Rossendorf",
    "Max Planck Institute",
    "Fraunhofer Institute",
    "Leibniz Institute",
})


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
            if any(x in ll for x in ("ingilizce", "english", "englisch")):
                clauses.append(
                    "(lower(language) LIKE '%ingilizce%' OR lower(language) LIKE '%english%'"
                    " OR lower(language) LIKE '%englisch%')"
                )
            elif any(x in ll for x in ("almanca", "german", "deutsch")):
                clauses.append(
                    "(lower(language) LIKE '%almanca%' OR lower(language) LIKE '%german%'"
                    " OR lower(language) LIKE '%deutsch%')"
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
        """Programı DB'ye ekle veya güncelle (upsert).

        Özel / ücretli üniversiteler (PRIVATE_UNIVERSITY_BLACKLIST) atlanır.
        """
        university = data.get("university", "").strip()
        if university in PRIVATE_UNIVERSITY_BLACKLIST:
            logger.debug(f"DB skip (private): {university}")
            return
        # Kısmi eşleşme: blacklist anahtar kelimesi üniversite adında geçiyorsa atla
        uni_lower = university.lower()
        _partial_deny = ("srh ", "iubh", "iu internationale", "steinbeis", "macromedia",
                         "diploma hochschule", "akad ", "eu business school",
                         "max planck institute", "fraunhofer institute", "leibniz institute")
        if any(kw in uni_lower for kw in _partial_deny):
            logger.debug(f"DB skip (private/partial): {university}")
            return

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
        # Neon'a da yaz (DATABASE_URL varsa)
        _neon_save_program(record)

    # ── Neon Postgres ────────────────────────────────────────────────────────────

    def vacuum(self):
        """SQLite VACUUM — disk alanını geri kazanır."""
        with self._conn() as conn:
            conn.execute("VACUUM")


# ─── Neon Yardımcı Fonksiyonlar ───────────────────────────────────────────────

def _neon_conn():
    """Neon Postgres bağlantısı döndür. DATABASE_URL yoksa None."""
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        return None
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        return conn
    except Exception as e:
        logger.warning(f"Neon bağlantı hatası: {e}")
        return None


def _neon_save_program(record: dict) -> None:
    """Programı Neon programs tablosuna upsert yap."""
    conn = _neon_conn()
    if conn is None:
        return
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO programs
                (id, university, program, city, language, degree,
                 deadline_wise, deadline_sose,
                 german_requirement, english_requirement,
                 nc_value, min_gpa, uni_assist, conditional_admission,
                 url, source, confidence, last_scraped, updated_at)
            VALUES
                (%(id)s, %(university)s, %(program)s, %(city)s, %(language)s, %(degree)s,
                 %(deadline_wise)s, %(deadline_sose)s,
                 %(german_requirement)s, %(english_requirement)s,
                 %(nc_value)s, %(min_gpa)s, %(uni_assist)s, %(conditional_admission)s,
                 %(url)s, %(source)s, %(confidence)s, %(last_scraped)s, %(updated_at)s)
            ON CONFLICT(id) DO UPDATE SET
                university            = EXCLUDED.university,
                program               = EXCLUDED.program,
                city                  = EXCLUDED.city,
                language              = EXCLUDED.language,
                degree                = EXCLUDED.degree,
                deadline_wise         = EXCLUDED.deadline_wise,
                deadline_sose         = EXCLUDED.deadline_sose,
                german_requirement    = EXCLUDED.german_requirement,
                english_requirement   = EXCLUDED.english_requirement,
                nc_value              = EXCLUDED.nc_value,
                min_gpa               = EXCLUDED.min_gpa,
                uni_assist            = EXCLUDED.uni_assist,
                conditional_admission = EXCLUDED.conditional_admission,
                url                   = EXCLUDED.url,
                source                = EXCLUDED.source,
                confidence            = EXCLUDED.confidence,
                last_scraped          = EXCLUDED.last_scraped,
                updated_at            = EXCLUDED.updated_at
        """, record)
        logger.debug(f"Neon saved: {record.get('university')} — {record.get('program')}")
    except Exception as e:
        logger.warning(f"Neon program kayıt hatası: {e}")
    finally:
        conn.close()


def neon_set_running(student_name: str) -> None:
    """Öğrenci için is_running=1 kaydı oluştur/güncelle (agent başladığında çağrılır)."""
    conn = _neon_conn()
    if conn is None:
        return
    now = datetime.now().isoformat() + "Z"
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO student_results (student_name, run_at, results, is_running)
            VALUES (%s, %s, %s::jsonb, 1)
            ON CONFLICT DO NOTHING
        """, (student_name, now, "[]"))
        # Varolan en son kaydı running olarak işaretle
        cur.execute("""
            UPDATE student_results
            SET is_running = 1, run_at = %s
            WHERE id = (
                SELECT id FROM student_results
                WHERE student_name = %s
                ORDER BY id DESC LIMIT 1
            )
        """, (now, student_name))
    except Exception as e:
        logger.warning(f"Neon set_running hatası ({student_name}): {e}")
    finally:
        conn.close()


def neon_save_results(student_name: str, results: list) -> None:
    """Araştırma sonuçlarını Neon student_results tablosuna kaydet."""
    conn = _neon_conn()
    if conn is None:
        return
    now = datetime.now().isoformat() + "Z"
    results_json = json.dumps(results, ensure_ascii=False)
    try:
        cur = conn.cursor()
        # Varolan running kaydını güncelle; yoksa yeni ekle
        cur.execute("""
            UPDATE student_results
            SET results = %s::jsonb, is_running = 0, run_at = %s
            WHERE id = (
                SELECT id FROM student_results
                WHERE student_name = %s
                ORDER BY id DESC LIMIT 1
            )
        """, (results_json, now, student_name))
        if cur.rowcount == 0:
            cur.execute("""
                INSERT INTO student_results (student_name, run_at, results, is_running)
                VALUES (%s, %s, %s::jsonb, 0)
            """, (student_name, now, results_json))
        logger.info(f"Neon student_results kaydedildi: {student_name} ({len(results)} program)")
    except Exception as e:
        logger.warning(f"Neon save_results hatası ({student_name}): {e}")
    finally:
        conn.close()


def neon_clear_running(student_name: str) -> None:
    """is_running bayrağını temizle (agent tamamlandığında / hata durumunda)."""
    conn = _neon_conn()
    if conn is None:
        return
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE student_results
            SET is_running = 0
            WHERE student_name = %s AND is_running = 1
        """, (student_name,))
    except Exception as e:
        logger.warning(f"Neon clear_running hatası ({student_name}): {e}")
    finally:
        conn.close()
