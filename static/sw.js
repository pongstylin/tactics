/*
 * This is a Service Worker (sw) created to support these goals:
 *   1) Meet the criteria for an "Add to Home Screen" prompt for mobile devices.
 *   2) Will ultimately provide true offline mode for the game.
 *   3) Make it unnecessary to repeatedly download resources while developing.
 */
// These bundles are cached during the install phase.
const INSTALLED_BUNDLES = [
  {
    name: 'app-v1',
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
const DYNAMIC_BUNDLE = 'dynamic-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all(
      INSTALLED_BUNDLES.map(
        bundle => caches.open(bundle.name).then(cache => cache.addAll(bundle.urls))
      )
    )
  );
});

self.addEventListener('fetch', event => {
  let url = event.request.url;

  event.respondWith(
    caches.match(event.request).then(response => {
      // Cache hit.  Return response (unless it is a localhost URL)
      if (response && !url.startsWith('http://localhost:2000/'))
        return response;

      let request;
      if (event.request.mode !== 'cors')
        // No opaque responses please.  We want to cache on success.
        request = new Request(url, {mode: 'cors'});
      else
        request = event.request.clone();

      // Cache miss.  Fetch response and cache it.
      return fetch(request).then(response => {
        // Only cache successful responses.
        if (!response || response.status !== 200)
          return response;

        // Clone the response before the body is consumed.
        let responseClone = response.clone();
        caches.open(DYNAMIC_BUNDLE).then(cache => cache.put(event.request, responseClone));

        return response;
      });
    })
  );
});

// Delete old caches.
self.addEventListener('activate', event => {
  let activeCacheNames = INSTALLED_BUNDLES.map(bundle => bundle.name);
  activeCacheNames.push(DYNAMIC_BUNDLE);

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (activeCacheNames.indexOf(cacheName) === -1)
            return caches.delete(cacheName);
        })
      );
    })
  );
});
