/**
 * 906 Réceptions — Génération PDF d'une soumission (admin).
 * Utilise kreovya/lib/pdf.js (générateur maison, aucune dépendance npm).
 *
 * DÉPENDANCE NON ENCORE DÉPLOYÉE : cette fonction exige une session admin
 * valide (verifyAdminRequest -> table admin_profiles). Aucune interface
 * d'administration n'est encore construite pour locationevenementsherbrooke.ca -- cette
 * fonction est prete et correctement brandee, mais ne sera appelable que
 * lorsque l'acces admin sera mis en place pour ce site (reutilisation de
 * la session Salle 906, ou systeme separe -- a decider).
 */

const { verifyAdminRequest } = require('../../kreovya/lib/adminAuth');
const { supabaseRequest } = require('../../kreovya/lib/supabaseRest');
const { createPdfDoc } = require('../../kreovya/lib/pdf');
const { formatCAD } = require('../../kreovya/lib/money');

const TENANT_ID = 'salle906';

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

function wrapText(str, maxChars){
  const words = String(str || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) { if (current) lines.push(current); current = w; }
    else current = (current + ' ' + w).trim();
  }
  if (current) lines.push(current);
  return lines;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, message: 'Méthode non autorisée.' });

  const auth = await verifyAdminRequest(event);
  if (!auth.ok) return jsonResponse(auth.status, { success: false, message: auth.message });

  const id = (event.queryStringParameters || {}).id;
  if (!id) return jsonResponse(400, { success: false, message: 'Identifiant de soumission manquant.' });

  let quote, items;
  try {
    const [quotes, itemRows] = await Promise.all([
      supabaseRequest('equipment_quotes', { query: `id=eq.${encodeURIComponent(id)}&tenant_id=eq.${TENANT_ID}&select=*`, quiet: true }),
      supabaseRequest('equipment_quote_items', { query: `quote_id=eq.${encodeURIComponent(id)}&select=*`, quiet: true }),
    ]);
    quote = Array.isArray(quotes) ? quotes[0] : null;
    items = itemRows || [];
    if (!quote) return jsonResponse(404, { success: false, message: 'Soumission introuvable.' });
  } catch (error) {
    console.error('[admin-quote-pdf]', error.message);
    return jsonResponse(500, { success: false, message: 'Erreur lors du chargement de la soumission.' });
  }

  try {
    const doc = createPdfDoc();
    let y = 740;

    doc.text(50, y, '906 RÉCEPTIONS', { size: 16, bold: true }); y -= 16;
    doc.text(50, y, "Location d'équipements · Décoration · Organisation d'événements", { size: 11 }); y -= 14;
    doc.text(50, y, 'Sherbrooke, QC', { size: 9.5 }); y -= 11;
    doc.text(50, y, '(819) 678-9242 · reservations@salle906galtest.ca', { size: 9.5 }); y -= 24;

    doc.line(50, y, 562, y); y -= 22;

    doc.text(50, y, `Soumission ${quote.reference}`, { size: 14, bold: true });
    doc.text(420, y, `Statut : ${quote.status}`, { size: 9.5 }); y -= 20;
    doc.text(50, y, `Date de préparation : ${new Date().toLocaleDateString('fr-CA')}`, { size: 9.5 }); y -= 24;

    doc.text(50, y, 'Client', { size: 11, bold: true }); y -= 14;
    doc.text(50, y, quote.customer_name || '', { size: 10 }); y -= 12;
    doc.text(50, y, quote.customer_email || '', { size: 10 }); y -= 12;
    doc.text(50, y, quote.customer_phone || '', { size: 10 }); y -= 20;

    doc.text(50, y, `Événement : ${quote.event_type || '—'}    Date : ${quote.event_date || '—'}`, { size: 10 }); y -= 14;
    doc.text(50, y, `Mode : ${quote.delivery_mode === 'livraison' ? 'Livraison' : 'Ramassage sur place'}    Du ${quote.start_date} au ${quote.end_date}`, { size: 10 }); y -= 14;
    if (quote.delivery_mode === 'livraison') {
      doc.text(50, y, `Adresse : ${quote.delivery_address || ''}, ${quote.delivery_city || ''} ${quote.delivery_postal_code || ''}`, { size: 10 }); y -= 14;
    }
    y -= 10;

    doc.line(50, y, 562, y); y -= 18;
    doc.text(50, y, 'Équipement', { size: 10, bold: true });
    doc.text(350, y, 'Qté', { size: 10, bold: true });
    doc.text(400, y, 'Prix unitaire', { size: 10, bold: true });
    doc.text(490, y, 'Total', { size: 10, bold: true });
    y -= 8;
    doc.line(50, y, 562, y); y -= 16;

    for (const item of items) {
      doc.text(50, y, item.name_snapshot, { size: 10 });
      doc.text(350, y, String(item.qty), { size: 10 });
      doc.text(400, y, item.unit_price_cents != null ? formatCAD(item.unit_price_cents) : 'À confirmer', { size: 10 });
      doc.text(490, y, item.line_total_cents != null ? formatCAD(item.line_total_cents) : '—', { size: 10 });
      y -= 16;
    }

    y -= 6;
    doc.line(350, y, 562, y); y -= 18;
    doc.text(400, y, 'Sous-total', { size: 10 }); doc.text(490, y, formatCAD(quote.subtotal_cents || 0), { size: 10 }); y -= 14;
    doc.text(400, y, 'Frais de livraison', { size: 10 }); doc.text(490, y, formatCAD(quote.delivery_fee_cents || 0), { size: 10 }); y -= 14;
    doc.text(400, y, 'Taxes', { size: 10 }); doc.text(490, y, formatCAD(quote.tax_cents || 0), { size: 10 }); y -= 16;
    doc.text(400, y, 'TOTAL', { size: 12, bold: true }); doc.text(490, y, formatCAD(quote.total_cents || 0), { size: 12, bold: true }); y -= 30;

    doc.line(50, y, 562, y); y -= 18;
    doc.text(50, y, 'Conditions', { size: 10, bold: true }); y -= 14;
    const conditions = [
      'Cette soumission est valide 15 jours à compter de sa date de préparation.',
      'Une caution peut être applicable selon les équipements loués — voir détails fournis séparément.',
      "La confirmation définitive de la réservation est sujette à la disponibilité réelle de l'inventaire.",
      "Les conditions d'annulation et de retard seront précisées lors de la confirmation de réservation.",
    ];
    for (const c of conditions) {
      for (const line of wrapText(c, 100)) { doc.text(50, y, `• ${line}`, { size: 9 }); y -= 12; }
    }

    const pdfBuffer = doc.build();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="soumission-${quote.reference}.pdf"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('[admin-quote-pdf] génération PDF échouée —', error.message);
    return jsonResponse(500, { success: false, message: 'Erreur lors de la génération du PDF.' });
  }
};
