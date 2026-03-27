# Almanya Üniversite Araştırma Referansı

## DAAD API — Birincil Kaynak

### JSON Endpoint (scraping gerekmez)
```python
import httpx

DAAD_API = "https://www2.daad.de/deutschland/studienangebote/international-programmes/api/solr/en/search.json"

async def search_daad(field: str, degree: str = "Master", lang: str = "") -> list:
    degree_map = {"Bachelor": "2", "Master": "4", "PhD": "6", "Ausbildung": ""}
    lang_map   = {"Almanca": "1", "İngilizce": "2"}

    params = {
        "q":     field,
        "degree": degree_map.get(degree, "4"),
        "lang":   lang_map.get(lang, ""),
        "rows":  "50",
        "start": "0",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(DAAD_API, params={k:v for k,v in params.items() if v})
        data = r.json()

    results = []
    for item in data.get("hits", {}).get("hit", []):
        f = item.get("fields", {})
        def get_first(key): return (f.get(key) or [""])[0] if isinstance(f.get(key), list) else f.get(key, "")
        results.append({
            "university": get_first("instname"),
            "city":       get_first("city"),
            "program":    get_first("name"),
            "degree":     get_first("degree"),
            "language":   get_first("lang"),
            "url":        get_first("link"),
            "deadline":   get_first("applicationDeadline"),
        })
    return results
```

### DAAD Filtre Parametreleri
| Parametre | Değerler |
|-----------|---------|
| `degree`  | 2=Bachelor, 4=Master, 6=PhD, 8=Ausbildung |
| `lang`    | 1=Almanca, 2=İngilizce |
| `fq[]`    | `city:Berlin`, `city:München` vb. |
| `rows`    | Maksimum 50 per istek |

---

## uni-assist — Yabancı Diploma Başvuruları

### uni-assist Gerektiren Üniversite Tespiti
```python
# uni-assist katılımcı listesi — scraping ile çekilir
UNI_ASSIST_URL = "https://www.uni-assist.de/en/universities/"

# Sonra her program için kontrol:
def check_uni_assist(html: str) -> bool:
    indicators = [
        "uni-assist", "uniassist",
        "über uni-assist bewerben",
        "apply through uni-assist",
        "Bewerbung über uni-assist"
    ]
    html_lower = html.lower()
    return any(kw in html_lower for kw in indicators)
```

### uni-assist Başvuru Akışı (öğrenciye anlatmak için)
```
1. uni-assist.de → Hesap aç
2. VPD belgesi talep et (Vorprüfungsdokumentation)
   → Transkript + diploma apostilli Türkçe ve Almanca
   → İşlem süresi: 6-12 hafta
3. VPD ile üniversiteye direkt başvur
4. Ücret: €75 (ilk üniversite) + €30 (her ek üniversite)
```

---

## Hochschulstart — NC'li Bölümler

### NC'li Bölümler (Merkezi Atama)
- Tıp (Medizin)
- Diş hekimliği (Zahnmedizin)
- Veteriner (Veterinärmedizin)
- Eczacılık (Pharmazie)

Bu bölümler için: `hochschulstart.de` → ortalamaların NC değerleri

### NC Değeri Çekme (Tavily ile)
```python
async def get_nc_value(university: str, program: str, year: int = 2025) -> str | None:
    query = f'Numerus Clausus {university} "{program}" {year} NC Wartesemester Abiturdurchschnitt'
    results = tavily.search(query, max_results=5)
    # Claude ile sonuçlardan NC değerini çıkar
    ...
```

### NC Yorumlama
```
NC 1.0 → En zor (sadece en iyiler)
NC 1.5 → Çok zor
NC 2.0 → Zor
NC 2.5 → Orta
NC 3.0 → Nispeten kolay
Zulassungsfrei → NC yok, herkes başvurabilir
```

### Almanya GPA Dönüştürme (Türkiye → Almanya)
```python
def convert_gpa_tr_to_de(gpa_tr: float, scale: str = "4.0") -> float:
    """
    Türkiye 4.0 skalasını Almanya 1.0-5.0 skalasına çevir.
    Almanya'da 1.0 en iyi, 4.0 geçer not, 5.0 başarısız.
    """
    if scale == "4.0":
        # Yaygın dönüşüm formülü (modified bavarian formula)
        if gpa_tr >= 3.5: return 1.0
        if gpa_tr >= 3.0: return round(1.0 + (3.5 - gpa_tr) / 0.5 * 0.3, 1)
        if gpa_tr >= 2.5: return round(1.3 + (3.0 - gpa_tr) / 0.5 * 0.7, 1)
        if gpa_tr >= 2.0: return round(2.0 + (2.5 - gpa_tr) / 0.5 * 1.0, 1)
        if gpa_tr >= 1.5: return round(3.0 + (2.0 - gpa_tr) / 0.5 * 0.7, 1)
        return 4.0
    return None

# Örnekler:
# 3.8/4.0 TR → 1.0 DE (Sehr gut)
# 3.0/4.0 TR → 1.3 DE (Gut)
# 2.5/4.0 TR → 2.0 DE (Gut)
# 2.0/4.0 TR → 3.0 DE (Befriedigend)
```

---

## Başvuru Tarihleri — Almanya Genel Takvim

### Standart Tarihler
| Dönem | Çoğu TU/Uni | FH (Fachhochschule) | Bazı Özel |
|-------|-------------|---------------------|-----------|
| **WiSe başvurusu** | 15 Ocak – 15 Temmuz | 15 Mart – 15 Temmuz | 1 Haziran |
| **SoSe başvurusu** | 1 Kasım – 15 Ocak | 1 Kasım – 15 Ocak | 1 Aralık |
| **uni-assist VPD** | 8 hafta öncesinden | 8 hafta öncesinden | — |

### WiSe vs SoSe Önerisi
```
WiSe (Ekim): Çoğu program için tercih edilir
  → Daha fazla program açık
  → Yeni başlangıçlar için uygun

SoSe (Nisan): Sınırlı programlar
  → Bazı FH'lar kabul eder
  → Sürekli alım yapan programlar
```

---

## Hedef Üniversite Siteleri — Başvuru Sayfaları

### TU9 Alliance (Teknik Üniversiteler)
```python
TU9_UNIVERSITIES = {
    "TU München":      "https://www.tum.de/en/studies/application/",
    "TU Berlin":       "https://www.tu.berlin/en/studying/application/",
    "TU Dresden":      "https://tu-dresden.de/studium/vor-dem-studium/bewerben",
    "RWTH Aachen":     "https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Bewerbung/",
    "KIT Karlsruhe":   "https://www.kit.edu/studium/bewerbung.php",
    "TU Darmstadt":    "https://www.tu-darmstadt.de/studieren/studieninteressierte/bewerbung/",
    "Uni Stuttgart":   "https://www.uni-stuttgart.de/studium/bewerbung/",
    "Uni Hannover":    "https://www.uni-hannover.de/de/studium/bewerbung/",
    "TU Braunschweig": "https://www.tu-braunschweig.de/studium/bewerbung",
}
```

### Bremen Bölgesi (AES'e Yakın — Öncelikli)
```python
BREMEN_UNIVERSITIES = {
    "Uni Bremen":        "https://www.uni-bremen.de/studium/bewerben-einschreiben",
    "Hochschule Bremen": "https://www.hs-bremen.de/studium/bewerbung/",
    "Jacobs University": "https://www.jacobs-university.de/study/undergraduate/admission",
    "Hochschule Bremerhaven": "https://www.hs-bremerhaven.de/studium/bewerbung/",
}
```

### HTML'den Veri Çıkarma — Almanca Anahtar Kelimeler
```python
KEYWORDS_DEADLINE = [
    "Bewerbungsfrist", "Bewerbungsschluss", "Anmeldefrist",
    "application deadline", "apply by", "Einreichungsfrist"
]

KEYWORDS_LANGUAGE = [
    "Sprachkenntnisse", "Sprachvoraussetzungen", "Deutschkenntnisse",
    "TestDaF", "DSH", "Goethe-Zertifikat", "Sprachnachweis",
    "IELTS", "TOEFL", "English proficiency"
]

KEYWORDS_NC = [
    "Numerus Clausus", "NC", "Zulassungsbeschränkung", "zulassungsfrei",
    "ohne NC", "freier Zugang", "Abiturdurchschnitt"
]

KEYWORDS_CONDITIONAL = [
    "bedingte Zulassung", "Bedingte Zulassung", "conditional admission",
    "Auflage", "unter Vorbehalt", "vorbehaltliche Zulassung"
]
```

---

## Dil Şartı Karşılaştırma Tablosu

### Almanca
| Sertifika | Seviye | Puan | Master için yeterli? |
|-----------|--------|------|----------------------|
| TestDaF   | TDN 4  | 16+  | ✅ Evet |
| TestDaF   | TDN 3  | 12   | ⚠️ Bazı FH'lar |
| DSH       | DSH-2  | —    | ✅ Evet |
| DSH       | DSH-1  | —    | ⚠️ Bazı FH'lar |
| Goethe    | C1     | —    | ✅ Evet |
| Goethe    | B2     | —    | ❌ Çoğu uni için yetersiz |
| ÖSD       | C1     | —    | ✅ Evet |
| telc      | C1     | —    | ✅ Evet |

### İngilizce
| Sertifika | Puan | Master için yeterli? |
|-----------|------|----------------------|
| IELTS     | 6.5+ | ✅ Evet |
| IELTS     | 6.0  | ⚠️ Bazı programlar |
| TOEFL iBT | 88+  | ✅ Evet |
| TOEFL iBT | 80   | ⚠️ Bazı programlar |
| Cambridge | C1   | ✅ Evet |

---

## Claude ile HTML Parse — Prompt Şablonu

```python
PARSE_PROMPT = """
Sen Almanya üniversite başvuru uzmanısın.
Aşağıdaki metin {university} üniversitesinin {program} programına ait.

METİN (ilk 10.000 karakter):
{text}

SADECE aşağıdaki JSON'u döndür, başka metin ekleme:
{{
  "city": "şehir veya null",
  "language": "Almanca/İngilizce/Her İkisi",
  "deadline_wise": "DD.MM.YYYY veya 'DD. Monat' veya null",
  "deadline_sose": "DD.MM.YYYY veya null",
  "german_requirement": "TestDaF 16 / DSH-2 / Goethe C1 vb. veya null",
  "english_requirement": "IELTS 6.5 / TOEFL 88 vb. veya null",
  "nc_value": "sayısal değer örn 2.3 veya 'zulassungsfrei' veya null",
  "min_gpa": "Almanya skalasında minimum not veya null",
  "uni_assist_required": true/false,
  "conditional_admission": true/false,
  "required_documents": ["belge1", "belge2"],
  "notes": "kritik notlar veya null"
}}
"""
```

---

## Yaygın Hatalar ve Çözümleri

| Hata | Neden | Çözüm |
|------|-------|-------|
| Sayfa 403 döner | Bot tespiti | Playwright → ScraperAPI |
| İçerik Almanca, parse başarısız | Claude Türkçe prompt + Almanca HTML | Prompt'ta "Almanca metin olabilir" ekle |
| Deadline bulunamıyor | Dinamik sayfa | `wait_until="networkidle"` |
| NC değeri yanlış | Eski yıl verisi | Yıl filtresi: "2024 2025" |
| uni-assist tespiti hatalı | Üniversite sayfası değil uni-assist | Domain kontrolü ekle |
