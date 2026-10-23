/**
 * 906 Location Équipements — Catalogue PUBLIC (lecture seule, sans
 * authentification). Retourne uniquement les équipements actifs, et
 * UNIQUEMENT des champs destinés à l'affichage public.
 *
 * Champs volontairement JAMAIS exposés ici (même si présents dans la
 * table equipment_items) : total_qty (niveau de stock réel), deposit_cents
 * seul (la caution est affichée si présente, mais ce n'est pas une donnée
 * sensible — gardé simple), category_id brut (on résout vers le libellé),
 * tenant_id, created_at/updated_at internes, et bien sûr toute clé Supabase.
 *
 * Les URLs de photos pointent vers le bucket Storage PUBLIC
 * "equipment-photos" (voir admin-equipment-photo-upload.js) — ce ne sont
 * pas des URLs signées, donc rien de confidentiel n'y transite.
 */

const { supabaseRequest } = require('../../kreovya/lib/supabaseRest');

function response(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60', // catalogue peu volatile : courte mise en cache CDN
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(body),
  };
}

const TENANT_ID = 'salle906';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, { ok: true });
  if (event.httpMethod !== 'GET') return response(405, { success: false, message: 'Méthode non autorisée.' });

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return response(503, { success: false, message: 'Catalogue temporairement indisponible.' });

  try {
    const [items, categories, photos] = await Promise.all([
      supabaseRequest('equipment_items', {
        query: `tenant_id=eq.${TENANT_ID}&is_active=eq.true&select=id,category_id,name,description,price_cents,deposit_cents,unit_label,min_rental_days&order=name.asc`,
      }),
      supabaseRequest('equipment_categories', {
        query: `tenant_id=eq.${TENANT_ID}&select=id,slug,label&order=sort_order.asc`,
      }),
      supabaseRequest('equipment_photos', { query: `select=equipment_item_id,storage_path,sort_order&order=sort_order.asc` }),
    ]);

    const photosByItem = {};
    (photos || []).forEach(p => {
      (photosByItem[p.equipment_item_id] = photosByItem[p.equipment_item_id] || []).push(
        `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/equipment-photos/${p.storage_path}`
      );
    });
    const catById = {};
    (categories || []).forEach(c => { catById[c.id] = c; });

    const publicItems = (items || []).map(i => ({
      id: i.id,
      category: catById[i.category_id] ? catById[i.category_id].slug : 'autre',
      categoryLabel: catById[i.category_id] ? catById[i.category_id].label : 'Autres équipements',
      name: i.name,
      description: i.description || '',
      price: i.price_cents != null ? i.price_cents / 100 : null,
      deposit: i.deposit_cents != null ? i.deposit_cents / 100 : null,
      unit: i.unit_label || '',
      minRentalDays: i.min_rental_days || 1,
      photos: photosByItem[i.id] || [],
    }));

    const publicCategories = (categories || []).map(c => ({ id: c.slug, label: c.label }));

    return response(200, { success: true, items: publicItems, categories: publicCategories });
  } catch (error) {
    console.error('[equipment-catalog-public]', error.message);
    return response(500, { success: false, message: 'Erreur lors du chargement du catalogue.' });
  }
};
