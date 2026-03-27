# AES Üniversite Arama Motoru — Proje Planı

**Son güncelleme:** 2026-03-26
**Mevcut faz:** Phase 1 — Core Agent

---

## PHASE 1: Core Python Agent ✅ (aktif)

### Hedef
`python src/agent.py --student TestOgrenci` komutu sıfır hata ile çalışsın,
gerçek DAAD + web verisi ile doğru uygunluk değerlendirmesi yapsın.

### Yapılacaklar
- [x] Proje yapısı + API anahtarları kurulumu
- [ ] Python ortamı kurulumu (venv + paketler)
- [ ] `reader.py` — PDF çıkarma + GPA dönüşümü
- [ ] `scraper.py` — gelişmiş stealth + cookie handling
- [ ] `parser.py` — dil skorlama + min_gpa DE ölçeği
- [ ] `agent.py` — validate_env + rate limit tracker
- [ ] `reporter.py` — AES marka renkleri
- [ ] Test öğrenci profili oluştur
- [ ] Uçtan uca test çalıştır

### Başarı Kriterleri
- DAAD API'dan en az 10 program çekiliyor
- Uygunluk değerlendirmesi dil + GPA + NC kontrol ediyor
- Word + Excel raporu üretiliyor
- Hiç uncaught exception yok

---

## PHASE 2: Next.js Dashboard (sonraki)

### Teknoloji
- Frontend: Next.js 14 + Tailwind CSS + shadcn/ui
- Backend: FastAPI (Python) — agent'ı çağırır
- Transport: REST API + WebSocket (canlı ilerleme)
- Deploy: Sadece localhost

### Planlanan Sayfalar
1. **Ana Sayfa** — öğrenci listesi + hızlı istatistikler
2. **Yeni Öğrenci** — profil formu (profil.docx oluşturur)
3. **Araştırma** — canlı ilerleme + sonuç tablosu
4. **Rapor** — program detayları + uygunluk filtresi
5. **Ayarlar** — API key durumu, cache temizleme

---

## PHASE 3: Gelişmiş Özellikler (gelecek)

- Motivasyon mektubu taslağı (Claude ile)
- uni-assist ön kayıt formu doldurma
- E-posta bildirim (deadline yaklaşınca)
- Öğrenci kendi profilini doldurabilir (web form)
