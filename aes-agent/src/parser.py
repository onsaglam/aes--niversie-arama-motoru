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

def html_to_text(html: str, max_chars: int = 15000) -> str:
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
  "program_name": "Sayfadaki gerçek program adı (örn: 'Industrial Engineering M.Sc.', 'Maschinenbau Master') — eğer açıkça belirtilmişse; aksi halde null",
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
            # program_name: override girilen ham ismi temiz bir isimle
            extracted_program_name = data.pop("program_name", None)
            if extracted_program_name and len(extracted_program_name) > 3:
                # Sadece gerçek program adları kabul et (PDF dosya ismi gibi görünmeyenleri)
                bad_keywords = ["hinweise", "bewerbung", "merkblatt", "filetype", ".pdf",
                                "zulassungsverfahren", "information für"]
                if not any(bk in extracted_program_name.lower() for bk in bad_keywords):
                    detail.program = extracted_program_name
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
            logger.debug(f"Claude parse başarılı: {university} — {detail.program}")
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

    Her kontrol için ayrıntılı açıklama üretir:
    - Geçen kontroller: neden geçti (specific values)
    - Başarısız kontroller: tam olarak neyin eksik olduğu
    """
    issues  = []
    passed  = []

    # 1. Almanca dil şartı
    if program.german_requirement:
        req_score = _lang_score(program.german_requirement, is_german=True)
        stu_score = _lang_score(profile.german_level or "", is_german=True)
        if req_score == 0:
            passed.append(f"Almanca şartı ({program.german_requirement}) tanımlanamadı — veri eksik, geçildi")
        elif stu_score == 0:
            issues.append(
                f"Almanca dil belgesi eksik: Program {program.german_requirement} gerektiriyor, "
                f"öğrencinin Almanca sertifikası yok"
            )
        elif stu_score >= req_score:
            passed.append(
                f"Almanca dil şartı karşılandı: Öğrenci {profile.german_level}, "
                f"program şartı {program.german_requirement}"
            )
        else:
            issues.append(
                f"Almanca dil seviyesi yetersiz: Öğrenci {profile.german_level} (skor {stu_score}/10), "
                f"program {program.german_requirement} gerektiriyor (skor {req_score}/10)"
            )

    # 2. İngilizce dil şartı
    if program.english_requirement:
        req_score = _lang_score(program.english_requirement, is_german=False)
        stu_score = _lang_score(profile.english_level or "", is_german=False)
        if req_score == 0:
            passed.append(f"İngilizce şartı ({program.english_requirement}) tanımlanamadı — geçildi")
        elif stu_score == 0:
            issues.append(
                f"İngilizce dil belgesi eksik: Program {program.english_requirement} gerektiriyor, "
                f"öğrencinin İngilizce sertifikası yok"
            )
        elif stu_score >= req_score:
            passed.append(
                f"İngilizce dil şartı karşılandı: Öğrenci {profile.english_level}, "
                f"program şartı {program.english_requirement}"
            )
        else:
            issues.append(
                f"İngilizce dil seviyesi yetersiz: Öğrenci {profile.english_level} (skor {stu_score}/10), "
                f"program {program.english_requirement} gerektiriyor (skor {req_score}/10)"
            )

    # 3. GPA kontrolü (Almanya skalası — düşük sayı = iyi)
    if program.min_gpa and hasattr(profile, "gpa_german_float") and profile.gpa_german_float:
        student_gpa = profile.gpa_german_float
        # Almanya skalasında min_gpa = kabul edilebilir EN KÖTÜ not
        # Örn: min_gpa=2.5 → öğrencinin GPA'ı 2.5 veya daha iyi (≤2.5) olmalı
        if student_gpa <= program.min_gpa:
            passed.append(
                f"Not ortalaması şartı karşılandı: Öğrenci {student_gpa:.1f} (DE), "
                f"program en fazla {program.min_gpa:.1f} (DE) gerektiriyor"
            )
        else:
            issues.append(
                f"Not ortalaması yetersiz: Öğrenci {student_gpa:.1f} (DE), "
                f"program en fazla {program.min_gpa:.1f} (DE) gerektiriyor — "
                f"{student_gpa - program.min_gpa:.1f} puan fark var"
            )
    elif program.min_gpa:
        passed.append(
            f"GPA şartı var (en fazla {program.min_gpa:.1f} DE) — "
            f"öğrenci GPA'ı bilinmiyor, başvuru öncesi kontrol edilmeli"
        )

    # 4. NC kontrolü
    nc = (program.nc_value or "").lower().strip()
    if nc and nc not in ("zulassungsfrei", "none", "null", ""):
        if not profile.accept_nc:
            issues.append(
                f"Bu bölüm NC'li (kısıtlı kontenjan): NC {program.nc_value} — "
                f"öğrenci NC'siz programlar istiyor"
            )
        else:
            passed.append(f"NC değeri {program.nc_value} — öğrenci NC'li programları kabul ediyor")
    elif nc == "zulassungsfrei":
        passed.append("NC yok (zulassungsfrei) — kısıtlı kontenjan uygulanmıyor")

    # 5. Başvuru tarihi kontrolü — bilgilendirici
    _add_deadline_info(program, passed)

    # 6. Şehir tercihi — bilgilendirici (engelleyici değil)
    preferred = getattr(profile, "preferred_cities", [])
    if preferred and program.city:
        city_lower = program.city.lower()
        pref_lower = [c.lower() for c in preferred if c.lower() not in ("fark etmez", "any")]
        if pref_lower:
            if any(pref in city_lower or city_lower in pref for pref in pref_lower):
                passed.append(f"Tercih edilen şehirde: {program.city}")
            else:
                passed.append(
                    f"Şehir tercihi dışında: {program.city} — "
                    f"öğrenci {', '.join(preferred[:2])} tercih ediyor"
                )

    # 7. uni-assist bilgilendirmesi
    if program.uni_assist_required:
        passed.append("uni-assist.de üzerinden başvuru gerekiyor — önceden kayıt açılmalı")

    # 8. Program dili bilgilendirmesi
    if program.language:
        stu_de = bool(profile.german_level and profile.german_level not in ("", "Yok"))
        stu_en = bool(profile.english_level and profile.english_level not in ("", "Yok"))
        lang_l = program.language.lower()
        if "almanca" in lang_l or "german" in lang_l or "deutsch" in lang_l:
            if stu_de:
                passed.append(f"Program dili Almanca ({program.language}) — öğrencinin Almanca sertifikası var")
            # Else already caught by german_requirement check
        elif "ingilizce" in lang_l or "english" in lang_l:
            if stu_en:
                passed.append(f"Program dili İngilizce ({program.language}) — öğrencinin İngilizce sertifikası var")

    # ── Sonuç hesapla ─────────────────────────────────────────────────
    n_issues = len(issues)
    student_accepts_conditional = getattr(profile, "conditional_admission", True)

    if n_issues == 0:
        positive_summary = _build_positive_summary(program, profile, passed)
        program.eligibility        = "uygun"
        program.eligibility_reason = positive_summary
    elif n_issues == 1 and program.conditional_admission and student_accepts_conditional:
        program.eligibility        = "sartli"
        program.eligibility_reason = (
            f"Şartlı uygun — 1 eksiklik var ama şartlı kabul mevcut. "
            f"Eksik: {issues[0]}. "
            f"Şartlı kabul alındıktan sonra eksik karşılanırsa kabul onaylanır."
        )
    elif n_issues == 1:
        reason_why_not_conditional = (
            "Program şartlı kabul sunmuyor" if not program.conditional_admission
            else "Öğrenci şartlı kabul istemediğini belirtmiş"
        )
        program.eligibility        = "uygun_degil"
        program.eligibility_reason = (
            f"Uygun değil ({reason_why_not_conditional}). "
            f"Sorun: {issues[0]}"
        )
    else:
        program.eligibility        = "uygun_degil"
        program.eligibility_reason = (
            f"{n_issues} farklı eksiklik var: " +
            " | ".join(f"({i+1}) {iss}" for i, iss in enumerate(issues))
        )

    program.issues        = issues
    program.passed_checks = passed
    return program


def _add_deadline_info(program: ProgramDetail, passed: list):
    """Başvuru tarihi bilgisini passed listesine ekle — bilgilendirici."""
    from datetime import date
    today = date.today()

    def _parse_dd_mm(s: str):
        """'15.01', '15.01.2026', '15. Januar', '01. Juli 2026' formatlarını parse et."""
        if not s:
            return None
        import re
        _MONTHS = {
            "januar": 1, "februar": 2, "märz": 3, "april": 4, "mai": 5, "juni": 6,
            "juli": 7, "august": 8, "september": 9, "oktober": 10, "november": 11, "dezember": 12,
            "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
            "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
        }
        # DD.MM.YYYY
        m = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", s)
        if m:
            try:
                return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            except ValueError:
                pass
        # DD. MonthName YYYY
        m = re.search(r"(\d{1,2})\.\s*([A-Za-zä]+)\s*(\d{4})?", s, re.IGNORECASE)
        if m:
            mo = _MONTHS.get(m.group(2).lower())
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
        m = re.search(r"^(\d{1,2})\.(\d{1,2})\.?$", s.strip())
        if m:
            try:
                d = date(today.year, int(m.group(2)), int(m.group(1)))
                if d < today:
                    d = date(today.year + 1, int(m.group(2)), int(m.group(1)))
                return d
            except ValueError:
                pass
        return None

    for label, raw in [("WiSe", program.deadline_wise), ("SoSe", program.deadline_sose)]:
        if not raw:
            continue
        parsed = _parse_dd_mm(raw)
        if parsed:
            delta = (parsed - today).days
            if delta < -30:
                passed.append(f"{label} başvuru tarihi geçmiş: {raw} ({abs(delta)} gün önce)")
            elif delta < 0:
                passed.append(f"{label} başvuru tarihi çok yakın geçti: {raw} ({abs(delta)} gün önce) — SoSe için dene")
            elif delta <= 14:
                passed.append(f"⚠️ {label} son başvuru {raw} — yalnızca {delta} gün kaldı! Acil başvur!")
            elif delta <= 30:
                passed.append(f"⏰ {label} son başvuru {raw} — {delta} gün kaldı, hemen başvuru hazırlığına başla")
            elif delta <= 90:
                passed.append(f"{label} başvuru tarihi yaklaşıyor: {raw} ({delta} gün kaldı)")
            else:
                passed.append(f"{label} başvuru tarihi: {raw} ({delta} gün kaldı)")
        else:
            passed.append(f"{label} başvuru tarihi: {raw}")


def _build_positive_summary(program: ProgramDetail, profile, passed: list) -> str:
    """Uygun program için olumlu ve bilgilendirici özet mesajı oluştur."""
    highlights = []

    # Dil uyumu
    if program.language:
        lang_l = program.language.lower()
        if "almanca" in lang_l or "german" in lang_l:
            highlights.append(f"Almanca program")
        elif "ingilizce" in lang_l or "english" in lang_l:
            highlights.append(f"İngilizce program")
        elif program.language:
            highlights.append(f"{program.language} dili")

    # Şehir uyumu
    preferred = getattr(profile, "preferred_cities", [])
    if program.city and preferred:
        pref_lower = [c.lower() for c in preferred if c.lower() not in ("fark etmez", "any")]
        if any(p in program.city.lower() or program.city.lower() in p for p in pref_lower):
            highlights.append(f"tercih ettiğin şehirde ({program.city})")

    # NC durumu
    nc = (program.nc_value or "").lower().strip()
    if nc == "zulassungsfrei":
        highlights.append("NC yok (açık kabul)")
    elif not nc:
        highlights.append("NC durumu bilinmiyor")

    # GPA
    if program.min_gpa and hasattr(profile, "gpa_german_float") and profile.gpa_german_float:
        margin = program.min_gpa - profile.gpa_german_float
        if margin > 0.5:
            highlights.append(f"GPA {profile.gpa_german_float:.1f} (DE) konforlu geçiyor")
        else:
            highlights.append(f"GPA {profile.gpa_german_float:.1f} (DE) yeterli")

    # Şartlı kabul
    if program.conditional_admission:
        highlights.append("şartlı kabul seçeneği mevcut")

    if highlights:
        return "Tüm şartlar karşılanıyor — " + ", ".join(highlights)
    return "Tüm temel başvuru şartları karşılanıyor"


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
