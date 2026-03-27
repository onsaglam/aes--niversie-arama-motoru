# PDF Çıkarma Referansı — Transkript ve Dil Belgeleri

## Genel Akış

```
profil.docx (Word)  →  reader.py  →  StudentProfile
transkript.pdf      →  parser.py  →  gpa_german, gpa_turkish, university
dil_belgesi.pdf     →  parser.py  →  german_level, english_level
```

---

## Word Profil Dosyası Okuma

```python
from docx import Document
import re

def read_docx_field(doc_path: str, field_label: str) -> str:
    """Word dosyasından belirli bir alanın değerini çek."""
    doc = Document(doc_path)
    full_text = "\n".join(p.text for p in doc.paragraphs)

    # "Alan Adı: [Değer]" formatını parse et
    pattern = rf"{re.escape(field_label)}[:\s]+\[?([^\]\n]+)\]?"
    m = re.search(pattern, full_text, re.IGNORECASE)
    return m.group(1).strip() if m else ""

# Tüm alanları toplu oku
def parse_profile_docx(path: str) -> dict:
    doc = Document(path)
    text = "\n".join(p.text for p in doc.paragraphs)

    def field(pattern: str, default: str = "") -> str:
        m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        return m.group(1).strip() if m else default

    return {
        "name":              field(r"Ad Soyad[:\s]+\[?([^\]\n\[]+)"),
        "email":             field(r"E-posta[:\s]+\[?([^\]\n\[]+)"),
        "current_uni":       field(r"Mevcut.+Okul[:\s]+\[?([^\]\n\[]+)"),
        "department":        field(r"Bölüm[:\s]+\[?([^\]\n\[]+)"),
        "gpa":               field(r"Not Ortalamas[ıi][:\s]+\[?([^\]\n\[]+)"),
        "graduation":        field(r"Mezuniyet Tarihi[:\s]+\[?([^\]\n\[]+)"),
        "german_level":      field(r"Almanca[:\s]+\[?([^\]\n\[]+)"),
        "english_level":     field(r"İngilizce[:\s]+\[?([^\]\n\[]+)"),
        "desired_field":     field(r"İstenen Alan[:\s]+\[?([^\]\n\[]+)"),
        "degree_type":       field(r"Derece Türü[:\s]+\[?([^\]\n\[]+)", "Master"),
        "program_language":  field(r"Program Dili[:\s]+\[?([^\]\n\[]+)"),
        "preferred_cities":  field(r"Tercih Şehirler[:\s]+\[?([^\]\n\[]+)"),
        "start_semester":    field(r"Başlangıç Dönemi[:\s]+\[?([^\]\n\[]+)"),
        "conditional":       field(r"Şartlı Kabul[:\s]+\[?([^\]\n\[]+)", "Evet"),
        "notes":             field(r"EK BİLGİLER.*?\n(.+?)(?=\n■|\Z)"),
    }
```

---

## Transkript PDF — Claude ile Okuma

```python
import anthropic, base64, json, re
from pathlib import Path

def extract_transcript_data(pdf_path: str) -> dict:
    """
    Transkript PDF'inden GPA ve üniversite bilgisini çıkar.
    Claude'un vision capability'sini kullanır.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    # PDF'i base64'e çevir
    pdf_bytes = Path(pdf_path).read_bytes()
    b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

    prompt = """Bu transkript belgesinden şunları çıkar.
SADECE JSON döndür, başka metin ekleme:
{
  "university": "üniversite adı",
  "department": "bölüm adı",
  "degree_level": "Bachelor/Master/Lisans/Yüksek Lisans",
  "gpa_original": "orijinal not (örn: 3.25/4.00 veya 2.85/4.0 veya 75.5/100)",
  "gpa_scale": "4.0 veya 100 (hangi skalada)",
  "gpa_german": "Almanya skalasına dönüştürülmüş (1.0-5.0), bilmiyorsan null",
  "graduation_year": "yıl veya null",
  "status": "mezun/devam ediyor/beklemede",
  "language": "eğitim dili (Türkçe/İngilizce vb.)",
  "credits_completed": "tamamlanan kredi veya null"
}"""

    resp = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": b64
                    }
                },
                {"type": "text", "text": prompt}
            ]
        }]
    )

    text = resp.content[0].text.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    return json.loads(m.group()) if m else {}
```

---

## Dil Belgesi PDF — Sertifika Tespiti

```python
def extract_language_cert(pdf_path: str) -> dict:
    """
    Dil belgesi PDF'inden sertifika türü ve seviyeyi çıkar.
    TestDaF, DSH, IELTS, TOEFL, Goethe vb.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    b64 = base64.standard_b64encode(Path(pdf_path).read_bytes()).decode()

    prompt = """Bu dil sertifikası belgesinden şunları çıkar.
SADECE JSON döndür:
{
  "cert_type": "TestDaF/DSH/Goethe/IELTS/TOEFL/ÖSD/telc/Cambridge/TOEIC/YDS/YÖKDİL veya diğer",
  "language": "Almanca veya İngilizce veya diğer",
  "level_or_score": "ham skor veya seviye (örn: 16 veya B2 veya 6.5 veya 92)",
  "cefr_level": "A1/A2/B1/B2/C1/C2 veya null",
  "exam_date": "YYYY-MM veya null",
  "validity_expiry": "son geçerlilik tarihi veya 'ömür boyu' veya null",
  "institution": "sınav kurumu (örn: Goethe-Institut, British Council)",
  "candidate_name": "adayın adı veya null"
}"""

    resp = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}},
                {"type": "text", "text": prompt}
            ]
        }]
    )

    text = resp.content[0].text.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    data = json.loads(m.group()) if m else {}

    # Normalize: sayısal skor → standart format
    cert = data.get("cert_type", "")
    score = str(data.get("level_or_score", ""))

    if "TestDaF" in cert:
        data["normalized"] = f"TestDaF {score}"
    elif "DSH" in cert:
        data["normalized"] = f"DSH-{score.replace('DSH-','').replace('DSH','').strip()}"
    elif "IELTS" in cert:
        data["normalized"] = f"IELTS {score}"
    elif "TOEFL" in cert:
        data["normalized"] = f"TOEFL {score}"
    elif "Goethe" in cert:
        data["normalized"] = f"Goethe {data.get('cefr_level', score)}"
    else:
        data["normalized"] = f"{cert} {score}".strip()

    return data
```

---

## GPA Dönüştürme Fonksiyonları

```python
def convert_tr_100_to_40(grade_100: float) -> float:
    """Türkiye 100 puan skalasını 4.0 skalasına çevir."""
    if grade_100 >= 90: return 4.0
    if grade_100 >= 85: return 3.7
    if grade_100 >= 80: return 3.3
    if grade_100 >= 75: return 3.0
    if grade_100 >= 70: return 2.7
    if grade_100 >= 65: return 2.3
    if grade_100 >= 60: return 2.0
    if grade_100 >= 55: return 1.7
    if grade_100 >= 50: return 1.3
    return 1.0

def convert_to_german_scale(raw: str) -> float | None:
    """
    Her türlü GPA string'ini Almanya 1.0-5.0 skalasına çevir.
    Almanya'da: 1.0=Sehr gut, 2.0=Gut, 3.0=Befriedigend, 4.0=Ausreichend, 5.0=Nicht bestanden
    """
    raw = raw.strip().replace(",", ".")

    # "3.2/4.0" veya "3.2 / 4.0" formatı
    m = re.match(r"([\d.]+)\s*/\s*([\d.]+)", raw)
    if m:
        value, scale = float(m.group(1)), float(m.group(2))
        if scale == 4.0:
            # Bavyera formülü: (max_puan - notunuz) / (max_puan - min_puan) * (best_DE - worst_DE) + best_DE
            return round(1 + 3 * (4.0 - value) / (4.0 - 1.0), 1)
        if scale == 100:
            gpa_40 = convert_tr_100_to_40(value)
            return round(1 + 3 * (4.0 - gpa_40) / (4.0 - 1.0), 1)

    # "2.5 (DE)" gibi zaten Almanya skalasında
    m = re.match(r"([\d.]+)\s*(?:\(DE\))?", raw)
    if m:
        val = float(m.group(1))
        if 1.0 <= val <= 5.0:
            return val

    return None

# Test
assert convert_to_german_scale("3.8/4.0") == 1.2  # Sehr gut
assert convert_to_german_scale("3.0/4.0") == 2.0  # Gut
assert convert_to_german_scale("2.5/4.0") == 2.5  # Zwischen
```

---

## Dil Seviyesi Normalizasyonu

```python
GERMAN_LEVELS_MAP = {
    # TestDaF
    "testdaf 20": ("TestDaF TDN 5", "C2", 10),
    "testdaf 18": ("TestDaF TDN 4+", "C1", 9),
    "testdaf 16": ("TestDaF TDN 4",  "C1", 8),
    "testdaf 14": ("TestDaF TDN 3+", "B2", 7),
    "testdaf 12": ("TestDaF TDN 3",  "B2", 6),
    # DSH
    "dsh-3": ("DSH-3", "C2", 10),
    "dsh-2": ("DSH-2", "C1", 8),
    "dsh-1": ("DSH-1", "B2", 6),
    # Goethe / TELC / ÖSD
    "goethe c2": ("Goethe C2",  "C2", 10),
    "goethe c1": ("Goethe C1",  "C1", 8),
    "goethe b2": ("Goethe B2",  "B2", 6),
    "telc c1":   ("telc C1",    "C1", 8),
    "ösd c2":    ("ÖSD C2",     "C2", 10),
    "ösd c1":    ("ÖSD C1",     "C1", 8),
}

ENGLISH_LEVELS_MAP = {
    "ielts 9.0": ("IELTS 9.0", "C2", 10),
    "ielts 8.5": ("IELTS 8.5", "C2", 9),
    "ielts 8.0": ("IELTS 8.0", "C2", 9),
    "ielts 7.5": ("IELTS 7.5", "C1", 8),
    "ielts 7.0": ("IELTS 7.0", "C1", 7),
    "ielts 6.5": ("IELTS 6.5", "B2", 6),
    "ielts 6.0": ("IELTS 6.0", "B2", 5),
    "toefl 110": ("TOEFL 110", "C2", 9),
    "toefl 100": ("TOEFL 100", "C1", 7),
    "toefl 90":  ("TOEFL 90",  "B2+", 6),
    "toefl 88":  ("TOEFL 88",  "B2", 6),
    "toefl 80":  ("TOEFL 80",  "B2", 5),
}

def get_language_score(level_str: str) -> int:
    """Dil seviyesinin sayısal skorunu döndür (0-10). Karşılaştırma için."""
    key = level_str.lower().strip()
    # Tüm map'lerde ara
    for maps in [GERMAN_LEVELS_MAP, ENGLISH_LEVELS_MAP]:
        for k, (_, _, score) in maps.items():
            if k in key or key in k:
                return score
    # CEFR seviyesi
    cefr_scores = {"c2": 10, "c1": 8, "b2": 6, "b1": 4, "a2": 2, "a1": 1}
    for cefr, score in cefr_scores.items():
        if cefr in key:
            return score
    return 0
```

---

## Belge Varlık Kontrolü

```python
from pathlib import Path

REQUIRED_DOCS = {
    "transkript.pdf":       "Transkript",
    "dil_belgesi.pdf":      "Dil belgesi",
    "motivasyon.docx":      "Motivasyon mektubu",
    "cv.pdf":               "CV",
}

OPTIONAL_DOCS = {
    "pasaport.pdf":         "Pasaport fotokopisi",
    "referans.pdf":         "Referans mektubu",
    "portfolyo.pdf":        "Portfolyo",
    "sertifikalar.pdf":     "Ek sertifikalar",
}

def check_documents(student_folder: str) -> dict:
    folder = Path(student_folder)
    result = {"present": [], "missing": [], "optional_present": []}
    for filename, label in REQUIRED_DOCS.items():
        if (folder / filename).exists():
            result["present"].append(label)
        else:
            result["missing"].append(label)
    for filename, label in OPTIONAL_DOCS.items():
        if (folder / filename).exists():
            result["optional_present"].append(label)
    result["completeness"] = len(result["present"]) / len(REQUIRED_DOCS)
    return result
```

---

## Hata Senaryoları ve Çözümleri

| Senaryo | Hata | Çözüm |
|---------|------|-------|
| PDF şifrelidir | PDF read error | Logla, kullanıcıya bildir |
| Transkript Türkçe tablo | Sütun başlıkları parse edilemez | Claude vision daha iyi parse eder |
| GPA farklı skala | "3.5/5.0" formatı | Skala tespiti ekle |
| Tarihli dil belgesi | IELTS 2 yıl geçerli | `validity_expiry` kontrol et |
| Çok sayfalı PDF | İlk sayfa boş | `page_count` kontrol et, tüm sayfaları gönder |
| Çözünürlük düşük | OCR kalitesi kötü | Hata mesajı logla, manuel giriş iste |
