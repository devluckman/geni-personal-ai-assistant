/* =========================================================
   Geni — Frontend logic
   Kontrak API:
     POST /api/chat  body: { conversation: [{role, text}, ...], file? }
       file (opsional, sekali pakai untuk turn ini):
         { mimeType, data (base64 mentah), name }
     200 -> { result: "<jawaban AI>" }
   ========================================================= */

const form        = document.getElementById('chat-form');
const input       = document.getElementById('user-input');
const sendBtn     = document.getElementById('send-btn');
const chatBox     = document.getElementById('chat-box');
const welcome     = document.getElementById('welcome');
const toneGroup   = document.getElementById('tone');
const newChatBtn  = document.getElementById('new-chat');

// Lampiran (v2)
const attachBtn     = document.getElementById('attach-btn');
const fileInput     = document.getElementById('file-input');
const attachmentEl  = document.getElementById('attachment');
const attachThumb   = document.getElementById('attachment-thumb');
const attachName    = document.getElementById('attachment-name');
const attachRemove  = document.getElementById('attachment-remove');
const errorEl       = document.getElementById('composer-error');
const errorText     = document.getElementById('composer-error-text');

// Riwayat percakapan untuk konteks multi-turn (dikirim utuh tiap request)
let conversation = [];

// Nada tulisan aktif (formal | semi-formal | santai)
let tone = 'formal';

// Container pesan (dibuat saat pesan pertama, menggantikan welcome state)
let chatInner = null;

// Lampiran aktif: { file, mimeType, name, previewUrl } | null
let attachedFile = null;

// Filter default picker untuk tombol 📎 (semua modalitas)
const DEFAULT_ACCEPT = 'image/*,application/pdf,audio/*';
const MAX_FILE_BYTES = 14 * 1024 * 1024; // selaras dengan guard backend

/* ---------- TONE TOGGLE ---------- */
toneGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.tone-btn');
  if (!btn) return;
  tone = btn.dataset.tone;
  toneGroup.querySelectorAll('.tone-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
});

/* ---------- QUICK CHIPS (prefill teks) ----------
   Hanya chip TANPA data-accept. Chip multimodal (data-accept) ditangani terpisah
   agar handler ini tidak ikut terpicu (lihat handler chip lampiran di bawah). */
document.querySelectorAll('.chip:not([data-accept])').forEach((chip) => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.prompt || '';
    clearError();
    input.focus();
  });
});

/* ---------- CHIP LAMPIRAN (data-accept): set filter + buka picker + prefill ---------- */
document.querySelectorAll('.chip[data-accept]').forEach((chip) => {
  chip.addEventListener('click', () => {
    if (chip.dataset.prompt) input.value = chip.dataset.prompt;
    openPicker(chip.dataset.accept || DEFAULT_ACCEPT);
  });
});

/* ---------- TOMBOL LAMPIRAN 📎 ---------- */
attachBtn.addEventListener('click', () => openPicker(DEFAULT_ACCEPT));

function openPicker(accept) {
  fileInput.accept = accept || DEFAULT_ACCEPT;
  fileInput.value = '';        // reset agar memilih file yang sama tetap memicu change
  fileInput.click();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  const err = clientFileError(file);
  if (err) {
    showError(err);
    fileInput.value = '';
    return;
  }
  setAttachment(file);
});

attachRemove.addEventListener('click', clearAttachment);

/* ---------- NEW CHAT ---------- */
newChatBtn.addEventListener('click', () => {
  conversation = [];
  chatInner = null;
  chatBox.innerHTML = '';
  chatBox.appendChild(welcome);
  input.value = '';
  clearAttachment();   // jangan bawa lampiran ke sesi baru
  clearError();
  input.focus();
});

/* ---------- SUBMIT ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const typed = input.value.trim();
  // File-only diizinkan: lanjut bila ada teks ATAU ada lampiran
  if (!typed && !attachedFile) return;

  const pending = attachedFile;                 // file untuk dibaca → base64
  const fileMeta = pending
    ? { name: pending.name, icon: iconForMime(pending.mimeType) }
    : null;

  ensureChatInner();
  appendMessage('user', typed, fileMeta);       // bubble: teks + indikator file

  // Instruksi yang dikirim ke model (file-only memakai instruksi default).
  const instruction = typed || 'Tolong bantu saya dengan lampiran ini.';
  const tonePrefix = `[Gunakan nada ${tone}] `;
  conversation.push({ role: 'user', text: tonePrefix + instruction });

  input.value = '';
  clearAttachment();        // lampiran sekali pakai: bersihkan dari UI
  clearError();
  setSending(true);

  const thinkingEl = appendTyping();

  try {
    let filePayload = null;
    if (pending) {
      filePayload = {
        mimeType: pending.mimeType,
        data: await fileToBase64(pending.file),
        name: pending.name,
      };
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation, file: filePayload }),
    });

    if (!res.ok) {
      // Untuk 400 (mis. file ditolak server: magic-byte/format), tampilkan pesan ramah dari backend.
      let msg = 'Failed to get response from server.';
      if (res.status === 400) {
        try {
          const err = await res.json();
          if (err && err.message) msg = err.message;
        } catch { /* abaikan: pakai pesan default */ }
      }
      replaceTyping(thinkingEl, msg);
      return;
    }

    const data = await res.json();

    if (data && data.result) {
      replaceTyping(thinkingEl, data.result, true);
      conversation.push({ role: 'model', text: data.result });
    } else {
      replaceTyping(thinkingEl, 'Sorry, no response received.');
    }
  } catch (err) {
    replaceTyping(thinkingEl, 'Failed to get response from server.');
  } finally {
    setSending(false);
  }
});

/* ---------- LAMPIRAN: helpers ---------- */

// Validasi ringan di klien (gerbang utama tetap di server). Mengembalikan pesan error | null.
function clientFileError(file) {
  const t = (file.type || '').toLowerCase();
  const okType =
    t.startsWith('image/') ||
    t === 'application/pdf' ||
    t === 'application/x-pdf' ||
    t.startsWith('audio/');
  if (!okType) return 'Format file tidak didukung. Gunakan gambar, PDF, atau audio.';
  if (file.size > MAX_FILE_BYTES) return 'File terlalu besar. Maksimal 14 MB.';
  return null;
}

function setAttachment(file) {
  clearAttachment();   // ganti file sebelumnya → hanya satu file per pesan
  const isImage = (file.type || '').startsWith('image/');
  const previewUrl = isImage ? URL.createObjectURL(file) : null;
  attachedFile = { file, mimeType: file.type, name: file.name, previewUrl };

  attachThumb.innerHTML = '';
  if (previewUrl) {
    const img = document.createElement('img');
    img.src = previewUrl;
    img.alt = '';
    img.className = 'attachment-thumb-img';
    attachThumb.appendChild(img);
  } else {
    attachThumb.textContent = iconForMime(file.type);
  }
  attachName.textContent = file.name;
  attachmentEl.hidden = false;
  clearError();
}

function clearAttachment() {
  if (attachedFile && attachedFile.previewUrl) {
    URL.revokeObjectURL(attachedFile.previewUrl);
  }
  attachedFile = null;
  attachmentEl.hidden = true;
  attachThumb.innerHTML = '';
  attachName.textContent = '';
  fileInput.value = '';
}

function showError(msg) {
  errorText.textContent = msg;
  errorEl.hidden = false;
}
function clearError() {
  errorEl.hidden = true;
  errorText.textContent = '';
}

function iconForMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return '🖼';
  if (m.startsWith('audio/')) return '🎤';
  if (m === 'application/pdf' || m === 'application/x-pdf') return '📄';
  return '📎';
}

// Baca File -> base64 mentah (tanpa prefix data: URL).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('read error'));
    reader.readAsDataURL(file);
  });
}

/* ---------- HELPERS ---------- */

function ensureChatInner() {
  if (chatInner) return;
  if (welcome.parentNode) welcome.remove();
  chatInner = document.createElement('div');
  chatInner.className = 'chat-inner';
  chatBox.appendChild(chatInner);
}

// Tambahkan bubble pesan user / bot. fileMeta (opsional) menampilkan indikator lampiran.
function appendMessage(sender, text, fileMeta) {
  const row = document.createElement('div');
  row.className = 'row ' + sender;

  if (sender === 'bot') {
    row.appendChild(makeAvatar());
    const wrap = document.createElement('div');
    wrap.className = 'bubble-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'bubble bot';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    wrap.appendChild(makeActions(bubble));
    row.appendChild(wrap);
  } else {
    const bubble = document.createElement('div');
    bubble.className = 'bubble user';
    if (text) {
      const span = document.createElement('span');
      span.className = 'bubble-text';
      span.textContent = text;
      bubble.appendChild(span);
    }
    if (fileMeta) {
      const pill = document.createElement('div');
      pill.className = 'bubble-file';
      pill.textContent = `${fileMeta.icon} ${fileMeta.name}`;
      bubble.appendChild(pill);
    }
    row.appendChild(bubble);
  }

  chatInner.appendChild(row);
  scrollToBottom();
  return row;
}

// Placeholder "typing" (tiga titik animasi)
function appendTyping() {
  const row = document.createElement('div');
  row.className = 'row bot';
  row.appendChild(makeAvatar());
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';
  const typing = document.createElement('div');
  typing.className = 'bubble bot typing';
  typing.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  wrap.appendChild(typing);
  row.appendChild(wrap);
  chatInner.appendChild(row);
  scrollToBottom();
  return row;
}

// Ganti placeholder typing dengan jawaban final
function replaceTyping(row, text, withActions = false) {
  const wrap = row.querySelector('.bubble-wrap');
  wrap.innerHTML = '';
  const bubble = document.createElement('div');
  bubble.className = 'bubble bot';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  if (withActions) wrap.appendChild(makeActions(bubble));
  scrollToBottom();
}

function makeAvatar() {
  const a = document.createElement('div');
  a.className = 'avatar';
  a.textContent = '✦';
  return a;
}

// Baris aksi di bawah bubble bot: Salin + Tulis ulang
function makeActions(bubble) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = '⧉ Salin';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(bubble.textContent).then(() => {
      copyBtn.textContent = '✓ Disalin';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = '⧉ Salin';
        copyBtn.classList.remove('copied');
      }, 1600);
    });
  });

  const rewriteBtn = document.createElement('button');
  rewriteBtn.type = 'button';
  rewriteBtn.textContent = '↻ Tulis ulang';
  rewriteBtn.addEventListener('click', () => {
    input.value = 'Tolong tulis ulang jawaban sebelumnya dengan versi lain.';
    input.focus();
  });

  actions.appendChild(copyBtn);
  actions.appendChild(rewriteBtn);
  return actions;
}

function setSending(state) {
  sendBtn.disabled = state;
  input.disabled = state;
  attachBtn.disabled = state;
  if (!state) input.focus();
}

function scrollToBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}
