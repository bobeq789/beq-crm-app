// Echte Datenbank: Supabase. Gleiche Schnittstelle wie demo.js.
// Die Bibliothek wird erst geladen, wenn sie gebraucht wird (im Demo-Modus nie).
import { TABLES, OPTIONAL_TABLES } from './rules.js'

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error('Bibliothek konnte nicht geladen werden'))
    document.head.appendChild(s)
  })
}

// Art des Links aus einer Mail (Passwort zurücksetzen, Einladung, Bestätigung) oder der
// Rückkehr von Google, bevor Supabase die Adresse aufräumt. Fehler kommen im Hash oder in ?…
function readLinkInfo() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : ''
  const hash = raw.includes('access_token') || raw.includes('error') ? new URLSearchParams(raw) : new URLSearchParams()
  const query = new URLSearchParams(location.search)
  const pick = (k) => hash.get(k) || query.get(k)
  return {
    type: hash.get('type'),
    tokens: hash.has('access_token'),
    error: pick('error_code') || pick('error'),
    errorDescription: pick('error_description'),
  }
}

// Lange Texte lädt die App erst beim Öffnen. Diese Spalten kommen beim Start ohne sie.
const LIST_COLUMNS = {
  meetings: 'id,title,held_at,duration_min,project_id,action_items,extra_names,source,external_id,created_by,created_at,updated_at',
  emails: 'id,message_id,thread_id,mailbox,provider_id,direction,from_email,from_name,to_emails,cc_emails,subject,sent_at,attachments,created_at,snippet,labels,attachment_list,mailboxes',
}
// Diese Tabellen sieht ein Gast ohnehin nicht, also gar nicht erst fragen
const TEAM_ONLY = new Set(['meetings', 'meeting_persons', 'events', 'event_persons', 'emails', 'email_persons'])

// Meldung eines Dienstes als Fehler für errorText() (schon für Menschen geschrieben)
function functionError(res, body) {
  const e = new Error(
    body.error || (res.status === 404 ? 'Dieser Dienst ist in Supabase noch nicht eingerichtet. Bitte melde dich beim Admin.' : 'Google ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.')
  )
  e.code = 'meldung'
  return e
}

export async function createSupabaseApi(config) {
  const link = readLinkInfo()
  await loadScript('vendor/@supabase/supabase-js/supabase.js')
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'beqcrm-auth' },
  })

  // Edge Function mit der Anmeldung der Person aufrufen
  async function callFunction(name, payload) {
    const { data } = await client.auth.getSession()
    if (!data.session) throw new Error('JWT expired')
    try {
      return await fetch(config.supabaseUrl + '/functions/v1/' + name, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.session.access_token, apikey: config.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      throw new Error('Failed to fetch')
    }
  }

  const check = ({ data, error }) => {
    if (error) throw error
    return data
  }

  // Supabase liefert höchstens 1000 Zeilen auf einmal, deshalb seitenweise laden
  async function fetchAll(table) {
    const pageSize = 1000
    let from = 0
    let rows = []
    for (;;) {
      const data = check(await client.from(table).select(LIST_COLUMNS[table] || '*').range(from, from + pageSize - 1))
      rows = rows.concat(data)
      if (data.length < pageSize) return rows
      from += pageSize
    }
  }

  return {
    mode: 'supabase',
    linkType: link.type,
    linkTokens: link.tokens,
    linkError: link.error,
    linkErrorDescription: link.errorDescription,

    // ---------- Anmeldung ----------
    async getSession() {
      const { data } = await client.auth.getSession()
      if (!data.session) return null
      const meta = data.session.user.app_metadata || {}
      const providers = meta.providers || (meta.provider ? [meta.provider] : [])
      return { email: data.session.user.email, google: providers.includes('google') }
    },
    onAuthChange(cb) {
      client.auth.onAuthStateChange((event, session) => cb(event, session ? { email: session.user.email } : null))
    },
    async signIn(email, password) {
      check(await client.auth.signInWithPassword({ email, password }))
    },
    async signOut() {
      await client.auth.signOut()
    },
    // Mit Google anmelden: Weiterleitung zu Google, zurück auf diese Seite (nur Konten der beQ)
    async signInWithGoogle() {
      check(
        await client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account', hd: 'beq.com' } },
        })
      )
    },
    // Konto mit Passwort anlegen, Supabase schickt eine Bestätigungsmail
    async signUp(email, password) {
      return check(await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }))
    },
    // beq.com-Adresse nach der Anmeldung ins Team (11_anmeldung_beq.sql), liefert die Rolle
    async joinTeam() {
      const { data, error } = await client.rpc('join_beq_team')
      return error ? null : data
    },
    async resetPassword(email) {
      check(await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }))
    },
    async updatePassword(password) {
      check(await client.auth.updateUser({ password }))
    },
    async myRole() {
      return check(await client.rpc('my_role'))
    },
    async adminName() {
      const { data, error } = await client.rpc('crm_admin_name')
      return error ? null : data
    },

    // ---------- Zweiter Faktor (TOTP) ----------
    async mfaStatus() {
      const aal = check(await client.auth.mfa.getAuthenticatorAssuranceLevel())
      const factors = check(await client.auth.mfa.listFactors())
      return { level: aal.currentLevel, factors: (factors.totp || []).filter((f) => f.status === 'verified') }
    },
    async mfaEnroll() {
      // Reste abgebrochener Versuche entfernen, sonst scheitert ein neuer Versuch am gleichen Namen
      const factors = check(await client.auth.mfa.listFactors())
      for (const f of factors.all || []) {
        if (f.status === 'unverified') await client.auth.mfa.unenroll({ factorId: f.id })
      }
      const data = check(
        await client.auth.mfa.enroll({
          factorType: 'totp',
          issuer: 'beQ CRM',
          friendlyName: 'beQ CRM ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
        })
      )
      return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }
    },
    async mfaVerify(factorId, code) {
      check(await client.auth.mfa.challengeAndVerify({ factorId, code }))
    },
    // Nach dem Einrichten eines neuen Faktors die alten entfernen
    async mfaRemoveOthers(keepId) {
      const factors = check(await client.auth.mfa.listFactors())
      for (const f of factors.totp || []) {
        if (f.id !== keepId) check(await client.auth.mfa.unenroll({ factorId: f.id }))
      }
    },

    // ---------- Daten ----------
    async loadAll(role) {
      const guest = role === 'gast'
      const tables = TABLES.filter((t) => !(guest && TEAM_ONLY.has(t)) && !(guest && t === 'team_members'))
      const lists = await Promise.all(tables.map(fetchAll))
      const db = Object.fromEntries([...TABLES, ...OPTIONAL_TABLES].map((t) => [t, []]))
      tables.forEach((t, i) => (db[t] = lists[i]))
      // Verzichtbare Tabellen (zum Beispiel project_shares vor 05_projekte_teilen.sql): Fehler heißt leer
      const optional = await Promise.all(OPTIONAL_TABLES.map((t) => fetchAll(t).catch(() => [])))
      OPTIONAL_TABLES.forEach((t, i) => (db[t] = optional[i]))
      if (guest) {
        // Gäste lesen das Team nur über crm_users() (Name und Rolle für die Anzeige)
        const users = check(await client.rpc('crm_users'))
        db.team_members = users.map((u) => ({ id: u.email, email: u.email, name: u.name, role: u.role, active: true }))
      }
      return db
    },
    async fetchRow(table, id) {
      return check(await client.from(table).select('*').eq('id', id).maybeSingle())
    },
    async searchMeetingSummaries(q) {
      const pattern = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'
      const data = check(await client.from('meetings').select('id').ilike('summary', pattern).limit(300))
      return data.map((r) => r.id)
    },
    // Verlauf einer Karte, neueste oben
    async cardEvents(cardId) {
      return check(await client.from('card_events').select('*').eq('card_id', cardId).order('at', { ascending: false }).limit(200))
    },
    // Karte als gesehen merken (über card_id und email)
    async markSeen(cardId, email) {
      check(await client.from('card_seen').upsert({ card_id: cardId, email: email.toLowerCase(), seen_at: new Date().toISOString() }, { onConflict: 'card_id,email' }))
    },
    // Marken „Neu“ (und später „@ dich“)
    async cardFlags() {
      return check(await client.rpc('my_card_flags'))
    },
    // ---------- Dateien (07_dateien.sql) ----------
    async listFiles(cardId) {
      const { data, error } = await client.storage
        .from('dateien')
        .list(`karten/${cardId}`, { limit: 500, sortBy: { column: 'created_at', order: 'desc' } })
      if (error) throw error
      return (data || [])
        .filter((f) => f.id)
        .map((f) => ({ path: `karten/${cardId}/${f.name}`, size: f.metadata ? f.metadata.size : null, created_at: f.created_at }))
    },
    async uploadFile(path, file) {
      const { error } = await client.storage.from('dateien').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
      if (error) throw error
    },
    // Signierter Link, 10 Minuten gültig
    async fileUrl(path) {
      const { data, error } = await client.storage.from('dateien').createSignedUrl(path, 600)
      if (error) throw error
      return data.signedUrl
    },
    async removeFile(path) {
      const { data, error } = await client.storage.from('dateien').remove([path])
      if (error) throw error
      // Ohne Berechtigung meldet Supabase keinen Fehler, sondern löscht einfach nichts
      if (!data || !data.length) {
        const e = new Error('permission denied')
        e.code = '42501'
        throw e
      }
    },
    async logFile(cardId, name) {
      check(await client.rpc('log_file', { card: cardId, file_name: name }))
    },

    // ---------- Postfächer (10_postfaecher.sql, Edge Function „google-verbinden“) ----------
    // Liefert die Google-Adresse, bei der sich die Person anmeldet und zustimmt
    async connectMailbox(opts = {}) {
      const { data } = await client.auth.getSession()
      if (!data.session) throw new Error('JWT expired')
      let res
      try {
        res = await fetch(config.supabaseUrl + '/functions/v1/google-verbinden', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + data.session.access_token, apikey: config.supabaseKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', login_hint: opts.loginHint || undefined }),
        })
      } catch {
        throw new Error('Failed to fetch')
      }
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) return body.url
      const e = new Error(
        body.error || (res.status === 404 ? 'Die Verbindung zu Google ist noch nicht eingerichtet. Bitte melde dich beim Admin.' : 'Google ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.')
      )
      e.code = 'meldung'
      throw e
    },
    // Dienst „google-mail“: senden, löschen (JSON) und Anhänge (Datei)
    async mailAction(action, payload) {
      const res = await callFunction('google-mail', { action, ...payload })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw functionError(res, body)
      return body
    },
    async mailAttachment(emailId, part) {
      const res = await callFunction('google-mail', { action: 'anhang', email_id: emailId, part })
      if (!res.ok) throw functionError(res, await res.json().catch(() => ({})))
      const disp = res.headers.get('Content-Disposition') || ''
      const m = disp.match(/filename\*=UTF-8''([^;]+)/i)
      return { blob: await res.blob(), name: m ? decodeURIComponent(m[1]) : 'Anhang' }
    },
    // Dienst „google-abgleich“ für die eigenen Postfächer sofort starten
    async syncNow() {
      const res = await callFunction('google-abgleich', { quelle: 'app' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw functionError(res, body)
      return body
    },
    async disconnectMailbox(id, deleteData) {
      check(await client.rpc('disconnect_mailbox', { target: id, delete_data: !!deleteData }))
    },

    // Besitzer des Deals an einer Aufgabe, ohne Werte (08_sales.sql)
    async cardDealOwner(cardId) {
      return check(await client.rpc('card_deal_owner', { card: cardId }))
    },

    // Letzte Zuweisung je Karte (04_zustaendig.sql)
    async handovers() {
      return check(await client.rpc('last_handovers'))
    },
    async cardShares(cardId) {
      return check(await client.from('card_shares').select('*').eq('card_id', cardId))
    },
    async insert(table, row) {
      return check(await client.from(table).insert(row).select().single())
    },
    async update(table, id, patch) {
      return check(await client.from(table).update(patch).eq('id', id).select().single())
    },
    async remove(table, id) {
      check(await client.from(table).delete().eq('id', id))
    },
  }
}
