# site-personnel

Site personnel (portfolio) de Yan FIMBA : une seule page statique, en français et en anglais, sans dépendance ni étape de construction.

## Modifier le site

- `index.html` : le contenu ; `assets/style.css` : le style ; `assets/langue.js` : la bascule FR/EN.
- Les coordonnées de contact et les descriptions de projets marquées « à compléter » sont à remplacer par le propriétaire.
- Un projet est présent dans `index.html` mais masqué (attribut `hidden`) en attendant l'accord de son porteur.

## Règle des paires FR/EN

Chaque texte visible s'écrit deux fois, au même endroit : `<span lang="fr">…</span><span lang="en" hidden>…</span>`. Une phrase sans sa paire est une anomalie. Aucun style ni script en ligne, aucune ressource externe.
