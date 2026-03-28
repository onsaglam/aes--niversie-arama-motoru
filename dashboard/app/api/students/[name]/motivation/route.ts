import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const folder = path.join(STUDENTS_DIR, name);

  if (!fs.existsSync(folder)) {
    return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });
  }

  const { university, program, language, city, url } = await req.json() as {
    university: string;
    program: string;
    language?: string;
    city?: string;
    url?: string;
  };

  if (!university || !program) {
    return NextResponse.json({ error: "Üniversite ve program adı zorunlu" }, { status: 400 });
  }

  // Profil oku
  let profile: Record<string, unknown> = {};
  const profilePath = path.join(folder, "profil.json");
  if (fs.existsSync(profilePath)) {
    try {
      profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    } catch { /* ignore */ }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY eksik" }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });

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
2. [PARANTEZ İÇİNDE] placeholderlar kullan, örn: [akademik başarı örneği], [proje deneyimi], [kariyer hedefi]
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

    const letter = (message.content[0] as { text: string }).text;

    // Mektubu öğrenci klasörüne kaydet
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = university.replace(/[^a-zA-Z0-9ğĞüÜşŞıİöÖçÇ]/g, "_").slice(0, 30);
    const filename = `motivasyon_${safeName}_${dateStr}.txt`;
    const savePath = path.join(folder, filename);
    const header =
      `AES Motivasyon Mektubu Taslağı\n` +
      `Üniversite: ${university}\n` +
      `Program: ${program}\n` +
      `Oluşturulma: ${new Date().toLocaleString("tr-TR")}\n` +
      `${"─".repeat(60)}\n\n`;
    fs.writeFileSync(savePath, header + letter, "utf-8");

    return NextResponse.json({
      letter,
      university,
      program,
      saved_as: filename,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
