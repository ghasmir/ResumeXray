'use strict';

function normalizeAvatarUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (/^\/\//.test(raw)) {
    return `https:${raw}`;
  }

  return '';
}

function firstAvatarUrl(candidates = []) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const url = normalizeAvatarUrl(candidate);
      if (url) return url;
      continue;
    }

    if (!candidate || typeof candidate !== 'object') continue;

    const nestedUrl =
      candidate.url ||
      candidate.identifier ||
      candidate.value ||
      candidate.href ||
      candidate.secure_url ||
      candidate.original;

    const direct = normalizeAvatarUrl(nestedUrl);
    if (direct) return direct;

    const nestedCollections = [
      candidate.data,
      candidate.image,
      candidate.images,
      candidate.elements,
      candidate.identifiers,
      candidate.variants,
      candidate.displayImage,
      candidate['displayImage~'],
      candidate.localized,
    ];

    for (const collection of nestedCollections) {
      if (!collection) continue;
      if (Array.isArray(collection)) {
        const fromArray = firstAvatarUrl(collection);
        if (fromArray) return fromArray;
        continue;
      }
      if (typeof collection === 'object') {
        const fromObject = firstAvatarUrl([collection, ...Object.values(collection)]);
        if (fromObject) return fromObject;
      }
    }
  }

  return '';
}

function extractLinkedInAvatarUrl(profile = {}) {
  if (!profile || typeof profile !== 'object') return '';

  const candidates = [
    profile.picture,
    profile.pictureUrl,
    profile.avatarUrl,
    profile.profilePicture,
    profile.photo,
    profile.image,
    profile.images,
    profile['picture~'],
  ];

  return firstAvatarUrl(candidates);
}

module.exports = {
  extractLinkedInAvatarUrl,
  normalizeAvatarUrl,
};
