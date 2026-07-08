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

// Stateful index to remember the last working key index
let currentKeyIndex = 0;

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
  if (apiKeys.length === 0) {
    throw new Error("GEMINI_API_KEY belum dikonfigurasi di environment variables. Silakan tambahkan kunci API Anda di Settings.");
  }

  const totalKeys = apiKeys.length;
  let attempts = 0;
  let lastError: any = null;

  while (attempts < totalKeys) {
    // Begin try from last known working index, moving forward on each failure
    const indexToTry = (currentKeyIndex + attempts) % totalKeys;
    const apiKey = apiKeys[indexToTry];
    
    // Create a masked version for logging
    const maskedKey = apiKey.length > 12
      ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 6)}`
      : "Kunci Pendek/Format Kustom";

    try {
      console.log(`[Gemini API Rotation] Mencoba memproses menggunakan API Key #${indexToTry + 1} (${maskedKey}) - Percobaan ${attempts + 1}/${totalKeys}`);

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

      // Success! Update our global working index
      currentKeyIndex = indexToTry;
      console.log(`[Gemini API Rotation] Sukses menggunakan API Key #${indexToTry + 1} (${maskedKey})`);

      return {
        responseText: text,
        usedKeyIndex: indexToTry + 1,
        usedKeyMasked: maskedKey,
        attemptsUsed: attempts + 1
      };

    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      console.error(`[Gemini API Rotation] Gagal menggunakan API Key #${indexToTry + 1} (${maskedKey}). Error: ${errMsg}`);
      
      // Increment attempts to move to the next key
      attempts++;
    }
  }

  // If all keys failed
  console.error("[Gemini API Rotation] Semua API Key yang terdaftar telah dicoba dan semuanya gagal.");
  const quotaOrAuthMsg = lastError?.message || "Kesalahan Tidak Diketahui";
  throw new Error(
    `Seluruh (${totalKeys}) API Key Gemini Anda gagal dicoba. Kemungkinan kuota habis (Error 429) atau API Key tidak valid. Error terakhir: ${quotaOrAuthMsg}`
  );
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "5mb" }));

  // API endpoint for description rewriting
  app.post("/api/rewrite", async (req, res) => {
    try {
      const { inputText, tone, length, format, randomize } = req.body;

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
Jika randomize = true:
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
        tone,
        length,
        format,
        randomize
      );

      const resultData = JSON.parse(callResult.responseText.trim());
      
      return res.json({
        success: true,
        data: resultData,
        // Include rolling key execution metadata to inform the client/admin logs if desired
        rollingMeta: {
          usedKeyIndex: callResult.usedKeyIndex,
          usedKeyMasked: callResult.usedKeyMasked,
          attemptsUsed: callResult.attemptsUsed,
          totalKeysAvailable: getAllApiKeys().length
        }
      });

    } catch (error: any) {
      console.error("Error in /api/rewrite:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Terjadi kesalahan pada server saat memperoses permintaan Anda."
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
