import config from 'config/client.js';

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

// Application files are fetched and installed as a unit to ensure they are
// compatible with each other.  If a file can change between app versions and
// the change can break the app, it should be referenced here.
const APP_FILES = [
  '/',
  '/theme.min.js',
  '/errors.min.js',
  '/install.min.js',
  '/tactics.min.js',
  '/check.min.js',
  '/online.html',
  '/online.min.js',
  '/profile.html',
  '/profile.min.js',
  '/security.html',
  '/security.min.js',
  '/addDevice.html',
  '/addDevice.min.js',
  '/game.html',
  '/game-app.min.js',

  '/classic.html',
  '/classic-app.min.js',

  '/faceoff.html',
  '/faceoff-app.min.js',

  '/chaos.html',
  '/chaos-app.min.js',

  '/ww.min.js',
];

// Application files are installed and cached with a version-specific name.  The
// currently installed app version remains unaffected while installing the new.
//
// VERSION is used instead of config.version to ensure that this file is modified
// with each version build.  This helps browsers to detect changes.  The VERSION
// variable is replaced during the building process.
const SUFFIX = ENVIRONMENT === 'development' ? '' : '-'+VERSION;
const INSTALL_CACHE_NAME = 'app' + SUFFIX;

// Other files within the scope of this service worker are fetched and cached as
// needed.  They are not expected to change often or at all so this cache is
// shared between versions and is not normally cleared.  This cache is expected
// to contain image, sound, and data files or even 3rd-party dependencies.  The
// cache can be cleared manually by bumping the cache version for these reasons:
//   1) A minor change to a file has taken place (e.g. changing an image)
//   2) A file is moved from the fetch cache to the install cache.
//   3) One or more files are no longer used by a new app version.
const FETCH_CACHE_NAME = 'dynamic-20250903';
const LOCAL_CACHE_NAME = 'local';

const ACTIVE_CACHE_NAMES = [
  INSTALL_CACHE_NAME,
  FETCH_CACHE_NAME,
  LOCAL_CACHE_NAME,
];

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
  event.waitUntil(new Promise(async (resolve, reject) => {
    try {
      const cache = await caches.open(INSTALL_CACHE_NAME);

      await Promise.all(APP_FILES.map(async url => {
        try {
          const rsp = await fetch(url, OPTIONS);
          if (!rsp.ok)
            throw new Error(`Response is not ok: [${response.status}]`);

          await cache.put(url, rsp);
        } catch (e) {
          e.fileName = url;
          throw e;
        }
      }));

      await self.skipWaiting();
      resolve();
    } catch (e) {
      e.context = 'install';
      reject(e);
    }
  }));
});

/*
 * A cache hit is represented as: [cache, response]
 * A cache miss is represented as: [dynamicCache, null]
 *
 * Returns a promise, which resolves to a cache hit or cache miss.
 * The cache can be used to create or replace a request/response.
 */
function getCache(url) {
  return ACTIVE_CACHE_NAMES.reduce((promise, cacheName) =>
      promise.then(hit => hit ||
        caches.open(cacheName).then(cache =>
          cache.match(url).then(response => response && [cache, response])
        )
      ),
      Promise.resolve(),
    )
    .then(hit => hit ||
      caches.open(FETCH_CACHE_NAME).then(cache => [cache, null])
    );
}

/*
 * This is the only way to share data between the browser and PWA on iOS.
 */
const LOCAL_ENDPOINT = config.local.origin + '/local.json';
const API_ENDPOINT = config.local.apiEndpoint;
const TEST_NO_STORE = /\bno-store\b/;

async function routeLocalRequest(request) {
  const responseMeta = {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const cache = await caches.open(LOCAL_CACHE_NAME);

  if (request.method === 'POST') {
    const data = await request.json();

    try {
      await cache.put(LOCAL_ENDPOINT, new Response(JSON.stringify(data), responseMeta));
    } catch (e) {
      e.context = 'routeLocalRequest';
      if (e.name === 'QuotaExceededError')
        return new Response(null, {
          status: 200,
          statusText: 'Ok',
        });
      throw e;
    }

    return new Response(null, {
      status: 201,
      statusText: 'Created',
    });
  } else if (request.method === 'DELETE') {
    await cache.delete(LOCAL_ENDPOINT);

    return new Response(null, {
      status: 200,
      statusText: 'Deleted',
    });
  } else /* GET */ {
    const response = await cache.match(LOCAL_ENDPOINT);

    return response || new Response('{}', responseMeta);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const baseURL = url.origin + url.pathname;

  // The local endpoint gets special treatment.
  if (baseURL === LOCAL_ENDPOINT)
    return event.respondWith(routeLocalRequest(request));

  // Do the default thing for non HTTP(S) requests.
  // Example: chrome-extension://...
  if (!/https?:/.test(url.protocol))
    return;
  // Do not interfere with the auth callback.
  if (baseURL === `${API_ENDPOINT}/auth/callback`)
    return;
  // Only handle GET requests.
  // Note: This placement ensures POST/DELETE to the LOCAL_ENDPOINT work.
  if (request.method !== 'GET')
    return;

  /*
   * Do not handle requests to domains relating to google translation
   * TODO: Use a whitelist, instead.
   */
  if (url.origin === 'https://translate.google.com')
    return;
  if (url.origin === 'https://www.gstatic.com')
    return;
  if (url.origin === 'https://ssl.gstatic.com')
    return;

  /*
   * Use the baseURL to fetch the resource since parameters may bloat caching
   * and are meant to be used client-side only.
   */
  event.respondWith(
    getCache(baseURL).then(([cache, cachedResponse]) => {
      // Return cached response (unless it is a localhost URL)
      if (cachedResponse && (ENVIRONMENT !== 'development' || url.hostname !== 'localhost'))
        return cachedResponse;

      let fetchPromise;
      // Google Fonts API disallows CORS requests.
      if (baseURL.startsWith('https://fonts.googleapis.com/css'))
        fetchPromise = fetch(request);
      else if (url.origin === 'https://fonts.gstatic.com')
        fetchPromise = fetch(request);
      else
        fetchPromise = fetch(baseURL, OPTIONS);

      // Cache miss or localhost URL.  Fetch response and cache it.
      return fetchPromise
        .then(response => {
          // Only cache successful responses.
          if (!response.ok)
            return response;

          /*
           * Do not cache GET API requests that request no-store.
           */
          const headers = response.headers;
          if (baseURL.startsWith(API_ENDPOINT) && headers.has('Cache-Control')) {
            const cacheControl = headers.get('Cache-Control');
            if (TEST_NO_STORE.test(cacheControl))
              return response;
          }

          // Clone the response before the body is consumed.
          cache.put(baseURL, response.clone()).catch(() => {});

          return response;
        })
        .catch(error => {
          // If a potentially stale locally hosted resource is cached, return it.
          if (cachedResponse)
            return cachedResponse;

          // Hijack the fileName field to report the URL that failed to fetch.
          error.context = 'fetch';
          error.fileName = baseURL;
          throw error;
        });
    })
  );
});

// Delete previous version caches.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (ACTIVE_CACHE_NAMES.indexOf(cacheName) === -1)
            return caches.delete(cacheName);
        })
      );
    })
  );
});

/*
 * Scenario:
 *   A device comes online and receives a backlog of multiple notifications.
 *   We know that the notifications were delayed because notifications are time-
 *   stamped with their creation date and that date is more than 2 minutes ago.
 *   But, the notifications may no longer be relevant.  The user may have acted
 *   upon them on another device already.  To avoid displaying irrelevant data,
 *   fresh notification data is retrieved from the server.  If the fresh data
 *   indicates that no notification is required, then a no-op one is shown and
 *   quickly closed automatically.  This is because every 'push' event is
 *   required to show a notification.  Also note that we don't want to hit the
 *   server for fresh notification data for each delayed notification in the
 *   list.  So, check for an existing notification.  If one exists and shows a
 *   newer creation date, then use it - assuming it isn't more than 2min old.
 */
async function showNotification(event) {
  let data = event.data.json();
  const notifications = await self.registration.getNotifications();
  const currentNotification = notifications.find(n => n.tag === data.type);

  /*
   * If the current notification is newer, repost it.
   * The current notification might be newer if obtained from the server before
   * a series of delayed notifications.
   */
  if (currentNotification && currentNotification.data)
    if (currentNotification.data.createdAt > data.createdAt)
      data = currentNotification.data;

  /*
   * If notification data is significantly old or delayed, refresh it.
   */
  const diff = new Date() - new Date(data.createdAt);
  if (diff > 120000) { // 2min
    const endpoint = `${API_ENDPOINT}/notifications/${data.type}`;

    try {
      const localRsp = await routeLocalRequest({ method:'GET' });
      const localData = await localRsp.json();
      const token = localData.token;
      const rsp = await fetch(endpoint, Object.assign({
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }, OPTIONS));
      if (rsp.ok)
        data = await rsp.json();
    }
    catch (error) {
      report({
        endpoint,
        error: getErrorData(error),
      });
    }
  }

  let title;
  let options;
  let autoClose = false;
  if (data.type === 'yourTurn') {
    if (data.gameCount === 0)
      title = 'Not your turn!';
    else
      title = `It's your turn!`;

    options = {
      icon: '/emblem_512.png',
      timestamp: new Date(data.turnStartedAt || data.createdAt),
      requireInteraction: !!data.gameCount,
      tag: data.type,
      data: data,
    };

    if (data.gameCount === 0)
      options.body = 'You made your move before getting this notification.';
    else if (data.gameCount === 1)
      options.body = `${data.opponent} is waiting.`;
    else
      options.body = `${data.gameCount} games are waiting.`;

    // If not their turn, auto close notification almost immediately.
    // (Necessary since NOT showing a notification is not allowed)
    if (data.gameCount === 0)
      autoClose = true;
  }
  else
    throw new Error('Unsupported notification type');

  return self.registration.showNotification(title, options).then(() => {
    if (!autoClose) return;

    setTimeout(async () => {
      const notifications = await self.registration.getNotifications();
      const newNotification = notifications.find(n => n.tag === data.type);
      if (newNotification)
        newNotification.close();
    }, 100);
  });
}
self.addEventListener('push', event => {
  event.waitUntil(showNotification(event));
});

self.addEventListener('notificationclick', event => {
  const data = event.notification.data || {
    type: event.notification.tag,
  };
  let url;

  if (data.type === 'yourTurn') {
    if (data.gameId)
      url = '/game.html?' + data.gameId;
    else
      url = '/online.html#active';
  }

  if (url) {
    let matchUrl = url;
    if (matchUrl.startsWith('/'))
      // Find an open window by absolute URL
      matchUrl = self.registration.scope.slice(0, -1) + url;

    event.waitUntil(
      getClientByURL(matchUrl).then(client => {
        if (client && client.focus)
          return client.focus();
        else
          return self.clients.openWindow(url);
      })
    );
  }

  event.notification.close();
});

self.addEventListener('message', async event => {
  const client  = event.source;
  const message = event.data;

  if (message.type === 'version')
    client.postMessage({
      type: 'version',
      data: { version:config.version },
    });
  else if (message.type === 'skipWaiting')
    self.skipWaiting();
});

self.addEventListener('error', event => {
  try {
    const now = new Date();

    report({
      type: event.type,
      message: event.message,
      filename: event.filename,
      lineno: event.lineno === undefined ? null : event.lineno,
      colno: event.colno  === undefined ? null : event.colno,
      error: event.error ? getErrorData(event.error) : null,
    }, now);
  }
  catch (e) {
    let error = 'Log error failed: ' + e;
    error = error.replace(/"/g, '\\"');

    report({ error });
  }
});
self.addEventListener('unhandledrejection', event => {
  try {
    const now = new Date();
    const reportData = {
      type: event.type,
    };
    const error = event.reason;

    if (error instanceof Error)
      reportData.error = getErrorData(error);
    else if (error !== undefined)
      reportData.error = error + '';

    report(reportData, now);
  } catch (e) {
    let error = 'Log reject failed: ' + e;
    error = error.replace(/"/g, '\\"');

    report({ error });
  }
});

function getClientByURL(url) {
  return clients.matchAll({ type:'window' }).then(clients => {
    for (let client of clients) {
      if (client.url === url)
        return client;
    }
  });
}

function getErrorData(error) {
  let stack = error.stack;
  if (typeof stack === 'string') {
    stack = stack.split('\n');
    if (stack[0] === `${error.name}: ${error.message}`)
      stack.shift();
  }

  return {
    name: error.name,
    code: error.code,
    message: error.message,
    context: error.context,
    fileName: error.fileName,
    lineNumber: error.lineNumber,
    columnNumber: error.columnNumber,
    stack,
  };
}

function report(data, now) {
  if (now === undefined)
    now = new Date();
  if (data === undefined || data === null)
    return;

  if (typeof data !== 'object')
    data = { report:data };

  data.createdAt = now;
  data.page = self.registration.scope + 'sw.js';

  sendReport(data);
}

async function sendReport(data) {
  try {
    await fetch(`${API_ENDPOINT}/report`, Object.assign({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    }, OPTIONS));
  } catch(error) {
    setTimeout(() => sendReport(data), 5000);
  }
}
