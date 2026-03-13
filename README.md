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

## Lancer en local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Puis ouvrir http://localhost:5000
