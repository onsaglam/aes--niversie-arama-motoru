"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Profile {
  name: string;
  nationality: string;
  current_university: string;
  department: string;
  gpa_turkish: string;
  graduation_date: string;
  diploma_status: string;
  german_level: string;
  english_level: string;
  desired_field: string;
  degree_type: string;
  program_language: string;
  preferred_cities: string;
  start_semester: string;
  free_tuition_important: boolean;
  university_type: string;
  accept_nc: boolean;
  conditional_admission: boolean;
  advisor_notes: string;
}

const GERMAN_LEVELS = ["", "Yok", "A1", "A2", "B1", "B2", "Goethe B2", "Goethe C1", "Goethe C2", "telc B2", "telc C1", "DSH-1", "DSH-2", "DSH-3", "TestDaF 12", "TestDaF 14", "TestDaF 16", "TestDaF 18", "TestDaF 20"];

// GPA → Almanya skalası dönüşümü (istemci taraflı önizleme)
function _tr100To40(g: number): number {
  if (g >= 90) return 4.0;
  if (g >= 85) return 3.7;
  if (g >= 80) return 3.3;
  if (g >= 75) return 3.0;
  if (g >= 70) return 2.7;
  if (g >= 65) return 2.3;
  if (g >= 60) return 2.0;
  if (g >= 55) return 1.7;
  if (g >= 50) return 1.3;
  return 1.0;
}
function convertGpaToGerman(raw: string): string | null {
  const s = raw.trim().replace(",", ".");
  const m1 = s.match(/^([\d.]+)\s*\/\s*([\d.]+)$/);
  if (m1) {
    const v = parseFloat(m1[1]), sc = parseFloat(m1[2]);
    if (isNaN(v) || isNaN(sc) || sc === 0) return null;
    if (sc === 4 || sc === 4.0) {
      const de = 1.0 + 3.0 * (4.0 - v) / 3.0;
      return de >= 1 && de <= 5 ? de.toFixed(1) : null;
    }
    if (sc === 100) {
      const de = 1.0 + 3.0 * (4.0 - _tr100To40(v)) / 3.0;
      return de >= 1 && de <= 5 ? de.toFixed(1) : null;
    }
  }
  const m2 = s.match(/^([\d.]+)\s*(?:\(DE\))?$/i);
  if (m2) {
    const v = parseFloat(m2[1]);
    if (!isNaN(v) && v >= 1.0 && v <= 5.0) return v.toFixed(1);
  }
  return null;
}
const ENGLISH_LEVELS = ["", "Yok", "B2", "C1", "C2", "IELTS 5.5", "IELTS 6.0", "IELTS 6.5", "IELTS 7.0", "IELTS 7.5", "IELTS 8.0", "TOEFL 72", "TOEFL 80", "TOEFL 88", "TOEFL 100", "TOEFL 110", "Cambridge B2", "Cambridge C1", "Cambridge C2"];
const DEGREE_TYPES = ["Master", "Bachelor", "PhD", "Ausbildung"];
const UNIVERSITY_TYPES = ["", "TU (Teknik Üniversite)", "FH (Fachhochschule)", "Volluniversität", "Fark etmez"];
const START_SEMESTERS = ["", "SoSe 2026", "WiSe 2026/27", "SoSe 2027", "WiSe 2027/28", "SoSe 2028"];

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {help && <p className="text-xs text-slate-400 mb-1">{help}</p>}
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  );
}

function SelectField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
    >
      {options.map((o) => <option key={o} value={o}>{o || "— Seçiniz —"}</option>)}
    </select>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-slate-300"}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-1"}`} />
      </div>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

export default function EditProfilePage() {
  const params = useParams();
  const router = useRouter();
  const name = decodeURIComponent(params.name as string);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/students/${encodeURIComponent(name)}/profile`)
      .then((r) => r.json())
      .then(setProfile);
  }, [name]);

  const update = (key: keyof Profile, value: string | boolean) => {
    setProfile((p) => p ? { ...p, [key]: value } : p);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    await fetch(`/api/students/${encodeURIComponent(name)}/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    setSaving(false);
    setSaved(true);
  };

  const handleSaveAndRun = async () => {
    if (!profile?.desired_field?.trim()) {
      alert("Lütfen 'İstenen Alan / Bölüm' alanını doldurun — araştırma için zorunludur.");
      return;
    }
    if (!profile.german_level && !profile.english_level) {
      if (!confirm("Dil sertifikası seçilmedi. Araştırma her iki dilde de program arayacak. Devam edilsin mi?")) return;
    }
    await handleSave();
    router.push(`/students/${encodeURIComponent(name)}`);
  };

  if (!profile) return <div className="p-8 text-slate-500">Yükleniyor...</div>;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Başlık */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href={`/students/${encodeURIComponent(name)}`} className="text-sm text-blue-600 hover:underline mb-1 block">
            ← {name}
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Öğrenci Profili Düzenle</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {saving ? "Kaydediliyor..." : saved ? "✓ Kaydedildi" : "Kaydet"}
          </button>
          <button
            onClick={handleSaveAndRun}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Kaydet & Araştır →
          </button>
        </div>
      </div>

      <div className="space-y-6">

        {/* KİŞİSEL */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span className="text-lg">👤</span> Kişisel Bilgiler
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Ad Soyad"><Input value={profile.name} onChange={(v) => update("name", v)} /></Field>
            <Field label="Milliyet"><Input value={profile.nationality} onChange={(v) => update("nationality", v)} placeholder="Türk" /></Field>
          </div>
        </section>

        {/* EĞİTİM */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span className="text-lg">🎓</span> Eğitim Durumu
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Mevcut / Son Üniversite" help="Türkiye'deki okul adı">
              <Input value={profile.current_university} onChange={(v) => update("current_university", v)} placeholder="İstanbul Teknik Üniversitesi" />
            </Field>
            <Field label="Bölüm">
              <Input value={profile.department} onChange={(v) => update("department", v)} placeholder="Elektrik-Elektronik Mühendisliği" />
            </Field>
            <Field label="Not Ortalaması" help="örn: 3.2/4.0 veya 75/100 veya 2.5 (DE)">
              <Input value={profile.gpa_turkish} onChange={(v) => update("gpa_turkish", v)} placeholder="3.2/4.0" />
              {profile.gpa_turkish && (() => {
                const de = convertGpaToGerman(profile.gpa_turkish);
                return de ? (
                  <p className="text-xs mt-1 text-blue-600 font-medium">
                    ≈ {de} (Almanya skalası){" "}
                    <span className="font-normal text-slate-400">
                      {parseFloat(de) <= 2.0 ? "· Sehr gut" : parseFloat(de) <= 2.5 ? "· Gut" : parseFloat(de) <= 3.5 ? "· Befriedigend" : "· Ausreichend"}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs mt-1 text-slate-400">Format: 3.2/4.0 veya 75/100 veya 2.5 (DE)</p>
                );
              })()}
            </Field>
            <Field label="Mezuniyet Tarihi">
              <Input value={profile.graduation_date} onChange={(v) => update("graduation_date", v)} placeholder="Haziran 2025" />
            </Field>
            <div className="col-span-2">
              <Field label="Diploma Durumu">
                <SelectField value={profile.diploma_status} onChange={(v) => update("diploma_status", v)} options={["", "Alındı", "Haziran 2026'da alınacak", "Ocak 2027'de alınacak", "Haziran 2027'de alınacak", "Devam ediyor"]} />
              </Field>
            </div>
          </div>
        </section>

        {/* DİL — EN KRİTİK BÖLÜM */}
        <section className="bg-white rounded-xl border border-blue-100 p-6 ring-1 ring-blue-200">
          <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
            <span className="text-lg">🗣️</span> Dil Sertifikaları
          </h2>
          <p className="text-xs text-blue-600 mb-4 font-medium">
            ⚠️ Bu alan araştırma dilini belirler: Sadece Almanca sertifika → yalnızca Almanca programlar, sadece İngilizce sertifika → yalnızca İngilizce programlar.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Almanca Sertifika" help="Yoksa 'Yok' seçin">
              <SelectField value={profile.german_level} onChange={(v) => update("german_level", v)} options={GERMAN_LEVELS} />
            </Field>
            <Field label="İngilizce Sertifika" help="Yoksa 'Yok' seçin">
              <SelectField value={profile.english_level} onChange={(v) => update("english_level", v)} options={ENGLISH_LEVELS} />
            </Field>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-slate-50 text-xs text-slate-600">
            <strong>Program Dili Tahmini: </strong>
            {(() => {
              const de = profile.german_level && !["", "Yok"].includes(profile.german_level);
              const en = profile.english_level && !["", "Yok"].includes(profile.english_level);
              if (de && !en) return "🇩🇪 Sadece Almanca programlar aranacak";
              if (en && !de) return "🇬🇧 Sadece İngilizce programlar aranacak";
              if (de && en) return "🌐 Hem Almanca hem İngilizce programlar aranacak";
              return "❓ Dil seçilmedi — her iki dil de aranacak";
            })()}
          </div>
        </section>

        {/* HEDEF */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span className="text-lg">🎯</span> Almanya&apos;da Hedef
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="İstenen Alan / Bölüm" help="Almanya'da okumak istediği alan">
                <Input value={profile.desired_field} onChange={(v) => update("desired_field", v)} placeholder="örn: Electrical Engineering, Artificial Intelligence" />
              </Field>
            </div>
            <Field label="Derece Türü">
              <SelectField value={profile.degree_type} onChange={(v) => update("degree_type", v)} options={DEGREE_TYPES} />
            </Field>
            <Field label="Başlangıç Dönemi">
              <SelectField value={profile.start_semester} onChange={(v) => update("start_semester", v)} options={START_SEMESTERS} />
            </Field>
            <div className="col-span-2">
              <Field label="Tercih Edilen Şehirler" help="Virgülle ayır. Fark etmez ise boş bırak.">
                <Input value={profile.preferred_cities} onChange={(v) => update("preferred_cities", v)} placeholder="München, Berlin, Bremen" />
              </Field>
            </div>
          </div>
        </section>

        {/* TERCİHLER */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span className="text-lg">⚙️</span> Tercihler
          </h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Field label="Üniversite Türü">
              <SelectField value={profile.university_type} onChange={(v) => update("university_type", v)} options={UNIVERSITY_TYPES} />
            </Field>
          </div>
          <div className="space-y-3">
            <Toggle checked={profile.free_tuition_important} onChange={(v) => update("free_tuition_important", v)} label="Ücretsiz / düşük ücretli programlar öncelikli" />
            <Toggle checked={profile.accept_nc} onChange={(v) => update("accept_nc", v)} label="NC'li (kısıtlı kontenjan) bölümler kabul edilsin" />
            <Toggle checked={profile.conditional_admission} onChange={(v) => update("conditional_admission", v)} label="Şartlı kabul (Bedingte Zulassung) kabul edilsin" />
          </div>
          <p className="mt-3 text-xs text-amber-600 font-medium">
            🏛️ Sadece devlet üniversiteleri araştırılır — özel üniversiteler otomatik filtrelenir.
          </p>
        </section>

        {/* DANIŞMAN NOTLARI */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <span className="text-lg">📝</span> Danışman Notları
          </h2>
          <textarea
            value={profile.advisor_notes}
            onChange={(e) => update("advisor_notes", e.target.value)}
            rows={4}
            placeholder="Öğrencinin özel durumu, hedefleri, kısıtlamaları, öncelikler..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </section>

        {/* ALT BUTONLAR */}
        <div className="flex justify-end gap-3 pb-8">
          <Link
            href={`/students/${encodeURIComponent(name)}`}
            className="px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            İptal
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {saving ? "Kaydediliyor..." : saved ? "✓ Kaydedildi" : "Kaydet"}
          </button>
          <button
            onClick={handleSaveAndRun}
            className="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Kaydet &amp; Araştırmayı Başlat →
          </button>
        </div>
      </div>
    </div>
  );
}
