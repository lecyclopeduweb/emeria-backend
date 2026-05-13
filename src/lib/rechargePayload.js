/**
 * Recharge envoie des payloads selon la version d’API — on reste défensif.
 */

export function extractRechargeSubscriptionId(body) {
    const b = body || {};
    return (
        b.subscription?.id
        ?? b.subscription_id
        ?? b.id
        ?? b.subscription?.subscription_id
        ?? null
    );
}

export function extractShopifyOrderIdFromRecharge(body) {
    const b = body || {};
    const candidates = [
        b.shopify_order_id,
        b.order_id,
        b.external_order_id?.shopify_order_id,
        b.subscription?.shopify_order_id,
        b.subscription?.external_order_id?.shopify_order_id,
        b.order?.id,
        b.charge?.external_order_id?.shopify_order_id
    ];
    for (const c of candidates) {
        if (c != null && c !== "") return String(c);
    }
    return null;
}
