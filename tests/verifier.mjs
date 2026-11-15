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
    /^supabase\//, /^migrations\//,
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
  inf.push(`${fr.length} fr / ${en.length} en, paires adjacentes`);
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
  }
  inf.push(`${tous.length} fichier(s) HTML analysé(s) : ${tous.join(', ')}`);
});

// ---------- CA-06 ----------
critere('CA-06', 'lien mailto et lien wa.me avec « [à compléter] », aucune vraie coordonnée', (pb, inf) => {
  const A = 'à compléter';
  const liens = els.filter((e) => e.name === 'a' && e.attrs.href);
  const mail = liens.filter((e) => /^mailto:/i.test(e.attrs.href));
  const wa = liens.filter((e) => /^https:\/\/wa\.me\//i.test(e.attrs.href));
  if (mail.length !== 1) pb.push(`${mail.length} lien(s) mailto (1 attendu)`);
  if (wa.length !== 1) pb.push(`${wa.length} lien(s) wa.me (1 attendu)`);
  for (const l of [...mail, ...wa]) {
    if (!l.attrs.href.includes('[' + A + ']')) pb.push('href sans [à compléter] : ' + l.attrs.href);
    for (const lang of ['fr', 'en']) {
      const sp = els.find((e) => e.start >= l.innerStart && e.end <= l.innerEnd + 1 && e.attrs.lang === lang && !/sr-only/.test(e.attrs.class || '') && /E-?mail|WhatsApp/i.test(propre.slice(e.innerStart, e.innerEnd)));
      if (!sp || !propre.slice(sp.innerStart, sp.innerEnd).includes('[' + A + ']')) pb.push(`texte ${lang} sans [à compléter] pour ${l.attrs.href.slice(0, 20)}`);
    }
  }
  const visible = texte(propre.slice(corps.debut, corps.fin));
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(visible + ' ' + liens.map((l) => l.attrs.href).join(' '))) pb.push('adresse e-mail réelle détectée');
  if (/wa\.me\/\+?\d/.test(propre)) pb.push('numéro wa.me réel détecté');
  if (/(\+|00)\d[\d\s.()-]{7,}\d/.test(visible)) pb.push('numéro de téléphone détecté dans le texte');
  if (/^mailto:[^\[]*\d{5,}/.test(mail[0] ? mail[0].attrs.href : '')) pb.push('chiffres dans mailto');
  inf.push(`mailto=${mail[0] && mail[0].attrs.href} ; wa=${wa[0] && wa[0].attrs.href}`);
});

// ---------- CA-07 ----------
const cartes = els.filter((e) => e.name === 'li' && /\bcarte\b/.test(e.attrs.class || ''));
const contenuCarte = (c) => propre.slice(c.start, c.end);
critere('CA-07', '9 projets visibles avec descriptions FR/EN, badge, liens KLOQin et SeedScaleUp', (pb, inf) => {
  const noms = ['KLOQin', 'SeedScaleUp', 'LPMP News', 'Prüfbereit', 'Doomee', 'Bilan Quotidien', 'Fioblo', 'Fimba', 'SeedGroup'];
  for (const n of noms) {
    const c = cartes.find((x) => {
      const h3 = els.find((e) => e.name === 'h3' && e.start > x.start && e.end <= x.end);
      return h3 && texte(propre.slice(h3.innerStart, h3.innerEnd)) === n;
    });
    if (!c) { pb.push(n + ' : carte absente'); continue; }
    if (c.hiddenSelf || c.hiddenAnc) pb.push(n + ' : masquée');
    const sub = els.filter((e) => e.start > c.start && e.end <= c.end && (e.attrs.lang === 'fr' || e.attrs.lang === 'en'));
    const frp = sub.filter((e) => e.attrs.lang === 'fr' && !/sr-only|nouvel onglet/.test(propre.slice(e.innerStart, e.innerEnd)));
    const enp = sub.filter((e) => e.attrs.lang === 'en');
    if (!frp.length || !enp.length) pb.push(n + ' : description FR ou EN manquante');
    const cc = contenuCarte(c);
    if (!/lang="fr"[^>]*>\s*brouillon à valider/.test(cc)) pb.push(n + ' : badge FR absent');
    if (!/lang="en"[^>]*>\s*draft to be validated/.test(cc)) pb.push(n + ' : badge EN absent');
    // au moins une description (hors badge, lien) en FR et en EN
    const descFr = frp.filter((e) => !/brouillon|Voir le site/.test(propre.slice(e.innerStart, e.innerEnd)));
    const descEn = enp.filter((e) => !/draft to be|Visit website|opens in a new tab/.test(propre.slice(e.innerStart, e.innerEnd)));
    if (!descFr.length || !descEn.length) pb.push(n + ' : texte de description absent');
  }
  const visibles = cartes.filter((c) => !c.hiddenSelf && !c.hiddenAnc);
  if (visibles.length !== 9) pb.push(`${visibles.length} cartes visibles (9 attendues)`);
  const liens = { KLOQin: 'https://kloqin.com', SeedScaleUp: 'https://www.seedscaleup.com' };
  for (const [n, url] of Object.entries(liens)) {
    const c = cartes.find((x) => /<h3[^>]*>\s*/.test(contenuCarte(x)) && texte(contenuCarte(x)).startsWith(n));
    const a = c && els.find((e) => e.name === 'a' && e.start > c.start && e.end <= c.end);
    if (!a || a.attrs.href !== url) pb.push(`${n} : lien ${url} attendu, trouvé ${a && a.attrs.href}`);
  }
  inf.push(`${visibles.length} cartes visibles`);
});

// ---------- CA-08 ----------
critere('CA-08', 'MotionFlow uniquement dans un élément hidden, aucun lien, règle CSS [hidden]', (pb, inf) => {
  const reMF = /motionflow/gi;
  const occ = [...propre.matchAll(reMF)];
  if (!occ.length) pb.push('MotionFlow absent du code');
  let dehors = 0;
  for (const o of occ) {
    const cache = els.some((e) => e.hiddenSelf && !VOIDS.has(e.name) && o.index >= e.innerStart && o.index < e.innerEnd);
    if (!cache) dehors++;
  }
  if (dehors) pb.push(`${dehors} occurrence(s) hors élément hidden dans index.html`);
  if (els.some((e) => (e.attrs.href || '').match(/motionflow/i))) pb.push('un href cible MotionFlow');
  for (const f of ['assets/style.css', 'assets/langue.js']) if (/motionflow/i.test(lire(f))) pb.push('MotionFlow dans ' + f);
  if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css)) pb.push('règle CSS [hidden]{display:none !important} absente');
  inf.push(`${occ.length} occurrence(s), toutes dans un élément hidden ; règle CSS présente`);
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
critere('CA-12', 'aucun chiffre ni mot interdit dans les cartes projets', (pb, inf) => {
  const mots = [/\bclients?\b/i, /\bleaders?\b/i, /\bmillions?\b/i, /%/, /chiffres? d['’]affaires/i, /\butilisateurs?\b/i, /\busers?\b/i, /\bcustomers?\b/i];
  for (const c of cartes) {
    const t = texte(contenuCarte(c));
    const nom = t.split(' ')[0];
    if (/\d/.test(t)) pb.push(`${nom} : chiffre dans « ${t.match(/.{0,15}\d.{0,15}/)[0]} »`);
    for (const r of mots) if (r.test(t)) pb.push(`${nom} : mot interdit ${r}`);
  }
  inf.push(`${cartes.length} cartes analysées (MotionFlow masquée incluse)`);
});

// ---------- rapport ----------
let ok = 0;
for (const r of resultats) {
  if (r.ok) ok++;
  console.log(`${r.id} ${r.ok ? 'OK' : 'KO'} — ${r.titre} — ${r.detail}`);
}
console.log(`\nTotal : ${ok}/${resultats.length} OK`);
process.exit(ok === resultats.length ? 0 : 1);
