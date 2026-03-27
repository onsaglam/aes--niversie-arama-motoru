"""
parser.py — Claude API ile HTML'den üniversite verisi çıkarma + uygunluk değerlendirme.
"""
import os
import json
import re
import logging
from dataclasses import dataclass, field
from typing import Optional

try:
    import anthropic
    CLAUDE_OK = True
except ImportError:
    CLAUDE_OK = False

try:
    from bs4 import BeautifulSoup
    BS4_OK = True
except ImportError:
    BS4_OK = False

logger = logging.getLogger(__name__)


# ─── ProgramDetail ────────────────────────────────────────────────────────────

@dataclass
class ProgramDetail:
    university:            str = ""
    city:                  str = ""
    program:               str = ""
    degree:                str = ""
    language:              str = ""
    url:                   str = ""

    deadline_wise:         Optional[str] = None
    deadline_sose:         Optional[str] = None

    german_requirement:    Optional[str] = None
    english_requirement:   Optional[str] = None

    nc_value:              Optional[str] = None
    min_gpa:               Optional[float] = None   # Almanya skalası (1.0-5.0), düşük=iyi
    uni_assist_required:   bool = False
    conditional_admission: bool = False

    required_documents:    list = field(default_factory=list)
    notes:                 str = ""
    confidence:            float = 0.5
    sources:               list = field(default_factory=list)

    # Değerlendirme sonucu
    eligibility:           str = ""   # uygun / sartli / uygun_degil
    eligibility_reason:    str = ""
    issues:                list = field(default_factory=list)
    passed_checks:         list = field(default_factory=list)


# ─── HTML → Metin ─────────────────────────────────────────────────────────────

def html_to_text(html: str, max_chars: int = 10000) -> str:
    """HTML'den okunabilir, temiz metin çıkar. Başvuru ile ilgili bölümleri önceliklendir."""
    if not BS4_OK:
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text)
        return text[:max_chars]

    soup = BeautifulSoup(html, "lxml")

    # Gereksiz elementleri kaldır
    for tag in soup(["script", "style", "nav", "footer", "header",
                     "aside", "noscript", "iframe", "img", "svg", "form"]):
        tag.decompose()

    # Başvuru ile ilgili bölümleri önce al — geniş seçici listesi
    priority_selectors = [
        # Genel içerik alanları
        "main", "article", "#content", ".content", "#main-content",
        # Almanca başvuru anahtar kelimeleri
        ".bewerbung", ".zulassung", ".studium", "#bewerbung", "#zulassung",
        "[class*='bewerbung']", "[class*='zulassung']", "[class*='admission']",
        "[id*='bewerbung']", "[id*='zulassung']", "[id*='application']",
        # İngilizce başvuru anahtar kelimeleri
        "[class*='application']", "[class*='requirement']", "[class*='deadline']",
        "[id*='requirement']", "[id*='deadline']",
        # Tablo ve liste içerikleri (şart tabloları)
        "table", ".requirements", ".prerequisites",
    ]
    seen_text: set[str] = set()
    sections = []
    for sel in priority_selectors:
        for el in soup.select(sel)[:2]:  # Her seçici için en fazla 2 element
            t = el.get_text(" ", strip=True)
            if len(t) > 100 and t not in seen_text:
                sections.append(t)
                seen_text.add(t)
                if sum(len(s) for s in sections) >= max_chars:
                    break
        if sum(len(s) for s in sections) >= max_chars:
            break

    if not sections:
        text = soup.get_text(" ", strip=True)
    else:
        text = " ".join(sections)

    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]


# ─── Claude ile Veri Çıkarma ──────────────────────────────────────────────────

PARSE_PROMPT = """Sen Almanya üniversite başvuru uzmanısın.
Aşağıdaki metin {university} üniversitesinin {program} programına ait web sayfasından alındı.
Metin Almanca veya İngilizce olabilir.

METİN:
{text}

SADECE aşağıdaki JSON'u döndür, başka hiçbir metin ekleme:
{{
  "city": "şehir adı veya null",
  "degree": "Bachelor/Master/PhD veya null",
  "language": "Almanca/İngilizce/Her İkisi veya null",
  "deadline_wise": "Kış dönemi başvuru son tarihi — tam formatta: DD.MM.YYYY veya 'DD. Monat YYYY' veya '01. Oktober' vb. veya null",
  "deadline_sose": "Yaz dönemi başvuru son tarihi — aynı format veya null",
  "german_requirement": "Almanca dil şartı — tam olarak: 'TestDaF 16' veya 'DSH-2' veya 'Goethe-Zertifikat C1' vb. veya null",
  "english_requirement": "İngilizce dil şartı — tam olarak: 'IELTS 6.5' veya 'TOEFL iBT 88' vb. veya null",
  "nc_value": "NC sayısal değer örn '2.3' veya 'zulassungsfrei' (kısıtsız) veya null",
  "min_gpa": "minimum not ortalaması Almanya skalasında sayısal değer (1.0-5.0) veya null",
  "uni_assist_required": "uni-assist.de üzerinden başvuru gerekiyorsa true, aksi false",
  "conditional_admission": "Bedingte Zulassung / şartlı kabul mevcut ise true, aksi false",
  "required_documents": ["gerekli belgeler listesi — motivasyon mektubu, CV, transkript vb."],
  "notes": "Dikkat çekici özel şartlar, kısıtlamalar, önemli bilgiler (max 150 karakter) veya null"
}}"""


def extract_program_data(html: str, university: str, program: str, url: str = "") -> ProgramDetail:
    """Claude ile HTML'den program verisi çıkar."""
    detail = ProgramDetail(university=university, program=program, url=url)

    if not CLAUDE_OK:
        detail.notes = "anthropic paketi kurulu değil"
        return detail

    text   = html_to_text(html)
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    prompt = PARSE_PROMPT.format(
        university=university,
        program=program,
        text=text,
    )

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        m   = re.search(r"\{[\s\S]*\}", raw)
        if m:
            data = json.loads(m.group())
            for k, v in data.items():
                if hasattr(detail, k) and v is not None:
                    # min_gpa: string → float (Almanya skalası)
                    if k == "min_gpa":
                        try:
                            detail.min_gpa = float(str(v).replace(",", "."))
                        except (ValueError, TypeError):
                            pass
                    else:
                        setattr(detail, k, v)
            detail.confidence = 0.8
            detail.sources.append("university_official_site")
            logger.debug(f"Claude parse başarılı: {university} — {program}")
    except Exception as e:
        detail.notes = f"Veri çıkarma hatası: {e}"
        detail.confidence = 0.2
        logger.warning(f"Claude parse hatası ({university}): {e}")

    return detail


# ─── Dil Seviyesi Skoru ───────────────────────────────────────────────────────

# Her dil seviyesi için 0-10 arası sayısal skor (karşılaştırma için)
GERMAN_LEVEL_SCORES: dict[str, int] = {
    # TestDaF (toplam puan)
    "testdaf 20": 10, "testdaf 18": 9, "testdaf 16": 8,
    "testdaf 14": 7,  "testdaf 12": 6,
    # DSH
    "dsh-3": 10, "dsh-2": 8, "dsh-1": 6,
    "dsh3":  10, "dsh2":  8, "dsh1":  6,
    # Goethe / TELC / ÖSD
    "goethe c2": 10, "goethe c1": 8, "goethe b2": 6,
    "telc c2":   10, "telc c1":   8, "telc b2":   6,
    "ösd c2":    10, "ösd c1":    8, "ösd b2":    6,
    # CEFR genel
    "c2": 10, "c1": 8, "b2": 6, "b1": 4, "a2": 2, "a1": 1,
}

ENGLISH_LEVEL_SCORES: dict[str, int] = {
    # IELTS
    "ielts 9.0": 10, "ielts 8.5": 9,  "ielts 8.0": 9,
    "ielts 7.5": 8,  "ielts 7.0": 7,  "ielts 6.5": 6,
    "ielts 6.0": 5,  "ielts 5.5": 4,
    # TOEFL iBT
    "toefl 110": 9, "toefl 100": 7, "toefl 90": 6,
    "toefl 88":  6, "toefl 80":  5, "toefl 72":  4,
    # Cambridge
    "c2 proficiency": 10, "c1 advanced": 8, "b2 first": 6,
    # CEFR genel
    "c2": 10, "c1": 8, "b2": 6, "b1": 4,
}


def _lang_score(level: str, is_german: bool = True) -> int:
    """Dil seviyesinin 0-10 skorunu döndür."""
    if not level:
        return 0
    key = level.lower().strip()
    score_map = GERMAN_LEVEL_SCORES if is_german else ENGLISH_LEVEL_SCORES

    # Tam eşleşme
    if key in score_map:
        return score_map[key]

    # Kısmi eşleşme (uzundan kısaya — daha spesifik önce)
    for k in sorted(score_map.keys(), key=len, reverse=True):
        if k in key:
            return score_map[k]

    # CEFR fallback
    cefr_fallback = {"c2": 10, "c1": 8, "b2": 6, "b1": 4, "a2": 2, "a1": 1}
    for cefr, s in cefr_fallback.items():
        if cefr in key:
            return s

    return 0


# ─── Uygunluk Değerlendirme ───────────────────────────────────────────────────

def evaluate_eligibility(profile, program: ProgramDetail) -> ProgramDetail:
    """
    Öğrencinin programa uygunluğunu değerlendir.
    Almanya GPA skalası: 1.0=en iyi, 5.0=başarısız (düşük sayı = iyi)
    """
    issues  = []
    passed  = []

    # 1. Almanca dil şartı
    if program.german_requirement:
        req_score = _lang_score(program.german_requirement, is_german=True)
        stu_score = _lang_score(profile.german_level or "", is_german=True)
        if req_score == 0:
            # Şart parse edilemedi — bilgi eksik, geç
            passed.append(f"Almanca şartı belirsiz: {program.german_requirement}")
        elif stu_score == 0:
            issues.append(f"Almanca belgesi gerekli: {program.german_requirement} — Mevcut: Yok")
        elif stu_score >= req_score:
            passed.append(f"Almanca: {profile.german_level} ✓ (şart: {program.german_requirement})")
        else:
            issues.append(f"Almanca yetersiz: {profile.german_level} < {program.german_requirement}")

    # 2. İngilizce dil şartı
    if program.english_requirement:
        req_score = _lang_score(program.english_requirement, is_german=False)
        stu_score = _lang_score(profile.english_level or "", is_german=False)
        if req_score == 0:
            passed.append(f"İngilizce şartı belirsiz: {program.english_requirement}")
        elif stu_score == 0:
            issues.append(f"İngilizce belgesi gerekli: {program.english_requirement} — Mevcut: Yok")
        elif stu_score >= req_score:
            passed.append(f"İngilizce: {profile.english_level} ✓ (şart: {program.english_requirement})")
        else:
            issues.append(f"İngilizce yetersiz: {profile.english_level} < {program.english_requirement}")

    # 3. GPA kontrolü (Almanya skalası — düşük sayı = iyi)
    if program.min_gpa and hasattr(profile, "gpa_german_float") and profile.gpa_german_float:
        student_gpa = profile.gpa_german_float
        # Almanya skalasında min_gpa = kabul edilebilir EN KÖTÜ not
        # Örn: min_gpa=2.5 → öğrencinin GPA'ı 2.5 veya daha iyi (düşük) olmalı
        if student_gpa <= program.min_gpa:
            passed.append(f"GPA: {student_gpa} (DE) ≤ {program.min_gpa} ✓")
        else:
            issues.append(f"GPA yetersiz: {student_gpa} (DE) > {program.min_gpa} (min gerekli)")
    elif program.min_gpa:
        # GPA bilgisi yoksa uyarı ekle ama engel olarak sayma
        passed.append(f"GPA şartı var ({program.min_gpa} DE) — öğrenci GPA'ı bilinmiyor")

    # 4. NC kontrolü
    nc = (program.nc_value or "").lower().strip()
    if nc and nc not in ("zulassungsfrei", "none", "null", ""):
        if not profile.accept_nc:
            issues.append(f"NC'li bölüm (NC: {program.nc_value}) — öğrenci NC'siz istiyor")
        else:
            passed.append(f"NC: {program.nc_value} — kabul ediliyor ✓")

    # 5. Şehir tercihi — bilgilendirici not (engelleyici değil)
    preferred = getattr(profile, "preferred_cities", [])
    if preferred and program.city:
        city_lower = program.city.lower()
        pref_lower = [c.lower() for c in preferred if c.lower() not in ("fark etmez", "any")]
        if pref_lower:
            if any(pref in city_lower or city_lower in pref for pref in pref_lower):
                passed.append(f"Şehir: {program.city} ✓ (tercih edilen)")
            else:
                passed.append(f"Şehir: {program.city} (tercih dışı — {', '.join(preferred[:2])} isteniyor)")

    # 6. Sonuç hesapla
    n_issues = len(issues)
    student_accepts_conditional = getattr(profile, "conditional_admission", True)

    if n_issues == 0:
        program.eligibility        = "uygun"
        program.eligibility_reason = "Tüm temel şartlar karşılanıyor"
    elif n_issues == 1 and program.conditional_admission and student_accepts_conditional:
        program.eligibility        = "sartli"
        program.eligibility_reason = f"1 eksiklik, şartlı kabul mevcut: {issues[0]}"
    elif n_issues == 1:
        reason = "şartlı kabul yok" if not program.conditional_admission else "öğrenci şartlı kabul istemiyor"
        program.eligibility        = "uygun_degil"
        program.eligibility_reason = f"Eksiklik ({reason}): {issues[0]}"
    else:
        program.eligibility        = "uygun_degil"
        program.eligibility_reason = f"{n_issues} eksiklik: " + " | ".join(issues)

    program.issues        = issues
    program.passed_checks = passed
    return program


# ─── PDF (Modulhandbuch) Veri Çıkarma ────────────────────────────────────────

PDF_PROMPT = """Bu PDF {university} üniversitesinin {program} programına ait Modulhandbuch veya başvuru belgesi.

Başvuru şartlarını bul. SADECE aşağıdaki JSON'u döndür, başka hiçbir metin ekleme:
{{
  "german_requirement": "DSH-2 / TestDaF 16 / Goethe C1 vb. veya null",
  "english_requirement": "IELTS 6.5 / TOEFL 88 vb. veya null",
  "min_gpa": null,
  "deadline_wise": "DD.MM.YYYY veya null",
  "deadline_sose": "DD.MM.YYYY veya null",
  "required_documents": [],
  "notes": "Kritik başvuru gereksinimleri özeti"
}}"""


def _pdf_to_text(pdf_bytes: bytes, max_chars: int = 8000) -> str:
    """PDF bytes'ı düz metne çevir. PyPDF2 veya pdfminer kullan."""
    try:
        import io
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
        parts = []
        for page in reader.pages:
            text = page.extract_text() or ""
            parts.append(text)
            if sum(len(p) for p in parts) >= max_chars:
                break
        return " ".join(parts)[:max_chars]
    except Exception:
        pass

    try:
        from pdfminer.high_level import extract_text_to_fp
        from pdfminer.layout import LAParams
        import io
        out = io.StringIO()
        extract_text_to_fp(io.BytesIO(pdf_bytes), out, laparams=LAParams())
        return out.getvalue()[:max_chars]
    except Exception:
        pass

    return ""


def extract_from_pdf(pdf_bytes: bytes, university: str, program: str) -> dict:
    """PDF'den metin çıkar, Claude ile başvuru bilgilerini çek."""
    if not CLAUDE_OK or not pdf_bytes:
        return {}

    text = _pdf_to_text(pdf_bytes)
    if not text.strip():
        logger.warning(f"PDF'den metin çıkarılamadı: {university}")
        return {}

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    prompt = PDF_PROMPT.format(university=university, program=program) + f"\n\nPDF METNİ:\n{text}"

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        m   = re.search(r"\{[\s\S]*\}", raw)
        if m:
            data = json.loads(m.group())
            logger.debug(f"PDF parse başarılı: {university} — {program}")
            return data
    except Exception as e:
        logger.warning(f"PDF Claude analizi hatası ({university}): {e}")

    return {}
