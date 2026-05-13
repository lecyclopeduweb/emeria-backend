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

**Variables d’environnement** (à renseigner dans Render → *Environment*) : voir `.env.example`. Minimum pour les webhooks : `SHOPIFY_SHOP`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`.  
**`PORT`** — ne pas forcer sur Render (injecté automatiquement).

Sur `*.onrender.com`, **ne définis pas** `PUBLIC_BASE_PATH` (laisser vide). Les routes sont à la racine du domaine.

### Obtenir `SHOPIFY_ADMIN_ACCESS_TOKEN` (app **Partners** sans nouvelle app « développeur »)

Avec une app créée dans **Partners** + distribution personnalisée, Shopify **ne montre pas** un `shpat` à copier : le jeton Admin vient du **flux OAuth**. Ce dépôt inclut une **installation OAuth en une fois** :

1. Dans **Partners** → **emeria-backend** → **Versions** (version active) → ajoute une **URL de redirection** autorisée **exactement** :  
   **`https://emeria-backend.onrender.com/oauth/callback`**  
   (ou `OAUTH_REDIRECT_URI` si tu la définis à la main.)

2. Sur **Render**, définis au minimum :  
   - `SHOPIFY_SHOP` = `passion-kanine.myshopify.com`  
   - `SHOPIFY_CLIENT_ID` = **ID client** Partners  
   - `SHOPIFY_CLIENT_SECRET` = **Secret** Partners (nouveau)  
   - `OAUTH_PUBLIC_URL` = `https://emeria-backend.onrender.com`  
   - Optionnel : `OAUTH_INSTALL_SECRET` = un mot de passe long ; alors l’URL de départ doit inclure `?secret=...`

3. **Déploie** le service avec le code à jour (routes `/oauth/...`).

4. Dans le navigateur (connecté en admin sur la **même** boutique), ouvre :  
   `https://emeria-backend.onrender.com/oauth/start`  
   ou avec secret :  
   `https://emeria-backend.onrender.com/oauth/start?secret=TON_OAUTH_INSTALL_SECRET`  
   ou **debug texte** (sans redirection) :  
   `https://emeria-backend.onrender.com/oauth/start?debug=1`

5. Accepte les droits demandés. La page finale affiche le **jeton** → copie-le dans **`SHOPIFY_ADMIN_ACCESS_TOKEN`** (Render + `.env` local), **redéploie** Render.

### Si Shopify affiche « Oops… Unauthorized Access »

Ce message vient **de Shopify**, pas de Render. Causes fréquentes :

1. **`redirect_uri`** dans la version publiée Partners n’est **pas exactement** la même chaîne que celle calculée par le serveur (https, chemin `/oauth/callback`, pas d’espace, pas de slash en trop).  
   → Ouvre **`https://emeria-backend.onrender.com/oauth/diagnostic`** et compare **`redirect_uri_computed`** avec le champ **URL de redirection** de la version active de l’app.

2. Tu n’es **pas connecté** à l’admin de **cette** boutique dans le même navigateur (ou compte sans droits suffisants).  
   → Ouvre d’abord `https://admin.shopify.com/store/…` pour **Passion Kanine**, puis réessaie `/oauth/start`.

3. La boutique n’est **pas autorisée** par ta distribution personnalisée.  
   → Partners → **Distribution** / lien d’installation : vérifie que la boutique peut installer l’app.

4. **Client ID** sur Render ne correspond pas à l’app / à la version publiée (copier-coller depuis **Identifiants** de la même app).

Les scopes OAuth utilisés sont ceux de **`OAUTH_SCOPES`** (défaut : `read_orders,write_orders,write_draft_orders,read_customers`) ; ils doivent être **autorisés** dans la version publiée de l’app Partners.

### URLs à utiliser

| Usage | URL |
|--------|-----|
| Santé (test navigateur ou curl) | https://emeria-backend.onrender.com/health |
| **OAuth (une fois)** | https://emeria-backend.onrender.com/oauth/start |
| **OAuth diagnostic** | https://emeria-backend.onrender.com/oauth/diagnostic |
| Webhook Shopify (Admin API / app custom) | https://emeria-backend.onrender.com/webhooks/shopify/orders |
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
