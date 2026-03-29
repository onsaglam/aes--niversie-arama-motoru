/**
 * lib/blob.ts — Vercel Blob yardımcı fonksiyonları
 *
 * BLOB_READ_WRITE_TOKEN env var olmadan çalışır (graceful degradation).
 * Local ortamda dosya sistemi, Vercel'de Blob kullanılır.
 */
import { put, list, del, head } from "@vercel/blob";
import path from "path";
import fs from "fs";

// Blob kullanılabilir mi? (BLOB_READ_WRITE_TOKEN gerekli)
function blobAvailable(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// Local fallback dizini (Vercel dışı ortamlar için)
const LOCAL_STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

// ─── Belge yükleme ────────────────────────────────────────────────────────────

export async function uploadDocument(
  studentName: string,
  filename: string,
  data: ArrayBuffer,
  contentType: string
): Promise<{ url: string; filename: string }> {
  if (blobAvailable()) {
    const blobPath = `students/${studentName}/documents/${filename}`;
    const blob = await put(blobPath, data, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });
    return { url: blob.url, filename };
  }

  // Local fallback
  const folder = path.join(LOCAL_STUDENTS_DIR, studentName);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, filename), Buffer.from(data));
  return { url: `/api/students/${encodeURIComponent(studentName)}/report?file=${filename}`, filename };
}

// ─── Belge listeleme ─────────────────────────────────────────────────────────

export interface BlobDocument {
  filename: string;
  label: string;
  url: string;
  size: number;
  uploadedAt: string;
}

const KNOWN_LABELS: Record<string, string> = {
  "transkript.pdf": "Transkript",
  "dil_belgesi.pdf": "Dil Belgesi",
  "cv.pdf": "CV",
};

export async function listDocuments(studentName: string): Promise<BlobDocument[]> {
  if (blobAvailable()) {
    const prefix = `students/${studentName}/documents/`;
    const { blobs } = await list({ prefix });
    return blobs.map((b) => {
      const filename = b.pathname.replace(prefix, "");
      return {
        filename,
        label: KNOWN_LABELS[filename] ?? filename,
        url: b.url,
        size: b.size,
        uploadedAt: b.uploadedAt.toISOString(),
      };
    });
  }

  // Local fallback
  const folder = path.join(LOCAL_STUDENTS_DIR, studentName);
  if (!fs.existsSync(folder)) return [];
  const ALLOWED_EXT = [".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png"];
  return fs.readdirSync(folder)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXT.includes(ext) && !f.startsWith("sonuc_") && !f.startsWith("arastirma_") && !f.startsWith("universite_");
    })
    .map((f) => {
      const stat = fs.statSync(path.join(folder, f));
      return {
        filename: f,
        label: KNOWN_LABELS[f] ?? f,
        url: `/api/students/${encodeURIComponent(studentName)}/report?file=${f}`,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
      };
    });
}

// ─── Belge silme ─────────────────────────────────────────────────────────────

export async function deleteDocument(studentName: string, filename: string): Promise<void> {
  if (blobAvailable()) {
    const blobPath = `students/${studentName}/documents/${filename}`;
    try {
      const info = await head(blobPath);
      await del(info.url);
    } catch {
      // blob yoksa sessizce geç
    }
    return;
  }

  // Local fallback
  const filePath = path.join(LOCAL_STUDENTS_DIR, studentName, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ─── Belge indirme (local için) ──────────────────────────────────────────────

export async function getLocalDocument(studentName: string, filename: string): Promise<Buffer | null> {
  const filePath = path.join(LOCAL_STUDENTS_DIR, studentName, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}
