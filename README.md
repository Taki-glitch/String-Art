# String-Art Web App

Application web Flask pour créer directement un string art depuis une image uploadée, avec une interface utilisateur complète (sans passer par des commandes).

## Fonctionnalités

- Upload d'image depuis l'interface web
- Aperçu instantané de l'image source avant génération
- Paramètres configurables avec champs + préréglages rapides (Rapide / Équilibré / Détaillé / Couleur)
- Réglage de l'épaisseur de fil en plus des clous/fils/taille
- Génération directe du string art avec aperçu final
- Schéma avec clous numérotés
- Liste ordonnée des fils à tendre
- Export PDF complet (schéma + aperçu + ordre des fils)
- Téléchargement image PNG et instructions TXT
- Mode couleur (fils rouge / vert / bleu)

## Important : lien GitHub vs lien du site

Si vous cliquez sur le lien du dépôt GitHub, vous verrez le README (c'est normal).
L'application Flask a besoin d'un serveur Python pour fonctionner.

- Le fichier `index.html` à la racine sert de **page d'entrée GitHub Pages**.
- Pour ouvrir la vraie app, il faut un déploiement backend (ex: Render), puis renseigner l'URL publique dans `index.html` (`DEPLOYED_APP_URL`).

## Déployer en ligne (Render)

Le repo inclut déjà :
- `Procfile`
- `render.yaml`

Étapes rapides :
1. Créez un compte Render.
2. Importez ce repo GitHub comme nouveau service Web.
3. Render détecte `render.yaml` et démarre avec `gunicorn app:app`.
4. Copiez l'URL publique Render (ex: `https://string-art-web.onrender.com`).
5. Mettez cette URL dans `index.html` (constante `DEPLOYED_APP_URL`) pour que le lien GitHub Pages ouvre directement le site.

## Lancer en local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Puis ouvrir http://localhost:5000
