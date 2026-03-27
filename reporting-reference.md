# Rapor Üretimi Referansı — Word & Excel

## Word Raporu (python-docx)

### Rapor Yapısı
```
Bölüm 1: Öğrenci Profili
Bölüm 2: Araştırma Özeti (istatistikler)
Bölüm 3: ✅ Uygun Programlar
Bölüm 4: ⚠️ Şartlı Uygun Programlar
Bölüm 5: ❌ Uygun Değil Programlar
Bölüm 6: Öneri & Takvim
Footer: Oluşturulma tarihi + AES imzası
```

### Renk Sistemi (python-docx RGBColor)
```python
from docx.shared import RGBColor, Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

# AES Marka Renkleri
AES_NAVY   = RGBColor(0x0A, 0x1F, 0x44)   # Koyu lacivert — başlıklar
AES_GOLD   = RGBColor(0xD4, 0xAF, 0x37)   # Altın — vurgu
AES_WHITE  = RGBColor(0xFF, 0xFF, 0xFF)   # Beyaz

# Uygunluk Renkleri
COLOR_UYGUN      = RGBColor(0x16, 0xa3, 0x4a)   # Yeşil
COLOR_SARTLI     = RGBColor(0xca, 0x8a, 0x04)   # Sarı/Turuncu
COLOR_UYGUN_DEG  = RGBColor(0xdc, 0x26, 0x26)   # Kırmızı

# Tablo Dolgu Renkleri (hex string, openpyxl için)
FILL_UYGUN      = "dcfce7"   # Açık yeşil
FILL_SARTLI     = "fef9c3"   # Açık sarı
FILL_UYGUN_DEG  = "fee2e2"   # Açık kırmızı
FILL_HEADER     = "1a1a1a"   # Siyah başlık
```

### Tam Word Raporu Örneği
```python
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from datetime import datetime

def generate_word_report(programs, profile, output_dir):
    doc = Document()

    # Sayfa kenar boşlukları
    for section in doc.sections:
        section.top_margin    = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin   = Cm(2.5)
        section.right_margin  = Cm(2.5)

    # ─── KAPAK ───────────────────────────────────────────────────────
    title = doc.add_heading("", 0)
    run = title.add_run("Almanya Üniversite Araştırma Raporu")
    run.font.color.rgb = RGBColor(0x0A, 0x1F, 0x44)
    run.font.size = Pt(20)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sr = subtitle.add_run(f"Hazırlayan: AES — Almanya Eğitim Serüveni\n{datetime.now().strftime('%d.%m.%Y')}")
    sr.font.color.rgb = RGBColor(0x80, 0x80, 0x80)
    sr.font.size = Pt(11)
    doc.add_paragraph()

    # ─── ÖĞRENCİ PROFİLİ ─────────────────────────────────────────────
    doc.add_heading("1. Öğrenci Profili", level=1)

    profile_data = [
        ("Ad Soyad",         profile.name),
        ("Hedef Alan",        profile.desired_field),
        ("Derece Türü",       profile.degree_type),
        ("GPA (Orijinal)",    profile.gpa_turkish or "—"),
        ("GPA (Almanya)",     profile.gpa_german or "Hesaplanmadı"),
        ("Almanca",           profile.german_level or "Belirtilmedi"),
        ("İngilizce",         profile.english_level or "Belirtilmedi"),
        ("Program Dili",      profile.program_language or "Fark etmez"),
        ("Tercih Şehir",      ", ".join(profile.preferred_cities) if profile.preferred_cities else "Fark etmez"),
        ("Başlangıç Dönemi",  profile.start_semester or "Belirtilmedi"),
        ("Şartlı Kabul",      "Kabul ediyor" if profile.conditional_admission else "Kabul etmiyor"),
    ]

    tbl = doc.add_table(rows=len(profile_data), cols=2)
    tbl.style = "Table Grid"
    for i, (label, value) in enumerate(profile_data):
        tbl.cell(i, 0).text = label
        tbl.cell(i, 1).text = str(value)
        tbl.cell(i, 0).paragraphs[0].runs[0].bold = True
        # Sütun genişlikleri
        tbl.cell(i, 0).width = Cm(5)
        tbl.cell(i, 1).width = Cm(10)

    doc.add_paragraph()

    # ─── ÖZET İSTATİSTİKLER ──────────────────────────────────────────
    doc.add_heading("2. Araştırma Özeti", level=1)
    uygun     = [p for p in programs if p.eligibility == "uygun"]
    sartli    = [p for p in programs if p.eligibility == "sartli"]
    uygun_deg = [p for p in programs if p.eligibility == "uygun_degil"]

    ozet = doc.add_paragraph()
    ozet.add_run(f"Toplam {len(programs)} program araştırıldı. ").bold = True
    r = ozet.add_run(f"✅ {len(uygun)} uygun")
    r.font.color.rgb = COLOR_UYGUN
    r.bold = True
    ozet.add_run(" — ")
    r2 = ozet.add_run(f"⚠️ {len(sartli)} şartlı")
    r2.font.color.rgb = COLOR_SARTLI
    r2.bold = True
    ozet.add_run(" — ")
    r3 = ozet.add_run(f"❌ {len(uygun_deg)} uygun değil")
    r3.font.color.rgb = COLOR_UYGUN_DEG

    doc.add_paragraph()

    # ─── PROGRAM LİSTELERİ ───────────────────────────────────────────
    groups = [
        ("uygun",       "✅ UYGUN PROGRAMLAR",       COLOR_UYGUN,     uygun),
        ("sartli",      "⚠️ ŞARTLI UYGUN PROGRAMLAR", COLOR_SARTLI,    sartli),
        ("uygun_degil", "❌ UYGUN OLMAYAN PROGRAMLAR", COLOR_UYGUN_DEG, uygun_deg),
    ]

    section_num = 3
    for status_key, heading_text, color, group in groups:
        if not group:
            continue

        h = doc.add_heading(f"{section_num}. {heading_text} ({len(group)})", level=1)
        h.runs[0].font.color.rgb = color
        section_num += 1

        for prog in group:
            # Program başlığı
            ph = doc.add_paragraph()
            run = ph.add_run(f"{prog.university} — {prog.program}")
            run.bold = True
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(0x0A, 0x1F, 0x44)

            # Detay tablosu
            rows_data = [
                ("Şehir",           prog.city or "—"),
                ("Program Dili",    prog.language or "—"),
                ("WiSe Deadline",   prog.deadline_wise or "—"),
                ("SoSe Deadline",   prog.deadline_sose or "—"),
                ("Almanca Şartı",   prog.german_requirement or "—"),
                ("İngilizce Şartı", prog.english_requirement or "—"),
                ("NC Değeri",       prog.nc_value or "Zulassungsfrei"),
                ("uni-assist",      "Gerekli ✓" if prog.uni_assist_required else "Direkt başvuru"),
                ("Şartlı Kabul",    "Mevcut" if prog.conditional_admission else "Yok"),
                ("Değerlendirme",   prog.eligibility_reason or "—"),
            ]

            t = doc.add_table(rows=len(rows_data), cols=2)
            t.style = "Table Grid"
            for i, (k, v) in enumerate(rows_data):
                t.cell(i, 0).text = k
                t.cell(i, 1).text = str(v)
                t.cell(i, 0).paragraphs[0].runs[0].bold = True

            if prog.issues:
                issue_p = doc.add_paragraph()
                issue_run = issue_p.add_run("⚠️ Eksiklikler: " + " | ".join(prog.issues))
                issue_run.font.color.rgb = COLOR_SARTLI
                issue_run.font.size = Pt(10)

            if prog.url:
                url_p = doc.add_paragraph()
                url_p.add_run("🔗 Başvuru: ").bold = True
                url_p.add_run(prog.url).font.color.rgb = RGBColor(0x00, 0x00, 0xFF)

            doc.add_paragraph()  # Boşluk

    # ─── FOOTER ──────────────────────────────────────────────────────
    footer_p = doc.add_paragraph()
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fr = footer_p.add_run(
        f"Bu rapor AES — Almanya Eğitim Serüveni tarafından oluşturulmuştur.\n"
        f"aes-kompass.com | Bremen, Germany | {datetime.now().strftime('%d.%m.%Y %H:%M')}\n"
        f"⚠️ Bilgiler araştırma tarihindeki durumu yansıtır. Başvuru öncesi üniversite sitelerini kontrol ediniz."
    )
    fr.font.color.rgb = RGBColor(0x80, 0x80, 0x80)
    fr.font.size = Pt(9)

    out = output_dir / f"sonuc_raporu_{datetime.now().strftime('%Y%m%d')}.docx"
    doc.save(str(out))
    return out
```

---

## Excel Raporu (openpyxl)

### Sütun Yapısı
```python
COLUMNS = [
    # (başlık, genişlik, açıklama)
    ("Üniversite",      22, "Üniversite adı"),
    ("Şehir",           12, "Şehir adı"),
    ("Program",         28, "Bölüm adı"),
    ("Dil",             12, "Eğitim dili"),
    ("WiSe Deadline",   14, "Kış dönemi son tarihi"),
    ("SoSe Deadline",   14, "Yaz dönemi son tarihi"),
    ("Almanca Şartı",   14, "Gerekli dil belgesi"),
    ("İngilizce Şartı", 14, "Gerekli İng. belgesi"),
    ("NC",              10, "Numerus Clausus"),
    ("uni-assist",      10, "uni-assist gerekiyor mu"),
    ("Şartlı Kabul",    12, "Bedingte Zulassung"),
    ("Uygunluk",        14, "Değerlendirme sonucu"),
    ("Notlar",          40, "Detaylı değerlendirme"),
    ("Başvuru URL",     35, "Direkt link"),
]
```

### Excel Stilizasyon
```python
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def style_header_row(ws):
    header_fill  = PatternFill("solid", fgColor="0A1F44")   # AES lacivert
    header_font  = Font(color="D4AF37", bold=True, size=10)  # AES altın
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    border       = Border(
        bottom=Side(style="medium", color="D4AF37")
    )
    ws.row_dimensions[1].height = 30
    for col in range(1, len(COLUMNS)+1):
        cell = ws.cell(row=1, column=col)
        cell.fill      = header_fill
        cell.font      = header_font
        cell.alignment = header_align
        cell.border    = border

def style_data_row(ws, row_idx: int, eligibility: str):
    fills = {
        "uygun":       PatternFill("solid", fgColor="dcfce7"),  # Açık yeşil
        "sartli":      PatternFill("solid", fgColor="fef9c3"),  # Açık sarı
        "uygun_degil": PatternFill("solid", fgColor="fee2e2"),  # Açık kırmızı
    }
    fill = fills.get(eligibility)
    if fill:
        for col in range(1, len(COLUMNS)+1):
            ws.cell(row=row_idx, column=col).fill = fill
    ws.row_dimensions[row_idx].height = 18
```

### Özet Sheet
```python
def add_summary_sheet(wb, programs, profile):
    ws = wb.create_sheet("Özet")
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 25

    data = [
        ("Öğrenci",          profile.name),
        ("Hedef Alan",        profile.desired_field),
        ("Derece",            profile.degree_type),
        ("GPA",               profile.gpa_german or profile.gpa_turkish or "—"),
        ("Almanca",           profile.german_level or "Yok"),
        ("İngilizce",         profile.english_level or "Yok"),
        ("",                  ""),
        ("SONUÇLAR",          ""),
        ("Toplam Program",    len(programs)),
        ("✅ Uygun",          sum(1 for p in programs if p.eligibility=="uygun")),
        ("⚠️ Şartlı",        sum(1 for p in programs if p.eligibility=="sartli")),
        ("❌ Uygun Değil",   sum(1 for p in programs if p.eligibility=="uygun_degil")),
        ("",                  ""),
        ("Rapor Tarihi",      datetime.now().strftime("%d.%m.%Y %H:%M")),
        ("Kaynak",            "AES — aes-kompass.com"),
    ]
    for row_idx, (label, value) in enumerate(data, 1):
        ws.cell(row=row_idx, column=1, value=label).font = Font(bold=bool(label))
        ws.cell(row=row_idx, column=2, value=value)
```

---

## Rapor Kalite Kontrol Listesi

```python
def validate_report_data(programs: list) -> list[str]:
    """Rapora girmeden önce veri kalitesini kontrol et."""
    warnings = []
    for p in programs:
        if not p.university:
            warnings.append(f"Boş üniversite adı: {p.url}")
        if not p.eligibility:
            warnings.append(f"Değerlendirme yapılmamış: {p.university}")
        if p.confidence < 0.5:
            warnings.append(f"Düşük güvenilirlik ({p.confidence}): {p.university} — {p.program}")
        if not p.url:
            warnings.append(f"URL eksik: {p.university} — {p.program}")
    return warnings
```
