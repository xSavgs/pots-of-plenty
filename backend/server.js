import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import WebSocket from "ws";
import fs from "fs";

/* =========================
   ES MODULE FIX
========================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   ENV LOAD
========================= */

dotenv.config({
    path: path.join(__dirname, ".env")
});

/* =========================
   APP SETUP
========================= */

const BASE_URL =
    process.env.BASE_URL ||
    "https://potsofplenty.uk";

const app = express();
const serverStartedAt = new Date();

const adminDataPath = path.join(__dirname, "admin-data.json");

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

console.log("Stripe key loaded:", !!process.env.STRIPE_SECRET_KEY);

/* =========================
   ADMIN DATA HELPERS
========================= */

function getDefaultAdminData() {
    return {
        orderStatuses: {},
        messages: []
    };
}

function readAdminData() {
    try {
        if (!fs.existsSync(adminDataPath)) {
            const defaultData = getDefaultAdminData();
            fs.writeFileSync(adminDataPath, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }

        const raw = fs.readFileSync(adminDataPath, "utf8");
        const data = JSON.parse(raw);

        return {
            orderStatuses: data.orderStatuses || {},
            messages: data.messages || []
        };

    } catch (err) {
        console.error("Admin data read error:", err);
        return getDefaultAdminData();
    }
}

function writeAdminData(data) {
    try {
        fs.writeFileSync(adminDataPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Admin data write error:", err);
    }
}

function requireAdmin(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized"
        });
    }

    next();
}

function clampNumber(value, fallback, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return Math.min(Math.max(Math.floor(number), min), max);
}

function penceToPounds(amount) {
    return Number((Number(amount || 0) / 100).toFixed(2));
}

function getPaymentIntentId(session) {
    return typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || "";
}

function isPaidStripeOrder(order) {
    return (
        order.status === "paid" ||
        order.payment_status === "paid" ||
        order.paymentStatus === "paid" ||
        order.paid === true
    );
}

/* =========================
   GIVEAWAY SETTINGS
========================= */

const GIVEAWAY_NAME = "Premium Gold Hoodie Giveaway";
const GIVEAWAY_PRIZE = "Premium Gold Hoodie";
const GIVEAWAY_TARGET = clampNumber(
    process.env.GIVEAWAY_TARGET,
    100,
    1,
    100000
);
const GIVEAWAY_EXTRA_ORDERS = clampNumber(
    process.env.GIVEAWAY_EXTRA_ORDERS,
    0,
    0,
    100000
);
const GIVEAWAY_STRIPE_SESSION_LIMIT = clampNumber(
    process.env.GIVEAWAY_STRIPE_SESSION_LIMIT,
    10000,
    1,
    100000
);
const GIVEAWAY_CACHE_MS = clampNumber(
    process.env.GIVEAWAY_CACHE_SECONDS,
    60,
    5,
    3600
) * 1000;

let giveawayProgressCache = {
    expiresAt: 0,
    data: null
};

function isGiveawayEligibleSession(session, adminData) {
    const savedStatus = adminData.orderStatuses?.[session.id] || {};

    return (
        session.payment_status === "paid" &&
        savedStatus.fulfilment !== "refunded"
    );
}

async function getGiveawayProgress({ forceRefresh = false } = {}) {
    if (
        !forceRefresh &&
        giveawayProgressCache.data &&
        Date.now() < giveawayProgressCache.expiresAt
    ) {
        return giveawayProgressCache.data;
    }

    if (!stripe) {
        throw new Error("Stripe secret key is missing");
    }

    const adminData = readAdminData();
    const { sessions, hasMore } = await listStripeCheckoutSessions(
        GIVEAWAY_STRIPE_SESSION_LIMIT
    );

    const eligibleSessions = sessions.filter((session) => {
        return isGiveawayEligibleSession(session, adminData);
    });

    const stripePaidOrderCount = eligibleSessions.length;
    const count = stripePaidOrderCount + GIVEAWAY_EXTRA_ORDERS;
    const displayCount = Math.min(count, GIVEAWAY_TARGET);
    const remaining = Math.max(GIVEAWAY_TARGET - count, 0);
    const percentage = Math.min(
        Math.round((count / GIVEAWAY_TARGET) * 100),
        100
    );

    const data = {
        giveawayName: GIVEAWAY_NAME,
        prize: GIVEAWAY_PRIZE,
        count,
        displayCount,
        target: GIVEAWAY_TARGET,
        remaining,
        percentage,
        reached: count >= GIVEAWAY_TARGET,
        stripePaidOrderCount,
        manualExtraOrders: GIVEAWAY_EXTRA_ORDERS,
        stripeSessionLimit: GIVEAWAY_STRIPE_SESSION_LIMIT,
        stripeHasMoreAfterThisBatch: hasMore,
        cachedForSeconds: Math.floor(GIVEAWAY_CACHE_MS / 1000),
        updatedAt: new Date().toISOString(),
        message: count >= GIVEAWAY_TARGET
            ? "The giveaway target has been reached. Winner selection can now be handled from the admin side."
            : "Every paid website order is automatically entered into the Premium Gold Hoodie Giveaway."
    };

    giveawayProgressCache = {
        expiresAt: Date.now() + GIVEAWAY_CACHE_MS,
        data
    };

    return data;
}

/* =========================
   STRIPE HELPERS
========================= */

async function listStripeCheckoutSessions(maxSessions = 100) {
    if (!stripe) {
        throw new Error("Stripe secret key is missing");
    }

    const sessions = [];
    let startingAfter = null;
    let hasMore = false;

    while (sessions.length < maxSessions) {
        const pageLimit = Math.min(100, maxSessions - sessions.length);

        const params = {
            limit: pageLimit
        };

        if (startingAfter) {
            params.starting_after = startingAfter;
        }

        const page = await stripe.checkout.sessions.list(params);

        sessions.push(...page.data);
        hasMore = Boolean(page.has_more);

        if (!page.has_more || page.data.length === 0) {
            break;
        }

        startingAfter = page.data[page.data.length - 1].id;
    }

    return {
        sessions,
        hasMore
    };
}

async function hydrateStripeSession(session, adminData, options = {}) {
    const includeLineItems = options.includeLineItems !== false;
    const includeRaw = options.includeRaw === true;

    let items = [];

    if (includeLineItems) {
        try {
            const lineItems = await stripe.checkout.sessions.listLineItems(
                session.id,
                { limit: 50 }
            );

            items = lineItems.data.map((item) => ({
                name: item.description || "Item",
                quantity: item.quantity || 1,
                amount: item.amount_total || 0,
                amount_pounds: penceToPounds(item.amount_total)
            }));
        } catch (err) {
            console.error("Line item fetch error:", err.message);
        }
    }

    const savedStatus = adminData.orderStatuses[session.id] || {};
    const paymentIntent = getPaymentIntentId(session);

    const order = {
        id: session.id,
        amount_total: session.amount_total || 0,
        amount_total_pounds: penceToPounds(session.amount_total),
        currency: session.currency || "gbp",
        status: session.payment_status || "unknown",
        payment_status: session.payment_status || "unknown",
        checkout_status: session.status || "unknown",
        payment_intent: paymentIntent,
        customer_email:
            session.customer_details?.email ||
            session.customer_email ||
            "No email",
        customer_name: session.customer_details?.name || "No name",
        phone: session.customer_details?.phone || "No phone",
        created: session.created,
        created_iso: session.created
            ? new Date(session.created * 1000).toISOString()
            : null,
        metadata: session.metadata || {},
        items,
        admin: {
            fulfilment: savedStatus.fulfilment || "new",
            note: savedStatus.note || "",
            updatedAt: savedStatus.updatedAt || null
        }
    };

    if (includeRaw) {
        order.rawStripeSession = session;
    }

    return order;
}

async function getStripeOrderBundle(limit = 100, options = {}) {
    const adminData = readAdminData();
    const { sessions, hasMore } = await listStripeCheckoutSessions(limit);

    const orders = await Promise.all(
        sessions.map((session) => {
            return hydrateStripeSession(session, adminData, options);
        })
    );

    return {
        orders,
        hasMore,
        requestedLimit: limit,
        returned: orders.length
    };
}

async function getRecentStripeOrders(limit = 25) {
    const bundle = await getStripeOrderBundle(limit, {
        includeLineItems: true,
        includeRaw: false
    });

    return bundle.orders;
}

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json());

app.use(
    cors({
        origin: true,
        methods: ["GET", "POST", "DELETE"],
        credentials: true
    })
);

/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/admin/login", (req, res) => {
    const { username, password } = req.body;

    if (
        username === process.env.ADMIN_USERNAME &&
        password === process.env.ADMIN_PASSWORD
    ) {
        return res.json({
            success: true,
            token: process.env.ADMIN_TOKEN
        });
    }

    return res.status(401).json({
        success: false
    });
});

/* =========================
   STRIPE CHECKOUT ROUTE
========================= */

app.post("/create-checkout-session", async (req, res) => {
    try {
        if (!stripe) {
            return res.status(500).json({
                error: "Stripe secret key is missing"
            });
        }

        const { items } = req.body;

        console.log("BODY RECEIVED:", items);

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "Cart is empty or invalid" });
        }

        const cartTotal = items.reduce(
            (total, item) => total + Number(item.price),
            0
        );

        const line_items = items.map((item) => ({
            price_data: {
                currency: "gbp",
                product_data: {
                    name: item.size
                        ? `${item.name} (Size ${item.size})`
                        : item.name
                },
                unit_amount: Math.round(Number(item.price) * 100)
            },
            quantity: 1
        }));

        // £4.95 delivery for orders under £50
        if (cartTotal < 50) {
            line_items.push({
                price_data: {
                    currency: "gbp",
                    product_data: {
                        name: "Delivery"
                    },
                    unit_amount: 495
                },
                quantity: 1
            });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            billing_address_collection: "required",
            phone_number_collection: {
                enabled: true
            },
            shipping_address_collection: {
                allowed_countries: ["GB"]
            },
            customer_creation: "always",
            line_items,
            success_url: `${BASE_URL}/success`,
            cancel_url: `${BASE_URL}/cancel`,
            metadata: {
                giveaway: "premium_gold_hoodie_100_orders",
                giveaway_name: GIVEAWAY_NAME,
                giveaway_prize: GIVEAWAY_PRIZE,
                giveaway_target: String(GIVEAWAY_TARGET)
            }
        });

        res.json({ url: session.url });

    } catch (err) {
        console.error("STRIPE ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

/* =========================
   GIVEAWAY PUBLIC API
========================= */

app.get("/api/order-count", async (req, res) => {
    try {
        const progress = await getGiveawayProgress({
            forceRefresh: req.query.refresh === "1"
        });

        res.set("Cache-Control", "public, max-age=30");

        res.json({
            success: true,
            ...progress
        });

    } catch (err) {
        console.error("Giveaway count error:", err);

        res.status(500).json({
            success: false,
            error: "Giveaway count is temporarily unavailable"
        });
    }
});

/* =========================
   ADMIN API
========================= */

app.get("/api/admin/verify", requireAdmin, (req, res) => {
    res.json({
        success: true
    });
});

app.get("/api/admin/debug-ping", requireAdmin, (req, res) => {
    res.json({
        success: true,
        message: "Admin debug route is working",
        serverTime: new Date().toISOString()
    });
});

app.get("/api/admin/giveaway/eligible-orders", requireAdmin, async (req, res) => {
    try {
        const adminData = readAdminData();
        const { sessions, hasMore } = await listStripeCheckoutSessions(
            GIVEAWAY_STRIPE_SESSION_LIMIT
        );

        const eligibleOrders = sessions
            .filter((session) => isGiveawayEligibleSession(session, adminData))
            .map((session) => ({
                id: session.id,
                amount_total: session.amount_total || 0,
                amount_total_pounds: penceToPounds(session.amount_total),
                currency: session.currency || "gbp",
                customer_email:
                    session.customer_details?.email ||
                    session.customer_email ||
                    "No email",
                customer_name: session.customer_details?.name || "No name",
                phone: session.customer_details?.phone || "No phone",
                created: session.created,
                created_iso: session.created
                    ? new Date(session.created * 1000).toISOString()
                    : null,
                payment_status: session.payment_status,
                checkout_status: session.status,
                payment_intent: getPaymentIntentId(session),
                metadata: session.metadata || {}
            }));

        const progress = await getGiveawayProgress({ forceRefresh: true });

        res.json({
            success: true,
            progress,
            stripeHasMoreAfterThisBatch: hasMore,
            eligibleOrderCount: eligibleOrders.length,
            eligibleOrders
        });

    } catch (err) {
        console.error("Admin giveaway route failed:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get("/api/admin/order-debug", requireAdmin, async (req, res) => {
    try {
        console.log("DEBUG: /api/admin/order-debug hit");

        const limit = clampNumber(req.query.limit, 500, 1, 500);

        const bundle = await getStripeOrderBundle(limit, {
            includeLineItems: false,
            includeRaw: true
        });

        const paidOrders = bundle.orders.filter(isPaidStripeOrder);
        const unpaidOrders = bundle.orders.filter((order) => !isPaidStripeOrder(order));

        const paidRevenue = paidOrders.reduce((total, order) => {
            return total + Number(order.amount_total || 0);
        }, 0);

        const unpaidRevenue = unpaidOrders.reduce((total, order) => {
            return total + Number(order.amount_total || 0);
        }, 0);

        const abandonedOrOpenOrders = bundle.orders.filter((order) => {
            return order.checkout_status === "open" || order.status === "unpaid";
        });

        res.json({
            success: true,
            note: "Temporary protected debug route. Remove this after diagnosis or keep it behind the admin UI as Raw Orders.",
            requestedLimit: bundle.requestedLimit,
            returnedOrders: bundle.returned,
            stripeHasMoreAfterThisBatch: bundle.hasMore,
            summary: {
                totalReturned: bundle.orders.length,
                paidCount: paidOrders.length,
                unpaidCount: unpaidOrders.length,
                abandonedOrOpenCount: abandonedOrOpenOrders.length,
                paidRevenuePence: paidRevenue,
                paidRevenuePounds: penceToPounds(paidRevenue),
                unpaidRevenuePence: unpaidRevenue,
                unpaidRevenuePounds: penceToPounds(unpaidRevenue)
            },
            orders: bundle.orders.map((order) => ({
                id: order.id,
                checkout_status: order.checkout_status,
                payment_status: order.payment_status,
                status: order.status,
                amount_total: order.amount_total,
                amount_total_pounds: order.amount_total_pounds,
                currency: order.currency,
                payment_intent: order.payment_intent,
                customer_email: order.customer_email,
                customer_name: order.customer_name,
                phone: order.phone,
                created: order.created,
                created_iso: order.created_iso,
                metadata: order.metadata,
                admin: order.admin,
                rawStripeSession: order.rawStripeSession
            }))
        });

    } catch (err) {
        console.error("ORDER DEBUG ROUTE FAILED:", err);

        res.status(500).json({
            success: false,
            error: err.message,
            stack: process.env.NODE_ENV === "production" ? undefined : err.stack
        });
    }
});

app.get("/api/admin/raw-orders", requireAdmin, async (req, res) => {
    try {
        const limit = clampNumber(req.query.limit, 500, 1, 500);

        const bundle = await getStripeOrderBundle(limit, {
            includeLineItems: false,
            includeRaw: true
        });

        res.json({
            success: true,
            requestedLimit: bundle.requestedLimit,
            returnedOrders: bundle.returned,
            stripeHasMoreAfterThisBatch: bundle.hasMore,
            orders: bundle.orders
        });

    } catch (err) {
        console.error("Raw orders route failed:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
    try {
        const limit = clampNumber(req.query.limit, 100, 1, 500);

        const bundle = await getStripeOrderBundle(limit, {
            includeLineItems: true,
            includeRaw: false
        });

        res.json({
            success: true,
            requestedLimit: bundle.requestedLimit,
            returnedOrders: bundle.returned,
            stripeHasMoreAfterThisBatch: bundle.hasMore,
            orders: bundle.orders
        });

    } catch (err) {
        console.error("Admin orders error:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.post("/api/admin/orders/:orderId/status", requireAdmin, (req, res) => {
    const { orderId } = req.params;
    const { fulfilment, note } = req.body;

    const allowed = [
        "new",
        "packed",
        "ready",
        "collected",
        "issue",
        "refunded"
    ];

    if (!allowed.includes(fulfilment)) {
        return res.status(400).json({
            success: false,
            error: "Invalid fulfilment status"
        });
    }

    const adminData = readAdminData();

    adminData.orderStatuses[orderId] = {
        fulfilment,
        note: note || "",
        updatedAt: new Date().toISOString()
    };

    writeAdminData(adminData);

    res.json({
        success: true,
        order: adminData.orderStatuses[orderId]
    });
});

app.post("/api/contact", (req, res) => {
    try {
        const { name, email, phone, subject, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({
                success: false,
                error: "Name, email and message are required"
            });
        }

        const adminData = readAdminData();

        const newMessage = {
            id: `msg_${Date.now()}`,
            name: String(name).trim(),
            email: String(email).trim(),
            phone: phone ? String(phone).trim() : "",
            subject: subject ? String(subject).trim() : "Website enquiry",
            message: String(message).trim(),
            read: false,
            createdAt: new Date().toISOString()
        };

        adminData.messages.unshift(newMessage);

        writeAdminData(adminData);

        res.json({
            success: true
        });

    } catch (err) {
        console.error("Contact form error:", err);

        res.status(500).json({
            success: false,
            error: "Message could not be sent"
        });
    }
});

app.get("/api/admin/messages", requireAdmin, (req, res) => {
    const adminData = readAdminData();

    res.json({
        success: true,
        messages: adminData.messages || []
    });
});

app.post("/api/admin/messages/:messageId/read", requireAdmin, (req, res) => {
    const { messageId } = req.params;
    const { read } = req.body;

    const adminData = readAdminData();

    adminData.messages = adminData.messages.map((message) => {
        if (message.id === messageId) {
            return {
                ...message,
                read: Boolean(read)
            };
        }

        return message;
    });

    writeAdminData(adminData);

    res.json({
        success: true
    });
});

app.delete("/api/admin/messages/:messageId", requireAdmin, (req, res) => {
    const { messageId } = req.params;

    const adminData = readAdminData();

    adminData.messages = adminData.messages.filter((message) => {
        return message.id !== messageId;
    });

    writeAdminData(adminData);

    res.json({
        success: true
    });
});

app.get("/api/admin/products", requireAdmin, (req, res) => {
    res.json({
        success: true,
        products: [
            {
                id: "white-hoodie",
                name: "Hoodie — White",
                category: "hoodie",
                status: "live",
                image: "/assets/hoodie.jpg",
                publicUrl: "/product?id=white-hoodie",
                standard: 34.99,
                premium: 49.99,
                sizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
                note: "Standard and premium available"
            },
            {
                id: "black-hoodie",
                name: "Hoodie — Black",
                category: "hoodie",
                status: "live",
                image: "/assets/hoodie2.jpg",
                publicUrl: "/product?id=black-hoodie",
                standard: 34.99,
                premium: 49.99,
                sizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
                note: "Standard and premium available"
            },
            {
                id: "white-tshirt",
                name: "T-Shirt — White",
                category: "tshirt",
                status: "live",
                image: "/assets/tshirt.jpg",
                publicUrl: "/product?id=white-tshirt",
                price: 24.99,
                sizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
                note: "Single version"
            },
            {
                id: "black-tshirt",
                name: "T-Shirt — Black",
                category: "tshirt",
                status: "live",
                image: "/assets/tshirt2.jpg",
                publicUrl: "/product?id=black-tshirt",
                price: 24.99,
                sizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
                note: "Single version"
            }
        ]
    });
});

app.get("/api/admin/status", requireAdmin, async (req, res) => {
    const now = new Date();

    function getAgeSeconds(dateValue) {
        if (!dateValue) return null;

        const time = new Date(dateValue).getTime();

        if (Number.isNaN(time)) return null;

        return Math.floor((Date.now() - time) / 1000);
    }

    function getAISState() {
        if (!aisStreamSocket) {
            return {
                code: null,
                label: "Not connected"
            };
        }

        const states = {
            [WebSocket.CONNECTING]: "Connecting",
            [WebSocket.OPEN]: "Open",
            [WebSocket.CLOSING]: "Closing",
            [WebSocket.CLOSED]: "Closed"
        };

        return {
            code: aisStreamSocket.readyState,
            label: states[aisStreamSocket.readyState] || "Unknown"
        };
    }

    let stripeApiConnected = false;
    let stripeMessage = "Stripe not checked";

    if (stripe) {
        try {
            await stripe.checkout.sessions.list({
                limit: 1
            });

            stripeApiConnected = true;
            stripeMessage = "Stripe API connected";
        } catch (err) {
            stripeApiConnected = false;
            stripeMessage = err.message;
        }
    } else {
        stripeMessage = "Stripe key missing";
    }

    const aisState = getAISState();

    const vesselDataAgeSeconds = getAgeSeconds(
        latestVesselData?.receivedAt ||
        latestVesselData?.timestamp
    );

    const warnings = [];

    if (!process.env.STRIPE_SECRET_KEY) {
        warnings.push("Stripe secret key is missing.");
    }

    if (!stripeApiConnected) {
        warnings.push("Stripe API is not currently confirming successfully.");
    }

    if (!process.env.AISSTREAM_API_KEY) {
        warnings.push("AISStream API key is missing.");
    }

    if (aisState.label !== "Open") {
        warnings.push("AISStream WebSocket is not open.");
    }

    if (
        vesselDataAgeSeconds !== null &&
        vesselDataAgeSeconds > 3600
    ) {
        warnings.push("Latest vessel position is over 1 hour old.");
    }

    res.json({
        success: true,

        server: {
            status: "online",
            uptimeSeconds: Math.floor(process.uptime()),
            startedAt: serverStartedAt.toISOString(),
            checkedAt: now.toISOString(),
            nodeEnv: process.env.NODE_ENV || "not set"
        },

        environment: {
            baseUrl: BASE_URL,
            railwayPortLoaded: !!process.env.PORT
        },

        stripe: {
            keyLoaded: !!process.env.STRIPE_SECRET_KEY,
            apiConnected: stripeApiConnected,
            message: stripeMessage
        },

        ais: {
            keyLoaded: !!process.env.AISSTREAM_API_KEY,
            connection: aisState.label
        },

        vessel: {
            name: latestVesselData?.name || "POTS OF PLENTY",
            mmsi: latestVesselData?.mmsi || "235059314",
            callsign: latestVesselData?.callsign || "2AGB7",
            latitude: latestVesselData?.latitude || null,
            longitude: latestVesselData?.longitude || null,
            timestamp: latestVesselData?.timestamp || null,
            receivedAt: latestVesselData?.receivedAt || null,
            dataAgeSeconds: vesselDataAgeSeconds,
            sog: latestVesselData?.sog ?? null,
            cog: latestVesselData?.cog ?? null,
            heading: latestVesselData?.heading ?? null
        },

        warnings
    });
});

/* =========================
   ADMIN DASHBOARD API
========================= */

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
    try {
        const now = new Date();
        const adminData = readAdminData();

        let orders = [];
        let stripeHasMoreAfterThisBatch = false;
        let stripeApiConnected = false;
        let stripeMessage = "Stripe not checked";

        const warnings = [];

        if (!stripe) {
            warnings.push("Stripe secret key is missing.");
            stripeMessage = "Stripe key missing";
        } else {
            try {
                const bundle = await getStripeOrderBundle(500, {
                    includeLineItems: false,
                    includeRaw: false
                });

                orders = bundle.orders;
                stripeHasMoreAfterThisBatch = bundle.hasMore;
                stripeApiConnected = true;
                stripeMessage = "Stripe API connected";
            } catch (err) {
                stripeApiConnected = false;
                stripeMessage = err.message;
                warnings.push("Stripe API is not responding correctly.");
            }
        }

        function getAISState() {
            if (
                typeof aisStreamSocket === "undefined" ||
                !aisStreamSocket
            ) {
                return "Not connected";
            }

            const states = {
                [WebSocket.CONNECTING]: "Connecting",
                [WebSocket.OPEN]: "Open",
                [WebSocket.CLOSING]: "Closing",
                [WebSocket.CLOSED]: "Closed"
            };

            return states[aisStreamSocket.readyState] || "Unknown";
        }

        function getAgeSeconds(dateValue) {
            if (!dateValue) return null;

            const time = new Date(dateValue).getTime();

            if (Number.isNaN(time)) return null;

            return Math.floor((Date.now() - time) / 1000);
        }

        const paidOrders = orders.filter(isPaidStripeOrder);

        const unpaidOrders = orders.filter((order) => {
            return !isPaidStripeOrder(order);
        });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todayUnix = Math.floor(todayStart.getTime() / 1000);

        const paidOrdersToday = paidOrders.filter((order) => {
            return Number(order.created || 0) >= todayUnix;
        });

        const recentPaidRevenue = paidOrders.reduce((total, order) => {
            return total + Number(order.amount_total || 0);
        }, 0);

        const todayPaidRevenue = paidOrdersToday.reduce((total, order) => {
            return total + Number(order.amount_total || 0);
        }, 0);

        const vesselData =
            typeof latestVesselData !== "undefined"
                ? latestVesselData
                : null;

        const vesselAgeSeconds = getAgeSeconds(
            vesselData?.receivedAt ||
            vesselData?.timestamp
        );

        const aisConnection = getAISState();

        if (!process.env.AISSTREAM_API_KEY) {
            warnings.push("AISStream API key is missing.");
        }

        if (process.env.AISSTREAM_API_KEY && aisConnection !== "Open") {
            warnings.push("AISStream WebSocket is not currently open.");
        }

        if (
            vesselAgeSeconds !== null &&
            vesselAgeSeconds > 3600
        ) {
            warnings.push("Latest vessel position is over 1 hour old.");
        }

        if (!process.env.BASE_URL) {
            warnings.push("BASE_URL is not set in Railway variables.");
        }

        if (stripeHasMoreAfterThisBatch) {
            warnings.push("Stripe has more than 500 checkout sessions. Dashboard totals may still be partial.");
        }

        const unreadMessages = adminData.messages.filter((message) => {
            return !message.read;
        });

        const siteHealthy =
            stripeApiConnected &&
            !!process.env.STRIPE_SECRET_KEY &&
            !!process.env.BASE_URL &&
            warnings.length === 0;

        res.json({
            success: true,

            overview: {
                siteHealthy,
                totalRecentOrders: orders.length,
                paidRecentOrders: paidOrders.length,
                unpaidRecentOrders: unpaidOrders.length,
                paidOrdersToday: paidOrdersToday.length,
                recentPaidRevenue,
                recentPaidRevenuePounds: penceToPounds(recentPaidRevenue),
                todayPaidRevenue,
                todayPaidRevenuePounds: penceToPounds(todayPaidRevenue),
                unreadMessages: unreadMessages.length,
                totalMessages: adminData.messages.length,
                stripeHasMoreAfterThisBatch
            },

            server: {
                status: "online",
                uptimeSeconds: Math.floor(process.uptime()),
                startedAt: serverStartedAt.toISOString(),
                checkedAt: now.toISOString(),
                baseUrl: BASE_URL,
                nodeEnv: process.env.NODE_ENV || "not set"
            },

            stripe: {
                keyLoaded: !!process.env.STRIPE_SECRET_KEY,
                apiConnected: stripeApiConnected,
                message: stripeMessage
            },

            ais: {
                keyLoaded: !!process.env.AISSTREAM_API_KEY,
                connection: aisConnection
            },

            vessel: {
                name: vesselData?.name || "POTS OF PLENTY",
                mmsi: vesselData?.mmsi || "235059314",
                callsign: vesselData?.callsign || "2AGB7",
                latitude: vesselData?.latitude || null,
                longitude: vesselData?.longitude || null,
                timestamp: vesselData?.timestamp || null,
                receivedAt: vesselData?.receivedAt || null,
                dataAgeSeconds: vesselAgeSeconds,
                sog: vesselData?.sog ?? null,
                cog: vesselData?.cog ?? null,
                heading: vesselData?.heading ?? null
            },

            products: {
                total: 4,
                live: 4,
                hoodies: 2,
                tshirts: 2,
                standardHoodiePrice: 34.99,
                premiumHoodiePrice: 49.99,
                tshirtPrice: 24.99
            },

            recentOrders: orders.slice(0, 5),
            recentMessages: adminData.messages.slice(0, 5),
            warnings
        });

    } catch (err) {
        console.error("Admin dashboard error:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/* =========================
   STATIC FRONTEND
========================= */

const frontendPath = path.join(__dirname, "frontend");
console.log("Frontend path:", frontendPath);

app.use(express.static(frontendPath));

const pages = [
    "shop",
    "product",
    "about",
    "contact",
    "index",
    "success",
    "cancel",
    "refund",
    "privacy",
    "terms",
    "track",
    "admin",
    "admin-dashboard",
    "admin-orders",
    "admin-giveaway",
    "admin-products",
    "admin-status",
    "admin-messages",
    "admin-tools"
];

pages.forEach((page) => {
    app.get(`/${page}`, (req, res) => {
        res.sendFile(path.join(frontendPath, `${page}.html`));
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

/* =================== */
/* MARITIME DATA STUFF */
/* =================== */

let aisStreamSocket = null;
let latestVesselData = {
    latitude: 54.2798,
    longitude: -0.4044,
    timestamp: new Date().toISOString()
};

function connectAISStream() {
    const AIS_API_KEY = process.env.AISSTREAM_API_KEY;

    if (!AIS_API_KEY) {
        console.error("AISStream credentials missing!");
        return;
    }

    if (
        aisStreamSocket &&
        (
            aisStreamSocket.readyState === WebSocket.OPEN ||
            aisStreamSocket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    const wsUrl = "wss://stream.aisstream.io/v0/stream";

    const subscriptionMessage = {
        APIKey: AIS_API_KEY,
        BoundingBoxes: [
            [
                [-90, -180],
                [90, 180]
            ]
        ],
        FiltersShipMMSI: ["235059314"],
        MessageType: ["PositionReport"]
    };

    aisStreamSocket = new WebSocket(wsUrl);

    aisStreamSocket.on("open", function() {
        console.log("Connected to AISStream");
        aisStreamSocket.send(JSON.stringify(subscriptionMessage));
    });

    aisStreamSocket.on("message", function(data) {
        try {
            const aisMessage = JSON.parse(data);

            if (aisMessage.MessageType === "PositionReport") {
                const meta = aisMessage.MetaData || {};
                const position = aisMessage.Message?.PositionReport || {};

                let realTimestamp = new Date().toISOString();

                if (meta.TimeUTC) {
                    realTimestamp = meta.TimeUTC;
                } else if (position.Timestamp) {
                    realTimestamp = position.Timestamp;
                }

                console.log("AIS Message Time:", realTimestamp);
                console.log("Server received at:", new Date().toISOString());

                latestVesselData = {
                    latitude: position.Latitude,
                    longitude: position.Longitude,
                    timestamp: realTimestamp,
                    sog: position.Sog,
                    cog: position.Cog,
                    heading: position.TrueHeading,
                    receivedAt: new Date().toISOString()
                };

                console.log("Vessel position updated - Position timestamp:", latestVesselData.timestamp);
            }
        } catch (err) {
            console.error("Error parsing AIS message:", err);
        }
    });

    aisStreamSocket.on("error", function(error) {
        console.error("AISStream WebSocket error:", error);
        setTimeout(connectAISStream, 30000);
    });

    aisStreamSocket.on("close", function() {
        console.log("AISStream connection closed, reconnecting...");
        setTimeout(connectAISStream, 5000);
    });
}

app.get("/api/vessel", async (req, res) => {
    try {
        if (!aisStreamSocket || aisStreamSocket.readyState !== WebSocket.OPEN) {
            connectAISStream();

            return res.json({
                success: true,
                latitude: latestVesselData.latitude,
                longitude: latestVesselData.longitude,
                timestamp: latestVesselData.timestamp,
                serverTime: new Date().toISOString(),
                note: "Connecting to AISStream..."
            });
        }

        res.json({
            success: true,
            latitude: latestVesselData.latitude,
            longitude: latestVesselData.longitude,
            timestamp: latestVesselData.timestamp,
            serverTime: new Date().toISOString(),
            receivedAt: latestVesselData.receivedAt,
            sog: latestVesselData.sog,
            cog: latestVesselData.cog,
            heading: latestVesselData.heading
        });

    } catch (err) {
        console.error("AISStream error:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

connectAISStream();

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});