# Emeria mini-backend

Service Node.js qui :

1. **Webhook Shopify** (`orders/paid` par défaut) : lit la commande, extrait le snapshot Éméria (`_emeria_snapshot` sur la ligne box ou recomposition depuis les propriétés), et enregistre le metafield commande **`emeria.snapshot`** (namespace `emeria`).
2. **Webhook Recharge** (optionnel) : associe `subscription_id` → `shopify_order_id` dans `data/mappings.json` si les deux IDs sont présents dans le corps.
3. **POST `/hooks/reconstruct`** : crée une **draft order** Shopify à partir du metafield `emeria.snapshot` de la commande source (reconstruction manuelle ou depuis automate).

## Prérequis

- Node 18+
- App Shopify custom avec token Admin : `read_orders`, `write_orders`, `write_draft_orders`, `read_customers` (selon usage).
- URL publique (HTTPS) pour les webhooks : Tunnel Cloudflare / ngrok / hébergeur.

## Installation

```bash
cd emeria-backend
cp .env.example .env
npm install
npm start
```

## Sous-dossier sur le domaine (ex. mutualisé)

Si l’app n’est pas à la racine du site, définis par ex.  
`PUBLIC_BASE_PATH=/Rushs/passionkanine/emeria-backend`  
L’URL de santé devient :  
`https://lecyclopeduweb.fr/Rushs/passionkanine/emeria-backend/health`  
et le webhook Shopify :  
`https://lecyclopeduweb.fr/Rushs/passionkanine/emeria-backend/webhooks/shopify/orders`

**Attention — hébergement mutualisé :** beaucoup de serveurs ne lancent **pas** Node.js (Express). Déposer les fichiers dans un dossier suffit rarement : il faut que l’hébergeur propose **Node** (sélecteur Node / Passenger / procédure dédiée). Sinon tu obtiens une liste de fichiers, du PHP, ou une erreur 502 — dans ce cas utilise un **PaaS** (Render, Railway, etc.) ou un **VPS**.

## Configuration Shopify

1. Créer un webhook **Order payment** (ou **Order creation**) pointant vers  
   `https://TON_DOMAINE…/webhooks/shopify/orders` (chemin complet avec `PUBLIC_BASE_PATH` si utilisé)  
   avec le même secret que `SHOPIFY_WEBHOOK_SECRET`.
2. Correspondance du **topic** : par défaut seul `orders/paid` est accepté ; adapte `ORDER_WEBHOOK_TOPICS` si tu utilises `orders/create`.

## Reconstruction manuelle

```http
POST /hooks/reconstruct
Content-Type: application/json
X-Emeria-Secret: <INTERNAL_RECONSTRUCT_SECRET>

{ "source_order_id": "5678901234" }
```

Ou avec subscription Recharge déjà mappée :

```json
{ "recharge_subscription_id": "12345678" }
```

## Thème

Le JS boutique (`recharge.js`) ajoute **`_emeria_snapshot`** sur la ligne box au moment du panier — le backend peut ainsi persister un JSON complet dans le metafield commande.

## Limites

- La vérification **Recharge** dépend de leur doc (secret / header) ; sans `RECHARGE_WEBHOOK_SECRET`, la route accepte tout (utile en dev uniquement).
- `AUTO_RECONSTRUCT_ON_RENEWAL` est désactivé par défaut : à activer seulement si le webhook Recharge fournit clairement la commande source.
