import crypto from "crypto";

const stateStore = new Map();
const STATE_TTL_MS = 15 * 60 * 1000;

function pruneStates() {
    const now = Date.now();
    for (const [k, v] of stateStore) {
        if (v.exp < now) stateStore.delete(k);
    }
}

function normalizeShop(shop) {
    if (!shop || typeof shop !== "string") return null;
    let s = shop.trim().toLowerCase().replace(/^https?:\/\//, "");
    if (s.endsWith("/")) s = s.slice(0, -1);
    if (!s.endsWith(".myshopify.com")) return null;
    return s;
}

function redirectUriFromEnv() {
    const explicit = (process.env.OAUTH_REDIRECT_URI || "").trim();
    if (explicit) return explicit;

    const base = (process.env.OAUTH_PUBLIC_URL || "").replace(/\/+$/, "");
    const pathPrefix = (process.env.PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
    if (!base) return null;
    const path = `${pathPrefix}/oauth/callback`.replace(/\/{2,}/g, "/");
    return base + (path.startsWith("/") ? path : `/${path}`);
}

/**
 * Démarre OAuth : redirige vers Shopify (app Partners + installation).
 */
export function handleOAuthStart(req, res) {
    const installSecret = process.env.OAUTH_INSTALL_SECRET;
    if (installSecret && req.query.secret !== installSecret) {
        res.status(401).send("Missing or invalid ?secret= (OAUTH_INSTALL_SECRET)");
        return;
    }

    const shop = normalizeShop(req.query.shop || process.env.SHOPIFY_SHOP);
    const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
    const scopes = (process.env.OAUTH_SCOPES || "read_orders,write_orders,write_draft_orders,read_customers")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",");

    const redirectUri = redirectUriFromEnv();
    if (!shop || !clientId || !redirectUri) {
        res.status(500).send(
            "Configure SHOPIFY_SHOP (ou ?shop=), SHOPIFY_CLIENT_ID, OAUTH_PUBLIC_URL (ex. https://emeria-backend.onrender.com)"
        );
        return;
    }

    pruneStates();
    const state = crypto.randomBytes(16).toString("hex");
    stateStore.set(state, { shop, exp: Date.now() + STATE_TTL_MS });

    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("scope", scopes);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);

    res.redirect(url.toString());
}

/**
 * Callback OAuth : échange le code contre access_token et affiche la valeur à copier.
 */
export async function handleOAuthCallback(req, res) {
    const { code, shop, state } = req.query;
    const shopNorm = normalizeShop(String(shop || ""));
    const entry = state && stateStore.get(String(state));
    if (!entry || entry.shop !== shopNorm) {
        res.status(400).send("State invalide ou expiré — recommence depuis /oauth/start");
        return;
    }
    stateStore.delete(String(state));

    const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret || !code) {
        res.status(500).send("SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET ou code manquant");
        return;
    }

    const tokenUrl = `https://${shopNorm}/admin/oauth/access_token`;
    let data;
    try {
        const r = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code: String(code)
            })
        });
        data = await r.json().catch(() => ({}));
        if (!r.ok) {
            res.status(502).send(`Shopify token error: ${r.status} ${JSON.stringify(data)}`);
            return;
        }
    } catch (e) {
        res.status(502).send(String(e?.message || e));
        return;
    }

    const accessToken = data?.access_token;
    if (!accessToken) {
        res.status(502).send(`Pas d'access_token dans la réponse : ${JSON.stringify(data)}`);
        return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Token Emeria</title></head><body>
<h1>Jeton Admin API</h1>
<p>Copie la valeur ci-dessous dans <strong>SHOPIFY_ADMIN_ACCESS_TOKEN</strong> (fichier .env local et variables d'environnement Render), puis redéploie.</p>
<p><strong>Ne partage pas ce jeton.</strong> Ferme cette page après copie.</p>
<pre style="word-break:break-all;background:#f4f4f4;padding:1rem;">${escapeHtml(accessToken)}</pre>
<p>Scopes accordés : <code>${escapeHtml(data.scope || "")}</code></p>
</body></html>`);
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
