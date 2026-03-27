import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STUDENTS_DIR = path.resolve(process.cwd(), "../aes-agent/ogrenciler");

/** Klasör adının üst dizine çıkmadığını doğrula */
function safeName(name: string): boolean {
  return /^[\w\-çÇğĞıİöÖşŞüÜ][\w\s\-çÇğĞıİöÖşŞüÜ]{0,60}$/.test(name) && !name.includes("..");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });
  const profilePath = path.join(STUDENTS_DIR, name, "profil.json");

  if (!fs.existsSync(profilePath)) {
    // Boş şablon döndür
    return NextResponse.json(getEmptyProfile(name));
  }

  const data = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
  return NextResponse.json(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!safeName(name)) return NextResponse.json({ error: "Geçersiz öğrenci adı" }, { status: 400 });
  const studentDir = path.join(STUDENTS_DIR, name);

  if (!fs.existsSync(studentDir)) {
    fs.mkdirSync(studentDir, { recursive: true });
  }

  const body = await req.json();
  const profilePath = path.join(studentDir, "profil.json");
  fs.writeFileSync(profilePath, JSON.stringify(body, null, 2), "utf-8");

  return NextResponse.json({ ok: true });
}

function getEmptyProfile(name: string) {
  return {
    name: name.replace(/_/g, " "),
    nationality: "Türk",
    current_university: "",
    department: "",
    gpa_turkish: "",
    graduation_date: "",
    diploma_status: "",
    german_level: "",
    english_level: "",
    desired_field: "",
    degree_type: "Master",
    program_language: "",
    preferred_cities: "",
    start_semester: "",
    free_tuition_important: true,
    university_type: "",
    accept_nc: true,
    conditional_admission: true,
    advisor_notes: "",
  };
}
