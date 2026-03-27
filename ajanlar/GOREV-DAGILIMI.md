# AES Ajan Görev Dağılımı

Bu projede tek Python process içinde `asyncio` ile paralel çalışan "sanal ajan" rolleri vardır.
Ayrı process veya ayrı script gerekmez — hepsi `agent.py` orkestratörü tarafından yönetilir.

---

## Ajan Rolleri

### 1. Profil Ajanı (`reader.py`)
**Sorumluluk:** Öğrenci verilerini yapılandırılmış hale getirmek
- `profil.docx` → `StudentProfile` dataclass
- `transkript.pdf` → GPA çıkarma + Türkiye→Almanya dönüşümü
- `dil_belgesi.pdf` → Dil seviyesi normalize etme
- Belge varlık kontrolü

### 2. Arama Ajanı (`searcher.py`)
**Sorumluluk:** Program listesi oluşturmak
- DAAD API JSON endpoint (birincil)
- Tavily web araması (genişletme)
- Serper.dev (Tavily yedeği)
- Tekrarsız birleştirme

### 3. Scraping Ajanı (`scraper.py`)
**Sorumluluk:** Üniversite sayfalarından ham veri çekmek
- Seviye 1: httpx (hızlı)
- Seviye 2: Playwright stealth
- Seviye 3: ScraperAPI
- Seviye 4: Bright Data (son çare)
- Önbellek yönetimi (24 saat TTL)
- Rate limiting (domain bazlı)

### 4. Parse Ajanı (`parser.py`)
**Sorumluluk:** Ham HTML'i yapılandırılmış veriye dönüştürmek
- Claude `claude-sonnet-4-5` ile HTML → JSON
- Uygunluk değerlendirmesi (dil / GPA / NC / tarih)
- Güvenilirlik skoru hesaplama

### 5. Rapor Ajanı (`reporter.py`)
**Sorumluluk:** Çıktı dosyaları üretmek
- Word raporu (AES marka renkleri, 6 bölüm)
- Excel listesi (renk kodlamalı, özet sheet)
- Veri kalite kontrolü

---

## Paralel Çalışma Akışı

```
[1] Profil Ajanı → StudentProfile
        ↓ (senkron, önce olmalı)
[2] Arama Ajanı → ham program listesi (DAAD + Tavily paralel)
        ↓
[3] Scraping + Parse → asyncio.gather(MAX=3 paralel)
        ↓
[4] Tüm programlar enriched + evaluated
        ↓
[5] Rapor Ajanı → .docx + .xlsx
```

---

## Gelecek: Dashboard Ajanı (Phase 2)

`dashboard/` klasöründe Next.js uygulaması:
- FastAPI backend (`api/server.py`) → Python ajanı çağırır
- Next.js frontend → sonuçları görselleştirir
- WebSocket → araştırma ilerleme durumu (canlı)
