"""
scraper.py — Katmanlı anti-bot bypass ile web sayfası çekme.

Seviye 1: httpx (hızlı, ücretsiz)
Seviye 2: Playwright stealth (JS rendering + bot tespiti bypass)
Seviye 3: ScraperAPI (proxy + render)
Seviye 4: Bright Data residential proxy
"""
import os
import asyncio
import hashlib
import json
import random
import logging
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Optional

from tenacity import retry, stop_after_attempt, wait_exponential

try:
    import httpx
    HTTPX_OK = True
except ImportError:
    HTTPX_OK = False

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_OK = True
except ImportError:
    PLAYWRIGHT_OK = False

try:
    from fake_useragent import UserAgent
    _ua = UserAgent()
    def get_random_ua() -> str:
        try:
            return _ua.chrome
        except Exception:
            return random.choice(USER_AGENTS)
except Exception:
    def get_random_ua() -> str:
        return random.choice(USER_AGENTS)

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]

CACHE_DIR = Path("cache")
CACHE_TTL  = int(os.getenv("CACHE_TTL_HOURS", "24"))

# Domain başına bekleme aralıkları (min, max) saniye
DOMAIN_DELAYS = {
    "daad.de":             (3, 7),
    "uni-assist.de":       (5, 10),
    "hochschulstart.de":   (4, 9),
    "tum.de":              (2, 5),
    "tu-berlin.de":        (2, 5),
    "rwth-aachen.de":      (3, 6),
    "default":             (1, 4),
}

# Domain başına son istek zamanı — gereksiz beklemeyi önler
_last_request: dict[str, datetime] = defaultdict(lambda: datetime(2000, 1, 1))


# ─── Önbellek ────────────────────────────────────────────────────────────────

def _cache_path(url: str) -> Path:
    key    = hashlib.md5(url.encode()).hexdigest()
    domain = url.split("/")[2].replace("www.", "") if "//" in url else "misc"
    return CACHE_DIR / domain / f"{key}.json"


def get_cached(url: str) -> Optional[str]:
    p = _cache_path(url)
    if p.exists():
        try:
            data       = json.loads(p.read_text(encoding="utf-8"))
            cached_at  = datetime.fromisoformat(data["cached_at"])
            if datetime.now() - cached_at < timedelta(hours=CACHE_TTL):
                return data["content"]
        except Exception:
            pass
    return None


def save_cache(url: str, content: str):
    p = _cache_path(url)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({
        "url":       url,
        "cached_at": datetime.now().isoformat(),
        "content":   content,
    }, ensure_ascii=False), encoding="utf-8")


def cache_stats() -> dict:
    files = list(CACHE_DIR.rglob("*.json"))
    return {
        "total_files": len(files),
        "total_mb":    round(sum(f.stat().st_size for f in files) / 1e6, 2),
    }


# ─── Rate Limiting ────────────────────────────────────────────────────────────

async def respectful_delay(url: str):
    """Domain bazlı rate limiting — son istekten bu yana geçen süreyi dikkate alır."""
    domain = url.split("/")[2].replace("www.", "") if "//" in url else "misc"
    base   = next((v for k, v in DOMAIN_DELAYS.items() if k in domain), DOMAIN_DELAYS["default"])
    min_s, max_s = base

    elapsed = (datetime.now() - _last_request[domain]).total_seconds()
    wait    = random.uniform(min_s, max_s)
    if elapsed < wait:
        await asyncio.sleep(wait - elapsed)

    _last_request[domain] = datetime.now()


# ─── Seviye 1: httpx ─────────────────────────────────────────────────────────

async def _fetch_httpx(url: str) -> str:
    if not HTTPX_OK:
        raise RuntimeError("httpx kurulu değil")
    headers = {
        "User-Agent":                get_random_ua(),
        "Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language":           "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding":           "gzip, deflate, br",
        "DNT":                       "1",
        "Connection":                "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest":            "document",
        "Sec-Fetch-Mode":            "navigate",
        "Sec-Fetch-Site":            "none",
    }
    async with httpx.AsyncClient(
        timeout=20,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=10)
    ) as client:
        r = await client.get(url, headers=headers)
        if r.status_code in (403, 429, 503):
            raise ValueError(f"Engellendi: HTTP {r.status_code}")
        r.raise_for_status()
        if len(r.text) < 500:
            raise ValueError("Sayfa içeriği çok kısa — muhtemelen engellendi")
        return r.text


# ─── Seviye 2: Playwright stealth ────────────────────────────────────────────

STEALTH_JS = """
// navigator.webdriver'ı gizle
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
// Tarayıcı dili Almanya gibi görünsün
Object.defineProperty(navigator, 'languages', {get: () => ['de-DE', 'de', 'en-US', 'en']});
// Plugin'leri gerçekmiş gibi göster
Object.defineProperty(navigator, 'plugins', {get: () => [
    {name: 'Chrome PDF Plugin',    filename: 'internal-pdf-viewer'},
    {name: 'Chrome PDF Viewer',    filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai'},
    {name: 'Native Client',        filename: 'internal-nacl-plugin'},
]});
// Chrome nesnesini ekle
window.chrome = {runtime: {}, loadTimes: () => {}, csi: () => {}, app: {}};
// Permission API — Notifications için doğal yanıt
const origQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
        ? Promise.resolve({state: Notification.permission})
        : origQuery(parameters);
// WebGL vendor
const getParam = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParam(parameter);
};
"""

COOKIE_SELECTORS = [
    # Cookiebot — Alman üniversitelerinde çok yaygın
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    ".CybotCookiebotDialogBodyButton[id*='AllowAll']",
    # UserCentrics
    "[data-testid='uc-accept-all-button']",
    "button[data-testid='accept-all']",
    # OneTrust
    "#onetrust-accept-btn-handler",
    "button.onetrust-close-btn-handler",
    # Borlabs
    "#borlabs-cookie-btn-accept-all",
    ".borlabs-cookie-btn-accept",
    # Generic
    "button[id*='accept']",
    "button[id*='cookie']",
    "button[class*='accept']",
    "button[class*='zustimm']",
    "button[class*='cookie-accept']",
    "button[class*='consent-accept']",
    ".cc-accept",
    ".cc-btn.cc-allow",
    "[data-testid='accept-cookies']",
    "button[aria-label*='Accept']",
    "button[aria-label*='Akzeptieren']",
    "button[aria-label*='Alle akzeptieren']",
    ".cookie-consent-accept",
]


async def _fetch_playwright(url: str, proxy: Optional[dict] = None) -> str:
    if not PLAYWRIGHT_OK:
        raise RuntimeError("Playwright kurulu değil. playwright install chromium çalıştır.")
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
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
            ],
        )

        ctx_kwargs = dict(
            viewport         = {"width": 1920, "height": 1080},
            user_agent       = get_random_ua(),
            locale           = "de-DE",
            timezone_id      = "Europe/Berlin",
            geolocation      = {"latitude": 53.0793, "longitude": 8.8017},  # Bremen
            permissions      = ["geolocation"],
            extra_http_headers = {
                "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
            },
        )
        if proxy:
            ctx_kwargs["proxy"] = proxy

        context = await browser.new_context(**ctx_kwargs)
        await context.add_init_script(STEALTH_JS)

        page = await context.new_page()

        # Dialog'ları (alert vb.) otomatik kapat
        page.on("dialog", lambda d: asyncio.create_task(d.dismiss()))

        try:
            await page.goto(url, wait_until="networkidle", timeout=45000)
        except Exception:
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            except Exception as e:
                raise RuntimeError(f"Playwright: sayfa yüklenemedi — {e}")

        # İnsan gibi: bekle + scroll
        await asyncio.sleep(random.uniform(1.5, 3.5))
        await page.evaluate(f"window.scrollTo(0, {random.randint(200, 600)})")
        await asyncio.sleep(random.uniform(0.5, 1.5))

        # Cookie banner'ı kapat (GDPR)
        for selector in COOKIE_SELECTORS:
            try:
                btn = await page.query_selector(selector)
                if btn and await btn.is_visible():
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


# ─── Seviye 3: ScraperAPI ────────────────────────────────────────────────────

async def _fetch_scraperapi(url: str) -> str:
    key = os.getenv("SCRAPER_API_KEY", "")
    if not key or key == "BURAYA_YAZ":
        raise RuntimeError("SCRAPER_API_KEY tanımlı değil")
    if not HTTPX_OK:
        raise RuntimeError("httpx kurulu değil")

    api_url = (
        f"http://api.scraperapi.com"
        f"?api_key={key}"
        f"&url={url}"
        f"&render=true"
        f"&country_code=de"
    )
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.get(api_url)
        if r.status_code != 200:
            raise ValueError(f"ScraperAPI: HTTP {r.status_code}")
        if len(r.text) < 500:
            raise ValueError("ScraperAPI: içerik çok kısa")
        return r.text


# ─── Seviye 4: Bright Data ───────────────────────────────────────────────────

async def _fetch_brightdata(url: str) -> str:
    host = os.getenv("BRIGHT_DATA_HOST", "brd.superproxy.io")
    port = os.getenv("BRIGHT_DATA_PORT", "33335")
    user = os.getenv("BRIGHT_DATA_USERNAME", "")
    pwd  = os.getenv("BRIGHT_DATA_PASSWORD", "")
    if not user:
        raise RuntimeError("Bright Data credentials tanımlı değil")
    return await _fetch_playwright(url, proxy={
        "server":   f"http://{host}:{port}",
        "username": user,
        "password": pwd,
    })


# ─── Ana fetch fonksiyonu ─────────────────────────────────────────────────────

async def fetch_page(url: str) -> tuple[str, str]:
    """
    Sayfayı çek. Önce önbellekten bak, sonra katmanlı bypass dene.
    Döndürür: (html_content, bypass_level_used)
    """
    # Önbellek kontrolü
    cached = get_cached(url)
    if cached:
        logger.debug(f"CACHE HIT: {url[:80]}")
        return cached, "cache"

    await respectful_delay(url)

    levels = [
        ("httpx",       _fetch_httpx),
        ("playwright",  _fetch_playwright),
        ("scraperapi",  _fetch_scraperapi),
        ("brightdata",  _fetch_brightdata),
    ]

    errors = []
    for name, fetch_fn in levels:
        try:
            content = await fetch_fn(url)
            save_cache(url, content)
            logger.info(f"SCRAPE SUCCESS | {name} | {url[:80]}")
            return content, name
        except Exception as e:
            err_msg = str(e)[:120]
            errors.append(f"{name}: {err_msg}")
            logger.warning(f"SCRAPE FAILED | {name} | {url[:80]} | {err_msg}")
            if name != "brightdata":
                await asyncio.sleep(random.uniform(2, 5))

    raise RuntimeError(
        f"Tüm bypass seviyeleri başarısız ({url[:60]}):\n" + "\n".join(errors)
    )
