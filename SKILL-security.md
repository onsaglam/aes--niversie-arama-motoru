---
name: aes-security
description: AES ajanının güvenlik kuralları. API anahtarları, .env yönetimi, rate limiting, önbellek güvenliği, hata loglaması. Tetikleyiciler: API key, .env, güvenlik, şifre, token, log.
argument-hint: [güvenlik alanı]
---

# AES Güvenlik Kuralları

AES ajanı harici API'lara (Anthropic, Tavily, ScraperAPI) bağlanır ve öğrenci belgelerini işler.
Bu referans, ajanın güvenli ve kararlı çalışması için uyulması gereken kuralları tanımlar.

Detaylı referans dosyaları:
- `api-security-reference.md` — API anahtarı yönetimi, .env validasyonu, rate limit
- `data-privacy-reference.md` — Öğrenci verisi güvenliği, log sanitizasyonu, önbellek yönetimi

## Değişmez Güvenlik Kuralları

### API Anahtarları
```
✗ API anahtarlarını ASLA koda yazma
✗ .env dosyasını ASLA git'e commit etme
✗ API anahtarlarını ASLA logla
✗ Hata mesajlarında API key gösterme

✓ DAIMA os.getenv() kullan
✓ Başlangıçta anahtarların varlığını kontrol et
✓ .gitignore'a .env ekle
✓ Eksik anahtar = anlaşılır hata mesajı, çıkış
```

### Öğrenci Verisi
```
✗ Öğrenci isimlerini URL'lere koyma
✗ GPA, dil puanı vb. hassas bilgileri logda gösterme
✗ Önbellekte şifrelenmemiş kişisel veri bırakma
✗ Transkript içeriğini terminal'e yazdırma

✓ Log dosyalarında sadece metadata (dosya adı, işlem durumu)
✓ Önbellek sadece web sayfası HTML'i içermeli
✓ Hata mesajlarında öğrenci kimliği yok, sadece işlem ID'si
```

### Web Scraping Etiği
```
✓ robots.txt'e uy (daad.de, uni-assist.de için kontrol et)
✓ Rate limiting: domain başına min. bekleme sürelerine uy
✓ User-agent'ı gerçekçi tut, ama araç olduğunu gizleme
✓ Önbellek: aynı URL 24 saatte bir kez çekil
✗ Üniversite sitelerine DoS yapacak şekilde paralel istek gönderme
✗ Captcha çözme servisleri kullanma
```

## Başlangıç Validasyonu

```python
import os, sys

REQUIRED_ENV_VARS = {
    "ANTHROPIC_API_KEY": "Anthropic Claude API erişimi için zorunlu",
    "TAVILY_API_KEY":    "Web araması için zorunlu",
}

OPTIONAL_ENV_VARS = {
    "SCRAPER_API_KEY":        "Anti-bot bypass için önerilir",
    "BRIGHT_DATA_USERNAME":   "Güçlü bypass için opsiyonel",
}

def validate_env():
    """Uygulama başlamadan önce tüm gerekli değişkenleri kontrol et."""
    errors = []
    for var, desc in REQUIRED_ENV_VARS.items():
        val = os.getenv(var, "")
        if not val or "BURAYA_YAZ" in val or len(val) < 10:
            errors.append(f"  ✗ {var}: {desc}")
    
    if errors:
        print("❌ Eksik API anahtarları (.env dosyasını kontrol et):")
        for e in errors: print(e)
        sys.exit(1)
    
    # Opsiyonelleri uyar
    for var, desc in OPTIONAL_ENV_VARS.items():
        val = os.getenv(var, "")
        if not val or "BURAYA_YAZ" in val:
            print(f"⚠️  {var} eksik — {desc}")
```

## Güvenli Log Formatı

```python
import re

SENSITIVE_PATTERNS = [
    (r"sk-ant-[a-zA-Z0-9\-_]+",    "[ANTHROPIC_KEY_REDACTED]"),
    (r"tvly-[a-zA-Z0-9]+",          "[TAVILY_KEY_REDACTED]"),
    (r"api_key=[a-zA-Z0-9]+",       "api_key=[REDACTED]"),
    (r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "[IP_REDACTED]"),
]

def sanitize_log(message: str) -> str:
    for pattern, replacement in SENSITIVE_PATTERNS:
        message = re.sub(pattern, replacement, message)
    return message

# Kullanım:
import logging
class SanitizingFormatter(logging.Formatter):
    def format(self, record):
        record.msg = sanitize_log(str(record.msg))
        return super().format(record)
```

## Rate Limit Sayacı

```python
from collections import defaultdict
from datetime import datetime, timedelta

class RateLimitTracker:
    def __init__(self):
        self._counts = defaultdict(list)  # service → [timestamp, ...]
    
    DAILY_LIMITS = {
        "tavily":     33,   # 1000/ay ÷ 30
        "scraperapi": 166,  # 5000/ay ÷ 30
        "anthropic":  999,  # Pratik limitsiz ama maliyet için
    }
    
    def can_use(self, service: str) -> bool:
        now = datetime.now()
        day_ago = now - timedelta(days=1)
        # 24 saatlik pencereyi temizle
        self._counts[service] = [t for t in self._counts[service] if t > day_ago]
        limit = self.DAILY_LIMITS.get(service, 100)
        return len(self._counts[service]) < limit
    
    def record_use(self, service: str):
        self._counts[service].append(datetime.now())
    
    def remaining(self, service: str) -> int:
        self.can_use(service)  # temizle
        limit = self.DAILY_LIMITS.get(service, 100)
        return limit - len(self._counts[service])

rate_tracker = RateLimitTracker()  # Singleton
```

## Kritik Kurallar

1. `validate_env()` her çalıştırmada ilk çağrılacak fonksiyon olmalı
2. `save_cache()` yalnızca web sayfası HTML'i kaydetmeli, öğrenci verisi kaydetmemeli
3. Tüm API çağrıları `try/except` içinde olmalı, hata hiçbir zaman sessizce geçilmemeli
4. `rate_tracker.can_use(service)` kontrolü her API çağrısından önce yapılmalı
5. Log dosyaları `/logs/` dizininde, `ogrenciler/` dizininde değil
6. `.gitignore`'a şunlar ekli olmalı: `.env`, `cache/`, `logs/`, `ogrenciler/`
