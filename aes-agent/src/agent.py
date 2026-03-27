"""
agent.py — AES Üniversite Araştırma Ajanı — Ana orkestratör.

Kullanım:
  python src/agent.py --student "AhmetYilmaz"
  python src/agent.py --all
  python src/agent.py --student "AhmetYilmaz" --quick
  python src/agent.py --test
  python src/agent.py --template
"""
import os
import sys
import json
import asyncio
import argparse
import logging
import httpx
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn
from rich.table import Table
from rich import box

load_dotenv()

sys.path.insert(0, str(Path(__file__).parent))

from reader   import read_profile, create_template
from searcher import search
from scraper  import fetch_page
from parser   import extract_program_data, extract_from_pdf, evaluate_eligibility, ProgramDetail
from reporter import generate_word_report, generate_excel_report
from database import ProgramDatabase

console     = Console()
STUDENTS_DIR  = Path("ogrenciler")
TEMPLATES_DIR = Path("templates")

# ─── Logging ─────────────────────────────────────────────────────────────────

def setup_logging(student_name: str = "general"):
    log_dir = Path("logs") / datetime.now().strftime("%Y-%m-%d")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{student_name}.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )


# ─── Env Validasyonu ─────────────────────────────────────────────────────────

REQUIRED_ENV = {
    "ANTHROPIC_API_KEY": "Anthropic Claude API erişimi için zorunlu",
    "TAVILY_API_KEY":    "Web araması için zorunlu",
}
OPTIONAL_ENV = {
    "SCRAPER_API_KEY":  "Anti-bot bypass için önerilir (5.000 ücretsiz/ay)",
    "SERPER_API_KEY":   "Tavily yedeği arama motoru",
}


def validate_env() -> bool:
    """Uygulama başlamadan önce tüm gerekli env değişkenlerini kontrol et."""
    errors = []
    for var, desc in REQUIRED_ENV.items():
        val = os.getenv(var, "")
        if not val or "BURAYA_YAZ" in val or len(val) < 10:
            errors.append(f"  ✗ {var}: {desc}")

    if errors:
        console.print("[red]❌ Eksik API anahtarları (.env dosyasını kontrol et):[/red]")
        for e in errors:
            console.print(f"[red]{e}[/red]")
        return False

    for var, desc in OPTIONAL_ENV.items():
        val = os.getenv(var, "")
        if not val or "BURAYA_YAZ" in val:
            console.print(f"[yellow]⚠️  {var} eksik — {desc}[/yellow]")

    return True


# ─── Rate Limit Tracker ───────────────────────────────────────────────────────

class RateLimitTracker:
    """API servislerinin günlük kullanımını takip eder."""

    DAILY_LIMITS = {
        "tavily":     33,    # 1000/ay ÷ 30 gün
        "serper":     83,    # 2500/ay ÷ 30 gün
        "scraperapi": 166,   # 5000/ay ÷ 30 gün
        "anthropic":  999,   # Pratik olarak sınırsız, maliyet için
    }

    def __init__(self):
        self._counts: dict[str, list] = defaultdict(list)

    def _clean(self, service: str):
        cutoff = datetime.now() - timedelta(hours=24)
        self._counts[service] = [t for t in self._counts[service] if t > cutoff]

    def can_use(self, service: str) -> bool:
        self._clean(service)
        return len(self._counts[service]) < self.DAILY_LIMITS.get(service, 100)

    def record(self, service: str):
        self._counts[service].append(datetime.now())

    def remaining(self, service: str) -> int:
        self._clean(service)
        limit = self.DAILY_LIMITS.get(service, 100)
        return limit - len(self._counts[service])

    def status(self) -> dict:
        return {s: self.remaining(s) for s in self.DAILY_LIMITS}


rate_tracker = RateLimitTracker()
db           = ProgramDatabase()          # Program veritabanı (programs.db)

# ─── Modül seviyesi sabitler ──────────────────────────────────────────────────

API_SLEEP_SECONDS = int(os.getenv("ANTHROPIC_CALL_SLEEP", "12"))

# Modulhandbuch aramasında reddedilecek URL kalıpları
_MH_BAD_URL_PARTS = frozenset({
    "presentation", "forschungsbericht", "research-report",
    "jahresbericht", "bericht", "vorlage", "template",
    "flyer", "poster", "handout", "vorlesung", "lecture",
})

# Üniversite adından anahtar kelime çıkarırken atlanan anlamsız kelimeler
_UNI_STOP_WORDS = frozenset({
    "university", "of", "for", "and", "the", "applied", "sciences",
    "technology", "technical", "hochschule", "universität", "fachhochschule",
    "von", "zu", "in", "für", "mit",
})


def _uni_keywords(university: str) -> list[str]:
    """Üniversite adından tanımlayıcı anahtar kelimeleri çıkar."""
    return [
        w.strip(".-(),").lower() for w in university.split()
        if len(w.strip(".-(),")) >= 4
        and w.strip(".-(),").lower() not in _UNI_STOP_WORDS
    ]


# _extract_uni_url_from_daad için sabitler
_DAAD_EXCLUDE_DOMAINS = frozenset({"daad.de", "uni-assist.de", "hochschulstart.de", "anabin.kmk.org"})
_DAAD_EXCLUDE_PATHS   = frozenset({"stipendien", "scholarship", "modulhandbuch", "impress",
                                    "datenschutz", "kontakt", "contact", "sitemap", "news",
                                    "event", "career", "jobs", "library", "bibliothek",
                                    "sport", "mensa", "wohnen"})
_DAAD_APPLY_URL_KEYS  = ("bewerbung", "bewerben", "admission", "apply", "application",
                          "zulassung", "einschreibung", "enrolment", "enrollment",
                          "studiengang", "master", "bachelor", "degree")
_DAAD_APPLY_TEXT_KEYS = ("zur hochschule", "to the university", "university website",
                          "official website", "programme website", "hochschule besuchen",
                          "website der hochschule", "programme details", "more information",
                          "weitere informationen", "zur programme", "program website")

# Uygunluk durumları için görüntüleme haritaları
_ELIGIBILITY_STYLE = {"uygun": "green", "sartli": "yellow", "uygun_degil": "red",
                      "veri_yok": "dim", "taranmadi": "dim"}
_ELIGIBILITY_LABEL = {"uygun": "✅ Uygun", "sartli": "⚠️ Şartlı", "uygun_degil": "❌ Değil",
                      "veri_yok": "❓ Veri Yok", "taranmadi": "⏭ Taranmadı"}
_ELIGIBILITY_ORDER = {"uygun": 0, "sartli": 1, "uygun_degil": 2, "veri_yok": 3, "taranmadi": 4}


# ─── Özel Üniversite Filtresi ─────────────────────────────────────────────────
# Almanya'daki özel (private) üniversiteler — AES SADECE devlet üniversitelerini araştırır.
# Kaynak: HRK (Hochschulrektorenkonferenz) özel üniversite listesi

_PRIVATE_UNIVERSITIES: frozenset[str] = frozenset({
    # Uluslararası tanınan özel üniversiteler
    "jacobs", "constructor", "bucerius", "hertie", "escp", "esmt",
    "ebs", "whu", "hhl", "ism international", "munich business school",
    "frankfurt school", "frankfurt school of finance",
    # SRH Grubu
    "srh", "srh hochschule", "srh berlin", "srh heidelberg",
    "srh fernhochschule", "mobile university",
    # IU Grubu
    "iu international", "iu internationale", "iu fernstudium",
    # Fresenius / Hochschule Fresenius
    "fresenius", "hochschule fresenius",
    # Diğer büyük özel üniversiteler
    "steinbeis", "macromedia", "code university", "bsp business",
    "quadriga", "touro", "msb medical", "medical school berlin",
    "euro-fh", "fernakademie", "akad", "iubh", "fom hochschule",
    "hamburger fern", "wings", "apollon", "diploma hochschule",
    "allensbach", "sgd", "fernschule",
    # Özel Fachhochschule'ler
    "international school of management", "university of europe",
    "europe university of applied sciences", "eu business",
    "new european college", "bwl hochschule", "pfh private",
    "nordakademie", "ba sachsen", "berufsakademie sachsen",
    "hfwu nürtingen",  # yarı-özel
})


def _is_private_university(university_name: str) -> bool:
    """Üniversitenin özel (private) olup olmadığını kontrol et."""
    name_lower = university_name.lower()
    return any(keyword in name_lower for keyword in _PRIVATE_UNIVERSITIES)


# Alan adından üniversite adına eşleme (heuristik domain→ad dönüşümünü iyileştirir)
_DOMAIN_TO_UNI: dict[str, str] = {
    "tum.de":               "TU München",
    "tu-berlin.de":         "TU Berlin",
    "tu-dresden.de":        "TU Dresden",
    "rwth-aachen.de":       "RWTH Aachen",
    "kit.edu":              "KIT Karlsruhe",
    "tu-darmstadt.de":      "TU Darmstadt",
    "uni-stuttgart.de":     "Universität Stuttgart",
    "uni-hannover.de":      "Leibniz Universität Hannover",
    "tu-braunschweig.de":   "TU Braunschweig",
    "lmu.de":               "LMU München",
    "uni-heidelberg.de":    "Universität Heidelberg",
    "fu-berlin.de":         "FU Berlin",
    "hu-berlin.de":         "HU Berlin",
    "uni-hamburg.de":       "Universität Hamburg",
    "uni-frankfurt.de":     "Goethe-Universität Frankfurt",
    "uni-koeln.de":         "Universität Köln",
    "uni-bonn.de":          "Universität Bonn",
    "uni-muenster.de":      "Universität Münster",
    "uni-goettingen.de":    "Universität Göttingen",
    "uni-freiburg.de":      "Universität Freiburg",
    "uni-tuebingen.de":     "Universität Tübingen",
    "uni-wuerzburg.de":     "Universität Würzburg",
    "uni-mainz.de":         "JGU Mainz",
    "uni-mannheim.de":      "Universität Mannheim",
    "fau.de":               "FAU Erlangen-Nürnberg",
    "uni-bremen.de":        "Universität Bremen",
    "hs-bremen.de":         "Hochschule Bremen",
    "uni-kiel.de":          "CAU Kiel",
    "uni-rostock.de":       "Universität Rostock",
    "uni-greifswald.de":    "Universität Greifswald",
    "uni-jena.de":          "Friedrich-Schiller-Universität Jena",
    "uni-halle.de":         "MLU Halle-Wittenberg",
    "uni-leipzig.de":       "Universität Leipzig",
    "uni-due.de":           "Universität Duisburg-Essen",
    "rub.de":               "Ruhr-Universität Bochum",
    "tu-dortmund.de":       "TU Dortmund",
    "uni-bielefeld.de":     "Universität Bielefeld",
    "uni-paderborn.de":     "Universität Paderborn",
    "uni-siegen.de":        "Universität Siegen",
    "uni-giessen.de":       "JLU Gießen",
    "uni-marburg.de":       "Philipps-Universität Marburg",
    "uni-kassel.de":        "Universität Kassel",
    "tu-kaiserslautern.de": "RPTU Kaiserslautern",
    "uni-saarland.de":      "Universität des Saarlandes",
    "uni-bayreuth.de":      "Universität Bayreuth",
    "uni-augsburg.de":      "Universität Augsburg",
    "uni-regensburg.de":    "Universität Regensburg",
    "uni-passau.de":        "Universität Passau",
    "uni-ulm.de":           "Universität Ulm",
    "uni-konstanz.de":      "Universität Konstanz",
    "uni-hohenheim.de":     "Universität Hohenheim",
    "uni-koblenz.de":       "Universität Koblenz",
    "uni-trier.de":         "Universität Trier",
}


def _domain_to_university(url: str) -> str:
    """URL'den üniversite adını çıkar — önce lookup tablosuna bak, sonra heuristik uygula."""
    domain = url.split("/")[2] if "//" in url else url
    domain = domain.replace("www.", "").lower()
    # Tam eşleşme
    if domain in _DOMAIN_TO_UNI:
        return _DOMAIN_TO_UNI[domain]
    # Kısmi eşleşme (subdomain için)
    for key, val in _DOMAIN_TO_UNI.items():
        if domain.endswith("." + key) or domain == key:
            return val
    # Fallback heuristik
    name = domain.replace(".de", "").replace(".edu", "")
    name = name.replace("uni-", "Uni ").replace("tu-", "TU ").replace("fh-", "FH ").replace("hs-", "HS ")
    return name.title()


# ─── DAAD API Araması ─────────────────────────────────────────────────────────

async def search_programs_daad(profile) -> list[ProgramDetail]:
    """DAAD API ile program ara. (Yeni format: courses[] yapısı)

    Strateji:
      1. Önce derece filtresi ile ara (preparationForDegree + degree numeric)
      2. Sonuç çok azsa (< 3) filtresiz ara, derece client-side filtrele
    """
    import re as _re

    # DAAD API hem string hem numeric derece parametresi kabul edebilir
    _DEGREE_STRING = {"Master": "Master", "Bachelor": "Bachelor", "PhD": "PhD"}
    _DEGREE_NUMERIC = {"Master": "2", "Bachelor": "1", "PhD": "4", "Ausbildung": "3"}
    _LANG_FILTER = {"İngilizce": "English", "Almanca": "German"}

    url      = "https://www2.daad.de/deutschland/studienangebote/international-programmes/api/solr/en/search.json"
    base_url = "https://www2.daad.de"
    preferred_lang = _LANG_FILTER.get(profile.program_language, "")

    def _parse_courses(courses: list, apply_degree_filter: bool) -> list[ProgramDetail]:
        """courses listesinden ProgramDetail listesi üret."""
        progs: list[ProgramDetail] = []
        target_degree = _DEGREE_STRING.get(profile.degree_type, "").lower()

        for item in courses[:60]:
            langs    = item.get("languages") or []
            uni_name = item.get("academy", "")

            if _is_private_university(uni_name):
                logging.info(f"Özel üniversite atlandı: {uni_name}")
                continue

            # Client-side derece filtresi (filtresiz sorgu için)
            if apply_degree_filter and target_degree:
                item_deg = (item.get("preparationForDegree") or "").lower()
                if item_deg and target_degree not in item_deg:
                    continue

            # Dil filtresi
            if preferred_lang and preferred_lang not in langs:
                continue

            deadline_raw  = item.get("applicationDeadline") or ""
            deadline_text = _re.sub(r"<[^>]+>", " ", deadline_raw).strip()[:200]

            link = item.get("link", "")
            if link and not link.startswith("http"):
                link = base_url + link

            prog = ProgramDetail(
                university = uni_name,
                city       = item.get("city", ""),
                program    = item.get("courseName", ""),
                degree     = item.get("preparationForDegree", profile.degree_type),
                language   = ", ".join(langs),
                url        = link,
                notes      = deadline_text,
                sources    = ["daad_api"],
                confidence = 0.7,
            )
            if prog.university:
                progs.append(prog)
        return progs

    async def _daad_query(extra_params: dict) -> list:
        """DAAD API'ye istek at, courses listesini döndür."""
        base_params = {
            "q":    profile.desired_field,
            "rows": "60",
        }
        base_params.update(extra_params)
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "Mozilla/5.0"}) as client:
            resp = await client.get(url, params=base_params)
            resp.raise_for_status()
            return resp.json().get("courses", [])

    console.print("   🔍 DAAD API taranıyor...", style="dim")
    results: list[ProgramDetail] = []

    try:
        # — Deneme 1: Hem string hem numeric derece filtresi ile ara —
        deg_str = _DEGREE_STRING.get(profile.degree_type, "Master")
        deg_num = _DEGREE_NUMERIC.get(profile.degree_type, "2")
        courses = await _daad_query({
            "preparationForDegree": deg_str,
            "degree": deg_num,
        })
        results = _parse_courses(courses, apply_degree_filter=False)

        # — Deneme 2: Filtresiz geniş arama (yedek) —
        if len(results) < 4:
            logging.info(f"DAAD derece filtresi az sonuç ({len(results)}), filtresiz deneniyor...")
            courses_broad = await _daad_query({})
            broad_results = _parse_courses(courses_broad, apply_degree_filter=True)
            # Mevcut sonuçlarla birleştir (duplikat olmadan)
            existing_keys = {(p.university.lower(), p.program.lower()[:40]) for p in results}
            for p in broad_results:
                k = (p.university.lower(), p.program.lower()[:40])
                if k not in existing_keys:
                    results.append(p)
                    existing_keys.add(k)

        console.print(f"   ✅ DAAD'dan {len(results)} program bulundu", style="green")

    except Exception as e:
        console.print(f"   ⚠️  DAAD API hatası: {e}", style="yellow")
        logging.warning(f"DAAD API hatası: {e}")

    return results


# ─── hochschulstart.de Araması ───────────────────────────────────────────────

async def search_programs_hochschulstart(profile) -> list[ProgramDetail]:
    """
    hochschulstart.de / stiftung-hochschulzulassung.de ve benzeri NC veritabanlarından
    ek program listesi çek.
    """
    if not rate_tracker.can_use("tavily"):
        return []

    results  = []
    query = (
        f'{profile.desired_field} {profile.degree_type} '
        f'Numerus Clausus NC-Wert Deutschland Zulassung '
        f'site:hochschulstart.de OR site:stiftung-hochschulzulassung.de OR site:nc-werte.de'
    )
    try:
        hits = search(query, max_results=6)
        rate_tracker.record("tavily")
        for hit in hits:
            url = hit.get("url", "")
            if not url:
                continue
            prog = ProgramDetail(
                program    = hit.get("title", ""),
                url        = url,
                notes      = hit.get("content", "")[:200],
                sources    = ["hochschulstart"],
                confidence = 0.5,
            )
            results.append(prog)
        console.print(f"   ✅ hochschulstart'tan {len(results)} sonuç", style="green")
    except Exception as e:
        logging.warning(f"hochschulstart arama hatası: {e}")

    return results


# ─── Web Araması ile Program Bulma ───────────────────────────────────────────

async def search_programs_web(profile) -> list[ProgramDetail]:
    """Tavily/Serper ile ek program araması."""
    results = []
    console.print("   🌐 Web araması yapılıyor...", style="dim")

    queries = [
        f'"{profile.desired_field}" {profile.degree_type} Germany university admission requirements',
        f'{profile.desired_field} Studium Deutschland Bewerbung Sprachkenntnisse {profile.degree_type}',
    ]
    if profile.preferred_cities and "fark etmez" not in [c.lower() for c in profile.preferred_cities]:
        city = profile.preferred_cities[0]
        queries.append(f'"{profile.desired_field}" {profile.degree_type} {city} Universität Zulassung')

    seen_urls: set[str] = set()
    for query in queries:
        if not rate_tracker.can_use("tavily") and not rate_tracker.can_use("serper"):
            console.print("   ⚠️  Günlük arama limiti doldu, web araması atlandı", style="yellow")
            break
        try:
            hits = search(query, max_results=8)
            rate_tracker.record("tavily")
            for hit in hits:
                url = hit.get("url", "")
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                # Sadece üniversite sitelerini al
                if any(x in url for x in [".de/", "uni-", "tu-", "fh-", "hs-", "hochschule"]):
                    prog = ProgramDetail(
                        university = _domain_to_university(url),
                        program    = hit.get("title", ""),
                        url        = url,
                        notes      = hit.get("content", "")[:300],
                        sources    = ["web_search"],
                        confidence = 0.4,
                    )
                    results.append(prog)
        except Exception as e:
            console.print(f"   ⚠️  Arama hatası: {e}", style="yellow")

    console.print(f"   ✅ Web aramasından {len(results)} sonuç", style="green")
    return results


# ─── Program Sayfası & Modulhandbuch Arama ───────────────────────────────────

async def find_program_page(university: str, program: str) -> str:
    """
    Tavily ile üniversitenin programına ait asıl başvuru sayfasını bul.
    DAAD linkine bağımlı değil — Google'dan bulur.
    """
    if not rate_tracker.can_use("tavily"):
        return ""

    queries = [
        f'"{university}" "{program}" Bewerbung Zulassung Aufnahmevoraussetzungen',
        f'"{university}" "{program}" admission requirements application',
    ]

    for query in queries:
        if not rate_tracker.can_use("tavily"):
            break
        try:
            results = search(query, max_results=6)
            rate_tracker.record("tavily")

            best_url     = ""
            fallback_url = ""
            for r in results:
                url = r.get("url", "")
                if not url or "daad.de" in url:
                    continue
                url_l = url.lower()
                if not best_url and any(k in url_l for k in _DAAD_APPLY_URL_KEYS):
                    best_url = url
                    break  # priority-1 bulundu, daha fazla bakmaya gerek yok
                if not fallback_url and (".de/" in url or url.endswith(".de")):
                    fallback_url = url

            target = best_url or fallback_url
            if target:
                tag = "bulundu" if best_url else "(fallback)"
                logging.info(f"Program sayfası {tag}: {university} → {target[:80]}")
                return target

        except Exception as e:
            logging.warning(f"Program sayfası arama hatası ({university}): {e}")

    return ""


async def find_modulhandbuch(university: str, program: str) -> str:
    """Tavily ile Modulhandbuch PDF URL'sini bul. Üniversite doğrulaması yapar."""
    if not rate_tracker.can_use("tavily"):
        return ""

    keywords = _uni_keywords(university)

    queries = [
        f'"{university}" "{program}" Modulhandbuch filetype:pdf',
        f'"{university}" "{program}" module handbook PDF Zulassung',
    ]

    for query in queries:
        if not rate_tracker.can_use("tavily"):
            break
        try:
            results = search(query, max_results=5)
            rate_tracker.record("tavily")
            for r in results:
                url   = r.get("url", "")
                url_l = url.lower()

                if not (url_l.endswith(".pdf") or "modulhandbuch" in url_l
                        or "module-handbook" in url_l or "modulehandbook" in url_l):
                    continue

                if any(bad in url_l for bad in _MH_BAD_URL_PARTS):
                    logging.debug(f"Modulhandbuch dışlandı (kötü kalıp): {url[:60]}")
                    continue

                if keywords:
                    title_l   = r.get("title", "").lower()
                    content_l = r.get("content", "").lower()
                    if not any(kw in url_l or kw in title_l or kw in content_l
                               for kw in keywords):
                        logging.debug(f"Modulhandbuch dışlandı (üniversite eşleşmedi): {url[:60]}")
                        continue

                return url
        except Exception as e:
            logging.warning(f"Modulhandbuch arama hatası ({university}): {e}")

    return ""


async def _download_pdf(url: str) -> bytes:
    """PDF dosyasını indir."""
    try:
        async with httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; AES-Bot/1.0)"},
        ) as client:
            r = await client.get(url)
            if r.status_code == 200 and len(r.content) > 500:
                return r.content
    except Exception as e:
        logging.warning(f"PDF indirme hatası ({url[:60]}): {e}")
    return b""


def _merge_pdf_data(prog: ProgramDetail, data: dict):
    """PDF'ten gelen veriyi eksik alanlara ekle — mevcut veriyi ezmez."""
    for k, v in data.items():
        if v is None or v == "" or v == [] or str(v).lower() == "null":
            continue
        existing = getattr(prog, k, None)
        if existing:  # Dolu alan varsa dokunma
            continue
        if hasattr(prog, k):
            if k == "min_gpa":
                try:
                    prog.min_gpa = float(str(v).replace(",", "."))
                except (ValueError, TypeError):
                    pass
            elif k == "required_documents" and isinstance(v, list):
                prog.required_documents.extend(v)
            else:
                setattr(prog, k, v)
    if "modulhandbuch_pdf" not in prog.sources:
        prog.sources.append("modulhandbuch_pdf")


# ─── DB Yardımcı Fonksiyonları ────────────────────────────────────────────────

def _apply_db_cache(prog: ProgramDetail, cached: dict) -> None:
    """DB cache'inden gelen veriyi ProgramDetail'e uygula."""
    for db_field, prog_field in (
        ("city",                  "city"),
        ("language",              "language"),
        ("deadline_wise",         "deadline_wise"),
        ("deadline_sose",         "deadline_sose"),
        ("german_requirement",    "german_requirement"),
        ("english_requirement",   "english_requirement"),
        ("nc_value",              "nc_value"),
        ("min_gpa",               "min_gpa"),
        ("conditional_admission", "conditional_admission"),
    ):
        val = cached.get(db_field)
        if val is not None and val != "":
            setattr(prog, prog_field, bool(val) if db_field == "conditional_admission" else val)
    if cached.get("uni_assist"):
        prog.uni_assist_required = True
    prog.confidence = cached.get("confidence", 0.5)
    if "db_cache" not in prog.sources:
        prog.sources.append("db_cache")


def _prog_to_db_dict(prog: ProgramDetail) -> dict:
    """ProgramDetail → DB kaydetmek için dict."""
    return {
        "university":          prog.university,
        "program":             prog.program,
        "city":                prog.city,
        "language":            prog.language,
        "degree":              prog.degree,
        "url":                 prog.url or None,
        "deadline_wise":       prog.deadline_wise,
        "deadline_sose":       prog.deadline_sose,
        "german_requirement":  prog.german_requirement,
        "english_requirement": prog.english_requirement,
        "nc_value":            prog.nc_value,
        "min_gpa":             prog.min_gpa,
        "uni_assist_required": prog.uni_assist_required,
        "conditional_admission": prog.conditional_admission,
        "source":              ", ".join(prog.sources[:4]),
        "confidence":          prog.confidence,
    }


# ─── Detay Sayfası Zenginleştirme ────────────────────────────────────────────

def _extract_uni_url_from_daad(html: str) -> str:
    """
    DAAD detay sayfasından üniversitenin kendi başvuru/program URL'sini çıkar.

    Öncelik sırası:
      1. Metni "university/hochschule" içeren dış linkler
      2. URL'si başvuru kelimesi içeren dış linkler (bewerbung, admission, apply)
      3. Diğer üniversite dış linkleri
    Dışlananlar: daad.de, uni-assist.de, stipendien, modulhandbuecher,
                 scholarship, impressum, datenschutz, kontakt
    """
    def is_excluded(href: str) -> bool:
        href_lower = href.lower()
        if any(d in href_lower for d in _DAAD_EXCLUDE_DOMAINS):
            return True
        return any(p in href_lower for p in _DAAD_EXCLUDE_PATHS)

    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        import re
        matches = re.findall(r'href=["\']?(https?://[^"\'>\s]+\.de[^"\'>\s]*)["\']?', html)
        for m in matches:
            if not is_excluded(m) and any(k in m.lower() for k in _DAAD_APPLY_URL_KEYS):
                return m
        return ""

    candidates: list[tuple[int, str]] = []  # (öncelik, href)

    for a in soup.find_all("a", href=True):
        href = a.get("href", "").strip()
        if not href.startswith("http") or is_excluded(href):
            continue

        text = a.get_text(" ", strip=True).lower()
        href_l = href.lower()

        if any(t in text for t in _DAAD_APPLY_TEXT_KEYS):
            candidates.append((1, href))
        elif any(k in href_l for k in _DAAD_APPLY_URL_KEYS):
            candidates.append((2, href))
        elif any(x in href_l for x in ["uni-", "tu-", "fh-", "hs-", "hochschule", "university"]):
            candidates.append((3, href))

    if not candidates:
        return ""

    # En düşük öncelik numarası = en iyi
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


async def enrich_program(prog: ProgramDetail, profile) -> ProgramDetail:
    """
    Program zenginleştirme — önce DB cache kontrol eder, scraping'i atlar.

      DB cache hit  → anında döner (token & zaman tasarrufu)
      DB cache miss → 3 adımlı scraping:
        Adım 1 — Tavily ile asıl başvuru sayfasını bul
        Adım 2 — Sayfayı scrape et, Claude ile başvuru verisi çıkar
        Adım 3 — Modulhandbuch PDF'ini ara, indir ve Claude ile oku
      Scraping sonrası → DB'ye kaydet
    """
    if not prog.university:
        # Üniversite adı bilinmiyor — değerlendirme yapılamaz
        prog.eligibility        = "veri_yok"
        prog.eligibility_reason = "Üniversite adı bilinmiyor — kaynak sadece referans"
        return prog

    # ── DB cache kontrolü ─────────────────────────────────────────────
    if prog.url:
        cached = db.get_by_url(prog.url)
        if cached:
            console.print(
                f"   💾 DB cache: {prog.university[:30]} — {prog.program[:25]}",
                style="dim",
            )
            _apply_db_cache(prog, cached)
            return evaluate_eligibility(profile, prog)

    # ── Adım 1: Tavily ile asıl program sayfasını bul ───────────────
    target_url = await find_program_page(prog.university, prog.program)

    if not target_url:
        # Fallback A: DAAD sayfasından üniversite linki çek
        if prog.url and "daad.de" in prog.url:
            try:
                daad_html, _ = await fetch_page(prog.url)
                if "uni-assist.de" in daad_html:
                    prog.uni_assist_required = True
                target_url = _extract_uni_url_from_daad(daad_html)
                if not target_url:
                    # Fallback B: DAAD sayfasının kendisini kullan
                    target_url = prog.url
                    logging.warning(f"Üniversite URL bulunamadı, DAAD sayfası kullanılıyor: {prog.university}")
            except Exception as e:
                target_url = prog.url
                logging.warning(f"DAAD fallback hatası ({prog.university}): {e}")
        else:
            target_url = prog.url or ""

    # ── Adım 2: Hedef sayfayı scrape et ─────────────────────────────
    if target_url:
        # PDF URL'si ise HTML parse etmeye çalışma
        is_pdf_url = target_url.lower().endswith(".pdf")
        try:
            html, level = await fetch_page(target_url)
            if not is_pdf_url:
                old_sources = list(prog.sources)
                prog = extract_program_data(html, prog.university, prog.program, target_url)
                for s in old_sources:
                    if s not in prog.sources:
                        prog.sources.append(s)
                rate_tracker.record("anthropic")
                if level != "cache":
                    prog.sources.append(f"scraped_{level}")
                # Anthropic token rate limit (30K/min) koruması — cache olsa bile bekle
                await asyncio.sleep(API_SLEEP_SECONDS)
        except Exception as e:
            prog.notes = f"Sayfa çekilemedi: {str(e)[:100]}"
            logging.warning(f"Scrape hatası ({prog.university}): {e}")

    # ── Adım 3: Modulhandbuch PDF ara, indir ve oku ──────────────────
    if rate_tracker.can_use("tavily") and rate_tracker.can_use("anthropic"):
        mh_url = await find_modulhandbuch(prog.university, prog.program)
        if mh_url:
            logging.info(f"Modulhandbuch bulundu: {prog.university} → {mh_url[:80]}")
            pdf_bytes = await _download_pdf(mh_url)
            if pdf_bytes:
                pdf_data = extract_from_pdf(pdf_bytes, prog.university, prog.program)
                rate_tracker.record("anthropic")
                await asyncio.sleep(API_SLEEP_SECONDS)
                if pdf_data:
                    _merge_pdf_data(prog, pdf_data)

    result = evaluate_eligibility(profile, prog)

    # Veri çıkarma tamamen başarısız olduysa — "uygun" gösterme, "veri_yok" işaretle
    if result.confidence <= 0.2 and target_url:
        result.eligibility        = "veri_yok"
        result.eligibility_reason = "Sayfa tarandı fakat başvuru bilgileri çıkarılamadı"

    # ── DB'ye kaydet (yeterli veri varsa) ────────────────────────────
    if result.confidence > 0.3 and result.university:
        try:
            db.save_program(_prog_to_db_dict(result))
        except Exception as e:
            logging.debug(f"DB kayıt hatası ({result.university}): {e}")

    return result


# ─── Tekrarsız Birleştirme ───────────────────────────────────────────────────

def merge_programs(lists: list[list]) -> list[ProgramDetail]:
    seen: set[tuple] = set()
    merged = []
    for lst in lists:
        for p in lst:
            key = (p.university.lower().strip(), p.program.lower().strip()[:40])
            if key not in seen and p.university:
                seen.add(key)
                merged.append(p)
    return merged


# ─── Terminal Özet Tablosu ────────────────────────────────────────────────────

def print_summary(programs: list[ProgramDetail], profile):
    table = Table(title=f"Sonuçlar — {profile.name}", box=box.ROUNDED)
    table.add_column("Üniversite",  style="bold", max_width=28)
    table.add_column("Program",     max_width=30)
    table.add_column("Şehir",       max_width=14)
    table.add_column("Dil",         max_width=12)
    table.add_column("Uygunluk")

    for p in sorted(programs, key=lambda x: _ELIGIBILITY_ORDER.get(x.eligibility, 3)):
        style = _ELIGIBILITY_STYLE.get(p.eligibility, "white")
        label = _ELIGIBILITY_LABEL.get(p.eligibility, p.eligibility)
        table.add_row(
            p.university[:28], p.program[:30], p.city[:14], p.language[:12],
            f"[{style}]{label}[/{style}]",
        )
    console.print(table)


# ─── Ana Ajan ─────────────────────────────────────────────────────────────────

async def run_agent(student_folder: str, quick: bool = False):
    setup_logging(student_folder)

    console.print(Panel.fit(
        f"[bold]AES Üniversite Araştırma Ajanı[/bold]\n"
        f"Öğrenci: [yellow]{student_folder}[/yellow]\n"
        f"Mod: {'Hızlı (sadece DAAD)' if quick else 'Tam araştırma'}",
        border_style="blue",
    ))

    folder = STUDENTS_DIR / student_folder
    if not folder.exists():
        console.print(f"[red]Hata: {folder} klasörü bulunamadı.[/red]")
        console.print(f"Önce: mkdir -p {folder}")
        return

    # Çalışıyor kilidi — dashboard'un durumu görmesi için
    lock_file = folder / ".running"
    lock_file.write_text(datetime.now().isoformat())

    try:
        await _run_agent_inner(student_folder, folder, quick)
    finally:
        try:
            lock_file.unlink(missing_ok=True)
        except Exception:
            pass


async def _run_agent_inner(student_folder: str, folder: Path, quick: bool):
    # ── 1. Profil oku ──────────────────────────────────────────────────
    console.print("\n[1/5] 📖 Profil okunuyor...")
    profile = read_profile(folder)
    if not profile.desired_field:
        console.print("[red]Hata: Profil 'İstenen Alan / Bölüm' alanı boş.[/red]")
        console.print("[yellow]Lütfen dashboard'dan profil düzenle → 'Hedef' bölümünü doldur.[/yellow]")
        return
    console.print(f"      ✅ {profile.name} — {profile.desired_field} ({profile.degree_type})")
    if profile.gpa_german_float:
        console.print(f"      📊 GPA: {profile.gpa_turkish or '—'} → {profile.gpa_german_float} (DE)", style="dim")
    if profile.german_level:
        console.print(f"      🗣  Almanca: {profile.german_level}", style="dim")

    # ── 2. DAAD araması ────────────────────────────────────────────────
    console.print("\n[2/5] 🔍 DAAD veritabanı taranıyor...")
    daad_programs = await search_programs_daad(profile)

    # ── 3. Ek kaynaklar araması ────────────────────────────────────────
    web_programs         = []
    hochschulstart_progs = []
    if not quick:
        console.print("\n[3/5] 🌐 Web & hochschulstart araması yapılıyor...")
        web_programs, hochschulstart_progs = await asyncio.gather(
            search_programs_web(profile),
            search_programs_hochschulstart(profile),
        )
    else:
        console.print("\n[3/5] ⏩ Hızlı mod — ek web araması atlandı")

    all_programs = merge_programs([daad_programs, web_programs, hochschulstart_progs])

    # ── DB önbellekten ek program yükle ───────────────────────────────
    # Daha önce başka öğrenci için taranmış programları içe al —
    # bunlar scraping olmadan hazır veriye sahip.
    try:
        field_keywords = [kw for kw in profile.desired_field.split() if len(kw) >= 4]
        db_programs = db.search(
            language     = profile.program_language if profile.program_language != "Fark etmez" else None,
            degree       = profile.degree_type,
            field_keywords = field_keywords[:5],  # ilk 5 anahtar kelime yeterli
        )
        new_from_db = 0
        existing_keys = {(p.university.lower().strip(), p.program.lower().strip()[:40]) for p in all_programs}
        for row in db_programs:
            k = (row["university"].lower().strip(), row["program"].lower().strip()[:40])
            if k not in existing_keys:
                prog = ProgramDetail(
                    university = row["university"],
                    city       = row.get("city") or "",
                    program    = row["program"],
                    degree     = row.get("degree") or profile.degree_type,
                    language   = row.get("language") or "",
                    url        = row.get("url") or "",
                    sources    = ["db_cache"],
                    confidence = row.get("confidence", 0.5),
                )
                _apply_db_cache(prog, row)
                all_programs.append(prog)
                existing_keys.add(k)
                new_from_db += 1
        if new_from_db:
            console.print(f"      💾 DB önbellekten {new_from_db} ek program eklendi", style="dim")
    except Exception as e:
        logging.warning(f"DB önbellek yükleme hatası: {e}")

    console.print(f"\n      Toplam {len(all_programs)} benzersiz program bulundu")

    # ── 4. Detay çekme — sıralı (rate limit güvenliği için) ───────────
    to_enrich = all_programs[:20] if not quick else all_programs[:10]
    console.print(f"\n[4/5] 🕷️  {len(to_enrich)} program için detay alınıyor...")

    enriched = []
    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"),
                  BarColumn(), console=console) as progress:
        task = progress.add_task("Taranıyor...", total=len(to_enrich))
        for p in to_enrich:
            result = await enrich_program(p, profile)
            enriched.append(result)
            progress.advance(task)

    for p in all_programs[len(to_enrich):]:
        p.eligibility        = "taranmadi"
        p.eligibility_reason = "Detay sayfası bu çalışmada taranmadı"
    final_programs = enriched + all_programs[len(to_enrich):]

    # ── 5. Rapor üret ──────────────────────────────────────────────────
    console.print("\n[5/5] 📊 Raporlar oluşturuluyor...")
    generate_word_report(final_programs, profile, folder)
    generate_excel_report(final_programs, profile, folder)

    # Log kaydet
    log_file = folder / f"arastirma_{datetime.now().strftime('%Y%m%d_%H%M')}.json"
    with open(log_file, "w", encoding="utf-8") as f:
        json.dump([{
            "university":           p.university,
            "program":              p.program,
            "city":                 p.city,
            "language":             p.language,
            "degree":               p.degree,
            "eligibility":          p.eligibility,
            "eligibility_reason":   p.eligibility_reason,
            "issues":               p.issues,
            "passed_checks":        p.passed_checks,
            "deadline_wise":        p.deadline_wise,
            "deadline_sose":        p.deadline_sose,
            "german_requirement":   p.german_requirement,
            "english_requirement":  p.english_requirement,
            "nc_value":             p.nc_value,
            "uni_assist_required":  p.uni_assist_required,
            "conditional_admission":p.conditional_admission,
            "confidence":           round(p.confidence, 2),
            "url":                  p.url,
        } for p in final_programs], f, ensure_ascii=False, indent=2)

    # ── Özet ───────────────────────────────────────────────────────────
    print_summary(final_programs, profile)

    uygun      = sum(1 for p in final_programs if p.eligibility == "uygun")
    sartli     = sum(1 for p in final_programs if p.eligibility == "sartli")
    degil      = sum(1 for p in final_programs if p.eligibility == "uygun_degil")
    veri_yok   = sum(1 for p in final_programs if p.eligibility == "veri_yok")
    taranmadi  = sum(1 for p in final_programs if p.eligibility == "taranmadi")

    console.print(Panel.fit(
        f"[bold green]Araştırma tamamlandı![/bold green]\n"
        f"✅ {uygun} uygun  ⚠️ {sartli} şartlı  ❌ {degil} uygun değil\n"
        f"❓ {veri_yok} veri yok  ⏭ {taranmadi} taranmadı\n"
        f"📄 Rapor: {folder}/sonuc_raporu_*.docx\n"
        f"📊 Liste: {folder}/universite_listesi_*.xlsx",
        border_style="green",
    ))

    # Rate limit durumu
    rl = rate_tracker.status()
    console.print(
        f"[dim]API kullanım kalan: Tavily {rl['tavily']}, "
        f"ScraperAPI {rl['scraperapi']}, Anthropic {rl['anthropic']}[/dim]"
    )


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AES Üniversite Araştırma Ajanı")
    parser.add_argument("--student",  help="Öğrenci klasörü adı (örn: AhmetYilmaz)")
    parser.add_argument("--all",      action="store_true", help="Tüm öğrencileri tara")
    parser.add_argument("--quick",    action="store_true", help="Sadece DAAD (hızlı)")
    parser.add_argument("--template", action="store_true", help="Şablon profil.docx oluştur")
    parser.add_argument("--test",     action="store_true", help="Bağlantı testi yap")
    args = parser.parse_args()

    if args.test:
        _test_connections()
        return

    # Env validasyonu — test modu hariç her çalıştırmada
    if not validate_env():
        sys.exit(1)

    if args.template:
        TEMPLATES_DIR.mkdir(exist_ok=True)
        create_template(TEMPLATES_DIR / "ogrenci_profil_sablonu.docx")
        return

    if args.all:
        STUDENTS_DIR.mkdir(exist_ok=True)
        folders = [f.name for f in STUDENTS_DIR.iterdir() if f.is_dir()]
        if not folders:
            console.print("[yellow]ogrenciler/ klasörü boş.[/yellow]")
            return
        for folder_name in folders:
            asyncio.run(run_agent(folder_name, quick=args.quick))
        return

    if args.student:
        asyncio.run(run_agent(args.student, quick=args.quick))
        return

    parser.print_help()


def _test_connections():
    console.print("\n[bold]Bağlantı & Kurulum Testi[/bold]\n")

    # API anahtarları
    checks = [
        ("ANTHROPIC_API_KEY", "Anthropic Claude"),
        ("TAVILY_API_KEY",    "Tavily Arama"),
        ("SCRAPER_API_KEY",   "ScraperAPI"),
        ("SERPER_API_KEY",    "Serper"),
    ]
    for env_key, name in checks:
        val = os.getenv(env_key, "")
        ok  = val and "BURAYA_YAZ" not in val and len(val) > 10
        status = "[green]✅ Tanımlı[/green]" if ok else "[red]❌ Eksik[/red]"
        console.print(f"  {name:22} {status}")

    # Python paketleri
    packages = [
        ("playwright.async_api",  "Playwright"),
        ("docx",                  "python-docx"),
        ("openpyxl",              "openpyxl"),
        ("httpx",                 "httpx"),
        ("tavily",                "tavily-python"),
        ("anthropic",             "anthropic"),
        ("bs4",                   "beautifulsoup4"),
        ("rich",                  "rich"),
    ]
    console.print()
    for module, name in packages:
        try:
            __import__(module)
            console.print(f"  {name:22} [green]✅ Kurulu[/green]")
        except ImportError:
            console.print(f"  {name:22} [red]❌ Kurulu değil[/red]  → pip install {name.lower()}")

    console.print()


if __name__ == "__main__":
    main()
