# 🎓 AES Üniversite Araştırma Ajanı — CLAUDE.md

> **Proje:** Almanya Eğitim Serüveni (AES) için öğrenci profillerine göre
> Almanya'daki üniversiteleri araştıran, uygunluğu değerlendiren ve
> yapılandırılmış rapor üreten otonom bir Claude Code ajanı.

---

## 📋 İÇİNDEKİLER

1. [Proje Genel Bakışı](#1-proje-genel-bakışı)
2. [Klasör & Dosya Yapısı](#2-klasör--dosya-yapısı)
3. [Gerekli API'lar & Anahtarlar](#3-gerekli-apiler--anahtarlar)
4. [Bağımlılıklar & Kurulum](#4-bağımlılıklar--kurulum)
5. [Anti-Bot Önlemlerini Aşma Stratejileri](#5-anti-bot-önlemlerini-aşma-stratejileri)
6. [Hedef Veri Kaynakları & Kazıma Stratejileri](#6-hedef-veri-kaynakları--kazıma-stratejileri)
7. [Ajan Akışı (Step-by-Step)](#7-ajan-akışı-step-by-step)
8. [Öğrenci Profili Word Şablonu](#8-öğrenci-profili-word-şablonu)
9. [Çıktı Formatları](#9-çıktı-formatları)
10. [Hata Yönetimi & Güvenilirlik](#10-hata-yönetimi--güvenilirlik)
11. [Çalıştırma Komutları](#11-çalıştırma-komutları)
12. [Maliyet & Rate Limit Yönetimi](#12-maliyet--rate-limit-yönetimi)
13. [Gelecek Geliştirmeler](#13-gelecek-geliştirmeler)

---

## 1. PROJE GENEL BAKIŞI

### Ne yapıyor bu ajan?

```
öğrenci/[AdSoyad]/profil.docx  ←── Danışman bu dosyayı doldurur
        │
        ▼
[AJAN BAŞLAR]
        │
        ├── 1. Word dosyasını okur → öğrenci profilini çıkarır
        │
        ├── 2. Çok katmanlı web araması yapar:
        │       ├── DAAD Programme Finder
        │       ├── Hochschulstart / Stiftung für Hochschulzulassung
        │       ├── uni-assist.de
        │       └── Her üniversitenin kendi sitesi
        │
        ├── 3. Her program için şunları toplar:
        │       ├── Başvuru tarihleri (WiSe / SoSe)
        │       ├── Dil şartları (TestDaF, DSH, IELTS, TOEFL)
        │       ├── GPA / Not eşiği (Numerus Clausus)
        │       ├── Ön koşul dersler / portföy
        │       ├── uni-assist mi yoksa direkt mi başvuru?
        │       └── Şartlı kabul (Bedingte Zulassung) mevcut mu?
        │
        └── 4. Çıktı üretir:
                ├── öğrenci/[AdSoyad]/sonuc_raporu.docx
                ├── öğrenci/[AdSoyad]/universite_listesi.xlsx
                └── öğrenci/[AdSoyad]/ozet.md
```

### Kapsam

- **Hedef ülke:** Almanya (tüm eyaletler)
- **Program türleri:** Bachelor, Master, Ausbildung
- **Dil:** Almanca ve İngilizce programlar
- **Başvuru kanalları:** Direkt, uni-assist, hochschulstart

---

## 2. KLASÖR & DOSYA YAPISI

```
aes-agent/
│
├── CLAUDE.md                    ← Bu dosya (ajanın ana talimatları)
│
├── .env                         ← API anahtarları (git'e commit ETME)
├── .gitignore
│
├── src/
│   ├── agent.py                 ← Ana ajan orchestrator
│   ├── reader.py                ← Word dosyası okuyucu
│   ├── scraper.py               ← Web kazıyıcı (Playwright)
│   ├── searcher.py              ← Tavily / Serper arama modülü
│   ├── parser.py                ← HTML → yapılandırılmış veri
│   ├── evaluator.py             ← Uygunluk değerlendirici
│   └── reporter.py              ← Rapor üretici (docx + xlsx)
│
├── templates/
│   ├── ogrenci_profil_sablonu.docx   ← Danışmanın dolduracağı şablon
│   └── rapor_sablonu.docx            ← Çıktı rapor şablonu
│
├── cache/
│   └── [domain]/[hash].json     ← Sayfa önbelleği (gereksiz istek önleme)
│
├── logs/
│   └── [tarih]/[ogrenci].log    ← Detaylı çalışma logları
│
└── ogrenciler/
    ├── AhmetYilmaz/
    │   ├── profil.docx          ← Danışman tarafından doldurulur
    │   ├── transkript.pdf       ← Öğrenci belgesi
    │   ├── dil_belgesi.pdf      ← TestDaF / IELTS vb.
    │   └── [çıktılar buraya]
    │
    └── ZeynepKaya/
        └── ...
```

---

## 3. GEREKLİ API'LER & ANAHTARLAR

### .env dosyası şablonu

```bash
# ─── ARAMA API'LARI ───────────────────────────────────────────────
# Tavily AI — en iyi seçenek, LLM için optimize edilmiş arama
# Fiyat: Aylık 1.000 ücretsiz istek, sonrası $0.001/istek
# Kayıt: https://tavily.com
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxxxxxx

# Serper.dev — Google'ın gerçek sonuçları, ucuz
# Fiyat: Aylık 2.500 ücretsiz istek
# Kayıt: https://serper.dev
SERPER_API_KEY=xxxxxxxxxxxxxxxxxxxx

# ScraperAPI — Anti-bot bypass + proxy rotasyonu
# Fiyat: Aylık 5.000 ücretsiz istek
# Kayıt: https://scraperapi.com
SCRAPER_API_KEY=xxxxxxxxxxxxxxxxxxxx

# ─── CLAUDE API ───────────────────────────────────────────────────
# claude-opus-4 veya claude-sonnet-4 — bilgi çıkarma için
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

# ─── PROXY SERVİSİ (isteğe bağlı, daha güçlü bypass için) ────────
# Bright Data — Residential proxy, en güçlü çözüm
# Fiyat: Pay-as-you-go, ~$8.4/GB
# Kayıt: https://brightdata.com
BRIGHT_DATA_USERNAME=xxxxxxxxxxxxxxxxxxxx
BRIGHT_DATA_PASSWORD=xxxxxxxxxxxxxxxxxxxx
BRIGHT_DATA_HOST=brd.superproxy.io
BRIGHT_DATA_PORT=33335

# ─── OPSİYONEL: OXYLABS (Bright Data alternatifi) ────────────────
OXYLABS_USERNAME=xxxxxxxxxxxxxxxxxxxx
OXYLABS_PASSWORD=xxxxxxxxxxxxxxxxxxxx
```

### API Karşılaştırma Tablosu

| API | Ne için | Aylık Ücretsiz | Ücretli | Öncelik |
|-----|---------|---------------|---------|---------|
| **Tavily** | Akıllı web arama | 1.000 istek | $0.001/istek | ⭐⭐⭐ EN ÖNEMLİ |
| **Serper** | Google arama | 2.500 istek | $50/50K istek | ⭐⭐ İkincil |
| **ScraperAPI** | Anti-bot bypass | 5.000 istek | $29/100K | ⭐⭐ Gerekli |
| **Bright Data** | Residential proxy | Yok | ~$8.4/GB | ⭐ İsteğe bağlı |
| **Anthropic** | Veri çıkarma & analiz | $5 kredi | $3-15/1M token | ⭐⭐⭐ Çekirdek |

---

## 4. BAĞIMLILIKLAR & KURULUM

### Sistem gereksinimleri
- Python 3.11+
- Node.js 18+ (Playwright için)
- 4GB+ RAM (çoklu tarayıcı için)
- macOS / Linux / Windows (WSL2 önerilir)

### Kurulum adımları

```bash
# 1. Projeyi oluştur
mkdir aes-agent && cd aes-agent

# 2. Python sanal ortamı
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 3. Python paketleri
pip install \
  anthropic \           # Claude API
  tavily-python \       # Tavily arama
  playwright \          # Web scraping
  python-docx \         # Word dosyası okuma/yazma
  openpyxl \            # Excel çıktısı
  beautifulsoup4 \      # HTML parse
  lxml \                # Hızlı HTML parser
  httpx \               # Async HTTP
  fake-useragent \      # User-agent rotasyonu
  python-dotenv \       # .env yönetimi
  rich \                # Terminal UI
  tenacity \            # Retry logic
  pydantic \            # Veri doğrulama
  PyPDF2 \              # PDF okuma (transkript)
  camelot-py \          # PDF tablo çıkarma
  pandas                # Veri manipülasyonu

# 4. Playwright browser'ları kur
playwright install chromium firefox
playwright install-deps  # Linux için sistem bağımlılıkları

# 5. .env dosyasını oluştur
cp .env.example .env
# API anahtarlarını .env'e gir

# 6. Ajanı test et
python src/agent.py --test
```

---

## 5. ANTI-BOT ÖNLEMLERİNİ AŞMA STRATEJİLERİ

Bu bölüm **en kritik** kısım. Almanya üniversite siteleri genelde Cloudflare,
CAPTCHA veya rate limiting kullanır.

### 5.1 Playwright Stealth Konfigürasyonu

```python
# src/scraper.py içinde kullan

from playwright.async_api import async_playwright
import asyncio

STEALTH_ARGS = [
    "--disable-blink-features=AutomationControlled",  # Bot tespitini engelle
    "--disable-infobars",
    "--window-size=1920,1080",
    "--start-maximized",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
]

async def get_stealth_browser():
    p = await async_playwright().start()
    browser = await p.chromium.launch(
        headless=True,          # False yap → görsel debug için
        args=STEALTH_ARGS
    )
    context = await browser.new_context(
        viewport={"width": 1920, "height": 1080},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0.0.0 Safari/537.36",
        locale="de-DE",            # Almanca browser gibi görün
        timezone_id="Europe/Berlin",
        geolocation={"latitude": 53.0793, "longitude": 8.8017},  # Bremen
        permissions=["geolocation"],
        extra_http_headers={
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
        }
    )
    # navigator.webdriver = false yap
    await context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        Object.defineProperty(navigator, 'languages', {get: () => ['de-DE', 'de', 'en']});
        Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
    """)
    return browser, context
```

### 5.2 Katmanlı Bypass Stratejisi

Bot tespiti ile karşılaşınca şu sırayı izle:

```
Seviye 1: Doğrudan istek (httpx)
    → Başarısız olursa ↓
Seviye 2: Playwright stealth (headless Chromium)
    → Başarısız olursa ↓
Seviye 3: ScraperAPI üzerinden istek
    → Başarısız olursa ↓
Seviye 4: Bright Data residential proxy + Playwright
    → Hâlâ başarısız → Manuel not ekle, atla
```

```python
# src/scraper.py

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10))
async def fetch_page(url: str, level: int = 1) -> str:
    """Katmanlı bypass ile sayfa çekme."""
    
    if level == 1:
        # Doğrudan httpx
        headers = {"User-Agent": get_random_ua()}
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers=headers, follow_redirects=True)
            if r.status_code == 200:
                return r.text
            raise Exception(f"HTTP {r.status_code}")
    
    elif level == 2:
        # Playwright stealth
        return await playwright_fetch(url)
    
    elif level == 3:
        # ScraperAPI
        api_url = f"http://api.scraperapi.com?api_key={SCRAPER_API_KEY}&url={url}&render=true"
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(api_url)
            return r.text
    
    elif level == 4:
        # Bright Data proxy
        return await playwright_fetch(url, proxy={
            "server": f"http://{BRIGHT_DATA_HOST}:{BRIGHT_DATA_PORT}",
            "username": BRIGHT_DATA_USERNAME,
            "password": BRIGHT_DATA_PASSWORD,
        })
```

### 5.3 İnsan Davranışı Simülasyonu

```python
import asyncio, random

async def human_like_behavior(page):
    """Bot gibi görünmemek için insan davranışı simüle et."""
    
    # Rastgele scroll
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight * Math.random())")
    await asyncio.sleep(random.uniform(0.5, 2.0))
    
    # Mouse hareketi
    await page.mouse.move(
        random.randint(100, 800),
        random.randint(100, 600)
    )
    
    # Okuma süresi bekle (sayfa uzunluğuna göre)
    await asyncio.sleep(random.uniform(2.0, 5.0))
```

### 5.4 Rate Limiting & Bekleme Stratejisi

```python
# Aynı domain'e istekler arasında bekleme
DOMAIN_DELAYS = {
    "daad.de":              (3, 7),    # 3-7 saniye arası bekle
    "uni-assist.de":        (5, 10),
    "hochschulstart.de":    (4, 8),
    "default":              (2, 5),
}

async def respectful_delay(domain: str):
    min_s, max_s = DOMAIN_DELAYS.get(domain, DOMAIN_DELAYS["default"])
    await asyncio.sleep(random.uniform(min_s, max_s))
```

### 5.5 Önbellek Sistemi

Her başarılı çekim → önbelleğe kaydet.
Aynı URL 24 saat içinde tekrar istenmezse önbellekten döndür.

```python
import hashlib, json
from pathlib import Path
from datetime import datetime, timedelta

CACHE_DIR = Path("cache")
CACHE_TTL_HOURS = 24

def get_cached(url: str) -> str | None:
    key = hashlib.md5(url.encode()).hexdigest()
    cache_file = CACHE_DIR / f"{key}.json"
    if cache_file.exists():
        data = json.loads(cache_file.read_text())
        cached_at = datetime.fromisoformat(data["cached_at"])
        if datetime.now() - cached_at < timedelta(hours=CACHE_TTL_HOURS):
            return data["content"]
    return None

def save_cache(url: str, content: str):
    CACHE_DIR.mkdir(exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    (CACHE_DIR / f"{key}.json").write_text(json.dumps({
        "url": url,
        "cached_at": datetime.now().isoformat(),
        "content": content
    }))
```

---

## 6. HEDEF VERİ KAYNAKLARI & KAZIMA STRATEJİLERİ

### 6.1 DAAD Programme Finder (EN ÖNEMLİ KAYNAK)

```
URL: https://www2.daad.de/deutschland/studienangebote/international-programmes/en/
API: https://www2.daad.de/deutschland/studienangebote/international-programmes/en/?
     detail=true&q=BÖLÜM&degree=2&lang=2&admissionsemester=2&page=1
```

**Strateji:** DAAD'ın kendi filtre API'sini kullan — scraping yerine JSON endpoint.

```python
DAAD_API = "https://www2.daad.de/deutschland/studienangebote/international-programmes/api/solr/en/search.json"

params = {
    "q": student.field_of_study,          # örn: "electrical engineering"
    "degree": "2",                          # 1=Bachelor, 2=Master
    "lang": "2",                            # 2=İngilizce program
    "admissionsemester": "",                # Boş = tümü
    "fq[]": "langDE:true",                  # Almanca seçenek
    "rows": "50",
    "start": "0",
}
```

**Çıkarılacak veri:**
- `name` → Program adı
- `university` → Üniversite adı
- `degree` → Derece türü
- `language` → Eğitim dili
- `applicationDeadline` → Başvuru son tarihi
- `tuitionFee` → Ücret
- `url` → Detay sayfası URL'si

### 6.2 Hochschulstart / Stiftung (NC'li bölümler)

```
URL: https://www.hochschulstart.de/
Kapsam: Tıp, Diş, Eczacılık, Veteriner (merkezi atama)
```

**Strateji:** Bu site scraping'e kapalı → Tavily arama ile NC değerlerini çek.

```python
query = f"Numerus Clausus {university} {study_program} {year} site:hochschulstart.de OR site:uni.de"
results = tavily.search(query, max_results=5)
```

### 6.3 uni-assist.de

```
URL: https://www.uni-assist.de/en/tools/check-your-chances/
Kapsam: Yabancı diplomaların denklik kontrolü
```

**Önemli:** uni-assist'te başvuru yapılacak üniversite ve bölüm listesi var.

```python
# uni-assist participant list
UNI_ASSIST_LIST_URL = "https://www.uni-assist.de/en/universities/"
# Buradan hangi üniversitelerin uni-assist gerektirdiğini çek
```

### 6.4 Bireysel Üniversite Siteleri

Her üniversitenin uluslararası öğrenci / Bewerbung sayfasına git.

**Yaygın URL desenleri:**
```
https://www.uni-[name].de/studium/international/
https://www.tu-[name].de/studieren/bewerben/
https://www.[name].de/en/study/application/
https://www.[name].de/studium/bewerbung/
```

**Claude ile HTML'den veri çıkarma:**
```python
async def extract_with_claude(html: str, university: str, program: str) -> dict:
    """Claude kullanarak HTML'den yapılandırılmış veri çıkar."""
    
    prompt = f"""
Sen Almanya üniversite başvuru uzmanısın.
Aşağıdaki HTML, {university} üniversitesinin {program} bölümüne ait başvuru sayfasından.

HTML:
{html[:8000]}  # Token limiti için kırp

Şunları JSON formatında çıkar:
{{
  "application_deadline_wise": "Kış dönemi başvuru son tarihi (DD.MM.YYYY veya null)",
  "application_deadline_sose": "Yaz dönemi başvuru son tarihi (DD.MM.YYYY veya null)",
  "language_requirements": {{
    "german": "DSH-2 / TestDaF 16 / Goethe C1 vb. veya null",
    "english": "IELTS 6.5 / TOEFL 88 vb. veya null"
  }},
  "nc_value": "NC değeri veya 'zulassungsfrei' veya null",
  "min_gpa": "Minimum not ortalaması (Almanya skalası) veya null",
  "uni_assist_required": true/false,
  "conditional_admission": true/false,
  "required_documents": ["liste"],
  "notes": "Önemli notlar"
}}

Eğer bilgi bulunamazsa null yaz. Sadece JSON döndür.
"""
    
    response = anthropic_client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    )
    return json.loads(response.content[0].text)
```

### 6.5 Hedef Üniversite Listesi (Başlangıç için)

```python
TARGET_UNIVERSITIES = {
    # Teknik Üniversiteler (TU9 Alliance)
    "TU München":       "https://www.tum.de/en/studies/application/",
    "TU Berlin":        "https://www.tu.berlin/en/studying/application/",
    "TU Dresden":       "https://tu-dresden.de/studium/vor-dem-studium/bewerben",
    "RWTH Aachen":      "https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Bewerbung/",
    "KIT Karlsruhe":    "https://www.kit.edu/studium/bewerbung.php",
    "TU Darmstadt":     "https://www.tu-darmstadt.de/studieren/studieninteressierte/bewerbung/",
    "Uni Stuttgart":    "https://www.uni-stuttgart.de/studium/bewerbung/",
    "Uni Hannover":     "https://www.uni-hannover.de/de/studium/bewerbung/",
    "TU Braunschweig":  "https://www.tu-braunschweig.de/studium/bewerbung",
    
    # Bremen Bölgesi (AES'in bulunduğu yer — öncelikli)
    "Uni Bremen":       "https://www.uni-bremen.de/studium/bewerben-einschreiben",
    "Hochschule Bremen":"https://www.hs-bremen.de/studium/bewerbung/",
    "Jacobs University":"https://www.jacobs-university.de/study/undergraduate/admission",
    
    # Diğer Önde Gelen Üniversiteler
    "LMU München":      "https://www.lmu.de/en/study/application/",
    "Heidelberg":       "https://www.uni-heidelberg.de/en/study/application",
    "FU Berlin":        "https://www.fu-berlin.de/studium/bewerbung/",
    "HU Berlin":        "https://www.hu-berlin.de/de/studium/beratung/angebote/studienbuero",
    "Uni Hamburg":      "https://www.uni-hamburg.de/studium/bewerbung.html",
    "Uni Frankfurt":    "https://www.goethe-university-frankfurt.de/studium/bewerbung",
    "Uni Köln":         "https://verwaltung.uni-koeln.de/studbuero/content/bewerbung/",
    "Uni Bonn":         "https://www.uni-bonn.de/de/studium/studieren-in-bonn/bewerbung",
    "Uni Münster":      "https://www.uni-muenster.de/studium/bewerbung/",
    "Uni Göttingen":    "https://www.uni-goettingen.de/de/bewerbung/57854.html",
    "Uni Freiburg":     "https://www.uni-freiburg.de/go/bewerben",
    "Uni Tübingen":     "https://uni-tuebingen.de/studium/bewerbung-und-immatrikulation/",
    "Uni Würzburg":     "https://www.uni-wuerzburg.de/studium/bewerbung/",
    "Uni Mainz":        "https://www.uni-mainz.de/studium/bewerbung/",
    "Uni Mannheim":     "https://www.uni-mannheim.de/studium/bewerben/",
    "Uni Erlangen":     "https://www.fau.de/studium/vor-dem-studium/bewerbung/",
}
```

---

## 7. AJAN AKIŞI (STEP-BY-STEP)

### Tam ajan kodu iskeleti

```python
# src/agent.py

import asyncio
from pathlib import Path
from rich.console import Console
from rich.progress import Progress

console = Console()

async def run_agent(student_folder: str):
    """Ana ajan fonksiyonu."""
    
    console.print(f"\n🎓 [bold blue]AES Üniversite Araştırma Ajanı[/bold blue]")
    console.print(f"📂 Öğrenci: [yellow]{student_folder}[/yellow]\n")
    
    # ─── ADIM 1: Öğrenci profilini oku ───────────────────────────────
    console.print("📖 [1/5] Profil okunuyor...")
    profile = await read_student_profile(student_folder)
    console.print(f"   ✅ {profile.name} profili yüklendi")
    console.print(f"   📚 İstenen bölüm: {profile.desired_field}")
    console.print(f"   🎯 Derece: {profile.degree_type}")
    
    # ─── ADIM 2: DAAD'da ara ─────────────────────────────────────────
    console.print("\n🔍 [2/5] DAAD veritabanı taranıyor...")
    daad_programs = await search_daad(profile)
    console.print(f"   ✅ {len(daad_programs)} program bulundu")
    
    # ─── ADIM 3: Tavily ile ek arama ──────────────────────────────────
    console.print("\n🌐 [3/5] Genişletilmiş web araması yapılıyor...")
    web_programs = await search_web_tavily(profile)
    
    # Duplikaları birleştir
    all_programs = merge_and_deduplicate(daad_programs, web_programs)
    console.print(f"   ✅ Toplam {len(all_programs)} benzersiz program")
    
    # ─── ADIM 4: Her program için detay sayfasını tara ────────────────
    console.print(f"\n🕷️  [4/5] {len(all_programs)} program detayları alınıyor...")
    
    detailed_programs = []
    with Progress() as progress:
        task = progress.add_task("Taranıyor...", total=len(all_programs))
        
        for program in all_programs:
            detail = await scrape_program_details(program)
            eligibility = evaluate_eligibility(profile, detail)
            detailed_programs.append({**detail, "eligibility": eligibility})
            progress.advance(task)
    
    # ─── ADIM 5: Rapor üret ───────────────────────────────────────────
    console.print("\n📊 [5/5] Rapor oluşturuluyor...")
    
    # Uygunluğa göre sırala: Uygun > Şartlı > Uygun Değil
    ranked = sort_by_eligibility(detailed_programs)
    
    output_dir = Path("ogrenciler") / student_folder
    await generate_word_report(ranked, profile, output_dir)
    await generate_excel_report(ranked, profile, output_dir)
    await generate_summary_md(ranked, profile, output_dir)
    
    console.print(f"\n✅ [bold green]Tamamlandı![/bold green]")
    console.print(f"   📄 Rapor: {output_dir}/sonuc_raporu.docx")
    console.print(f"   📊 Liste: {output_dir}/universite_listesi.xlsx")
```

### Uygunluk değerlendirme mantığı

```python
def evaluate_eligibility(profile: StudentProfile, program: ProgramDetail) -> dict:
    """Öğrencinin programa uygunluğunu değerlendir."""
    
    issues = []
    passed = []
    
    # 1. Dil şartı kontrolü
    if program.language_german_required:
        if profile.german_level and satisfies_language(profile.german_level, program.german_requirement):
            passed.append(f"Almanca: {profile.german_level} ✅")
        else:
            issues.append(f"Almanca şartı: {program.german_requirement} — Mevcut: {profile.german_level or 'Yok'}")
    
    if program.language_english_required:
        if profile.english_level and satisfies_language(profile.english_level, program.english_requirement):
            passed.append(f"İngilizce: {profile.english_level} ✅")
        else:
            issues.append(f"İngilizce şartı: {program.english_requirement}")
    
    # 2. Not ortalaması kontrolü
    if program.min_gpa and profile.gpa:
        if profile.gpa >= program.min_gpa:
            passed.append(f"GPA: {profile.gpa} ≥ {program.min_gpa} ✅")
        else:
            issues.append(f"GPA yetersiz: {profile.gpa} < {program.min_gpa}")
    
    # 3. Başvuru tarihi kontrolü
    if program.deadline:
        days_left = (program.deadline - date.today()).days
        if days_left > 0:
            passed.append(f"Başvuru açık: {days_left} gün kaldı")
        else:
            issues.append(f"Başvuru süresi dolmuş ({program.deadline})")
    
    # Sonuç
    if not issues:
        status = "UYGUN"
        color = "green"
    elif len(issues) == 1 and program.conditional_admission:
        status = "ŞARTLI_UYGUN"
        color = "yellow"
    else:
        status = "UYGUN_DEGİL"
        color = "red"
    
    return {
        "status": status,
        "color": color,
        "passed_checks": passed,
        "issues": issues,
    }
```

---

## 8. ÖĞRENCİ PROFİLİ WORD ŞABLONU

Danışman (sen) aşağıdaki bilgileri dolduracak.
Ajan bu Word dosyasını okuyarak tüm kriterleri çıkaracak.

### profil.docx içeriği

```
══════════════════════════════════════════════════
         AES — ÖĞRENCİ DANIŞMANLIK PROFİLİ
══════════════════════════════════════════════════

■ KİŞİSEL BİLGİLER
Ad Soyad:           [Ahmet Yılmaz]
Doğum Tarihi:       [15.03.2001]
Milliyet:           [Türk]
E-posta:            [ahmet@email.com]
Telefon:            [+90 555 000 0000]

■ EĞİTİM DURUMU
Mevcut/Son Okul:    [İstanbul Teknik Üniversitesi]
Bölüm:              [Elektrik-Elektronik Mühendisliği]
Not Ortalaması:     [3.2/4.0]  veya  [2.8 (Almanya skalası)]
Mezuniyet Tarihi:   [Haziran 2024]  veya  [Devam ediyor - 6. dönem]
Diploma Durumu:     [Alındı / Haziran 2025'te alınacak]

■ DİL BELGELERİ
Almanca:            [TestDaF 16 / DSH-2 / Goethe B2 / Yok]
İngilizce:          [IELTS 6.5 / TOEFL 88 / Yok]
Diğer:              [...]

■ ALMANYA'DA HEDEF BÖLÜM
İstenen Alan:       [Makine Mühendisliği / Yapay Zeka / İşletme vb.]
Derece Türü:        [Master / Bachelor / Ausbildung]
Program Dili:       [Almanca / İngilizce / Fark etmez]
Tercih Şehirler:    [München, Berlin, Bremen — ya da "Fark etmez"]
Başlangıç Dönemi:   [WiSe 2025 / SoSe 2026]

■ ÖNCELİKLER VE ÖZEL ŞARTLAR
Ücretsiz/Düşük Ücret: [Evet — Önemli / Hayır]
Şehir Büyüklüğü:    [Büyük şehir / Küçük şehir / Fark etmez]
Üniversite Türü:    [TU / FH (Fachhochschule) / Fark etmez]
NC'li Bölüm Kabul:  [Evet / Hayır]
Şartlı Kabul:       [Evet kabul ediyorum / Hayır, kesin kabul istiyorum]
Part-time İmkanı:   [Önemli / Fark etmez]

■ EK BİLGİLER / DANIŞMAN NOTLARI
[Serbest metin: Öğrencinin özel durumu, hedefleri, kısıtlamaları vb.]

■ MEVCUT BELGELER (Klasörde bulunanlar)
[ ] Transkript (transkript.pdf)
[ ] Dil belgesi (dil_belgesi.pdf)
[ ] Motivasyon mektubu taslağı (motivasyon.docx)
[ ] CV (cv.pdf)
[ ] Pasaport fotokopisi

══════════════════════════════════════════════════
```

---

## 9. ÇIKTI FORMATLARI

### 9.1 Word Raporu (sonuc_raporu.docx)

```
BÖLÜM 1: ÖĞRENCİ PROFİL ÖZETİ
  - Ad, hedef alan, dil seviyeleri, GPA

BÖLÜM 2: UYGUN PROGRAMLAR (Yeşil)
  Her program için:
    • Üniversite ve şehir
    • Program adı ve dili
    • Başvuru tarihleri (WiSe/SoSe)
    • Dil şartları
    • Başvuru kanalı (uni-assist / direkt)
    • Direkt başvuru linki
    • ✅ Neden uygun?

BÖLÜM 3: ŞARTLI UYGUN PROGRAMLAR (Sarı)
  Her program için yukarıdakiler +
    • ⚠️ Hangi şart eksik?
    • Nasıl tamamlanabilir?

BÖLÜM 4: UYGUN OLMAYAN PROGRAMLAR (Kırmızı)
  Kısa liste, neden uygun olmadığı

BÖLÜM 5: ÖNERİLER
  - Danışman (ajan) önerileri
  - Öncelikli başvurulacak 5 program
  - Takvim önerisi

BÖLÜM 6: SONRAKİ ADIMLAR
  - Eksik belgeler
  - uni-assist kaydı gerekiyor mu?
  - Motivasyon mektubu gereken programlar
```

### 9.2 Excel Listesi (universite_listesi.xlsx)

| Üniversite | Şehir | Program | Dil | WiSe Deadline | SoSe Deadline | Dil Şartı | NC | uni-assist | Uygunluk | Link |
|---|---|---|---|---|---|---|---|---|---|---|
| TU München | München | Elektrik Müh. | Almanca | 15.01 | 15.07 | TestDaF 16 | 1.9 | Evet | ✅ Uygun | [link] |
| Uni Bremen | Bremen | Elektrik Müh. | Almanca | 15.01 | - | DSH-2 | Yok | Hayır | ✅ Uygun | [link] |

---

## 10. HATA YÖNETİMİ & GÜVENİLİRLİK

```python
# Tüm modüllerde kullan

import logging
from datetime import datetime

def setup_logging(student_name: str):
    log_dir = Path("logs") / datetime.now().strftime("%Y-%m-%d")
    log_dir.mkdir(parents=True, exist_ok=True)
    
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_dir / f"{student_name}.log"),
            logging.StreamHandler()
        ]
    )

# Her kazıma işleminde şunu kaydet:
# - URL
# - HTTP durum kodu
# - Kullanılan bypass seviyesi
# - Çıkarılan veri kalitesi (tam/kısmi/başarısız)
# - Süre
```

### Veri güvenilirlik skoru

Her üniversite kaydına güvenilirlik skoru ekle:

```python
def calculate_confidence(sources: list) -> float:
    """Veri güvenilirliğini hesapla (0.0 - 1.0)."""
    score = 0.0
    if "university_official_site" in sources: score += 0.5
    if "daad_database" in sources:            score += 0.3
    if "tavily_search" in sources:            score += 0.1
    if "uni_assist_list" in sources:          score += 0.1
    return min(score, 1.0)
```

---

## 11. ÇALIŞTIRMA KOMUTLARI

```bash
# Tek öğrenci için çalıştır
python src/agent.py --student "AhmetYilmaz"

# Tüm öğrenciler için toplu çalıştır
python src/agent.py --all

# Sadece DAAD'ı tara (hızlı mod)
python src/agent.py --student "AhmetYilmaz" --quick

# Belirli üniversiteleri tara
python src/agent.py --student "AhmetYilmaz" --universities "TU München,Uni Bremen"

# Önbelleği temizle ve yeniden tara
python src/agent.py --student "AhmetYilmaz" --clear-cache

# Test modu (gerçek istek yapmadan)
python src/agent.py --test

# Debug modu (Playwright görünür pencerede çalışır)
python src/agent.py --student "AhmetYilmaz" --headed
```

---

## 12. MALİYET & RATE LIMIT YÖNETİMİ

### Tahmini maliyet (tek öğrenci başına)

| Kaynak | İstek Sayısı | Maliyet |
|--------|-------------|---------|
| Tavily araması | ~20 istek | ~$0.02 |
| ScraperAPI (zor siteler) | ~10 istek | ~$0.03 |
| Claude API (veri çıkarma) | ~50 üniversite × 500 token | ~$0.10 |
| **Toplam** | | **~$0.15/öğrenci** |

### Aylık limit yönetimi

```python
# Rate limit takip sistemi
DAILY_LIMITS = {
    "tavily": 33,       # 1000/ay ÷ 30 gün
    "serper": 83,       # 2500/ay ÷ 30 gün
    "scraper_api": 166, # 5000/ay ÷ 30 gün
}

# Önce önbellekten dön, limit aşılırsa uyar
```

---

## 13. GELECEK GELİŞTİRMELER

### Faz 2 (1-2 ay sonra)
- [ ] Otomatik uni-assist ön kayıt formu doldurma
- [ ] Motivasyon mektubu taslağı oluşturma (Claude ile)
- [ ] E-posta ile öğrenciye otomatik rapor gönderme
- [ ] Notion öğrenci veritabanına otomatik kayıt

### Faz 3 (3-6 ay sonra)
- [ ] Web arayüzü (danışman paneli)
- [ ] Öğrenci kendi profilini doldurabilir
- [ ] Başvuru takip sistemi + deadline hatırlatıcıları
- [ ] Başarı oranı analizi (geçmiş öğrenci verisiyle)

---

## ⚡ HIZLI BAŞLANGIÇ (5 Adım)

```bash
# 1. Projeyi kur
git clone [repo] aes-agent && cd aes-agent
pip install -r requirements.txt && playwright install chromium

# 2. API anahtarlarını gir
cp .env.example .env && nano .env

# 3. İlk öğrenci klasörünü oluştur
mkdir -p ogrenciler/TestOgrenci
cp templates/ogrenci_profil_sablonu.docx ogrenciler/TestOgrenci/profil.docx

# 4. profil.docx'u doldur (Word ile aç)
open ogrenciler/TestOgrenci/profil.docx

# 5. Ajanı çalıştır
python src/agent.py --student "TestOgrenci"
```

---

*Son güncelleme: 2025 | AES — Almanya Eğitim Serüveni | Bremen, Germany*
*Bu dosya Claude Code ajanının CLAUDE.md talimat dosyasıdır.*
