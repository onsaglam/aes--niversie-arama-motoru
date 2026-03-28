"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, ChevronRight, Clock, Bell, ExternalLink } from "lucide-react";

interface DeadlineItem {
  studentName: string;
  university: string;
  program: string;
  city: string;
  deadlineType: "WiSe" | "SoSe";
  deadlineRaw: string;
  deadlineParsed: string | null;
  daysLeft: number;
  eligibility: string;
  url: string | null;
}

interface MonthGroup {
  label: string;       // "Nisan 2025"
  isoMonth: string;    // "2025-04"
  items: DeadlineItem[];
}

const MONTHS_TR = [
  "Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
  "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık",
];

function urgencyClass(days: number) {
  if (days <= 0)  return "bg-red-100 text-red-700 border-red-200";
  if (days <= 7)  return "bg-red-100 text-red-700 border-red-200";
  if (days <= 14) return "bg-orange-100 text-orange-700 border-orange-200";
  if (days <= 30) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-blue-50 text-blue-700 border-blue-100";
}

function urgencyBadge(days: number) {
  if (days <= 0)  return { label: "Bugün!", cls: "bg-red-500 text-white" };
  if (days <= 3)  return { label: `${days}g`, cls: "bg-red-500 text-white" };
  if (days <= 7)  return { label: `${days}g`, cls: "bg-red-100 text-red-700" };
  if (days <= 14) return { label: `${days}g`, cls: "bg-orange-100 text-orange-700" };
  if (days <= 30) return { label: `${days}g`, cls: "bg-amber-100 text-amber-700" };
  return { label: `${days}g`, cls: "bg-slate-100 text-slate-600" };
}

function groupByMonth(items: DeadlineItem[]): MonthGroup[] {
  const map = new Map<string, DeadlineItem[]>();
  for (const item of items) {
    const key = item.deadlineParsed?.slice(0, 7) ?? "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, its]) => {
      let label = key;
      if (key !== "unknown") {
        const [y, m] = key.split("-").map(Number);
        label = `${MONTHS_TR[m - 1]} ${y}`;
      }
      return { label, isoMonth: key, items: its };
    });
}

export default function TimelinePage() {
  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "uygun" | "sartli">("all");
  const [studentFilter, setStudentFilter] = useState("");

  useEffect(() => {
    fetch("/api/deadlines")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setDeadlines(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const students = [...new Set(deadlines.map((d) => d.studentName))].sort();

  const filtered = deadlines.filter((d) => {
    if (filter !== "all" && d.eligibility !== filter) return false;
    if (studentFilter && d.studentName !== studentFilter) return false;
    return true;
  });

  const groups = groupByMonth(filtered);

  const urgent = filtered.filter((d) => d.daysLeft <= 14);

  if (loading) return (
    <div className="text-center py-20 text-slate-400">
      <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
      Yükleniyor...
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Başvuru Takvimi</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {deadlines.length} yaklaşan deadline · {students.length} öğrenci
            </p>
          </div>
        </div>
        <Link href="/" className="text-sm text-slate-500 hover:text-blue-600">← Öğrenciler</Link>
      </div>

      {/* Acil uyarı */}
      {urgent.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-4 h-4 text-red-500" />
            <span className="text-sm font-semibold text-red-700">
              {urgent.length} acil deadline — 14 gün içinde!
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {urgent.map((d, i) => (
              <Link
                key={i}
                href={`/students/${encodeURIComponent(d.studentName)}`}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
              >
                <span className="font-bold">{d.daysLeft <= 0 ? "Bugün!" : `${d.daysLeft}g`}</span>
                {d.studentName.replace(/_/g, " ")} · {d.university}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Filtreler */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
          {(["all", "uygun", "sartli"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f === "all" ? "Tümü" : f === "uygun" ? "✅ Uygun" : "⚠️ Şartlı"}
            </button>
          ))}
        </div>

        {students.length > 1 && (
          <select
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Tüm öğrenciler</option>
            {students.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        )}

        <span className="text-xs text-slate-400 ml-auto">{filtered.length} sonuç</span>
      </div>

      {/* Boş durum */}
      {groups.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Yaklaşan deadline bulunamadı</p>
          <p className="text-sm mt-1">
            Araştırma tamamlandıktan sonra deadline bilgileri burada görünür.
          </p>
        </div>
      )}

      {/* Aylara göre zaman çizelgesi */}
      <div className="relative">
        {/* Sol çizgi */}
        <div className="absolute left-[88px] top-0 bottom-0 w-px bg-slate-200 hidden sm:block" />

        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.isoMonth} className="relative">

              {/* Ay etiketi */}
              <div className="flex items-center gap-4 mb-3">
                <div className="sm:w-[88px] sm:text-right shrink-0">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {group.label}
                  </span>
                </div>
                {/* Zaman çizelgesi noktası */}
                <div className="hidden sm:flex w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow shrink-0 -ml-1.5 z-10" />
                <div className="text-xs text-slate-400 sm:hidden">{group.items.length} deadline</div>
              </div>

              {/* Deadline kartları */}
              <div className="sm:ml-[104px] space-y-2">
                {group.items.map((d, i) => {
                  const badge = urgencyBadge(d.daysLeft);
                  const cardCls = urgencyClass(d.daysLeft);
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${cardCls}`}
                    >
                      {/* Gün sayacı */}
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>
                        {badge.label}
                      </span>

                      {/* Tarih */}
                      <span className="text-xs text-slate-500 shrink-0 hidden md:block w-16">
                        {d.deadlineRaw}
                      </span>

                      {/* Program bilgisi */}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-800 truncate">
                          {d.university}
                          {d.city && <span className="font-normal text-slate-500 ml-1">· {d.city}</span>}
                        </p>
                        <p className="text-xs text-slate-600 truncate">{d.program}</p>
                      </div>

                      {/* Tür + öğrenci */}
                      <div className="shrink-0 text-right hidden sm:block">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          d.deadlineType === "WiSe"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-teal-100 text-teal-700"
                        }`}>
                          {d.deadlineType}
                        </span>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {d.studentName.replace(/_/g, " ")}
                        </p>
                      </div>

                      {/* Uygunluk */}
                      <span className={`text-xs font-medium shrink-0 hidden lg:block ${
                        d.eligibility === "uygun" ? "text-green-600" : "text-amber-600"
                      }`}>
                        {d.eligibility === "uygun" ? "✅ Uygun" : "⚠️ Şartlı"}
                      </span>

                      {/* Links */}
                      <div className="flex items-center gap-1 shrink-0">
                        {d.url && (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-blue-600 transition-colors"
                            title="Üniversite başvuru sayfasını aç"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <Link
                          href={`/students/${encodeURIComponent(d.studentName)}`}
                          className="text-blue-600 hover:text-blue-800 transition-colors"
                          title="Öğrenci detayına git"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
