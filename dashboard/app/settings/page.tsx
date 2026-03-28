"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, Database, Users, Key, ExternalLink, Mail, Play, RefreshCw } from "lucide-react";

interface ApiKeyInfo {
  label: string;
  status: "ok" | "missing";
  masked: string;
  docs: string;
}

interface Settings {
  api_keys: Record<string, ApiKeyInfo>;
  db: { exists: boolean; size_mb: number; program_count: number };
  students: number;
  env_file_exists: boolean;
  agent_dir: string;
}

interface EmailStatus {
  configured: boolean;
  host: string;
  user: string;
  pass: string;
  to: string;
  recipients: string[];
}

interface BatchStatus {
  pending: number;
  queue: string[];
}

export default function SettingsPage() {
  const [settings,    setSettings]    = useState<Settings | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);
  const [emailMsg,    setEmailMsg]    = useState<{ ok: boolean; text: string } | null>(null);
  const [runningAll,  setRunningAll]  = useState(false);
  const [batchLog,    setBatchLog]    = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { setSettings(d); setLoading(false); })
      .catch(() => setLoading(false));

    fetch("/api/notify")
      .then((r) => r.json())
      .then((d) => setEmailStatus(d))
      .catch(() => {});

    fetch("/api/students/run-all")
      .then((r) => r.json())
      .then((d) => setBatchStatus(d))
      .catch(() => {});
  }, []);

  async function sendEmail(test: boolean) {
    const setter = test ? setSendingTest : setSendingDigest;
    setter(true);
    setEmailMsg(null);
    try {
      const res  = await fetch(`/api/notify${test ? "?test=1" : ""}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setEmailMsg({ ok: true, text: test ? "Test emaili gönderildi!" : `${data.deadlineCount} deadline digest gönderildi.` });
      } else {
        setEmailMsg({ ok: false, text: data.error ?? "Hata" });
      }
    } catch { setEmailMsg({ ok: false, text: "Bağlantı hatası" }); }
    setter(false);
  }

  async function runAll() {
    setRunningAll(true);
    setBatchLog([]);
    try {
      const res = await fetch("/api/students/run-all?mode=stale", { method: "POST" });
      if (!res.body) { setRunningAll(false); return; }
      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === "student_start") setBatchLog((p) => [...p, `▶ ${evt.name} başlatıldı (${evt.index}/${evt.total})`]);
            if (evt.type === "student_done")  setBatchLog((p) => [...p, `${evt.success ? "✅" : "❌"} ${evt.name} tamamlandı`]);
            if (evt.type === "done")          setBatchLog((p) => [...p, `🎉 Toplu çalışma tamamlandı — ${evt.total} öğrenci`]);
          } catch { /* ignore */ }
        }
      }
    } catch { setBatchLog((p) => [...p, "Bağlantı hatası"]); }
    setRunningAll(false);
    // Batch durumunu yenile
    fetch("/api/students/run-all").then((r) => r.json()).then((d) => setBatchStatus(d)).catch(() => {});
  }

  if (loading) return (
    <div className="text-center py-20 text-slate-400">
      <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
      Yükleniyor...
    </div>
  );

  if (!settings) return (
    <div className="text-center py-20 text-slate-500">Ayarlar yüklenemedi.</div>
  );

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600">
        <ArrowLeft className="w-4 h-4" /> Öğrenci Listesine Dön
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-800">Sistem Durumu</h1>
        <p className="text-sm text-slate-400 mt-1">API anahtarları ve veritabanı bilgileri</p>
      </div>

      {/* Genel istatistikler */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-slate-500">Öğrenci Sayısı</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{settings.students}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Database className="w-4 h-4 text-purple-500" />
            <span className="text-xs font-medium text-slate-500">Kayıtlı Program</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{settings.db.program_count.toLocaleString("tr-TR")}</p>
          {settings.db.exists && (
            <p className="text-xs text-slate-400 mt-0.5">{settings.db.size_mb} MB</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-slate-500">API Anahtarı</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {Object.values(settings.api_keys).filter((k) => k.status === "ok").length}
            <span className="text-base font-normal text-slate-400">/{Object.keys(settings.api_keys).length}</span>
          </p>
          <p className="text-xs text-slate-400 mt-0.5">aktif</p>
        </div>
      </div>

      {/* API Anahtarları */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Key className="w-4 h-4 text-slate-400" />
          API Anahtarları
        </h2>
        <div className="space-y-3">
          {Object.entries(settings.api_keys).map(([key, info]) => (
            <div key={key} className={`flex items-center justify-between rounded-lg px-4 py-3 ${
              info.status === "ok" ? "bg-green-50 border border-green-100" : "bg-red-50 border border-red-100"
            }`}>
              <div className="flex items-center gap-3">
                {info.status === "ok"
                  ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                }
                <div>
                  <p className="text-sm font-medium text-slate-700">{info.label}</p>
                  <p className="text-xs text-slate-400 font-mono">{info.masked}</p>
                </div>
              </div>
              {info.status === "missing" && (
                <a
                  href={`https://${info.docs}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0"
                >
                  Kayıt Ol <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
        </div>

        {!settings.env_file_exists && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            <strong>.env dosyası bulunamadı.</strong>{" "}
            <code className="bg-amber-100 px-1 rounded">{settings.agent_dir}/.env</code>{" "}
            konumunda oluşturun ve API anahtarlarını girin.
          </div>
        )}

        <div className="mt-4 p-3 bg-slate-50 rounded-lg text-xs text-slate-500">
          <strong>API anahtarlarını düzenlemek için:</strong>
          <pre className="mt-1 font-mono text-slate-600 whitespace-pre-wrap">
{`# Terminal'de:
nano ${settings.agent_dir}/.env

# Gerekli değişkenler:
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...
SCRAPER_API_KEY=...`}
          </pre>
        </div>
      </div>

      {/* Veritabanı */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-400" />
          Program Veritabanı
        </h2>
        {settings.db.exists ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Durum</span>
              <span className="flex items-center gap-1 text-green-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Aktif
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Kayıtlı program sayısı</span>
              <span className="font-medium">{settings.db.program_count.toLocaleString("tr-TR")}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Dosya boyutu</span>
              <span className="font-medium">{settings.db.size_mb} MB</span>
            </div>
            <div className="pt-2">
              <Link href="/programs" className="text-xs text-blue-600 hover:underline">
                Veritabanını görüntüle →
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            Veritabanı henüz oluşturulmadı. İlk araştırma çalışmasından sonra otomatik oluşturulacak.
          </p>
        )}
      </div>

      {/* Toplu Çalıştırma */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Play className="w-4 h-4 text-slate-400" />
          Toplu Araştırma
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          7+ gündür güncellenmemiş öğrenciler için araştırmayı otomatik başlatır.
          {batchStatus && batchStatus.pending > 0 && (
            <span className="ml-1 font-medium text-amber-600">
              {batchStatus.pending} öğrenci bekliyor.
            </span>
          )}
          {batchStatus && batchStatus.pending === 0 && (
            <span className="ml-1 text-green-600 font-medium">Tüm öğrenciler güncel.</span>
          )}
        </p>

        {batchStatus && batchStatus.queue.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {batchStatus.queue.map((name) => (
              <span key={name} className="text-xs px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-full">
                {name.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={runAll}
            disabled={runningAll || (batchStatus?.pending === 0)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: "var(--aes-navy)" }}
          >
            {runningAll
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Çalışıyor...</>
              : <><Play className="w-4 h-4" /> Toplu Çalıştır</>}
          </button>
          {batchStatus && batchStatus.pending === 0 && !runningAll && (
            <span className="text-xs text-slate-400">Bekleyen öğrenci yok</span>
          )}
        </div>

        {batchLog.length > 0 && (
          <div className="mt-4 bg-slate-900 rounded-lg p-3 max-h-48 overflow-y-auto">
            {batchLog.map((line, i) => (
              <p key={i} className="text-xs font-mono text-slate-300 leading-relaxed">{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Email Bildirimleri */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Mail className="w-4 h-4 text-slate-400" />
          Email Bildirimleri
        </h2>

        {emailStatus && (
          <div className="space-y-3 mb-4">
            {[
              { label: "SMTP Sunucu", val: emailStatus.host },
              { label: "Kullanıcı",  val: emailStatus.user },
              { label: "Şifre",      val: emailStatus.pass },
              { label: "Alıcı(lar)", val: emailStatus.to },
            ].map(({ label, val }) => (
              <div key={label} className={`flex items-center justify-between rounded-lg px-4 py-2.5 border text-sm ${
                val === "✓ set"
                  ? "bg-green-50 border-green-100"
                  : "bg-red-50 border-red-100"
              }`}>
                <span className="text-slate-600">{label}</span>
                <span className={`flex items-center gap-1.5 font-medium text-xs ${
                  val === "✓ set" ? "text-green-600" : "text-red-500"
                }`}>
                  {val === "✓ set"
                    ? <><CheckCircle2 className="w-3.5 h-3.5" /> Ayarlı</>
                    : <><XCircle className="w-3.5 h-3.5" /> Eksik</>}
                </span>
              </div>
            ))}
          </div>
        )}

        {emailStatus?.configured ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => sendEmail(true)}
                disabled={sendingTest}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {sendingTest ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Test Emaili Gönder
              </button>
              <button
                onClick={() => sendEmail(false)}
                disabled={sendingDigest}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-white disabled:opacity-50"
                style={{ background: "var(--aes-navy)" }}
              >
                {sendingDigest ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Deadline Digest Gönder
              </button>
            </div>
            {emailStatus.recipients.length > 0 && (
              <p className="text-xs text-slate-400">
                Alıcılar: {emailStatus.recipients.join(", ")}
              </p>
            )}
          </div>
        ) : (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            <strong>Email konfigürasyonu eksik.</strong> .env dosyasına şunları ekleyin:
            <pre className="mt-2 font-mono text-amber-800 whitespace-pre-wrap">{`NOTIFY_EMAIL_HOST=smtp.gmail.com
NOTIFY_EMAIL_PORT=587
NOTIFY_EMAIL_USER=kullanici@gmail.com
NOTIFY_EMAIL_PASS=uygulama-sifresi
NOTIFY_EMAIL_TO=alici@example.com`}</pre>
            <p className="mt-2 text-amber-600">
              Gmail için{" "}
              <a href="https://support.google.com/accounts/answer/185833"
                 target="_blank" rel="noopener noreferrer"
                 className="underline">Uygulama Şifresi</a>{" "}
              oluşturmanız gerekir.
            </p>
          </div>
        )}

        {emailMsg && (
          <div className={`mt-3 p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            emailMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
          }`}>
            {emailMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
            {emailMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}
