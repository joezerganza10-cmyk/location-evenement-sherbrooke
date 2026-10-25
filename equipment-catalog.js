/**
 * 906 LOCATION ÉQUIPEMENTS — Catalogue.
 *
 * SOURCE DE VÉRITÉ POUR LE CATALOGUE OFFICIEL (en attendant la migration
 * Supabase 0002_catalogue_officiel.sql, qui reprend exactement les mêmes 7
 * produits par leur `id` — voir ce fichier pour le détail du mapping
 * id/code). Ce fichier est aussi require() directement par
 * netlify/functions/equipment-quote-request.js pour recalculer les prix
 * côté serveur — ne JAMAIS faire confiance à un prix envoyé par le
 * navigateur (voir ce fichier).
 *
 * Catégories « vides » (sans aucun produit à `price` non nul) : masquées
 * automatiquement de l'affichage public par location-equipements.html
 * (voir renderFilters / renderCategoryShowcase), SANS être supprimées
 * d'ici — c'est voulu, pour ne rien perdre si un prix leur est ajouté
 * plus tard.
 *
 * Tant qu'un équipement garde `example:true` ou `price:null`, le site
 * affiche "Prix sur demande" et un badge "Exemple" — jamais un prix
 * inventé.
 */
const EQUIPMENT_CATEGORIES = [
  { id: 'chaises', label: 'Chaises et mobilier' },
  { id: 'tables', label: 'Tables de réception' },
  { id: 'sonorisation', label: 'Haut-parleurs et sonorisation' },
  { id: 'audiovisuel', label: 'Équipements audiovisuels' },
  { id: 'accessoires', label: 'Accessoires événementiels' },
  { id: 'cuisson', label: 'Équipement de cuisson' },
];

const EQUIPMENT_ITEMS = [
  // ============================================================
  // CATALOGUE OFFICIEL (7 produits — prix et quantités confirmés)
  // ============================================================

  // ---- Chaises (3 modèles) ----
  {
    id: 'chaise-napoleon-blanche', category: 'chaises', example: false,
    name: 'Chaise Napoléon blanche', description: 'Chaise de réception de style Napoléon, finition blanche — un classique élégant pour mariages et cérémonies.',
    price: 3.50, unit: 'par chaise / jour', totalQty: 200, minDays: 1, photo: 'chaise-napoleon-blanche.webp',
  },
  {
    id: 'chaise-dossier-rond', category: 'chaises', example: false,
    name: 'Chaise à dossier rond', description: 'Chaise de réception à dossier rond, pour habiller vos tables de banquet.',
    price: 3.00, unit: 'par chaise / jour', totalQty: 60, minDays: 1, photo: 'chaise-banquet-ovale.jpg',
  },
  {
    id: 'chaise-accoudoirs', category: 'chaises', example: false,
    name: 'Chaise avec accoudoirs', description: 'Chaise avec accoudoirs, confortable pour les assemblées, conférences et événements prolongés.',
    price: 2.00, unit: 'par chaise / jour', totalQty: 100, minDays: 1, photo: 'chaise-empilable-accoudoirs.jpg',
  },

  // ---- Tables (2 modèles) — louées sans nappe, voir Accessoires ----
  {
    id: 'table-ronde', category: 'tables', example: false,
    name: 'Table ronde', description: 'Table ronde pour vos réceptions et banquets. Nappe non incluse — disponible séparément à 11 $/jour.',
    price: 13.00, unit: 'par table / jour', totalQty: 12, minDays: 1, photo: 'table-ronde-nappe-noire.jpg',
    photoNote: 'Photo de présentation : nappe louée séparément', tableclothOffer: true,
  },
  {
    id: 'table-rectangulaire', category: 'tables', example: false,
    name: 'Table rectangulaire', description: 'Table rectangulaire polyvalente, pour buffets, inscriptions ou aires de travail. Nappe non incluse — disponible séparément à 11 $/jour.',
    price: 10.00, unit: 'par table / jour', totalQty: 5, minDays: 1, photo: 'table-rectangulaire-pliante.jpg',
    tableclothOffer: true,
  },

  // ---- Sonorisation (2 types d'équipements) ----
  {
    id: 'haut-parleur', category: 'sonorisation', example: false,
    name: 'Haut-parleur', description: 'Haut-parleur sur pied pour sonoriser votre événement. Prix affiché pour une unité — la photo du fournisseur montre une paire.',
    price: 75.00, unit: 'par haut-parleur / jour', totalQty: 2, minDays: 1, photo: 'haut-parleur-sur-pied.jpg', photoCropLeft: true, photoNote: 'Prix pour une unité',
  },
  {
    id: 'microphone', category: 'sonorisation', example: false,
    name: 'Microphone', description: 'Microphone sans fil pour vos discours, animations et présentations. Prix affiché pour une unité — la photo du fournisseur montre une paire.',
    price: 20.00, unit: 'par microphone / jour', totalQty: 6, minDays: 1, photo: 'microphone-sans-fil.jpg', photoCropLeft: true, photoNote: 'Prix pour une unité',
  },

  // ---- Nappes (accessoire de table, vendu séparément — 4 couleurs) ----
  {
    id: 'nappe-noire', category: 'accessoires', example: false,
    name: 'Nappe noire', description: 'Nappe pour table ronde ou rectangulaire, louée séparément de la table.',
    price: 11.00, unit: 'par nappe / jour', totalQty: null, minDays: 1, photo: null, isTablecloth: true, colorLabel: 'Noir',
  },
  {
    id: 'nappe-rouge', category: 'accessoires', example: false,
    name: 'Nappe rouge', description: 'Nappe pour table ronde ou rectangulaire, louée séparément de la table.',
    price: 11.00, unit: 'par nappe / jour', totalQty: null, minDays: 1, photo: null, isTablecloth: true, colorLabel: 'Rouge',
  },
  {
    id: 'nappe-blanche', category: 'accessoires', example: false,
    name: 'Nappe blanche', description: 'Nappe pour table ronde ou rectangulaire, louée séparément de la table.',
    price: 11.00, unit: 'par nappe / jour', totalQty: null, minDays: 1, photo: null, isTablecloth: true, colorLabel: 'Blanc',
  },
  {
    id: 'nappe-bleue', category: 'accessoires', example: false,
    name: 'Nappe bleue', description: 'Nappe pour table ronde ou rectangulaire, louée séparément de la table.',
    price: 11.00, unit: 'par nappe / jour', totalQty: null, minDays: 1, photo: null, isTablecloth: true, colorLabel: 'Bleu',
  },

  // ============================================================
  // HORS CATALOGUE OFFICIEL — sans prix confirmé, donc masqués
  // automatiquement (voir en-tête). Conservés ici volontairement,
  // pas supprimés, en attente d'un prix/d'une politique de
  // facturation confirmée.
  // ============================================================
  {
    id: 'tournage-video', category: 'audiovisuel', example: false,
    name: 'Tournage et production vidéo de votre événement', description: 'Notre équipe filme votre événement avec un équipement professionnel — un service clé en main, pas une location de caméra. Idéal si vous souhaitez que votre vidéo soit montée et mise en ligne par la suite.',
    price: null, unit: 'service par événement', totalQty: null, minDays: 1, photo: 'equipement-audiovisuel.jpg', photoPosition: 'center top',
  },
  {
    id: 'projecteur', category: 'audiovisuel', example: true,
    name: 'Projecteur et écran', description: 'Projecteur vidéo avec écran sur pied, pour présentations et conférences.',
    price: null, unit: 'par forfait / jour', totalQty: null, minDays: 1, photo: null,
  },
  {
    id: 'accessoires-mise-en-place', category: 'accessoires', example: false,
    name: 'Ensemble de mise en place', description: 'Serviettes de tissu et accessoires de table pour compléter votre réception (nappes vendues séparément, voir Nappes).',
    price: null, unit: 'sur demande', totalQty: null, minDays: 1, photo: 'accessoires-mise-en-place.png',
  },
  {
    id: 'chauffe-plats', category: 'cuisson', example: false,
    name: 'Chauffe-plats pour buffet', description: 'Chauffe-plats pour garder les mets chauds lors d\'un service buffet.',
    price: null, unit: 'par unité / jour', totalQty: null, minDays: 1, photo: 'equipement-cuisson.png',
  },
];

if (typeof module !== 'undefined') module.exports = { EQUIPMENT_CATEGORIES, EQUIPMENT_ITEMS };
