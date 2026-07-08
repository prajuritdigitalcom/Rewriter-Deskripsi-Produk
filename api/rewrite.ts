import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

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

interface GeminiCallResult {
  responseText: string;
  usedKeyIndex: number;
  usedKeyMasked: string;
  attemptsUsed: number;
}

// Function to call Gemini API with automatic rolling key fallback
async function generateContentWithRollingKeys(
  prompt: string,
  systemInstruction: string,
  tone: string,
  length: string,
  format: string,
  randomize: boolean
): Promise<GeminiCallResult> {
  const apiKeys = getAllApiKeys();
  
  console.log(`[Vercel Serverless Logs] Mendeteksi total ${apiKeys.length} API Key Gemini terkonfigurasi.`);

  if (apiKeys.length === 0) {
    throw new Error("GEMINI_API_KEY belum dikonfigurasi di environment variables Vercel. Silakan tambahkan 'GEMINI_API_KEY' atau 'GEMINI_API_KEY_1' s/d 'GEMINI_API_KEY_10' di dashboard Vercel -> Settings -> Environment Variables.");
  }

  const totalKeys = apiKeys.length;
  let attempts = 0;
  let lastError: any = null;

  // Since Serverless is stateless, let's start with a random index to distribute load across keys (load balancing)
  const startIdx = Math.floor(Math.random() * totalKeys);
  console.log(`[Vercel Serverless Logs] Memulai pencarian kunci aktif dari indeks acak: #${startIdx + 1}`);

  while (attempts < totalKeys) {
    const indexToTry = (startIdx + attempts) % totalKeys;
    const apiKey = apiKeys[indexToTry];
    
    // Create a masked version for logging
    const maskedKey = apiKey.length > 12
      ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 6)}`
      : "Kunci Pendek/Format Kustom";

    try {
      console.log(`[Vercel Serverless Logs] [Mencoba Key #${indexToTry + 1}] Memproses permintaan menggunakan API Key #${indexToTry + 1} (${maskedKey}) - Percobaan ${attempts + 1}/${totalKeys}`);

      const ai = new GoogleGenAI({
        apiKey,
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

      console.log(`[Vercel Serverless Logs] [SUKSES] Berhasil memproses dengan API Key #${indexToTry + 1} (${maskedKey})`);

      return {
        responseText: text,
        usedKeyIndex: indexToTry + 1,
        usedKeyMasked: maskedKey,
        attemptsUsed: attempts + 1
      };

    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      console.error(`[Vercel Serverless Logs] [GAGAL Key #${indexToTry + 1}] Gagal menggunakan API Key #${indexToTry + 1} (${maskedKey}). Pesan Error: ${errMsg}`);
      
      // Increment attempts to move to the next key
      attempts++;
    }
  }

  // If all keys failed
  console.error("[Vercel Serverless Logs] [SEMUA KUNCI GAGAL] Semua API Key yang terdaftar telah dicoba dan seluruhnya gagal.");
  const quotaOrAuthMsg = lastError?.message || "Kesalahan Tidak Diketahui";
  throw new Error(
    `Seluruh (${totalKeys}) API Key Gemini Anda gagal dicoba pada server Vercel. Kemungkinan kuota habis (Error 429) atau API Key tidak valid. Error terakhir: ${quotaOrAuthMsg}`
  );
}

export default async function handler(req: any, res: any) {
  // Handle CORS and preflight requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    console.log(`[Vercel Serverless Logs] Metode HTTP ditolak: ${req.method}. Hanya POST yang diizinkan.`);
    return res.status(405).json({
      success: false,
      error: "Metode tidak diizinkan. Silakan gunakan POST."
    });
  }

  try {
    const { inputText, tone, length, format, randomize } = req.body || {};

    console.log("[Vercel Serverless Logs] Menerima permintaan rewrite baru.");
    console.log(`- Tone: ${tone || "Profesional (Default)"}`);
    console.log(`- Length: ${length || "Sedang (Default)"}`);
    console.log(`- Format: ${format || "Paragraf Saja (Default)"}`);
    console.log(`- Randomize: ${randomize ? "Ya" : "Tidak"}`);
    console.log(`- Panjang Input: ${inputText ? inputText.length : 0} karakter`);

    // Primary validation: check if text is empty or less than 10 characters
    if (!inputText || typeof inputText !== "string") {
      console.warn("[Vercel Serverless Logs] Validasi gagal: input kosong.");
      return res.status(400).json({
        success: false,
        error: "Deskripsi produk tidak boleh kosong.",
      });
    }

    const trimmedInput = inputText.trim();
    if (trimmedInput.length < 10) {
      console.warn("[Vercel Serverless Logs] Input terlalu pendek (< 10 karakter). Mengembalikan respon validasi langsung.");
      return res.status(200).json({
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
      console.warn("[Vercel Serverless Logs] Input terlalu panjang (> 20.000 karakter).");
      return res.status(400).json({
        success: false,
        error: "Deskripsi produk melebihi batas maksimal 20.000 karakter.",
      });
    }

    const systemInstruction = `Anda adalah AI Product Description Rewriter profesional dalam Bahasa Indonesia.
Tugas utama Anda adalah mengubah deskripsi produk yang kurang informatif, penuh spam promosi, atau berantakan menjadi deskripsi yang profesional, menarik, informatif, dan siap dipublikasikan di marketplace (seperti Shopee, Tokopedia, TikTok Shop, Lazada).

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

PANDUAN PENGATURAN:
Jika randomize = false:
- Gaya Penulisan (Tone): Gunakan '${tone}'.
- Panjang Tulisan (Length): Gunakan '${length}'.
- Format: Gunakan '${format}'.
If randomize = true:
- Pilih kombinasi Tone, Length, dan Format yang paling optimal dan sesuai untuk jenis produk tersebut. Isikan pilihan otomatis tersebut di field 'chosenTone', 'chosenLength', dan 'chosenFormat'.`;

    const prompt = `Lakukan rewrite pada deskripsi produk berikut:
--- DESKRIPSI AWAL ---
${trimmedInput}
----------------------

Harap kembalikan respon dalam format JSON sesuai skema yang ditentukan.`;

    // Call Gemini with rolling/fallback keys
    const callResult = await generateContentWithRollingKeys(
      prompt,
      systemInstruction,
      tone || "Profesional",
      length || "Sedang",
      format || "Paragraf",
      !!randomize
    );

    const resultData = JSON.parse(callResult.responseText.trim());
    
    console.log("[Vercel Serverless Logs] Pengolahan sukses. Mengirim respon kembali ke client.");

    return res.status(200).json({
      success: true,
      data: resultData,
      rollingMeta: {
        usedKeyIndex: callResult.usedKeyIndex,
        usedKeyMasked: callResult.usedKeyMasked,
        attemptsUsed: callResult.attemptsUsed,
        totalKeysAvailable: getAllApiKeys().length
      }
    });

  } catch (error: any) {
    console.error("[Vercel Serverless Logs] FATAL ERROR:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Terjadi kesalahan internal pada server Vercel saat memproses permintaan Anda."
    });
  }
}
