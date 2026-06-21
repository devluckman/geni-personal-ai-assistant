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
    setBotContent(bubble, text);
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
  setBotContent(bubble, text);
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
    navigator.clipboard.writeText(bubble.dataset.raw || bubble.textContent).then(() => {
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

/* ---------- MARKDOWN ----------
   Render jawaban bot (Gemini membalas dalam markdown). Aman dari XSS:
   semua teks di-escape lebih dulu, tag yang dihasilkan hanya milik renderer. */
function setBotContent(bubble, text) {
  bubble.dataset.raw = text;          // simpan teks asli untuk tombol Salin
  bubble.classList.add('md');
  bubble.innerHTML = renderMarkdown(text);
}

function renderMarkdown(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>')
      .replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/~~([^~]+?)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w_])_([^_\n]+?)_(?![\w_])/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
        /^(https?:|mailto:)/i.test(u)
          ? '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>'
          : t,
      );

  const lines = esc(String(text).replace(/\r\n/g, '\n').replace(/\t/g, '    ')).split('\n');
  let html = '';
  let para = [];
  let inFence = false;
  let fence = [];
  const stack = []; // [{ type:'ul'|'ol', indent:number }]

  const flushPara = () => {
    if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; }
  };
  const closeAll = () => { while (stack.length) html += '</li></' + stack.pop().type + '>'; };

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if (inFence) { html += '<pre><code>' + fence.join('\n') + '</code></pre>'; fence = []; inFence = false; }
      else { flushPara(); closeAll(); inFence = true; }
      continue;
    }
    if (inFence) { fence.push(raw); continue; }

    if (/^\s*$/.test(raw)) { flushPara(); continue; }

    const h = raw.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      flushPara(); closeAll();
      const lvl = Math.min(h[1].length + 2, 6);
      html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>';
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(raw)) { flushPara(); closeAll(); html += '<hr>'; continue; }

    const li = raw.match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (li) {
      flushPara();
      const indent = li[1].length;
      const type = li[2] ? 'ul' : 'ol';
      while (stack.length && stack[stack.length - 1].indent > indent) {
        html += '</li></' + stack.pop().type + '>';
      }
      const top = stack[stack.length - 1];
      if (top && top.indent === indent) {
        html += '</li>';
        if (top.type !== type) { html += '</' + stack.pop().type + '>'; html += '<' + type + '>'; stack.push({ type, indent }); }
      } else {
        html += '<' + type + '>'; stack.push({ type, indent });
      }
      html += '<li>' + inline(li[4]);
      continue;
    }

    closeAll();
    para.push(raw.trim());
  }
  flushPara();
  if (inFence) html += '<pre><code>' + fence.join('\n') + '</code></pre>';
  closeAll();
  return html;
}
