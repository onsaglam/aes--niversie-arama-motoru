"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Play, Zap, Download, ExternalLink,
  CheckCircle2, AlertTriangle, XCircle, HelpCircle,
  FileText, FileSpreadsheet, Pencil, Trash2,
  FileEdit, X, Loader2, BookmarkCheck, Upload,
} from "lucide-react";

interface Program {
  university: string;
  program: string;
  city: string;
  language: string;
  degree: string;
  eligibility: string;
  eligibility_reason: string;
  issues: string[];
  passed_checks: string[];
  deadline_wise: string | null;
  deadline_sose: string | null;
  german_requirement: string | null;
  english_requirement: string | null;
  nc_value: string | null;
  min_gpa: number | null;
  uni_assist_required: boolean;
  conditional_admission: boolean;
  confidence: number;
  url: string;
  notes?: string;
}

interface StudentDetail {
  name: string;
  programs: Program[];
  lastRun: string | null;
  reports: string[];
  isRunning: boolean;
  documents: {
    profil: boolean;
    transkript: boolean;
    dilBelgesi: boolean;
    motivasyon: boolean;
    cv: boolean;
  };
}

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

type TrackingStatus = "inceleniyor" | "basvurulacak" | "basvuruldu" | "kabul" | "red" | "beklemede";

interface TrackingEntry {
  university: string;
  program: string;
  status: TrackingStatus;
  notes: string;
  updated_at: string;
}

const TRACKING_CONFIG: Record<TrackingStatus, { label: string; badge: string; emoji: string }> = {
  inceleniyor:  { label: "İnceleniyor",   badge: "bg-blue-100 text-blue-700",   emoji: "🔍" },
  basvurulacak: { label: "Başvurulacak",  badge: "bg-purple-100 text-purple-700", emoji: "📋" },
  basvuruldu:   { label: "Başvuruldu",    badge: "bg-indigo-100 text-indigo-700", emoji: "📤" },
  kabul:        { label: "Kabul Edildi",  badge: "bg-green-100 text-green-700",  emoji: "🎉" },
  red:          { label: "Reddedildi",    badge: "bg-red-100 text-red-700",      emoji: "❌" },
  beklemede:    { label: "Beklemede",     badge: "bg-amber-100 text-amber-700",  emoji: "⏳" },
};

const ELIGIBILITY_CONFIG = {
  uygun:       { icon: CheckCircle2,   label: "✅ Uygun",       row: "bg-green-50",   badge: "bg-green-100 text-green-800",   order: 0 },
  sartli:      { icon: AlertTriangle,  label: "⚠️ Şartlı",      row: "bg-yellow-50",  badge: "bg-yellow-100 text-yellow-800", order: 1 },
  uygun_degil: { icon: XCircle,        label: "❌ Uygun Değil", row: "bg-red-50",     badge: "bg-red-100 text-red-800",       order: 2 },
  veri_yok:    { icon: HelpCircle,     label: "❓ Veri Yok",    row: "",              badge: "bg-slate-100 text-slate-600",   order: 3 },
  taranmadi:   { icon: HelpCircle,     label: "⏭ Taranmadı",   row: "",              badge: "bg-slate-100 text-slate-500",   order: 4 },
} as const;

// ANSI escape kodlarını temizle (Rich terminal çıktısından)
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");

// Almanya üniversite başvuru tarihlerini parse et
// Desteklenen formatlar: "15.01.2026", "15.01", "15. Januar 2026", "01. Juli"
const GERMAN_MONTHS: Record<string, number> = {
  // German
  januar: 0, februar: 1, märz: 2, april: 3, mai: 4, juni: 5,
  juli: 6, august: 7, september: 8, oktober: 9, november: 10, dezember: 11,
  // English-only (rest share spelling with German)
  january: 0, february: 1, march: 2, may: 4, june: 5, july: 6, october: 9, december: 11,
};

function parseDeadline(raw: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();

  // DD.MM.YYYY
  let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));

  // DD. MonthName YYYY or DD. MonthName
  m = s.match(/(\d{1,2})\.\s*([A-Za-zä]+)\s*(\d{4})?/);
  if (m) {
    const mo = GERMAN_MONTHS[m[2].toLowerCase()];
    if (mo !== undefined) {
      const yr = m[3] ? parseInt(m[3]) : new Date().getFullYear();
      const d  = new Date(yr, mo, parseInt(m[1]));
      // If no year given and date already passed, try next year
      if (!m[3] && d < new Date()) d.setFullYear(d.getFullYear() + 1);
      return d;
    }
  }

  // DD.MM (no year)
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (m) {
    const now = new Date();
    const d   = new Date(now.getFullYear(), parseInt(m[2]) - 1, parseInt(m[1]));
    if (d < now) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  return null;
}

function deadlineUrgency(raw: string | null): { text: string; cls: string } | null {
  const date = parseDeadline(raw);
  if (!date) return null;
  const days = Math.floor((date.getTime() - Date.now()) / 86400000);
  if (days < -7) return null; // very stale — don't clutter
  if (days < 0)  return { text: `${Math.abs(days)}g geçti`, cls: "text-slate-400 line-through" };
  if (days <= 7)  return { text: `${days}g kaldı!`, cls: "text-red-600 font-bold" };
  if (days <= 21) return { text: `${days}g kaldı`, cls: "text-amber-600 font-semibold" };
  if (days <= 60) return { text: `${days}g kaldı`, cls: "text-blue-600" };
  return null;
}

export default function StudentPage() {
  const params = useParams();
  const router = useRouter();
  const name = decodeURIComponent(params.name as string);

  const [detail, setDetail]     = useState<StudentDetail | null>(null);
  const [profile, setProfile]   = useState<Profile | null>(null);
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [log, setLog]           = useState("");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [filter, setFilter]     = useState<string>("all");
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [deleting, setDeleting]   = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const [notFound, setNotFound] = useState(false);
  const [tracking, setTracking] = useState<TrackingEntry[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [pendingUploadType, setPendingUploadType] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [motivModal, setMotivModal] = useState<{ university: string; program: string; language?: string; city?: string; url?: string } | null>(null);
  const [motivLetter, setMotivLetter] = useState("");
  const [motivLoading, setMotivLoading] = useState(false);
  const [motivSavedAs, setMotivSavedAs] = useState<string | null>(null);

  const trackingKey = (university: string, program: string) =>
    `${university.toLowerCase()}::${program.toLowerCase().slice(0, 40)}`;

  const getTracking = useCallback((university: string, program: string): TrackingEntry | undefined => {
    return tracking.find((t) => trackingKey(t.university, t.program) === trackingKey(university, program));
  }, [tracking]);

  const updateTracking = async (university: string, program: string, status: TrackingStatus) => {
    await fetch(`/api/students/${encodeURIComponent(name)}/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ university, program, status }),
    });
    // Reload tracking
    fetch(`/api/students/${encodeURIComponent(name)}/tracking`)
      .then((r) => r.json())
      .then(setTracking)
      .catch(() => {});
  };

  const handleDocUploadClick = (type: string) => {
    setPendingUploadType(type);
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === "transkript" || type === "dilBelgesi" || type === "cv"
        ? ".pdf"
        : ".pdf,.docx,.doc,.jpg,.jpeg,.png";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingUploadType) return;
    setUploadingDoc(pendingUploadType);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", pendingUploadType);
    await fetch(`/api/students/${encodeURIComponent(name)}/documents`, { method: "POST", body: fd });
    e.target.value = "";
    setUploadingDoc(null);
    setPendingUploadType(null);
    fetchDetail();
  };

  const deleteDoc = async (filename: string) => {
    if (!confirm(`"${filename}" silinecek. Emin misiniz?`)) return;
    await fetch(`/api/students/${encodeURIComponent(name)}/documents?filename=${encodeURIComponent(filename)}`, { method: "DELETE" });
    fetchDetail();
  };

  const generateMotivation = async () => {
    if (!motivModal) return;
    setMotivLoading(true);
    setMotivLetter("");
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(name)}/motivation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(motivModal),
      });
      const data = await res.json();
      setMotivLetter(data.letter || data.error || "Hata oluştu");
      setMotivSavedAs(data.saved_as || null);
    } catch (e) {
      setMotivLetter("Bağlantı hatası: " + String(e));
    } finally {
      setMotivLoading(false);
    }
  };

  const fetchDetail = useCallback(() => {
    fetch(`/api/students/${encodeURIComponent(name)}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null; }
        return r.json();
      })
      .then((d) => { if (d) { setDetail(d); setLoading(false); } })
      .catch(() => setLoading(false));
  }, [name]);

  useEffect(() => {
    fetchDetail();
    fetch(`/api/students/${encodeURIComponent(name)}/profile`)
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => {/* ignore */});
    fetch(`/api/students/${encodeURIComponent(name)}/tracking`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTracking(d); })
      .catch(() => {});
  }, [name, fetchDetail]);

  // Arka planda çalışan ajan varsa 5 saniyede bir yenile
  useEffect(() => {
    if (!detail?.isRunning || running) return;
    const timer = setInterval(() => {
      fetch(`/api/students/${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .then((d) => {
          setDetail(d);
          if (!d.isRunning) clearInterval(timer);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [detail?.isRunning, running, name]);

  // Log otomatik scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const handleDelete = async () => {
    if (!confirm(`"${name.replace(/_/g, " ")}" öğrencisini ve tüm dosyalarını kalıcı olarak silmek istediğinize emin misiniz?`)) return;
    setDeleting(true);
    await fetch(`/api/students/${encodeURIComponent(name)}`, { method: "DELETE" });
    router.push("/");
  };

  const runAgent = async (quick: boolean) => {
    setRunning(true);
    setLog("");
    setExitCode(null);

    const url = `/api/students/${encodeURIComponent(name)}/run${quick ? "?quick=1" : ""}`;
    const res  = await fetch(url, { method: "POST" });

    if (res.status === 409) {
      setLog("⚠️ Araştırma zaten arka planda çalışıyor. Sayfa otomatik güncellenecek.");
      setRunning(false);
      fetchDetail();
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { setRunning(false); return; }

    const dec = new TextDecoder();
    let lastExitCode: number | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = stripAnsi(dec.decode(value));
      // __EXIT_CODE__:N satırını yakala
      const match = chunk.match(/__EXIT_CODE__:(\d+)/);
      if (match) lastExitCode = parseInt(match[1], 10);
      setLog((prev) => prev + chunk.replace(/__EXIT_CODE__:\d+\n?/, ""));
    }

    setExitCode(lastExitCode);
    setRunning(false);
    fetchDetail(); // Sonuçları yenile
  };

  const sorted = [...(detail?.programs ?? [])].sort((a, b) => {
    const oa = ELIGIBILITY_CONFIG[a.eligibility as keyof typeof ELIGIBILITY_CONFIG]?.order ?? 9;
    const ob = ELIGIBILITY_CONFIG[b.eligibility as keyof typeof ELIGIBILITY_CONFIG]?.order ?? 9;
    return oa - ob;
  });

  const filtered = filter === "all" ? sorted : sorted.filter((p) => p.eligibility === filter);

  const counts = sorted.reduce(
    (acc, p) => { acc[p.eligibility] = (acc[p.eligibility] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  if (loading) return (
    <div className="text-center py-20 text-slate-400">
      <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
      Yükleniyor...
    </div>
  );

  if (notFound) return (
    <div className="text-center py-20 text-slate-400">
      <p className="font-medium text-slate-600 mb-2">Öğrenci bulunamadı</p>
      <Link href="/" className="text-sm text-blue-600 hover:underline">← Öğrenci listesine dön</Link>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Motivasyon Mektubu Modal */}
      {motivModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="font-semibold text-slate-800">Motivasyon Mektubu Taslağı</h2>
                <p className="text-xs text-slate-400 mt-0.5">{motivModal.university} — {motivModal.program}</p>
              </div>
              <button onClick={() => { setMotivModal(null); setMotivLetter(""); setMotivSavedAs(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 flex-1 overflow-y-auto">
              {!motivLetter && !motivLoading && (
                <div className="text-center py-8">
                  <FileEdit className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p className="text-sm text-slate-500 mb-4">
                    Claude, öğrenci profiline ve program detaylarına göre kişiselleştirilmiş
                    bir motivasyon mektubu taslağı oluşturacak.
                  </p>
                  <button
                    onClick={generateMotivation}
                    className="px-5 py-2.5 rounded-lg text-sm font-medium text-white"
                    style={{ background: "var(--aes-navy)" }}
                  >
                    Taslak Oluştur
                  </button>
                </div>
              )}
              {motivLoading && (
                <div className="flex items-center justify-center py-12 gap-3 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Claude taslak oluşturuyor...</span>
                </div>
              )}
              {motivLetter && (
                <div className="space-y-4">
                  <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed font-mono text-xs">
                    {motivLetter}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => navigator.clipboard.writeText(motivLetter)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Kopyala
                    </button>
                    <button
                      onClick={generateMotivation}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-200 text-blue-600 hover:bg-blue-50"
                    >
                      Yeniden Oluştur
                    </button>
                    {motivSavedAs && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Kaydedildi: {motivSavedAs}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Tüm Öğrenciler
      </Link>

      {/* Arka planda çalışıyor uyarısı */}
      {detail?.isRunning && !running && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-700">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <span>Araştırma arka planda devam ediyor... Sayfa otomatik güncelleniyor.</span>
        </div>
      )}

      {/* Başlık */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{profile?.name || name.replace(/_/g, " ")}</h1>
          {detail?.lastRun && (
            <p className="text-sm text-slate-400 mt-1">Son araştırma: {detail.lastRun}</p>
          )}
        </div>

        {/* Butonlar */}
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleDelete}
            disabled={deleting || running}
            title="Öğrenciyi sil"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                       border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <Link
            href={`/students/${encodeURIComponent(name)}/edit`}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Pencil className="w-4 h-4" /> Profil Düzenle
          </Link>
          <button
            onClick={() => runAgent(true)}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50
                       disabled:cursor-not-allowed transition-colors"
          >
            <Zap className="w-4 h-4" />
            Hızlı (DAAD)
          </button>
          <button
            onClick={() => runAgent(false)}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ background: running ? "#64748b" : "var(--aes-navy)" }}
          >
            {running
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Çalışıyor...</>
              : <><Play className="w-4 h-4" /> Tam Araştırma</>
            }
          </button>
        </div>
      </div>

      {/* Profil özeti + Belgeler + Raporlar */}
      {detail && (
        <div className="grid sm:grid-cols-3 gap-4">

          {/* Profil özeti */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Profil</h3>
              <Link
                href={`/students/${encodeURIComponent(name)}/edit`}
                className="text-xs text-blue-600 hover:underline"
              >
                Düzenle
              </Link>
            </div>
            {profile ? (
              <div className="space-y-1.5 text-xs text-slate-600">
                {profile.desired_field && (
                  <div className="flex gap-1.5">
                    <span className="text-slate-400 shrink-0">Alan:</span>
                    <span className="font-medium truncate">{profile.desired_field}</span>
                  </div>
                )}
                {profile.degree_type && (
                  <div className="flex gap-1.5">
                    <span className="text-slate-400 shrink-0">Derece:</span>
                    <span>{profile.degree_type}</span>
                  </div>
                )}
                {profile.gpa_turkish && (
                  <div className="flex gap-1.5">
                    <span className="text-slate-400 shrink-0">GPA:</span>
                    <span>{profile.gpa_turkish}</span>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <span className="text-slate-400 shrink-0">Almanca:</span>
                  <span className={profile.german_level && profile.german_level !== "Yok" ? "text-green-700 font-medium" : "text-slate-400"}>
                    {profile.german_level || "—"}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <span className="text-slate-400 shrink-0">İngilizce:</span>
                  <span className={profile.english_level && profile.english_level !== "Yok" ? "text-green-700 font-medium" : "text-slate-400"}>
                    {profile.english_level || "—"}
                  </span>
                </div>
                {profile.preferred_cities && (
                  <div className="flex gap-1.5">
                    <span className="text-slate-400 shrink-0">Şehir:</span>
                    <span className="truncate">{profile.preferred_cities || "Fark etmez"}</span>
                  </div>
                )}
                {profile.start_semester && (
                  <div className="flex gap-1.5">
                    <span className="text-slate-400 shrink-0">Dönem:</span>
                    <span>{profile.start_semester}</span>
                  </div>
                )}
                {profile.advisor_notes && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <p className="text-slate-400 mb-0.5">Notlar:</p>
                    <p className="text-slate-600 leading-relaxed whitespace-pre-line">
                      {profile.advisor_notes.length > 150
                        ? profile.advisor_notes.slice(0, 150) + "…"
                        : profile.advisor_notes}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Profil yükleniyor...</p>
            )}
          </div>

          {/* Belgeler */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Belgeler</h3>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="grid grid-cols-1 gap-2 text-xs">
              {/* Yüklenebilir belgeler */}
              {([
                { key: "transkript", label: "Transkript",  filename: "transkript.pdf",  exists: detail.documents.transkript },
                { key: "dilBelgesi", label: "Dil Belgesi", filename: "dil_belgesi.pdf", exists: detail.documents.dilBelgesi },
                { key: "cv",         label: "CV",          filename: "cv.pdf",          exists: detail.documents.cv },
              ] as { key: string; label: string; filename: string; exists: boolean }[]).map(({ key, label, filename, exists }) => (
                <div key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md ${
                  exists ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-400"
                }`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${exists ? "bg-green-500" : "bg-slate-300"}`} />
                  <span className="flex-1 truncate">{label} (.pdf)</span>
                  {exists ? (
                    <button
                      onClick={() => deleteDoc(filename)}
                      title="Sil"
                      className="ml-auto text-slate-300 hover:text-red-500 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDocUploadClick(key)}
                      disabled={uploadingDoc === key}
                      title="Yükle"
                      className="ml-auto text-slate-300 hover:text-blue-500 transition-colors shrink-0 disabled:opacity-50"
                    >
                      {uploadingDoc === key
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Upload className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              ))}
              {/* Otomatik belgeler (salt görüntüleme) */}
              {[
                { key: "profil",     label: "Profil",     exists: detail.documents.profil },
                { key: "motivasyon", label: "Motivasyon", exists: detail.documents.motivasyon },
              ].map(({ key, label, exists }) => (
                <div key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md ${
                  exists ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-400"
                }`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${exists ? "bg-green-500" : "bg-slate-300"}`} />
                  <span className="truncate">{label}</span>
                  <span className="ml-auto text-slate-300 text-xs">otomatik</span>
                </div>
              ))}
            </div>
            {/* Ek belge yükle */}
            <button
              onClick={() => handleDocUploadClick("diger")}
              disabled={!!uploadingDoc}
              className="mt-3 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md
                         border border-dashed border-slate-200 text-slate-400 hover:border-blue-300
                         hover:text-blue-500 transition-colors text-xs disabled:opacity-50"
            >
              {uploadingDoc === "diger"
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Upload className="w-3.5 h-3.5" />}
              Ek belge yükle
            </button>
          </div>

          {/* Raporlar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Raporlar</h3>
            {detail.reports.length === 0 ? (
              <p className="text-xs text-slate-400">Henüz rapor üretilmedi</p>
            ) : (
              <div className="space-y-2">
                {detail.reports.map((r) => (
                  <a
                    key={r}
                    href={`/api/students/${encodeURIComponent(name)}/report?file=${encodeURIComponent(r)}`}
                    download
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 hover:bg-blue-50
                               hover:text-blue-700 text-slate-700 text-xs transition-colors group"
                  >
                    {r.endsWith(".docx")
                      ? <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                      : <FileSpreadsheet className="w-4 h-4 text-green-600 shrink-0" />
                    }
                    <span className="truncate">{r}</span>
                    <Download className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Başvuru Takibi Özeti */}
      {tracking.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <BookmarkCheck className="w-4 h-4 text-indigo-500" />
            Başvuru Takibi ({tracking.length} program)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {tracking.map((t) => {
              const tcfg = TRACKING_CONFIG[t.status];
              return (
                <div key={`${t.university}::${t.program}`}
                  className={`rounded-lg px-3 py-2 text-xs ${tcfg.badge} border border-current/10`}>
                  <p className="font-medium truncate">{tcfg.emoji} {t.university}</p>
                  <p className="text-xs opacity-75 truncate">{t.program}</p>
                  <p className="font-semibold mt-0.5">{tcfg.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Yaklaşan başvuru tarihleri uyarısı */}
      {(() => {
        const urgent = sorted
          .filter((p) => p.eligibility === "uygun" || p.eligibility === "sartli")
          .flatMap((p) => {
            const items: { label: string; deadline: string; urgency: { text: string; cls: string } }[] = [];
            const wu = deadlineUrgency(p.deadline_wise);
            const su = deadlineUrgency(p.deadline_sose);
            if (wu && !wu.cls.includes("line-through"))
              items.push({ label: `${p.university} — WiSe`, deadline: p.deadline_wise!, urgency: wu });
            if (su && !su.cls.includes("line-through"))
              items.push({ label: `${p.university} — SoSe`, deadline: p.deadline_sose!, urgency: su });
            return items;
          })
          .filter((x) => x.urgency.cls.includes("red") || x.urgency.cls.includes("amber"))
          .sort((a, b) => (parseDeadline(a.deadline)?.getTime() ?? 0) - (parseDeadline(b.deadline)?.getTime() ?? 0))
          .slice(0, 5);

        if (urgent.length === 0) return null;
        return (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800 mb-2">⏰ Yaklaşan Başvuru Tarihleri</p>
            <div className="space-y-1">
              {urgent.map((x, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-amber-700 truncate max-w-[70%]">{x.label}</span>
                  <span className={x.urgency.cls}>{x.deadline} ({x.urgency.text})</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Log çıktısı */}
      {(running || log) && (
        <div className="bg-slate-900 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
            <p className="text-xs font-medium text-slate-400">
              {running
                ? "⚡ Ajan çalışıyor..."
                : exitCode === 0 || exitCode === null
                  ? "✅ Tamamlandı"
                  : `❌ Hata (çıkış kodu: ${exitCode})`}
            </p>
            {!running && log && (
              <button
                onClick={() => { setLog(""); setExitCode(null); }}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Temizle
              </button>
            )}
          </div>
          <div
            ref={logRef}
            className="p-4 max-h-64 overflow-y-auto text-xs font-mono text-green-400 whitespace-pre-wrap leading-relaxed"
          >
            {log || "Başlatılıyor..."}
          </div>
        </div>
      )}

      {/* Sonuç tablosu */}
      {sorted.length > 0 && (
        <div className="space-y-4">

          {/* Filtre butonları */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === "all"
                  ? "bg-slate-800 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              Tümü ({sorted.length})
            </button>
            {(["uygun", "sartli", "uygun_degil", "veri_yok", "taranmadi"] as const).map((key) =>
              counts[key] ? (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filter === key
                      ? "bg-slate-800 text-white"
                      : `${ELIGIBILITY_CONFIG[key].badge} border border-transparent`
                  }`}
                >
                  {ELIGIBILITY_CONFIG[key].label} ({counts[key]})
                </button>
              ) : null
            )}
          </div>

          {/* Tablo */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs">Üniversite</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs hidden md:table-cell">Program</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs hidden sm:table-cell">Şehir</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs hidden lg:table-cell">Dil</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs">Uygunluk</th>
                  <th className="px-4 py-3 text-xs"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const cfg = ELIGIBILITY_CONFIG[p.eligibility as keyof typeof ELIGIBILITY_CONFIG]
                    ?? ELIGIBILITY_CONFIG.veri_yok;
                  const rowKey = `${p.university}||${p.program}`;
                  const isExpanded = expanded === rowKey;
                  const hasDetails = p.deadline_wise || p.deadline_sose || p.german_requirement
                    || p.english_requirement || p.nc_value || p.notes
                    || p.issues?.length || p.passed_checks?.length;
                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        className={`${cfg.row} transition-opacity ${hasDetails ? "cursor-pointer hover:opacity-90" : ""}`}
                        onClick={() => hasDetails ? setExpanded(isExpanded ? null : rowKey) : undefined}
                      >
                        <td className="px-4 py-3 font-medium text-slate-800 max-w-[160px] truncate">
                          {p.university || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600 hidden md:table-cell max-w-[200px] truncate">
                          {p.program || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs hidden sm:table-cell">
                          {p.city || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs hidden lg:table-cell truncate max-w-[100px]">
                          {p.language || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium w-fit ${cfg.badge}`}>
                              {cfg.label}
                            </span>
                            {(() => {
                              const wu = deadlineUrgency(p.deadline_wise);
                              const su = deadlineUrgency(p.deadline_sose);
                              const best = (wu && !wu.cls.includes("line-through")) ? wu
                                         : (su && !su.cls.includes("line-through")) ? su
                                         : null;
                              return best ? (
                                <span className={`text-xs ${best.cls}`}>{best.text}</span>
                              ) : null;
                            })()}
                            {(() => {
                              const tr = getTracking(p.university, p.program);
                              if (!tr) return null;
                              const tcfg = TRACKING_CONFIG[tr.status];
                              return (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs w-fit ${tcfg.badge}`}>
                                  {tcfg.emoji} {tcfg.label}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {hasDetails && (
                              <span className="text-slate-300 text-xs">{isExpanded ? "▲" : "▼"}</span>
                            )}
                            {p.url && (
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-slate-400 hover:text-blue-600 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${rowKey}-detail`} className={cfg.row}>
                          <td colSpan={6} className="px-4 pb-4">
                            <div className="pt-2 border-t border-slate-200/60 space-y-3">

                              {/* Eligibility reason — en önemli bilgi, en üstte */}
                              {p.eligibility_reason && (
                                <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed font-medium ${
                                  p.eligibility === "uygun"       ? "bg-green-100 text-green-800 border border-green-200" :
                                  p.eligibility === "sartli"      ? "bg-yellow-100 text-yellow-800 border border-yellow-200" :
                                  p.eligibility === "uygun_degil" ? "bg-red-100 text-red-800 border border-red-200" :
                                  "bg-slate-100 text-slate-600 border border-slate-200"
                                }`}>
                                  {p.eligibility_reason}
                                </div>
                              )}

                              {/* Teknik detaylar — 2 sütun */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5 text-xs text-slate-600">
                                {p.language        && <span><span className="text-slate-400">Dil:</span> {p.language}</span>}
                                {p.deadline_wise   && (
                                  <span>
                                    <span className="text-slate-400">WiSe: </span>
                                    {p.deadline_wise}
                                    {(() => { const u = deadlineUrgency(p.deadline_wise); return u ? <span className={`ml-1 ${u.cls}`}>({u.text})</span> : null; })()}
                                  </span>
                                )}
                                {p.deadline_sose   && (
                                  <span>
                                    <span className="text-slate-400">SoSe: </span>
                                    {p.deadline_sose}
                                    {(() => { const u = deadlineUrgency(p.deadline_sose); return u ? <span className={`ml-1 ${u.cls}`}>({u.text})</span> : null; })()}
                                  </span>
                                )}
                                {p.german_requirement  && <span><span className="text-slate-400">Almanca:</span> {p.german_requirement}</span>}
                                {p.english_requirement && <span><span className="text-slate-400">İngilizce:</span> {p.english_requirement}</span>}
                                {p.nc_value            && <span><span className="text-slate-400">NC:</span> {p.nc_value}</span>}
                                {p.min_gpa             && <span><span className="text-slate-400">Min. GPA (DE):</span> {p.min_gpa}</span>}
                                {p.uni_assist_required && <span className="text-amber-600 font-medium">uni-assist gerekli</span>}
                                {p.conditional_admission && <span className="text-blue-600">Şartlı kabul mevcut</span>}
                                {p.confidence < 0.6    && (
                                  <span className="text-slate-400 text-xs">Güvenilirlik: {Math.round(p.confidence * 100)}%</span>
                                )}
                              </div>

                              {/* Issues & passed checks */}
                              {p.issues && p.issues.length > 0 && (
                                <div className="space-y-0.5">
                                  {p.issues.map((issue, j) => (
                                    <p key={j} className="text-xs text-red-600 flex gap-1.5"><span className="shrink-0">✗</span>{issue}</p>
                                  ))}
                                </div>
                              )}
                              {p.passed_checks && p.passed_checks.length > 0 && (
                                <div className="space-y-0.5">
                                  {p.passed_checks.map((check, j) => (
                                    <p key={j} className="text-xs text-green-700 flex gap-1.5"><span className="shrink-0">✓</span>{check}</p>
                                  ))}
                                </div>
                              )}

                              {/* Notes */}
                              {p.notes && (
                                <p className="text-xs text-slate-500 italic border-t border-slate-100 pt-2">
                                  {p.notes.length > 250 ? p.notes.slice(0, 250) + "…" : p.notes}
                                </p>
                              )}

                              {/* Aksiyon butonları: takip + motivasyon */}
                              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                                {/* Takip durumu dropdown */}
                                <div className="flex items-center gap-1.5">
                                  <BookmarkCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <select
                                    value={getTracking(p.university, p.program)?.status ?? ""}
                                    onChange={(e) => updateTracking(p.university, p.program, e.target.value as TrackingStatus)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  >
                                    <option value="">— Durum Seç —</option>
                                    {(Object.entries(TRACKING_CONFIG) as [TrackingStatus, typeof TRACKING_CONFIG[TrackingStatus]][]).map(([key, cfg]) => (
                                      <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
                                    ))}
                                  </select>
                                </div>

                                {/* Motivasyon mektubu butonu */}
                                {(p.eligibility === "uygun" || p.eligibility === "sartli") && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMotivModal({ university: p.university, program: p.program, language: p.language, city: p.city, url: p.url });
                                      setMotivLetter("");
                                      setMotivSavedAs(null);
                                    }}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
                                  >
                                    <FileEdit className="w-3.5 h-3.5" />
                                    Motivasyon Mektubu
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sorted.length === 0 && !running && (
        <div className="text-center py-16 text-slate-400 bg-white rounded-xl border border-slate-200">
          <Play className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Araştırma sonucu yok</p>
          <p className="text-xs mt-1">Yukarıdan araştırma başlatın</p>
        </div>
      )}
    </div>
  );
}
