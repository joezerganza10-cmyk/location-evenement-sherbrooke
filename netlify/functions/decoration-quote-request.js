/**
 * Location d'évènement Sherbrooke — /decoration
 *
 * Demande de soumission personnalisée pour le service de décoration
 * événementielle. AUCUN tarif, forfait ni disponibilité n'est calculé ou
 * promis ici — le service de décoration n'a pas encore de grille tarifaire
 * confirmée (voir brief). Cette fonction se contente de recueillir la
 * demande et de la transmettre à l'équipe.
 *
 * Architecture (du plus au moins critique) :
 *   1. EMAIL ADMIN (Resend) — OBLIGATOIRE. Si ça échoue, le client NE VOIT
 *      JAMAIS "Demande envoyée".
 *   2. SUPABASE (decoration_quotes) — BEST-EFFORT, désactivé tant que la
 *      table n'existe pas (aucune migration ne la définit encore — à créer
 *      une fois le service de décoration confirmé). Un échec ici n'empêche
 *      jamais la confirmation au client, puisque l'email reste la source
 *      fiable tant que la table n'existe pas.
 *   3. EMAIL CLIENT (Resend) — best-effort, accusé de réception.
 *
 * Variables d'environnement Netlify (mêmes que equipment-quote-request.js) :
 *   RESEND_API_KEY (requis), RESEND_FROM (optionnel)
 *   DECORATION_QUOTE_EMAIL (optionnel — à défaut, reservations@salle906galtest.ca)
 *   SUPABASE_URL, SUPABASE_SECRET_KEY (optionnels ici — best-effort seulement)
 */

const { supabaseRequest } = require('../../kreovya/lib/supabaseRest');

const TENANT_ID = 'salle906';
const MAX_SHORT = 200;
const MAX_LONG = 2000;

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function singleLine(v, max){ return String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max || MAX_SHORT); }
function longText(v, max){ return String(v ?? '').trim().slice(0, max || MAX_LONG); }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidISODate(s){
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

function validatePayload(payload){
  if (!payload || typeof payload !== 'object') return { ok:false, message: 'Requête invalide.' };
  if (payload.website) return { ok:false, message: 'Requête rejetée.' }; // honeypot

  const loadedAt = Number(payload.formLoadedAt);
  if (Number.isFinite(loadedAt) && loadedAt > 0) {
    const elapsed = Date.now() - loadedAt;
    if (elapsed >= 0 && elapsed < 2500) return { ok:false, message: 'Requête rejetée.' };
  }

  const name = singleLine(payload.name, MAX_SHORT);
  const email = singleLine(payload.email, MAX_SHORT);
  const phone = singleLine(payload.phone, 40);
  const eventType = singleLine(payload.eventType, MAX_SHORT);
  const eventDate = singleLine(payload.eventDate, 20);
  const venue = singleLine(payload.venue, MAX_SHORT);
  const guestCount = singleLine(payload.guestCount, 20);
  const ambiance = longText(payload.ambiance, MAX_LONG);
  const budgetRange = singleLine(payload.budgetRange, MAX_SHORT);
  const comments = longText(payload.comments, MAX_LONG);

  if (!name) return { ok:false, message: 'Le nom est requis.' };
  if (!email || !EMAIL_RE.test(email)) return { ok:false, message: 'Une adresse courriel valide est requise.' };
  if (!phone) return { ok:false, message: 'Le téléphone est requis.' };
  if (!eventType) return { ok:false, message: "Le type d'événement est requis." };
  if (!eventDate || !isValidISODate(eventDate)) return { ok:false, message: "La date de l'événement est invalide." };
  if (!venue) return { ok:false, message: 'Le lieu de votre événement est requis.' };

  return { ok:true, clean: { name, email, phone, eventType, eventDate, venue, guestCount, ambiance, budgetRange, comments } };
}

function generateQuoteRef(){
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `DEC-${year}-${rand}`;
}

async function sendResendEmail({ to, subject, html }){
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY manquant dans Netlify.');
  const from = process.env.RESEND_FROM || "Location d'évènement Sherbrooke <onboarding@resend.dev>";
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[Resend]', res.status, data);
    throw new Error(data.message || `Erreur d'envoi de l'email (${res.status})`);
  }
  return data;
}

function buildAdminEmailHtml(p, quoteRef, submittedAt){
  const row = (label, value) => `<tr><td style="padding:4px 12px 4px 0;color:#6b6656;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:4px 0;font-size:14px;color:#16140f">${esc(value) || '—'}</td></tr>`;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#16140f">
    <h2 style="font-size:18px;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #c9a463;padding-bottom:10px">Nouvelle demande — Décoration — Location d'évènement Sherbrooke</h2>
    <p style="font-family:'Courier New',monospace;font-size:13px;color:#6b6656">Référence : <strong>${esc(quoteRef)}</strong></p>
    <table style="border-collapse:collapse;width:100%;margin-top:14px">
      ${row('Nom', p.name)}
      ${row('Téléphone', p.phone)}
      ${row('Courriel', p.email)}
      ${row("Type d'événement", p.eventType)}
      ${row("Date de l'événement", p.eventDate)}
      ${row('Lieu', p.venue)}
      ${row('Nombre d\'invités', p.guestCount)}
      ${row('Budget indicatif', p.budgetRange)}
    </table>
    ${p.ambiance ? `<h3 style="font-size:14px;margin-top:22px;border-bottom:1px solid #e5e0d3;padding-bottom:8px">Ambiance souhaitée</h3><p style="font-size:14px">${esc(p.ambiance)}</p>` : ''}
    ${p.comments ? `<h3 style="font-size:14px;margin-top:22px;border-bottom:1px solid #e5e0d3;padding-bottom:8px">Commentaires</h3><p style="font-size:14px">${esc(p.comments)}</p>` : ''}
    <p style="font-size:12px;color:#8a8474;margin-top:18px">Soumis le ${esc(submittedAt)}. Aucun tarif ni forfait n'a été proposé automatiquement — préparer une proposition manuelle.</p>
  </div>`;
}

function buildClientEmailHtml(p, quoteRef){
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#16140f">
    <h2 style="font-size:18px;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #c9a463;padding-bottom:10px">Votre demande de décoration a bien été reçue</h2>
    <p style="font-size:14px;line-height:1.6">Bonjour ${esc(p.name.split(' ')[0] || '')},</p>
    <p style="font-size:14px;line-height:1.6">Merci pour votre demande auprès de <strong>Location d'évènement Sherbrooke</strong>. Voici un résumé :</p>
    <p style="font-family:'Courier New',monospace;font-size:13px;color:#6b6656">Référence : <strong>${esc(quoteRef)}</strong></p>
    <table style="border-collapse:collapse;width:100%;margin-top:10px">
      <tr><td style="padding:4px 12px 4px 0;color:#6b6656;font-size:13px">Type d'événement</td><td style="font-size:14px">${esc(p.eventType)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b6656;font-size:13px">Date</td><td style="font-size:14px">${esc(p.eventDate)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b6656;font-size:13px">Lieu</td><td style="font-size:14px">${esc(p.venue)}</td></tr>
    </table>
    <p style="font-size:14px;line-height:1.7;margin-top:20px;padding:14px 16px;background:#faf8f3;border-left:3px solid #c9a463">
      <strong>Important :</strong> cette référence confirme que votre demande est <strong>en cours d'examen</strong> — elle ne constitue
      <strong>ni une réservation, ni un prix, ni une disponibilité confirmée</strong>. Notre équipe prépare une proposition personnalisée
      et vous contactera directement.
    </p>
    <p style="font-size:14px;line-height:1.6;margin-top:18px">Une question en attendant ? Contactez-nous au <a href="tel:+18196789242" style="color:#c9a463">(819) 678-9242</a> ou par retour de ce courriel.</p>
    <p style="font-size:13px;color:#6b6656;margin-top:24px">Location d'évènement Sherbrooke</p>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, { ok: true });
  if (event.httpMethod !== 'POST') return response(405, { success: false, message: 'Méthode non autorisée.' });

  let rawPayload;
  try { rawPayload = JSON.parse(event.body || '{}'); }
  catch (err) { return response(400, { success: false, message: 'Requête invalide.' }); }

  const validation = validatePayload(rawPayload);
  if (!validation.ok) return response(400, { success: false, message: validation.message });
  const payload = validation.clean;
  const quoteRef = generateQuoteRef();
  const submittedAt = new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' });

  try {
    // 1. EMAIL ADMIN — obligatoire, c'est la source fiable tant que la
    //    table decoration_quotes n'existe pas encore.
    const adminTo = process.env.DECORATION_QUOTE_EMAIL || process.env.RESERVATIONS_EMAIL || 'reservations@salle906galtest.ca';
    await sendResendEmail({
      to: adminTo,
      subject: `Demande décoration ${quoteRef} — ${singleLine(payload.name, 80)}`,
      html: buildAdminEmailHtml(payload, quoteRef, submittedAt),
    });

    // 2. SUPABASE — best-effort, n'affecte jamais le succès. La table
    //    decoration_quotes n'est pas encore définie (aucune migration) :
    //    cet appel échouera silencieusement jusqu'à ce qu'elle existe.
    try {
      await supabaseRequest('decoration_quotes', {
        method: 'POST',
        quiet: true,
        body: {
          tenant_id: TENANT_ID,
          reference: quoteRef,
          status: 'nouvelle',
          customer_name: payload.name,
          customer_email: payload.email,
          customer_phone: payload.phone,
          event_type: payload.eventType,
          event_date: payload.eventDate,
          venue: payload.venue,
          guest_count: payload.guestCount || null,
          desired_ambiance: payload.ambiance || null,
          budget_range: payload.budgetRange || null,
          comments: payload.comments || null,
        },
      });
    } catch (err) {
      console.warn('[decoration-quote-request] Supabase non disponible (table pas encore créée) —', err.message);
    }

    // 3. EMAIL CLIENT — best-effort.
    try {
      await sendResendEmail({
        to: payload.email,
        subject: `Votre demande ${quoteRef} est en cours d'examen — Location d'évènement Sherbrooke`,
        html: buildClientEmailHtml(payload, quoteRef),
      });
    } catch (err) {
      console.warn('[Resend:client] accusé de réception non envoyé (best-effort) —', err.message);
    }

    return response(200, { success: true, quoteRef });
  } catch (error) {
    console.error('[decoration-quote-request]', error);
    return response(500, { success: false, message: error.message || 'Erreur lors de l\'envoi de la demande.' });
  }
};
