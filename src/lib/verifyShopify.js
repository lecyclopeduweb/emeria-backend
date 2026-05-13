import crypto from "crypto";

/**
 * Vérifie X-Shopify-Hmac-Sha256 (corps brut UTF-8).
 */
export function verifyShopifyWebhook(rawBodyBuffer, hmacHeader, secret) {
    if (!secret || !hmacHeader) return false;
    const digest = crypto.createHmac("sha256", secret).update(rawBodyBuffer).digest("base64");
    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(String(hmacHeader), "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}
