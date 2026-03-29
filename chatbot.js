/* chatbot.js — AI Investigation Assistant
   Uses WebLLM (in-browser LLM) + optional Serper.dev search via Val Town proxy
   Loaded as type="module" for ES module import support
*/

import * as webllm from 'https://esm.run/@mlc-ai/web-llm';

/* ── Config ──────────────────────────────────────────────── */

const MODEL_ID = 'SmolLM2-1.7B-Instruct-q4f16_1-MLC';
const PROXY_STORAGE_KEY = 'chat-proxy-url-v1';

const SYSTEM_PROMPT = `You are an OSINT and cryptocurrency investigation assistant. \
Analyze information about crypto wallets, transactions, people, and organizations.

When given text or search results, extract all entities and relationships.
ALWAYS respond with valid JSON in this exact format (no extra text outside the JSON):

{
  "summary": "Your analysis in plain English",
  "entities": [
    {"label": "Name or identifier", "type": "person|org|wallet|exchange|unknown", "address": "", "notes": "context"}
  ],
  "links": [
    {"from_label": "Source entity label", "to_label": "Target entity label", "amount": "", "currency": "BTC", "date": "", "txHash": "", "notes": ""}
  ]
}

Entity type rules:
- person: individual humans (e.g. "John Doe")
- org: companies, organizations, groups (e.g. "Lazarus Group", "Binance")
- wallet: crypto wallet addresses (e.g. "0x1234...", "bc1q...")
- exchange: crypto exchanges (e.g. "Coinbase", "Kraken")
- unknown: anything that does not fit above

Only include links if there is clear evidence of a transaction between two entities.
If no entities are found, return empty arrays. Always include a summary.`;

/* ── Node type colours (mirrors app.js NODE_TYPES) ────────── */

const NODE_TYPE_COLORS = {
  person:   '#58a6ff',
  org:      '#3fb950',
  wallet:   '#e3b341',
  exchange: '#f0883e',
  unknown:  '#8b949e',
};

/* ── State ───────────────────────────────────────────────── */

let engine        = null;
let engineLoading = false;
let engineReady   = false;
let chatHistory   = [];   // rolling conversation context

/* ── DOM refs (populated on init) ────────────────────────── */

let $messages, $input, $submit, $statusText,
    $settingsToggle, $settingsPanel, $proxyInput,
    $modelProgress, $progressBar, $progressText;

/* ── HTML escape (local copy so chatbot.js is self-contained) */

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Proxy URL persistence ────────────────────────────────── */

function getProxyUrl() { return localStorage.getItem(PROXY_STORAGE_KEY) || ''; }
function saveProxyUrl(url) { localStorage.setItem(PROXY_STORAGE_KEY, url.trim()); }

/* ── Web search via Val Town proxy ───────────────────────── */

async function fetchSearchResults(query) {
  const url = getProxyUrl();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Proxy returned HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : null;
  } catch (err) {
    console.warn('[chatbot] Search proxy error:', err.message);
    appendSystem(`⚠️ Search proxy error: ${esc(err.message)}`);
    return null;
  }
}

/* ── WebLLM model loading ────────────────────────────────── */

async function loadEngine() {
  if (engineReady || engineLoading) return;
  engineLoading = true;
  setStatus('Downloading AI model (~1 GB on first load, cached after)…');
  showProgress(0, 'Initializing…');

  try {
    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: ({ progress, text }) => {
        const pct = Math.round((progress || 0) * 100);
        showProgress(pct, text || `Loading… ${pct}%`);
      },
    });
    engineReady   = true;
    engineLoading = false;
    hideProgress();
    setStatus('');
    appendSystem(
      '✅ AI model ready! Ask me anything — I\'ll extract entities and links you can add to your case.\n' +
      (getProxyUrl()
        ? '🔍 Web search is enabled via your proxy.'
        : '💡 Add a <strong>Search Proxy URL</strong> in ⚙ Settings to enable live Google search.')
    );
  } catch (err) {
    engineLoading = false;
    engine = null;
    hideProgress();
    setStatus('');
    console.error('[chatbot] Engine load error:', err);
    appendSystem(`❌ Could not load AI model.\n${esc(err.message)}\n\nRefresh the page to try again.`);
  }
}

/* ── Parse structured JSON from AI response ───────────────── */

function parseStructured(text) {
  const patterns = [
    /```json\s*([\s\S]*?)```/,
    /```\s*([\s\S]*?)```/,
    /(\{[\s\S]*?"summary"[\s\S]*?\})\s*$/,
    /(\{[\s\S]*\})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[1] || m[0]);
      if (obj && typeof obj === 'object' && 'summary' in obj) {
        return {
          summary:  typeof obj.summary === 'string' ? obj.summary : text,
          entities: Array.isArray(obj.entities) ? obj.entities : [],
          links:    Array.isArray(obj.links)    ? obj.links    : [],
        };
      }
    } catch { /* try next pattern */ }
  }
  return null;
}

/* ── Case integration helpers ─────────────────────────────── */

function ensureCase() {
  if (window.activeCase?.()) return window.activeCase();
  window.createCase?.('Chat Investigation');
  window.toast?.('Created case: Chat Investigation', 'success');
  return window.activeCase?.();
}

function labelExists(label) {
  const c = window.activeCase?.();
  return c
    ? c.nodes.some(n => n.label.toLowerCase() === label.toLowerCase())
    : false;
}

function addEntityToCase(entity) {
  const c = ensureCase();
  if (!c) { window.toast?.('No active case', 'error'); return false; }
  if (labelExists(entity.label)) {
    window.toast?.(`"${entity.label}" already in case`, 'info');
    return false;
  }
  const validTypes = ['person', 'org', 'wallet', 'exchange', 'unknown'];
  window.addNode?.({
    label:   entity.label,
    type:    validTypes.includes(entity.type) ? entity.type : 'unknown',
    address: entity.address || '',
    notes:   entity.notes   || '',
    tags:    '',
  });
  return true;
}

function addAllToCase(structured) {
  ensureCase();
  let added = 0, dupes = 0;

  for (const e of structured.entities) {
    addEntityToCase(e) ? added++ : dupes++;
  }

  // Add links after all entities are present in the case
  const c = window.activeCase?.();
  if (c) {
    for (const lnk of structured.links) {
      const from = c.nodes.find(
        n => n.label.toLowerCase() === (lnk.from_label || '').toLowerCase()
      );
      const to = c.nodes.find(
        n => n.label.toLowerCase() === (lnk.to_label || '').toLowerCase()
      );
      if (from && to) {
        window.addEdge?.({
          from:     from.id,
          to:       to.id,
          amount:   lnk.amount   || '',
          currency: lnk.currency || 'BTC',
          date:     lnk.date     || '',
          txHash:   lnk.txHash   || '',
          notes:    lnk.notes    || '',
        });
      }
    }
  }

  const msg = added
    ? `Added ${added} entit${added === 1 ? 'y' : 'ies'} to case` +
      (dupes ? ` (${dupes} duplicate${dupes > 1 ? 's' : ''} skipped)` : '')
    : 'All entities already in case';
  window.toast?.(msg, added ? 'success' : 'info');
}

/* ── UI helpers ───────────────────────────────────────────── */

function setStatus(text) {
  if ($statusText) $statusText.textContent = text;
}

function showProgress(pct, text) {
  if (!$modelProgress) return;
  $modelProgress.style.display = 'block';
  if ($progressBar)  $progressBar.style.width  = Math.min(pct, 100) + '%';
  if ($progressText) $progressText.textContent = text;
}

function hideProgress() {
  if ($modelProgress) $modelProgress.style.display = 'none';
}

function scrollBottom() {
  if ($messages) $messages.scrollTop = $messages.scrollHeight;
}

function appendSystem(html) {
  if (!$messages) return;
  const el = document.createElement('div');
  el.className = 'chat-system-msg';
  el.innerHTML = html.replace(/\n/g, '<br>');
  $messages.appendChild(el);
  scrollBottom();
}

function renderMessage(role, text, structured) {
  if (!$messages) return;
  const wrap = document.createElement('div');
  wrap.className = `chat-msg chat-msg-${role}`;

  if (role === 'user') {
    wrap.innerHTML = `<div class="chat-bubble">${esc(text)}</div>`;
  } else {
    const displayText = structured ? structured.summary : text;

    /* Entity pills */
    let entitiesHtml = '';
    if (structured?.entities.length) {
      const pills = structured.entities.map(e => {
        const color = NODE_TYPE_COLORS[e.type] || NODE_TYPE_COLORS.unknown;
        return (
          `<span class="entity-pill" style="border-color:${color}"` +
          ` data-label="${esc(e.label)}" data-type="${esc(e.type || 'unknown')}"` +
          ` data-address="${esc(e.address || '')}" data-notes="${esc(e.notes || '')}">` +
          `<span class="entity-dot" style="background:${color}"></span>` +
          `${esc(e.label)}` +
          `<button class="entity-add-btn" title="Add to case">+</button>` +
          `</span>`
        );
      }).join('');
      entitiesHtml = `<div class="chat-entities">${pills}</div>`;
    }

    /* Link pills */
    let linksHtml = '';
    if (structured?.links.length) {
      const items = structured.links.map(l =>
        `<span class="link-pill">${esc(l.from_label)} → ${esc(l.to_label)}` +
        (l.amount ? ` <strong>${esc(l.amount)} ${esc(l.currency || '')}</strong>` : '') +
        `</span>`
      ).join('');
      linksHtml = `<div class="chat-links">${items}</div>`;
    }

    /* Add-all action */
    let actionsHtml = '';
    if (structured && (structured.entities.length || structured.links.length)) {
      actionsHtml =
        `<div class="chat-actions">` +
        `<button class="btn btn-success btn-sm add-all-btn">➕ Add All to Case</button>` +
        `</div>`;
    }

    wrap.innerHTML =
      `<div class="chat-bubble">` +
      `<div class="chat-summary">${esc(displayText).replace(/\n/g, '<br>')}</div>` +
      entitiesHtml + linksHtml + actionsHtml +
      `</div>`;

    /* Wire individual entity add buttons */
    wrap.querySelectorAll('.entity-add-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pill = btn.closest('.entity-pill');
        const entity = {
          label:   pill.dataset.label,
          type:    pill.dataset.type,
          address: pill.dataset.address,
          notes:   pill.dataset.notes,
        };
        if (addEntityToCase(entity)) {
          pill.classList.add('added');
          btn.textContent = '✓';
          btn.disabled = true;
        }
      });
    });

    /* Wire Add All button */
    wrap.querySelector('.add-all-btn')?.addEventListener('click', () => {
      if (structured) addAllToCase(structured);
    });
  }

  $messages.appendChild(wrap);
  scrollBottom();
}

/* ── Send message ─────────────────────────────────────────── */

async function send() {
  const text = $input?.value.trim();
  if (!text) return;

  $input.value = '';
  $input.disabled = true;
  if ($submit) $submit.disabled = true;

  renderMessage('user', text);

  /* Ensure model is loaded */
  if (!engineReady) {
    setStatus('Loading model…');
    await loadEngine();
    if (!engineReady) {
      $input.disabled = false;
      if ($submit) $submit.disabled = false;
      return;
    }
  }

  /* Optional web search */
  let searchCtx = '';
  if (getProxyUrl()) {
    setStatus('🔍 Searching the web…');
    const results = await fetchSearchResults(text);
    if (results?.length) {
      searchCtx =
        '\n\nRelevant web search results:\n' +
        results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
    }
  }

  setStatus('🤔 Thinking…');

  const userContent = text + searchCtx;
  chatHistory.push({ role: 'user', content: userContent });

  try {
    const completion = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...chatHistory.slice(-8),
      ],
      temperature: 0.2,
      max_tokens: 1024,
    });

    const reply = completion.choices[0].message.content;
    chatHistory.push({ role: 'assistant', content: reply });

    const structured = parseStructured(reply);
    renderMessage('assistant', reply, structured);
  } catch (err) {
    console.error('[chatbot] Completion error:', err);
    appendSystem(`❌ ${esc(err.message)}`);
  }

  setStatus('');
  $input.disabled = false;
  if ($submit) $submit.disabled = false;
  $input?.focus();
}

/* ── Initialise ───────────────────────────────────────────── */

function init() {
  $messages       = document.getElementById('chat-messages');
  $input          = document.getElementById('chat-input');
  $submit         = document.getElementById('chat-submit');
  $statusText     = document.getElementById('chat-status-text');
  $settingsToggle = document.getElementById('chat-settings-toggle');
  $settingsPanel  = document.getElementById('chat-settings-panel');
  $proxyInput     = document.getElementById('chat-proxy-url');
  $modelProgress  = document.getElementById('model-progress');
  $progressBar    = document.getElementById('model-progress-bar');
  $progressText   = document.getElementById('model-progress-text');

  if (!$messages) return;  // Chat tab not present

  /* Restore saved proxy URL */
  if ($proxyInput) $proxyInput.value = getProxyUrl();

  /* Settings toggle */
  $settingsToggle?.addEventListener('click', () => {
    const isNowHidden = $settingsPanel?.classList.toggle('hidden');
    if ($settingsToggle) {
      $settingsToggle.textContent = isNowHidden ? '⚙ Settings' : '✕ Close';
    }
  });

  /* Save proxy URL on blur */
  $proxyInput?.addEventListener('blur', () => {
    saveProxyUrl($proxyInput.value);
    if ($proxyInput.value.trim()) {
      window.toast?.('Search proxy URL saved', 'success');
    }
  });

  /* Submit */
  $submit?.addEventListener('click', send);
  $input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  /* Welcome message */
  appendSystem(
    '<strong>👋 AI Investigation Assistant</strong><br>' +
    'Analyse crypto transactions, extract wallets, people and organisations, and add them to your case graph.<br><br>' +
    '📥 <em>First use downloads the AI model (~1 GB). It is cached in your browser afterwards.</em>'
  );

  /* Start loading model the first time the Chat tab is opened */
  document.querySelector('[data-tab="chat"]')?.addEventListener('click', () => {
    if (!engineReady && !engineLoading) loadEngine();
  }, { once: true });
}

/* Run after DOM is ready (ES modules are deferred, but DOMContentLoaded
   may have already fired by the time this module executes) */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
