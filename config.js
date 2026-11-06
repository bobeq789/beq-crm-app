// Verbindung zur Datenbank (Supabase, Projekt beq-crm in Frankfurt).
// Hier gehören nur die Project URL und der öffentliche Schlüssel (publishable key) hin.
// Der geheime Schlüssel (secret key, früher service_role) gehört NIE in diese Datei.
// Ist supabaseUrl leer oder steht ?demo in der Adresse, läuft die App im Demo-Modus.
window.CRM_CONFIG = {
  supabaseUrl: 'https://odsdaynsczicfaxoqlms.supabase.co',
  supabaseKey: 'sb_publishable_4S-8Y1HZQ74yq7UFnfo3AQ_RW3Xi6bB',
  // Konto mit Passwort selbst anlegen (nur beq.com). Erst auf true stellen, wenn in Supabase
  // ein eigener Mailversand eingerichtet ist, sonst kommt die Bestätigungsmail nicht an.
  passwordSignup: false,
}
