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

    // ---------- Claude-Zugang (E1, 25_claude_zugang.sql, Supabase OAuth Server) ----------
    // Anfrage von Claude: Name, Weiterleitung, Kennung. War Claude schon erlaubt, liefert
    // Supabase nur noch redirect_url (ohne authorization_id).
    async claudeDetails(authorizationId) {
      return check(await client.auth.oauth.getAuthorizationDetails(authorizationId))
    },
    // Erst die Freigabe im CRM (mit zweitem Faktor), dann die Zustimmung bei Supabase
    async claudeApprove(authorizationId, { clientId, clientName, redirectHost }) {
      check(await client.rpc('claude_freigabe_erteilen', { p_client_id: clientId, p_client_name: clientName || null, p_redirect_host: redirectHost || null }))
      const data = check(await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true }))
      return (data && data.redirect_url) || null
    },
    async claudeDeny(authorizationId) {
      const data = check(await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true }))
      return (data && data.redirect_url) || null
    },
    // Zugänge, die Supabase für diese Person kennt (null, wenn Supabase die Liste nicht liefert)
    async claudeGrants() {
      const fn = client.auth.oauth.listGrants || client.auth.oauth.getUserGrants
      if (!fn) return null
      const { data, error } = await fn.call(client.auth.oauth)
      if (error || !Array.isArray(data)) return null
      return data.map((g) => ({ clientId: String(g.client_id || (g.client && (g.client.client_id || g.client.id)) || ''), name: g.client_name || (g.client && (g.client.client_name || g.client.name)) || null })).filter((g) => g.clientId)
    },
    // Freigaben im CRM (nicht entzogen)
    async claudeAccesses() {
      return check(await client.rpc('meine_claude_zugaenge'))
    },
    // Entziehen: zuerst im CRM (sperrt sofort), dann bei Supabase (meldet Claude ab)
    async claudeRevoke(clientId) {
      check(await client.rpc('claude_freigabe_entziehen', { p_client_id: clientId }))
      await this.claudeRevokeGrant(clientId)
    },
    async claudeRevokeGrant(clientId) {
      const { error } = await client.auth.oauth.revokeGrant({ clientId })
      if (error) throw error
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
    // Block aus dem alten CRM (29_altcrm.sql), nur für das Team
    async fetchAltdaten(personId) {
      const row = check(await client.from('kontakt_altdaten').select('inhalt').eq('person_id', personId).maybeSingle())
      return row ? row.inhalt : ''
    },
    async fetchRow(table, id) {
      return check(await client.from(table).select('*').eq('id', id).maybeSingle())
    },
    async searchMeetingSummaries(q) {
      const pattern = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'
      const data = check(await client.from('meetings').select('id').ilike('summary', pattern).limit(300))
      return data.map((r) => r.id)
    },
    // ---------- Follow-up (20_follow_up.sql), nur eigene aktive Postfächer ----------
    // Fehlt die SQL-Datei noch, kommt einfach nichts (statt einer Fehlermeldung)
    async antwortenOffen() {
      try {
        return check(await client.rpc('antworten_offen')) || []
      } catch {
        return []
      }
    },
    async mailsOhneAntwort(days = 60) {
      try {
        return check(await client.rpc('mails_ohne_antwort', { p_tage: days })) || []
      } catch {
        return null
      }
    },
    async postfachNeu() {
      try {
        return (check(await client.rpc('postfach_neu')) || []).map((r) => r.email_id)
      } catch {
        return []
      }
    },
    async postfachGesehen() {
      try {
        return check(await client.rpc('postfach_gesehen'))
      } catch {
        return null
      }
    },
    // „Braucht keine Antwort“ und zurück
    async dismissThread(mailbox, verlauf) {
      check(await client.from('nachfass_aus').upsert({ mailbox, verlauf, at: new Date().toISOString() }, { onConflict: 'person,mailbox,verlauf' }))
    },
    async undismissThread(mailbox, verlauf) {
      check(await client.from('nachfass_aus').delete().eq('mailbox', mailbox).eq('verlauf', verlauf))
    },
    // ---------- Persönliche Einstellungen (21_nutzer_einstellungen.sql), eine Zeile je Person ----------
    async loadPrefs() {
      try {
        const row = check(await client.from('nutzer_einstellungen').select('werte').maybeSingle())
        return (row && row.werte) || {}
      } catch {
        return {}
      }
    },
    async savePrefs(email, werte) {
      check(await client.from('nutzer_einstellungen').upsert({ person: String(email).toLowerCase(), werte }, { onConflict: 'person' }))
    },
    // Mail-Verfolgung (27_mail_spur.sql): Zahlen je eigener verfolgter Mail. Fehlt die SQL-Datei
    // noch, kommt einfach nichts.
    async mailSpuren() {
      try {
        return check(await client.rpc('meine_mail_spuren')) || []
      } catch {
        return []
      }
    },
    // ---------- Chat (30_chat.sql) ----------
    // Räume, Mitglieder und Zahlen über chat_uebersicht(), Nachrichten seitenweise. Fehlt die
    // SQL-Datei noch, gibt es einfach keinen Chat (null).
    async chatOverview() {
      const { data, error } = await client.rpc('chat_uebersicht')
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') return null
        throw error
      }
      return data || []
    },
    async chatMessages(raumId, before = null, limit = 50) {
      let q = client.from('chat_nachrichten').select('*').eq('raum_id', raumId).is('antwort_auf', null).order('created_at', { ascending: false }).limit(limit)
      if (before) q = q.lt('created_at', before)
      return check(await q)
    },
    async chatSend({ id, raum_id, text, erwaehnt, antwort_auf, anhaenge }) {
      const row = { id, raum_id, text, erwaehnt }
      if (antwort_auf) row.antwort_auf = antwort_auf
      if (anhaenge && anhaenge.length) row.anhaenge = anhaenge
      return check(await client.from('chat_nachrichten').insert(row).select().single())
    },
    // Wer schon angemeldet ist (37_team_online.sql). Fehlt die Funktion noch, null: dann zeigt der
    // Chat alle aktiven Teammitglieder.
    async teamSignedIn() {
      const { data, error } = await client.rpc('team_angemeldet')
      if (error) return null
      return (data || []).map((x) => String(typeof x === 'string' ? x : Object.values(x)[0]).toLowerCase())
    },
    // Wer gerade online ist: Presence im privaten Realtime-Kanal „crm-online“ (Regeln in
    // 37_team_online.sql, nur Teammitglieder). onSync bekommt die Adressen aller Verbundenen.
    presenceJoin(email, onSync) {
      const channel = client.channel('crm-online', { config: { private: true, presence: { key: email } } })
      channel.on('presence', { event: 'sync' }, () => onSync(Object.keys(channel.presenceState())))
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ seit: new Date().toISOString() }).catch(() => {})
      })
      return () => client.removeChannel(channel)
    },
    // Mitteilungen aufs Handy (34_chat_push.sql)
    async pushKey() {
      return check(await client.rpc('push_schluessel'))
    },
    async pushDevices() {
      return check(await client.from('push_abos').select('endpoint,geraet,created_at,zuletzt_gesendet').order('created_at'))
    },
    async pushSave({ endpoint, p256dh, auth, geraet }) {
      check(await client.rpc('push_abo_speichern', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_geraet: geraet || null }))
    },
    async pushRemove(endpoint) {
      check(await client.rpc('push_abo_entfernen', { p_endpoint: endpoint }))
    },
    async pushTest() {
      return check(await client.rpc('push_test_anfordern'))
    },
    // Dateien im Chat (33_chat_dateien.sql): privater Bucket „chat“, Pfad <Raum-ID>/<Zeit>-<Name>
    async chatUpload(path, file) {
      const { error } = await client.storage.from('chat').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
      if (error) throw error
    },
    // Signierte Links, eine Stunde gültig. Ohne Recht fehlt der Pfad in der Antwort.
    async chatFileUrls(paths) {
      if (!paths.length) return []
      const { data, error } = await client.storage.from('chat').createSignedUrls(paths, 3600)
      if (error) throw error
      return (data || []).filter((d) => d && d.signedUrl && !d.error).map((d) => ({ path: d.path, signedUrl: d.signedUrl }))
    },
    // Nur eigene Dateien (Regel crm_chat_loeschen), anderes löscht Supabase still nicht
    async chatRemoveFiles(paths) {
      if (!paths.length) return
      const { error } = await client.storage.from('chat').remove(paths)
      if (error) throw error
    },
    // Antworten im Verlauf, Reaktionen, Suche (32_chat_verlauf.sql)
    async chatThread(parentId) {
      return check(await client.from('chat_nachrichten').select('*').eq('antwort_auf', parentId).order('created_at', { ascending: true }).limit(500))
    },
    async chatReactions(ids) {
      if (!ids.length) return []
      const out = []
      for (let i = 0; i < ids.length; i += 100) {
        out.push(...check(await client.from('chat_reaktionen').select('nachricht_id,email,zeichen').in('nachricht_id', ids.slice(i, i + 100)).eq('aktiv', true)))
      }
      return out
    },
    async chatReact(id, zeichen, aktiv) {
      check(await client.rpc('chat_reagieren', { p_nachricht: id, p_zeichen: zeichen, p_aktiv: aktiv }))
    },
    async chatSearch(q) {
      const pattern = '%' + String(q).trim().replace(/[%_\\]/g, (c) => '\\' + c) + '%'
      return check(
        await client.from('chat_nachrichten').select('id,raum_id,autor,text,created_at,antwort_auf').ilike('text', pattern).is('geloescht_at', null).order('created_at', { ascending: false }).limit(50)
      )
    },
    async chatEdit(id, patch) {
      const row = patch.geloescht ? { geloescht_at: new Date().toISOString() } : { text: patch.text, erwaehnt: patch.erwaehnt || [] }
      return check(await client.from('chat_nachrichten').update(row).eq('id', id).select().single())
    },
    async chatCreateChannel({ name, beschreibung, offen, mitglieder }) {
      return check(await client.rpc('chat_kanal_anlegen', { p_name: name, p_beschreibung: beschreibung || null, p_offen: offen !== false, p_mitglieder: mitglieder || [] }))
    },
    async chatDirect(email) {
      return check(await client.rpc('chat_direkt', { p_email: email }))
    },
    async chatCreateGroup({ mitglieder, name }) {
      return check(await client.rpc('chat_gruppe_anlegen', { p_mitglieder: mitglieder || [], p_name: name || null }))
    },
    async chatAddMembers(raumId, emails) {
      check(await client.rpc('chat_mitglieder_hinzufuegen', { p_raum: raumId, p_mitglieder: emails }))
    },
    async chatRemoveMember(raumId, email) {
      check(await client.rpc('chat_mitglied_entfernen', { p_raum: raumId, p_email: email }))
    },
    async chatChangeRoom(raumId, patch) {
      check(
        await client.rpc('chat_raum_aendern', {
          p_raum: raumId,
          p_name: patch.name ?? null,
          p_beschreibung: patch.beschreibung ?? null,
          p_offen: patch.offen ?? null,
          p_archiviert: patch.archiviert ?? null,
        })
      )
    },
    async chatMarkRead(raumId, bis) {
      check(await client.rpc('chat_gelesen_setzen', { p_raum: raumId, p_bis: bis || null }))
    },
    // Sofort sichtbar über Supabase Realtime. Realtime prüft für jede Nachricht und Reaktion
    // dieselben Zugriffsregeln wie die Datenbank, fremde Direktnachrichten kommen also nie an.
    // Neue Räume (zum Beispiel jemand legt eine Gruppe an) holt der minütliche Abgleich.
    chatSubscribe(onChange) {
      const channel = client
        .channel('crm-chat')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_nachrichten' }, (p) => onChange({ type: 'message', row: p.new }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reaktionen' }, (p) => onChange({ type: 'reaction', row: p.new }))
        .subscribe()
      return () => client.removeChannel(channel)
    },
    // Mails still nachladen (Postfach offen und Neues da)
    async reloadEmails() {
      return fetchAll('emails')
    },

    // Aktivitäten einer Aufgabe (nach dem Verschieben, die Datenbank kann eine anlegen)
    async fetchActivities(cardId) {
      try {
        return check(await client.from('aktivitaeten').select('*').eq('card_id', cardId))
      } catch {
        return null
      }
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
    // Signatur aus Gmail als Text für die Vorschau (nur eigene Postfächer)
    async mailSignature(von) {
      const res = await callFunction('google-mail', { action: 'signatur', von })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw functionError(res, body)
      return body
    },
    // Signierter Link zu einem Anhang, 5 Minuten gültig. Den Anhang selbst liefert der Dienst
    // „google-mail“ beim Öffnen des Links, nie die App (Typ aus der Endung, sichere Kopfzeilen).
    async mailAttachmentLink(emailId, part) {
      const res = await callFunction('google-mail', { action: 'anhang-link', email_id: emailId, part })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw functionError(res, body)
      return body
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
    // Weitere Kalender je Postfach (35_weitere_kalender.sql). Fehlt die Tabelle noch: leere Liste.
    async mailboxCalendars() {
      const { data, error } = await client.from('postfach_kalender').select('id,mailbox_id,google_id,name,zugriff,primaer,aktiv').order('name')
      if (error) return []
      return data || []
    },
    async setMailboxCalendar(id, aktiv) {
      check(await client.rpc('postfach_kalender_schalten', { p_id: id, p_aktiv: !!aktiv }))
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

    // Aufgaben einer Spalte direkt in der Datenbank zählen, auch archivierte (B3)
    async countStageCards(stageId) {
      const all = await client.from('cards').select('id', { count: 'exact', head: true }).eq('stage_id', stageId)
      if (all.error) throw all.error
      const arch = await client.from('cards').select('id', { count: 'exact', head: true }).eq('stage_id', stageId).eq('archived', true)
      if (arch.error) throw arch.error
      return { total: all.count || 0, archived: arch.count || 0 }
    },
    // Alle Aufgaben einer Spalte in einem Schritt in eine andere. Verlauf und stage_changed_at setzt die Datenbank.
    async moveStageCards(fromId, toId) {
      const rows = check(await client.from('cards').update({ stage_id: toId }).eq('stage_id', fromId).select('id'))
      return (rows || []).length
    },
  }
}
