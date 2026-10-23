/**
 * 906 Location Équipements — Vérification d'authentification admin.
 * ============================================================
 * Ne fait AUCUNE vérification JWT "maison" : le jeton envoyé par le
 * navigateur est systématiquement revalidé auprès de Supabase Auth
 * (GoTrue) via /auth/v1/user. Si Supabase dit que le jeton est invalide
 * ou expiré, on refuse — jamais de confiance aveugle dans un jeton décodé
 * localement.
 *
 * Un utilisateur Supabase Auth valide n'est PAS automatiquement admin :
 * il doit en plus exister dans `admin_profiles` avec is_active = true
 * (liste blanche explicite, jamais implicite).
 */

const { supabaseRequest } = require('./supabaseRest');

async function verifyAdminRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401, message: 'Authentification requise.' };

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return { ok: false, status: 500, message: 'Configuration serveur manquante.' };

  let user;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: secretKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, status: 401, message: 'Session invalide ou expirée.' };
    user = await res.json().catch(() => null);
  } catch (err) {
    console.error('[adminAuth] appel Supabase Auth échoué —', err.message);
    return { ok: false, status: 502, message: 'Impossible de vérifier la session pour le moment.' };
  }
  if (!user || !user.id) return { ok: false, status: 401, message: 'Session invalide.' };

  let profile;
  try {
    // `role` est sélectionné avec un repli sur l'ancien comportement : si la
    // migration 0003 (ajout de la colonne) n'a pas encore été exécutée,
    // Supabase répond 400 sur une colonne inconnue — on retente alors SANS
    // `role` plutôt que de casser tout l'admin existant (équipements, etc.)
    // pour un site qui n'a pas encore migré.
    let profiles;
    try {
      profiles = await supabaseRequest('admin_profiles', {
        query: `user_id=eq.${encodeURIComponent(user.id)}&select=user_id,is_active,full_name,role`,
        quiet: true,
      });
    } catch (err) {
      profiles = await supabaseRequest('admin_profiles', {
        query: `user_id=eq.${encodeURIComponent(user.id)}&select=user_id,is_active,full_name`,
        quiet: true,
      });
    }
    profile = Array.isArray(profiles) ? profiles[0] : null;
  } catch (err) {
    console.error('[adminAuth] lecture admin_profiles échouée —', err.message);
    return { ok: false, status: 502, message: 'Impossible de vérifier les autorisations pour le moment.' };
  }

  if (!profile || !profile.is_active) {
    return { ok: false, status: 403, message: 'Accès administrateur non autorisé pour ce compte.' };
  }

  // Avant la migration 0003 (colonne role inexistante), `role` est undefined
  // ici — repli sur 'ventes' (accès complet sauf suppression), jamais
  // 'lecture_seule' par défaut, pour ne jamais restreindre silencieusement
  // un admin qui avait un accès complet avant l'ajout du RBAC.
  const role = profile.role || 'ventes';

  return { ok: true, userId: user.id, email: user.email, fullName: profile.full_name || null, role };
}

/**
 * Vérifie que le rôle de l'admin authentifié fait partie des rôles
 * autorisés pour cette action. À utiliser APRÈS verifyAdminRequest (jamais
 * à la place) — ne revalide rien auprès de Supabase Auth, se fie
 * uniquement au `role` déjà renvoyé par un appel verifyAdminRequest réussi
 * dans la MÊME requête.
 */
function requireRole(auth, allowedRoles) {
  if (!auth || !auth.ok) return { ok: false, status: 401, message: 'Authentification requise.' };
  if (!allowedRoles.includes(auth.role)) {
    return { ok: false, status: 403, message: 'Votre rôle ne permet pas cette action.' };
  }
  return { ok: true };
}

/**
 * Journalise une action admin — best-effort : un échec de journalisation
 * ne doit jamais faire échouer l'action elle-même.
 */
async function logAdminAction(adminUserId, action, entityType, entityId, details) {
  try {
    await supabaseRequest('admin_audit_log', {
      method: 'POST',
      body: {
        admin_user_id: adminUserId,
        action,
        entity_type: entityType || null,
        entity_id: entityId || null,
        details: details !== undefined ? details : null,
      },
    });
  } catch (err) {
    console.warn('[adminAuth] journalisation de l\'action échouée (best-effort) —', err.message);
  }
}

module.exports = { verifyAdminRequest, logAdminAction, requireRole };
