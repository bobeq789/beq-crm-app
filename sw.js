// Service Worker des beQ CRM
// Hält die App-Dateien vor, damit die App schnell startet und auch bei schlechtem Netz aufgeht.
// Fragt immer zuerst das Netz, damit Updates sofort ankommen.
// Anfragen an Supabase (andere Adresse) laufen nie über den Cache.
const VERSION = 'beqcrm-v24'
const FILES = [
  './',
  'index.html',
  'styles.css',
  'config.js',
  'manifest.webmanifest',
  'js/main.js',
  'js/store.js',
  'js/router.js',
  'js/settings.js',
  'js/lib/preact.js',
  'js/lib/util.js',
  'js/lib/icons.js',
  'js/data/rules.js',
  'js/data/seed.js',
  'js/data/demo.js',
  'js/data/supabase.js',
  'js/ui/common.js',
  'js/ui/overview.js',
  'js/ui/board.js',
  'js/ui/card.js',
  'js/ui/meetings.js',
  'js/ui/contacts.js',
  'js/ui/orgs.js',
  'js/ui/auth.js',
  'js/ui/calendar.js',
  'js/ui/emails.js',
  'js/ui/prefs.js',
  'js/ui/shared.js',
  'js/ui/history.js',
  'js/ui/mentions.js',
  'js/ui/files.js',
  'js/ui/deal.js',
  'js/ui/sales.js',
  'js/ui/mailboxes.js',
  'js/ui/postfach.js',
  'js/ui/activities.js',
  'js/ui/tiles.js',
  'js/ui/search.js',
  'js/ui/claude.js',
  'vendor/htm/preact/standalone.module.js',
  'vendor/@supabase/supabase-js/supabase.js',
  'vendor/dompurify/purify.es.mjs',
  'fonts/Jost-Regular.ttf',
  'fonts/Jost-Medium.ttf',
  'fonts/Jost-SemiBold.ttf',
  'fonts/Jost-Bold.ttf',
  'img/logo-dunkel.svg',
  'img/logo-hell.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  // Nur eigene Dateien, nur GET. Supabase und alles Fremde gehen direkt ins Netz.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(VERSION).then((cache) => cache.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  )
})
