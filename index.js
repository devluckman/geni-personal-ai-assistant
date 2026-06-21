import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Model default Gemini (ubah di satu tempat ini bila perlu)
const GEMINI_MODEL = 'gemini-2.5-flash';

// Persona chatbot (system instruction)
const SYSTEM_INSTRUCTION = `Kamu adalah "Geni", asisten produktivitas berbasis AI yang berspesialisasi dalam penulisan dan komunikasi kerja profesional berbahasa Indonesia. Jika ditanya namamu, perkenalkan diri sebagai Geni.

Tugas utamamu:
- Membantu menyusun, memperbaiki, dan meringkas email, pesan, dan dokumen kerja.
- Membaca lampiran yang dikirim pengguna lalu membantu tugas terkait. Kamu memang bisa melihat gambar/screenshot, membaca dokumen PDF, dan mendengarkan audio yang dilampirkan — jangan menyangkalnya.
- Menyesuaikan nada tulisan sesuai permintaan (formal, semi-formal, atau santai).
- Memberi saran komunikasi yang jelas, sopan, dan efektif.

Gaya jawaban:
- Profesional namun ramah dan ringkas.
- Gunakan struktur rapi (poin atau langkah) bila relevan.
- Jika permintaan kurang konteks (tujuan, penerima, atau nada yang diinginkan), tanyakan dulu sebelum menulis.

Batasan:
- Jawab dalam Bahasa Indonesia kecuali pengguna meminta bahasa lain.
- Jangan mengarang fakta atau data. Jika tidak tahu, katakan dengan jujur.
- Fokus pada produktivitas dan komunikasi kerja; tolak dengan sopan permintaan di luar konteks ini.`;

// ---- Input multimodal (v2): konfigurasi & validasi lampiran ----
//
// Batas ukuran file mentah (setelah decode base64). 14 MB mentah ≈ 18,7 MB base64,
// tetap di bawah batas request inline Gemini (20 MB: teks + systemInstruction + file).
const MAX_FILE_BYTES = 14 * 1024 * 1024;

// Allow-list MIME per modalitas (nilai SUDAH ternormalisasi).
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
]);

// Browser sering melaporkan MIME yang berbeda dari yang diharapkan Gemini
// (mis. MP3 dilaporkan sebagai "audio/mpeg"). Normalkan dulu sebelum cek allow-list.
const MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'audio/mpeg': 'audio/mp3',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-m4a': 'audio/aac',
  'audio/m4a': 'audio/aac',
  'audio/x-aac': 'audio/aac',
  'application/x-pdf': 'application/pdf',
};

function normalizeMime(mime) {
  const m = String(mime || '').toLowerCase().trim();
  return MIME_ALIASES[m] || m;
}

// Verifikasi tanda tangan byte awal (magic bytes) untuk tipe yang andal: gambar & PDF.
// Audio tidak diverifikasi byte (tanda tangannya kurang konsisten) — cukup MIME ternormalisasi.
function magicByteMatches(mime, buf) {
  if (buf.length < 12) return false;
  switch (mime) {
    case 'image/png':
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/webp':
      return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    case 'application/pdf':
      return buf.toString('ascii', 0, 4) === '%PDF';
    default:
      return true; // audio/* — diterima berdasarkan MIME ternormalisasi
  }
}

// Validasi lampiran. -> { ok:true, mimeType, data } atau { ok:false, message }.
function validateFile(file) {
  if (
    !file ||
    typeof file !== 'object' ||
    typeof file.data !== 'string' ||
    typeof file.mimeType !== 'string'
  ) {
    return { ok: false, message: 'Lampiran tidak valid.' };
  }

  const mimeType = normalizeMime(file.mimeType);
  if (!ALLOWED_MIME.has(mimeType)) {
    return {
      ok: false,
      message:
        'Format file tidak didukung. Gunakan gambar (PNG/JPEG/WebP), PDF, atau audio (MP3/WAV/OGG/AAC).',
    };
  }

  let buf;
  try {
    buf = Buffer.from(file.data, 'base64');
  } catch {
    return { ok: false, message: 'Data lampiran rusak.' };
  }
  if (buf.length === 0) {
    return { ok: false, message: 'Data lampiran rusak.' };
  }
  if (buf.length > MAX_FILE_BYTES) {
    return { ok: false, message: 'File terlalu besar. Maksimal 14 MB.' };
  }
  if (!magicByteMatches(mimeType, buf)) {
    return { ok: false, message: 'Isi file tidak cocok dengan tipenya.' };
  }

  return { ok: true, mimeType, data: file.data };
}

app.use(cors());
app.use(express.json({ limit: '25mb' })); // muat payload base64 lampiran (file dijaga ≤ 14 MB mentah)
app.use(express.static('public')); // sajikan frontend dari folder public/

// Endpoint percakapan multi-turn (mendukung satu lampiran opsional per pesan)
app.post('/api/chat', async (req, res) => {
  const { conversation, file } = req.body;

  if (!Array.isArray(conversation)) {
    return res
      .status(400)
      .json({ message: "Field 'conversation' harus berupa array." });
  }

  // Validasi lampiran (bila ada) SEBELUM memanggil model.
  let validFile = null;
  if (file != null) {
    const check = validateFile(file);
    if (!check.ok) {
      return res.status(400).json({ message: check.message });
    }
    validFile = check;
  }

  try {
    // Petakan {role, text} -> format Gemini {role, parts:[{text}]}
    const contents = conversation.map((msg) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text ?? '' }],
    }));

    // Lampiran bersifat sekali pakai: hanya untuk turn ini. Tempelkan sebagai
    // inlineData part ke konten user terakhir (atau buat konten user baru bila perlu).
    if (validFile) {
      const filePart = {
        inlineData: { mimeType: validFile.mimeType, data: validFile.data },
      };
      const last = contents[contents.length - 1];
      if (last && last.role === 'user') {
        last.parts.push(filePart);
      } else {
        contents.push({ role: 'user', parts: [filePart] });
      }
    }

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        temperature: 0.7,
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });

    res.status(200).json({ result: response.text ?? '' });
  } catch (e) {
    console.error(e);
    // Bedakan "file bermasalah" (Gemini menolak input, kelas 400) dari error server.
    const status = e?.status ?? e?.code;
    const is400 =
      status === 400 || /INVALID_ARGUMENT|400/.test(String(e?.message ?? ''));
    if (is400) {
      return res
        .status(400)
        .json({ message: 'File tidak dapat diproses oleh model. Coba file lain.' });
    }
    res.status(500).json({ message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on http://localhost:${PORT}`));
