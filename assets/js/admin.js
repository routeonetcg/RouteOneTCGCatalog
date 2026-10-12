import {
  GAMES,
  clone,
  escapeHtml,
  formatDate,
  formatMoney,
  gradeLabel,
  idb,
  loadDraft,
  loadLocalImages,
  loadPublishedCatalog,
  normalizeCard,
  normalizeCatalog,
  normalizeSettings,
  placeholderArt,
  setLine,
  uid,
} from './common.js';
import * as gh from './github.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  /** { cards, settings, base: { publishedAt, cards, settings } } */
  draft: null,
  /** photo path -> data URL, mirrored in IndexedDB */
  images: new Map(),
  gh: gh.loadConfig(),
  inv: { q: '', status: 'all', sort: 'updated' },
  editing: null,
  busy: false,
};

const COMMON_RARITIES = [
  'Common', 'Uncommon', 'Rare', 'Holo Rare', 'Reverse Holo', 'Ultra Rare', 'Secret Rare', 'Illustration Rare',
  'Special Illustration Rare', 'Hyper Rare', 'Mythic', 'Promo', 'Enchanted', 'Legendary', 'Super Rare', 'Starlight Rare',
];

const ICONS = {
  star: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"><path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

// ------------------------------------------------------------------ helpers

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

const canon = (v) => (v === undefined ? undefined : JSON.stringify(sortKeys(v)));
const byId = (cards) => new Map(cards.map((c) => [c.id, c]));
const isNewer = (a, b) => Boolean(a) && (!b || a > b);
const now = () => new Date().toISOString();
const money = (v) => formatMoney(v, state.draft.settings.currency);

function imgSrc(path) {
  return state.editing?.pending.get(path) || state.images.get(path) || path;
}

function cardImage(card) {
  return card.images[0] ? imgSrc(card.images[0]) : placeholderArt(card);
}

let toastTimer;
function toast(message, ms = 2800) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), ms);
}

function confirmDialog(title, text, okLabel = 'Confirm') {
  const dlg = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = okLabel;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// -------------------------------------------------------- change tracking

function changes() {
  const { cards, settings, base } = state.draft;
  const baseMap = new Map(base.cards.map((c) => [c.id, canon(c)]));
  const ids = new Set(cards.map((c) => c.id));
  const changed = new Set();
  let added = 0;
  let edited = 0;
  for (const c of cards) {
    const b = baseMap.get(c.id);
    if (!b) {
      added += 1;
      changed.add(c.id);
    } else if (b !== canon(c)) {
      edited += 1;
      changed.add(c.id);
    }
  }
  const removed = base.cards.filter((c) => !ids.has(c.id)).length;
  const settingsChanged = canon(settings) !== canon(base.settings);
  return { added, edited, removed, settingsChanged, changed, total: added + edited + removed + (settingsChanged ? 1 : 0) };
}

/**
 * Three-way merge used when a partner published while we were editing.
 * Anything only one side touched is kept; if both edited the same card,
 * this device's version wins.
 */
function mergeCatalogs(base, mine, theirs) {
  const B = byId(base.cards);
  const M = byId(mine.cards);
  const T = byId(theirs.cards);
  const order = [...new Set([...mine.cards.map((c) => c.id), ...theirs.cards.map((c) => c.id)])];
  let pulled = 0;
  let conflicts = 0;
  const cards = [];
  for (const id of order) {
    const b = canon(B.get(id));
    const m = M.get(id);
    const t = T.get(id);
    const mineChanged = b !== canon(m);
    const theirsChanged = b !== canon(t);
    let result;
    if (!mineChanged) {
      result = t;
      if (theirsChanged) pulled += 1;
    } else if (!theirsChanged) {
      result = m;
    } else {
      result = m;
      if (canon(m) !== canon(t)) conflicts += 1;
    }
    if (result) cards.push(result);
  }
  const settings = { ...mine.settings };
  for (const key of Object.keys(theirs.settings)) {
    const b = canon(base.settings[key]);
    if (b === canon(mine.settings[key]) && b !== canon(theirs.settings[key])) {
      settings[key] = theirs.settings[key];
      pulled += 1;
    }
  }
  return { cards, settings, pulled, conflicts };
}

async function persist() {
  await idb.set('kv', 'draft', state.draft);
  renderStatus();
}

function freshDraft(published) {
  const p = published || normalizeCatalog({});
  return { cards: clone(p.cards), settings: clone(p.settings), base: clone(p) };
}

async function fetchLatest() {
  if (gh.isConfigured(state.gh)) {
    try {
      const remote = await gh.fetchRemoteCatalog(state.gh);
      if (remote) return remote;
    } catch (err) {
      console.warn('GitHub fetch failed, falling back to site copy', err);
    }
  }
  try {
    return await loadPublishedCatalog();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- status

function renderStatus() {
  const pill = $('#draftStatus');
  const ch = changes();
  pill.classList.toggle('is-dirty', ch.total > 0);
  pill.classList.toggle('is-clean', ch.total === 0);
  pill.textContent = ch.total === 0 ? 'All published' : `${ch.total} unpublished change${ch.total === 1 ? '' : 's'}`;
  pill.title = ch.total
    ? [ch.added && `${ch.added} added`, ch.edited && `${ch.edited} edited`, ch.removed && `${ch.removed} removed`, ch.settingsChanged && 'store details changed']
        .filter(Boolean)
        .join(', ')
    : 'Everything on this device matches the live catalog';
  $$('[data-bind="storeName"]').forEach((el) => (el.textContent = state.draft.settings.storeName));
}

// ---------------------------------------------------------------- inventory

function renderInventory() {
  const cards = state.draft.cards;
  const forSale = cards.filter((c) => c.status !== 'sold');
  const sum = (list, key) => list.reduce((t, c) => t + (c[key] ?? 0) * Math.max(1, c.quantity || 1), 0);
  const stats = [
    ['Cards', cards.length],
    ['Asking value', money(sum(forSale, 'price'))],
    ['Market value', money(sum(forSale, 'marketValue'))],
    ['In showcase', cards.filter((c) => c.featured && c.status !== 'sold').length],
    ['Sold', cards.filter((c) => c.status === 'sold').length],
  ];
  $('#invStats').innerHTML = stats
    .map(([k, v]) => `<div class="stat"><span>${k}</span><strong title="${escapeHtml(v)}">${escapeHtml(v)}</strong></div>`)
    .join('');
  $('#sampleNotice').hidden = !cards.some((c) => c.sample);

  const { q, status, sort } = state.inv;
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let list = cards.filter((c) => {
    if (status === 'featured' ? !c.featured : status !== 'all' && c.status !== status) return false;
    if (!terms.length) return true;
    const hay = [c.name, c.set, c.number, c.game, c.rarity, c.variant, gradeLabel(c), c.certNumber, ...c.tags].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const sorters = {
    updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    newest: (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)),
    'price-desc': (a, b) => (b.price ?? -1) - (a.price ?? -1),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list = [...list].sort(sorters[sort]);

  const changed = changes().changed;
  const statusOptions = (c) =>
    ['available', 'hold', 'sold']
      .map((s) => `<option value="${s}"${c.status === s ? ' selected' : ''}>${{ available: 'Available', hold: 'On hold', sold: 'Sold' }[s]}</option>`)
      .join('');

  const rows = list.map(
    (c) => `
    <div class="inv-row" role="listitem" data-id="${escapeHtml(c.id)}">
      <button class="inv-thumb" type="button" data-edit aria-label="Edit ${escapeHtml(c.name)}"><img src="${escapeHtml(cardImage(c))}" alt="" loading="lazy" /></button>
      <button class="inv-name" type="button" data-edit>
        <strong>${escapeHtml(c.name || 'Untitled')}${changed.has(c.id) ? '<i class="changed-dot" title="Not published yet"></i>' : ''}</strong>
        <span>${escapeHtml([setLine(c), gradeLabel(c)].filter(Boolean).join(' · ') || '—')}</span>
      </button>
      <span class="inv-game">${escapeHtml(c.game)}</span>
      <span>${escapeHtml(gradeLabel(c))}</span>
      <span class="inv-price">${c.price === null ? '<small>On request</small>' : money(c.price)}${c.marketValue !== null ? `<small>Mkt ${money(c.marketValue)}</small>` : ''}</span>
      <label class="inv-status-wrap"><span class="sr-only">Status</span><select class="select inv-status is-${c.status}" data-status>${statusOptions(c)}</select></label>
      <button class="star" type="button" data-star aria-pressed="${c.featured}" title="${c.featured ? 'In the Showcase' : 'Add to Showcase'}" aria-label="Show in Showcase">${ICONS.star}</button>
      <div class="row-actions">
        <button type="button" data-edit title="Edit" aria-label="Edit">${ICONS.edit}</button>
        <button type="button" class="dup" data-dup title="Duplicate" aria-label="Duplicate">${ICONS.copy}</button>
        <button type="button" data-del title="Delete" aria-label="Delete">${ICONS.trash}</button>
      </div>
    </div>`,
  );
  const head = `<div class="inv-row inv-head" aria-hidden="true"><span></span><span>Card</span><span>Game</span><span>Grade</span><span style="text-align:right">Price</span><span>Status</span><span title="Showcase">★</span><span></span></div>`;
  $('#invList').innerHTML = list.length ? head + rows.join('') : '';
  const empty = $('#invEmpty');
  empty.hidden = list.length > 0;
  empty.innerHTML = cards.length
    ? '<h3>No matches</h3><p>Nothing in your inventory matches that search.</p>'
    : '<h3>No cards yet</h3><p>Click <strong>Add card</strong> to put your first card in the catalog.</p>';
}

function findCard(id) {
  return state.draft.cards.find((c) => c.id === id);
}

async function updateCard(id, patch) {
  const card = findCard(id);
  if (!card) return;
  Object.assign(card, patch, { updatedAt: now() });
  delete card.sample;
  await persist();
  renderInventory();
}

async function deleteCard(id) {
  const card = findCard(id);
  if (!card) return false;
  const ok = await confirmDialog('Delete this card?', `“${card.name}” will be removed from the catalog when you next publish.`, 'Delete');
  if (!ok) return false;
  state.draft.cards = state.draft.cards.filter((c) => c.id !== id);
  await persist();
  renderInventory();
  toast('Card deleted');
  return true;
}

// ------------------------------------------------------------------- editor

const form = () => $('#cardForm');

function currencySymbol() {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.draft.settings.currency }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || '$';
  } catch {
    return '$';
  }
}

function fillDatalists() {
  const sets = [...new Set(state.draft.cards.map((c) => c.set).filter(Boolean))].sort();
  $('#setList').innerHTML = sets.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('');
  const rarities = [...new Set([...COMMON_RARITIES, ...state.draft.cards.map((c) => c.rarity).filter(Boolean)])];
  $('#rarityList').innerHTML = rarities.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('');
}

function openEditor(card, { isNew = !card } = {}) {
  const c = card ? clone(card) : normalizeCard({ id: uid('c_'), addedAt: now() });
  state.editing = { card: c, isNew, images: [...c.images], pending: new Map() };
  const f = form();
  f.reset();
  for (const name of ['name', 'set', 'number', 'rarity', 'variant', 'language', 'year', 'condition', 'gradingCompany', 'grade', 'certNumber', 'quantity', 'status', 'description']) {
    if (f.elements[name]) f.elements[name].value = c[name] ?? '';
  }
  f.elements.game.value = GAMES.includes(c.game) ? c.game : 'Other';
  f.elements.price.value = c.price ?? '';
  f.elements.marketValue.value = c.marketValue ?? '';
  f.elements.featured.checked = c.featured;
  f.elements.tags.value = c.tags.join(', ');
  f.querySelector(`input[name="graded"][value="${c.graded ? 'graded' : 'raw'}"]`).checked = true;
  $$('.input.is-invalid', f).forEach((el) => el.classList.remove('is-invalid'));
  $$('[data-cur]').forEach((el) => (el.textContent = currencySymbol()));
  toggleGraded();
  fillDatalists();
  renderPhotos();
  $('#editorTitle').textContent = isNew ? 'Add card' : 'Edit card';
  $('#deleteCard').hidden = isNew;
  $('#editor').showModal();
  $('.drawer-body').scrollTop = 0;
  if (isNew && !card) setTimeout(() => f.elements.name.focus(), 50);
}

function closeEditor() {
  state.editing = null;
  $('#editor').close();
}

function toggleGraded() {
  const graded = form().querySelector('input[name="graded"]:checked').value === 'graded';
  $('[data-when="graded"]').hidden = !graded;
  $('[data-when="raw"]').hidden = graded;
}

function renderPhotos() {
  const ed = state.editing;
  const n = ed.images.length;
  $('#photoList').innerHTML = ed.images
    .map(
      (p, i) => `
      <div class="photo">
        <img src="${escapeHtml(imgSrc(p))}" alt="Photo ${i + 1}" />
        ${i === 0 ? '<span class="main-tag">Main</span>' : ''}
        <div class="photo-actions">
          <button type="button" data-move="${i}" data-dir="-1" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>${ICONS.left}</button>
          <button type="button" data-remove="${i}" aria-label="Remove photo">${ICONS.x}</button>
          <button type="button" data-move="${i}" data-dir="1" aria-label="Move later" ${i === n - 1 ? 'disabled' : ''}>${ICONS.right}</button>
        </div>
      </div>`,
    )
    .join('');
}

async function processPhoto(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unsupported image'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width;
  const h = source.height;
  const scale = Math.min(1, 1400 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function addPhotos(files) {
  const ed = state.editing;
  if (!ed) return;
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  for (const file of list) {
    try {
      const dataUrl = await processPhoto(file);
      const path = `${gh.IMAGE_DIR}${ed.card.id}-${uid()}.jpg`;
      ed.pending.set(path, dataUrl);
      ed.images.push(path);
      renderPhotos();
    } catch {
      toast(`Couldn't read “${file.name}”. Try a JPG or PNG.`);
    }
  }
}

async function saveEditor(e) {
  e.preventDefault();
  const ed = state.editing;
  if (!ed) return;
  const f = form();
  const nameInput = f.elements.name;
  if (!nameInput.value.trim()) {
    nameInput.classList.add('is-invalid');
    nameInput.focus();
    toast('Give the card a name');
    return;
  }
  const v = (n) => f.elements[n].value.trim();
  const card = normalizeCard({
    ...ed.card,
    name: v('name'),
    game: v('game'),
    set: v('set'),
    number: v('number'),
    rarity: v('rarity'),
    variant: v('variant'),
    language: v('language'),
    year: v('year'),
    graded: f.querySelector('input[name="graded"]:checked').value === 'graded',
    condition: v('condition'),
    gradingCompany: v('gradingCompany'),
    grade: v('grade'),
    certNumber: v('certNumber'),
    price: v('price'),
    marketValue: v('marketValue'),
    quantity: v('quantity') === '' ? 1 : v('quantity'),
    status: v('status'),
    featured: f.elements.featured.checked,
    description: f.elements.description.value.trim(),
    tags: v('tags'),
    images: ed.images,
    addedAt: ed.card.addedAt || now(),
    updatedAt: now(),
  });
  delete card.sample;

  for (const path of card.images) {
    if (ed.pending.has(path)) {
      const data = ed.pending.get(path);
      await idb.set('images', path, data);
      state.images.set(path, data);
    }
  }

  const i = state.draft.cards.findIndex((c) => c.id === card.id);
  if (i >= 0) state.draft.cards[i] = card;
  else state.draft.cards.unshift(card);
  await persist();
  closeEditor();
  renderInventory();
  toast(ed.isNew ? 'Card added to your draft' : 'Card saved');
}

// -------------------------------------------------------------------- store

function fillStoreForm() {
  const s = state.draft.settings;
  const f = $('#storeForm');
  for (const el of f.elements) {
    if (!el.name) continue;
    const m = el.name.match(/^promise(\d)(title|text)$/);
    if (m) el.value = s.promises[m[1]][m[2]] ?? '';
    else if (el.type === 'checkbox') el.checked = Boolean(s[el.name]);
    else el.value = s[el.name] ?? '';
  }
}

let storeTimer;
function onStoreInput() {
  clearTimeout(storeTimer);
  storeTimer = setTimeout(async () => {
    const f = $('#storeForm');
    const s = clone(state.draft.settings);
    for (const el of f.elements) {
      if (!el.name) continue;
      const m = el.name.match(/^promise(\d)(title|text)$/);
      if (m) s.promises[m[1]][m[2]] = el.value.trim();
      else if (el.type === 'checkbox') s[el.name] = el.checked;
      else s[el.name] = el.value.trim();
    }
    if (!s.storeName) s.storeName = state.draft.settings.storeName;
    state.draft.settings = normalizeSettings(s);
    await persist();
  }, 300);
}

// ---------------------------------------------------------------- publishing

function fillGhForm() {
  const f = $('#ghForm');
  f.elements.owner.value = state.gh.owner || '';
  f.elements.repo.value = state.gh.repo || '';
  f.elements.branch.value = state.gh.branch || '';
  f.elements.token.value = state.gh.token || '';
  let last = '';
  try {
    last = localStorage.getItem('routeone-last-published') || '';
  } catch {}
  const live = state.draft.base.publishedAt;
  $('#lastPublished').textContent = [live && `Live catalog last updated ${formatDate(live)} at ${new Date(live).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`, last && `This device last published ${formatDate(last)}.`]
    .filter(Boolean)
    .join(' ');
}

function setResult(text, ok) {
  const el = $('#ghResult');
  el.textContent = text;
  el.className = `result-line ${ok ? 'ok' : 'err'}`;
}

async function onGhSubmit(e) {
  e.preventDefault();
  const f = e.target;
  state.gh = {
    owner: f.elements.owner.value.trim(),
    repo: f.elements.repo.value.trim(),
    branch: f.elements.branch.value.trim(),
    token: f.elements.token.value.trim(),
  };
  gh.saveConfig(state.gh);
  if (!state.gh.token) return setResult('Saved. Add an access token to be able to publish.', false);
  setResult('Testing…', true);
  try {
    setResult(await gh.testConnection(state.gh), true);
  } catch (err) {
    setResult(err.message, false);
  }
}

function log(line) {
  const el = $('#publishLog');
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  el.textContent += `${el.textContent ? '\n' : ''}[${time}] ${line}`;
  el.scrollTop = el.scrollHeight;
}

async function publish() {
  if (state.busy) return;
  if (!gh.isConfigured(state.gh)) {
    switchTab('publish');
    toast('Connect to GitHub first — it only takes a minute.');
    $('#ghForm').elements.token.focus();
    return;
  }
  if (changes().total === 0) {
    toast('Nothing new to publish — everything is already live.');
    return;
  }
  const btn = $('#publishBtn');
  state.busy = true;
  btn.disabled = true;
  btn.textContent = 'Publishing…';
  $('#publishLog').textContent = '';
  try {
    log('Checking for changes from your partner…');
    const remote = await gh.fetchRemoteCatalog(state.gh);
    let { cards, settings } = state.draft;
    if (remote && isNewer(remote.publishedAt, state.draft.base.publishedAt)) {
      const merged = mergeCatalogs(state.draft.base, state.draft, remote);
      cards = merged.cards;
      settings = merged.settings;
      log(`Merged in ${merged.pulled} change(s) your partner published.${merged.conflicts ? ` ${merged.conflicts} card(s) were edited by both of you — kept yours.` : ''}`);
    }
    const catalog = { publishedAt: now(), settings, cards };
    const result = await gh.publish(state.gh, catalog, state.images, log);
    state.draft = { cards: clone(result.catalog.cards), settings: clone(result.catalog.settings), base: clone(result.catalog) };
    try {
      localStorage.setItem('routeone-last-published', result.catalog.publishedAt);
    } catch {}
    await persist();
    renderInventory();
    fillStoreForm();
    fillGhForm();
    log('The public catalog will show the update in about a minute.');
    toast('Published! The live catalog updates in about a minute.', 4000);
  } catch (err) {
    console.error(err);
    log(`Error: ${err.message}`);
    switchTab('publish');
    toast(`Publish failed: ${err.message}`, 6000);
  } finally {
    state.busy = false;
    btn.disabled = false;
    btn.textContent = 'Publish';
  }
}

// ------------------------------------------------------------------- backup

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function exportBackup() {
  const btn = $('#exportBtn');
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const images = {};
    const paths = new Set(state.draft.cards.flatMap((c) => c.images));
    for (const path of paths) {
      if (state.images.has(path)) images[path] = state.images.get(path);
      else {
        try {
          const res = await fetch(path);
          if (res.ok) images[path] = await blobToDataUrl(await res.blob());
        } catch {}
      }
    }
    const backup = {
      format: 'routeone-catalog-backup',
      version: 1,
      exportedAt: now(),
      settings: state.draft.settings,
      cards: state.draft.cards,
      images,
    };
    const date = new Date().toISOString().slice(0, 10);
    download(`catalog-backup-${date}.json`, JSON.stringify(backup), 'application/json');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download backup';
  }
}

function exportCsv() {
  const cols = ['name', 'game', 'set', 'number', 'rarity', 'variant', 'language', 'year', 'graded', 'gradingCompany', 'grade', 'certNumber', 'condition', 'price', 'marketValue', 'quantity', 'status', 'featured', 'description', 'tags', 'addedAt'];
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [cols.join(','), ...state.draft.cards.map((c) => cols.map((k) => cell(c[k])).join(','))];
  download(`catalog-${new Date().toISOString().slice(0, 10)}.csv`, rows.join('\n'), 'text/csv');
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('That file is not a valid backup.');
  }
  if (data?.format !== 'routeone-catalog-backup' || !Array.isArray(data.cards)) return toast('That file is not a catalog backup.');
  const ok = await confirmDialog('Restore this backup?', `Your draft will be replaced with ${data.cards.length} card(s) from ${formatDate(data.exportedAt)}.`, 'Restore');
  if (!ok) return;
  for (const [path, url] of Object.entries(data.images || {})) {
    if (typeof url === 'string' && url.startsWith('data:image/') && path.startsWith(gh.IMAGE_DIR)) {
      await idb.set('images', path, url);
      state.images.set(path, url);
    }
  }
  state.draft.cards = data.cards.map(normalizeCard);
  state.draft.settings = normalizeSettings(data.settings);
  await persist();
  renderAll();
  toast('Backup restored. Publish to make it live.');
}

async function discardDraft() {
  const ok = await confirmDialog('Discard unpublished changes?', 'Everything you have not published from this device will be lost.', 'Discard');
  if (!ok) return;
  const latest = await fetchLatest();
  state.draft = freshDraft(latest || state.draft.base);
  await persist();
  renderAll();
  toast('Draft reset to the live catalog');
}

async function pruneImages() {
  const used = new Set(state.draft.cards.flatMap((c) => c.images));
  for (const path of state.images.keys()) {
    if (!used.has(path)) {
      state.images.delete(path);
      await idb.del('images', path).catch(() => {});
    }
  }
}

// --------------------------------------------------------------------- tabs

function switchTab(name) {
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (name === 'store') fillStoreForm();
  if (name === 'publish') fillGhForm();
  history.replaceState(null, '', name === 'inventory' ? location.pathname : `#${name}`);
}

function renderAll() {
  renderStatus();
  renderInventory();
  fillStoreForm();
  fillGhForm();
}

// ------------------------------------------------------------------- events

function bindEvents() {
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#publishBtn').addEventListener('click', publish);
  $('#addCard').addEventListener('click', () => openEditor(null));

  $('#invSearch').addEventListener('input', (e) => {
    state.inv.q = e.target.value;
    renderInventory();
  });
  $('#invStatus').addEventListener('change', (e) => {
    state.inv.status = e.target.value;
    renderInventory();
  });
  $('#invSort').addEventListener('change', (e) => {
    state.inv.sort = e.target.value;
    renderInventory();
  });

  $('#invList').addEventListener('click', async (e) => {
    const row = e.target.closest('.inv-row');
    if (!row?.dataset.id) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-edit]')) return openEditor(findCard(id));
    if (e.target.closest('[data-star]')) {
      const c = findCard(id);
      await updateCard(id, { featured: !c.featured });
      toast(c.featured ? 'Added to the Showcase' : 'Removed from the Showcase');
      return;
    }
    if (e.target.closest('[data-dup]')) {
      const src = findCard(id);
      const copy = normalizeCard({ ...clone(src), id: uid('c_'), name: `${src.name} (copy)`, addedAt: now(), certNumber: '' });
      delete copy.sample;
      return openEditor(copy, { isNew: true });
    }
    if (e.target.closest('[data-del]')) return deleteCard(id);
  });
  $('#invList').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    const id = sel.closest('.inv-row').dataset.id;
    updateCard(id, { status: sel.value });
    toast(`Marked as ${sel.options[sel.selectedIndex].text.toLowerCase()}`);
  });

  $('#removeSamples').addEventListener('click', async () => {
    const n = state.draft.cards.filter((c) => c.sample).length;
    const ok = await confirmDialog('Remove example cards?', `${n} example card(s) will be removed. Your own cards are not affected.`, 'Remove');
    if (!ok) return;
    state.draft.cards = state.draft.cards.filter((c) => !c.sample);
    await persist();
    renderInventory();
    toast('Examples removed — publish to update the live catalog.');
  });

  // editor
  const f = form();
  f.addEventListener('submit', saveEditor);
  f.addEventListener('change', (e) => {
    if (e.target.name === 'graded') toggleGraded();
  });
  f.elements.name.addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
  $$('[data-cancel]', f).forEach((b) => b.addEventListener('click', closeEditor));
  $('#editor').addEventListener('cancel', (e) => {
    e.preventDefault();
    closeEditor();
  });
  $('#deleteCard').addEventListener('click', async () => {
    const id = state.editing?.card.id;
    if (id && (await deleteCard(id))) closeEditor();
  });
  $('#photoInput').addEventListener('change', async (e) => {
    await addPhotos(e.target.files);
    e.target.value = '';
  });
  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('is-over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('is-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('is-over');
    addPhotos(e.dataTransfer.files);
  });
  $('#photoList').addEventListener('click', (e) => {
    const ed = state.editing;
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      ed.images.splice(Number(rm.dataset.remove), 1);
      return renderPhotos();
    }
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const i = Number(mv.dataset.move);
      const j = i + Number(mv.dataset.dir);
      if (j < 0 || j >= ed.images.length) return;
      [ed.images[i], ed.images[j]] = [ed.images[j], ed.images[i]];
      renderPhotos();
    }
  });

  // store / publishing / backup
  $('#storeForm').addEventListener('input', onStoreInput);
  $('#storeForm').addEventListener('change', onStoreInput);
  $('#storeForm').addEventListener('submit', (e) => e.preventDefault());
  $('#ghForm').addEventListener('submit', onGhSubmit);
  $('#forgetToken').addEventListener('click', () => {
    state.gh.token = '';
    gh.saveConfig(state.gh);
    fillGhForm();
    setResult('Token removed from this browser.', true);
  });
  $('#exportBtn').addEventListener('click', exportBackup);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });
  $('#discardDraft').addEventListener('click', discardDraft);
}

// --------------------------------------------------------------------- boot

async function boot() {
  $('#gameSelect').innerHTML = GAMES.map((g) => `<option>${escapeHtml(g)}</option>`).join('');
  bindEvents();

  state.images = await loadLocalImages();
  const published = await fetchLatest();
  const saved = await loadDraft();

  if (!saved) {
    state.draft = freshDraft(published);
  } else {
    state.draft = {
      cards: (saved.cards || []).map(normalizeCard),
      settings: normalizeSettings(saved.settings),
      base: normalizeCatalog(saved.base),
    };
    if (published && isNewer(published.publishedAt, state.draft.base.publishedAt)) {
      const merged = mergeCatalogs(state.draft.base, state.draft, published);
      state.draft = { cards: merged.cards, settings: merged.settings, base: clone(published) };
      if (merged.pulled) toast(`Pulled in ${merged.pulled} update(s) your partner published.`, 4000);
    }
  }
  await persist();
  await pruneImages();
  renderAll();

  const tab = location.hash.slice(1);
  if (['store', 'publish', 'backup'].includes(tab)) switchTab(tab);
  if (!published && !saved) {
    toast('Could not load the live catalog — starting with an empty draft.', 4000);
  }
}

boot().catch((err) => {
  console.error(err);
  toast(`Something went wrong: ${err.message}`, 8000);
});
