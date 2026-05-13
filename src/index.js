import "dotenv/config";
import express from "express";
import crypto from "crypto";
import { upsertOrderSnapshotMetafield } from "./lib/shopifyAdmin.js";
import { verifyShopifyWebhook } from "./lib/verifyShopify.js";
import {
    extractSnapshotFromOrder,
    normalizeSnapshotForStorage
} from "./lib/snapshot.js";
import {
    extractRechargeSubscriptionId,
    extractShopifyOrderIdFromRecharge
} from "./lib/rechargePayload.js";
import { linkRechargeSubscriptionToOrder, getOrderIdForRechargeSubscription } from "./lib/mappingStore.js";
import { reconstructDraftOrderFromSourceOrder } from "./lib/reconstructDraftOrder.js";
import { handleOAuthStart, handleOAuthCallback, handleOAuthDiagnostic } from "./lib/oauthInstall.js";
import { getShopifyAdminAccessToken, getShopifyTokenMode } from "./lib/shopifyAccessToken.js";

const {
    SHOPIFY_SHOP,
    SHOPIFY_WEBHOOK_SECRET,
    RECHARGE_WEBHOOK_SECRET,
    INTERNAL_RECONSTRUCT_SECRET,
    PORT = "8787",
    AUTO_RECONSTRUCT_ON_RENEWAL,
} = process.env;

/** Sous-chemin public si l’app est derrière https://domaine.fr/mon/projet/emeria-backend/ */
function normalizeBasePath(p) {
    if (p == null || String(p).trim() === "") return "";
    let s = String(p).trim();
    if (!s.startsWith("/")) s = `/${s}`;
    return s.replace(/\/+$/, "");
}

const PUBLIC_BASE_PATH = normalizeBasePath(process.env.PUBLIC_BASE_PATH);

const allowedOrderTopics = new Set(
    (process.env.ORDER_WEBHOOK_TOPICS || "orders/paid")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
);

const app = express();
const router = express.Router();

router.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "emeria-backend",
        basePath: PUBLIC_BASE_PATH || "/",
        shopify_token_mode: getShopifyTokenMode()
    });
});

/** Aide : compare redirect_uri avec Partners (JSON). */
router.get("/oauth/diagnostic", (req, res) => handleOAuthDiagnostic(req, res));

/** Une fois : obtient SHOPIFY_ADMIN_ACCESS_TOKEN via OAuth (app Partners déjà installée). Voir README. */
router.get("/oauth/start", (req, res) => handleOAuthStart(req, res));
router.get("/oauth/callback", (req, res) => {
    void handleOAuthCallback(req, res).catch((err) => {
        console.error("[emeria] oauth callback", err);
        if (!res.headersSent) {
            res.status(500).send(String(err?.message || err));
        }
    });
});

/**
 * Shopify — persiste emeria.snapshot sur la commande (depuis line items + _emeria_snapshot).
 */
router.post(
    "/webhooks/shopify/orders",
    express.raw({ type: "application/json" }),
    async (req, res) => {
        const hmac = req.get("X-Shopify-Hmac-Sha256");
        const topic = req.get("X-Shopify-Topic");

        if (!verifyShopifyWebhook(req.body, hmac, SHOPIFY_WEBHOOK_SECRET)) {
            res.status(401).send("Invalid HMAC");
            return;
        }

        if (!allowedOrderTopics.has(topic || "")) {
            res.status(200).send("Ignored topic");
            return;
        }

        let payload;
        try {
            payload = JSON.parse(req.body.toString("utf8"));
        } catch {
            res.status(400).send("Bad JSON");
            return;
        }

        const order = payload;
        if (!order?.id) {
            res.status(400).send("No order");
            return;
        }

        try {
            const token = await getShopifyAdminAccessToken();
            const extracted = extractSnapshotFromOrder(order);
            const stored = normalizeSnapshotForStorage(extracted, order);
            await upsertOrderSnapshotMetafield(
                SHOPIFY_SHOP,
                token,
                order.id,
                stored
            );
            res.status(200).json({ ok: true, order_id: order.id });
        } catch (err) {
            console.error("[emeria] snapshot order error", err);
            res.status(500).json({ error: String(err.message || err) });
        }
    }
);

function verifyRecharge(req) {
    if (!RECHARGE_WEBHOOK_SECRET) return true;
    const sig = req.get("X-Recharge-Hmac-Sha256") || req.get("X-Hmac-Sha256");
    const digest = crypto
        .createHmac("sha256", RECHARGE_WEBHOOK_SECRET)
        .update(req.body)
        .digest("hex");
    return sig === digest;
}

/**
 * Recharge — enregistre subscription_id → shopify_order_id ; optionnellement draft order.
 */
router.post("/webhooks/recharge", express.raw({ type: "*/*" }), async (req, res) => {
    if (!verifyRecharge(req)) {
        res.status(401).send("Invalid signature");
        return;
    }

    let body;
    try {
        body = JSON.parse(req.body.toString("utf8"));
    } catch {
        res.status(400).send("Bad JSON");
        return;
    }

    const subId = extractRechargeSubscriptionId(body);
    const shopifyOrderId = extractShopifyOrderIdFromRecharge(body);

    if (subId && shopifyOrderId) {
        linkRechargeSubscriptionToOrder(subId, shopifyOrderId);
    }

    const auto = AUTO_RECONSTRUCT_ON_RENEWAL === "1" || AUTO_RECONSTRUCT_ON_RENEWAL === "true";
    if (auto && subId) {
        const sourceOrderId = shopifyOrderId || getOrderIdForRechargeSubscription(subId);
        if (sourceOrderId) {
            try {
                const token = await getShopifyAdminAccessToken();
                await reconstructDraftOrderFromSourceOrder({
                    shop: SHOPIFY_SHOP,
                    token,
                    sourceOrderId,
                    note: `Auto reconstruction — subscription ${subId}`
                });
            } catch (err) {
                console.error("[emeria] auto reconstruct failed", err);
            }
        }
    }

    res.status(200).json({ ok: true, linked: !!(subId && shopifyOrderId) });
});

/**
 * Reconstruction manuelle : POST .../hooks/reconstruct
 */
router.post("/hooks/reconstruct", express.json(), async (req, res) => {
    const secret = req.get("X-Emeria-Secret");
    if (INTERNAL_RECONSTRUCT_SECRET && secret !== INTERNAL_RECONSTRUCT_SECRET) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const sourceOrderId =
        req.body?.source_order_id
        || req.body?.shopify_order_id
        || (req.body?.recharge_subscription_id
            ? getOrderIdForRechargeSubscription(req.body.recharge_subscription_id)
            : null);

    if (!sourceOrderId) {
        res.status(400).json({ error: "source_order_id ou recharge_subscription_id requis" });
        return;
    }

    try {
        const token = await getShopifyAdminAccessToken();
        const result = await reconstructDraftOrderFromSourceOrder({
            shop: SHOPIFY_SHOP,
            token,
            sourceOrderId,
            note: req.body?.note,
            tags: req.body?.tags
        });
        res.status(200).json({ ok: true, draft_order: result.draft_order });
    } catch (err) {
        console.error("[emeria] reconstruct", err);
        res.status(500).json({ error: String(err.message || err), detail: err.body });
    }
});

app.use(PUBLIC_BASE_PATH || "/", router);

app.listen(Number(PORT), () => {
    console.log(
        `emeria-backend listening on :${PORT}${PUBLIC_BASE_PATH ? ` (PUBLIC_BASE_PATH=${PUBLIC_BASE_PATH})` : ""}`
    );
});
