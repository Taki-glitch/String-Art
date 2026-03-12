# String-Art Web App

Application web Flask pour créer des plans de string art à partir d'une image.

## Fonctionnalités

- Upload d'image depuis l'interface web
- Paramètres configurables (nombre de clous, nombre de fils, taille)
- Aperçu du rendu string art
- Schéma avec clous numérotés
- Liste ordonnée des fils à tendre
- Export PDF (schéma + aperçu + ordre des fils + numéros de clous)
- Mode couleur (fils rouge / vert / bleu)

## Lancer en local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Puis ouvrir http://localhost:5000
