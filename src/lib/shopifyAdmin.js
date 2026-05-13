/**
 * Appels REST Admin API Shopify (fetch + token).
 * API: https://shopify.dev/docs/api/admin-rest
 */

const API_VERSION = "2024-10";

function adminUrl(shop, path) {
    const s = String(shop).replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${s}/admin/api/${API_VERSION}${path}`;
}

export async function shopifyRest(shop, token, path, { method = "GET", body } = {}) {
    const url = adminUrl(shop, path);
    const res = await fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token
        },
        body: body != null ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    let json = {};
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        json = { raw: text };
    }

    if (!res.ok) {
        const err = new Error(`Shopify ${method} ${path} → ${res.status}`);
        err.status = res.status;
        err.body = json;
        throw err;
    }

    return json;
}

export async function upsertOrderSnapshotMetafield(shop, token, orderId, jsonValue) {
    const value =
        typeof jsonValue === "string" ? jsonValue : JSON.stringify(jsonValue);

    const existing = await shopifyRest(shop, token, `/orders/${orderId}/metafields.json`);
    const list = existing.metafields || [];
    const hit = list.find((m) => m.namespace === "emeria" && m.key === "snapshot");

    if (hit?.id) {
        return shopifyRest(shop, token, `/metafields/${hit.id}.json`, {
            method: "PUT",
            body: {
                metafield: {
                    id: hit.id,
                    value,
                    type: "json"
                }
            }
        });
    }

    return shopifyRest(shop, token, `/orders/${orderId}/metafields.json`, {
        method: "POST",
        body: {
            metafield: {
                namespace: "emeria",
                key: "snapshot",
                type: "json",
                value
            }
        }
    });
}

export function getOrderMetafields(shop, token, orderId) {
    return shopifyRest(shop, token, `/orders/${orderId}/metafields.json`);
}

export function getOrder(shop, token, orderId) {
    return shopifyRest(shop, token, `/orders/${orderId}.json`);
}

export function createDraftOrder(shop, token, payload) {
    return shopifyRest(shop, token, `/draft_orders.json`, {
        method: "POST",
        body: { draft_order: payload }
    });
}
