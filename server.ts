import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

// Helper to gather all configured Gemini API keys
function getAllApiKeys(): string[] {
  const keysFromEnv = (process.env.GEMINI_API_KEY || "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);

  const individualKeys: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) {
      individualKeys.push(key.trim());
    }
  }

  // Combine and remove duplicates, preserving original order
  const combined = [...keysFromEnv, ...individualKeys];
  return combined.filter((item, index) => combined.indexOf(item) === index && item.length > 0);
}

// Helper to get active environment variable names for debugging
function getDetectedEnvVariableNames(): string[] {
  const detected: string[] = [];
  if (process.env.GEMINI_API_KEY) {
    detected.push("GEMINI_API_KEY");
  }
  for (let i = 1; i <= 10; i++) {
    if (process.env[`GEMINI_API_KEY_${i}`]) {
      detected.push(`GEMINI_API_KEY_${i}`);
    }
  }
  return detected;
}

// Stateful index to remember the last working key index
// Key state model for visualization & monitoring
interface KeyState {
  fails: number;
  lastRequest: string; // HH:mm:ss format
  status: "Active" | "Cooldown" | "Failed";
  cooldownUntil: number; // timestamp
}

// Global state cache for API keys, indexed by masked key (keySignature)
const keyStatesCache: Record<string, KeyState> = {};

function getFormattedTime(): string {
  const now = new Date();
  return now.toTimeString().split(' ')[0]; // "HH:mm:ss"
}

interface GeminiCallResult {
  responseText: string;
  usedKeyIndex: number;
  usedKeyMasked: string;
  attemptsUsed: number;
  rotationLogs: any[];
  keyStatuses: any[];
}

// Function to call Gemini API with automatic rolling key fallback and custom keys support
async function generateContentWithRollingKeys(
  prompt: string,
  systemInstruction: string,
  tone: string,
  length: string,
  format: string,
  randomize: boolean,
  customKeys: string[] = []
): Promise<GeminiCallResult> {
  const systemKeys = getAllApiKeys();
  const rotationLogs: any[] = [];

  interface KeyInfo {
    key: string;
    alias: string;
    signature: string;
    type: "System" | "Custom";
  }

  const allKeysToTry: KeyInfo[] = [];

  // 1. Populate System Keys
  systemKeys.forEach((key, index) => {
    const signature = key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 6)}` : "Key Pendek";
    allKeysToTry.push({
      key,
      alias: `Sistem #${index + 1}`,
      signature,
      type: "System"
    });
  });

  // 2. Populate Custom Keys
  customKeys.forEach((key, index) => {
    if (key && !systemKeys.includes(key)) {
      const signature = key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 6)}` : "Key Pendek";
      allKeysToTry.push({
        key,
        alias: `Cadangan #${index + 1}`,
        signature,
        type: "Custom"
      });
    }
  });

  if (allKeysToTry.length === 0) {
    throw new Error("Tidak ada API Key Gemini yang tersedia. Silakan masukkan API Key cadangan Anda.");
  }

  const now = Date.now();
  // Ensure all keys exist in cache
  allKeysToTry.forEach(k => {
    if (!keyStatesCache[k.signature]) {
      keyStatesCache[k.signature] = {
        fails: 0,
        lastRequest: "-",
        status: "Active",
        cooldownUntil: 0
      };
    }
  });

  // Separate keys into active/ready keys and cooldown keys
  const readyKeys = allKeysToTry.filter(k => {
    const state = keyStatesCache[k.signature];
    return now >= state.cooldownUntil && state.status !== "Failed";
  });

  const cooldownKeys = allKeysToTry.filter(k => {
    const state = keyStatesCache[k.signature];
    return now < state.cooldownUntil || state.status === "Failed";
  }).sort((a, b) => {
    const stateA = keyStatesCache[a.signature];
    const stateB = keyStatesCache[b.signature];
    return stateA.cooldownUntil - stateB.cooldownUntil; // earliest cooldown end first
  });

  // Order of execution: try ready keys first, then cooldown keys as failover
  const sortedKeysToExecute = [...readyKeys, ...cooldownKeys];

  let attempts = 0;
  let lastError: any = null;
  let successResult: any = null;
  let chosenKeyInfo: KeyInfo | null = null;

  for (const keyInfo of sortedKeysToExecute) {
    const { key, alias, signature, type } = keyInfo;
    const state = keyStatesCache[signature];
    attempts++;

    // Update state to record the request
    state.lastRequest = getFormattedTime();

    // Check if on cooldown to log warning
    const isOnCooldown = Date.now() < state.cooldownUntil;
    const cooldownRemaining = isOnCooldown ? Math.ceil((state.cooldownUntil - Date.now()) / 1000) : 0;

    rotationLogs.push({
      timestamp: getFormattedTime(),
      keyAlias: alias,
      keySignature: signature,
      status: isOnCooldown ? "Cooldown Failover" : "Mencoba",
      message: isOnCooldown 
        ? `[Cadangan Terakhir] Mencoba kunci ${alias} (${signature}) yang sedang cooldown (sisa ${cooldownRemaining}s).`
        : `Memproses deskripsi menggunakan kunci ${alias} (${signature}).`
    });

    try {
      const ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isValid: {
                type: Type.BOOLEAN,
                description: "True jika input memiliki cukup informasi produk substantif (seperti nama produk atau deskripsi awal yang bisa dikembangkan). False jika teks masukan hanya berisi promosi spam singkat tanpa menyebutkan nama produk/informasi produk yang jelas."
              },
              validationMessage: {
                type: Type.STRING,
                description: "Pesan kesalahan bahasa Indonesia jika isValid adalah false. Jika isValid adalah true, kosongkan saja."
              },
              analysis: {
                type: Type.STRING,
                description: "Analisis singkat (1-2 kalimat) dalam bahasa Indonesia tentang kekurangan deskripsi asli dan apa saja perbaikan yang dilakukan AI (misalnya menghapus spam promosi, menyusun manfaat, dsb)."
              },
              rewrittenText: {
                type: Type.STRING,
                description: "Hasil akhir perbaikan deskripsi produk dalam bahasa Indonesia. Harus bebas dari markdown berlebih kecuali bullet points jika format menghendaki. Pertahankan semua fakta asli produk."
              },
              chosenTone: {
                type: Type.STRING,
                description: "Gaya penulisan yang digunakan ('Profesional', 'Menjual', atau 'Santai')."
              },
              chosenLength: {
                type: Type.STRING,
                description: "Panjang tulisan yang digunakan ('Pendek', 'Sedang', atau 'Panjang')."
              },
              chosenFormat: {
                type: Type.STRING,
                description: "Format tulisan yang digunakan ('Paragraf', 'Bullet List', atau 'Paragraf + Bullet')."
              }
            },
            required: ["isValid", "validationMessage", "analysis", "rewrittenText", "chosenTone", "chosenLength", "chosenFormat"]
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Respon kosong diterima dari Gemini API.");
      }

      // Success! Update key state
      state.fails = 0;
      state.status = "Active";
      state.cooldownUntil = 0;

      rotationLogs.push({
        timestamp: getFormattedTime(),
        keyAlias: alias,
        keySignature: signature,
        status: "Sukses",
        message: `Berhasil mendapatkan respon menggunakan kunci ${alias} (${signature})!`
      });

      successResult = text;
      chosenKeyInfo = keyInfo;
      break; // Exit loop on success

    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      
      // Update key state on failure
      state.fails += 1;
      // Put in 60s cooldown
      state.cooldownUntil = Date.now() + 60000;
      state.status = state.fails >= 3 ? "Failed" : "Cooldown";

      rotationLogs.push({
        timestamp: getFormattedTime(),
        keyAlias: alias,
        keySignature: signature,
        status: "Gagal",
        message: `Kunci ${alias} (${signature}) gagal. Error: ${errMsg}. Masuk cooldown 60 detik.`
      });
    }
  }

  // Format final status report of all keys to send to client
  const keyStatuses = allKeysToTry.map(k => {
    const s = keyStatesCache[k.signature];
    const cooldownRemaining = s.cooldownUntil > Date.now() ? Math.ceil((s.cooldownUntil - Date.now()) / 1000) : 0;
    return {
      keyAlias: k.alias,
      keySignature: k.signature,
      type: k.type,
      status: cooldownRemaining > 0 ? "Cooldown" : (s.fails >= 3 ? "Failed" : "Active"),
      cooldown: cooldownRemaining > 0 ? `${cooldownRemaining}s` : "0s",
      lastRequest: s.lastRequest,
      fails: s.fails
    };
  });

  if (successResult) {
    const cleanIndex = chosenKeyInfo?.type === "System" 
      ? systemKeys.indexOf(chosenKeyInfo.key) + 1 
      : customKeys.indexOf(chosenKeyInfo?.key || "") + 1;

    return {
      responseText: successResult,
      usedKeyIndex: cleanIndex,
      usedKeyMasked: chosenKeyInfo?.signature || "",
      attemptsUsed: attempts,
      rotationLogs,
      keyStatuses
    };
  }

  // All keys failed
  const quotaOrAuthMsg = lastError?.message || "Kesalahan Tidak Diketahui";
  throw new Error(
    `Seluruh (${allKeysToTry.length}) API Key Gemini (Sistem & Cadangan) gagal dicoba. Kemungkinan kuota habis (Error 429) atau API Key tidak valid. Error terakhir: ${quotaOrAuthMsg}`
  );
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "5mb" }));

  // API endpoint for description rewriting
  app.post("/api/rewrite", async (req, res) => {
    try {
      const { inputText, tone, length, format, randomize, customKeys } = req.body;

      // Primary validation: check if text is empty or less than 10 characters
      if (!inputText || typeof inputText !== "string") {
        return res.status(400).json({
          success: false,
          error: "Deskripsi produk tidak boleh kosong.",
        });
      }

      const trimmedInput = inputText.trim();
      if (trimmedInput.length < 10) {
        return res.json({
          success: true,
          data: {
            isValid: false,
            validationMessage: "Informasi produk masih terlalu sedikit sehingga AI belum dapat membuat deskripsi yang berkualitas. Silakan tambahkan minimal nama produk atau sedikit penjelasan.",
            analysis: "",
            rewrittenText: "",
            chosenTone: tone || "Profesional",
            chosenLength: length || "Sedang",
            chosenFormat: format || "Paragraf",
          }
        });
      }

      if (trimmedInput.length > 20000) {
        return res.status(400).json({
          success: false,
          error: "Deskripsi produk melebihi batas maksimal 20.000 karakter.",
        });
      }

      const parsedCustomKeys = Array.isArray(customKeys)
        ? customKeys.map(k => typeof k === "string" ? k.trim() : "").filter(Boolean)
        : [];

      const activeTone = tone || "Profesional";
      const activeLength = length || "Sedang";
      const activeFormat = format || "Paragraf";
      const isRandomMode = !!randomize;

      let settingInstruction = "";
      if (isRandomMode) {
        settingInstruction = `PANDUAN PENGATURAN (MODE OTOMATIS/ACAK):
- Anda berada dalam MODE OTOMATIS (randomize = true).
- Silakan analisis produk tersebut dan pilih kombinasi Gaya Penulisan (Tone), Panjang Tulisan (Length), dan Format yang paling optimal dan sesuai untuk jenis produk ini agar menarik minat pembeli secara maksimal.
- Laporkan kombinasi terpilih tersebut pada field JSON: 'chosenTone' (isi dengan salah satu: 'Profesional', 'Menjual', atau 'Santai'), 'chosenLength' (isi dengan salah satu: 'Pendek', 'Sedang', atau 'Panjang'), dan 'chosenFormat' (isi dengan salah satu: 'Paragraf', 'Bullet List', atau 'Paragraf + Bullet').`;
      } else {
        settingInstruction = `PANDUAN PENGATURAN (MODE MANUAL - WAJIB DIIKUTI 100%):
1. Gaya Penulisan (Tone) yang MUTLAK HARUS DIGUNAKAN adalah: '${activeTone}'.
   - Anda wajib menulis deskripsi dengan tone '${activeTone}'.
   - Isi field 'chosenTone' pada JSON response tepat dengan nilai: '${activeTone}'.
2. Panjang Tulisan (Length) yang MUTLAK HARUS DIGUNAKAN adalah: '${activeLength}'.
   - Anda wajib menyesuaikan panjang tulisan agar sesuai dengan kategori '${activeLength}'.
   - Isi field 'chosenLength' pada JSON response tepat dengan nilai: '${activeLength}'.
3. Format Output (Format) yang MUTLAK HARUS DIGUNAKAN adalah: '${activeFormat}'.
   - Anda wajib memformat hasil penulisan sesuai dengan kategori '${activeFormat}'.
   - Isi field 'chosenFormat' pada JSON response tepat dengan nilai: '${activeFormat}'.`;
      }

      const systemInstruction = `Anda adalah AI Product Description Rewriter profesional dalam Bahasa Indonesia.
Tugas utama Anda adalah mengubah deskripsi produk yang kurang informatif, penuh spam promosi, atau berantakan menjadi deskripsi yang profesional, menarik, informatif, dan siap dipublikasikan di marketplace (seperti Shopee, Tokopedia, TikTok Shop, Lazada).

${settingInstruction}

PANDUAN STRUKTUR SANGAT KETAT BERDASARKAN FORMAT & PANJANG TULISAN:
1. Jika Format yang aktif adalah 'Paragraf' (atau 'Paragraf Saja'):
   - Seluruh konten WAJIB berupa paragraf mengalir murni.
   - MUTLAK DILARANG KERAS menyisipkan bullet points, tanda list (*, -, •, atau angka penomoran) di dalam seluruh teks. Jangan meletakkan tanda bintang (*) di awal kalimat/bagian sebagai penanda poin!
   - Setiap paragraf WAJIB dipisahkan dengan dua kali ganti baris (double newline atau "\\n\\n") secara nyata agar terbaca terpisah.
   - Pendek: Tulis tepat 1 paragraf ringkas berisi 2-4 kalimat efektif yang padat informasi.
   - Sedang: Tulis dalam tepat 2-3 paragraf terpisah (pisahkan dengan "\\n\\n"). Setiap paragraf wajib terdiri dari minimal 3 kalimat terperinci.
   - Panjang: Tulis dalam tepat 4 atau lebih paragraf komprehensif, terperinci, dan panjang (pisahkan antar-paragraf dengan "\\n\\n"). Setiap paragraf minimal berisi 3-4 kalimat panjang yang merinci kegunaan, spesifikasi, keunggulan produk, serta info/ajakan bertindak (Call to Action).

2. Jika Format yang aktif adalah 'Bullet List' (atau 'Daftar Poin'):
   - Seluruh konten wajib disajikan dalam bentuk daftar poin/bullet points. Gunakan format Markdown standar untuk list, seperti tanda bintang (*) atau dash (-) di awal baris untuk poin-poinnya (misal: "* Layanan sedot WC...").
   - Pendek: Tulis 3 sampai 5 poin manfaat/fitur terpenting.
   - Sedang: Tulis 6 sampai 9 poin terstruktur dengan rapi.
   - Panjang: Tulis 10 atau lebih poin komprehensif yang menjabarkan spesifikasi, kegunaan, keunggulan, serta kontak secara mendalam.

3. Jika Format yang aktif adalah 'Paragraf + Bullet':
   - Tulis dengan kombinasi terstruktur: Paragraf pembuka, diikuti oleh daftar poin (bullet list) dengan tanda bintang (* atau -) di bagian tengah, dan diakhiri dengan paragraf penutup/Call to Action.
   - Setiap bagian utama WAJIB dipisahkan dengan double newline ("\\n\\n") agar visualnya sangat rapi di aplikasi.
   - Pendek: 1 paragraf pembuka singkat (1-2 kalimat) + 3-4 poin.
   - Sedang: 1-2 paragraf pembuka + 5-7 poin + 1 paragraf penutup singkat.
   - Panjang: 2-3 paragraf pembuka + 8 atau lebih poin komprehensif + 1-2 paragraf penutup/Call to Action.

PANDUAN GAYA PENULISAN (TONE):
- Profesional: Gunakan bahasa baku, formal, elegan, informatif, dan terpercaya. Cocok untuk produk premium, kantor, jasa resmi, teknologi, elektronik, atau alat kesehatan.
- Menjual: Gunakan gaya bahasa sangat persuasif, menarik perhatian (attention-grabbing), menonjolkan keuntungan langsung bagi pembeli, dan menggunakan Call to Action (CTA) yang kuat.
- Santai: Gunakan gaya bahasa ramah, kasual, hangat, akrab, seakan berbicara dengan teman, namun tetap sopan, jelas, dan mudah dipahami.

PANDUAN UTAMA REWRITE (AI RULES):
1. WAJIB MENGHAPUS:
   - Emoji berlebihan atau tidak relevan.
   - Simbol dekorasi tidak penting (seperti pembatas garis panjang berlebihan, bintang berjejer, simbol api berlebihan 🔥🔥🔥🔥🔥).
   - Spam karakter (seperti "READY STOCKK!!!!!", "MURAHHH BGT").
   - Kata-kata yang diulang secara berlebihan tanpa makna.
   - Promosi spam yang tidak relevan dengan esensi produk (misalnya seruan "CHAT SEKARANG", "COD", "MURAH", "READY STOCK" yang ditulis berulang-ulang tanpa konteks penjelas produk).
2. BOLEH:
   - Menyusun ulang kalimat agar mengalir dengan indah dan mudah dibaca.
   - Memperbaiki tata bahasa Indonesia (EYD/PUEBI) menjadi lebih profesional atau santai sesuai gaya yang diinginkan.
   - Menambahkan kalimat transisi yang logis.
   - Menambahkan penjelasan manfaat produk (product benefits) APABILA manfaat tersebut tersirat atau logis dari spesifikasi produk yang diinput.
3. MUTLAK TIDAK BOLEH:
   - Mengarang atau membuat-buat spesifikasi produk baru (seperti ukuran baru, warna baru, material baru yang tidak disebutkan di input).
   - Mengubah merek asli produk.
   - Menambahkan klaim palsu atau garansi palsu yang tidak disebutkan di input asli.
   - PRIORITAS TERTINGGI ADALAH MEMPERTAHANKAN FAKTA ASLI PRODUK. Jangan sekali-kali mengarang fakta baru.

PANDUAN VALIDASI (VALIDASI AI):
- Jika deskripsi awal hanya berupa spam promosi tanpa menyebutkan nama produk atau informasi substantif produk sama sekali (contoh: "Murah Ready COD", "🔥🔥🔥🔥 ready chat", atau "Ready stock kak silakan diorder langsung"), Anda harus menandai isValid sebagai false, dan mengisi validationMessage dengan: "Informasi produk masih terlalu sedikit sehingga AI belum dapat membuat deskripsi yang berkualitas. Silakan tambahkan minimal nama produk atau sedikit penjelasan."

CATATAN FORMATTING JSON:
- Tuliskan baris baru/newline secara alami di dalam nilai string JSON Anda untuk memisahkan paragraf atau poin (gunakan karakter newline asli, jangan menulis literal "\\n" atau kata "\\n" secara manual).`;

      const prompt = `Lakukan rewrite pada deskripsi produk berikut:
--- DESKRIPSI AWAL ---
${trimmedInput}
----------------------

Harap kembalikan respon dalam format JSON sesuai skema yang ditentukan.`;

      // Call Gemini with rolling/fallback keys and custom backup keys
      const callResult = await generateContentWithRollingKeys(
        prompt,
        systemInstruction,
        activeTone,
        activeLength,
        activeFormat,
        isRandomMode,
        parsedCustomKeys
      );

      const resultData = JSON.parse(callResult.responseText.trim());
      
      // Sanitize any literal backslash-n representation in string
      if (resultData && typeof resultData.rewrittenText === "string") {
        resultData.rewrittenText = resultData.rewrittenText
          .replace(/\\n/g, "\n")
          .replace(/&nbsp;/g, " ");
      }
      
      return res.json({
        success: true,
        data: resultData,
        rollingMeta: {
          usedKeyIndex: callResult.usedKeyIndex,
          usedKeyMasked: callResult.usedKeyMasked,
          attemptsUsed: callResult.attemptsUsed,
          totalKeysAvailable: getAllApiKeys().length + parsedCustomKeys.length
        },
        rotationLogs: callResult.rotationLogs,
        keyStatuses: callResult.keyStatuses,
        detectedEnvKeys: getDetectedEnvVariableNames()
      });

    } catch (error: any) {
      console.error("Error in /api/rewrite:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Terjadi kesalahan pada server saat memperoses permintaan Anda."
      });
    }
  });

  // API endpoint to query status of all keys (system & custom)
  app.post("/api/keys-status", (req, res) => {
    try {
      const { customKeys } = req.body;
      const systemKeys = getAllApiKeys();

      interface KeyInfo {
        key: string;
        alias: string;
        signature: string;
        type: "System" | "Custom";
      }

      const allKeys: KeyInfo[] = [];

      // Populate system keys
      systemKeys.forEach((key, index) => {
        const signature = key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 6)}` : "Key Pendek";
        allKeys.push({
          key,
          alias: `Sistem #${index + 1}`,
          signature,
          type: "System"
        });
      });

      // Populate custom keys
      const parsedCustomKeys = Array.isArray(customKeys)
        ? customKeys.map(k => typeof k === "string" ? k.trim() : "").filter(Boolean)
        : [];

      parsedCustomKeys.forEach((key, index) => {
        if (key && !systemKeys.includes(key)) {
          const signature = key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 6)}` : "Key Pendek";
          allKeys.push({
            key,
            alias: `Cadangan #${index + 1}`,
            signature,
            type: "Custom"
          });
        }
      });

      const now = Date.now();
      const keyStatuses = allKeys.map(k => {
        const s = keyStatesCache[k.signature] || {
          fails: 0,
          lastRequest: "-",
          status: "Active",
          cooldownUntil: 0
        };
        const cooldownRemaining = s.cooldownUntil > now ? Math.ceil((s.cooldownUntil - now) / 1000) : 0;
        return {
          keyAlias: k.alias,
          keySignature: k.signature,
          type: k.type,
          status: cooldownRemaining > 0 ? "Cooldown" : (s.fails >= 3 ? "Failed" : "Active"),
          cooldown: cooldownRemaining > 0 ? `${cooldownRemaining}s` : "0s",
          lastRequest: s.lastRequest,
          fails: s.fails
        };
      });

      return res.json({
        success: true,
        keyStatuses,
        detectedEnvKeys: getDetectedEnvVariableNames()
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  });

  // Serve static files / Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
