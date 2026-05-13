import { shopifyRest } from "./shopifyAdmin.js";

/**
 * Lit metafield json emeria.snapshot sur la commande source et crée un brouillon.
 * Stratégie par défaut : lignes sans selling_plan (one-shot) ;
 * si une ligne a selling_plan_id dans le snapshot, on l’ajoute (ex. box).
 */

export async function reconstructDraftOrderFromSourceOrder({
    shop,
    token,
    sourceOrderId,
    note,
    tags
}) {
    const { order } = await shopifyRest(shop, token, `/orders/${sourceOrderId}.json`);
    if (!order) throw new Error("Order introuvable");

    const mfRes = await shopifyRest(shop, token, `/orders/${sourceOrderId}/metafields.json`);
    const metafields = mfRes.metafields || [];
    const snap = metafields.find((m) => m.namespace === "emeria" && m.key === "snapshot");

    let snapshot = null;
    if (snap?.value) {
        try {
            snapshot = JSON.parse(snap.value);
        } catch {
            snapshot = null;
        }
    }

    if (!snapshot?.lines?.length) {
        throw new Error(
            "Metafield emeria.snapshot absent ou sans lines — enregistre d’abord via webhook orders/paid"
        );
    }

    const customerId = order.customer?.id;
    const line_items = snapshot.lines.map((line) => {
        const item = {
            variant_id: Number(line.variant_id),
            quantity: Math.max(1, Number(line.quantity) || 1)
        };
        const sp = line.selling_plan_id ?? line.selling_plan_id;
        if (sp != null && Number.isFinite(Number(sp))) {
            item.selling_plan = Number(sp);
        }
        return item;
    });

    const draft_order = {
        line_items,
        note: note || `Éméria — reconstruction depuis commande #${order.order_number ?? sourceOrderId}`,
        tags: tags || "emeria-reconstruction",
        email: order.email
    };

    if (customerId) {
        draft_order.customer = { id: customerId };
    }

    return shopifyRest(shop, token, `/draft_orders.json`, {
        method: "POST",
        body: { draft_order }
    });
}
