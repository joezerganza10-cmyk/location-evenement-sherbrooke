/**
 * 906 Réceptions — identité et interface commune.
 *
 * Centralise le nom de marque, le téléphone et le courriel à un seul
 * endroit (BRAND) : toutes les pages injectent le header et le footer
 * depuis ici plutôt que de les coder en dur, pour qu'un changement de nom
 * de marque ne se fasse qu'ici. Ne mélange jamais un autre nom de marque
 * dans une page — si besoin d'un autre nom, change BRAND.name.
 */
const BRAND = {
  name: '906 Réceptions',
  tagline: "Location d'équipements · Décoration · Organisation d'événements",
  logo: '/logo-906-receptions.png',
  phoneDisplay: '(819) 678-9242',
  phoneHref: 'tel:+18196789242',
  email: 'reservations@salle906galtest.ca',
  region: 'Sherbrooke et en Estrie',
};

const CART_KEY = 'les_cart_v1';

const NAV_ITEMS = [
  { key: 'accueil', label: 'Identité', href: '/' },
  { key: 'equipements', label: 'Équipements', href: '/equipements' },
  { key: 'decoration', label: 'Décoration', href: '/decoration' },
  { key: 'organisation', label: 'Organisation', href: '/organisation' },
  { key: 'contact', label: 'Contact', href: '/contact' },
];

function cartCount(){
  try {
    const cart = JSON.parse(sessionStorage.getItem(CART_KEY) || '[]');
    return cart.reduce((n, c) => n + (c.qty || 0), 0);
  } catch (e) { return 0; }
}

function renderSiteChrome(activeKey){
  const navEl = document.getElementById('site-nav');
  const footEl = document.getElementById('site-footer');

  if (navEl){
    navEl.innerHTML = `
      <a class="logo" href="/"><img src="${BRAND.logo}" alt="" class="logo-mark"><span>${BRAND.name}</span></a>
      <button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Ouvrir le menu">
        <span></span><span></span><span></span>
      </button>
      <div class="nav-links" id="nav-links">
        ${NAV_ITEMS.map(i => `<a href="${i.href}"${i.key === activeKey ? ' class="is-current"' : ''}>${i.label}</a>`).join('')}
        <a href="/equipements#cart-section" class="nav-cart" id="nav-cart">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="21" r="1.4"/><circle cx="18" cy="21" r="1.4"/><path d="M2.5 3h2.4l2.6 12.6a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6"/></svg>
          <span>Ma sélection</span>
          <span class="nav-cart-count" id="nav-cart-count">0</span>
        </a>
        <a href="/equipements#demande-soumission" class="btn btn-sm nav-cta">Demander une soumission</a>
      </div>`;
    const toggle = document.getElementById('nav-toggle');
    const links = document.getElementById('nav-links');
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      links.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
    updateCartBadge();
  }

  if (footEl){
    footEl.innerHTML = `
      <div class="wrap footer-grid">
        <div>
          <div class="footer-brand"><img src="${BRAND.logo}" alt="" class="footer-logo-mark">${BRAND.name}</div>
          <p>${BRAND.tagline}<br>${BRAND.region}.</p>
        </div>
        <div class="footer-links">
          ${NAV_ITEMS.map(i => `<a href="${i.href}">${i.label}</a>`).join('')}
        </div>
        <div class="footer-contact">
          <a href="${BRAND.phoneHref}">${BRAND.phoneDisplay}</a>
          <a href="mailto:${BRAND.email}">${BRAND.email}</a>
        </div>
      </div>
      <div class="footer-bottom">${BRAND.name} — les demandes de décoration et d'organisation sont réalisées par des équipes partenaires.</div>`;
  }
}

function updateCartBadge(){
  const el = document.getElementById('nav-cart-count');
  if (!el) return;
  const n = cartCount();
  el.textContent = n;
  el.style.display = n > 0 ? 'inline-flex' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('storage', updateCartBadge);
});
