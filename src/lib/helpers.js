export function newId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'id_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
}

export function inferSeason(month) {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

export function inferTimeOfDay(hour) {
  return hour >= 6 && hour < 19 ? 'day' : 'night';
}

export function weatherCodeToLabel(code) {
  if (code == null) return 'unknown';
  if ([0].includes(code)) return 'clear';
  if ([1, 2, 3].includes(code)) return 'cloudy';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'mixed';
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const meta = parts[0] || '';
  const b64 = parts[1] || '';
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function guessExtensionFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return 'jpg';
  if (dataUrl.includes('image/png')) return 'png';
  if (dataUrl.includes('image/webp')) return 'webp';
  return 'jpg';
}

export function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function randomPick(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

export async function resizeImageDataUrl(dataUrl, maxSide = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
      const w = Math.max(1, Math.round(image.width * ratio));
      const h = Math.max(1, Math.round(image.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(image, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

export async function fetchWithTimeout(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
