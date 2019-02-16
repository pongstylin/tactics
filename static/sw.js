/*
 * This is a Service Worker (sw) created to support these goals:
 *   1) Meet the criteria for an "Add to Home Screen" prompt for mobile devices.
 *   2) Will ultimately provide true offline mode for the game.
 *   3) Make it unnecessary to repeatedly download resources while developing.
 *
 * Note: This service worker disables all use of the traditional browser cache.
 * Rather, a custom cache is used that never expires, but may be replaced by
 * updating the service worker.
 */

// These bundles are cached during the install phase.
const INSTALLED_BUNDLES = [
  {
    name: 'app-v0.2.5',
    urls: [
      '/',
      '/tactics.min.js',
      '/classic.html',
      '/classic-app.min.js',
      '/faceoff.html',
      '/faceoff-app.min.js',
      '/chaos.html',
      '/chaos-app.min.js',
    ],
  },
];

// Other files are cached as-needed.
const DYNAMIC_BUNDLE = 'dynamic';

// Fetch all resources using these parameters.
const OPTIONS = {
  // Avoid caching resources in two places.
  cache: 'no-store',

  // Avoid problematic opaque responses.
  mode: 'cors',

  // No need to send or receive cookies.
  credentials: 'omit',
};

self.addEventListener('install', event => {
  // Livin' on the edge.  Remove if this causes issues during updates.
  self.skipWaiting();

  event.waitUntil(
    Promise.all(
      INSTALLED_BUNDLES.map(bundle =>
        caches.open(bundle.name)
          .then(cache =>
            Promise.all(
              bundle.urls.map(url =>
                fetch(url, OPTIONS)
                  .then(response => {
                    if (response && response.status === 200)
                      return cache.put(url, response);
                  })
              )
            )
          )
      )
    )
  )
});

/*
 * A cache hit is represented as: [cache, response]
 * A cache miss is represented as: [dynamicCache, null]
 *
 * Returns a promise, which resolves to a cache hit or cache miss.
 * The cache can be used to create or replace a request/response.
 */
function getCache(url) {
  return caches.keys().then(cacheNames =>
    cacheNames.reduce((promise, cacheName) =>
      promise.then(hit => hit ||
        caches.open(cacheName).then(cache =>
          cache.match(url).then(response => response && [cache, response])
        )
      ),
      Promise.resolve(),
    )
  )
    .then(hit => hit ||
      caches.open(DYNAMIC_BUNDLE).then(cache => [cache, null])
    );
}

self.addEventListener('fetch', event => {
  let url = event.request.url;

  event.respondWith(
    getCache(url).then(([cache, cachedResponse]) => {
      // Return cached response (unless it is a localhost URL)
      if (cachedResponse && !url.startsWith('http://localhost:2000/'))
        return cachedResponse;

      // Cache miss or localhost URL.  Fetch response and cache it.
      return fetch(url, OPTIONS)
        .then(response => {
          // Only cache successful responses.
          if (!response || response.status !== 200)
            return response;

          // Clone the response before the body is consumed.
          cache.put(url, response.clone());

          return response;
        })
        .catch(error => {
          // If a potentially stale locally hosted resource is cached, return it.
          if (cachedResponse)
            return cachedResponse;
          throw error;
        });
    })
  );
});

// Delete the dynamic cache and previous version caches.
self.addEventListener('activate', event => {
  let activeCacheNames = INSTALLED_BUNDLES.map(bundle => bundle.name);

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (activeCacheNames.indexOf(cacheName) === -1)
              return caches.delete(cacheName);
          })
        );
      })
      .then(() => clients.claim())
  );
});
