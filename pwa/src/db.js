// src/db.js -- IndexedDB layer via Dexie
import Dexie from 'dexie';

export const db = new Dexie('personal-cloud');

db.version(1).stores({
  files: 'id, name, category, mimeType, size, uploadedAt, lastAccessed, path, cached',
  shares: 'id, owner, name, type, visibility, createdAt, expiresAt',
  shareMembers: '[shareId+username], shareId, username, permission',
  syncState: 'key'
});

// File metadata operations
export async function addFile(file) {
  return db.files.put({ ...file, lastAccessed: Date.now() });
}

export async function getFiles(opts = {}) {
  let collection = db.files.orderBy('uploadedAt').reverse();
  if (opts.category && opts.category !== 'all') {
    collection = db.files.where('category').equals(opts.category).reverse();
  }
  if (opts.limit) collection = collection.limit(opts.limit);
  if (opts.offset) collection = collection.offset(opts.offset);
  return collection.toArray();
}

export async function searchFiles(query) {
  const q = query.toLowerCase();
  return db.files.filter(f => f.name.toLowerCase().includes(q)).toArray();
}

export async function touchFile(id) {
  return db.files.update(id, { lastAccessed: Date.now() });
}

export async function removeFile(id) {
  return db.files.delete(id);
}

export async function getFileCount() {
  return db.files.count();
}

// Sync state
export async function getLastSync() {
  const s = await db.syncState.get('lastSync');
  return s ? s.value : 0;
}

export async function setLastSync(ts) {
  return db.syncState.put({ key: 'lastSync', value: ts });
}

// Eviction
export async function getEvictionCandidates(maxAge = 30 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAge;
  return db.files.where('lastAccessed').below(cutoff).toArray();
}

export async function getLRUFiles(count = 50) {
  return db.files.orderBy('lastAccessed').limit(count).toArray();
}
