/**
 * Conversions dollars <-> cents. Les montants sont TOUJOURS stockés en
 * cents (entiers) en base de données pour éviter les erreurs d'arrondi
 * des nombres flottants — jamais de dollars en virgule flottante en base.
 */
function dollarsToCents(v){
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
function centsToDollars(v){
  if (v === null || v === undefined) return null;
  return Math.round(v) / 100;
}
function formatCAD(cents){
  if (cents === null || cents === undefined) return '—';
  return (Math.round(cents) / 100).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
}

module.exports = { dollarsToCents, centsToDollars, formatCAD };
