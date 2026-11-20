<img src="assets/icon.svg" width="64" height="64" alt="">

# Achats récurrents Amazon

App : https://mrthomaslef.github.io/achats-recurrents/ (lien avec clé d'accès envoyé à Marie par iMessage).

- `docs/` : PWA (liste des achats récurrents, coché = commandé automatiquement). Jeton et données **chiffrés** (AES-GCM).
- `scripts/runner.js morning|order` : automatisation quotidienne (launchd) — 8h message à Marie, 12h commande de la référence exacte.
- `scripts/login.js [--show]` : (re)connexion Amazon du compte de Marie.
- `scripts/build_items.py`, `analyze_recurring.py`, `families.py` : analyse de l'historique (`data/`, non versionné).
- État partagé : dépôt privé `Mrthomaslef/amazon-recurrent-state` (jeton limité à ce dépôt, trousseau `github-amazon-recurrent-state`).
