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

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // sajikan frontend dari folder public/

// Endpoint percakapan multi-turn
app.post('/api/chat', async (req, res) => {
  const { conversation } = req.body;

  if (!Array.isArray(conversation)) {
    return res
      .status(400)
      .json({ message: "Field 'conversation' harus berupa array." });
  }

  try {
    // Petakan {role, text} -> format Gemini {role, parts:[{text}]}
    const contents = conversation.map((msg) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text ?? '' }],
    }));

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        temperature: 0.7,
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });

    res.status(200).json({ result: response.text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on http://localhost:${PORT}`));
