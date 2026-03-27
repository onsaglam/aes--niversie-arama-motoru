# 🎓 AES Üniversite Araştırma Ajanı — CLAUDE.md

> Almanya Eğitim Serüveni (AES) için öğrenci profillerine göre Almanya'daki
> üniversiteleri araştıran, uygunluğu değerlendiren ve Word/Excel raporu
> üreten otonom Claude Code ajanı.

---

## PROJE ÖZET

```
ogrenciler/[AdSoyad]/profil.docx   ← Danışman doldurur
ogrenciler/[AdSoyad]/transkript.pdf
ogrenciler/[AdSoyad]/dil_belgesi.pdf
        ↓
python src/agent.py --student AdSoyad
        ↓
DAAD API + Tavily Web Araması + Playwright Scraping
        ↓
ogrenciler/[AdSoyad]/sonuc_raporu_YYYYMMDD.docx
ogrenciler/[AdSoyad]/universite_listesi_YYYYMMDD.xlsx
```

---

## DOSYA YAPISI

```
aes-agent/
├── CLAUDE.md              ← Bu dosya
├── .env                   ← API anahtarları (git'e ekleme!)
├── .env.example           ← Şablon
├── requirements.txt       ← Python bağımlılıkları
├── setup.sh               ← Tek komutla kurulum
├── src/
│   ├── agent.py           ← Ana orkestratör (buradan çalıştır)
│   ├── reader.py          ← Word profil okuyucu
│   ├── searcher.py        ← Tavily/Serper arama
│   ├── scraper.py         ← Playwright anti-bot bypass
│   ├── parser.py          ← Claude ile HTML → veri çıkarma
│   └── reporter.py        ← Word + Excel rapor üretici
├── templates/
│   └── ogrenci_profil_sablonu.docx
├── ogrenciler/            ← Her öğrenci için bir alt klasör
├── cache/                 ← Web sayfaları önbelleği
└── logs/                  ← Çalışma logları
```

---

## ÇALIŞTIRMA KOMUTLARI

```bash
# Sanal ortamı aktive et (her yeni terminal açışında)
source venv/bin/activate   # macOS/Linux
venv\Scripts\activate      # Windows

# Bağlantı testi
python src/agent.py --test

# Tek öğrenci araştır
python src/agent.py --student AhmetYilmaz

# Hızlı mod (sadece DAAD, scraping yok)
python src/agent.py --student AhmetYilmaz --quick

# Tüm öğrencileri tara
python src/agent.py --all

# Debug: Playwright görünür pencerede çalışsın
HEADED_MODE=True python src/agent.py --student AhmetYilmaz

# Yeni şablon oluştur
python src/agent.py --template
```

---

## YENİ ÖĞRENCİ EKLEME

```bash
# 1. Klasör oluştur
mkdir -p ogrenciler/OgrenciAdiSoyadi

# 2. Şablonu kopyala
cp templates/ogrenci_profil_sablonu.docx ogrenciler/OgrenciAdiSoyadi/profil.docx

# 3. Word'de aç ve doldur
open ogrenciler/OgrenciAdiSoyadi/profil.docx

# 4. Belgeleri ekle (opsiyonel — otomatik okur)
# ogrenciler/OgrenciAdiSoyadi/transkript.pdf
# ogrenciler/OgrenciAdiSoyadi/dil_belgesi.pdf

# 5. Çalıştır
python src/agent.py --student OgrenciAdiSoyadi
```

---

## API ANAHTARLARI (.env)

| Değişken | Nereden alınır | Ücretsiz limit |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com/settings/keys | $5 kredi |
| `TAVILY_API_KEY` | app.tavily.com | 1.000 istek/ay |
| `SCRAPER_API_KEY` | dashboard.scraperapi.com | 5.000 istek/ay |

---

## AJAN AKIŞI

1. `reader.py` → profil.docx oku → StudentProfile oluştur
2. `searcher.py` → DAAD API + Tavily → ham program listesi
3. `scraper.py` → her URL için katmanlı bypass (httpx → Playwright → ScraperAPI)
4. `parser.py` → Claude claude-sonnet-4-5 ile HTML'den veri çıkar
5. `parser.py` → uygunluk değerlendirmesi (dil, GPA, NC, tarih)
6. `reporter.py` → Word + Excel raporu kaydet

---

## HATA ÇÖZÜM REHBERİ

| Hata | Çözüm |
|---|---|
| `ANTHROPIC_API_KEY eksik` | .env dosyasını kontrol et |
| `playwright not found` | `playwright install chromium` çalıştır |
| `Sayfa içeriği çok kısa` | ScraperAPI key .env'de tanımlı mı? |
| `python-docx ImportError` | `pip install python-docx` |
| `Profil alanı boş` | profil.docx'te "İstenen Alan" dolduruldu mu? |

---

## CLAUDE CODE'A ÖZEL TALİMATLAR

- Yeni modül eklerken önce `requirements.txt`'e ekle, sonra `pip install` çalıştır
- Cache temizlemek için `rm -rf cache/` yeterli
- Rate limit hatası alırsan `DOMAIN_DELAYS` değerlerini scraper.py'de artır
- Yeni üniversite URL'si eklemek için `searcher.py`'deki `TARGET_UNIVERSITIES` sözlüğüne ekle
- Modelleri değiştirme: parser.py'de `claude-sonnet-4-5` kullanılıyor, daha ucuz için `claude-haiku-4-5-20251001`

---

*AES — Almanya Eğitim Serüveni | Bremen, Germany | aes-kompass.com*
