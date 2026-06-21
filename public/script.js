/* =========================================================
   Geni — Frontend logic
   Kontrak API:
     POST /api/chat  body: { conversation: [{role, text}, ...] }
     200 -> { result: "<jawaban AI>" }
   ========================================================= */

const form        = document.getElementById('chat-form');
const input       = document.getElementById('user-input');
const sendBtn     = document.getElementById('send-btn');
const chatBox     = document.getElementById('chat-box');
const welcome     = document.getElementById('welcome');
const toneGroup   = document.getElementById('tone');
const newChatBtn  = document.getElementById('new-chat');

// Riwayat percakapan untuk konteks multi-turn (dikirim utuh tiap request)
let conversation = [];

// Nada tulisan aktif (formal | semi-formal | santai)
let tone = 'formal';

// Container pesan (dibuat saat pesan pertama, menggantikan welcome state)
let chatInner = null;

/* ---------- TONE TOGGLE ---------- */
toneGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.tone-btn');
  if (!btn) return;
  tone = btn.dataset.tone;
  toneGroup.querySelectorAll('.tone-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
});

/* ---------- QUICK CHIPS (welcome + composer) ---------- */
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.prompt || '';
    input.focus();
  });
});

/* ---------- NEW CHAT ---------- */
newChatBtn.addEventListener('click', () => {
  conversation = [];
  chatInner = null;
  chatBox.innerHTML = '';
  chatBox.appendChild(welcome);
  input.value = '';
  input.focus();
});

/* ---------- SUBMIT ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const userMessage = input.value.trim();
  if (!userMessage) return;

  ensureChatInner();              // buang welcome state pada pesan pertama
  appendMessage('user', userMessage);

  // Sisipkan instruksi nada secara halus ke teks yang DIKIRIM ke backend,
  // tanpa mengubah bubble yang ditampilkan ke user.
  const tonePrefix = `[Gunakan nada ${tone}] `;
  conversation.push({ role: 'user', text: tonePrefix + userMessage });

  input.value = '';
  setSending(true);

  const thinkingEl = appendTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation }),
    });

    if (!res.ok) {
      replaceTyping(thinkingEl, 'Failed to get response from server.');
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

/* ---------- HELPERS ---------- */

function ensureChatInner() {
  if (chatInner) return;
  if (welcome.parentNode) welcome.remove();
  chatInner = document.createElement('div');
  chatInner.className = 'chat-inner';
  chatBox.appendChild(chatInner);
}

// Tambahkan bubble pesan user / bot
function appendMessage(sender, text) {
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
    bubble.textContent = text;
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
  if (!state) input.focus();
}

function scrollToBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}
