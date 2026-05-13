/**
 * Jeton Admin API Shopify.
 * 1) Si SHOPIFY_ADMIN_ACCESS_TOKEN est défini → utilisé tel quel (ex. app « Développer des applications » / shpat).
 * 2) Sinon SHOPIFY_SHOP + SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET → client_credentials (apps Partners, installation gérée).
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

let ccCache = { token: null, expiresAtMs: 0 };

async function fetchClientCredentialsToken(shop, clientId, clientSecret) {
    const host = String(shop)
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
    if (!host.endsWith(".myshopify.com")) {
        throw new Error("SHOPIFY_SHOP doit être au format xxx.myshopify.com");
    }

    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
    });

    const url = `https://${host}/admin/oauth/access_token`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(`client_credentials → ${res.status}: ${JSON.stringify(data)}`);
        err.status = res.status;
        err.body = data;
        throw err;
    }

    const accessToken = data?.access_token;
    const expiresIn = Number(data?.expires_in) || 86399;
    if (!accessToken) {
        throw new Error(`client_credentials: pas d'access_token dans ${JSON.stringify(data)}`);
    }

    ccCache.token = accessToken;
    ccCache.expiresAtMs = Date.now() + Math.max(60, expiresIn) * 1000;
    return accessToken;
}

/**
 * Retourne un jeton utilisable pour X-Shopify-Access-Token (rafraîchit client_credentials si besoin).
 */
export async function getShopifyAdminAccessToken() {
    const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
    if (staticToken) {
        return staticToken;
    }

    const shop = process.env.SHOPIFY_SHOP?.trim();
    const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();

    if (!shop || !clientId || !clientSecret) {
        throw new Error(
            "Configurer soit SHOPIFY_ADMIN_ACCESS_TOKEN, soit SHOPIFY_SHOP + SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (client_credentials)."
        );
    }

    const now = Date.now();
    if (ccCache.token && ccCache.expiresAtMs - REFRESH_BUFFER_MS > now) {
        return ccCache.token;
    }

    return fetchClientCredentialsToken(shop, clientId, clientSecret);
}

/** Pour /health : quel mode sera utilisé (sans appeler le réseau). */
export function getShopifyTokenMode() {
    if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim()) return "static_admin_token";
    if (
        process.env.SHOPIFY_SHOP?.trim()
        && process.env.SHOPIFY_CLIENT_ID?.trim()
        && process.env.SHOPIFY_CLIENT_SECRET?.trim()
    ) {
        return "client_credentials";
    }
    return "none";
}
