# Emeria backend

API Node.js (Express) pour figer le snapshot Éméria sur les commandes Shopify et reconstruire des brouillons de commande à partir du metafield `emeria.snapshot`.

---

## Déploiement Render (production)

| Champ | Valeur |
|--------|--------|
| Type | **Web Service** |
| Nom | `emeria-backend` |
| Runtime | **Node** |
| Plan | **Free** (voir note ci‑dessous) |
| Dépôt | `lecyclopeduweb/emeria-backend` |
| Branche | `main` |
| URL publique | **https://emeria-backend.onrender.com** |
| Service ID | `srv-d823m23tqb8s73c7qpg0` |

**Plan gratuit :** l’instance peut **se mettre en veille** après une période sans trafic. Le **premier** appel après veille peut être lent (cold start). Pour des webhooks critiques en prod, un plan payé évite cette mise en veille.

**Root Directory :** laisse vide si `package.json` est à la **racine** du dépôt Git. Sinon indique le sous-dossier qui contient `package.json`.

**Build command :** `npm install`  
**Start command :** `npm start`

Sur `*.onrender.com`, **ne définis pas** `PUBLIC_BASE_PATH` (laisser vide). Les routes sont à la racine du domaine.

**Variables d’environnement** (à renseigner dans Render → *Environment*) : voir `.env.example`.  
**`PORT`** — ne pas forcer sur Render (injecté automatiquement).

### Jeton Admin API (recommandé — **client credentials**)

Pour les apps **Partners** avec **« Utiliser le flux d’installation hérité : false »**, Shopify attend un échange **serveur à serveur**, **sans** redirection navigateur vers `/admin/oauth/authorize`. Voir la doc officielle : [Client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant).

Sur Render, définis **uniquement** (sans `SHOPIFY_ADMIN_ACCESS_TOKEN` obligatoire) :

| Variable | Valeur |
|----------|--------|
| `SHOPIFY_SHOP` | `passion-kanine.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | ID client Partners |
| `SHOPIFY_CLIENT_SECRET` | Secret Partners |
| `SHOPIFY_WEBHOOK_SECRET` | En pratique le même **Secret** pour vérifier les webhooks HMAC |

Le code appelle automatiquement :

`POST https://{shop}/admin/oauth/access_token`  
avec `grant_type=client_credentials`, `client_id`, `client_secret` (corps `application/x-www-form-urlencoded`), **met en cache** le jeton et le **rafraîchit** avant expiration (~24 h, marge 5 min).

`GET /health` renvoie `shopify_token_mode` : `client_credentials` | `static_admin_token` | `none`.

**Optionnel — token statique** : si tu définis `SHOPIFY_ADMIN_ACCESS_TOKEN` (ex. `shpat_…` depuis **Développer des applications**), il est **prioritaire** et le client credentials n’est pas utilisé.

### OAuth navigateur (`/oauth/start`) — flux **hérité** uniquement

Réservé si tu actives **« Utiliser le flux d’installation hérité : true »** dans la version de l’app. Sinon, utilise **client credentials** ci-dessus.

### URLs à utiliser

| Usage | URL |
|--------|-----|
| Santé | https://emeria-backend.onrender.com/health |
| OAuth diagnostic (legacy) | https://emeria-backend.onrender.com/oauth/diagnostic |
| Webhook Shopify | https://emeria-backend.onrender.com/webhooks/shopify/orders |
| Webhook Recharge (optionnel) | https://emeria-backend.onrender.com/webhooks/recharge |
| Reconstruction manuelle | `POST` https://emeria-backend.onrender.com/hooks/reconstruct |

Après un changement de code : **Manual Deploy** dans Render ou push sur `main` si le déploiement automatique est activé.

---

## Ce que fait le service

1. **Webhook Shopify** (`orders/paid` par défaut, configurable avec `ORDER_WEBHOOK_TOPICS`) : lit la commande, extrait le snapshot Éméria (`_emeria_snapshot` sur la ligne box ou recomposition depuis les propriétés), puis enregistre le metafield commande **`emeria.snapshot`** (`namespace` `emeria`, type JSON).

2. **Webhook Recharge** (optionnel) : si le corps contient un `subscription_id` et un identifiant de commande Shopify reconnus, enregistre l’association dans `data/mappings.json` sur le disque du serveur.

3. **`POST /hooks/reconstruct`** : crée une **draft order** Shopify à partir du metafield `emeria.snapshot` de la commande source.

---

## Prérequis

- Node 18+
- App Shopify custom avec token Admin : au minimum `read_orders`, `write_orders`, `write_draft_orders`, et `read_customers` selon les besoins.

---

## Développement local

```bash
cd emeria-backend
cp .env.example .env
npm install
npm start
```

Par défaut le serveur écoute sur le port défini par `PORT` ou **8787**. Tester : http://localhost:8787/health

---

## Configuration Shopify

1. Dans l’app custom (ou les webhooks au niveau boutique selon ta méthode), créer un webhook vers  
   **https://emeria-backend.onrender.com/webhooks/shopify/orders**  
   avec le même secret que **`SHOPIFY_WEBHOOK_SECRET`** dans Render.

2. Format du webhook : JSON, topic **`orders/paid`** (ou **`orders/create`** si tu ajoutes ce topic dans `ORDER_WEBHOOK_TOPICS`).

---

## Sous-dossier sur un autre domaine (ex. mutualisé)

Si un jour tu exposes cette app derrière un chemin du type  
`https://mondomaine.fr/projet/emeria-backend/`, définis  

`PUBLIC_BASE_PATH=/projet/emeria-backend`  

Les URLs deviennent alors `…/emeria-backend/health`, etc. **Sur Render avec le domaine `emeria-backend.onrender.com`, ce n’est pas nécessaire.**

---

## Reconstruction manuelle

```http
POST https://emeria-backend.onrender.com/hooks/reconstruct
Content-Type: application/json
X-Emeria-Secret: <INTERNAL_RECONSTRUCT_SECRET>

{ "source_order_id": "5678901234" }
```

Si une subscription Recharge est déjà mappée localement :

```json
{ "recharge_subscription_id": "12345678" }
```

(`INTERNAL_RECONSTRUCT_SECRET` doit être défini dans Render pour que l’en-tête soit vérifié.)

---

## Thème Shopify (Passion Kanine)

Le JS boutique (`assets/js/recharge.js`) ajoute **`_emeria_snapshot`** sur la ligne box au moment du panier. Après passage en caisse, le webhook commande permet de persister ce contenu dans le metafield **`emeria.snapshot`**.

---

## Limites / sécurité

- **Recharge :** la vérification de signature dépend de ta configuration (`RECHARGE_WEBHOOK_SECRET`). Sans secret, la route est permissive (réservé au développement).

- **`AUTO_RECONSTRUCT_ON_RENEWAL` :** désactivé par défaut. À n’activer que si le webhook Recharge fournit clairement la commande source.

- Le fichier **`data/mappings.json`** sur une instance **sans disque persistant** (plan Render gratuit) peut être **perdu** au redémarrage. Pour une fidélité long terme des mappings, prévoir une base (Render Postgres, etc.) dans une évolution ultérieure.
