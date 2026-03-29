import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";

// Basit in-memory cache — 6 saatte bir yenile
let _cache: { ts: number; data: HighlightResult } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface HighlightItem {
  title:      string;
  university: string;
  program:    string;
  city?:      string;
  url?:       string;
  deadline?:  string;
  reason:     string;
}

export interface HighlightSection {
  category:    string;
  icon:        string;
  description: string;
  items:       HighlightItem[];
}

export interface HighlightResult {
  sections:     HighlightSection[];
  summary:      string;
  generated_at: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const forceRefresh = searchParams.get("refresh") === "1";

  if (!forceRefresh && _cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(_cache.data);
  }

  let dbData: string;
  try {
    // Postgres: DD.MM.YYYY → date dönüşümü için regex check
    const [upcomingDeadlines, easyEnglish, ncFree, conditional, stats] = await Promise.all([
      sql`
        SELECT university, program, city, url,
               deadline_wise, deadline_sose, language, degree,
               conditional_admission, nc_value
        FROM programs
        WHERE (
          (deadline_wise IS NOT NULL AND deadline_wise != ''
            AND CASE WHEN deadline_wise ~ E'^\\d{2}\\.\\d{2}\\.\\d{4}$'
                     THEN to_date(deadline_wise, 'DD.MM.YYYY')
                     ELSE NULL END
                BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days')
          OR
          (deadline_sose IS NOT NULL AND deadline_sose != ''
            AND CASE WHEN deadline_sose ~ E'^\\d{2}\\.\\d{2}\\.\\d{4}$'
                     THEN to_date(deadline_sose, 'DD.MM.YYYY')
                     ELSE NULL END
                BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days')
        )
        ORDER BY deadline_wise, deadline_sose
        LIMIT 15
      `,
      sql`
        SELECT university, program, city, url, degree, deadline_wise, deadline_sose,
               english_requirement, nc_value, conditional_admission
        FROM programs
        WHERE (lower(language) LIKE '%english%' OR lower(language) LIKE '%ingilizce%')
          AND (english_requirement IS NULL OR english_requirement = '')
          AND (nc_value IS NULL OR lower(nc_value) = 'zulassungsfrei' OR nc_value = '')
        ORDER BY confidence DESC
        LIMIT 12
      `,
      sql`
        SELECT university, program, city, url, degree, deadline_wise, deadline_sose,
               german_requirement, conditional_admission, confidence
        FROM programs
        WHERE (lower(nc_value) = 'zulassungsfrei' OR nc_value IS NULL OR nc_value = '')
          AND (lower(language) LIKE '%almanca%' OR lower(language) LIKE '%german%' OR lower(language) LIKE '%deutsch%')
          AND german_requirement IS NOT NULL AND german_requirement != ''
        ORDER BY confidence DESC
        LIMIT 12
      `,
      sql`
        SELECT university, program, city, url, degree, language, deadline_wise, deadline_sose,
               german_requirement, english_requirement, nc_value
        FROM programs
        WHERE conditional_admission = 1
          AND (deadline_wise IS NOT NULL OR deadline_sose IS NOT NULL)
        ORDER BY confidence DESC
        LIMIT 12
      `,
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(DISTINCT university) as uni_count,
          SUM(CASE WHEN lower(language) LIKE '%english%' OR lower(language) LIKE '%ingilizce%' THEN 1 ELSE 0 END) as english_count,
          SUM(CASE WHEN lower(language) LIKE '%almanca%' OR lower(language) LIKE '%german%' THEN 1 ELSE 0 END) as german_count,
          SUM(CASE WHEN conditional_admission = 1 THEN 1 ELSE 0 END) as conditional_count,
          SUM(CASE WHEN lower(nc_value) = 'zulassungsfrei' OR nc_value IS NULL THEN 1 ELSE 0 END) as nc_free_count
        FROM programs
      `,
    ]);

    dbData = JSON.stringify({
      stats:                   stats[0] ?? {},
      upcoming_deadlines:      upcomingDeadlines.slice(0, 10),
      easy_english_programs:   easyEnglish.slice(0, 8),
      nc_free_german:          ncFree.slice(0, 8),
      conditional_programs:    conditional.slice(0, 8),
    }, null, 2);
  } catch (err) {
    console.error("[highlights DB]", err);
    return NextResponse.json({ sections: [], summary: "Veritabanı hatası.", generated_at: new Date().toISOString() }, { status: 500 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey || apiKey.includes("BURAYA_YAZ")) {
    return NextResponse.json(
      { sections: [], summary: "ANTHROPIC_API_KEY ayarlanmamış.", generated_at: new Date().toISOString() },
      { status: 503 }
    );
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Sen Türk öğrencilere Almanya'da üniversite bursunu/programını bulmalarına yardımcı olan bir eğitim danışmanısın.
Aşağıdaki veritabanı verilerini analiz et ve Türk öğrenciler için en önemli ve fırsatlı programları öne çıkar.

VERİTABANI VERİSİ:
${dbData}

Aşağıdaki JSON formatında SADECE JSON döndür, başka hiçbir açıklama ekleme:
{
  "sections": [
    {
      "category": "Kategori başlığı (Türkçe, kısa)",
      "icon": "tek emoji",
      "description": "Bu kategorinin önemi (1-2 cümle Türkçe)",
      "items": [
        {
          "title": "kısa başlık",
          "university": "üniversite adı",
          "program": "program adı",
          "city": "şehir veya null",
          "url": "URL veya null",
          "deadline": "en yakın deadline tarihi veya null",
          "reason": "neden önerildiği (Türkçe, 1 cümle, spesifik)"
        }
      ]
    }
  ],
  "summary": "Genel veritabanı özeti ve Türk öğrencilere 2-3 cümlelik tavsiye (Türkçe)"
}

Kategoriler (tam olarak bu 4 kategoriyi kullan, sırayla):
1. "Deadline Yaklaşıyor" (🔥) — Yaklaşan deadline'lı en kritik programlar (en fazla 4 item)
2. "Dil Şartsız İngilizce" (🌍) — İngilizce ama özel dil sınav belgesi istemeyen programlar (en fazla 4 item)
3. "NC'siz Almanca Program" (🎓) — Numerus Clausus olmadan başvurulabilecek Almanca programlar (en fazla 4 item)
4. "Şartlı Kabul Fırsatı" (⭐) — Eksik belge/not ile de kabul edilebilir programlar (en fazla 4 item)

Her item için gerçek veritabanı verisi kullan, tahmin etme.`;

  try {
    const message = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages:   [{ role: "user", content: prompt }],
    });

    const raw   = (message.content[0] as { text: string }).text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Claude JSON döndürmedi");

    const parsed = JSON.parse(match[0]) as Omit<HighlightResult, "generated_at">;
    const result: HighlightResult = { ...parsed, generated_at: new Date().toISOString() };
    _cache = { ts: Date.now(), data: result };
    return NextResponse.json(result);
  } catch (err) {
    console.error("[highlights Claude]", err);
    return NextResponse.json(
      { sections: [], summary: "AI analizi şu an kullanılamıyor.", generated_at: new Date().toISOString() },
      { status: 500 }
    );
  }
}
