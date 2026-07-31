const CACHE_PREFIX = "shiftdeck-shell";
const CACHE_NAME = `${CACHE_PREFIX}-v3`;
const scopeRoot = new URL("./", self.registration.scope);

async function cacheResponse(cache, request, response) {
  if (response?.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function warmDocumentAssets(cache, response) {
  const html = await response.clone().text();
  const assetUrls = [...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
    .map((match) => new URL(match[1], scopeRoot))
    .filter((url) => url.origin === self.location.origin);

  await Promise.allSettled(
    [...new Set(assetUrls.map((url) => url.href))].map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      await cacheResponse(cache, url, response);
    }),
  );
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(scopeRoot, { cache: "reload" });
  if (response.ok) {
    await cache.put(scopeRoot, response.clone());
    await warmDocumentAssets(cache, response);
  }

  await Promise.allSettled(
    [
      "manifest.webmanifest",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "favicon.svg",
    ].map(async (path) => {
      const url = new URL(path, scopeRoot);
      const response = await fetch(url, { cache: "reload" });
      await cacheResponse(cache, url, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME,
              )
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached =
          (await cache.match(scopeRoot)) ||
          (await cache.match(request, { ignoreSearch: true }));
        try {
          const response = await fetch(request);
          if (!response.ok && cached) return cached;
          if (response.ok) {
            event.waitUntil(
              (async () => {
                await cache.put(scopeRoot, response.clone());
                await warmDocumentAssets(cache, response);
              })(),
            );
          }
          return response;
        } catch (error) {
          if (cached) return cached;
          throw error;
        }
      })(),
    );
    return;
  }

  const cacheableAsset =
    ["script", "style", "font", "image"].includes(request.destination) ||
    url.pathname.startsWith(new URL("data/", scopeRoot).pathname);
  if (!cacheableAsset) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      return cacheResponse(cache, request, response);
    })(),
  );
});
