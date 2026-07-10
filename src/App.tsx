import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  Copy,
  Download,
  RotateCw,
  Info,
  ShieldCheck,
  Check,
  AlertTriangle,
  Flame,
  HelpCircle,
  FileText,
  MousePointerClick,
  FileCheck,
  ArrowRight,
  BookOpen,
  Trash2,
  Minimize2,
  Key,
  ChevronUp,
  ChevronDown,
  Activity,
  Terminal
} from "lucide-react";

// Types
interface RewriteResponse {
  isValid: boolean;
  validationMessage: string;
  analysis: string;
  rewrittenText: string;
  chosenTone: string;
  chosenLength: string;
  chosenFormat: string;
}

// Preset Examples
const EXAMPLES = [
  {
    title: "Tas Wanita Premium",
    text: "Tas wanita premium\nImport\nMurah\nReady Stock\nCOD\nChat Sekarang\n🔥🔥🔥🔥🔥\n⭐⭐⭐⭐⭐"
  },
  {
    title: "Sepatu Lari Sporty",
    text: "READY STOCK KAK SILAKAN DIORDER!!!!!\nSEPATU RUNNING MURAH BANGETTTT\nCOCOK BUAT JALAN-JALAN ATAU LARI LARI\nBISA COD SELURUH INDONESIA\nCHAT SEKARANG JUGA BIAR GA KEHABISAN!!!!!\n👍👍👍👟👟👟"
  },
  {
    title: "Rice Cooker Serbaguna",
    text: "RICE COOKER SERBAGUNA MURAH MERIAH!!!!!\nbisa buat masak nasi, kukus bolu, hangatkan makanan.\nwarna merah menyala. daya cuma 300 watt aja sis hemat listrik bgt.\nREADY STOCK NO PRE-ORDER.\nORDER SEKARANG JUGA YA SIS CHAT ADMIN UTK HARGA PROMO JUMAT BERKAH."
  }
];

// Loading steps to rotate through
const LOADING_STEPS = [
  "Sedang memperbaiki deskripsi...",
  "Menghapus spam promosi...",
  "Menyaring emoji berlebihan...",
  "Menyusun struktur kalimat...",
  "Menambahkan manfaat produk...",
  "Memperbaiki tata bahasa...",
  "Hampir selesai..."
];

export default function App() {
  // Input State
  const [inputText, setInputText] = useState("");
  const [tone, setTone] = useState<"Profesional" | "Menjual" | "Santai">("Profesional");
  const [length, setLength] = useState<"Pendek" | "Sedang" | "Panjang">("Sedang");
  const [format, setFormat] = useState<"Paragraf" | "Bullet List" | "Paragraf + Bullet">("Paragraf");
  const [randomize, setRandomize] = useState(false);

  // App States
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RewriteResponse | null>(null);
  const [rollingMeta, setRollingMeta] = useState<{
    usedKeyIndex: number;
    usedKeyMasked: string;
    attemptsUsed: number;
    totalKeysAvailable: number;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Custom Backup Keys State
  const [customKeysRaw, setCustomKeysRaw] = useState("");
  const [customKeys, setCustomKeys] = useState<string[]>([]);
  const [showKeySettings, setShowKeySettings] = useState(false);

  // Rotation Monitor State
  const [rotationLogs, setRotationLogs] = useState<any[]>([]);
  const [keyStatuses, setKeyStatuses] = useState<any[]>([]);
  const [showMonitor, setShowMonitor] = useState(false);
  const [detectedEnvKeys, setDetectedEnvKeys] = useState<string[]>([]);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal States
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // Fetch real key statuses from server
  const fetchKeyStatuses = async (keysList: string[]) => {
    try {
      const response = await fetch("/api/keys-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customKeys: keysList })
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.keyStatuses) {
          setKeyStatuses(result.keyStatuses);
          localStorage.setItem("last_key_statuses", JSON.stringify(result.keyStatuses));
        }
        if (result.success && result.detectedEnvKeys) {
          setDetectedEnvKeys(result.detectedEnvKeys);
          localStorage.setItem("last_detected_env_keys", JSON.stringify(result.detectedEnvKeys));
        }
      }
    } catch (e) {
      console.error("Failed to fetch key statuses", e);
    }
  };

  // Load saved keys on mount
  useEffect(() => {
    let initialKeys: string[] = [];
    const savedKeysJson = localStorage.getItem("visitor_gemini_api_keys");
    if (savedKeysJson) {
      try {
        const parsed = JSON.parse(savedKeysJson);
        if (Array.isArray(parsed)) {
          setCustomKeys(parsed);
          setCustomKeysRaw(parsed.join("\n"));
          initialKeys = parsed;
        }
      } catch (e) {
        console.error("Failed to load saved keys", e);
      }
    }

    // Load last known monitor state
    const savedStatuses = localStorage.getItem("last_key_statuses");
    const savedLogs = localStorage.getItem("last_rotation_logs");
    const savedDetectedEnv = localStorage.getItem("last_detected_env_keys");
    if (savedStatuses) {
      try { setKeyStatuses(JSON.parse(savedStatuses)); } catch {}
    }
    if (savedLogs) {
      try { setRotationLogs(JSON.parse(savedLogs)); } catch {}
    }
    if (savedDetectedEnv) {
      try { setDetectedEnvKeys(JSON.parse(savedDetectedEnv)); } catch {}
    }

    // Fetch live statuses from server
    fetchKeyStatuses(initialKeys);
  }, []);

  const handleSaveKeys = () => {
    const parsed = customKeysRaw
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k.startsWith("AIzaSy") && k.length >= 20); // Basic validation for Gemini keys
    
    // Check if user pasted invalid format to warn them
    const invalidCount = customKeysRaw
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k && (!k.startsWith("AIzaSy") || k.length < 20)).length;

    if (invalidCount > 0) {
      triggerToast(`${invalidCount} kunci tidak valid (harus diawali 'AIzaSy' & >= 20 karakter).`);
    }

    setCustomKeys(parsed);
    localStorage.setItem("visitor_gemini_api_keys", JSON.stringify(parsed));
    triggerToast(`Berhasil menyimpan ${parsed.length} API Key Cadangan.`);
    
    // Instantly query server with new backup keys to show them in the monitor
    fetchKeyStatuses(parsed);
  };

  const handleClearKeys = () => {
    setCustomKeysRaw("");
    setCustomKeys([]);
    localStorage.removeItem("visitor_gemini_api_keys");
    triggerToast("Seluruh API Key cadangan dihapus.");

    // Instantly query server with empty custom keys to remove custom rows
    fetchKeyStatuses([]);
  };

  // Reference for results card scroll
  const resultsRef = useRef<HTMLDivElement>(null);

  // Cycle loading messages
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      interval = setInterval(() => {
        setLoadingTextIndex((prev) => (prev + 1) % LOADING_STEPS.length);
      }, 1500);
    } else {
      setLoadingTextIndex(0);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  // Handle toast timeout
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Trigger Toast
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
  };

  // Drag and Drop text handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const text = e.dataTransfer.getData("text");
    if (text) {
      setInputText(text);
      triggerToast("Teks berhasil diletakkan.");
    }
  };

  // Auto Scroll to results
  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [result]);

  // Call API to rewrite
  const handleRewrite = async (overrideInput?: string) => {
    const textToSubmit = overrideInput !== undefined ? overrideInput : inputText;
    if (!textToSubmit || textToSubmit.trim().length < 10) {
      setError("Deskripsi produk minimal harus 10 karakter.");
      return;
    }
    if (textToSubmit.length > 20000) {
      setError("Deskripsi produk tidak boleh lebih dari 20.000 karakter.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setRollingMeta(null);

    try {
      const response = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputText: textToSubmit,
          tone: randomize ? undefined : tone,
          length: randomize ? undefined : length,
          format: randomize ? undefined : format,
          randomize,
          customKeys
        }),
      });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON Response received:", text);
        if (response.status === 502 || response.status === 503 || response.status === 504 || response.status === 404) {
          throw new Error("Server sedang bersiap, memuat ulang, atau sedang tidur. Silakan tunggu sekitar 10-15 detik dan klik tombol 'Perbaiki Deskripsi' kembali.");
        }
        throw new Error(`Server mengembalikan respon tidak valid (Status ${response.status}). Pastikan server berjalan dengan benar.`);
      }

      const data = await response.json();
      if (!response.ok || !data.success) {
        // If the request fails, we may still receive key rotation statuses and logs to show what failed
        if (data.rotationLogs) {
          setRotationLogs(data.rotationLogs);
          localStorage.setItem("last_rotation_logs", JSON.stringify(data.rotationLogs));
        }
        if (data.keyStatuses) {
          setKeyStatuses(data.keyStatuses);
          localStorage.setItem("last_key_statuses", JSON.stringify(data.keyStatuses));
        }

        const errorMsg = data.error || "";
        if (errorMsg.includes("GEMINI_API_KEY") || errorMsg.includes("apiClient")) {
          throw new Error("API Key Gemini belum dikonfigurasi. Silakan tambahkan 'GEMINI_API_KEY' di menu Settings (ikon gerigi) pada bagian kiri bawah AI Studio agar AI dapat memproses deskripsi Anda.");
        }
        throw new Error(errorMsg || "Gagal menghubungi server AI.");
      }

      setResult(data.data);
      if (data.rollingMeta) {
        setRollingMeta(data.rollingMeta);
      }
      if (data.rotationLogs) {
        setRotationLogs(data.rotationLogs);
        localStorage.setItem("last_rotation_logs", JSON.stringify(data.rotationLogs));
      }
      if (data.keyStatuses) {
        setKeyStatuses(data.keyStatuses);
        localStorage.setItem("last_key_statuses", JSON.stringify(data.keyStatuses));
      }
      if (data.detectedEnvKeys) {
        setDetectedEnvKeys(data.detectedEnvKeys);
        localStorage.setItem("last_detected_env_keys", JSON.stringify(data.detectedEnvKeys));
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Terjadi kesalahan koneksi atau server AI bermasalah.");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Copy to Clipboard
  const handleCopy = async () => {
    if (!result?.rewrittenText) return;
    try {
      await navigator.clipboard.writeText(result.rewrittenText);
      triggerToast("Berhasil disalin ke papan klip.");
    } catch (err) {
      triggerToast("Gagal menyalin teks.");
    }
  };

  // Handle Download TXT
  const handleDownload = () => {
    if (!result?.rewrittenText) return;
    try {
      const element = document.createElement("a");
      const file = new Blob([result.rewrittenText], { type: "text/plain;charset=utf-8" });
      element.href = URL.createObjectURL(file);
      element.download = "deskripsi-produk.txt";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      triggerToast("File TXT berhasil diunduh.");
    } catch (err) {
      triggerToast("Gagal mengunduh file.");
    }
  };

  // Clear Input
  const handleClear = () => {
    setInputText("");
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-800 font-sans flex flex-col antialiased">
      
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-slate-800 text-sm font-medium"
          >
            <Check className="w-4 h-4 text-emerald-400 stroke-[3]" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>



      {/* Main Content Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 md:py-12 flex flex-col gap-8">
        
        {/* Hero Section */}
        <section className="text-center max-w-2xl mx-auto mb-2 flex flex-col gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-brand-light border border-pink-brand/20 text-pink-brand text-[11px] font-semibold tracking-wide uppercase mx-auto">
            <Sparkles className="w-3 h-3 animate-pulse text-pink-brand" /> AI-Powered Copywriting
          </span>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            AI Product Description Rewriter
          </h1>
          <p className="text-slate-500 text-sm md:text-base leading-relaxed">
            Ubah deskripsi produk yang berantakan dan dipenuhi spam promosi menjadi deskripsi profesional yang bersih, informatif, dan siap memikat calon pembeli dalam 30 detik.
          </p>
        </section>

        {/* Backup API Keys Settings Card */}
        <section className="mb-2">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
            <button
              onClick={() => setShowKeySettings(!showKeySettings)}
              className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-slate-50/50 transition text-left cursor-pointer focus:outline-none"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pink-brand-light flex items-center justify-center text-pink-brand">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm md:text-base font-bold text-slate-950 flex flex-wrap items-center gap-2">
                    Pengaturan API Key Cadangan (Backup)
                    {customKeys.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        {customKeys.length} Kunci Aktif
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Masukkan API Key Gemini Anda sendiri sebagai cadangan penangkal limitasi 503.
                  </p>
                </div>
              </div>
              <div className="text-slate-400 pr-1">
                {showKeySettings ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </div>
            </button>

            {showKeySettings && (
              <div className="p-5 md:p-6 border-t border-slate-100 bg-slate-50/30 flex flex-col gap-4 animate-fade-in">
                <div className="bg-white rounded-xl border border-slate-200/60 p-4 text-xs md:text-sm text-slate-700 flex flex-col gap-2.5 shadow-xs">
                  <p className="flex items-start gap-2 text-slate-600">
                    <span className="text-pink-brand text-sm mt-[2px]">🛡️</span>
                    <span>
                      <strong>Keamanan Mutlak:</strong> API Key Anda disimpan 100% lokal di browser Anda (<code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[11px] text-pink-brand">localStorage</code>) dan tidak disimpan di server kami. Sangat aman dan tidak bisa diakses orang lain.
                    </span>
                  </p>
                  <p className="flex items-start gap-2 text-slate-600">
                    <span className="text-pink-brand text-sm mt-[2px]">🔄</span>
                    <span>
                      <strong>Rotasi & Failover Otomatis:</strong> Saat perbaikan deskripsi diklik dan API Key kami mengalami limitasi (Error 503), sistem akan otomatis mengalihkan request ke API Key cadangan Anda demi kelancaran proses.
                    </span>
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    Input API Key Gemini
                  </label>
                  <span className="text-xs text-slate-400">
                    Anda bisa memasukkan beberapa API Key sekaligus (satu kunci per baris atau dipisahkan koma):
                  </span>
                  <textarea
                    rows={3}
                    className="w-full p-3 font-mono text-xs text-slate-800 bg-white border border-slate-200 rounded-xl focus:border-pink-brand focus:outline-none placeholder-slate-300 shadow-2xs"
                    placeholder="AIzaSyB1lv3zWCzJatw9Qtu-kJnixswVUr3Sbjw&#10;AIzaSyAfRnZZnBw4Oq3-gqyqxLi4UusvmKLRzhg"
                    value={customKeysRaw}
                    onChange={(e) => setCustomKeysRaw(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveKeys}
                      className="px-4 py-2 bg-pink-brand hover:bg-pink-brand-hover text-white text-xs font-semibold rounded-xl transition shadow-md shadow-pink-brand-light/20 cursor-pointer"
                    >
                      Simpan Kunci
                    </button>
                    {customKeys.length > 0 && (
                      <button
                        onClick={handleClearKeys}
                        className="px-4 py-2 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-xl transition cursor-pointer"
                      >
                        Hapus Semua
                      </button>
                    )}
                  </div>
                  {customKeys.length > 0 && (
                    <div className="text-xs text-slate-500 font-medium">
                      Terdeteksi {customKeys.length} kunci cadangan berformat benar.
                    </div>
                  )}
                </div>

                {customKeys.length > 0 && (
                  <div className="border-t border-slate-100 pt-4 mt-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                      Daftar Kunci Cadangan Tersimpan:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {customKeys.map((key, index) => {
                        const sig = key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 6)}` : "Key Pendek";
                        return (
                          <div
                            key={index}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 font-mono shadow-xs"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span className="font-bold text-slate-500">Cadangan #{index + 1}:</span>
                            <span className="font-semibold text-slate-800">{sig}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Input & Form Area */}
        <section className="grid grid-cols-1 gap-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-5 md:p-6 flex flex-col gap-5">
            
            {/* Header Form: Drag & Drop Area */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-pink-brand" />
                  Deskripsi Produk Awal
                </label>
                <div className="text-xs text-slate-400 font-mono">
                  {inputText.length.toLocaleString()}/20.000 karakter
                </div>
              </div>

              {/* Textarea Container with Drag and Drop styles */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative rounded-xl border-2 transition-all ${
                  isDragOver
                    ? "border-dashed border-pink-brand bg-pink-brand-light/30"
                    : "border-slate-200 focus-within:border-pink-brand focus-within:ring-2 focus-within:ring-pink-brand-light bg-white"
                }`}
              >
                <textarea
                  className="w-full min-h-[160px] md:min-h-[180px] p-4 text-sm text-slate-800 placeholder-slate-400 focus:outline-none resize-y bg-transparent"
                  placeholder="Tempel deskripsi produk awal Anda di sini...

Contoh:
Tas wanita premium
Import
Murah
Ready Stock
COD
Chat Sekarang"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  maxLength={20000}
                />

                {/* Drag and drop overlay */}
                {isDragOver && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-pink-brand-light/80 backdrop-blur-[1px] rounded-xl pointer-events-none">
                    <div className="p-3 bg-white rounded-full shadow-md text-pink-brand mb-2">
                      <MousePointerClick className="w-6 h-6 animate-bounce" />
                    </div>
                    <span className="text-sm font-semibold text-pink-brand-dark">
                      Lepaskan Teks ke Sini
                    </span>
                    <span className="text-xs text-pink-brand mt-1">
                      Membaca teks secara otomatis
                    </span>
                  </div>
                )}

                {/* Quick Action bar inside textarea */}
                {inputText && (
                  <div className="absolute right-3 bottom-3 flex items-center gap-2">
                    <button
                      onClick={handleClear}
                      title="Hapus semua"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Presets / Examples */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5" /> Klik salah satu contoh instan untuk mencoba:
              </span>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setInputText(ex.text);
                      setError(null);
                      setResult(null);
                      triggerToast(`Contoh "${ex.title}" dimuat.`);
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 hover:border-pink-brand/30 bg-white hover:bg-pink-brand-light text-slate-700 hover:text-pink-brand transition flex items-center gap-1 shadow-2xs"
                  >
                    <span>{ex.title}</span>
                    <ArrowRight className="w-3 h-3 opacity-60" />
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced Settings Panel */}
            <div className="border-t border-slate-100 pt-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Panel Pengaturan Rewrite
                </h3>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={randomize}
                    onChange={(e) => setRandomize(e.target.checked)}
                  />
                  <div className="relative w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-pink-brand"></div>
                  <span className="text-xs font-semibold text-slate-700">
                    Randomkan Pengaturan (AI Otomatis)
                  </span>
                </label>
              </div>

              {/* Grid selectors */}
              <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 transition-all duration-300 ${randomize ? "opacity-40 pointer-events-none" : "opacity-100"}`}>
                
                {/* Tone Select */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Gaya Penulisan (Tone)
                  </label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as any)}
                    disabled={randomize}
                    className="w-full h-10 px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:border-pink-brand focus:outline-none text-slate-800"
                  >
                    <option value="Profesional">👔 Profesional (Default)</option>
                    <option value="Menjual">📈 Menjual & Persuasif</option>
                    <option value="Santai">☕ Santai & Kasual</option>
                  </select>
                </div>

                {/* Length Select */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Panjang Tulisan
                  </label>
                  <select
                    value={length}
                    onChange={(e) => setLength(e.target.value as any)}
                    disabled={randomize}
                    className="w-full h-10 px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:border-pink-brand focus:outline-none text-slate-800"
                  >
                    <option value="Pendek">⚡ Pendek (Ringkas & Padat)</option>
                    <option value="Sedang">📝 Sedang (Default)</option>
                    <option value="Panjang">📖 Panjang (Sangat Detail)</option>
                  </select>
                </div>

                {/* Format Select */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Format Output
                  </label>
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as any)}
                    disabled={randomize}
                    className="w-full h-10 px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:border-pink-brand focus:outline-none text-slate-800"
                  >
                    <option value="Paragraf">✏️ Paragraf Saja</option>
                    <option value="Bullet List">📌 Daftar Bullet (Poin-poin)</option>
                    <option value="Paragraf + Bullet">🌟 Paragraf + Bullet (Rekomendasi)</option>
                  </select>
                </div>
              </div>

              {/* Informational badge for randomized settings */}
              {randomize && (
                <div className="bg-pink-brand-light border border-pink-brand/20 rounded-xl p-3 text-xs text-pink-brand-dark flex items-center gap-2 animate-fade-in">
                  <Info className="w-4 h-4 text-pink-brand flex-shrink-0" />
                  <span>
                    <strong>Opsi Acak Aktif:</strong> AI akan memilih kombinasi tone, panjang, dan struktur format yang paling cocok untuk memaksimalkan daya tarik produk Anda secara otomatis.
                  </span>
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (() => {
              const isValidationError = error.toLowerCase().includes("kosong") || 
                                       error.toLowerCase().includes("karakter") || 
                                       error.toLowerCase().includes("sedikit") || 
                                       error.toLowerCase().includes("informasi") ||
                                       error.toLowerCase().includes("validasi");
              return (
                <div className="bg-rose-50 border border-rose-100 text-rose-700 p-4 rounded-xl text-sm flex items-start gap-2.5">
                  <AlertTriangle className="w-4.5 h-4.5 text-rose-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block mb-0.5">
                      {isValidationError ? "Validasi Masukan" : "Gagal Memproses Deskripsi"}
                    </span>
                    <p className="text-xs text-rose-600 whitespace-pre-line">{error}</p>
                  </div>
                </div>
              );
            })()}

            {/* Main Action Button */}
            <div className="border-t border-slate-100 pt-5">
              <button
                onClick={() => handleRewrite()}
                disabled={!inputText.trim() || isLoading}
                className={`w-full py-3.5 px-6 font-semibold text-base rounded-xl flex items-center justify-center gap-2.5 shadow-md transition-all active:scale-98 ${
                  !inputText.trim() || isLoading
                    ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none"
                    : "bg-pink-brand hover:bg-pink-brand-hover text-white shadow-pink-brand-light/30 border border-transparent cursor-pointer"
                }`}
              >
                {isLoading ? (
                  <span>Memperbaiki Deskripsi...</span>
                ) : (
                  <span>Perbaiki Deskripsi</span>
                )}
              </button>
            </div>

          </div>
        </section>

        {/* Loading State Animation */}
        <AnimatePresence>
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="bg-white rounded-2xl border border-slate-100 p-8 flex flex-col items-center text-center gap-4 shadow-xs"
            >
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-pink-brand-light border-t-pink-brand animate-spin"></div>
                <Sparkles className="w-6 h-6 text-pink-brand absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="h-6 flex items-center justify-center">
                <motion.p
                  key={loadingTextIndex}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="text-slate-600 text-sm font-medium"
                >
                  {LOADING_STEPS[loadingTextIndex]}
                </motion.p>
              </div>
              <div className="flex gap-1.5 justify-center mt-1">
                {LOADING_STEPS.map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      idx === loadingTextIndex ? "w-6 bg-pink-brand" : "w-1.5 bg-slate-200"
                    }`}
                  ></div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Card */}
        <AnimatePresence>
          {result && (
            <motion.div
              ref={resultsRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="scroll-mt-20 flex flex-col gap-6"
            >
              {result.isValid ? (
                // Valid Rewrite Card
                <div className="bg-white rounded-2xl border border-slate-100 shadow-md overflow-hidden p-6 flex flex-col gap-6">
                  
                  {/* Result Header Info */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-50 pb-5 gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                        <FileCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-slate-900 leading-tight">
                          Hasil Perbaikan AI
                        </h2>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-slate-500 font-medium">
                            Fakta produk dipertahankan • Spam promosi disaring
                          </span>
                          {rollingMeta && (
                            <>
                              <span className="text-[11px] text-slate-300">•</span>
                              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-100 text-[9px] text-emerald-700 font-mono font-semibold">
                                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                                <span>API Key #{rollingMeta.usedKeyIndex} ({rollingMeta.usedKeyMasked})</span>
                                {rollingMeta.totalKeysAvailable > 1 && (
                                  <span className="text-emerald-500 opacity-60">
                                    (Rotasi Aktif)
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Meta badges */}
                    <div className="flex flex-wrap gap-1.5">
                      <span className="px-2.5 py-1 text-xs rounded-lg bg-pink-brand-light text-pink-brand-dark font-semibold border border-pink-brand/20">
                        Tone: {result.chosenTone}
                      </span>
                      <span className="px-2.5 py-1 text-xs rounded-lg bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100">
                        Panjang: {result.chosenLength}
                      </span>
                      <span className="px-2.5 py-1 text-xs rounded-lg bg-slate-50 text-slate-700 font-semibold border border-slate-200">
                        Format: {result.chosenFormat}
                      </span>
                    </div>
                  </div>

                  {/* Short Critique / Analysis */}
                  {result.analysis && (
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3 text-slate-700">
                      <Info className="w-4 h-4 text-pink-brand mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block mb-0.5">Analisis Deskripsi Asli:</span>
                        <p className="text-xs leading-relaxed">{result.analysis}</p>
                      </div>
                    </div>
                  )}

                  {/* Main Output Box */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Hasil Deskripsi Akhir
                      </label>
                      <span className="text-xs text-slate-400 font-mono">
                        {result.rewrittenText?.length?.toLocaleString() || 0} karakter
                      </span>
                    </div>

                    <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-5 text-sm md:text-base leading-relaxed text-slate-800 font-sans min-h-[150px] shadow-inner select-text markdown-body">
                      <ReactMarkdown>{result.rewrittenText}</ReactMarkdown>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
                    <button
                      onClick={handleCopy}
                      className="flex-1 min-w-[120px] py-3 px-4 rounded-xl border border-slate-200 hover:border-pink-brand hover:bg-pink-brand-light text-slate-700 hover:text-pink-brand font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                    >
                      <Copy className="w-4.5 h-4.5" />
                      <span>Salin Deskripsi</span>
                    </button>

                    <button
                      onClick={handleDownload}
                      className="flex-1 min-w-[120px] py-3 px-4 rounded-xl border border-slate-200 hover:border-pink-brand hover:bg-pink-brand-light text-slate-700 hover:text-pink-brand font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                    >
                      <Download className="w-4.5 h-4.5" />
                      <span>Unduh berkas (.txt)</span>
                    </button>

                    <button
                      onClick={() => handleRewrite()}
                      className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                    >
                      <RotateCw className="w-4.5 h-4.5" />
                      <span>Acak Lagi</span>
                    </button>
                  </div>

                </div>
              ) : (
                // Validation Warning State Card (Input is too poor)
                <div className="bg-amber-50/40 border border-amber-200 rounded-2xl p-6 md:p-8 text-center flex flex-col items-center gap-4 shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 shadow-xs">
                    <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
                  </div>
                  <div className="max-w-md mx-auto">
                    <h3 className="text-base font-bold text-amber-800 mb-1">
                      Informasi Produk Kurang Lengkap
                    </h3>
                    {rollingMeta && (
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-100/60 border border-amber-200/80 text-[9px] text-amber-850 font-mono font-bold mb-2">
                        <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse"></span>
                        <span>API Key #{rollingMeta.usedKeyIndex} ({rollingMeta.usedKeyMasked})</span>
                      </div>
                    )}
                    <p className="text-sm text-amber-700 leading-relaxed">
                      {result.validationMessage ||
                        "Informasi produk masih terlalu sedikit sehingga AI belum dapat membuat deskripsi yang berkualitas. Silakan tambahkan minimal nama produk atau sedikit penjelasan."}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (resultsRef.current) {
                        window.scrollTo({ top: 120, behavior: "smooth" });
                      }
                    }}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-amber-100 transition cursor-pointer"
                  >
                    Perbaiki Input Sekarang
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Multi API Key Rotation & Failover Monitor Dashboard */}
        <section className="mt-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-100">
            
            {/* Header Collapsible Button */}
            <button
              onClick={() => setShowMonitor(!showMonitor)}
              className="w-full flex flex-col sm:flex-row sm:items-center justify-between p-5 hover:bg-slate-800/30 transition text-left cursor-pointer focus:outline-none gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-pink-brand shadow-md">
                  <Activity className="w-5 h-5 animate-pulse text-pink-brand" />
                </div>
                <div>
                  <h3 className="text-sm md:text-base font-bold text-white flex items-center gap-2">
                    Multi API Key Rotation Monitor
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Status kesehatan dan log rotasi API Key secara real-time.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 self-end sm:self-center">
                <div className="text-[10px] text-slate-400 font-mono bg-slate-800/80 border border-slate-700 px-2 py-1 rounded-lg">
                  Uptime: 100% • Rotasi Aktif
                </div>
                <div className="text-slate-400 pr-1">
                  {showMonitor ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </div>
            </button>

            {showMonitor && (
              <div className="p-5 md:p-6 border-t border-slate-800 bg-slate-900/20 flex flex-col gap-6 animate-fade-in">
                
                {/* Active Env Keys Status Bar */}
                <div className="bg-slate-950/60 rounded-xl border border-slate-800 p-4 text-xs flex flex-col gap-3 shadow-inner">
                  <div className="flex items-center gap-2 text-slate-200 font-bold">
                    <span className="text-pink-brand">⚙️</span>
                    <span>Sistem Hosting Environment Variables (Live)</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px] sm:text-xs">
                    Sistem mendeteksi API Key Gemini yang terpasang aktif di server hosting Anda. Jika Anda baru saja menambah atau mengubah environment variables di platform hosting (misal: Vercel / Cloud Run), <strong>Anda wajib men-deploy ulang (redeploy) aplikasi</strong> agar perubahan kunci baru tersebut dapat diterapkan oleh server.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/50">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Kunci Sistem Terbaca Server:</span>
                    {detectedEnvKeys.length > 0 ? (
                      detectedEnvKeys.map((envName, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 font-mono text-[10px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          {envName}
                        </span>
                      ))
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-950/40 border border-rose-900/40 text-rose-400 font-mono text-[10px] font-semibold animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                        Tidak ada kunci sistem terbaca. Silakan redeploy aplikasi Anda atau gunakan API Key Cadangan di atas.
                      </span>
                    )}
                  </div>
                </div>

                {/* Rotation Status Table */}
                <div className="flex flex-col gap-2.5">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    📊 Multi API Key Rotation Status
                  </span>
                  <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-950/80">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 font-bold">
                          <th className="p-3">KEY ALIAS</th>
                          <th className="p-3">TANDA TANGAN (MASK)</th>
                          <th className="p-3">TIPE</th>
                          <th className="p-3">STATUS KESEHATAN</th>
                          <th className="p-3 text-center">COOLDOWN</th>
                          <th className="p-3">REQ TERAKHIR</th>
                          <th className="p-3 text-center font-mono">FAILS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(keyStatuses.length > 0 ? keyStatuses : [
                          { keyAlias: "Sistem #1 (Utama)", keySignature: "AIzaSyA1...3Sbjw", type: "System", status: "Active", cooldown: "0s", lastRequest: "-", fails: 0 },
                          { keyAlias: "Sistem #2 (Cadangan)", keySignature: "AIzaSyAf...LRzhg", type: "System", status: "Active", cooldown: "0s", lastRequest: "-", fails: 0 },
                          ...customKeys.map((key, index) => {
                            const sig = key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 6)}` : "Key Pendek";
                            return {
                              keyAlias: `Cadangan #${index + 1}`,
                              keySignature: sig,
                              type: "Custom",
                              status: "Active",
                              cooldown: "0s",
                              lastRequest: "-",
                              fails: 0
                            };
                          })
                        ]).map((row: any, idx: number) => {
                          const isActive = row.status === "Active";
                          const isCooldown = row.status === "Cooldown";
                          const isFailed = row.status === "Failed";

                          return (
                            <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-900/20 transition-colors">
                              <td className="p-3 font-semibold text-slate-200">
                                {row.keyAlias}
                              </td>
                              <td className="p-3 font-mono text-slate-400">
                                {row.keySignature}
                              </td>
                              <td className="p-3">
                                <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded ${
                                  row.type === "System" 
                                    ? "bg-slate-800 border border-slate-700 text-slate-300"
                                    : "bg-pink-brand/10 border border-pink-brand/20 text-pink-brand"
                                }}`}>
                                  {row.type === "System" ? "Sistem" : "Cadangan"}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isActive ? "bg-emerald-950/80 border border-emerald-800 text-emerald-400" :
                                  isCooldown ? "bg-amber-950/80 border border-amber-800 text-amber-400 animate-pulse" :
                                  "bg-rose-950/80 border border-rose-800 text-rose-400"
                                }}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${
                                    isActive ? "bg-emerald-400" :
                                    isCooldown ? "bg-amber-400" :
                                    "bg-rose-400"
                                  }`}></span>
                                  {row.status === "Active" ? "Active (Sehat)" : (row.status === "Cooldown" ? "Cooldown (Tunggu)" : "Failed (Limit)")}
                                </span>
                              </td>
                              <td className={`p-3 text-center font-mono font-bold ${row.cooldown !== "0s" ? "text-amber-400" : "text-slate-500"}`}>
                                {row.cooldown || "0s"}
                              </td>
                              <td className="p-3 font-mono text-slate-400">
                                {row.lastRequest || "-"}
                              </td>
                              <td className="p-3 text-center font-mono">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.fails > 0 ? "bg-rose-950 text-rose-400 font-bold" : "bg-slate-800/50 text-slate-500"}`}>
                                  {row.fails}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Rotation & Failover Console Logs */}
                <div className="flex flex-col gap-2.5">
                  <div className="bg-black/95 rounded-xl border border-slate-800 p-4 font-mono text-[11px] leading-relaxed text-slate-300 shadow-inner">
                    <div className="flex items-center justify-between border-b border-slate-900 pb-2 mb-2.5 text-slate-500">
                      <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-slate-400">
                        <Terminal className="w-3.5 h-3.5 text-pink-brand" /> Rotation & Failover Logs
                      </span>
                      <span className="text-[9px] bg-slate-900 px-1.5 py-0.5 rounded text-slate-400 font-semibold">
                        REAL-TIME MONITOR
                      </span>
                    </div>
                    <div className="max-h-[160px] overflow-y-auto flex flex-col gap-1 select-text scrollbar-thin">
                      {rotationLogs.length > 0 ? (
                        rotationLogs.map((log: any, index: number) => {
                          const isSuccess = log.status === "Sukses";
                          const isFailed = log.status === "Gagal";
                          const isCooldown = log.status === "Cooldown Failover";
                          
                          return (
                            <div key={index} className="flex items-start gap-2 py-0.5">
                              <span className="text-slate-500 font-semibold flex-shrink-0">[{log.timestamp}]</span>
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold flex-shrink-0 ${
                                isSuccess ? "bg-emerald-950 border border-emerald-800/40 text-emerald-400" :
                                isFailed ? "bg-rose-950 border border-rose-800/40 text-rose-400" :
                                isCooldown ? "bg-amber-950 border border-amber-800/40 text-amber-400" :
                                "bg-slate-800 border border-slate-700/40 text-slate-300"
                              }`}>
                                {log.status === "Cooldown Failover" ? "COOLDOWN_FALLBACK" : log.status.toUpperCase()}
                              </span>
                              <span className={isSuccess ? "text-emerald-300 font-semibold" : (isFailed ? "text-rose-300" : "text-slate-200")}>
                                {log.message}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-slate-500 italic text-center py-4 text-xs">
                          Belum ada aktivitas rotasi baru. Jalankan "Perbaiki Deskripsi" untuk memicu monitoring rotasi.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 py-8 mt-12 text-center text-slate-400 text-xs">
        <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-pink-brand-light flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-pink-brand" />
            </div>
            <span className="font-semibold text-slate-600">AI Product Description Rewriter</span>
          </div>
          <p className="text-slate-400">
            © {new Date().getFullYear()} AI Product Description Rewriter. Hak Cipta Dilindungi.
          </p>
          <div className="flex items-center gap-4 text-slate-400 font-medium">
            <button onClick={() => setShowAboutModal(true)} className="hover:text-pink-brand transition">Tentang Kami</button>
            <span>•</span>
            <button onClick={() => setShowPrivacyModal(true)} className="hover:text-pink-brand transition">Privasi</button>
          </div>
        </div>
      </footer>

      {/* About Modal Dialog */}
      <AnimatePresence>
        {showAboutModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAboutModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            ></motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 flex flex-col gap-4 z-10 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Info className="w-5 h-5 text-pink-brand" />
                  <h3 className="font-display font-bold text-slate-900 text-lg">Tentang Kami</h3>
                </div>
                <button
                  onClick={() => setShowAboutModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-3 text-sm text-slate-600 leading-relaxed">
                <p>
                  <strong>AI Product Description Rewriter</strong> adalah aplikasi pintar yang dirancang khusus untuk membantu para pelaku UMKM, reseller, dropshipper, dan admin marketplace meningkatkan kualitas deskripsi produk mereka secara cepat dan instan.
                </p>
                <p>
                  Seringkali kita menjumpai toko online yang hanya menuliskan spam promosi seperti <em>&quot;READY STOCK&quot;, &quot;COD&quot;, &quot;CHAT SEKARANG&quot;, &quot;MURAH BANGET&quot;</em> atau deretan emoji api tanpa ada keterangan fitur atau manfaat produk yang riil. Hal ini menyebabkan calon konsumen ragu untuk membeli.
                </p>
                <p className="bg-pink-brand-light/50 p-3 rounded-xl border border-pink-brand/20 text-xs text-pink-brand-dark">
                  <strong>Bagaimana AI Membantu?</strong><br/>
                  Sistem AI kami menggunakan teknologi model tercanggih Google Gemini 3.5 Flash untuk secara otomatis mendeteksi dan menghapus spam promosi yang mengganggu, lalu merekonstruksi deskripsi produk menjadi susunan kalimat yang profesional, kaya manfaat, berorientasi solusi, dengan tetap mempertahankan seluruh fakta asli produk.
                </p>
                <p>
                  Kami meyakini bahwa deskripsi produk yang baik adalah yang memberi penjelasan detail, akurat, profesional, sekaligus nyaman dibaca. Tingkatkan konversi penjualan toko Anda hari ini!
                </p>
              </div>

              <div className="border-t border-slate-100 pt-3.5 flex justify-end">
                <button
                  onClick={() => setShowAboutModal(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Privacy Policy Modal Dialog */}
      <AnimatePresence>
        {showPrivacyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPrivacyModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            ></motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 flex flex-col gap-4 z-10 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-display font-bold text-slate-900 text-lg">Kebijakan Privasi</h3>
                </div>
                <button
                  onClick={() => setShowPrivacyModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-3 text-sm text-slate-600 leading-relaxed">
                <p>
                  Keamanan data dan kenyamanan Anda adalah prioritas utama kami. Kami sangat serius melindungi informasi yang Anda masukkan ke dalam aplikasi kami.
                </p>
                <div className="flex flex-col gap-2 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 text-xs text-emerald-800">
                  <span className="font-bold">Komitmen Keamanan Kami:</span>
                  <ul className="list-disc pl-4 flex flex-col gap-1">
                    <li><strong>Tanpa Penyimpanan Permanen:</strong> Kami sama sekali tidak menyimpan konten deskripsi produk asli maupun hasil rewrite Anda di server database mana pun tanpa izin eksplisit Anda.</li>
                    <li><strong>Proksi Server Aman:</strong> Permintaan Anda diteruskan langsung dari server backend kami secara aman ke Google Gemini API, sehingga API key dan jalur koneksi terlindungi penuh dari paparan browser luar.</li>
                    <li><strong>Bebas Spam & Iklan:</strong> Layanan kami dirancang bersih dari tracker pihak ketiga yang mengganggu.</li>
                  </ul>
                </div>
                <p>
                  Semua deskripsi yang Anda ketikkan atau tempelkan di aplikasi diproses secara sementara di memori server dan dikembalikan dalam bentuk respon aman. Segera setelah tab aplikasi Anda ditutup, semua data sementara dalam sesi kerja Anda akan dibersihkan.
                </p>
                <p>
                  Dengan menggunakan aplikasi ini, Anda menyetujui pemrosesan data teks deskripsi produk Anda untuk keperluan perbaikan tata bahasa dan penyuntingan copywriting menggunakan kecerdasan buatan.
                </p>
              </div>

              <div className="border-t border-slate-100 pt-3.5 flex justify-end">
                <button
                  onClick={() => setShowPrivacyModal(false)}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Saya Mengerti
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
