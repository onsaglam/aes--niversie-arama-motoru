# Web Scraping & Anti-Bot Bypass Referansı

## Bypass Mimarisi — 4 Katmanlı Sistem

```
İstek gelir
    │
    ▼
[Önbellek var mı? < 24 saat]──Evet──→ Önbellekten döndür (0 istek)
    │ Hayır
    ▼
Seviye 1: httpx (0.1sn, ücretsiz)
    │ 403/429/kısa içerik
    ▼
Seviye 2: Playwright Stealth (3-8sn, ücretsiz)
    │ Bot tespiti
    ▼
Seviye 3: ScraperAPI (8-15sn, $0.0006/istek)
    │ Hâlâ engellenirse
    ▼
Seviye 4: Bright Data Residential (pahalı, son çare)
    │ Yine başarısız
    ▼
Logla + atla (raporda "bilgi alınamadı" olarak işaretle)
```

---

## Seviye 1: httpx — Hızlı Deneme

```python
import httpx
import random

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

async def fetch_httpx(url: str) -> str:
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
    }
    async with httpx.AsyncClient(
        timeout=20,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=10)
    ) as client:
        r = await client.get(url, headers=headers)
        if r.status_code in (403, 429, 503):
            raise ValueError(f"Blocked: HTTP {r.status_code}")
        if len(r.text) < 500:
            raise ValueError("Sayfa içeriği çok kısa")
        return r.text
```

---

## Seviye 2: Playwright Stealth — Bot Tespiti Bypass

```python
from playwright.async_api import async_playwright
import asyncio, random

STEALTH_JS = """
// navigator.webdriver'ı gizle
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
// Tarayıcı dili Almanya gibi görünsün
Object.defineProperty(navigator, 'languages', {get: () => ['de-DE', 'de', 'en-US', 'en']});
// Plugin'leri gerçekmiş gibi göster
Object.defineProperty(navigator, 'plugins', {get: () => [
    {name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer'},
    {name: 'Native Client', filename: 'internal-nacl-plugin'},
]});
// Chrome nesnesi ekle
window.chrome = {runtime: {}, loadTimes: () => {}, csi: () => {}, app: {}};
// Permission API
const origQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
        ? Promise.resolve({state: Notification.permission})
        : origQuery(parameters);
"""

async def fetch_playwright(url: str, proxy: dict = None) -> str:
    headed = os.getenv("HEADED_MODE", "False").lower() == "true"

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not headed,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--window-size=1920,1080",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-extensions",
                "--no-first-run",
            ]
        )
        ctx_opts = {
            "viewport": {"width": 1920, "height": 1080},
            "user_agent": random.choice(USER_AGENTS),
            "locale": "de-DE",
            "timezone_id": "Europe/Berlin",
            "geolocation": {"latitude": 53.0793, "longitude": 8.8017},  # Bremen
            "permissions": ["geolocation"],
            "extra_http_headers": {
                "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
            }
        }
        if proxy:
            ctx_opts["proxy"] = proxy

        context = await browser.new_context(**ctx_opts)
        await context.add_init_script(STEALTH_JS)

        page = await context.new_page()

        # Cookie banner'ları otomatik reddet (gizlilik)
        await context.route("**/*", lambda route: route.continue_())

        try:
            await page.goto(url, wait_until="networkidle", timeout=45000)
        except Exception:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)

        # İnsan gibi davran
        await asyncio.sleep(random.uniform(1.5, 3.5))
        await page.evaluate(f"window.scrollTo(0, {random.randint(300, 800)})")
        await asyncio.sleep(random.uniform(0.5, 1.5))

        # Cookie banner'ı kapat (Almanya GDPR)
        for selector in [
            "button[id*='accept']", "button[id*='cookie']",
            "button[class*='accept']", "button[class*='zustimm']",
            "#onetrust-accept-btn-handler", ".cc-accept", "[data-testid='accept-cookies']"
        ]:
            try:
                btn = await page.query_selector(selector)
                if btn:
                    await btn.click()
                    await asyncio.sleep(0.5)
                    break
            except Exception:
                pass

        content = await page.content()
        await browser.close()

        if len(content) < 500:
            raise ValueError("Playwright: sayfa içeriği çok kısa")
        return content
```

---

## Seviye 3: ScraperAPI — Proxy + Render

```python
async def fetch_scraperapi(url: str) -> str:
    key = os.getenv("SCRAPER_API_KEY", "")
    if not key or key == "BURAYA_YAZ":
        raise RuntimeError("SCRAPER_API_KEY eksik")

    api_url = (
        f"http://api.scraperapi.com"
        f"?api_key={key}"
        f"&url={url}"
        f"&render=true"        # JavaScript çalıştır
        f"&country_code=de"    # Almanya IP'si
        f"&premium=true"       # Daha güçlü bypass (ücretli)
    )
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.get(api_url)
        if r.status_code != 200:
            raise ValueError(f"ScraperAPI: HTTP {r.status_code}")
        return r.text
```

---

## Önbellek Sistemi — Gereksiz İstekleri Önle

```python
import hashlib, json
from pathlib import Path
from datetime import datetime, timedelta

CACHE_DIR = Path("cache")
CACHE_TTL  = 24  # saat

def _key(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()

def get_cached(url: str) -> str | None:
    domain = url.split("/")[2].replace("www.", "") if "//" in url else "misc"
    p = CACHE_DIR / domain / f"{_key(url)}.json"
    if p.exists():
        data = json.loads(p.read_text("utf-8"))
        age = datetime.now() - datetime.fromisoformat(data["cached_at"])
        if age < timedelta(hours=CACHE_TTL):
            return data["content"]
    return None

def save_cache(url: str, content: str):
    domain = url.split("/")[2].replace("www.", "") if "//" in url else "misc"
    p = CACHE_DIR / domain / f"{_key(url)}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({
        "url": url,
        "cached_at": datetime.now().isoformat(),
        "content": content
    }, ensure_ascii=False), "utf-8")

# Önbellek istatistikleri
def cache_stats() -> dict:
    total = list(CACHE_DIR.rglob("*.json"))
    return {"total_files": len(total), "total_mb": sum(f.stat().st_size for f in total) / 1e6}
```

---

## Rate Limiting — Domain'e Göre Bekleme

```python
import asyncio, random
from collections import defaultdict
from datetime import datetime

# Domain başına son istek zamanı
_last_request: dict[str, datetime] = defaultdict(lambda: datetime(2000,1,1))

# Her domain için minimum bekleme (saniye)
DOMAIN_DELAYS = {
    "daad.de":             (3, 7),
    "uni-assist.de":       (5, 10),
    "hochschulstart.de":   (4, 9),
    "tum.de":              (2, 5),
    "tu-berlin.de":        (2, 5),
    "rwth-aachen.de":      (3, 6),
    "default":             (1, 4),
}

async def respectful_delay(url: str):
    domain = url.split("/")[2].replace("www.", "") if "//" in url else "misc"
    # Base domain'i bul
    base = next((k for k in DOMAIN_DELAYS if k in domain), "default")
    min_s, max_s = DOMAIN_DELAYS[base]

    # Son istekten bu yana geçen süre
    elapsed = (datetime.now() - _last_request[domain]).total_seconds()
    wait = random.uniform(min_s, max_s)
    if elapsed < wait:
        await asyncio.sleep(wait - elapsed)

    _last_request[domain] = datetime.now()
```

---

## HTML'den Metin Çıkarma — BeautifulSoup

```python
from bs4 import BeautifulSoup
import re

def html_to_clean_text(html: str, max_chars: int = 12000) -> str:
    """HTML'den okunabilir, temiz metin çıkar."""
    soup = BeautifulSoup(html, "lxml")

    # Gereksiz tag'leri kaldır
    for tag in soup(["script", "style", "nav", "footer", "header",
                      "aside", "noscript", "iframe", "img", "svg"]):
        tag.decompose()

    # Önce önemli bölümleri al
    priority_selectors = [
        "main", "article", "#content", ".content",
        ".bewerbung", ".admission", ".studium",
        "[class*='application']", "[class*='admission']",
        "[id*='application']", "[id*='zulassung']"
    ]
    sections = []
    for sel in priority_selectors:
        el = soup.select_one(sel)
        if el:
            sections.append(el.get_text(" ", strip=True))

    text = " ".join(sections) if sections else soup.get_text(" ", strip=True)

    # Boşlukları temizle
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]
```

---

## Güvenilirlik Skoru

```python
def calculate_confidence(sources: list[str], content_length: int) -> float:
    """Çekilen verinin güvenilirlik skorunu hesapla (0.0-1.0)."""
    score = 0.0

    # Kaynak bazlı skor
    if "university_official"  in sources: score += 0.50
    if "daad_api"             in sources: score += 0.30
    if "uni_assist_list"      in sources: score += 0.15
    if "tavily_search"        in sources: score += 0.05

    # İçerik kalitesi
    if content_length > 5000: score += 0.10
    elif content_length > 2000: score += 0.05

    # Bypass seviyesi (doğrudan daha güvenilir)
    if "scraped_httpx"        in sources: score += 0.05
    elif "scraped_playwright" in sources: score += 0.03
    elif "scraped_scraperapi" in sources: score += 0.01

    return min(round(score, 2), 1.0)
```

---

## Loglanacak Bilgiler

```python
import logging
from datetime import datetime

def log_scrape_attempt(url: str, level: str, success: bool, error: str = ""):
    status = "SUCCESS" if success else "FAILED"
    logging.info(f"SCRAPE | {status} | Level:{level} | URL:{url[:80]} | {error}")

# Örnek log satırı:
# 2025-03-15 14:23:01 | SCRAPE | SUCCESS | Level:playwright | URL:https://www.tum.de/en/studies/...
# 2025-03-15 14:23:05 | SCRAPE | FAILED  | Level:httpx | URL:https://www.rwth-aachen.de/... | 403 Forbidden
```
