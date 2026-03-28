/**
 * POST /api/students/[name]/documents   → belge yükle
 * DELETE /api/students/[name]/documents?filename=transkript.pdf → belge sil
 * GET  /api/students/[name]/documents   → belge listesi
 *
 * Yüklenebilir belgeler:
 *   type=transkript  → transkript.pdf
 *   type=dilBelgesi  → dil_belgesi.pdf
 *   type=cv          → cv.pdf
 *   type=diger       → orijinal dosya adı (güvenli hale getirilmiş)
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

const TYPE_MAP: Record<string, string> = {
  transkript: "transkript.pdf",
  dilBelgesi: "dil_belgesi.pdf",
  cv:         "cv.pdf",
};

// İzin verilen uzantılar
const ALLOWED_EXT = [".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png"];

function safeName(name: string): boolean {
  return /^[\w\-çÇğĞıİöÖşŞüÜ][\w\s\-çÇğĞıİöÖşŞüÜ]{0,60}$/.test(name) && !name.includes("..");
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\.çğışöüÇĞİŞÖÜ]/g, "_").replace(/\.{2,}/g, "_");
}

/** GET — tüm yüklenmiş belgeleri listele */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });
  const folder = path.join(STUDENTS_DIR, name);
  if (!fs.existsSync(folder)) return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });

  const known: Record<string, string> = {
    "transkript.pdf": "Transkript",
    "dil_belgesi.pdf": "Dil Belgesi",
    "cv.pdf": "CV",
    "profil.docx": "Profil (Word)",
  };

  const files = fs.readdirSync(folder)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXT.includes(ext) && !f.startsWith("sonuc_") && !f.startsWith("arastirma_");
    })
    .map((f) => {
      const stat = fs.statSync(path.join(folder, f));
      return {
        filename: f,
        label: known[f] ?? f,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    });

  return NextResponse.json({ files });
}

/** POST — belge yükle */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });
  const folder = path.join(STUDENTS_DIR, name);
  if (!fs.existsSync(folder)) return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Form verisi okunamadı" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const type = (formData.get("type") as string | null) ?? "";

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 400 });
  }

  // Max 20 MB
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Dosya boyutu 20 MB'yi aşıyor" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: `İzin verilmeyen uzantı: ${ext}` }, { status: 400 });
  }

  // Dosya adını belirle
  let filename: string;
  if (TYPE_MAP[type]) {
    filename = TYPE_MAP[type];
  } else if (type === "diger") {
    filename = safeFilename(file.name);
  } else {
    return NextResponse.json({ error: "Geçersiz belge türü" }, { status: 400 });
  }

  const destPath = path.join(folder, filename);

  // Dosyayı diske yaz
  const bytes = await file.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(bytes));

  return NextResponse.json({
    ok: true,
    filename,
    size: file.size,
  });
}

/** DELETE — belge sil */
export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });
  const folder = path.join(STUDENTS_DIR, name);
  if (!fs.existsSync(folder)) return NextResponse.json({ error: "Öğrenci bulunamadı" }, { status: 404 });

  const url = new URL(req.url);
  const filename = url.searchParams.get("filename");

  if (!filename) return NextResponse.json({ error: "Dosya adı belirtilmedi" }, { status: 400 });

  // Güvenlik: path traversal önleme
  const safeFn = safeFilename(filename);
  if (safeFn !== filename || filename.includes("/") || filename.includes("..")) {
    return NextResponse.json({ error: "Geçersiz dosya adı" }, { status: 400 });
  }

  // Kritik dosyaları silme
  const PROTECTED = ["profil.json", ".running"];
  if (PROTECTED.includes(filename)) {
    return NextResponse.json({ error: "Bu dosya silinemez" }, { status: 403 });
  }

  const filePath = path.join(folder, filename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }

  fs.unlinkSync(filePath);
  return NextResponse.json({ ok: true });
}
