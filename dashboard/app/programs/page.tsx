"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Database, Download, Trash2,
  CheckCircle2, AlertTriangle, ExternalLink, Clock, X, SlidersHorizontal,
  Sparkles, RefreshCw, Search, ChevronDown, ChevronUp, Zap, Globe,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────── */

interface Stats {
  total:       number;
  fresh:       number;
  stale:       number;
  uni_count:   number;
  by_language: { language: string; cnt: number }[];
  by_degree:   { degree: string; cnt: number }[];
  top_unis:    { university: string; cnt: number }[];
  last_updated: string | null;
}

interface Program {
  university:            string;
  program:               string;
  city:                  string;
  language:              string;
  degree:                string;
  german_requirement:    string | null;
  english_requirement:   string | null;
  nc_value:              string | null;
  deadline_wise:         string | null;
  deadline_sose:         string | null;
  min_gpa:               number | null;
  uni_assist:            number;
  conditional_admission: number;
  confidence:            number;
  last_scraped:          string;
  url:                   string | null;
}

type NcFilter        = "" | "free" | "restricted";
type DeadlineFilter  = "" | "7" | "14" | "30" | "60";
type UniAssistFilter = "" | "required" | "not_required";

interface EnrichStats { needs_stage1: number; needs_stage2: number; total: number; }

interface HighlightItem {
  title: string; university: string; program: string;
  city?: string; url?: string; deadline?: string; reason: string;
}
interface HighlightSection {
  category: string; icon: string; description: string; items: HighlightItem[];
}
interface HighlightResult {
  sections: HighlightSection[]; summary: string; generated_at: string;
}

/* ─── Helpers ────────────────────────────────────────────── */

const PAGE_LOAD = Date.now();

const MONTHS_DE: Record<string, number> = {
  januar:1, februar:2, märz:3, april:4, mai:5, juni:6,
  juli:7, august:8, september:9, oktober:10, november:11, dezember:12,
  mitte:0,
  january:1, february:2, march:3, may:5, june:6, july:7,
  october:10, december:12,
};

function parseDeadline(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`);
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (m) {
    const now = new Date(); const y = now.getFullYear();
    const d = new Date(y, parseInt(m[2])-1, parseInt(m[1]));
    if (d < now) d.setFullYear(y+1);
    return d;
  }
  const mm = s.match(/(\d{1,2})\.\s*([A-Za-zä]+)/i);
  if (mm) {
    const mo = MONTHS_DE[mm[2].toLowerCase()];
    if (mo) {
      const now = new Date(); const y = now.getFullYear();
      const d = new Date(y, mo-1, parseInt(mm[1]));
      if (d < now) d.setFullYear(y+1);
      return d;
    }
  }
  return null;
}

function daysUntil(d: Date): number {
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function nearestDeadlineDays(p: Program): number | null {
  const dates = [p.deadline_wise, p.deadline_sose]
    .map(parseDeadline)
    .filter((d): d is Date => d !== null)
    .map(daysUntil)
    .filter(d => d >= 0);
  return dates.length ? Math.min(...dates) : null;
}

function DeadlinePill({ raw }: { raw: string | null | undefined }) {
  if (!raw) return <span className="text-slate-300">—</span>;
  const d = parseDeadline(raw);
  if (!d) return <span className="text-xs text-slate-500">{raw}</span>;
  const days = daysUntil(d);
  let cls = "bg-slate-100 text-slate-600";
  let suffix = "";
  if (days < 0)        { cls = "bg-slate-100 text-slate-400"; suffix = ` (${Math.abs(days)}g geçti)`; }
  else if (days <= 14) { cls = "bg-red-100 text-red-700"; }
  else if (days <= 30) { cls = "bg-orange-100 text-orange-700"; }
  else if (days <= 60) { cls = "bg-amber-100 text-amber-700"; }
  else                 { cls = "bg-green-50 text-green-700"; }
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${cls}`}>
      {raw}{suffix}
      {days >= 0 && days <= 60 && <span className="ml-1 opacity-70">({days}g)</span>}
    </span>
  );
}

function LangBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium ${color}`}>
      <span className="opacity-60 text-[10px] uppercase tracking-wide">{label}</span>
      {value}
    </span>
  );
}

function NcBadge({ nc }: { nc: string | null }) {
  if (!nc) return null;
  const lower = nc.toLowerCase().trim();
  if (lower === "zulassungsfrei" || lower === "none" || lower === "null")
    return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">NC Yok</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">NC {nc}</span>;
}

function ConfidenceBar({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400">{pct}%</span>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────── */

export default function ProgramsPage() {
  const [stats,           setStats]           = useState<Stats | null>(null);
  const [programs,        setPrograms]        = useState<Program[]>([]);
  const [totalRows,       setTotalRows]       = useState(0);
  const [loading,         setLoading]         = useState(true);
  const [cleaning,        setCleaning]        = useState(false);
  const [showLimit,       setShowLimit]       = useState(300);
  const [showFilters,     setShowFilters]     = useState(false);

  // Enrichment panel
  const [enrichStats,    setEnrichStats]     = useState<EnrichStats | null>(null);
  const [enrichRunning,  setEnrichRunning]   = useState(false);
  const [enrichMsg,      setEnrichMsg]       = useState("");
  const [showEnrich,     setShowEnrich]      = useState(false);

  // AI Highlights
  const [highlights,     setHighlights]      = useState<HighlightResult | null>(null);
  const [hiLoading,      setHiLoading]       = useState(false);
  const [showAiPicks,    setShowAiPicks]     = useState(false);
  const [hiCatFilter,    setHiCatFilter]     = useState("");
  const [hiUniFilter,    setHiUniFilter]     = useState("");
  const [hiKwFilter,     setHiKwFilter]      = useState("");

  // Filters
  const [search,          setSearch]          = useState("");
  const [langFilter,      setLangFilter]      = useState("");
  const [degFilter,       setDegFilter]       = useState("");
  const [cityFilter,      setCityFilter]      = useState("");
  const [ncFilter,        setNcFilter]        = useState<NcFilter>("");
  const [deadlineFilter,  setDeadlineFilter]  = useState<DeadlineFilter>("");
  const [uniAssistFilter, setUniAssistFilter] = useState<UniAssistFilter>("");
  const [minConf,         setMinConf]         = useState(0.0);
  const [sortKey,         setSortKey]         = useState<"university"|"deadline_wise"|"deadline_sose"|"last_scraped"|"confidence">("last_scraped");
  const [sortDir,         setSortDir]         = useState<"asc"|"desc">("desc");

  const loadStats = () =>
    fetch("/api/programs").then(r => r.json()).then(setStats);

  const loadPrograms = (lang = langFilter, deg = degFilter, q = search) => {
    setLoading(true);
    const p = new URLSearchParams({ mode: "list", limit: "5000" });
    if (lang) p.set("lang",   lang);
    if (deg)  p.set("degree", deg);
    if (q)    p.set("search", q);
    fetch(`/api/programs?${p}`)
      .then(r => r.json())
      .then(l => { setPrograms(l.rows ?? []); setTotalRows(l.total ?? 0); setLoading(false); });
  };

  const loadEnrichStats = () =>
    fetch("/api/programs/enrich").then(r => r.json()).then(setEnrichStats).catch(() => {});

  const runEnrich = async (stage: "1" | "2" | "all", batch = 20) => {
    setEnrichRunning(true);
    setEnrichMsg("Çalışıyor...");
    try {
      const r = await fetch("/api/programs/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, batch }),
      });
      const d = await r.json();
      setEnrichMsg(d.success ? "Tamamlandı ✓" : `Hata: ${d.error ?? "bilinmeyen"}`);
      if (d.success) { loadStats(); loadPrograms(); loadEnrichStats(); }
    } catch (e) {
      setEnrichMsg("Bağlantı hatası");
    }
    setEnrichRunning(false);
  };

  const loadHighlights = (force = false) => {
    setHiLoading(true);
    const url = "/api/programs/highlights" + (force ? "?refresh=1" : "");
    fetch(url).then(r => r.json()).then(d => { setHighlights(d); setHiLoading(false); }).catch(() => setHiLoading(false));
  };

  useEffect(() => { loadStats(); loadPrograms("","",""); loadEnrichStats(); }, []); // eslint-disable-line

  // Filtered AI highlights
  const filteredHighlights = useMemo(() => {
    if (!highlights) return [];
    return highlights.sections
      .filter(s => !hiCatFilter || s.category === hiCatFilter)
      .map(s => ({
        ...s,
        items: s.items.filter(item => {
          if (hiUniFilter && !item.university.toLowerCase().includes(hiUniFilter.toLowerCase())) return false;
          if (hiKwFilter && !item.program.toLowerCase().includes(hiKwFilter.toLowerCase()) && !item.reason.toLowerCase().includes(hiKwFilter.toLowerCase())) return false;
          return true;
        }),
      }))
      .filter(s => s.items.length > 0);
  }, [highlights, hiCatFilter, hiUniFilter, hiKwFilter]);

  // Dynamic option lists
  const cities  = useMemo(() => [...new Set(programs.map(p => p.city).filter(Boolean))].sort(), [programs]);
  const degrees = useMemo(() => [...new Set(programs.map(p => p.degree).filter(Boolean))].sort(), [programs]);

  // Client-side filtering
  const filtered = useMemo(() => programs.filter(p => {
    // city
    if (cityFilter && p.city !== cityFilter) return false;
    // confidence threshold
    if (p.confidence < minConf) return false;
    // NC
    if (ncFilter === "free") {
      const v = p.nc_value?.toLowerCase().trim() ?? "";
      if (v !== "zulassungsfrei" && v !== "none" && v !== "null" && v !== "") return false;
    }
    if (ncFilter === "restricted") {
      const v = p.nc_value?.toLowerCase().trim() ?? "";
      if (!v || v === "zulassungsfrei" || v === "none" || v === "null") return false;
    }
    // deadline proximity
    if (deadlineFilter) {
      const maxDays = parseInt(deadlineFilter);
      const nearest = nearestDeadlineDays(p);
      if (nearest === null || nearest > maxDays) return false;
    }
    // uni-assist
    if (uniAssistFilter === "required"     && !p.uni_assist)  return false;
    if (uniAssistFilter === "not_required" && p.uni_assist)   return false;
    return true;
  }).sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "confidence") return (a.confidence - b.confidence) * dir;
    const av = (a[sortKey] ?? "") as string;
    const bv = (b[sortKey] ?? "") as string;
    return av < bv ? -dir : av > bv ? dir : 0;
  }), [programs, cityFilter, minConf, ncFilter, deadlineFilter, uniAssistFilter, sortKey, sortDir]);

  // Active filter chips
  const activeFilters: { label: string; clear: () => void }[] = [];
  if (search)          activeFilters.push({ label: `"${search}"`,                  clear: () => { setSearch(""); loadPrograms(langFilter, degFilter, ""); } });
  if (langFilter)      activeFilters.push({ label: langFilter,                      clear: () => { setLangFilter(""); loadPrograms("", degFilter, search); } });
  if (degFilter)       activeFilters.push({ label: degFilter,                       clear: () => { setDegFilter(""); loadPrograms(langFilter, "", search); } });
  if (cityFilter)      activeFilters.push({ label: `Şehir: ${cityFilter}`,          clear: () => setCityFilter("") });
  if (ncFilter)        activeFilters.push({ label: ncFilter === "free" ? "NC Yok" : "NC Var",  clear: () => setNcFilter("") });
  if (deadlineFilter)  activeFilters.push({ label: `≤${deadlineFilter}g deadline`,  clear: () => setDeadlineFilter("") });
  if (uniAssistFilter) activeFilters.push({ label: uniAssistFilter === "required" ? "uni-assist gerekli" : "uni-assist yok", clear: () => setUniAssistFilter("") });
  if (minConf > 0)     activeFilters.push({ label: `Güven ≥${Math.round(minConf*100)}%`,       clear: () => setMinConf(0) });

  const clearAll = () => {
    setSearch(""); setLangFilter(""); setDegFilter(""); setCityFilter("");
    setNcFilter(""); setDeadlineFilter(""); setUniAssistFilter(""); setMinConf(0);
    loadPrograms("", "", "");
  };

  const handleClean = async () => {
    if (!confirm("30 günden eski kayıtlar silinecek. Devam?")) return;
    setCleaning(true);
    const r = await fetch("/api/programs", { method: "DELETE" });
    const d = await r.json();
    setCleaning(false);
    alert(`${d.deleted} eski kayıt silindi.`);
    loadStats(); loadPrograms();
  };

  const exportCsv = () => {
    const headers = ["Üniversite","Şehir","Program","Derece","Dil","Almanca Şartı","İngilizce Şartı","NC","Min GPA","WiSe Deadline","SoSe Deadline","uni-assist","Güven","Güncelleme","URL"];
    const rows = filtered.map(p => [
      p.university, p.city, p.program, p.degree, p.language,
      p.german_requirement ?? "", p.english_requirement ?? "",
      p.nc_value ?? "", p.min_gpa ?? "",
      p.deadline_wise ?? "", p.deadline_sose ?? "",
      p.uni_assist ? "Evet" : "Hayır",
      `${Math.round(p.confidence * 100)}%`, p.last_scraped, p.url ?? "",
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `aes-programlar-${new Date().toISOString().slice(0,10)}.csv`,
    });
    a.click();
  };

  const noDb = (stats?.total ?? 0) === 0;

  return (
    <div className="space-y-6">

      {/* Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex items-center gap-2">
          {filtered.length > 0 && (
            <button onClick={exportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-green-200 text-green-700 hover:bg-green-50 transition-colors">
              <Download className="w-3.5 h-3.5" /> CSV ({filtered.length})
            </button>
          )}
          {(stats?.stale ?? 0) > 0 && (
            <button onClick={handleClean} disabled={cleaning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-200 text-amber-600 hover:bg-amber-50 disabled:opacity-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
              {cleaning ? "Siliniyor..." : `${stats!.stale} eskiyi temizle`}
            </button>
          )}
          <Link href="/" className="text-sm text-slate-500 hover:text-blue-600">← Öğrenciler</Link>
        </div>
      </div>

      {/* İstatistik kartları */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Toplam Program",    value: stats?.total     ?? 0, color: "blue"   },
          { label: "Güncel (≤30 gün)",  value: stats?.fresh     ?? 0, color: "green"  },
          { label: "Eski (>30 gün)",    value: stats?.stale     ?? 0, color: "yellow" },
          { label: "Üniversite Sayısı", value: stats?.uni_count ?? 0, color: "slate"  },
        ].map(({ label, value, color }) => (
          <StatCard key={label} label={label} value={value} color={color as "blue"|"green"|"yellow"|"slate"} />
        ))}
      </div>

      {!noDb && (
        <div className="grid sm:grid-cols-3 gap-4">
          <MiniChart title="Dil Dağılımı"    items={stats?.by_language?.filter(l=>l.language) ?? []} total={stats?.total ?? 1} color="bg-blue-500" />
          <MiniChart title="Derece Dağılımı" items={stats?.by_degree   ?? []} total={stats?.total ?? 1} color="bg-purple-500" />
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">En Fazla Program</h3>
            <div className="space-y-1">
              {stats?.top_unis?.slice(0,8).map(u => (
                <div key={u.university} className="flex items-center justify-between text-xs">
                  <span className="text-slate-700 truncate max-w-[165px]">{u.university}</span>
                  <span className="text-slate-400 shrink-0 ml-2 font-medium">{u.cnt}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Enrichment Panel ─────────────────────────────────── */}
      {!noDb && enrichStats && (enrichStats.needs_stage1 > 0 || enrichStats.needs_stage2 > 0) && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
            onClick={() => setShowEnrich(v => !v)}
          >
            <span className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Eksik Veri Tarama
              <span className="text-xs font-normal text-amber-600">
                {enrichStats.needs_stage1} URL eksik · {enrichStats.needs_stage2} detay eksik
              </span>
            </span>
            {showEnrich ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showEnrich && (
            <div className="border-t border-amber-100 px-4 py-3 space-y-3">
              <p className="text-xs text-slate-500">
                2 aşamalı tarama: <strong>Stage 1</strong> Tavily ile URL bulur,
                <strong> Stage 2</strong> Playwright + Claude ile deadline / dil şartı / NC detaylarını çeker.
              </p>

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  disabled={enrichRunning || enrichStats.needs_stage1 === 0}
                  onClick={() => runEnrich("1", 20)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors"
                >
                  {enrichRunning ? <div className="w-3 h-3 border border-amber-600 border-t-transparent rounded-full animate-spin" /> : <Search className="w-3 h-3" />}
                  Stage 1 — URL Bul ({enrichStats.needs_stage1})
                </button>

                <button
                  disabled={enrichRunning || enrichStats.needs_stage2 === 0}
                  onClick={() => runEnrich("2", 10)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition-colors"
                >
                  {enrichRunning ? <div className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin" /> : <Globe className="w-3 h-3" />}
                  Stage 2 — Detay Tara ({enrichStats.needs_stage2})
                </button>

                <button
                  disabled={enrichRunning}
                  onClick={() => runEnrich("all", 15)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
                >
                  Her İkisi
                </button>

                {enrichMsg && (
                  <span className={`text-xs ml-2 ${enrichMsg.startsWith("Hata") ? "text-red-500" : enrichMsg === "Çalışıyor..." ? "text-slate-400" : "text-green-600"}`}>
                    {enrichMsg}
                  </span>
                )}
              </div>

              <p className="text-[10px] text-slate-400">
                Stage 2 her program için ~5-15 sn sürer. Büyük batch&apos;lerde uzun sürebilir.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── AI Önerileri ─────────────────────────────────────── */}
      {!noDb && (
        <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-purple-700 hover:bg-purple-50 transition-colors"
            onClick={() => {
              setShowAiPicks(v => !v);
              if (!highlights && !hiLoading) loadHighlights();
            }}
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              AI Önerileri
              <span className="text-xs font-normal text-purple-500">Claude tarafından öne çıkarılan programlar</span>
            </span>
            <div className="flex items-center gap-2">
              {highlights && (
                <button
                  onClick={e => { e.stopPropagation(); loadHighlights(true); }}
                  className="p-1 rounded hover:bg-purple-100 text-purple-400 hover:text-purple-600"
                  title="Yenile"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              {showAiPicks ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {showAiPicks && (
            <div className="border-t border-purple-100">
              {hiLoading && (
                <div className="flex items-center justify-center py-10 gap-3 text-purple-400 text-sm">
                  <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  Claude analiz yapıyor...
                </div>
              )}

              {!hiLoading && highlights && (
                <div className="p-4 space-y-4">
                  {/* Filtreler */}
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Kategori</label>
                      <select
                        value={hiCatFilter}
                        onChange={e => setHiCatFilter(e.target.value)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                      >
                        <option value="">Tüm kategoriler</option>
                        {highlights.sections.map(s => (
                          <option key={s.category} value={s.category}>{s.icon} {s.category}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Üniversite</label>
                      <input
                        type="text"
                        placeholder="Filtrele..."
                        value={hiUniFilter}
                        onChange={e => setHiUniFilter(e.target.value)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Program / Anahtar Kelime</label>
                      <input
                        type="text"
                        placeholder="Ara..."
                        value={hiKwFilter}
                        onChange={e => setHiKwFilter(e.target.value)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                    </div>

                    {(hiCatFilter || hiUniFilter || hiKwFilter) && (
                      <button
                        onClick={() => { setHiCatFilter(""); setHiUniFilter(""); setHiKwFilter(""); }}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 pb-1.5 transition-colors"
                      >
                        <X className="w-3 h-3" /> Temizle
                      </button>
                    )}

                    <span className="text-xs text-slate-400 ml-auto pb-1.5">
                      {filteredHighlights.reduce((n, s) => n + s.items.length, 0)} öneri
                    </span>
                  </div>

                  {/* Kategoriler */}
                  {filteredHighlights.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">Filtrelerle eşleşen öneri yok</p>
                  ) : (
                    <div className="space-y-5">
                      {filteredHighlights.map(section => (
                        <div key={section.category}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg">{section.icon}</span>
                            <div>
                              <h3 className="text-sm font-semibold text-slate-800">{section.category}</h3>
                              <p className="text-xs text-slate-500">{section.description}</p>
                            </div>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-2">
                            {section.items.map((item, i) => (
                              <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-slate-800 truncate">{item.university}</p>
                                    <p className="text-xs text-slate-600 leading-snug">{item.program}</p>
                                  </div>
                                  {item.url && (
                                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                                       className="shrink-0 text-blue-500 hover:text-blue-700">
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                                {item.city && <p className="text-[10px] text-slate-400">{item.city}</p>}
                                {item.deadline && (
                                  <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">
                                    Deadline: {item.deadline}
                                  </span>
                                )}
                                <p className="text-[11px] text-purple-700 bg-purple-50 rounded px-2 py-1 leading-snug">
                                  {item.reason}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {highlights.summary && (
                    <div className="border-t border-purple-100 pt-3">
                      <p className="text-xs text-slate-500 italic">{highlights.summary}</p>
                      <p className="text-[10px] text-slate-300 mt-1">
                        Oluşturulma: {new Date(highlights.generated_at).toLocaleString("tr-TR")} · 6 saatte bir yenilenir
                      </p>
                    </div>
                  )}
                </div>
              )}

              {!hiLoading && !highlights && (
                <div className="p-6 text-center">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 text-purple-300" />
                  <p className="text-sm text-slate-500 mb-3">AI analizi henüz yüklenmedi</p>
                  <button
                    onClick={() => loadHighlights()}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors"
                  >
                    Analiz Başlat
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {noDb ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Database className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-600">Veritabanı henüz boş</p>
          <p className="text-sm text-slate-400 mt-1">
            Bir öğrenci için araştırma başlattığında veriler buraya kaydedilir.
          </p>
        </div>
      ) : (
        <div className="space-y-3">

          {/* Filtre paneli */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">

            {/* Satır 1: Arama + filtre toggle */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Üniversite, program veya şehir ara..."
                value={search}
                onChange={e => { const v = e.target.value; setSearch(v); if (v.length===0||v.length>=2) loadPrograms(langFilter,degFilter,v); }}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => setShowFilters(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  showFilters || activeFilters.length > 0
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filtreler
                {activeFilters.length > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {activeFilters.length}
                  </span>
                )}
              </button>
            </div>

            {/* Filtreler (genişletilebilir) */}
            {showFilters && (
              <div className="space-y-3 pt-1 border-t border-slate-100">

                {/* Satır 2: Program özellikleri */}
                <div className="flex flex-wrap gap-2">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Güven Eşiği</label>
                    <div className="flex gap-1">
                      {([
                        [0.0,  "Tümü"],
                        [0.6,  "≥60%"],
                        [0.75, "≥75%"],
                        [0.85, "≥85%"],
                      ] as [number, string][]).map(([val, lbl]) => (
                        <button
                          key={val}
                          onClick={() => setMinConf(val)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            minConf === val
                              ? "bg-slate-700 text-white"
                              : "border border-slate-200 text-slate-500 hover:border-slate-300 bg-white"
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">NC Durumu</label>
                    <FilterSelect value={ncFilter} onChange={v => setNcFilter(v as NcFilter)} label="NC Durumu">
                      <option value="">Tümü</option>
                      <option value="free">NC Yok (Zulassungsfrei)</option>
                      <option value="restricted">NC Var</option>
                    </FilterSelect>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Deadline</label>
                    <FilterSelect value={deadlineFilter} onChange={v => setDeadlineFilter(v as DeadlineFilter)} label="Deadline">
                      <option value="">Tüm tarihler</option>
                      <option value="7">7 gün içinde</option>
                      <option value="14">14 gün içinde</option>
                      <option value="30">30 gün içinde</option>
                      <option value="60">60 gün içinde</option>
                    </FilterSelect>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">uni-assist</label>
                    <FilterSelect value={uniAssistFilter} onChange={v => setUniAssistFilter(v as UniAssistFilter)} label="uni-assist">
                      <option value="">Tümü</option>
                      <option value="required">uni-assist gerekli</option>
                      <option value="not_required">uni-assist yok</option>
                    </FilterSelect>
                  </div>
                </div>

                {/* Satır 3: Program bilgileri */}
                <div className="flex flex-wrap gap-2">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Eğitim Dili</label>
                    <FilterSelect value={langFilter} onChange={v => { setLangFilter(v); loadPrograms(v,degFilter,search); }} label="Dil">
                      <option value="">Tüm diller</option>
                      <option value="İngilizce">İngilizce</option>
                      <option value="Almanca">Almanca</option>
                    </FilterSelect>
                  </div>

                  {degrees.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Derece</label>
                      <FilterSelect value={degFilter} onChange={v => { setDegFilter(v); loadPrograms(langFilter,v,search); }} label="Derece">
                        <option value="">Tüm dereceler</option>
                        {degrees.map(d => <option key={d} value={d}>{d}</option>)}
                      </FilterSelect>
                    </div>
                  )}

                  {cities.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Şehir</label>
                      <FilterSelect value={cityFilter} onChange={v => setCityFilter(v)} label="Şehir">
                        <option value="">Tüm şehirler</option>
                        {cities.slice(0, 60).map(c => <option key={c} value={c}>{c}</option>)}
                      </FilterSelect>
                    </div>
                  )}

                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide px-1">Sırala</label>
                    <FilterSelect value={`${sortKey}:${sortDir}`} onChange={v => {
                      const [k,d] = v.split(":") as [typeof sortKey, typeof sortDir];
                      setSortKey(k); setSortDir(d);
                    }} label="Sırala">
                      <option value="last_scraped:desc">En yeni</option>
                      <option value="last_scraped:asc">En eski</option>
                      <option value="university:asc">Üniversite A→Z</option>
                      <option value="university:desc">Üniversite Z→A</option>
                      <option value="deadline_wise:asc">WiSe erken</option>
                      <option value="deadline_sose:asc">SoSe erken</option>
                      <option value="confidence:desc">Güvenilirlik ↓</option>
                    </FilterSelect>
                  </div>
                </div>
              </div>
            )}

            {/* Aktif filtre çipleri + sonuç sayısı */}
            <div className="flex flex-wrap items-center gap-2">
              {activeFilters.map((f, i) => (
                <button
                  key={i}
                  onClick={f.clear}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-200 transition-colors"
                >
                  {f.label}
                  <X className="w-3 h-3" />
                </button>
              ))}
              {activeFilters.length > 1 && (
                <button onClick={clearAll} className="text-xs text-slate-400 hover:text-red-500 transition-colors">
                  Tümünü temizle
                </button>
              )}
              <span className="text-xs text-slate-400 ml-auto shrink-0">
                <span className="font-semibold text-slate-600">{filtered.length.toLocaleString("tr-TR")}</span>
                {" / "}{totalRows.toLocaleString("tr-TR")} program
              </span>
            </div>
          </div>

          {/* Tablo */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mr-3" />
              Yükleniyor...
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: "1060px" }}>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left">
                      <Th>Üniversite / Şehir</Th>
                      <Th>Program</Th>
                      <Th>Dil</Th>
                      <Th>Dil Şartı</Th>
                      <Th>WiSe Deadline</Th>
                      <Th>SoSe Deadline</Th>
                      <Th>NC / Kabul</Th>
                      <Th>Güven</Th>
                      <Th>Güncl.</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.slice(0, showLimit).map((p, i) => (
                      <ProgramRow key={i} p={p} />
                    ))}
                  </tbody>
                </table>
              </div>

              {filtered.length > showLimit && (
                <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    {showLimit} / {filtered.length.toLocaleString("tr-TR")} gösteriliyor
                  </span>
                  <button
                    onClick={() => setShowLimit(l => l + 300)}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    +300 daha yükle →
                  </button>
                </div>
              )}

              {filtered.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  <p>Eşleşen program bulunamadı</p>
                  {activeFilters.length > 0 && (
                    <button onClick={clearAll} className="mt-2 text-sm text-blue-500 hover:underline">
                      Tüm filtreleri temizle
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────── */

function ProgramRow({ p }: { p: Program }) {
  const daysAgo = Math.floor((PAGE_LOAD - new Date(p.last_scraped).getTime()) / 86400000);
  const isFresh = daysAgo <= 30;

  return (
    <tr className="hover:bg-slate-50 transition-colors">

      {/* Üniversite */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "180px", maxWidth: "220px" }}>
        <div className="font-semibold text-slate-800 text-xs leading-snug">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noopener noreferrer"
               className="hover:text-blue-600 inline-flex items-center gap-1">
              {p.university || "—"}
              <ExternalLink className="w-3 h-3 opacity-40 shrink-0" />
            </a>
          ) : (p.university || "—")}
        </div>
        {p.city && <div className="text-xs text-slate-400 mt-0.5">{p.city}</div>}
        {p.degree && (
          <span className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
            {p.degree}
          </span>
        )}
      </td>

      {/* Program */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "200px", maxWidth: "280px" }}>
        <div className="text-xs text-slate-700 leading-snug">{p.program || "—"}</div>
        {p.min_gpa && (
          <div className="text-[10px] text-slate-400 mt-0.5">Min GPA: {p.min_gpa} (DE)</div>
        )}
      </td>

      {/* Dil (eğitim dili) */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "90px" }}>
        {p.language ? (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            p.language.toLowerCase().includes("ingilizce") || p.language.toLowerCase().includes("english") || p.language.toLowerCase().includes("englisch")
              ? "bg-teal-50 text-teal-700"
              : p.language.toLowerCase().includes("almanca") || p.language.toLowerCase().includes("german") || p.language.toLowerCase().includes("deutsch")
              ? "bg-blue-50 text-blue-700"
              : "bg-slate-100 text-slate-600"
          }`}>
            {p.language.length > 22 ? p.language.slice(0, 22) + "…" : p.language}
          </span>
        ) : <span className="text-slate-300 text-xs">—</span>}
      </td>

      {/* Dil Şartı */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "160px" }}>
        <div className="flex flex-col gap-1">
          {p.german_requirement && (
            <LangBadge label="DE" value={p.german_requirement} color="bg-blue-50 text-blue-700" />
          )}
          {p.english_requirement && (
            <LangBadge label="EN" value={p.english_requirement} color="bg-teal-50 text-teal-700" />
          )}
          {!p.german_requirement && !p.english_requirement && (
            <span className="text-xs text-slate-300">—</span>
          )}
        </div>
      </td>

      {/* WiSe Deadline */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "120px" }}>
        <DeadlinePill raw={p.deadline_wise} />
      </td>

      {/* SoSe Deadline */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "120px" }}>
        <DeadlinePill raw={p.deadline_sose} />
      </td>

      {/* NC / Kabul */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "130px" }}>
        <div className="flex flex-col gap-1">
          <NcBadge nc={p.nc_value} />
          {!!p.uni_assist && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium w-fit">
              uni-assist
            </span>
          )}
        </div>
      </td>

      {/* Güven */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "90px" }}>
        <ConfidenceBar v={p.confidence} />
      </td>

      {/* Güncelleme */}
      <td className="px-4 py-3 align-top" style={{ minWidth: "68px" }}>
        <span className={`inline-flex items-center gap-1 text-xs ${isFresh ? "text-green-600" : "text-amber-600"}`}>
          {isFresh
            ? <CheckCircle2 className="w-3 h-3 shrink-0" />
            : <AlertTriangle className="w-3 h-3 shrink-0" />}
          {daysAgo}g
        </span>
        {!isFresh && (
          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" /> eski
          </div>
        )}
      </td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 font-semibold text-slate-600 text-xs whitespace-nowrap">
      {children}
    </th>
  );
}

function FilterSelect({ value, onChange, label, children }: {
  value: string; onChange: (v: string) => void; label: string; children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      title={label}
      className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {children}
    </select>
  );
}

function MiniChart({ title, items, total, color }: {
  title: string;
  items: { language?: string; degree?: string; cnt: number }[];
  total: number;
  color: string;
}) {
  const rows = items.map(i => ({ label: i.language || i.degree || "?", cnt: i.cnt }));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      <div className="space-y-2">
        {rows.slice(0,8).map(r => (
          <div key={r.label} className="flex items-center gap-2">
            <div className="text-xs text-slate-600 truncate" style={{ minWidth: "90px", maxWidth: "110px" }}>{r.label}</div>
            <div className="flex-1 bg-slate-100 rounded-full h-2">
              <div className={`${color} h-2 rounded-full`} style={{ width: `${Math.round((r.cnt/total)*100)}%` }} />
            </div>
            <div className="text-xs text-slate-500 w-8 text-right shrink-0">{r.cnt}</div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-slate-400">Veri yok</p>}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: "blue"|"green"|"yellow"|"slate" }) {
  const cls = { blue:"bg-blue-50 text-blue-700", green:"bg-green-50 text-green-700", yellow:"bg-amber-50 text-amber-700", slate:"bg-slate-50 text-slate-700" }[color];
  return (
    <div className={`rounded-xl border border-slate-200 p-4 ${cls}`}>
      <p className="text-2xl font-bold">{value.toLocaleString("tr-TR")}</p>
      <p className="text-xs mt-1 opacity-75">{label}</p>
    </div>
  );
}
