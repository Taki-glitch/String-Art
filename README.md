# String-Art Web App (100% navigateur)

Application de string art utilisable directement depuis un site statique (GitHub Pages), sans backend Render.

## Ce que vous obtenez

- Upload d'image
- Réglages complets : clous, fils, taille, épaisseur, mode couleur
- Préréglages rapides (Rapide / Équilibré / Détaillé / Couleur)
- Génération dans le navigateur
- Aperçu final + schéma clous
- Liste des instructions
- Exports : PNG / TXT / PDF
- Bouton annuler pendant la génération

## Utilisation simple (sans serveur)

1. Ouvrez `index.html` (ou activez GitHub Pages sur le repo).
2. Chargez une image.
3. Ajustez les paramètres.
4. Cliquez sur **Générer**.
5. Exportez le résultat.

## Performance

La génération se fait entièrement dans le navigateur (CPU local).
Si votre machine est lente, réduisez :
- nombre de clous
- nombre de fils
- taille de rendu

Préréglage recommandé pour commencer : **Équilibré**.

## Option Flask locale (facultative)

Le backend Flask du repo existe encore pour un usage local, mais n'est plus nécessaire pour l'usage GitHub Pages.
