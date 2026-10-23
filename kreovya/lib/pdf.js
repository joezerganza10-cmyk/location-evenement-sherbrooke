/**
 * Générateur PDF minimal, sans dépendance npm (aucun paquet comme pdfkit
 * n'est disponible dans ce projet — zéro dépendance externe, cohérent avec
 * le reste du site). Écrit directement la syntaxe PDF : suffisant pour un
 * document texte/tableaux à une page (polices standard Helvetica, jamais
 * besoin d'être incluses dans le fichier).
 *
 * Usage :
 *   const doc = createPdfDoc();
 *   doc.text(50, 740, 'Bonjour', { size: 14, bold: true });
 *   doc.line(50, 730, 560, 730);
 *   const buffer = doc.build();
 *
 * Coordonnées en points PDF, origine en bas à gauche de la page
 * (comme le format PDF natif) — page Lettre US : 612 x 792 pt.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// WinAnsiEncoding couvre les caractères français accentués courants dans
// la même plage que Latin-1 pour les lettres (0xC0-0xFF) — suffisant pour
// du texte d'affaires en français. Les caractères typographiques (guillemets
// courbes, tirets longs) sont ramenés à leurs équivalents ASCII simples pour
// rester dans une plage sûre et prévisible.
function sanitizeForPdf(str) {
  return String(str ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '?'); // tout caractère hors Latin-1 -> '?' plutôt qu'un octet corrompu
}

function escapePdfString(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function createPdfDoc() {
  const ops = []; // opérateurs de flux de contenu, dans l'ordre d'écriture

  function text(x, y, str, opts = {}) {
    const size = opts.size || 11;
    const font = opts.bold ? '/F2' : '/F1';
    const clean = escapePdfString(sanitizeForPdf(str));
    ops.push(`BT ${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${clean}) Tj ET`);
  }

  function line(x1, y1, x2, y2, opts = {}) {
    const width = opts.width || 0.75;
    ops.push(`${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  function rectFill(x, y, w, h, opts = {}) {
    const [r, g, b] = opts.color || [0.95, 0.95, 0.95];
    ops.push(`${r} ${g} ${b} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  function build() {
    const content = ops.join('\n');
    const contentBytes = Buffer.from(content, 'latin1');

    // Objets PDF : 1=Catalog 2=Pages 3=Page 4=Content 5=FontHelvetica 6=FontHelvetica-Bold
    const objects = [];
    objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
    objects[2] = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
    objects[3] = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n`;
    objects[4] = `4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream\nendobj\n`;
    objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
    objects[6] = `6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [0];
    for (let i = 1; i <= 6; i++) {
      offsets[i] = Buffer.byteLength(pdf, 'latin1');
      pdf += objects[i];
    }
    const xrefStart = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 7\n0000000000 65535 f \n`;
    for (let i = 1; i <= 6; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return Buffer.from(pdf, 'latin1');
  }

  return { text, line, rectFill, build, PAGE_WIDTH, PAGE_HEIGHT };
}

module.exports = { createPdfDoc, PAGE_WIDTH, PAGE_HEIGHT, sanitizeForPdf };
