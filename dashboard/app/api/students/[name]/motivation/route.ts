import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  // Profil Neon'dan oku
  const rows = await sql`SELECT profile FROM students WHERE name = ${name}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });
  }
  const profile = ((rows[0] as { profile: Record<string, unknown> }).profile) ?? {};

  const { university, program, language, city, url } = await req.json() as {
    university: string; program: string; language?: string; city?: string; url?: string;
  };

  if (!university || !program) {
    return NextResponse.json({ error: "Üniversite ve program adı zorunlu" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY eksik" }, { status: 500 });

  const client    = new Anthropic({ apiKey });
  const isEnglish = (language || "").toLowerCase().includes("ing") ||
                    (language || "").toLowerCase().includes("engl");

  const prompt = `Sen AES (Almanya Eğitim Serüveni) danışmanlık ajansı adına çalışan bir eğitim uzmanısın.
Aşağıdaki öğrenci profili için ${university} üniversitesinin ${program} programına başvuru amacıyla
Türkçe bir motivasyon mektubu TASLAGI oluştur.

ÖĞRENCİ PROFİLİ:
- Ad: ${profile.name || name.replace(/_/g, " ")}
- Bölüm (Türkiye): ${profile.department || "—"}
- Üniversite: ${profile.current_university || "—"}
- GPA: ${profile.gpa_turkish || "—"}
- Almanca: ${profile.german_level || "Yok"}
- İngilizce: ${profile.english_level || "—"}
- Hedef Alan: ${profile.desired_field || program}
- Danışman Notları: ${profile.advisor_notes || "—"}

HEDEF PROGRAM:
- Üniversite: ${university}
- Program: ${program}
- Şehir: ${city || "—"}
- Dil: ${language || "—"}
${url ? `- URL: ${url}` : ""}

KURALLAR:
1. Türkçe yaz (programın dili ${isEnglish ? "İngilizce" : "Almanca"} olsa da taslak Türkçe — danışman çevirecek)
2. [PARANTEZ İÇİNDE] placeholderlar kullan, örn: [akademik başarı örneği], [proje deneyimi]
3. Resmi ama samimi bir ton
4. 400-500 kelime
5. Şu bölümleri içer: Giriş → Akademik Geçmiş → Motivasyon → Neden ${university} → Kariyer Hedefi → Kapanış
6. Öğrencinin gerçek verilerini (bölüm, GPA, dil) kullan; varsayımsal detaylar için placeholder koy

SADECE mektup metnini döndür, başka açıklama ekleme.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });

    const letter  = (message.content[0] as { text: string }).text;
    const dateStr = new Date().toISOString().slice(0, 10);
    const safe    = university.replace(/[^a-zA-Z0-9ğĞüÜşŞıİöÖçÇ]/g, "_").slice(0, 30);
    const filename = `motivasyon_${safe}_${dateStr}.txt`;

    return NextResponse.json({ letter, university, program, saved_as: filename, generated_at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
