import {
  GAMES,
  conditionText,
  escapeHtml,
  formatDate,
  formatMoney,
  gradeLabel,
  loadDraft,
  loadLocalImages,
  loadPublishedCatalog,
  normalizeCatalog,
  placeholderArt,
  setLine,
} from './common.js';

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  catalog: null,
  localImages: new Map(),
  filtered: [],
  filters: { q: '', game: 'all', type: 'all', status: 'active', min: null, max: null, sort: 'featured' },
  view: 'grid',
  openIndex: -1,
  openList: [],
};

const isPreview = new URLSearchParams(location.search).has('preview');

// ------------------------------------------------------------------ helpers

function imageFor(card, index = 0) {
  const path = card.images[index];
  if (!path) return placeholderArt(card);
  return state.localImages.get(path) || path;
}

function money(value) {
  return formatMoney(value, state.catalog.settings.currency);
}

function priceHtml(card) {
  if (card.status === 'sold') return `<span class="price">Sold</span>`;
  if (card.price === null) return `<span class="price-ask">Price on request</span>`;
  return `<span class="price">${money(card.price)}</span>`;
}

function marketHtml(card, cls = 'mkt') {
  if (!state.catalog.settings.showMarketValue || card.marketValue === null || card.status === 'sold') return '';
  return `<span class="${cls}">Market ${money(card.marketValue)}</span>`;
}

function gradeBadge(card) {
  const label = gradeLabel(card);
  if (!label) return '';
  return `<span class="badge badge-grade${card.graded ? '' : ' is-raw'}">${escapeHtml(label)}</span>`;
}

function statusBadge(card) {
  if (card.status === 'sold') return `<span class="badge badge-sold">Sold</span>`;
  if (card.status === 'hold') return `<span class="badge badge-hold">On hold</span>`;
  return '';
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
}

/** Subtle holo shine + tilt that follows the pointer. */
function attachHolo(el, tiltTarget) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const target = tiltTarget || el;
    target.style.setProperty('--mx', `${x * 100}%`);
    target.style.setProperty('--my', `${y * 100}%`);
    target.style.setProperty('--hx', `${x * 100}%`);
    if (tiltTarget) {
      tiltTarget.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
      tiltTarget.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
    }
  });
  el.addEventListener('pointerleave', () => {
    const target = tiltTarget || el;
    target.style.setProperty('--rx', '0deg');
    target.style.setProperty('--ry', '0deg');
  });
}

// ---------------------------------------------------------- static content

function renderStoreInfo() {
  const s = state.catalog.settings;
  document.querySelectorAll('[data-bind]').forEach((el) => {
    el.textContent = s[el.dataset.bind] ?? '';
  });
  document.title = `${s.storeName} — Card Catalog`;

  $('#promises').innerHTML = s.promises
    .filter((p) => p.title || p.text)
    .map((p) => `<li><strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(p.text)}</span></li>`)
    .join('');

  const icons = {
    email: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="m22 6-10 7L2 6"/>',
    instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
    tiktok: '<path d="M9 12a4 4 0 1 0 4 4V2a5 5 0 0 0 5 5"/>',
    ebay: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    whatnot: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m22 7-5 4 5 4z"/>',
    location: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  };
  const handle = (v) => v.replace(/^https?:\/\/(www\.)?[^/]+\//, '').replace(/^@/, '').replace(/\/$/, '');
  const url = (v, base) => (/^https?:\/\//.test(v) ? v : `${base}${handle(v)}`);
  const rows = [];
  if (s.email) rows.push(['email', 'Email', s.email, `mailto:${s.email}`]);
  if (s.instagram) rows.push(['instagram', 'Instagram', `@${handle(s.instagram)}`, url(s.instagram, 'https://instagram.com/')]);
  if (s.tiktok) rows.push(['tiktok', 'TikTok', `@${handle(s.tiktok)}`, url(s.tiktok, 'https://www.tiktok.com/@')]);
  if (s.whatnot) rows.push(['whatnot', 'Whatnot', handle(s.whatnot), url(s.whatnot, 'https://www.whatnot.com/user/')]);
  if (s.ebay) rows.push(['ebay', 'eBay', handle(s.ebay), url(s.ebay, 'https://www.ebay.com/usr/')]);
  if (s.location) rows.push(['location', 'Based in', s.location, null]);
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[k]}</svg>`;
  $('#contactList').innerHTML = rows.length
    ? rows
        .map(([k, label, value, href]) => {
          const inner = `${svg(k)}<span class="contact-label">${label}</span><span class="contact-value">${escapeHtml(value)}</span>`;
          return href
            ? `<li><a href="${escapeHtml(href)}" target="${k === 'email' ? '_self' : '_blank'}" rel="noopener">${inner}</a></li>`
            : `<li><div>${inner}</div></li>`;
        })
        .join('')
    : `<li><div>${svg('email')}<span class="contact-value">Contact details coming soon.</span></div></li>`;

  $('#year').textContent = new Date().getFullYear();
  $('#updated').textContent = state.catalog.publishedAt ? `Updated ${formatDate(state.catalog.publishedAt)}` : '';
  $('#printDate').textContent = `Catalog · ${formatDate(new Date().toISOString())}`;
}

function renderHero() {
  const cards = state.catalog.cards;
  const forSale = cards.filter((c) => c.status !== 'sold');
  const stats = [
    ['For sale', forSale.length],
    ['Graded slabs', forSale.filter((c) => c.graded).length],
    ['Games', new Set(forSale.map((c) => c.game)).size],
    ['Sold', cards.filter((c) => c.status === 'sold').length],
  ];
  $('#heroStats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  const byValue = (a, b) => (b.price ?? b.marketValue ?? 0) - (a.price ?? a.marketValue ?? 0);
  const picks = [...forSale.filter((c) => c.featured).sort(byValue), ...forSale.filter((c) => !c.featured).sort(byValue)].slice(0, 3);
  // Put the most valuable card in the middle of the fan.
  const fan = picks.length === 3 ? [picks[1], picks[0], picks[2]] : picks;
  $('#heroFan').innerHTML = fan
    .map(
      (c) =>
        `<button class="fan-card" type="button" data-open="${escapeHtml(c.id)}" aria-label="View ${escapeHtml(c.name)}"><img src="${escapeHtml(imageFor(c))}" alt="" /></button>`,
    )
    .join('');
}

function renderShowcase() {
  const featured = state.catalog.cards.filter((c) => c.featured && c.status !== 'sold');
  const section = $('#showcase');
  section.hidden = featured.length === 0;
  document.querySelectorAll('[data-nav="showcase"]').forEach((a) => (a.hidden = featured.length === 0));
  const track = $('#showcaseTrack');
  track.innerHTML = featured
    .map(
      (c) => `
      <button class="feature" type="button" data-open="${escapeHtml(c.id)}">
        <div class="feature-img holo">
          <span class="feature-label">${gradeBadge(c)}</span>
          <img src="${escapeHtml(imageFor(c))}" alt="${escapeHtml(c.name)}" loading="lazy" />
        </div>
        <div class="feature-meta">
          <span class="set">${escapeHtml([c.game, c.set].filter(Boolean).join(' · '))}</span>
          <h3>${escapeHtml(c.name)}</h3>
          <div class="price-row">${priceHtml(c)}${marketHtml(c)}</div>
        </div>
      </button>`,
    )
    .join('');
  track.querySelectorAll('.feature').forEach((el) => attachHolo(el, $('.feature-img', el)));
}

// ------------------------------------------------------------------ catalog

function renderChips() {
  const counts = new Map();
  const pool = state.catalog.cards.filter((c) => statusMatches(c));
  pool.forEach((c) => counts.set(c.game, (counts.get(c.game) || 0) + 1));
  const games = [...GAMES.filter((g) => counts.has(g)), ...[...counts.keys()].filter((g) => !GAMES.includes(g))];
  if (state.filters.game !== 'all' && !counts.has(state.filters.game)) state.filters.game = 'all';
  const chip = (value, label, count) =>
    `<button class="chip" type="button" data-game="${escapeHtml(value)}" aria-pressed="${state.filters.game === value}">${escapeHtml(label)}<span class="count">${count}</span></button>`;
  $('#gameChips').innerHTML = [chip('all', 'All cards', pool.length), ...games.map((g) => chip(g, g, counts.get(g)))].join('');
}

function statusMatches(card) {
  switch (state.filters.status) {
    case 'active':
      return card.status !== 'sold';
    case 'available':
      return card.status === 'available';
    case 'sold':
      return card.status === 'sold';
    default:
      return true;
  }
}

function applyFilters() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  let list = state.catalog.cards.filter((c) => {
    if (!statusMatches(c)) return false;
    if (f.game !== 'all' && c.game !== f.game) return false;
    if (f.type === 'graded' && !c.graded) return false;
    if (f.type === 'raw' && c.graded) return false;
    if (f.min !== null && (c.price === null || c.price < f.min)) return false;
    if (f.max !== null && (c.price === null || c.price > f.max)) return false;
    if (terms.length) {
      const hay = [c.name, c.set, c.number, c.rarity, c.variant, c.game, c.year, gradeLabel(c), c.language, ...c.tags]
        .join(' ')
        .toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const value = (c) => c.price ?? c.marketValue ?? -1;
  const sorters = {
    featured: (a, b) => Number(b.featured) - Number(a.featured) || value(b) - value(a),
    newest: (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)),
    'price-desc': (a, b) => value(b) - value(a),
    'price-asc': (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  // Sold cards always sink to the bottom.
  list.sort((a, b) => Number(a.status === 'sold') - Number(b.status === 'sold') || sorters[f.sort](a, b));
  state.filtered = list;
}

function renderGrid() {
  applyFilters();
  renderChips();
  const list = state.filtered;
  const grid = $('#grid');
  grid.classList.toggle('is-list', state.view === 'list');
  grid.innerHTML = list
    .map(
      (c) => `
      <button class="tile${c.status === 'sold' ? ' is-sold' : ''}" type="button" data-open="${escapeHtml(c.id)}">
        <div class="tile-stage">
          <div class="tile-badges">${gradeBadge(c) || '<span></span>'}${statusBadge(c) || (c.featured ? '<span class="badge badge-featured">Featured</span>' : '')}</div>
          <div class="tile-img holo"><img src="${escapeHtml(imageFor(c))}" alt="${escapeHtml(c.name)}" loading="lazy" /></div>
        </div>
        <div class="tile-body">
          <div class="tile-main">
            <span class="tile-game">${escapeHtml(c.game)}${c.year ? ` · ${escapeHtml(c.year)}` : ''}</span>
            <span class="tile-name">${escapeHtml(c.name)}</span>
            <span class="tile-set">${escapeHtml(setLine(c) || ' ')}</span>
          </div>
          <span class="tile-grade-inline">${gradeBadge(c)}</span>
          <div class="tile-price">${priceHtml(c)}${marketHtml(c)}</div>
        </div>
      </button>`,
    )
    .join('');
  grid.querySelectorAll('.tile').forEach((el) => attachHolo(el, null));

  const total = state.catalog.cards.length;
  $('#resultCount').textContent = `Showing ${list.length} of ${total} card${total === 1 ? '' : 's'}`;
  $('#empty').hidden = list.length > 0;
  const f = state.filters;
  $('#clearFilters').hidden = !(f.q || f.game !== 'all' || f.type !== 'all' || f.status !== 'active' || f.min !== null || f.max !== null);
}

// ------------------------------------------------------------------- dialog

function openCard(id, list) {
  const pool = list || (state.filtered.some((c) => c.id === id) ? state.filtered : state.catalog.cards);
  const index = pool.findIndex((c) => c.id === id);
  if (index < 0) return;
  state.openList = pool;
  state.openIndex = index;
  renderDialog();
  const dlg = $('#cardDialog');
  if (!dlg.open) dlg.showModal();
  history.replaceState(null, '', `#card=${encodeURIComponent(id)}`);
}

function renderDialog(imageIndex = 0) {
  const c = state.openList[state.openIndex];
  if (!c) return;
  const s = state.catalog.settings;
  const images = c.images.length ? c.images.map((_, i) => imageFor(c, i)) : [placeholderArt(c)];
  const main = $('#dlgMain');
  main.classList.remove('is-zoomed');
  $('#dlgImg').src = images[imageIndex] || images[0];
  $('#dlgImg').alt = `${c.name}${imageIndex ? ` — photo ${imageIndex + 1}` : ''}`;
  $('#dlgThumbs').innerHTML =
    images.length > 1
      ? images
          .map(
            (src, i) =>
              `<button type="button" data-thumb="${i}" aria-current="${i === imageIndex}" aria-label="Photo ${i + 1}"><img src="${escapeHtml(src)}" alt="" /></button>`,
          )
          .join('')
      : '';

  const spec = (label, value) => (value ? `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>` : '');
  const statusBadgeHtml =
    c.status === 'available'
      ? `<span class="badge badge-available">Available</span>`
      : statusBadge(c);
  const qty = c.status === 'available' && c.quantity > 1 ? `<span>${c.quantity} in stock</span>` : '';

  const subject = `Inquiry: ${c.name}${c.set ? ` (${c.set}${c.number ? ` #${c.number}` : ''})` : ''}`;
  const link = `${location.origin}${location.pathname}#card=${encodeURIComponent(c.id)}`;
  const body = `Hi ${s.storeName},\n\nI'm interested in this card:\n${c.name} — ${conditionText(c)}${c.price !== null ? ` — ${money(c.price)}` : ''}\n${link}\n\n`;
  let contact = '';
  if (s.email) {
    contact = `<a class="btn btn-accent" href="mailto:${escapeHtml(s.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">${c.status === 'sold' ? 'Ask about similar cards' : 'Inquire about this card'}</a>`;
  } else {
    contact = `<a class="btn btn-accent" href="#contact" data-close>Contact us</a>`;
  }

  $('#dlgInfo').innerHTML = `
    <p class="eyebrow">${escapeHtml(c.game)}${c.featured ? ' · <span class="eyebrow-gold">Showcase pick</span>' : ''}</p>
    <h2 id="dlgName">${escapeHtml(c.name)}</h2>
    <p class="dialog-set">${escapeHtml([setLine(c), c.variant].filter(Boolean).join(' · '))}</p>
    <div class="dialog-price">${c.status === 'sold' ? '<span class="price">Sold</span>' : c.price === null ? '<span class="price" style="font-size:26px">Price on request</span>' : `<span class="price">${money(c.price)}</span>`}${marketHtml(c)}</div>
    <div class="dialog-status">${statusBadgeHtml}${gradeBadge(c)}${qty}</div>
    <div class="dialog-actions">
      ${contact}
      <button class="btn btn-ghost" type="button" data-copy="${escapeHtml(link)}">Copy link</button>
    </div>
    <dl class="specs">
      ${spec('Condition', conditionText(c))}
      ${c.graded ? spec('Cert #', c.certNumber) : ''}
      ${spec('Set', c.set)}
      ${spec('Card #', c.number)}
      ${spec('Rarity', c.rarity)}
      ${spec('Variant', c.variant)}
      ${spec('Language', c.language)}
      ${spec('Year', c.year)}
    </dl>
    ${c.description ? `<p class="dialog-desc">${escapeHtml(c.description)}</p>` : ''}
    ${c.tags.length ? `<div class="dialog-tags">${c.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
  `;
  const multi = state.openList.length > 1;
  document.querySelectorAll('.dialog-nav').forEach((b) => (b.hidden = !multi));
}

function stepDialog(delta) {
  const n = state.openList.length;
  if (n < 2) return;
  state.openIndex = (state.openIndex + delta + n) % n;
  renderDialog();
  history.replaceState(null, '', `#card=${encodeURIComponent(state.openList[state.openIndex].id)}`);
}

// ------------------------------------------------------------------- events

function bindEvents() {
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const inShowcase = open.closest('#showcaseTrack, #heroFan');
      const list = inShowcase ? state.catalog.cards.filter((c) => c.featured && c.status !== 'sold') : null;
      openCard(open.dataset.open, inShowcase && list.some((c) => c.id === open.dataset.open) ? list : null);
      return;
    }
    const chip = e.target.closest('[data-game]');
    if (chip) {
      state.filters.game = chip.dataset.game;
      renderGrid();
      return;
    }
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      const track = $('#showcaseTrack');
      track.scrollBy({ left: Number(scroll.dataset.scroll) * track.clientWidth * 0.8, behavior: 'smooth' });
    }
  });

  const dlg = $('#cardDialog');
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) {
      dlg.close();
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) return stepDialog(Number(step.dataset.step));
    const thumb = e.target.closest('[data-thumb]');
    if (thumb) return renderDialog(Number(thumb.dataset.thumb));
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(
        () => toast('Link copied'),
        () => toast(copy.dataset.copy),
      );
      return;
    }
    const main = e.target.closest('#dlgMain');
    if (main) {
      const r = main.getBoundingClientRect();
      main.style.setProperty('--zx', `${((e.clientX - r.left) / r.width) * 100}%`);
      main.style.setProperty('--zy', `${((e.clientY - r.top) / r.height) * 100}%`);
      main.classList.toggle('is-zoomed');
    }
  });
  dlg.addEventListener('close', () => {
    if (location.hash.startsWith('#card=')) history.replaceState(null, '', location.pathname + location.search);
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') stepDialog(1);
    if (e.key === 'ArrowLeft') stepDialog(-1);
  });
  attachHolo($('#dlgMain'), null);

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.q = e.target.value;
      renderGrid();
    }, 120);
  });
  const bindSelect = (id, key) =>
    $(id).addEventListener('change', (e) => {
      state.filters[key] = e.target.value;
      renderGrid();
    });
  bindSelect('#typeFilter', 'type');
  bindSelect('#statusFilter', 'status');
  bindSelect('#sort', 'sort');
  const bindPrice = (id, key) =>
    $(id).addEventListener('input', (e) => {
      const v = e.target.value === '' ? null : Number(e.target.value);
      state.filters[key] = Number.isFinite(v) ? v : null;
      renderGrid();
    });
  bindPrice('#minPrice', 'min');
  bindPrice('#maxPrice', 'max');

  $('#clearFilters').addEventListener('click', () => {
    state.filters = { ...state.filters, q: '', game: 'all', type: 'all', status: 'active', min: null, max: null };
    $('#search').value = '';
    $('#typeFilter').value = 'all';
    $('#statusFilter').value = 'active';
    $('#minPrice').value = '';
    $('#maxPrice').value = '';
    renderGrid();
  });

  $('#viewToggle').addEventListener('click', () => {
    state.view = state.view === 'grid' ? 'list' : 'grid';
    try {
      localStorage.setItem('routeone-view', state.view);
    } catch {}
    updateViewToggle();
    renderGrid();
  });

  $('#printBtn').addEventListener('click', () => window.print());

  window.addEventListener('hashchange', openFromHash);
}

function updateViewToggle() {
  const btn = $('#viewToggle');
  const toList = state.view === 'grid';
  btn.setAttribute('aria-label', toList ? 'Switch to list view' : 'Switch to grid view');
  btn.innerHTML = toList
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
}

function openFromHash() {
  const m = location.hash.match(/^#card=(.+)$/);
  if (m) openCard(decodeURIComponent(m[1]));
}

// --------------------------------------------------------------------- boot

async function boot() {
  try {
    state.view = localStorage.getItem('routeone-view') === 'list' ? 'list' : 'grid';
  } catch {}

  let catalog = null;
  if (isPreview) {
    const draft = await loadDraft();
    if (draft) {
      catalog = normalizeCatalog({ publishedAt: null, settings: draft.settings, cards: draft.cards });
      state.localImages = await loadLocalImages();
      $('#previewBanner').hidden = false;
    }
  }
  if (!catalog) {
    try {
      catalog = await loadPublishedCatalog();
    } catch (err) {
      console.error(err);
      catalog = normalizeCatalog({});
      $('#grid').innerHTML = '';
      $('#empty').hidden = false;
      $('#empty').innerHTML =
        '<h3>Catalog unavailable</h3><p>The card list could not be loaded. If you opened this file directly, run it from a web server (see README).</p>';
    }
  }
  state.catalog = catalog;

  renderStoreInfo();
  renderHero();
  renderShowcase();
  updateViewToggle();
  renderGrid();
  bindEvents();
  openFromHash();
}

boot();
