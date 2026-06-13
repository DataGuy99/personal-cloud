// src/api.js -- API layer. Uses mock data in dev, real copyparty API in production.

const IS_DEV = !window.location.hostname.match(/copyparty|192\.168|10\.200/);

// Mock data for development
const MOCK_FILES = [
  { id: '1', name: 'vacation-beach.jpg', path: '/pool/photos/vacation-beach.jpg', category: 'photos', mimeType: 'image/jpeg', size: 3200000, uploadedAt: Date.now() - 3600000 },
  { id: '2', name: 'project-notes.pdf', path: '/pool/docs/project-notes.pdf', category: 'docs', mimeType: 'application/pdf', size: 450000, uploadedAt: Date.now() - 7200000 },
  { id: '3', name: 'song-demo.mp3', path: '/pool/music/song-demo.mp3', category: 'music', mimeType: 'audio/mpeg', size: 8500000, uploadedAt: Date.now() - 10800000 },
  { id: '4', name: 'funny-cat.mp4', path: '/pool/memes/funny-cat.mp4', category: 'memes', mimeType: 'video/mp4', size: 15000000, uploadedAt: Date.now() - 14400000 },
  { id: '5', name: 'sunset-timelapse.mp4', path: '/pool/photos/sunset-timelapse.mp4', category: 'photos', mimeType: 'video/mp4', size: 45000000, uploadedAt: Date.now() - 18000000 },
  { id: '6', name: 'recipe-grandma.txt', path: '/pool/docs/recipe-grandma.txt', category: 'docs', mimeType: 'text/plain', size: 2400, uploadedAt: Date.now() - 21600000 },
  { id: '7', name: 'workout-playlist.m4a', path: '/pool/music/workout-playlist.m4a', category: 'music', mimeType: 'audio/mp4', size: 12000000, uploadedAt: Date.now() - 86400000 },
  { id: '8', name: 'meme-drake.jpg', path: '/pool/memes/meme-drake.jpg', category: 'memes', mimeType: 'image/jpeg', size: 180000, uploadedAt: Date.now() - 90000000 },
  { id: '9', name: 'server-diagram.png', path: '/pool/docs/server-diagram.png', category: 'docs', mimeType: 'image/png', size: 520000, uploadedAt: Date.now() - 172800000 },
  { id: '10', name: 'breaking-bad-s01e01.mkv', path: '/pool/tv/breaking-bad-s01e01.mkv', category: 'tv', mimeType: 'video/x-matroska', size: 1500000000, uploadedAt: Date.now() - 259200000 },
];

// Real API calls
async function apiFetch(endpoint, opts = {}) {
  const res = await fetch(endpoint, {
    headers: { 'Accept': 'application/json', ...opts.headers },
    ...opts
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function listFiles(path = '/', opts = {}) {
  if (IS_DEV) {
    let files = [...MOCK_FILES];
    if (opts.category && opts.category !== 'all') {
      files = files.filter(f => f.category === opts.category);
    }
    return files.sort((a, b) => b.uploadedAt - a.uploadedAt);
  }
  return apiFetch(`/api/ls?path=${encodeURIComponent(path)}&json`);
}

export async function searchServer(query) {
  if (IS_DEV) {
    return MOCK_FILES.filter(f => f.name.toLowerCase().includes(query.toLowerCase()));
  }
  return apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
}

export async function uploadFile(file, path = '/incoming') {
  if (IS_DEV) {
    console.log('[MOCK] Upload:', file.name, 'to', path);
    return { ok: true, name: file.name };
  }
  const form = new FormData();
  form.append('file', file);
  return apiFetch(`/api/up?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    body: form,
    headers: {} // let browser set content-type for FormData
  });
}

export async function deleteFile(path) {
  if (IS_DEV) {
    console.log('[MOCK] Delete:', path);
    return { ok: true };
  }
  return apiFetch('/api/del', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
}

export async function syncWithServer(lastSync) {
  if (IS_DEV) {
    return { new: MOCK_FILES.filter(f => f.uploadedAt > lastSync), updated: [], deleted: [] };
  }
  return apiFetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since: lastSync })
  });
}

export function getThumbnailUrl(file) {
  if (IS_DEV) {
    // Placeholder thumbnails for dev
    if (file.mimeType.startsWith('image/')) return `https://placehold.co/300x200/2a2a4a/aaaacc?text=${encodeURIComponent(file.name.slice(0,12))}`;
    if (file.mimeType.startsWith('video/')) return `https://placehold.co/300x200/1a3a2a/aaccaa?text=${encodeURIComponent(file.name.slice(0,12))}`;
    if (file.mimeType.startsWith('audio/')) return `https://placehold.co/300x200/3a1a2a/ccaacc?text=${encodeURIComponent(file.name.slice(0,12))}`;
    return `https://placehold.co/300x200/2a2a2a/cccccc?text=${encodeURIComponent(file.name.slice(0,12))}`;
  }
  return `/api/thumb?path=${encodeURIComponent(file.path)}`;
}

export function getDownloadUrl(file) {
  if (IS_DEV) return '#';
  return `/api/dl?path=${encodeURIComponent(file.path)}`;
}
