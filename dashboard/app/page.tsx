"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Search, CheckCircle, AlertCircle, XCircle, Clock, FolderOpen, Plus, X } from "lucide-react";

interface StudentSummary {
  name: string;
  hasProfile: boolean;
  hasResults: boolean;
  lastRun: string | null;
  field: string;
  degreeType: string;
  stats: {
    total: number;
    uygun: number;
    sartli: number;
    uygun_degil: number;
    veri_yok: number;
  } | null;
}

function StatBadge({
  icon: Icon, count, label, color,
}: {
  icon: React.ElementType; count: number; label: string; color: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      <span>{count} {label}</span>
    </div>
  );
}

function NewStudentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!value.trim()) { setError("İsim boş olamaz"); return; }
    setLoading(true);
    setError("");
    const res = await fetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: value.trim() }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Hata"); return; }
    onCreated(data.folderName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-800">Yeni Öğrenci Ekle</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ad Soyad</label>
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(""); }}
              placeholder="örn: Ahmet Yılmaz"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            <p className="text-xs text-slate-400 mt-1">
              Klasör adı olarak kaydedilir. Türkçe karakter ve boşluk kullanabilirsiniz.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--aes-navy)" }}
            >
              {loading ? "Oluşturuluyor..." : "Oluştur & Profil Düzenle →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);

  const loadStudents = () => {
    fetch("/api/students")
      .then((r) => r.json())
      .then((data) => { setStudents(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(loadStudents, []);

  const filtered = students.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalUygun  = students.reduce((a, s) => a + (s.stats?.uygun ?? 0), 0);
  const totalSartli = students.reduce((a, s) => a + (s.stats?.sartli ?? 0), 0);

  const handleCreated = (folderName: string) => {
    setShowNew(false);
    router.push(`/students/${encodeURIComponent(folderName)}/edit`);
  };

  return (
    <div className="space-y-8">

      {/* Yeni öğrenci modalı */}
      {showNew && (
        <NewStudentModal
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Üst özet kartları */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Öğrenci",     value: students.length,                              icon: Users,       bg: "bg-blue-50",   text: "text-blue-700"   },
          { label: "Araştırılan", value: students.filter((s) => s.hasResults).length,  icon: FolderOpen,  bg: "bg-purple-50", text: "text-purple-700" },
          { label: "✅ Uygun",    value: totalUygun,                                   icon: CheckCircle, bg: "bg-green-50",  text: "text-green-700"  },
          { label: "⚠️ Şartlı",  value: totalSartli,                                  icon: AlertCircle, bg: "bg-yellow-50", text: "text-yellow-700" },
        ].map(({ label, value, icon: Icon, bg, text }) => (
          <div key={label} className={`rounded-xl ${bg} p-4 flex items-center gap-3`}>
            <Icon className={`w-6 h-6 ${text} shrink-0`} />
            <div>
              <p className="text-2xl font-bold text-slate-800">{value}</p>
              <p className={`text-xs font-medium ${text}`}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Arama + başlık + yeni öğrenci */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <h1 className="text-xl font-semibold text-slate-800">Öğrenci Listesi</h1>
        <div className="sm:ml-auto flex items-center gap-3">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Öğrenci ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 bg-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white shrink-0"
            style={{ background: "var(--aes-navy)" }}
          >
            <Plus className="w-4 h-4" />
            Yeni Öğrenci
          </button>
        </div>
      </div>

      {/* Öğrenci kartları */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p>Yükleniyor...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>{search ? "Eşleşen öğrenci yok" : "Henüz öğrenci eklenmedi"}</p>
          {!search && (
            <button
              onClick={() => setShowNew(true)}
              className="mt-3 text-sm text-blue-600 hover:underline"
            >
              İlk öğrenciyi ekle →
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Link key={s.name} href={`/students/${encodeURIComponent(s.name)}`} className="group block h-full">
              <div className="bg-white rounded-xl border border-slate-200 p-5
                              group-hover:border-blue-300 group-hover:shadow-md transition-all h-full">

                {/* Baş */}
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-800 group-hover:text-blue-700 transition-colors truncate">
                      {s.name.replace(/_/g, " ")}
                    </h2>
                    {s.lastRun && (
                      <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3 shrink-0" /> {s.lastRun}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ml-2 ${
                    s.hasResults ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    {s.hasResults ? "Araştırıldı" : "Bekliyor"}
                  </span>
                </div>

                {/* Alan + Derece */}
                {(s.field || s.degreeType) && (
                  <p className="text-xs text-slate-500 mb-2 truncate">
                    {[s.degreeType, s.field].filter(Boolean).join(" · ")}
                  </p>
                )}

                {/* İstatistikler */}
                {s.stats ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <StatBadge icon={CheckCircle} count={s.stats.uygun}       label="uygun"  color="bg-green-100 text-green-700" />
                      <StatBadge icon={AlertCircle} count={s.stats.sartli}      label="şartlı" color="bg-yellow-100 text-yellow-700" />
                      <StatBadge icon={XCircle}     count={s.stats.uygun_degil} label="değil"  color="bg-red-100 text-red-700" />
                    </div>
                    {/* İlerleme çubuğu */}
                    {s.stats.total > 0 && (
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden flex">
                        <div className="bg-green-500 transition-all" style={{ width: `${(s.stats.uygun / s.stats.total) * 100}%` }} />
                        <div className="bg-yellow-400 transition-all" style={{ width: `${(s.stats.sartli / s.stats.total) * 100}%` }} />
                        <div className="bg-red-400 transition-all"    style={{ width: `${(s.stats.uygun_degil / s.stats.total) * 100}%` }} />
                      </div>
                    )}
                    <p className="text-xs text-slate-400">{s.stats.total} program araştırıldı</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-2">
                    {s.hasProfile ? "Profil hazır — araştırma bekleniyor" : "Profil eksik — düzenle"}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
