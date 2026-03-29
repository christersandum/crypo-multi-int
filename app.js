/* ============================================================
   Crypto Transaction Investigator – app.js
   ============================================================ */

'use strict';

/* ── Constants & helpers ─────────────────────────────────── */

const NODE_TYPES = {
  person:   { label: 'Person',       color: '#58a6ff', shape: 'ellipse' },
  org:      { label: 'Organization', color: '#3fb950', shape: 'box' },
  wallet:   { label: 'Wallet',       color: '#e3b341', shape: 'hexagon' },
  exchange: { label: 'Exchange',     color: '#f0883e', shape: 'diamond' },
  unknown:  { label: 'Unknown',      color: '#8b949e', shape: 'dot' },
};

const CURRENCIES = ['BTC', 'ETH', 'USDT', 'USDC', 'XMR', 'LTC', 'BNB', 'SOL', 'TRX', 'Other'];

const EXPLORER_URLS = {
  BTC:  'https://www.blockchain.com/explorer/transactions/btc/',
  ETH:  'https://etherscan.io/tx/',
  USDT: 'https://etherscan.io/tx/',
  USDC: 'https://etherscan.io/tx/',
  LTC:  'https://blockchair.com/litecoin/transaction/',
  BNB:  'https://bscscan.com/tx/',
  SOL:  'https://solscan.io/tx/',
  TRX:  'https://tronscan.org/#/transaction/',
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function formatAmount(amount, currency) {
  const n = parseFloat(amount);
  if (isNaN(n)) return `? ${currency}`;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${currency}`;
}

function shortHash(hash) {
  if (!hash) return '';
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function explorerUrl(txHash, currency) {
  const base = EXPLORER_URLS[currency] || 'https://www.blockchain.com/search?search=';
  return base + txHash;
}

/* ── State ───────────────────────────────────────────────── */

let state = {
  cases: {},          // { [caseId]: { id, name, nodes: [], edges: [] } }
  activeCaseId: null,
};

let network = null;   // vis.Network instance
let visNodes = null;  // vis.DataSet
let visEdges = null;  // vis.DataSet

let selectedNodeId  = null;
let selectedEdgeId  = null;

/* ── Persistence ─────────────────────────────────────────── */

const STORAGE_KEY = 'crypto-investigator-v1';

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('localStorage save failed', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('localStorage load failed', e);
  }
  if (!state.cases || typeof state.cases !== 'object') {
    state.cases = {};
    state.activeCaseId = null;
  }
}

/* ── Active case helpers ─────────────────────────────────── */

function activeCase() {
  return state.cases[state.activeCaseId] || null;
}

function getNode(id) {
  const c = activeCase();
  return c ? c.nodes.find(n => n.id === id) : null;
}

function getEdge(id) {
  const c = activeCase();
  return c ? c.edges.find(e => e.id === id) : null;
}

/* ── Case management ─────────────────────────────────────── */

function createCase(name) {
  const id = uid();
  state.cases[id] = { id, name: name || 'New Case', nodes: [], edges: [] };
  state.activeCaseId = id;
  saveState();
  renderAll();
  toast(`Case "${state.cases[id].name}" created`, 'success');
  return id;
}

function switchCase(id) {
  if (!state.cases[id]) return;
  state.activeCaseId = id;
  selectedNodeId = null;
  selectedEdgeId = null;
  saveState();
  renderAll();
}

function deleteCase(id) {
  if (!state.cases[id]) return;
  const name = state.cases[id].name;
  delete state.cases[id];
  if (state.activeCaseId === id) {
    const remaining = Object.keys(state.cases);
    state.activeCaseId = remaining.length ? remaining[0] : null;
  }
  saveState();
  renderAll();
  toast(`Case "${name}" deleted`, 'info');
}

function renameCase(id, newName) {
  if (!state.cases[id]) return;
  state.cases[id].name = newName.trim() || state.cases[id].name;
  saveState();
  renderAll();
}

/* ── Node management ─────────────────────────────────────── */

function addNode(data) {
  const c = activeCase();
  if (!c) return toast('Create a case first', 'error');
  const node = {
    id:    uid(),
    label: data.label.trim(),
    type:  data.type || 'unknown',
    notes: data.notes || '',
    tags:  data.tags  || '',
    address: data.address || '',
  };
  c.nodes.push(node);
  saveState();
  refreshGraph();
  refreshNodeList();
  updateStats();
  toast(`Node "${node.label}" added`, 'success');
  return node.id;
}

function updateNode(id, data) {
  const node = getNode(id);
  if (!node) return;
  Object.assign(node, data);
  saveState();
  refreshGraph();
  refreshNodeList();
  showNodeDetail(id);
}

function deleteNode(id) {
  const c = activeCase();
  if (!c) return;
  c.nodes = c.nodes.filter(n => n.id !== id);
  c.edges = c.edges.filter(e => e.from !== id && e.to !== id);
  if (selectedNodeId === id) {
    selectedNodeId = null;
    showEmptyDetail();
  }
  saveState();
  refreshGraph();
  refreshNodeList();
  updateStats();
  toast('Node deleted', 'info');
}

/* ── Edge / transaction management ──────────────────────── */

function addEdge(data) {
  const c = activeCase();
  if (!c) return toast('Create a case first', 'error');
  if (!data.from || !data.to) return toast('Select sender and receiver', 'error');
  if (data.from === data.to) return toast('Sender and receiver must differ', 'error');
  const edge = {
    id:       uid(),
    from:     data.from,
    to:       data.to,
    amount:   data.amount   || '',
    currency: data.currency || 'BTC',
    date:     data.date     || '',
    txHash:   data.txHash   || '',
    notes:    data.notes    || '',
  };
  c.edges.push(edge);
  saveState();
  refreshGraph();
  updateStats();
  toast('Transaction added', 'success');
  return edge.id;
}

function updateEdge(id, data) {
  const edge = getEdge(id);
  if (!edge) return;
  Object.assign(edge, data);
  saveState();
  refreshGraph();
  showEdgeDetail(id);
}

function deleteEdge(id) {
  const c = activeCase();
  if (!c) return;
  c.edges = c.edges.filter(e => e.id !== id);
  if (selectedEdgeId === id) {
    selectedEdgeId = null;
    showEmptyDetail();
  }
  saveState();
  refreshGraph();
  updateStats();
  toast('Transaction deleted', 'info');
}

/* ── vis.js graph ────────────────────────────────────────── */

function buildVisNode(node) {
  const t = NODE_TYPES[node.type] || NODE_TYPES.unknown;
  const label = node.label + (node.address ? `\n${node.address.slice(0, 10)}…` : '');
  return {
    id:    node.id,
    label,
    color: {
      background: t.color + '33',
      border:     t.color,
      highlight:  { background: t.color + '66', border: t.color },
      hover:      { background: t.color + '44', border: t.color },
    },
    font:  { color: '#e6edf3', size: 11, face: 'Segoe UI,system-ui,sans-serif' },
    shape: t.shape,
    borderWidth: 2,
  };
}

function buildVisEdge(edge) {
  const label = edge.amount
    ? `${formatAmount(edge.amount, edge.currency)}${edge.date ? '\n' + edge.date : ''}`
    : (edge.date || '');
  return {
    id:    edge.id,
    from:  edge.from,
    to:    edge.to,
    label,
    arrows: { to: { enabled: true, scaleFactor: 0.7 } },
    color:  { color: '#58a6ff66', highlight: '#58a6ff', hover: '#79c0ff' },
    font:   { color: '#8b949e', size: 10, align: 'middle', face: 'Segoe UI,system-ui,sans-serif' },
    smooth: { type: 'dynamic' },
    width:  1.5,
  };
}

function initNetwork() {
  const container = document.getElementById('network-canvas');
  visNodes = new vis.DataSet();
  visEdges = new vis.DataSet();

  const options = {
    physics: {
      enabled: true,
      barnesHut: {
        gravitationalConstant: -8000,
        centralGravity: 0.3,
        springLength: 160,
        springConstant: 0.04,
        damping: 0.09,
      },
    },
    interaction: {
      hover: true,
      tooltipDelay: 200,
      zoomView: true,
      dragView: true,
    },
    nodes: {
      size: 24,
      borderWidth: 2,
    },
    edges: {
      width: 1.5,
      selectionWidth: 2.5,
    },
    layout: {
      improvedLayout: true,
    },
  };

  network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, options);

  network.on('click', function (params) {
    if (params.nodes.length > 0) {
      selectedNodeId = params.nodes[0];
      selectedEdgeId = null;
      showNodeDetail(selectedNodeId);
      highlightNodeInList(selectedNodeId);
    } else if (params.edges.length > 0) {
      selectedEdgeId = params.edges[0];
      selectedNodeId = null;
      showEdgeDetail(selectedEdgeId);
    } else {
      selectedNodeId = null;
      selectedEdgeId = null;
      showEmptyDetail();
    }
  });

  network.on('doubleClick', function (params) {
    if (params.nodes.length > 0) {
      openEditNodeModal(params.nodes[0]);
    } else if (params.edges.length > 0) {
      openEditEdgeModal(params.edges[0]);
    }
  });
}

function refreshGraph() {
  const c = activeCase();
  const empty = !c || (c.nodes.length === 0 && c.edges.length === 0);
  document.getElementById('graph-empty-msg').classList.toggle('hidden', !empty);

  if (!visNodes) return;

  const nodeIds = visNodes.getIds();
  const edgeIds = visEdges.getIds();

  if (c) {
    const newNodeIds = c.nodes.map(n => n.id);
    const newEdgeIds = c.edges.map(e => e.id);

    // Remove stale
    nodeIds.filter(id => !newNodeIds.includes(id)).forEach(id => visNodes.remove(id));
    edgeIds.filter(id => !newEdgeIds.includes(id)).forEach(id => visEdges.remove(id));

    // Add or update nodes
    c.nodes.forEach(node => {
      const vn = buildVisNode(node);
      if (visNodes.get(node.id)) visNodes.update(vn);
      else visNodes.add(vn);
    });

    // Add or update edges
    c.edges.forEach(edge => {
      const ve = buildVisEdge(edge);
      if (visEdges.get(edge.id)) visEdges.update(ve);
      else visEdges.add(ve);
    });
  } else {
    visNodes.clear();
    visEdges.clear();
  }
}

/* ── Node list (sidebar) ─────────────────────────────────── */

function refreshNodeList() {
  const c = activeCase();
  const listEl = document.getElementById('node-list');
  listEl.innerHTML = '';

  if (!c || c.nodes.length === 0) {
    listEl.innerHTML = '<div style="color:var(--text-faint);font-size:12px;padding:8px 0;">No nodes yet</div>';
    return;
  }

  const query = (document.getElementById('node-search')?.value || '').toLowerCase();
  const filtered = query
    ? c.nodes.filter(n => n.label.toLowerCase().includes(query) || (n.address && n.address.toLowerCase().includes(query)))
    : c.nodes;

  filtered.forEach(node => {
    const t = NODE_TYPES[node.type] || NODE_TYPES.unknown;
    const item = document.createElement('div');
    item.className = 'node-item' + (node.id === selectedNodeId ? ' selected' : '');
    item.dataset.id = node.id;
    item.innerHTML = `
      <div class="node-dot" style="background:${t.color}"></div>
      <div class="node-item-label">${escHtml(node.label)}</div>
      <div class="node-item-type">${t.label.slice(0, 4)}</div>
      <button class="node-item-del" title="Delete node" data-id="${node.id}">×</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('node-item-del')) return;
      selectedNodeId = node.id;
      showNodeDetail(node.id);
      highlightNodeInList(node.id);
      network && network.selectNodes([node.id]);
      network && network.focus(node.id, { animation: true, scale: 1.2 });
    });
    item.querySelector('.node-item-del').addEventListener('click', () => {
      if (confirm(`Delete node "${node.label}"?`)) deleteNode(node.id);
    });
    listEl.appendChild(item);
  });

  // Keep the sidebar quick-edge dropdowns in sync
  if (typeof refreshQuickEdgeSelects === 'function') refreshQuickEdgeSelects();
}

function highlightNodeInList(id) {
  document.querySelectorAll('.node-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
}

/* ── Detail panel ────────────────────────────────────────── */

function showEmptyDetail() {
  document.getElementById('detail-header').querySelector('h3').textContent = 'Details';
  document.getElementById('detail-body').innerHTML =
    '<div class="detail-placeholder">Click a node or transaction to see details</div>';
}

function showNodeDetail(id) {
  const node = getNode(id);
  if (!node) return showEmptyDetail();
  const c = activeCase();
  const t = NODE_TYPES[node.type] || NODE_TYPES.unknown;

  // Transactions involving this node
  const outgoing = c.edges.filter(e => e.from === id);
  const incoming = c.edges.filter(e => e.to === id);

  const header = document.getElementById('detail-header').querySelector('h3');
  header.textContent = 'Node Details';

  let html = `
    <div class="detail-type-badge" style="background:${t.color}22;color:${t.color};border:1px solid ${t.color}44">${t.label}</div>
    <div class="detail-name">${escHtml(node.label)}</div>
  `;

  if (node.address) html += detailRow('Address', node.address);
  if (node.notes)   html += detailRow('Notes',   node.notes);
  if (node.tags)    html += detailRow('Tags',     node.tags);

  if (outgoing.length) {
    html += `<div class="detail-section-title">Outgoing Transactions (${outgoing.length})</div>`;
    outgoing.forEach(e => { html += txItem(e, 'out', c); });
  }

  if (incoming.length) {
    html += `<div class="detail-section-title">Incoming Transactions (${incoming.length})</div>`;
    incoming.forEach(e => { html += txItem(e, 'in', c); });
  }

  html += `
    <div class="detail-actions">
      <button class="btn btn-block" onclick="openEditNodeModal('${node.id}')">✏️ Edit Node</button>
      <button class="btn btn-danger btn-block" onclick="if(confirm('Delete this node?')) deleteNode('${node.id}')">🗑️ Delete Node</button>
    </div>
  `;

  document.getElementById('detail-body').innerHTML = html;
}

function showEdgeDetail(id) {
  const edge = getEdge(id);
  if (!edge) return showEmptyDetail();
  const c = activeCase();
  const fromNode = c.nodes.find(n => n.id === edge.from);
  const toNode   = c.nodes.find(n => n.id === edge.to);

  document.getElementById('detail-header').querySelector('h3').textContent = 'Transaction Details';

  let html = `
    <div class="detail-type-badge" style="background:#58a6ff22;color:#58a6ff;border:1px solid #58a6ff44">Transaction</div>
    <div class="detail-name" style="color:var(--accent-orange)">${formatAmount(edge.amount, edge.currency)}</div>
  `;

  html += detailRow('From', fromNode ? fromNode.label : edge.from);
  html += detailRow('To',   toNode   ? toNode.label   : edge.to);
  if (edge.date)   html += detailRow('Date',    edge.date);
  if (edge.txHash) {
    const url = explorerUrl(edge.txHash, edge.currency);
    html += detailRow('Tx Hash', `<a href="${url}" target="_blank" rel="noopener">${escHtml(edge.txHash)}</a>`);
  }
  if (edge.notes)  html += detailRow('Notes',   edge.notes);

  html += `
    <div class="detail-actions">
      <button class="btn btn-block" onclick="openEditEdgeModal('${edge.id}')">✏️ Edit Transaction</button>
      <button class="btn btn-danger btn-block" onclick="if(confirm('Delete this transaction?')) deleteEdge('${edge.id}')">🗑️ Delete Transaction</button>
    </div>
  `;

  document.getElementById('detail-body').innerHTML = html;
}

function txItem(edge, direction, c) {
  const other = direction === 'out'
    ? c.nodes.find(n => n.id === edge.to)
    : c.nodes.find(n => n.id === edge.from);
  const otherLabel = other ? other.label : '?';
  const arrowHtml  = direction === 'out'
    ? `→ <strong>${escHtml(otherLabel)}</strong>`
    : `← <strong>${escHtml(otherLabel)}</strong>`;
  return `
    <div class="detail-tx-item">
      <div class="tx-arrow">${arrowHtml}</div>
      <div class="detail-tx-amount">${formatAmount(edge.amount, edge.currency)}</div>
      ${edge.date ? `<div style="color:var(--text-muted);font-size:10px">${escHtml(edge.date)}</div>` : ''}
    </div>
  `;
}

function detailRow(label, value) {
  return `<div class="detail-row">
    <div class="detail-row-label">${escHtml(label)}</div>
    <div class="detail-row-value">${value}</div>
  </div>`;
}

/* ── Stats ───────────────────────────────────────────────── */

function updateStats() {
  const c = activeCase();
  document.getElementById('stat-nodes').textContent = c ? c.nodes.length : 0;
  document.getElementById('stat-edges').textContent = c ? c.edges.length : 0;
}

/* ── Case list (cases tab) ───────────────────────────────── */

function refreshCaseList() {
  const listEl = document.getElementById('case-list');
  listEl.innerHTML = '';
  const ids = Object.keys(state.cases);
  if (ids.length === 0) {
    listEl.innerHTML = '<div style="color:var(--text-faint);font-size:12px;padding:8px 0;">No cases yet</div>';
    return;
  }
  ids.forEach(id => {
    const c = state.cases[id];
    const item = document.createElement('div');
    item.className = 'case-item' + (id === state.activeCaseId ? ' active' : '');
    item.innerHTML = `
      <div class="case-item-name">${escHtml(c.name)}</div>
      <div class="case-item-meta">${c.nodes.length}N / ${c.edges.length}T</div>
      <button class="case-item-del" title="Delete case" data-id="${id}">×</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('case-item-del')) return;
      switchCase(id);
    });
    item.querySelector('.case-item-del').addEventListener('click', () => {
      if (confirm(`Delete case "${c.name}"? This cannot be undone.`)) deleteCase(id);
    });
    listEl.appendChild(item);
  });
}

/* ── Render all ──────────────────────────────────────────── */

function renderAll() {
  const c = activeCase();
  document.getElementById('case-name-display').textContent = c ? c.name : '—';
  refreshGraph();
  refreshNodeList();
  refreshCaseList();
  updateStats();
  showEmptyDetail();
}

/* ── Modals ──────────────────────────────────────────────── */

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/* Add Node modal */
function openAddNodeModal() {
  if (!activeCase()) return toast('Create a case first', 'error');
  document.getElementById('node-form').reset();
  openModal('node-modal');
}

/* Edit Node modal */
function openEditNodeModal(id) {
  const node = getNode(id);
  if (!node) return;
  const f = document.getElementById('node-form');
  f.reset();
  f['node-label'].value   = node.label;
  f['node-type'].value    = node.type;
  f['node-address'].value = node.address || '';
  f['node-notes'].value   = node.notes   || '';
  f['node-tags'].value    = node.tags    || '';
  document.getElementById('node-modal').dataset.editId = id;
  openModal('node-modal');
}

/* Add Transaction modal */
function openAddEdgeModal() {
  if (!activeCase()) return toast('Create a case first', 'error');
  const c = activeCase();
  if (c.nodes.length < 2) return toast('Add at least 2 nodes first', 'error');
  populateNodeSelects();
  document.getElementById('edge-form').reset();
  delete document.getElementById('edge-modal').dataset.editId;
  // Pre-select currently selected node
  if (selectedNodeId) {
    document.getElementById('edge-from').value = selectedNodeId;
  }
  openModal('edge-modal');
}

/* Edit Transaction modal */
function openEditEdgeModal(id) {
  const edge = getEdge(id);
  if (!edge) return;
  populateNodeSelects();
  const f = document.getElementById('edge-form');
  f['edge-from'].value     = edge.from;
  f['edge-to'].value       = edge.to;
  f['edge-amount'].value   = edge.amount   || '';
  f['edge-currency'].value = edge.currency || 'BTC';
  f['edge-date'].value     = edge.date     || '';
  f['edge-txhash'].value   = edge.txHash   || '';
  f['edge-notes'].value    = edge.notes    || '';
  document.getElementById('edge-modal').dataset.editId = id;
  openModal('edge-modal');
}

function populateNodeSelects() {
  const c = activeCase();
  const opts = c ? c.nodes.map(n => `<option value="${n.id}">${escHtml(n.label)}</option>`).join('') : '';
  ['edge-from', 'edge-to'].forEach(sel => {
    document.getElementById(sel).innerHTML = `<option value="">— Select —</option>` + opts;
  });
}

/* New case modal */
function openNewCaseModal() {
  document.getElementById('new-case-name').value = '';
  openModal('new-case-modal');
}

/* Rename case */
function openRenameCaseModal() {
  if (!activeCase()) return;
  document.getElementById('rename-case-name').value = activeCase().name;
  openModal('rename-modal');
}

/* ── Search ──────────────────────────────────────────────── */

function handleSearch(query) {
  const q = query.toLowerCase();
  const c = activeCase();
  if (!c || !q) {
    if (network) network.unselectAll();
    refreshNodeList();
    return;
  }
  const matched = c.nodes
    .filter(n => n.label.toLowerCase().includes(q) || (n.address && n.address.toLowerCase().includes(q)))
    .map(n => n.id);

  if (network) network.selectNodes(matched);
  refreshNodeList();

  if (matched.length === 1) {
    network && network.focus(matched[0], { animation: true, scale: 1.2 });
  } else if (matched.length > 1) {
    network && network.fit({ nodes: matched, animation: true });
  }
}

/* ── Import / Export ─────────────────────────────────────── */

function exportCase() {
  const c = activeCase();
  if (!c) return toast('No active case', 'error');
  const json = JSON.stringify(c, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${c.name.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Case exported', 'success');
}

function exportAllCases() {
  const json = JSON.stringify(state.cases, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'all_cases.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('All cases exported', 'success');
}

function importCase(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      // Support importing a single case or a cases object
      const toImport = Array.isArray(data) ? data
        : data.nodes && data.edges ? [data]
        : Object.values(data);

      toImport.forEach(c => {
        const id = c.id || uid();
        state.cases[id] = { ...c, id };
        state.activeCaseId = id;
      });
      saveState();
      renderAll();
      toast(`Imported ${toImport.length} case(s)`, 'success');
    } catch (err) {
      toast('Import failed: invalid JSON', 'error');
    }
  };
  reader.readAsText(file);
}

/* ── Load sample data ────────────────────────────────────── */

function loadSampleData() {
  if (!activeCase()) createCase('Sample Investigation');
  const c = activeCase();
  if (c.nodes.length > 0) {
    if (!confirm('This will add sample data to the current case. Continue?')) return;
  }

  // Sample nodes
  const nodes = [
    { label: 'Alice Smith',       type: 'person',   notes: 'Primary suspect',   address: '' },
    { label: 'Bob Johnson',       type: 'person',   notes: 'Known associate',   address: '' },
    { label: 'Dark Market LLC',   type: 'org',      notes: 'Shell company',     address: '' },
    { label: 'Binance',           type: 'exchange', notes: 'Major exchange',    address: '' },
    { label: 'Kraken',            type: 'exchange', notes: 'EU exchange',       address: '' },
    { label: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', type: 'wallet', address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', notes: 'Genesis wallet' },
    { label: 'bc1qxy2kgd…f7a8',  type: 'wallet',   address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', notes: 'Mixer output' },
    { label: '0xd8dA6BF…6045',   type: 'wallet',   address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', notes: 'ETH wallet' },
  ];

  const nodeIds = nodes.map(n => addNode(n));

  // Sample edges (transactions)
  const edges = [
    { from: nodeIds[0], to: nodeIds[5],   amount: '2.5',    currency: 'BTC',  date: '2024-01-15', txHash: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890' },
    { from: nodeIds[5], to: nodeIds[6],   amount: '2.48',   currency: 'BTC',  date: '2024-01-16', txHash: 'b2c3d4e5f67890ab1234567890abcdef1234567890abcdef1234567890abcdef' },
    { from: nodeIds[6], to: nodeIds[3],   amount: '2.45',   currency: 'BTC',  date: '2024-01-18', txHash: 'c3d4e5f67890abc1234567890abcdef1234567890abcdef1234567890abcdef12' },
    { from: nodeIds[1], to: nodeIds[7],   amount: '10.0',   currency: 'ETH',  date: '2024-01-20', txHash: 'd4e5f67890abcd1234567890abcdef1234567890abcdef1234567890abcdef123' },
    { from: nodeIds[7], to: nodeIds[4],   amount: '9.9',    currency: 'ETH',  date: '2024-01-21', txHash: 'e5f67890abcde1234567890abcdef1234567890abcdef1234567890abcdef1234' },
    { from: nodeIds[2], to: nodeIds[5],   amount: '5.0',    currency: 'BTC',  date: '2024-02-01', txHash: 'f67890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345' },
    { from: nodeIds[0], to: nodeIds[2],   amount: '50000',  currency: 'USDT', date: '2024-02-10', notes: 'Wire via shell company' },
    { from: nodeIds[1], to: nodeIds[2],   amount: '30000',  currency: 'USDT', date: '2024-02-15', notes: 'Layering step' },
  ];

  edges.forEach(e => addEdge(e));

  network && network.fit({ animation: true });
  toast('Sample case loaded!', 'success');
}

/* ── Utility ─────────────────────────────────────────────── */

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Wire up forms & buttons ─────────────────────────────── */

function initUI() {
  /* Tab switching */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === target));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.toggle('active', tc.id === `tab-${target}`));
    });
  });

  /* Search box (topbar) */
  document.getElementById('search-box').addEventListener('input', e => handleSearch(e.target.value));

  /* Node search (sidebar) */
  document.getElementById('node-search')?.addEventListener('input', e => {
    handleSearch(e.target.value);
  });

  /* Node form submit */
  document.getElementById('node-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const editId = document.getElementById('node-modal').dataset.editId;
    const data = {
      label:   f['node-label'].value.trim(),
      type:    f['node-type'].value,
      address: f['node-address'].value.trim(),
      notes:   f['node-notes'].value.trim(),
      tags:    f['node-tags'].value.trim(),
    };
    if (!data.label) return toast('Label is required', 'error');
    if (editId) {
      updateNode(editId, data);
      delete document.getElementById('node-modal').dataset.editId;
      toast('Node updated', 'success');
    } else {
      addNode(data);
    }
    closeModal('node-modal');
  });

  /* Edge form submit */
  document.getElementById('edge-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const editId = document.getElementById('edge-modal').dataset.editId;
    const data = {
      from:     f['edge-from'].value,
      to:       f['edge-to'].value,
      amount:   f['edge-amount'].value.trim(),
      currency: f['edge-currency'].value,
      date:     f['edge-date'].value,
      txHash:   f['edge-txhash'].value.trim(),
      notes:    f['edge-notes'].value.trim(),
    };
    if (editId) {
      updateEdge(editId, data);
      delete document.getElementById('edge-modal').dataset.editId;
    } else {
      addEdge(data);
    }
    closeModal('edge-modal');
  });

  /* New case form */
  document.getElementById('new-case-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('new-case-name').value.trim() || 'New Case';
    createCase(name);
    closeModal('new-case-modal');
    // Switch to graph tab
    document.querySelector('[data-tab="graph"]').click();
  });

  /* Rename case form */
  document.getElementById('rename-case-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('rename-case-name').value.trim();
    if (name) renameCase(state.activeCaseId, name);
    closeModal('rename-modal');
    renderAll();
  });

  /* Case name click → rename */
  document.getElementById('case-name-display').addEventListener('click', () => {
    if (activeCase()) openRenameCaseModal();
  });

  /* Import file input */
  document.getElementById('import-input').addEventListener('change', e => {
    if (e.target.files[0]) {
      importCase(e.target.files[0]);
      e.target.value = '';
    }
  });

  /* Graph toolbar: fit, physics toggle */
  document.getElementById('btn-fit').addEventListener('click', () => {
    network && network.fit({ animation: true });
  });

  let physicsOn = true;
  document.getElementById('btn-physics').addEventListener('click', function () {
    physicsOn = !physicsOn;
    network && network.setOptions({ physics: { enabled: physicsOn } });
    this.textContent = physicsOn ? '⏸ Physics' : '▶ Physics';
  });

  /* Close modals on backdrop click */
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => {
      if (e.target === bd) bd.classList.add('hidden');
    });
  });

  /* Escape to close modals */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(bd => bd.classList.add('hidden'));
    }
  });
}

/* ── Boot ────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initNetwork();
  initUI();

  // Activate first case or show welcome
  if (!state.activeCaseId && Object.keys(state.cases).length === 0) {
    // No cases at all – show empty state
  } else if (!state.activeCaseId) {
    state.activeCaseId = Object.keys(state.cases)[0];
  }

  renderAll();

  // Activate graph tab by default
  document.querySelector('[data-tab="graph"]').click();
});
