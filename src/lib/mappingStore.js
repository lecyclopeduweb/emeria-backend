import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "..", "data", "mappings.json");

function readStore() {
    try {
        const raw = fs.readFileSync(DATA_FILE, "utf8");
        return JSON.parse(raw);
    } catch {
        return { byRechargeSubscriptionId: {} };
    }
}

function writeStore(store) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function linkRechargeSubscriptionToOrder(subscriptionId, shopifyOrderId) {
    if (subscriptionId == null || shopifyOrderId == null) return;
    const store = readStore();
    store.byRechargeSubscriptionId[String(subscriptionId)] = {
        shopifyOrderId: String(shopifyOrderId),
        updatedAt: new Date().toISOString()
    };
    writeStore(store);
}

export function getOrderIdForRechargeSubscription(subscriptionId) {
    const store = readStore();
    const row = store.byRechargeSubscriptionId[String(subscriptionId)];
    return row?.shopifyOrderId ?? null;
}
