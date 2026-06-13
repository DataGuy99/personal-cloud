// src/main.js -- App entry point
import { db, addFile, getFiles, searchFiles, getLastSync, setLastSync } from './db.js';
import { listFiles, syncWithServer, uploadFile, getThumbnailUrl, getDownloadUrl } from './api.js';
import './style.css';

const CATEGORIES = ['all', 'photos', 'videos', 'music', 'docs', 'memes', 'tv'];

let state = {
  files: [],
  category: 'all',
  searchQuery: '',
  searching: false,
  uploading: false,
  syncing: false
};

// --- Render ---

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString();
}

function getFileIcon(mimeType) {
  if (mimeType.startsWith('image/')) return '\u{1F4F7}';
  if (mimeType.startsWith('video/')) return '\u{1F3AC}';
  if (mimeType.startsWith('audio/')) return '\u{1F3B5}';
  if (mimeType.includes('pdf')) return '\u{1F4C4}';
  if (mimeType.includes('text')) return '\u{1F4DD}';
  return '\u{1F4CE}';
}

function getCategoryFromMime(mimeType) {
  if (mimeType.startsWith('image/')) return 'photos';
  if (mimeType.startsWith('video/')) return 'videos';
  if (mimeType.startsWith('audio/')) return 'music';
  return 'docs';
}

function renderFileCard(file) {
  const isImage = file.mimeType.startsWith('image/');
  const isVideo = file.mimeType.startsWith('video/');
  const isAudio = file.mimeType.startsWith('audio/');
  const thumbUrl = getThumbnailUrl(file);
  const dlUrl = getDownloadUrl(file);

  let mediaHtml = '';
  if (isImage) {
    mediaHtml = `<div class="card-media"><img src="${thumbUrl}" alt="${file.name}" loading="lazy"></div>`;
  } else if (isVideo) {
    mediaHtml = `<div class="card-media card-media--video"><img src="${thumbUrl}" alt="${file.name}" loading="lazy"><div class="play-badge">&#9654;</div></div>`;
  } else if (isAudio) {
    mediaHtml = `<div class="card-media card-media--audio"><div class="audio-icon">${getFileIcon(file.mimeType)}</div><div class="audio-name">${file.name}</div></div>`;
  } else {
    mediaHtml = `<div class="card-media card-media--doc"><div class="doc-icon">${getFileIcon(file.mimeType)}</div></div>`;
  }

  return `
    <div class="file-card" data-id="${file.id}" data-path="${file.path || ''}">
      ${mediaHtml}
      <div class="card-info">
        <div class="card-name" title="${file.name}">${file.name}</div>
        <div class="card-meta">
          <span>${formatSize(file.size)}</span>
          <span>${formatTime(file.uploadedAt)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <header class="header">
      <div class="header-top">
        <h1 class="header-title">Personal Cloud</h1>
        <button class="btn-icon" id="btn-sync" title="Sync">${state.syncing ? '...' : '\u{1F504}'}</button>
      </div>
      <div class="search-bar">
        <input type="text" id="search-input" placeholder="Search files..." value="${state.searchQuery}">
      </div>
      <div class="filter-tabs">
        ${CATEGORIES.map(c => `
          <button class="tab ${state.category === c ? 'tab--active' : ''}" data-cat="${c}">
            ${c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        `).join('')}
      </div>
    </header>

    <main class="stream" id="stream">
      ${state.files.length === 0
        ? '<div class="empty-state">No files yet. Upload something!</div>'
        : state.files.map(renderFileCard).join('')}
    </main>

    <button class="fab" id="fab-upload" title="Upload">+</button>
    <input type="file" id="file-input" multiple hidden>
  `;

  bindEvents();
}

// --- Events ---

function bindEvents() {
  // Filter tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.category = tab.dataset.cat;
      loadFiles();
    });
  });

  // Search
  const searchInput = document.getElementById('search-input');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    state.searchQuery = e.target.value;
    searchTimeout = setTimeout(() => {
      if (state.searchQuery.length >= 2) {
        doSearch(state.searchQuery);
      } else if (state.searchQuery.length === 0) {
        loadFiles();
      }
    }, 300);
  });

  // Upload FAB
  document.getElementById('fab-upload').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    state.uploading = true;
    for (const file of files) {
      try {
        await uploadFile(file);
        await addFile({
          id: crypto.randomUUID(),
          name: file.name,
          path: '/incoming/' + file.name,
          category: getCategoryFromMime(file.type),
          mimeType: file.type,
          size: file.size,
          uploadedAt: Date.now(),
          lastAccessed: Date.now(),
          cached: false
        });
      } catch (err) {
        console.error('Upload failed:', file.name, err);
      }
    }
    state.uploading = false;
    e.target.value = '';
    loadFiles();
  });

  // Sync button
  document.getElementById('btn-sync').addEventListener('click', doSync);

  // File card clicks
  document.querySelectorAll('.file-card').forEach(card => {
    card.addEventListener('click', () => {
      const path = card.dataset.path;
      if (path && path !== '#') {
        window.open(getDownloadUrl({ path }), '_blank');
      }
    });
  });
}

// --- Data loading ---

async function loadFiles() {
  try {
    // Try local DB first
    const localFiles = await getFiles({
      category: state.category === 'all' ? null : state.category
    });
    if (localFiles.length > 0) {
      state.files = localFiles;
    } else {
      // Fall back to API
      const apiFiles = await listFiles('/', { category: state.category });
      state.files = apiFiles;
      // Cache in IndexedDB
      for (const f of apiFiles) {
        await addFile(f);
      }
    }
  } catch (err) {
    console.error('Load failed:', err);
    state.files = [];
  }
  renderApp();
}

async function doSearch(query) {
  try {
    state.files = await searchFiles(query);
  } catch (err) {
    console.error('Search failed:', err);
  }
  renderApp();
}

async function doSync() {
  state.syncing = true;
  renderApp();
  try {
    const lastSync = await getLastSync();
    const delta = await syncWithServer(lastSync);
    for (const f of delta.new) await addFile(f);
    for (const f of delta.updated) await addFile(f);
    for (const f of delta.deleted) await db.files.delete(f.id);
    await setLastSync(Date.now());
  } catch (err) {
    console.error('Sync failed:', err);
  }
  state.syncing = false;
  loadFiles();
}

// --- Init ---
loadFiles();
