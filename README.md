# AES Skills — Kurulum Rehberi

## Bu Klasörde Ne Var?

Bu klasör Claude Code'un AES Üniversite Araştırma Ajanını çalıştırırken
okuması gereken tüm skill dosyalarını içerir.

```
aes-skills/
├── README.md                          ← Bu dosya
│
├── SKILL.md                           ← Ana skill (Claude Code'un otomatik okuduğu)
├── university-research-reference.md  ← DAAD, uni-assist, NC, GPA dönüşümü
├── scraping-reference.md             ← Anti-bot bypass, önbellek, rate limiting
├── pdf-extraction-reference.md       ← Transkript ve dil belgesi okuma
├── reporting-reference.md            ← Word ve Excel rapor üretimi
│
├── SKILL-security.md                 ← AES güvenlik kuralları
└── SKILL-researcher.md               ← Almanya üniversite araştırma stratejileri
```

---

## Yüklenen Skill'lerin Analizi

### ✅ KULLANILIR — researcher SKILL.md
**Neden:** Web araması, çapraz kaynak doğrulama, yapılandırılmış raporlama stratejileri
tam olarak üniversite araştırması için gerekli.

**Nasıl ekle:** `aes-agent/skills/` klasörüne kopyala.
AES projesine uyarlanmış versiyonu `SKILL-researcher.md`'de mevcut.

---

### ⚠️ KISMI — security SKILL.md
**Neden:** `auth-and-secrets.md` (API key yönetimi) ve `database-and-deps.md`
(bağımlılık güvenliği) kısımları doğrudan kullanılabilir.

**Kullanılmayan kısımlar:** `desktop-security.md` (Electron/Tauri), `web-security.md`
(XSS/CSRF) — bu proje web uygulaması değil, Python CLI aracı.

**Nasıl ekle:** Sadece `auth-and-secrets.md` ve `database-and-deps.md`'yi al.
AES projesine uyarlanmış versiyonu `SKILL-security.md`'de mevcut.

---

### ❌ KULLANILMAZ — trigger-dev SKILL.md
**Neden:** Trigger.dev TypeScript/Node.js framework'ü. AES ajanı Python ile çalışıyor.
Farklı dil, farklı deployment modeli.

**Alternatif:** Eğer ajanı cloud'da deploy etmek istersen, `modal.com` veya
`fly.io` Python için daha uygun. Ama şimdilik lokal çalıştırma yeterli.

---

## Kurulum Adımları

### 1. Skill dosyalarını projeye ekle

```bash
# aes-agent klasörünün içindeyken:
mkdir -p skills
cp /path/to/aes-skills/*.md skills/
```

### 2. Claude Code'a skill'leri tanıt

`CLAUDE.md` dosyasının başına şunu ekle:
```markdown
## Skill Referans Dosyaları
Aşağıdaki dosyaları skills/ klasöründen oku:
- `skills/university-research-reference.md`
- `skills/scraping-reference.md`
- `skills/pdf-extraction-reference.md`
- `skills/reporting-reference.md`
- `skills/SKILL-security.md`
- `skills/SKILL-researcher.md`
```

### 3. Doğrulama

```bash
# Claude Code'u başlat
claude

# Test et
python src/agent.py --test
```

---

## Hangi Skill Ne Zaman Devreye Girer?

| Görev | Devreye Giren Skill |
|-------|---------------------|
| DAAD araması yaparken | `university-research-reference.md` |
| Üniversite sitesi çekerken | `scraping-reference.md` |
| Transkript/dil belgesi okurken | `pdf-extraction-reference.md` |
| Word/Excel raporu üretirken | `reporting-reference.md` |
| API key kullanırken | `SKILL-security.md` |
| Derinlemesine web araması yaparken | `SKILL-researcher.md` |

---

## Maliyet Tahmini (Skill Dosyalarıyla)

Skill dosyaları Claude Code'un context window'unu kullanır.
Tahminen ~15.000 token ek bağlam.

| Senaryo | Token | Maliyet |
|---------|-------|---------|
| Skill dosyaları (context) | ~15.000 | ~$0.03 |
| Tek öğrenci araştırması | ~50.000 | ~$0.10 |
| **Toplam/öğrenci** | ~65.000 | **~$0.13** |
