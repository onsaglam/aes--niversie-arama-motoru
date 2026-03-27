"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Play, Zap, Download, ExternalLink,
  CheckCircle2, AlertTriangle, XCircle, HelpCircle,
  FileText, FileSpreadsheet, Pencil,
} from "lucide-react";

interface Program {
  university: string;
  program: string;
  city: string;
  eligibility: string;
  url: string;
}

interface StudentDetail {
  name: string;
  programs: Program[];
  lastRun: string | null;
  reports: string[];
  documents: {
    profil: boolean;
    transkript: boolean;
    dilBelgesi: boolean;
    motivasyon: boolean;
    cv: boolean;
  };
}

const ELIGIBILITY_CONFIG = {
  uygun:       { icon: CheckCircle2,   label: "✅ Uygun",       row: "bg-green-50",   badge: "bg-green-100 text-green-800",   order: 0 },
  sartli:      { icon: AlertTriangle,  label: "⚠️ Şartlı",      row: "bg-yellow-50",  badge: "bg-yellow-100 text-yellow-800", order: 1 },
  uygun_degil: { icon: XCircle,        label: "❌ Uygun Değil", row: "bg-red-50",     badge: "bg-red-100 text-red-800",       order: 2 },
  veri_yok:    { icon: HelpCircle,     label: "❓ Veri Yok",    row: "",              badge: "bg-slate-100 text-slate-600",   order: 3 },
  taranmadi:   { icon: HelpCircle,     label: "⏭ Taranmadı",   row: "",              badge: "bg-slate-100 text-slate-500",   order: 4 },
} as const;

export default function StudentPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);

  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog]         = useState("");
  const [filter, setFilter]   = useState<string>("all");
  const logRef = useRef<HTMLDivElement>(null);

  const fetchDetail = () => {
    fetch(`/api/students/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(fetchDetail, [name]);

  // Log otomatik scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const runAgent = async (quick: boolean) => {
    setRunning(true);
    setLog("");

    const url = `/api/students/${encodeURIComponent(name)}/run${quick ? "?quick=1" : ""}`;
    const res  = await fetch(url, { method: "POST" });
    const reader = res.body?.getReader();
    if (!reader) { setRunning(false); return; }

    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      setLog((prev) => prev + dec.decode(value));
    }

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

  return (
    <div className="space-y-6">

      {/* Breadcrumb */}
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Tüm Öğrenciler
      </Link>

      {/* Başlık */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{name.replace(/_/g, " ")}</h1>
          {detail?.lastRun && (
            <p className="text-sm text-slate-400 mt-1">Son araştırma: {detail.lastRun}</p>
          )}
        </div>

        {/* Butonlar */}
        <div className="flex gap-2 shrink-0">
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

      {/* Belgeler + Raporlar */}
      {detail && (
        <div className="grid sm:grid-cols-2 gap-4">

          {/* Belgeler */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Belgeler</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { key: "profil",     label: "Profil (.docx)" },
                { key: "transkript", label: "Transkript (.pdf)" },
                { key: "dilBelgesi", label: "Dil Belgesi (.pdf)" },
                { key: "motivasyon", label: "Motivasyon (.docx)" },
                { key: "cv",         label: "CV (.pdf)" },
              ].map(({ key, label }) => (
                <div key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md ${
                  detail.documents[key as keyof typeof detail.documents]
                    ? "bg-green-50 text-green-700"
                    : "bg-slate-50 text-slate-400"
                }`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    detail.documents[key as keyof typeof detail.documents] ? "bg-green-500" : "bg-slate-300"
                  }`} />
                  {label}
                </div>
              ))}
            </div>
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

      {/* Log çıktısı */}
      {(running || log) && (
        <div className="bg-slate-900 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
            <p className="text-xs font-medium text-slate-400">
              {running ? "⚡ Ajan çalışıyor..." : "✅ Tamamlandı"}
            </p>
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
            {(["uygun", "sartli", "uygun_degil", "veri_yok"] as const).map((key) =>
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
                  <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs">Uygunluk</th>
                  <th className="px-4 py-3 text-xs"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p, i) => {
                  const cfg = ELIGIBILITY_CONFIG[p.eligibility as keyof typeof ELIGIBILITY_CONFIG]
                    ?? ELIGIBILITY_CONFIG.veri_yok;
                  return (
                    <tr key={i} className={`${cfg.row} hover:opacity-90 transition-opacity`}>
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-[160px] truncate">
                        {p.university || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell max-w-[200px] truncate">
                        {p.program || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs hidden sm:table-cell">
                        {p.city || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-blue-600 transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </td>
                    </tr>
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
