/**
 * Extrait un snapshot Éméria depuis une commande Shopify (payload webhook orders/*).
 */

function propsArray(lineItem) {
    const p = lineItem?.properties;
    if (!Array.isArray(p)) return {};
    return Object.fromEntries(
        p.filter((x) => x?.name != null).map((x) => [String(x.name), x.value != null ? String(x.value) : ""])
    );
}

function parseJsonSafe(s) {
    if (s == null || s === "") return null;
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

/**
 * Priorité : property _emeria_snapshot sur une ligne ; sinon reconstruction depuis les lignes + _emeria_*.
 */
export function extractSnapshotFromOrder(order) {
    const lines = Array.isArray(order?.line_items) ? order.line_items : [];
    let fromProp = null;

    for (const li of lines) {
        const flat = propsArray(li);
        if (flat._emeria_snapshot) {
            const parsed = parseJsonSafe(flat._emeria_snapshot);
            if (parsed && typeof parsed === "object") {
                fromProp = parsed;
                break;
            }
        }
    }

    if (fromProp) {
        return {
            ...fromProp,
            source_shopify_order_id: order.id,
            source: "line_item_property"
        };
    }

    const reconstructed = { version: 1, lines: [], subscription: {} };
    for (const li of lines) {
        const flat = propsArray(li);
        const role = flat._emeria_role || "item";
        const vid = li.variant_id;
        const qty = li.quantity || 1;
        if (!vid) continue;

        const entry = {
            variant_id: Number(vid),
            quantity: Number(qty) || 1,
            role,
            selling_plan_id: li.selling_plan_id != null ? Number(li.selling_plan_id) : null
        };
        if (role === "box" && flat._emeria_frequency != null) {
            reconstructed.subscription.frequency = flat._emeria_frequency;
            reconstructed.subscription.commitment = flat._emeria_commitment;
            reconstructed.subscription.discount = flat._emeria_discount;
        }
        reconstructed.lines.push(entry);
    }

    reconstructed.source = "reconstructed_from_properties";
    reconstructed.source_shopify_order_id = order.id;
    return reconstructed;
}

export function normalizeSnapshotForStorage(snapshot, order) {
    return {
        ...snapshot,
        captured_at: new Date().toISOString(),
        financial_status: order?.financial_status,
        order_name: order?.name
    };
}
