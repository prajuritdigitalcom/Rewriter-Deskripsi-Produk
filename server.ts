import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

// Lazy initialize Gemini client to prevent crash if key is missing on startup.
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in environment variables.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
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

      const ai = getGeminiClient();

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

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Gemini API did not return any text.");
      }

      const resultData = JSON.parse(responseText.trim());
      return res.json({
        success: true,
        data: resultData
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
