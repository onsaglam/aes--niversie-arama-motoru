"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Database, Clock, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";

interface Stats {
  total:        number;
  fresh:        number;
  stale:        number;
  uni_count:    number;
  by_language:  { language: string; cnt: number }[];
  by_degree:    { degree: string; cnt: number }[];
  by_source:    { source: string; cnt: number }[];
  top_unis:     { university: string; cnt: number }[];
  last_updated: string | null;
}

interface Program {
  university:          string;
  program:             string;
  city:                string;
  language:            string;
  degree:              string;
  german_requirement:  string | null;
  english_requirement: string | null;
  nc_value:            string | null;
  deadline_wise:       string | null;
  deadline_sose:       string | null;
  uni_assist:          number;
  confidence:          number;
  last_scraped:        string;
  url:                 string | null;
}

export default function ProgramsPage() {
  const [stats,       setStats]       = useState<Stats | null>(null);
  const [programs,    setPrograms]    = useState<Program[]>([]);
  const [search,      setSearch]      = useState("");
  const [langFilter,  setLangFilter]  = useState("");
  const [degFilter,   setDegFilter]   = useState("");
  const [loading,     setLoading]     = useState(true);
  const [cleaning,    setCleaning]    = useState(false);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/programs").then((r) => r.json()),
      fetch("/api/programs?mode=list&limit=500").then((r) => r.json()),
    ]).then(([s, l]) => {
      setStats(s);
      setPrograms(l.rows ?? []);
      setLoading(false);
    });
  };

  useEffect(loadData, []);

  const handleCleanStale = async () => {
    if (!confirm("30 günden eski program kayıtları silinecek. Devam edilsin mi?")) return;
    setCleaning(true);
    const res = await fetch("/api/programs", { method: "DELETE" });
    const data = await res.json();
    setCleaning(false);
    alert(`${data.deleted} eski kayıt silindi.`);
    loadData();
  };

  const filtered = programs.filter((p) => {
    if (langFilter && p.language !== langFilter) return false;
    if (degFilter  && p.degree  !== degFilter)  return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.university?.toLowerCase().includes(q) ||
      p.program?.toLowerCase().includes(q) ||
      p.city?.toLowerCase().includes(q)
    );
  });

  const languages = [...new Set(programs.map((p) => p.language).filter(Boolean))].sort();
  const degrees   = [...new Set(programs.map((p) => p.degree).filter(Boolean))].sort();

  if (loading) return (
    <div className="text-center py-20 text-slate-400">
      <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
      Yükleniyor...
    </div>
  );

  const noDb = stats?.total === 0;

  return (
    <div className="space-y-6">

      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Program Veritabanı</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {stats?.last_updated
                ? `Son güncelleme: ${new Date(stats.last_updated).toLocaleString("tr-TR")}`
                : "Henüz veri yok"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(stats?.stale ?? 0) > 0 && (
            <button
              onClick={handleCleanStale}
              disabled={cleaning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         border border-amber-200 text-amber-600 hover:bg-amber-50 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {cleaning ? "Siliniyor..." : `${stats!.stale} eski kaydı temizle`}
            </button>
          )}
          <Link href="/" className="text-sm text-slate-500 hover:text-blue-600">← Öğrenciler</Link>
        </div>
      </div>

      {/* İstatistik kartları */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Toplam Program"   value={stats?.total ?? 0} color="blue"   />
        <StatCard label="Güncel (≤30 gün)" value={stats?.fresh ?? 0} color="green"  />
        <StatCard label="Eski (>30 gün)"   value={stats?.stale ?? 0} color="yellow" />
        <StatCard label="Üniversite Sayısı" value={stats?.uni_count ?? 0} color="slate" />
      </div>

      {noDb ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Database className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-600">Veritabanı henüz boş</p>
          <p className="text-sm text-slate-400 mt-1">
            Bir öğrenci için araştırma başlattığında veriler buraya kaydedilir.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-3 gap-4">

          {/* Dil dağılımı */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Dil Dağılımı</h3>
            <div className="space-y-2">
              {stats?.by_language?.filter(l => l.language).map((l) => (
                <div key={l.language} className="flex items-center gap-2">
                  <div className="text-xs text-slate-600 w-28 truncate">{l.language}</div>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${Math.round((l.cnt / (stats?.total || 1)) * 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 w-8 text-right">{l.cnt}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Derece dağılımı */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Derece Dağılımı</h3>
            <div className="space-y-2">
              {stats?.by_degree?.map((d) => (
                <div key={d.degree} className="flex items-center gap-2">
                  <div className="text-xs text-slate-600 w-28 truncate">{d.degree}</div>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-purple-500 h-2 rounded-full"
                      style={{ width: `${Math.round((d.cnt / (stats?.total || 1)) * 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 w-8 text-right">{d.cnt}</div>
                </div>
              ))}
              {(!stats?.by_degree || stats.by_degree.length === 0) && (
                <p className="text-xs text-slate-400">Veri yok</p>
              )}
            </div>
          </div>

          {/* Top üniversiteler */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">En Fazla Program</h3>
            <div className="space-y-1">
              {stats?.top_unis?.slice(0, 8).map((u) => (
                <div key={u.university} className="flex items-center justify-between text-xs">
                  <span className="text-slate-700 truncate max-w-[160px]">{u.university}</span>
                  <span className="text-slate-400 shrink-0 ml-2">{u.cnt}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Program listesi */}
      {!noDb && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Üniversite, program veya şehir ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {languages.length > 0 && (
              <select
                value={langFilter}
                onChange={(e) => setLangFilter(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Tüm diller</option>
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
            {degrees.length > 0 && (
              <select
                value={degFilter}
                onChange={(e) => setDegFilter(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Tüm dereceler</option>
                {degrees.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <span className="text-xs text-slate-400 shrink-0">{filtered.length} sonuç</span>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs">Üniversite</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs hidden md:table-cell">Program</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs hidden sm:table-cell">Şehir</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs hidden lg:table-cell">Dil</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs hidden xl:table-cell">Dil Şartı</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs">Güncellik</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.slice(0, 200).map((p, i) => {
                  const daysAgo = Math.floor(
                    (Date.now() - new Date(p.last_scraped).getTime()) / 86400000
                  );
                  const isFresh = daysAgo <= 30;
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[180px] truncate text-xs">
                        {p.url
                          ? <a href={p.url} target="_blank" rel="noopener noreferrer"
                              className="hover:text-blue-600">{p.university || "—"}</a>
                          : (p.university || "—")}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 hidden md:table-cell max-w-[200px] truncate text-xs">
                        {p.program || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell text-xs">
                        {p.city || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 hidden lg:table-cell text-xs">
                        {p.language || "—"}
                      </td>
                      <td className="px-4 py-2.5 hidden xl:table-cell text-xs text-slate-500">
                        {p.german_requirement || p.english_requirement || "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-xs ${
                          isFresh ? "text-green-600" : "text-amber-600"
                        }`}>
                          {isFresh
                            ? <CheckCircle2 className="w-3 h-3" />
                            : <AlertTriangle className="w-3 h-3" />}
                          {daysAgo}g
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div className="px-4 py-3 text-xs text-slate-400 border-t border-slate-100">
                İlk 200 gösteriliyor — aramayı daraltın
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, color,
}: {
  label: string; value: number; color: "blue" | "green" | "yellow" | "slate";
}) {
  const colors = {
    blue:   "bg-blue-50  text-blue-700",
    green:  "bg-green-50 text-green-700",
    yellow: "bg-amber-50 text-amber-700",
    slate:  "bg-slate-50 text-slate-700",
  };
  return (
    <div className={`rounded-xl border border-slate-200 p-4 ${colors[color]}`}>
      <p className="text-2xl font-bold">{value.toLocaleString("tr-TR")}</p>
      <p className="text-xs mt-1 opacity-75">{label}</p>
    </div>
  );
}
