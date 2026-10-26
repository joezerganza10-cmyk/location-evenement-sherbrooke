/**
 * 906 Réceptions — /catalogue (meme tenant Supabase que Salle 906 Galt Est,
 * memes tables equipment_quotes/equipment_quote_items, aucun inventaire separe)
 *
 * Depuis la Phase 3, chaque demande est enregistrée dans Supabase (table
 * equipment_quotes + equipment_quote_items) — c'est de là que l'interface
 * admin (/admin/soumissions.html) lit les demandes. L'ordre des étapes :
 *   1. SUPABASE (equipment_quotes)  — OBLIGATOIRE depuis la Phase 3. Sans
 *      cette écriture, la demande n'existerait nulle part pour l'admin.
 *   2. EMAIL ADMIN (Resend)   — OBLIGATOIRE. Si ça échoue, la fonction
 *      retourne une erreur et le client NE VOIT JAMAIS "Demande envoyée"
 *      (même si l'enregistrement Supabase, lui, a réussi — la demande
 *      existe donc déjà et sera visible dans l'admin malgré l'erreur
 *      affichée au client, qui peut alors réessayer sans dupliquer sa
 *      référence puisqu'une nouvelle sera générée).
 *   3. EMAIL CLIENT (Resend)  — best-effort. Accusé de réception envoyé au
 *      client ; un échec ici n'empêche jamais la confirmation.
 *   4. GOOGLE SHEETS          — best-effort, optionnel, conservé pour
 *      compatibilité avec l'ancien flux.
 *
 * Variables d'environnement Netlify requises/optionnelles :
 *   SUPABASE_URL, SUPABASE_SECRET_KEY (requis — mêmes variables que le
 *                                 reste du site, voir kreovya/lib/supabaseRest.js)
 *   RESEND_API_KEY               (requis — même clé que reservation-request.js)
 *   RESEND_FROM                  (optionnel — même valeur par défaut)
 *   EQUIPMENT_QUOTE_EMAIL        (optionnel — destinataire admin dédié ; à
 *                                 défaut, retombe sur RESERVATIONS_EMAIL puis
 *                                 sur reservations@salle906galtest.ca)
 *   EQUIPMENT_SHEETS_WEBHOOK_URL (optionnel — URL /exec dédiée ; à défaut,
 *                                 retombe sur SHEETS_WEBHOOK_URL si présente)
 *
 * SÉCURITÉ — validation : AUCUNE donnée reçue du client n'est considérée
 * fiable. Tout est revalidé ici (formats, longueurs, cohérence des dates,
 * bornes numériques) même si le formulaire HTML fait déjà ces vérifications
 * côté navigateur — un client HTTP direct peut contourner le navigateur.
 *
 * IMPORTANT — ce qui N'EST TOUJOURS PAS fait ici (volontairement) :
 *   - Aucune vérification de disponibilité réelle au moment de la demande
 *     (le catalogue public reste le fichier equipment-catalog.js — non
 *     encore migré vers equipment_items ; voir la note de
 *     saveQuoteToDatabase() ci-dessous). La disponibilité est vérifiée
 *     manuellement par l'admin au moment de confirmer la réservation
 *     (admin-reservation-confirm.js, RPC confirm_equipment_reservation).
 *   - Aucun paiement n'est traité.
 *   - Pas de limitation de débit (rate limiting) — un honeypot filtre les
 *     robots les plus basiques, mais une vraie limitation de débit
 *     nécessiterait une infrastructure additionnelle (ex. compteur par IP
 *     dans une table Supabase dédiée).
 *   - La référence de soumission (EQ-AAAA-XXXXXXXX) reste une clé de suivi
 *     lisible, pas un compteur séquentiel — mais elle est désormais
 *     garantie unique par la contrainte UNIQUE sur equipment_quotes.reference
 *     (l'insertion échouerait sur collision, ce qui est extrêmement
 *     improbable vu l'espace de valeurs, mais n'est plus seulement "probable").
 */

const { supabaseRequest } = require('../../kreovya/lib/supabaseRest');
const { dollarsToCents } = require('../../kreovya/lib/money');
const { EQUIPMENT_ITEMS } = require('../../equipment-catalog');

const TENANT_ID = 'salle906';
const MAX_ITEMS = 50;
const MAX_QTY = 500;
const MAX_SHORT = 200;   // nom, ville, code postal, étage…
const MAX_LONG = 2000;   // commentaires, instructions, adresse

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Nettoie les champs utilisés dans des contextes sensibles aux sauts de
// ligne (ex. sujet d'email) — défense en profondeur ; JSON.stringify() rend
// déjà l'injection d'en-têtes impossible via fetch(), mais on ne laisse
// jamais de \r\n traîner dans une valeur censée tenir sur une ligne.
function singleLine(v, max){
  return String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max || MAX_SHORT);
}
function longText(v, max){
  return String(v ?? '').trim().slice(0, max || MAX_LONG);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(s){
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

/**
 * Valide et nettoie intégralement le payload reçu. Retourne
 * { ok:true, clean } ou { ok:false, message } — ne lève jamais.
 */
function validatePayload(payload){
  if (!payload || typeof payload !== 'object') return { ok:false, message: 'Requête invalide.' };

  // Honeypot : champ caché côté formulaire, jamais rempli par un humain.
  if (payload.website) return { ok:false, message: 'Requête rejetée.' };

  // Horodatage anti-robot : un envoi en moins de 2.5s après le chargement
  // de la page est quasi impossible pour un humain remplissant ce
  // formulaire. Signal SUPPLÉMENTAIRE seulement — un champ absent ou
  // manifestement invalide (horloge, bloqueur de script) n'est jamais
  // bloquant à lui seul, pour ne jamais pénaliser un vrai client.
  const loadedAt = Number(payload.formLoadedAt);
  if (Number.isFinite(loadedAt) && loadedAt > 0) {
    const elapsed = Date.now() - loadedAt;
    if (elapsed >= 0 && elapsed < 2500) {
      return { ok:false, message: 'Requête rejetée.' };
    }
  }

  const name = singleLine(payload.name, MAX_SHORT);
  const email = singleLine(payload.email, MAX_SHORT);
  const phone = singleLine(payload.phone, 40);
  const eventType = singleLine(payload.eventType, MAX_SHORT);
  const eventDate = singleLine(payload.eventDate, 20);
  const comments = longText(payload.comments, MAX_LONG);
  const deliveryMode = payload.deliveryMode === 'livraison' ? 'livraison' : 'ramassage';
  const source = singleLine(payload.source, MAX_SHORT) || "Landing /catalogue — 906 Réceptions";
  const wantsDecoration = payload.wantsDecoration === true;
  const wantsOrganisation = payload.wantsOrganisation === true;

  if (!name) return { ok:false, message: 'Le nom est requis.' };
  if (!email || !EMAIL_RE.test(email)) return { ok:false, message: 'Une adresse courriel valide est requise.' };
  if (!phone) return { ok:false, message: 'Le téléphone est requis.' };
  if (!eventType) return { ok:false, message: "Le type d'événement est requis." };
  if (!eventDate || !isValidISODate(eventDate)) return { ok:false, message: "La date de l'événement est invalide." };

  // ---- Équipements ----
  // Au moins un équipement OU une demande de décoration/organisation — une
  // demande combinée peut porter uniquement sur un service partenaire.
  if (!Array.isArray(payload.items)) {
    return { ok:false, message: 'Sélection invalide.' };
  }
  if (!payload.items.length && !wantsDecoration && !wantsOrganisation) {
    return { ok:false, message: 'Au moins un équipement, ou une demande de décoration/organisation, est requis.' };
  }
  if (payload.items.length > MAX_ITEMS) {
    return { ok:false, message: 'Trop d\'équipements dans la demande.' };
  }
  const items = [];
  for (const raw of payload.items) {
    if (!raw || typeof raw !== 'object') return { ok:false, message: 'Article invalide dans la sélection.' };
    // itemId est optionnel (un article personnalisé sans correspondance dans
    // le catalogue n'en a pas) mais, quand présent, c'est la SEULE donnée
    // utilisée pour retrouver un prix — jamais un prix transmis directement.
    const itemId = singleLine(raw.itemId, 100) || null;
    const itemName = singleLine(raw.name, MAX_SHORT);
    const unit = singleLine(raw.unit, 60);
    const qty = Number(raw.qty);
    if (!itemName) return { ok:false, message: 'Un article de la sélection est invalide.' };
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { ok:false, message: `Quantité invalide pour « ${itemName} ».` };
    }
    items.push({ itemId, name: itemName, unit, qty });
  }

  // ---- Ramassage / livraison ----
  let deliveryInfo = {};
  if (deliveryMode === 'ramassage') {
    const pickupDate = singleLine(payload.deliveryInfo?.pickupDate, 20);
    const returnDate = singleLine(payload.deliveryInfo?.returnDate, 20);
    if (!pickupDate || !isValidISODate(pickupDate)) return { ok:false, message: 'La date de récupération est invalide.' };
    if (!returnDate || !isValidISODate(returnDate)) return { ok:false, message: 'La date de retour est invalide.' };
    if (returnDate < pickupDate) {
      return { ok:false, message: 'La date de retour ne peut pas être antérieure à la date de récupération.' };
    }
    deliveryInfo = { pickupDate, returnDate };
  } else {
    const address = longText(payload.deliveryInfo?.address, MAX_LONG);
    const city = singleLine(payload.deliveryInfo?.city, MAX_SHORT);
    const postalCode = singleLine(payload.deliveryInfo?.postalCode, 20);
    const deliveryDate = singleLine(payload.deliveryInfo?.deliveryDate, 20);
    const returnDate = singleLine(payload.deliveryInfo?.returnDate, 20);
    const floor = singleLine(payload.deliveryInfo?.floor, MAX_SHORT);
    const elevator = singleLine(payload.deliveryInfo?.elevator, 20);
    const instructions = longText(payload.deliveryInfo?.instructions, MAX_LONG);
    if (!address) return { ok:false, message: "L'adresse de livraison est requise." };
    if (!city) return { ok:false, message: 'La ville est requise.' };
    if (!postalCode) return { ok:false, message: 'Le code postal est requis.' };
    if (!deliveryDate || !isValidISODate(deliveryDate)) return { ok:false, message: 'La date de livraison est invalide.' };
    if (!returnDate || !isValidISODate(returnDate)) return { ok:false, message: 'La date de récupération est invalide.' };
    if (returnDate < deliveryDate) {
      return { ok:false, message: 'La date de récupération ne peut pas être antérieure à la date de livraison.' };
    }
    deliveryInfo = { address, city, postalCode, deliveryDate, returnDate, floor, elevator, instructions };
  }

  return {
    ok: true,
    clean: { name, email, phone, eventType, eventDate, comments, deliveryMode, deliveryInfo, items, source, wantsDecoration, wantsOrganisation },
  };
}

/* ---------- Référence de soumission (générée ICI, côté serveur) ---------- */
function generateQuoteRef(){
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `EQ-${year}-${rand}`;
}

/**
 * Recalcule le prix de chaque ligne à partir du catalogue SERVEUR
 * (equipment-catalog.js, require() directement — jamais depuis le
 * navigateur). Un item sans itemId, ou dont l'itemId ne correspond à
 * aucun article du catalogue, ou dont l'article n'a pas de prix confirmé
 * (price:null — ex. "Autre équipement" décrit en texte libre), n'a tout
 * simplement pas de prix calculé ici : ce n'est jamais une erreur, juste
 * un article que l'admin chiffrera manuellement, exactement comme avant.
 *
 * Retourne les items enrichis de unitPriceCents/lineTotalCents (null si
 * non calculable) et le sous-total total en cents (null si AUCUNE ligne
 * n'a de prix, pour ne jamais afficher "0 $" comme si c'était réel).
 */
function computeServerPricing(items){
  let subtotalCents = 0;
  let hasAnyPrice = false;
  const priced = items.map(i => {
    const catalogItem = i.itemId ? EQUIPMENT_ITEMS.find(e => e.id === i.itemId) : null;
    if (!catalogItem || catalogItem.price == null) {
      return { ...i, unitPriceCents: null, lineTotalCents: null };
    }
    const unitPriceCents = dollarsToCents(catalogItem.price);
    const lineTotalCents = unitPriceCents * i.qty;
    subtotalCents += lineTotalCents;
    hasAnyPrice = true;
    return { ...i, unitPriceCents, lineTotalCents };
  });
  return { priced, subtotalCents: hasAnyPrice ? subtotalCents : null };
}

/**
 * Enregistre la demande dans Supabase (equipment_quotes + equipment_quote_items).
 * Le catalogue public reste pour l'instant le fichier equipment-catalog.js
 * (pas encore migré vers la base — voir supabase/migrations/0002) : les
 * lignes sont donc enregistrées SANS equipment_item_id (laissé NULL),
 * uniquement avec name_snapshot — exactement le cas d'usage pour lequel ce
 * champ a été prévu. Le prix, lui, EST déjà recalculé côté serveur dès
 * maintenant (voir computeServerPricing) puisque les 7 produits officiels
 * ont un prix connu dans le catalogue statique, indépendamment de la
 * migration Supabase. Le jour où le catalogue public lira equipment_items
 * en direct, equipment_item_id pourra être rempli ici sans changer le
 * schéma (la colonne `code` ajoutée dans 0001 fait déjà le pont).
 */
async function saveQuoteToDatabase(payload, quoteRef, priced, subtotalCents){
  const startDate = payload.deliveryMode === 'ramassage' ? payload.deliveryInfo.pickupDate : payload.deliveryInfo.deliveryDate;
  const endDate = payload.deliveryInfo.returnDate;

  const quoteRows = await supabaseRequest('equipment_quotes', {
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
      delivery_mode: payload.deliveryMode,
      start_date: startDate,
      end_date: endDate,
      delivery_address: payload.deliveryInfo.address || null,
      delivery_city: payload.deliveryInfo.city || null,
      delivery_postal_code: payload.deliveryInfo.postalCode || null,
      delivery_floor: payload.deliveryInfo.floor || null,
      delivery_elevator: payload.deliveryInfo.elevator || null,
      delivery_instructions: payload.deliveryInfo.instructions || null,
      comments: payload.comments || null,
      subtotal_cents: subtotalCents,
    },
  });
  const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
  if (!quote || !quote.id) throw new Error('Échec de l\'enregistrement de la soumission.');

  await supabaseRequest('equipment_quote_items', {
    method: 'POST',
    quiet: true,
    body: priced.map(i => ({
      quote_id: quote.id,
      equipment_item_id: null,
      name_snapshot: i.name,
      qty: i.qty,
      unit_price_cents: i.unitPriceCents,
      line_total_cents: i.lineTotalCents,
    })),
  });

  return { quote, subtotalCents, priced };
}

function money(cents){
  if (cents == null) return '';
  return (cents / 100).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
}

function buildItemsHtml(items){
  const rows = items.map(i => `<tr><td style="padding:6px 12px 6px 0;font-size:14px">${esc(i.name)}</td><td style="padding:6px 0;font-size:14px;color:#6b6656">${esc(i.unit||'')}</td><td style="padding:6px 0;font-size:14px;text-align:right;font-weight:600">× ${esc(i.qty)}</td><td style="padding:6px 0 6px 12px;font-size:14px;text-align:right;color:#16140f">${esc(i.lineTotalCents != null ? money(i.lineTotalCents) : '')}</td></tr>`).join('');
  return `<table style="border-collapse:collapse;width:100%">${rows}</table>`;
}

function buildSubtotalHtml(subtotalCents){
  if (subtotalCents == null) return '';
  return `<p style="font-size:15px;margin-top:10px;text-align:right"><strong>Estimation pour une journée : ${esc(money(subtotalCents))}</strong><br><span style="font-size:11.5px;color:#8a8474;font-weight:400">Avant taxes et frais de livraison éventuels — à confirmer dans la soumission.</span></p>`;
}

function buildDeliveryHtml(mode, info){
  const row = (label, value) => value ? `<tr><td style="padding:4px 12px 4px 0;color:#6b6656;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:4px 0;font-size:14px;color:#16140f">${esc(value)}</td></tr>` : '';
  if (mode === 'livraison'){
    return `<table style="border-collapse:collapse;width:100%">
      ${row('Mode', 'Livraison')}
      ${row('Adresse', info.address)}
      ${row('Ville', info.city)}
      ${row('Code postal', info.postalCode)}
      ${row('Date de livraison', info.deliveryDate)}
      ${row('Date de récupération', info.returnDate)}
      ${row('Étage', info.floor)}
      ${row('Ascenseur', info.elevator)}
      ${row('Instructions', info.instructions)}
    </table>`;
  }
  return `<table style="border-collapse:collapse;width:100%">
    ${row('Mode', 'Ramassage sur place à Sherbrooke (adresse confirmée dans votre soumission)')}
    ${row('Date de récupération souhaitée', info.pickupDate)}
    ${row('Date de retour souhaitée', info.returnDate)}
  </table>`;
}

/* ---------- Email ADMIN (obligatoire) ---------- */
function buildAdminEmailHtml(p, quoteRef, submittedAt, pricedItems, subtotalCents){
  const row = (label, value) => `<tr><td style="padding:4px 12px 4px 0;color:#6b6656;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:4px 0;font-size:14px;color:#16140f">${esc(value) || '—'}</td></tr>`;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#16140f">
    <h2 style="font-size:18px;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #c9a463;padding-bottom:10px">Nouvelle demande — 906 Réceptions</h2>
    <p style="font-family:'Courier New',monospace;font-size:13px;color:#6b6656">Référence : <strong>${esc(quoteRef)}</strong> &nbsp;·&nbsp; Statut : <strong>En attente de validation</strong></p>
    <table style="border-collapse:collapse;width:100%;margin-top:14px">
      ${row('Nom', p.name)}
      ${row('Téléphone', p.phone)}
      ${row('Courriel', p.email)}
      ${row("Type d'événement", p.eventType)}
      ${row("Date de l'événement", p.eventDate)}
      ${row("Décoration souhaitée ?", p.wantsDecoration ? 'Oui — à contacter pour une proposition' : 'Non')}
      ${row("Organisation souhaitée ?", p.wantsOrganisation ? 'Oui — à orienter vers un partenaire' : 'Non')}
    </table>
    ${pricedItems.length ? `
    <h3 style="font-size:14px;margin-top:22px;border-bottom:1px solid #e5e0d3;padding-bottom:8px">Équipements demandés</h3>
    ${buildItemsHtml(pricedItems)}
    ${buildSubtotalHtml(subtotalCents)}
    <h3 style="font-size:14px;margin-top:22px;border-bottom:1px solid #e5e0d3;padding-bottom:8px">Ramassage / livraison</h3>
    ${buildDeliveryHtml(p.deliveryMode, p.deliveryInfo || {})}` : '<p style="font-size:13px;color:#8a8474;margin-top:18px">Aucun équipement demandé — service partenaire seulement.</p>'}
    ${p.comments ? `<h3 style="font-size:14px;margin-top:22px;border-bottom:1px solid #e5e0d3;padding-bottom:8px">Commentaires</h3><p style="font-size:14px">${esc(p.comments)}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;margin-top:22px;border-top:1px solid #e5e0d3;padding-top:8px">
      ${row('Source', p.source)}
      ${row('Date et heure de soumission', submittedAt)}
    </table>
    <p style="font-size:12px;color:#8a8474;margin-top:18px">Rappel : aucune disponibilité n'a été vérifiée automatiquement. Confirmer l'inventaire réel avant d'envoyer une soumission chiffrée au client.</p>
  </div>`;
}

/* ---------- Email CLIENT (accusé de réception, best-effort) ---------- */
function buildClientEmailHtml(p, quoteRef, pricedItems, subtotalCents){
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#16140f">
    <h2 style="font-size:18px;letter-spacing:1px;text-transform:uppercase;border-bottom:2px solid #c9a463;padding-bottom:10px">Votre demande a bien été reçue</h2>
    <p style="font-size:14px;line-height:1.6">Bonjour ${esc(p.name.split(' ')[0] || '')},</p>
    <p style="font-size:14px;line-height:1.6">Merci pour votre demande auprès de <strong>906 Réceptions</strong>. Voici un résumé :</p>
    <p style="font-family:'Courier New',monospace;font-size:13px;color:#6b6656">Référence : <strong>${esc(quoteRef)}</strong></p>
    ${pricedItems.length ? `
    <h3 style="font-size:14px;margin-top:18px;border-bottom:1px solid #e5e0d3;padding-bottom:8px">Équipements demandés</h3>
    ${buildItemsHtml(pricedItems)}
    ${buildSubtotalHtml(subtotalCents)}` : ''}
    <p style="font-size:14px;line-height:1.7;margin-top:20px;padding:14px 16px;background:#faf8f3;border-left:3px solid #c9a463">
      <strong>Important :</strong> cette référence confirme que votre demande est bien <strong>en cours d'examen</strong> — elle ne constitue
      <strong>ni une réservation confirmée, ni une garantie de disponibilité, ni un prix final</strong>. Notre équipe vérifie
      l'inventaire réel et vous enverra une soumission précise (prix, frais éventuels et conditions) par courriel.
    </p>
    <p style="font-size:14px;line-height:1.6;margin-top:18px">Une question en attendant ? Contactez-nous au <a href="tel:+18196789242" style="color:#c9a463">(819) 678-9242</a> ou par retour de ce courriel.</p>
    <p style="font-size:13px;color:#6b6656;margin-top:24px">906 Réceptions</p>
  </div>`;
}

async function sendResendEmail({ to, subject, html }){
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY manquant dans Netlify — configurez-le pour activer l\'email.');
  const from = process.env.RESEND_FROM || "906 Réceptions <onboarding@resend.dev>";

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

async function postToSheets(payload, quoteRef, submittedAt){
  const url = process.env.EQUIPMENT_SHEETS_WEBHOOK_URL || process.env.SHEETS_WEBHOOK_URL;
  if (!url) { console.warn('[Sheets] aucune URL configurée — étape ignorée.'); return; }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'equipement',
      reference: quoteRef,
      statut: 'En attente de validation',
      dateDeLaDemande: submittedAt,
      nom: payload.name, telephone: payload.phone, courriel: payload.email,
      typeEvenement: payload.eventType, dateEvenement: payload.eventDate,
      modeRecuperation: payload.deliveryMode,
      equipements: payload.items.map(i => `${i.name} x${i.qty}`).join(', '),
      commentaires: payload.comments,
    }),
  });
  if (!res.ok) throw new Error(`Erreur Google Sheets (${res.status})`);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, { ok: true });
  if (event.httpMethod !== 'POST') return response(405, { success: false, message: 'Méthode non autorisée.' });

  let rawPayload;
  try {
    rawPayload = JSON.parse(event.body || '{}');
  } catch (err) {
    return response(400, { success: false, message: 'Requête invalide.' });
  }

  const validation = validatePayload(rawPayload);
  if (!validation.ok) {
    return response(400, { success: false, message: validation.message });
  }
  const payload = validation.clean;
  const quoteRef = generateQuoteRef();
  const submittedAt = new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' });

  try {
    // 0. Prix recalculé ICI, côté serveur, à partir du catalogue (jamais
    //    depuis une valeur envoyée par le navigateur) — toujours disponible,
    //    même si Supabase est indisponible (voir point 1 ci-dessous).
    const { priced, subtotalCents } = computeServerPricing(payload.items);

    // 1. EMAIL ADMIN — obligatoire (c'est la source fiable de la demande
    //    tant que Supabase n'est pas garanti disponible — voir point 2).
    const adminTo = process.env.EQUIPMENT_QUOTE_EMAIL || process.env.RESERVATIONS_EMAIL || 'reservations@salle906galtest.ca';
    await sendResendEmail({
      to: adminTo,
      subject: `Soumission équipements ${quoteRef} — ${singleLine(payload.name, 80)}`,
      html: buildAdminEmailHtml(payload, quoteRef, submittedAt, priced, subtotalCents),
    });

    // 2. ENREGISTREMENT SUPABASE — best-effort (n'affecte jamais le succès
    //    côté client). Repassé de "obligatoire" à "best-effort" le temps
    //    qu'une erreur d'horodatage JWT côté Supabase (projet récemment
    //    réactivé après pause) se résorbe ; l'email admin reste alors la
    //    seule source de vérité pour ces demandes-là. Remettre en bloquant
    //    une fois Supabase confirmé stable, si le suivi admin structuré
    //    (statuts, assignation) en dépend.
    try {
      await saveQuoteToDatabase(payload, quoteRef, priced, subtotalCents);
    } catch (err) {
      console.warn('[equipment-quote-request] Supabase indisponible (best-effort) —', err.message);
    }

    // 3. EMAIL CLIENT — accusé de réception, best-effort (n'affecte jamais le succès).
    try {
      await sendResendEmail({
        to: payload.email,
        subject: `Votre demande ${quoteRef} est en cours d'examen — 906 Réceptions`,
        html: buildClientEmailHtml(payload, quoteRef, priced, subtotalCents),
      });
    } catch (err) {
      console.warn('[Resend:client] accusé de réception non envoyé (best-effort) —', err.message);
    }

    // 4. Google Sheets — best-effort (conservé pour compatibilité ; Supabase
    //    est désormais la source de vérité consultée par l'admin).
    try { await postToSheets(payload, quoteRef, submittedAt); }
    catch (err) { console.warn('[Sheets] non disponible (optionnel) —', err.message); }

    return response(200, { success: true, quoteRef });
  } catch (error) {
    console.error('[equipment-quote-request]', error);
    return response(500, { success: false, message: error.message || 'Erreur lors de l\'envoi de la demande.' });
  }
};
