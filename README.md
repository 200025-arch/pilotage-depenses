# Pilotage Dépenses

Application web simple et élégante pour suivre vos revenus et vos dépenses, fixer des budgets et anticiper l'évolution de votre solde.

## Fonctionnalités

- **Tableau de bord** : solde actuel, revenus, dépenses, épargne du mois, graphique sur 6 mois, répartition par catégorie.
- **Opérations** : ajout rapide (touche `n`), recherche, filtres, opérations **mensuelles** (salaire, loyer, abonnements…) générées automatiquement.
- **Budgets** : plafond mensuel par catégorie, avec une alerte si vous dépensez plus vite que prévu.
- **Prévisions** : solde estimé sur 6 mois, tableau mois par mois et simulateur « Et si je dépensais moins ? ».
- **Réglages** : solde de départ, catégories personnalisables, thème clair/sombre, sauvegarde/restauration (JSON) et export Excel (CSV).

## Confidentialité

Aucun serveur, aucun compte : vos données restent **dans votre navigateur** (`localStorage`), sur votre appareil. Pensez à exporter une sauvegarde de temps en temps.

## Lancer en local

Ouvrez `index.html` dans votre navigateur, ou lancez un petit serveur :

```bash
python -m http.server 5173
```

puis ouvrez http://localhost:5173.

## Technologies

HTML, CSS et JavaScript, sans étape de compilation. Les graphiques utilisent [Chart.js](https://www.chartjs.org/).
