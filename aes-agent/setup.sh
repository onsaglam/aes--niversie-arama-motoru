#!/bin/bash
# ============================================================
# AES Üniversite Araştırma Ajanı — Kurulum Scripti
# Çalıştırma: bash setup.sh
# ============================================================

set -e  # Hata olursa dur

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   AES Üniversite Araştırma Ajanı Kurulum  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ─── 1. Python versiyonu kontrol ─────────────────────────────────────────────
echo -e "${YELLOW}[1/6] Python versiyonu kontrol ediliyor...${NC}"
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python3 bulunamadı. https://python.org adresinden kur.${NC}"
    exit 1
fi
PYTHON_VER=$(python3 --version | cut -d' ' -f2)
echo -e "${GREEN}✅ Python $PYTHON_VER${NC}"

# ─── 2. Sanal ortam ──────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[2/6] Sanal ortam oluşturuluyor...${NC}"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}✅ venv oluşturuldu${NC}"
else
    echo -e "${GREEN}✅ venv zaten mevcut${NC}"
fi

# Sanal ortamı aktive et
source venv/bin/activate
echo -e "${GREEN}✅ venv aktive edildi${NC}"

# ─── 3. Python paketleri ─────────────────────────────────────────────────────
echo -e "\n${YELLOW}[3/6] Python paketleri kuruluyor...${NC}"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo -e "${GREEN}✅ Tüm paketler kuruldu${NC}"

# ─── 4. Playwright browser ───────────────────────────────────────────────────
echo -e "\n${YELLOW}[4/6] Playwright Chromium kuruluyor...${NC}"
playwright install chromium
echo -e "${GREEN}✅ Chromium kuruldu${NC}"

# ─── 5. Klasör yapısı ────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[5/6] Klasör yapısı oluşturuluyor...${NC}"
mkdir -p ogrenciler templates cache logs src
touch src/__init__.py
echo -e "${GREEN}✅ Klasörler hazır${NC}"

# ─── 6. .env dosyası ─────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[6/6] API anahtarları ayarlanıyor...${NC}"
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${YELLOW}⚠️  .env dosyası oluşturuldu. API anahtarlarını girmen gerekiyor!${NC}"
    echo ""
    echo -e "${BLUE}── Şimdi .env dosyasını aç ve şunları doldur: ──${NC}"
    echo -e "  ANTHROPIC_API_KEY  → https://console.anthropic.com/settings/keys"
    echo -e "  TAVILY_API_KEY     → https://app.tavily.com (ücretsiz)"
    echo -e "  SCRAPER_API_KEY    → https://dashboard.scraperapi.com (ücretsiz)"
    echo ""
else
    echo -e "${GREEN}✅ .env zaten mevcut${NC}"
fi

# ─── Şablon oluştur ──────────────────────────────────────────────────────────
python3 src/agent.py --template 2>/dev/null || true

# ─── Bağlantı testi ──────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}── Kurulum tamamlandı! Bağlantı durumu: ──${NC}"
python3 src/agent.py --test

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Kullanım:                                        ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  1. Öğrenci klasörü oluştur:                      ║${NC}"
echo -e "${GREEN}║     mkdir -p ogrenciler/AhmetYilmaz               ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  2. Profil şablonunu kopyala ve doldur:           ║${NC}"
echo -e "${GREEN}║     cp templates/ogrenci_profil_sablonu.docx \\   ║${NC}"
echo -e "${GREEN}║        ogrenciler/AhmetYilmaz/profil.docx         ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  3. Ajanı çalıştır:                               ║${NC}"
echo -e "${GREEN}║     python src/agent.py --student AhmetYilmaz    ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  Hızlı test:                                      ║${NC}"
echo -e "${GREEN}║     python src/agent.py --student AhmetYilmaz \\  ║${NC}"
echo -e "${GREEN}║                         --quick                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
