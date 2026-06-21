# Geni — Personal AI Assistant

**Geni** adalah chatbot web berbasis **Gemini 2.5 Flash** yang berperan sebagai
**Asisten Produktivitas**: asisten penulisan & komunikasi kerja berbahasa Indonesia. Geni
membantu menyusun dan memperbaiki email/pesan, meringkas teks, serta menyesuaikan nada
tulisan (formal ↔ santai).

Logika AI berjalan di **backend** (Express), sehingga `GEMINI_API_KEY` tidak pernah
terekspos ke browser. Frontend hanya menangani UI dan memanggil endpoint `/api/chat`.

> Final project Sesi 3 — course Hacktiv8 "AI Productivity and AI API Integration for Developers".

---

## 🖼️ Tampilan UI

| Welcome state | Percakapan (multi-turn) |
|---|---|
| ![Welcome state](screenshots/ui-welcome.png) | ![Percakapan](screenshots/ui-conversation.png) |

---

## ✨ Fitur

- **Chat multi-turn** — bot mengingat konteks percakapan dalam satu sesi (seluruh riwayat
  dikirim tiap request).
- **System Instruction** — persona, gaya jawaban, dan batasan ditetapkan di backend
  (asisten penulisan kerja, Bahasa Indonesia).
- **Parameter terkonfigurasi** — `temperature: 0.7` (seimbang untuk drafting).
- **Tone toggle** — Formal / Semi / Santai. Ditangani di frontend dengan menyisipkan
  prefix `"[Gunakan nada <tone>] "` ke pesan yang dikirim ke backend.
- **UI "Hangat & Personal"** — sidebar, header gradien biru, welcome state dengan quick-action
  chips, bubble bot krem hangat + avatar `✦`, tombol **Salin** & **Tulis ulang**, indikator
  typing tiga titik, dan **Mulai obrolan baru**.
- **Input multimodal (v2)** — lampirkan **gambar/screenshot, PDF, atau audio** lewat tombol 📎
  atau task-chip; Geni membaca lampiran untuk membantu tugas tulis-menulis kerja.

---

## 📎 Input Multimodal (v2)

> Fitur ini ada di branch **`geni-v2`**. Branch `main` tetap versi text-only.

Selain teks, Geni bisa menerima **satu lampiran per pesan**:

| Modalitas | Format didukung | Contoh kegunaan |
|---|---|---|
| Gambar / screenshot | PNG, JPEG, WebP | Baca screenshot chat → bantu balas / ubah nada |
| Dokumen | PDF | Ringkas dokumen / ekstrak poin / draft balasan |
| Audio / voice note | MP3, WAV, OGG, AAC | Transkrip & susun jadi pesan rapi |

**Cara pakai:** klik tombol **📎** di composer (atau task-chip seperti *Ringkas dokumen* /
*Balas screenshot* / *Voice note → pesan*), pilih file, lalu kirim — boleh dengan atau tanpa
teks tambahan. Tone toggle tetap berlaku.

**Catatan teknis:**
- File dikirim **inline (base64)**; batas **±14 MB** per file (tetap di bawah batas request
  inline Gemini 20 MB).
- File bersifat **sekali pakai** — dikirim ke model hanya pada pesan saat dilampirkan; tindak
  lanjut memakai jawaban teks Geni (hemat payload). Bila perlu detail asli lagi, lampirkan ulang.
- Validasi tipe & ukuran dilakukan di frontend **dan** backend (allow-list MIME, normalisasi
  alias, plus cek *magic-byte* untuk gambar/PDF).

---

## 🧰 Tech Stack

- **Node.js** v18+ (ES Modules — `"type": "module"`)
- **Express 5** — REST API + static file server
- **cors** — izinkan request lintas origin
- **dotenv** — memuat `GEMINI_API_KEY` dari `.env`
- **@google/genai** — SDK Gemini (model `gemini-2.5-flash`)
- Frontend: HTML/CSS/JS murni + font **Plus Jakarta Sans** (Google Fonts CDN)

---

## 🚀 Instalasi & Menjalankan

### 1. Install dependencies

```bash
npm install
```

### 2. Setup environment

Buat file `.env` di root project (lihat `.env.example` sebagai template):

```
GEMINI_API_KEY=your_api_key_here
```

Dapatkan API key dari [Google AI Studio](https://aistudio.google.com/app/apikey).

> `.env` tidak ikut di-commit (lihat `.gitignore`).

### 3. Jalankan server

```bash
npm start
```

Tunggu hingga muncul:

```
Server ready on http://localhost:3000
```

Lalu buka **http://localhost:3000** di browser.

---

## 📡 Dokumentasi Endpoint

### `POST /api/chat`

Percakapan multi-turn. Frontend mengirim **seluruh riwayat** percakapan tiap request.

**Request body** (JSON):

```json
{
  "conversation": [
    { "role": "user",  "text": "Tolong buatkan draft email izin cuti." },
    { "role": "model", "text": "Tentu, untuk siapa email ini ditujukan?" },
    { "role": "user",  "text": "Ke atasan saya, Pak Budi, 3 hari minggu depan." }
  ]
}
```

- `role`: `"user"` atau `"model"`.
- `text`: isi pesan.

**Lampiran opsional (v2)** — sertakan field `file` untuk turn berjalan (sekali pakai):

```json
{
  "conversation": [ { "role": "user", "text": "Tolong ringkas dokumen ini." } ],
  "file": {
    "mimeType": "application/pdf",
    "data": "<base64 mentah, tanpa prefix data:>",
    "name": "laporan-q2.pdf"
  }
}
```

- `file` boleh dihilangkan (request text-only tetap bekerja seperti biasa).
- `data`: isi file dalam base64 **tanpa** prefix `data:<mime>;base64,`.
- Maksimum satu file per pesan; backend menempelkannya sebagai bagian (`inlineData`) ke pesan
  user terakhir dan tidak menyimpannya di riwayat.

**Response sukses** (`200`):

```json
{ "result": "<jawaban AI>" }
```

**Response error**:

| Status | Kondisi | Body |
|--------|---------|------|
| `400` | `conversation` bukan array | `{ "message": "Field 'conversation' harus berupa array." }` |
| `400` | Lampiran tidak valid / format tak didukung / terlalu besar / isi tak cocok tipe | `{ "message": "<pesan ramah>" }` |
| `400` | Gemini menolak file (input tak diproses) | `{ "message": "File tidak dapat diproses oleh model. Coba file lain." }` |
| `500` | Gagal memanggil Gemini | `{ "message": "<pesan error>" }` |

---

## 🧪 Cara Testing

### A. Lewat browser (UI) — utama

1. `npm start` → tunggu `Server ready on http://localhost:3000`.
2. Buka `http://localhost:3000/`.
3. Pastikan tampil sidebar + header gradien biru + welcome state dengan chips.
   Klik salah satu chip → input terisi; kirim → muncul typing → jawaban AI.
4. Coba **tone toggle** (Formal/Semi/Santai) lalu kirim pesan — gaya jawaban berubah.
5. Coba **multi-turn**:
   - "Tolong buatkan draft email izin sakit ke atasan."
   - Lanjut: "Buat versi yang lebih singkat." → bot paham konteks sebelumnya.
6. Coba tombol **Salin** & **Tulis ulang**, dan **Mulai obrolan baru**.

### B. Lewat curl / Postman (endpoint langsung)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"conversation":[{"role":"user","text":"Halo, kamu bisa bantu apa?"}]}'
```

Harus membalas `{ "result": "..." }`.

> Jika dapat `503 / UNAVAILABLE`, itu dari sisi Gemini (model sibuk) — coba lagi beberapa
> saat. Bukan bug.

---

## 📁 Struktur Project

```
gemini-chatbot-api/
├── index.js          # Backend Express: /api/chat + serve frontend
├── package.json      # ES Modules + dependencies + start script
├── .env              # GEMINI_API_KEY (tidak di-commit)
├── .env.example      # Template env
├── .gitignore
├── README.md
└── public/           # Frontend (UI "Hangat & Personal")
    ├── index.html
    ├── script.js
    └── style.css
```
