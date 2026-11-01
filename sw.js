const CACHE_PREFIX = "market-music-shell-";
const CACHE = `${CACHE_PREFIX}v8`;
// Explicit shell only: data, recordings and network responses never enter this cache.
const SHELL = [
  "./index.html", "./manifest.webmanifest", "./src/style.css",
  "./src/main.js", "./src/pwa.js", "./src/data.js", "./src/features.js",
  "./src/playback.js", "./src/visuals.js", "./src/debug.js", "./src/live-feed.js",
  "./src/live-playback.js", "./src/live-features.js", "./src/live-music.js", "./src/presets.js",
  "./src/live-aggregate.js", "./src/live-controls.js", "./src/composer.js",
  "./src/recording.js", "./src/recording-codec.js", "./src/recording-playback.js",
  "./src/event-score.js", "./src/recording-v3.js",
  "./src/wav.js", "./src/sound.js", "./src/tone-engine.js", "./src/version.js",
  "./vendor/Tone-15.1.22.js", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon-180.png",
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
    .map(key => caches.delete(key)))));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const entry = url.href === self.registration.scope ? new URL("./index.html", self.registration.scope).href : url.href;
  if (!SHELL.includes(entry)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(entry)).then(response => response ?? fetch(event.request)));
});
