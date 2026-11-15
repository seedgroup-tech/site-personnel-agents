// Recette QA automatique S-001 : `node tests/verifier.mjs`
// Node pur (modules intégrés uniquement), aucune dépendance.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const existe = (p) => fs.existsSync(path.join(RACINE, p));

// ---------- utilitaires d'analyse ----------
const sansCommentaires = (h) => h.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
const VOIDS = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source', 'area', 'base', 'col', 'embed', 'wbr']);

function attrs(brut) {
  const o = {};
  const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m;
  while ((m = re.exec(brut))) {
    let v = m[2];
    if (v === undefined) v = '';
    else if (/^["']/.test(v)) v = v.slice(1, -1);
    o[m[1].toLowerCase()] = v;
  }
  return o;
}

// Retourne la liste des éléments : {name, attrs, start, end, innerStart, innerEnd, hiddenSelf, hiddenAnc}
function analyser(html) {
  const propre = sansCommentaires(html);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const els = [];
  const pile = [];
  let m;
  while ((m = re.exec(propre))) {
    const [tout, ferme, nom0, reste] = m;
    const nom = nom0.toLowerCase();
    if (ferme) {
      for (let i = pile.length - 1; i >= 0; i--) {
        if (pile[i].name === nom) {
          const el = pile[i];
          el.innerEnd = m.index;
          el.end = m.index + tout.length;
          pile.length = i;
          break;
        }
      }
    } else {
      const a = attrs(reste.replace(/\/$/, ''));
      const el = {
        name: nom, attrs: a, start: m.index, innerStart: m.index + tout.length,
        innerEnd: m.index + tout.length, end: m.index + tout.length,
        hiddenSelf: 'hidden' in a,
        hiddenAnc: pile.some((p) => p.hiddenSelf),
      };
      els.push(el);
      if (!VOIDS.has(nom) && !/\/\s*>$/.test(tout)) pile.push(el);
    }
  }
  return { propre, els };
}

const texte = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const externe = (u) => /^(https?:)?\/\//i.test((u || '').trim());

// ---------- chargement ----------
const html = lire('index.html');
const { propre, els } = analyser(html);
const css = lire('assets/style.css');
const js = lire('assets/langue.js');
const corps = (() => {
  const d = propre.search(/<body[\s>]/i);
  const f = propre.search(/<\/body>/i);
  return { debut: d, fin: f };
})();
const dansCorps = (el) => el.start > corps.debut && el.start < corps.fin;

// Fichiers du dépôt (hors .git et tests/)
function fichiers(dir = '', acc = []) {
  for (const e of fs.readdirSync(path.join(RACINE, dir), { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) { if (rel !== 'tests') fichiers(rel, acc); } else acc.push(rel);
  }
  return acc;
}

const resultats = [];
function critere(id, titre, fn) {
  const pb = [];
  const infos = [];
  try { fn(pb, infos); } catch (e) { pb.push('erreur du script : ' + e.message); }
  resultats.push({ id, titre, ok: pb.length === 0, detail: pb.length ? pb.join(' ; ') : infos.join(' ; ') });
}

// ---------- CA-01 ----------
critere('CA-01', 'index.html à la racine, aucun chemin sensible, ressources référencées présentes', (pb, inf) => {
  if (!existe('index.html')) pb.push('index.html absent');
  let diff = [];
  try {
    diff = execFileSync('git', ['diff', '--name-only', 'main...HEAD'], { cwd: RACINE, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) { pb.push('git diff impossible : ' + String(e.message).split('\n')[0]); }
  const sensibles = [
    /^CLAUDE\.md$/i, /^\.claude\//, /^\.github\//, /^\.mcp\.json$/, /(^|\/)\.env[^/]*$/,
    /\.pem$/i, /\.key$/i, /(^|\/)package\.json$/, /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|npm-shrinkwrap\.json)$/,
    /(^|\/)wrangler\.[^/]+$/, /(^|\/)vercel\.json$/, /(^|\/)netlify\.toml$/, /(^|\/)_headers$/, /(^|\/)_redirects$/,
    /^supabase\//, /^migrations\//, /^policies\//,
  ];
  const touches = diff.filter((f) => sensibles.some((r) => r.test(f)));
  if (touches.length) pb.push('chemins sensibles touchés : ' + touches.join(', '));
  // ressources référencées
  const refs = [];
  for (const el of els) {
    if (el.name === 'link' && el.attrs.href) refs.push(el.attrs.href);
    if ((el.name === 'script' || el.name === 'img') && el.attrs.src) refs.push(el.attrs.src);
  }
  for (const r of refs) {
    if (externe(r)) continue;
    const p = r.split(/[?#]/)[0];
    if (!existe(p)) pb.push('fichier référencé introuvable : ' + r);
  }
  for (const m of css.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/gi)) {
    if (!externe(m[1]) && !/^data:/i.test(m[1]) && !existe(path.posix.join('assets', m[1]))) pb.push('url() CSS introuvable : ' + m[1]);
  }
  inf.push(`diff main...HEAD = [${diff.join(', ')}] ; références : ${refs.join(', ')}`);
});

// ---------- CA-02 ----------
critere('CA-02', 'viewport correct, html lang="fr", éléments anglais en lang="en"', (pb, inf) => {
  const vp = els.find((e) => e.name === 'meta' && (e.attrs.name || '').toLowerCase() === 'viewport');
  if (!vp) pb.push('meta viewport absente');
  else {
    const c = (vp.attrs.content || '').replace(/\s+/g, '');
    if (!/width=device-width/.test(c) || !/initial-scale=1(\.0)?(,|$)/.test(c)) pb.push('viewport incorrect : ' + vp.attrs.content);
    if (/user-scalable=(no|0)/i.test(c)) pb.push('user-scalable=no présent');
    if (/maximum-scale=1(\.0)?(,|$)/i.test(c)) pb.push('maximum-scale=1 présent');
  }
  const h = els.find((e) => e.name === 'html');
  if (!h || h.attrs.lang !== 'fr') pb.push('<html lang="fr"> absent');
  const en = els.filter((e) => dansCorps(e) && e.attrs.lang === 'en');
  if (!en.length) pb.push('aucun élément lang="en"');
  inf.push(`viewport « ${vp && vp.attrs.content} », html lang=${h && h.attrs.lang}, ${en.length} éléments lang="en"`);
});

// ---------- CA-03 ----------
critere('CA-03', 'mêmes contenus FR/EN, EN masqués, FR visibles, paires adjacentes', (pb, inf) => {
  const lg = els.filter((e) => dansCorps(e) && (e.attrs.lang === 'fr' || e.attrs.lang === 'en'));
  const fr = lg.filter((e) => e.attrs.lang === 'fr');
  const en = lg.filter((e) => e.attrs.lang === 'en');
  if (fr.length !== en.length) pb.push(`fr=${fr.length} ≠ en=${en.length}`);
  const enVisibles = en.filter((e) => !e.hiddenSelf);
  if (enVisibles.length) pb.push(`${enVisibles.length} lang="en" sans hidden (ex. ${texte(propre.slice(enVisibles[0].innerStart, enVisibles[0].innerEnd))})`);
  const frCaches = fr.filter((e) => e.hiddenSelf);
  if (frCaches.length) pb.push(`${frCaches.length} lang="fr" avec hidden`);
  // adjacence : suite d'ouvertures fr,en,fr,en... (un en suit son fr, y compris imbriqué dans l'ordre du document)
  let attendu = 'fr';
  for (const e of lg) {
    if (e.attrs.lang !== attendu) { pb.push(`ordre rompu près de « ${texte(propre.slice(e.innerStart, e.innerEnd)).slice(0, 40)} »`); break; }
    attendu = attendu === 'fr' ? 'en' : 'fr';
  }
  // paires : le en suit immédiatement la fin du fr (aux espaces près)
  let nonAdj = 0;
  for (let i = 0; i + 1 < lg.length; i += 2) {
    const entre = propre.slice(lg[i].end, lg[i + 1].start);
    if (entre.trim() !== '') nonAdj++;
  }
  if (nonAdj) pb.push(`${nonAdj} paire(s) non adjacente(s)`);
  if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css)) pb.push('règle CSS [hidden]{display:none !important} absente');
  inf.push(`${fr.length} fr / ${en.length} en, paires adjacentes, règle CSS [hidden] présente`);
});

// ---------- CA-04 ----------
critere('CA-04', 'sélecteur de langue : boutons FR et EN avec aria-pressed, non masqués', (pb, inf) => {
  const bs = els.filter((e) => e.name === 'button');
  const trouve = {};
  for (const b of bs) {
    const t = texte(propre.slice(b.innerStart, b.innerEnd)).toUpperCase();
    if (t === 'FR' || t === 'EN') trouve[t] = b;
  }
  for (const k of ['FR', 'EN']) {
    const b = trouve[k];
    if (!b) { pb.push(`bouton ${k} absent`); continue; }
    if (!('aria-pressed' in b.attrs)) pb.push(`bouton ${k} sans aria-pressed`);
    if (b.hiddenSelf || b.hiddenAnc) pb.push(`bouton ${k} masqué`);
  }
  inf.push(`boutons : ${Object.entries(trouve).map(([k, b]) => k + ' aria-pressed=' + b.attrs['aria-pressed']).join(', ')}`);
});

// ---------- CA-05 ----------
critere('CA-05', 'aucun form/input/textarea/select dans les fichiers HTML', (pb, inf) => {
  const tous = [];
  (function parcourir(d) {
    for (const e of fs.readdirSync(path.join(RACINE, d || '.'), { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const rel = path.posix.join(d, e.name);
      if (e.isDirectory()) parcourir(rel); else if (/\.html?$/i.test(e.name)) tous.push(rel);
    }
  })('');
  for (const f of tous) {
    const found = sansCommentaires(lire(f)).match(/<\s*(form|input|textarea|select)\b/gi);
    if (found) pb.push(`${f} : ${found.join(', ')}`);
    const sub = sansCommentaires(lire(f)).match(/<\s*button\b[^>]*\btype\s*=\s*["']?submit\b[^>]*>/gi);
    if (sub) pb.push(`${f} : bouton submit`);
    const sansType = sansCommentaires(lire(f)).match(/<\s*button\b(?![^>]*\btype\s*=)[^>]*>/gi);
    if (sansType) pb.push(`${f} : button sans type (submit par défaut)`);
  }
  inf.push(`${tous.length} fichier(s) HTML analysé(s) : ${tous.join(', ')}`);
});

// ---------- CA-06 ----------
critere('CA-06', 'contact réel : mailto, wa.me, textes FR/EN, aucune autre coordonnée', (pb, inf) => {
  const MAIL = 'yanfimba@seedscaleup.com';
  const WA = 'https://wa.me/237690406650';
  const liens = els.filter((e) => e.name === 'a' && e.attrs.href !== undefined);
  const mail = liens.filter((e) => /^mailto:/i.test(e.attrs.href));
  const wa = liens.filter((e) => /^https?:\/\/wa\.me\//i.test(e.attrs.href));
  if (mail.length !== 1 || mail[0].attrs.href !== 'mailto:' + MAIL) pb.push(`mailto attendu 1× « mailto:${MAIL} », trouvé : ${mail.map((m) => m.attrs.href).join(' | ') || 'aucun'}`);
  if (wa.length !== 1 || wa[0].attrs.href !== WA) pb.push(`wa.me attendu 1× « ${WA} », trouvé : ${wa.map((m) => m.attrs.href).join(' | ') || 'aucun'}`);
  if (wa[0] && (wa[0].attrs.target !== '_blank' || !/\bnoopener\b/.test(wa[0].attrs.rel || '') || !/\bnoreferrer\b/.test(wa[0].attrs.rel || ''))) pb.push('wa.me sans target=_blank / rel noopener noreferrer');
  const norm = (t) => t.replace(/\s+/g, ' ');
  for (const [l, attendu] of [[mail[0], MAIL], [wa[0], '+237 690406650']]) {
    if (!l) continue;
    for (const lang of ['fr', 'en']) {
      const sp = els.filter((e) => e.start >= l.innerStart && e.end <= l.innerEnd && e.attrs.lang === lang && !e.hiddenAnc && !/sr-only/.test(propre.slice(e.start, e.innerStart)));
      if (!sp.some((e) => norm(texte(propre.slice(e.innerStart, e.innerEnd))).includes(attendu))) pb.push(`« ${attendu} » absent du texte ${lang}`);
    }
  }
  const mails = (propre.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []);
  const autres = mails.filter((m) => m.toLowerCase() !== MAIL);
  if (autres.length) pb.push('autre(s) adresse(s) e-mail : ' + autres.join(', '));
  for (const m of propre.matchAll(/\+?\d[\d\s]{6,}\d/g)) {
    const n = m[0].replace(/[\s+]/g, '');
    if (n.length >= 8 && n !== '237690406650') pb.push('autre suite de chiffres : ' + m[0].trim());
  }
  const sec = els.find((e) => e.name === 'section' && e.attrs.id === 'contact');
  if (!sec) pb.push('section #contact absente');
  else if (/à compléter/i.test(propre.slice(sec.start, sec.end))) pb.push('« à compléter » dans #contact');
  inf.push(`mailto=${mail[0] && mail[0].attrs.href} ; wa=${wa[0] && wa[0].attrs.href} ; textes FR/EN vérifiés ; ${mails.length} adresse(s) e-mail dans index.html`);
});

// ---------- CA-07 ----------
const cartes = els.filter((e) => e.name === 'li' && /\bcarte\b/.test(e.attrs.class || ''));
const contenuCarte = (c) => propre.slice(c.start, c.end);
const nomCarte = (c) => { const h3 = els.find((e) => e.name === 'h3' && e.start > c.start && e.end <= c.end); return h3 ? texte(propre.slice(h3.innerStart, h3.innerEnd)) : ''; };
critere('CA-07', '10 projets visibles dans l’ordre, descriptions exactes FR/EN, badges, liens', (pb, inf) => {
  const A = 'Description à compléter par le propriétaire.';
  const AE = 'Description to be completed by the owner.';
  const attendu = [
    ['KLOQin', 'Application de pointage des employés par QR code, utilisée par des entreprises au Cameroun.', 'Employee time-tracking app using QR codes, used by companies in Cameroon.', ['https://kloqin.com']],
    ['SOLIDA', "Application de gestion de l'AMIDEFEM.", 'Management application for AMIDEFEM.', []],
    ['SeedScaleUp', 'Agence 360° de marketing, de branding et de croissance, basée à Douala et Yaoundé.', '360° marketing, branding and growth agency based in Douala and Yaoundé.', ['https://www.seedscaleup.com']],
    ['LPMP News', A, AE, []], ['Prüfbereit', A, AE, []], ['Doomee', A, AE, []], ['Bilan Quotidien', A, AE, []], ['Fioblo', A, AE, []],
    ['Fimba', 'Logiciel de gestion de boutique.', 'Shop management software.', []],
    ['SeedGroup', "Écosystème d'entreprises africaines, dont je suis le Responsable financier.", 'African business ecosystem, where I serve as Head of Finance.', []],
  ];
  const n = (t) => texte(t).replace(/[’‘]/g, "'");
  const noms = cartes.map(nomCarte);
  if (cartes.length !== attendu.length) pb.push(`${cartes.length} cartes (${attendu.length} attendues)`);
  if (noms.join('|') !== attendu.map((x) => x[0]).join('|')) pb.push(`ordre/noms : ${noms.join(', ')}`);
  cartes.forEach((c, i) => {
    const nom = nomCarte(c);
    if (c.hiddenSelf || c.hiddenAnc) pb.push(nom + ' : carte masquée');
    const att = attendu.find((x) => x[0] === nom);
    if (!att) return;
    const ps = els.filter((e) => e.name === 'p' && e.start > c.start && e.end <= c.end && !/badge-ligne/.test(e.attrs.class || '') && !els.some((a) => a.name === 'a' && a.start > e.start && a.end <= e.end));
    const desc = (lang) => ps.flatMap((p) => els.filter((e) => e.start > p.start && e.end <= p.end && e.attrs.lang === lang)).map((e) => n(propre.slice(e.innerStart, e.innerEnd)));
    const fr = desc('fr'), en = desc('en');
    if (fr.length !== 1 || fr[0] !== att[1]) pb.push(`${nom} : FR « ${fr.join(' / ')} » ≠ « ${att[1]} »`);
    if (en.length !== 1 || en[0] !== att[2]) pb.push(`${nom} : EN « ${en.join(' / ')} » ≠ « ${att[2]} »`);
    const cc = contenuCarte(c);
    if (!/lang="fr"[^>]*>\s*brouillon à valider/.test(cc)) pb.push(nom + ' : badge FR absent');
    if (!/lang="en"[^>]*>\s*draft to be validated/.test(cc)) pb.push(nom + ' : badge EN absent');
    const hrefs = els.filter((e) => e.name === 'a' && e.start > c.start && e.end <= c.end).map((e) => e.attrs.href);
    if (hrefs.join('|') !== att[3].join('|')) pb.push(`${nom} : liens [${hrefs.join(', ')}] ≠ [${att[3].join(', ')}]`);
  });
  inf.push(`${cartes.length} cartes visibles : ${noms.join(', ')}`);
});

// ---------- CA-08 ----------
critere('CA-08', 'nom du projet retiré absent de tous les fichiers (suivis et non suivis) et noms de fichiers', (pb, inf) => {
  const re = new RegExp(['Mo', 'tion'].join('') + '[\\s_-]*' + ['Fl', 'ow'].join(''), 'i');
  const git = (args) => execFileSync('git', args, { cwd: RACINE, encoding: 'utf8' }).split('\n').filter(Boolean);
  const liste = [...new Set([...git(['ls-files']), ...git(['ls-files', '--others', '--exclude-standard'])])];
  for (const f of liste) {
    let fautif = re.test(f);
    if (!fautif && fs.existsSync(path.join(RACINE, f))) fautif = re.test(fs.readFileSync(path.join(RACINE, f)).toString('utf8'));
    if (fautif) pb.push(f);
  }
  inf.push(`${liste.length} fichiers analysés (suivis + non suivis, y compris tests/verifier.mjs)`);
});

// ---------- CA-09 ----------
critere('CA-09', 'mot interdit (Faida) absent de tous les fichiers', (pb, inf) => {
  const mot = ['fa', 'ida'].join('');
  const re = new RegExp(mot, 'i');
  const liste = fichiers();
  for (const f of liste) {
    if (re.test(f)) pb.push('nom de fichier : ' + f);
    const buf = fs.readFileSync(path.join(RACINE, f));
    const t = buf.toString('utf8');
    if (re.test(t)) {
      const l = t.split('\n').findIndex((x) => re.test(x)) + 1;
      pb.push(`${f}:${l}`);
    }
  }
  inf.push(`${liste.length} fichiers analysés : ${liste.join(', ')}`);
});

// ---------- CA-10 ----------
critere('CA-10', 'aucune ressource externe, aucun appel réseau dans le JS', (pb, inf) => {
  for (const e of els) {
    if (e.attrs.src !== undefined && externe(e.attrs.src)) pb.push(`<${e.name} src="${e.attrs.src}"> externe`);
    if (e.name === 'link' && externe(e.attrs.href)) pb.push(`<link href="${e.attrs.href}"> externe`);
    if (['iframe', 'embed', 'object', 'form'].includes(e.name)) pb.push(`<${e.name}> présent`);
    if (e.name === 'script' && !e.attrs.src) pb.push('script en ligne');
    if (e.name === 'style') pb.push('<style> en ligne');
    if (e.name === 'base') pb.push('<base> présent');
    if (e.name === 'meta' && /^refresh$/i.test(e.attrs['http-equiv'] || '')) pb.push('<meta http-equiv="refresh"> présent');
    for (const k of Object.keys(e.attrs)) if (/^on[a-z]+$/.test(k)) pb.push(`attribut ${k}= sur <${e.name}>`);
    if ('style' in e.attrs) pb.push(`attribut style= sur <${e.name}>`);
    if (e.attrs.srcset && /(https?:)?\/\//.test(e.attrs.srcset)) pb.push('srcset externe');
  }
  for (const m of propre.matchAll(/url\(\s*["']?\s*(https?:)?\/\//gi)) pb.push('url() externe dans HTML');
  for (const m of css.matchAll(/url\(\s*["']?\s*(https?:)?\/\/[^)]*/gi)) pb.push('url() externe dans CSS : ' + m[0]);
  if (/@import/i.test(css)) pb.push('@import dans CSS');
  const jsSansCom = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const mot of ['fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'importScripts']) {
    if (new RegExp('\\b' + mot + '\\b').test(jsSansCom)) pb.push(`${mot} dans langue.js`);
  }
  if (/\bimport\s*\(|^\s*import\s/m.test(jsSansCom)) pb.push('import dans langue.js');
  if (/https?:\/\/|["'`]\/\//.test(jsSansCom)) pb.push('adresse http(s) ou // dans langue.js');
  inf.push('aucun src/link/url()/@import externe ; aucun appel réseau dans langue.js');
});

// ---------- CA-11 ----------
critere('CA-11', 'liens internes valides, alt sur les images, liens externes sûrs', (pb, inf) => {
  const ids = new Set(els.map((e) => e.attrs.id).filter(Boolean));
  let nbA = 0, nbExt = 0;
  for (const e of els) {
    if (e.name === 'img' && !('alt' in e.attrs)) pb.push('img sans alt');
    if (e.name !== 'a' || e.attrs.href === undefined) continue;
    nbA++;
    const h = e.attrs.href;
    if (h.startsWith('#')) {
      if (h.length < 2 || !ids.has(h.slice(1))) pb.push(`ancre ${h} sans id correspondant`);
    } else if (externe(h)) {
      nbExt++;
      if ((e.attrs.target || '') !== '_blank') pb.push(`${h} sans target="_blank"`);
      if (!/(^|\s)noopener(\s|$)/i.test(e.attrs.rel || '')) pb.push(`${h} sans rel noopener`);
    } else if (/^(mailto|tel):/i.test(h)) {
      // ok
    } else if (!existe(h.split(/[?#]/)[0])) pb.push('chemin relatif introuvable : ' + h);
  }
  const nbImg = els.filter((e) => e.name === 'img').length;
  inf.push(`${nbA} liens <a> (${nbExt} externes), ${nbImg} image(s)`);
});

// ---------- CA-12 ----------
critere('CA-12', 'aucun nombre (hors « 360° ») ni mot interdit dans les cartes projets', (pb, inf) => {
  const mots = [/\bclients?\b/i, /\bleaders?\b/i, /\bmillions?\b/i, /%/, /chiffres? d['’]affaires/i, /\butilisateurs?\b/i, /\busers?\b/i, /\bcustomers?\b/i,
    /n°\s*1/i, /\bprimée?s?\b/i, /\brecords?\b/i, /\bbest\b/i, /\bawards?\b/i];
  for (const c of cartes) {
    const nom = nomCarte(c);
    const t = texte(contenuCarte(c)).replace(/360°/g, '');
    const num = t.match(/.{0,15}\d.{0,15}/);
    if (num) pb.push(`${nom} : nombre dans « ${num[0]} »`);
    for (const r of mots) if (r.test(t)) pb.push(`${nom} : mot interdit ${r}`);
    // « entreprises » / « companies » : admis dans KLOQin ; SeedGroup l'emploie dans le texte imposé par CA-07 (voir rapport)
    if (/\b(entreprises?|companies|company)\b/i.test(t) && !['KLOQin', 'SeedGroup'].includes(nom)) pb.push(`${nom} : « entreprises/companies » hors cartes admises`);
  }
  inf.push(`${cartes.length} cartes analysées ; seul nombre admis : « 360° »`);
});

// ---------- rapport ----------
let ok = 0;
for (const r of resultats) {
  if (r.ok) ok++;
  console.log(`${r.id} ${r.ok ? 'OK' : 'KO'} — ${r.titre} — ${r.detail}`);
}
console.log(`\nTotal : ${ok}/${resultats.length} OK`);
process.exit(ok === resultats.length ? 0 : 1);
