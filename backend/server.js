import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import WebSocket from "ws";

const serverStartedAt = new Date();

/* =========================
   ES MODULE FIX
========================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   ENV LOAD (FIXED)
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
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

console.log("Stripe key loaded:", !!process.env.STRIPE_SECRET_KEY);

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json());

app.use(
    cors({
        origin: true,
        methods: ["GET", "POST"],
        credentials: true
    })
);

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
   STRIPE ROUTE
========================= */

app.post("/create-checkout-session", async (req, res) => {
    try {
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

        // £4.99 delivery for orders under £70
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
            cancel_url: `${BASE_URL}/cancel`
        });

        res.json({ url: session.url });

    } catch (err) {
        console.error("STRIPE ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

/* =========================
   ADMIN API
========================= */

function requireAdmin(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    next();
}

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
    try {
        const sessions = await stripe.checkout.sessions.list({
            limit: 20,
            expand: ["data.line_items"]
        });

        const orders = sessions.data.map((session) => ({
            id: session.id,
            amount_total: session.amount_total,
            currency: session.currency,
            status: session.payment_status,
            customer_email: session.customer_details?.email || "No email",
            customer_name: session.customer_details?.name || "No name",
            phone: session.customer_details?.phone || "No phone",
            created: session.created,
            items: session.line_items?.data?.map((item) => ({
                name: item.description,
                quantity: item.quantity,
                amount: item.amount_total
            })) || []
        }));

        res.json({ success: true, orders });
    } catch (err) {
        console.error("Admin orders error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
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

    if (process.env.STRIPE_SECRET_KEY) {
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
   ADMIN VERIFY
========================= */

app.get("/api/admin/verify", requireAdmin, (req, res) => {
    res.json({
        success: true
    });
});

/* =========================
   ADMIN DASHBOARD API
========================= */

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
    const now = new Date();

    function getAgeSeconds(dateValue) {
        if (!dateValue) return null;

        const time = new Date(dateValue).getTime();

        if (Number.isNaN(time)) return null;

        return Math.floor((Date.now() - time) / 1000);
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

    const warnings = [];

    let stripeApiConnected = false;
    let stripeMessage = "Stripe not checked";
    let orders = [];

    if (!process.env.STRIPE_SECRET_KEY) {
        warnings.push("Stripe secret key is missing.");
        stripeMessage = "Stripe key missing";
    } else {
        try {
            const sessions = await stripe.checkout.sessions.list({
                limit: 20,
                expand: ["data.line_items"]
            });

            stripeApiConnected = true;
            stripeMessage = "Stripe API connected";

            orders = sessions.data.map((session) => ({
                id: session.id,
                amount_total: session.amount_total || 0,
                currency: session.currency || "gbp",
                status: session.payment_status || "unknown",
                customer_email: session.customer_details?.email || "No email",
                customer_name: session.customer_details?.name || "No name",
                phone: session.customer_details?.phone || "No phone",
                created: session.created,
                items: session.line_items?.data?.map((item) => ({
                    name: item.description,
                    quantity: item.quantity,
                    amount: item.amount_total
                })) || []
            }));
        } catch (err) {
            stripeApiConnected = false;
            stripeMessage = err.message;
            warnings.push("Stripe API is not responding correctly.");
        }
    }

    const paidOrders = orders.filter((order) => order.status === "paid");
    const unpaidOrders = orders.filter((order) => order.status !== "paid");

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

    const aisConnection = getAISState();

    const vesselData =
        typeof latestVesselData !== "undefined"
            ? latestVesselData
            : null;

    const vesselAgeSeconds = getAgeSeconds(
        vesselData?.receivedAt ||
        vesselData?.timestamp
    );

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
            todayPaidRevenue
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

        warnings
    });
});

/* =========================
   STATIC FRONTEND
========================= */

const frontendPath = path.join(__dirname, "frontend");
console.log("Frontend path:", frontendPath);

app.use(express.static(frontendPath));

const pages = ["shop", "product", "about", "contact", "index", "success", "cancel", "refund", "privacy", "terms", "track", "admin", "admin-dashboard", "admin-orders", "admin-products", "admin-status"];

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

// Keep track of the AISStream connection
let aisStreamSocket = null;
let latestVesselData = {
    latitude: 54.2798,
    longitude: -0.4044,
    timestamp: new Date().toISOString()
};

// Function to connect to AISStream WebSocket
function connectAISStream() {
    const AIS_API_KEY = process.env.AISSTREAM_API_KEY;
    
    if (!AIS_API_KEY) {
        console.error("AISStream credentials missing!");
        return;
    }
    
    const wsUrl = `wss://stream.aisstream.io/v0/stream`;
    
    const subscriptionMessage = {
        APIKey: AIS_API_KEY,
        BoundingBoxes: [[
            [-90, -180], // Bottom-left (lat, lon)
            [90, 180]    // Top-right (lat, lon)
        ]],
        FiltersShipMMSI: ["235059314"], // Filter for POTS OF PLENTY only
        MessageType: ["PositionReport"]
    };
    
    aisStreamSocket = new WebSocket(wsUrl);
    
    aisStreamSocket.on('open', function() {
        console.log('Connected to AISStream');
        aisStreamSocket.send(JSON.stringify(subscriptionMessage));
    });
    
    aisStreamSocket.on('message', function(data) {
        try {
            const aisMessage = JSON.parse(data);

            if (aisMessage.MessageType === "PositionReport") {
                const meta = aisMessage.MetaData;
                const position = aisMessage.Message.PositionReport;

                // Get the REAL AIS timestamp from the message
                // AIS messages have their own timestamp in MetaData
                let realTimestamp = new Date().toISOString(); // fallback

                if (meta.TimeUTC) {
                    realTimestamp = meta.TimeUTC;
                } else if (position.Timestamp) {
                    // Some AIS messages include a timestamp in the position report
                    realTimestamp = position.Timestamp;
                }

                // Log the actual message time for debugging
                console.log("AIS Message Time:", realTimestamp);
                console.log("Server received at:", new Date().toISOString());

                latestVesselData = {
                    latitude: position.Latitude,
                    longitude: position.Longitude,
                    timestamp: realTimestamp,  // Use the REAL AIS timestamp
                    sog: position.Sog,
                    cog: position.Cog,
                    heading: position.TrueHeading,
                    receivedAt: new Date().toISOString() // Track when server got it
                };

                console.log("Vessel position updated - Position timestamp:", latestVesselData.timestamp);
            }
        } catch (err) {
            console.error("Error parsing AIS message:", err);
        }
    });
    
    aisStreamSocket.on('error', function(error) {
        console.error('AISStream WebSocket error:', error);
        setTimeout(connectAISStream, 30000); // Reconnect after 30 seconds
    });
    
    aisStreamSocket.on('close', function() {
        console.log('AISStream connection closed, reconnecting...');
        setTimeout(connectAISStream, 5000); // Reconnect after 5 seconds
    });
}

// Endpoint to get latest vessel position
app.get("/api/vessel", async (req, res) => {
    try {
        // If we don't have a connection yet, start one
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
            timestamp: latestVesselData.timestamp,  // Real AIS time
            serverTime: new Date().toISOString(),   // When server sent it
            receivedAt: latestVesselData.receivedAt, // When server got the message
            sog: latestVesselData.sog,
            cog: latestVesselData.cog,
            heading: latestVesselData.heading
        });
        
    } catch(err) {
        console.error("AISStream error:", err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// Start AISStream connection when server starts
connectAISStream();

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});