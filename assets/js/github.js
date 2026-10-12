// Publishes the catalog straight to the GitHub repo that hosts the site,
// using a personal access token kept only in this browser. Everything goes
// into a single commit (catalog.json + new photos − deleted photos).

import { normalizeCatalog } from './common.js';

const API = 'https://api.github.com';
export const CATALOG_PATH = 'data/catalog.json';
export const IMAGE_DIR = 'images/cards/';
const CONFIG_KEY = 'routeone-github';

export function loadConfig() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
  } catch {}
  return { ...guessRepo(), branch: '', token: '', ...saved };
}

export function saveConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {}
}

export function isConfigured(c) {
  return Boolean(c.owner && c.repo && c.token);
}

/** On GitHub Pages (owner.github.io/repo/) the repo can be read off the URL. */
function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    const repo = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: repo && !repo.endsWith('.html') ? repo : `${m[1]}.github.io` };
  }
  return { owner: 'routeonetcg', repo: 'RouteOneTCGCatalog' };
}

async function api(config, path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).message || '';
    } catch {}
    const hints = {
      401: 'The token was rejected — it may be mistyped or expired.',
      403: 'The token does not have permission. It needs "Contents: Read and write" on this repository.',
      404: 'Repository or branch not found — check the owner/repo names, and that the token can access this repository.',
      409: 'The repository is empty. Add any file to it on GitHub first.',
      422: 'GitHub refused the update — someone may have published at the same moment. Try again.',
    };
    const err = new Error(hints[res.status] || `GitHub error ${res.status}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const repoPath = (c) => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;

export async function resolveBranch(config) {
  if (config.branch) return config.branch;
  const repo = await api(config, repoPath(config));
  return repo.default_branch;
}

/** Checks the token works and can write. Returns a short description. */
export async function testConnection(config) {
  const repo = await api(config, repoPath(config));
  if (repo.permissions && !repo.permissions.push) {
    throw new Error('This token can read the repository but cannot write to it. Give it "Contents: Read and write".');
  }
  const branch = config.branch || repo.default_branch;
  await api(config, `${repoPath(config)}/git/ref/heads/${encodeURIComponent(branch)}`);
  return `Connected to ${repo.full_name} (branch “${branch}”).`;
}

/** Reads the latest published catalog directly from GitHub (no Pages cache). */
export async function fetchRemoteCatalog(config) {
  const branch = await resolveBranch(config);
  try {
    const raw = await api(config, `${repoPath(config)}/contents/${CATALOG_PATH}?ref=${encodeURIComponent(branch)}`, {
      headers: { Accept: 'application/vnd.github.raw+json' },
      cache: 'no-store',
    });
    return normalizeCatalog(raw);
  } catch (err) {
    if (err.status === 404) return null; // nothing published yet
    throw err;
  }
}

/**
 * @param {object} config        owner/repo/branch/token
 * @param {object} catalog       { publishedAt, settings, cards }
 * @param {Map<string,string>} localImages  path -> data URL for photos not yet uploaded
 * @param {(msg:string)=>void} log
 */
export async function publish(config, catalog, localImages, log = () => {}) {
  const base = repoPath(config);
  const branch = await resolveBranch(config);
  log(`Connecting to ${config.owner}/${config.repo} (${branch})…`);

  const ref = await api(config, `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const headCommit = await api(config, `${base}/git/commits/${headSha}`);
  const tree = await api(config, `${base}/git/trees/${headCommit.tree.sha}?recursive=1`);
  const existing = new Set(tree.tree.filter((t) => t.type === 'blob').map((t) => t.path));

  const referenced = new Set(catalog.cards.flatMap((c) => c.images).filter((p) => p.startsWith(IMAGE_DIR)));
  const entries = [];

  const toUpload = [...referenced].filter((p) => !existing.has(p) && localImages.has(p));
  const missing = [...referenced].filter((p) => !existing.has(p) && !localImages.has(p));
  if (missing.length) {
    log(`Warning: ${missing.length} photo(s) are missing on this device and were skipped.`);
  }

  let done = 0;
  for (const path of toUpload) {
    const dataUrl = localImages.get(path);
    const content = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const blob = await api(config, `${base}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'base64' }),
    });
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    done += 1;
    log(`Uploaded photo ${done} of ${toUpload.length}`);
  }

  // Remove photos no card uses any more (keeps the repo tidy).
  const orphans = [...existing].filter((p) => p.startsWith(IMAGE_DIR) && /\.(jpe?g|png|webp)$/i.test(p) && !referenced.has(p));
  orphans.forEach((path) => entries.push({ path, mode: '100644', type: 'blob', sha: null }));
  if (orphans.length) log(`Removing ${orphans.length} unused photo(s)`);

  // Missing photos would show as broken images, so drop them from the cards.
  const cleaned = {
    ...catalog,
    cards: catalog.cards.map((c) => ({ ...c, images: c.images.filter((p) => !missing.includes(p)) })),
  };
  entries.push({ path: CATALOG_PATH, mode: '100644', type: 'blob', content: `${JSON.stringify(cleaned, null, 2)}\n` });

  log('Saving catalog…');
  const newTree = await api(config, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries }),
  });
  const n = cleaned.cards.length;
  const commit = await api(config, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `Update catalog (${n} card${n === 1 ? '' : 's'})${toUpload.length ? `, ${toUpload.length} new photo${toUpload.length === 1 ? '' : 's'}` : ''}`,
      tree: newTree.sha,
      parents: [headSha],
    }),
  });
  await api(config, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });
  log('Published!');
  return { catalog: cleaned, commit: commit.sha, uploaded: toUpload.length, removed: orphans.length };
}
