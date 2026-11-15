(function () {
  'use strict';
  var CLE = 'langue';
  var racine = document.documentElement;
  var titreFr = document.title;
  var titreEl = document.querySelector('title');
  var titreEn = titreEl ? titreEl.getAttribute('data-en') : null;
  var boutonFr = document.getElementById('bouton-fr');
  var boutonEn = document.getElementById('bouton-en');
  var annonce = document.getElementById('annonce-langue');

  function appliquer(langue, annoncer) {
    var autre = langue === 'fr' ? 'en' : 'fr';
    var aMontrer = document.body.querySelectorAll('[lang="' + langue + '"]');
    var aCacher = document.body.querySelectorAll('[lang="' + autre + '"]');
    var i;
    for (i = 0; i < aMontrer.length; i++) { aMontrer[i].hidden = false; }
    for (i = 0; i < aCacher.length; i++) { aCacher[i].hidden = true; }
    racine.lang = langue;
    if (boutonFr) { boutonFr.setAttribute('aria-pressed', langue === 'fr' ? 'true' : 'false'); }
    if (boutonEn) { boutonEn.setAttribute('aria-pressed', langue === 'en' ? 'true' : 'false'); }
    document.title = (langue === 'en' && titreEn) ? titreEn : titreFr;
    if (annonce && annoncer) {
      annonce.textContent = langue === 'en' ? 'Language: English' : 'Langue : Français';
    }
  }

  function choisir(langue) {
    appliquer(langue, true);
    try { localStorage.setItem(CLE, langue); } catch (e) { /* stockage indisponible */ }
  }

  var memorisee = null;
  try { memorisee = localStorage.getItem(CLE); } catch (e) { memorisee = null; }
  appliquer(memorisee === 'en' ? 'en' : 'fr', false);

  if (boutonFr) { boutonFr.addEventListener('click', function () { choisir('fr'); }); }
  if (boutonEn) { boutonEn.addEventListener('click', function () { choisir('en'); }); }
}());
