// Shared data model, formatting helpers and local storage used by both
// the public catalog (index.html) and the manager (admin.html).

export const GAMES = [
  'Pokémon',
  'Magic: The Gathering',
  'Yu-Gi-Oh!',
  'One Piece',
  'Disney Lorcana',
  'Sports',
  'Other',
];

export const RAW_CONDITIONS = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

export const GRADERS = ['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'Other'];

export const STATUSES = {
  available: 'Available',
  hold: 'On hold',
  sold: 'Sold',
};

export const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD'];

export const DEFAULT_SETTINGS = {
  storeName: 'Route One TCG',
  tagline: 'Cards worth collecting.',
  intro:
    'Graded slabs, vintage holos and modern chase cards — hand-picked, honestly graded and photographed as they are.',
  aboutTitle: 'Two collectors. One standard.',
  about:
    'Route One TCG is run by two friends who have been collecting since the playground. Every card we list is one we would be happy to keep in our own binders.',
  promises: [
    { title: 'Honest condition', text: 'Raw cards are graded conservatively and every flaw is called out.' },
    { title: 'Real photos', text: 'What you see is the exact card you get — no stock images.' },
    { title: 'Packed with care', text: 'Penny sleeve, top loader and bubble mailer on every order.' },
  ],
  email: '',
  instagram: '',
  tiktok: '',
  ebay: '',
  whatnot: '',
  location: '',
  shippingNote: 'Ships within 2 business days. Local pickup available.',
  currency: 'USD',
  showMarketValue: true,
};

const CARD_DEFAULTS = {
  id: '',
  name: '',
  game: 'Pokémon',
  set: '',
  number: '',
  rarity: '',
  variant: '',
  language: 'English',
  year: '',
  graded: false,
  gradingCompany: 'PSA',
  grade: '',
  certNumber: '',
  condition: 'NM',
  price: null,
  marketValue: null,
  quantity: 1,
  status: 'available',
  featured: false,
  description: '',
  tags: [],
  images: [],
  addedAt: '',
  updatedAt: '',
};

export function uid(prefix = '') {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCard(card) {
  const c = { ...CARD_DEFAULTS, ...card };
  c.id = c.id || uid('c_');
  c.graded = Boolean(c.graded);
  c.featured = Boolean(c.featured);
  c.price = toNumberOrNull(c.price);
  c.marketValue = toNumberOrNull(c.marketValue);
  c.quantity = Math.max(0, parseInt(c.quantity, 10) || 0);
  if (!STATUSES[c.status]) c.status = 'available';
  c.images = Array.isArray(c.images) ? c.images.filter(Boolean) : [];
  c.tags = Array.isArray(c.tags)
    ? c.tags.map((t) => String(t).trim()).filter(Boolean)
    : String(c.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
  return c;
}

export function normalizeSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const promises = Array.isArray(s.promises) ? s.promises : [];
  s.promises = [0, 1, 2].map((i) => ({
    title: promises[i]?.title ?? DEFAULT_SETTINGS.promises[i].title,
    text: promises[i]?.text ?? DEFAULT_SETTINGS.promises[i].text,
  }));
  if (!CURRENCIES.includes(s.currency)) s.currency = 'USD';
  s.showMarketValue = s.showMarketValue !== false;
  return s;
}

export function normalizeCatalog(raw) {
  return {
    publishedAt: raw?.publishedAt || null,
    settings: normalizeSettings(raw?.settings),
    cards: Array.isArray(raw?.cards) ? raw.cards.map(normalizeCard) : [],
  };
}

/** Loads the published catalog that ships with the site. */
export async function loadPublishedCatalog() {
  const res = await fetch(`data/catalog.json?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load catalog (${res.status})`);
  return normalizeCatalog(await res.json());
}

// ---------------------------------------------------------------- formatting

const moneyFormatters = new Map();

export function formatMoney(value, currency = 'USD') {
  if (value === null || value === undefined || value === '') return '';
  const key = currency;
  if (!moneyFormatters.has(key)) {
    moneyFormatters.set(
      key,
      new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }),
    );
  }
  return moneyFormatters.get(key).format(value);
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Short label shown on badges: "PSA 10", "BGS 9.5", "NM". */
export function gradeLabel(card) {
  if (card.graded) return [card.gradingCompany, card.grade].filter(Boolean).join(' ') || 'Graded';
  return card.condition || '';
}

/** Longer label for detail views: "PSA 10" / "Near Mint (raw)". */
export function conditionText(card) {
  if (card.graded) return gradeLabel(card);
  const name = RAW_CONDITIONS[card.condition] || card.condition;
  return name ? `${name} (raw)` : 'Raw';
}

export function setLine(card) {
  return [card.set, card.number ? `#${card.number}` : ''].filter(Boolean).join(' · ');
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

// ---------------------------------------------------------- placeholder art

const GAME_COLORS = {
  'Pokémon': ['#f4c542', '#d9822b'],
  'Magic: The Gathering': ['#8b6b4a', '#3d2b1f'],
  'Yu-Gi-Oh!': ['#7a4fb5', '#2c1a4d'],
  'One Piece': ['#d0473a', '#6e1a1a'],
  'Disney Lorcana': ['#2f8fb0', '#163a5c'],
  'Sports': ['#3f8f5a', '#173b27'],
  'Other': ['#6b7280', '#2b2f36'],
};

const placeholderCache = new Map();

/** A tasteful generated card face used until a real photo is added. */
export function placeholderArt(card) {
  const key = `${card.game}|${card.name}`;
  if (placeholderCache.has(key)) return placeholderCache.get(key);
  const [c1, c2] = GAME_COLORS[card.game] || GAME_COLORS.Other;
  const name = (card.name || 'Untitled card').trim();
  const title = name.length > 22 ? `${name.slice(0, 21)}…` : name;
  const initials = name
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w[0] || ''))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="6" height="12" fill="#fff" fill-opacity=".07"/></pattern>
</defs>
<rect width="250" height="350" rx="14" fill="url(#g)"/>
<rect x="11" y="11" width="228" height="328" rx="9" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="1.5"/>
<rect x="24" y="44" width="202" height="160" rx="6" fill="#000" fill-opacity=".18"/>
<rect x="24" y="44" width="202" height="160" rx="6" fill="url(#p)" stroke="#fff" stroke-opacity=".28"/>
<circle cx="125" cy="124" r="36" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1.5"/>
<text x="125" y="134" text-anchor="middle" font-family="Georgia, serif" font-size="28" fill="#fff" fill-opacity=".9">${escapeHtml(initials)}</text>
<text x="24" y="236" font-family="Georgia, 'Times New Roman', serif" font-size="16" fill="#fff">${escapeHtml(title)}</text>
<rect x="24" y="252" width="202" height="7" rx="3.5" fill="#fff" fill-opacity=".2"/>
<rect x="24" y="267" width="160" height="7" rx="3.5" fill="#fff" fill-opacity=".14"/>
<text x="24" y="318" font-family="Helvetica, Arial, sans-serif" font-size="9" letter-spacing="1.6" fill="#fff" fill-opacity=".75">${escapeHtml((card.game || '').toUpperCase())}</text>
<text x="226" y="318" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="9" letter-spacing="1.2" fill="#fff" fill-opacity=".6">PHOTO SOON</text>
</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  placeholderCache.set(key, uri);
  return uri;
}

// ------------------------------------------------------------- local storage
// Drafts and photos live in IndexedDB so the manager can hold far more than
// localStorage's ~5 MB limit.

const DB_NAME = 'routeone-manager';
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const result = fn(t.objectStore(store));
        t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  set: (store, key, value) => tx(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)).then(() => undefined),
  async entries(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const out = new Map();
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        out.set(cursor.key, cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },
};

export async function loadDraft() {
  try {
    return await idb.get('kv', 'draft');
  } catch {
    return undefined;
  }
}

export async function loadLocalImages() {
  try {
    return await idb.entries('images');
  } catch {
    return new Map();
  }
}
