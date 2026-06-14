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

const serverStartedAt = new Date();

const adminDataPath = path.join(__dirname, "admin-data.json");

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

async function getRecentStripeOrders(limit = 25) {
    const adminData = readAdminData();

    const sessions = await stripe.checkout.sessions.list({
        limit
    });

    const orders = await Promise.all(
        sessions.data.map(async (session) => {
            let items = [];

            try {
                const lineItems = await stripe.checkout.sessions.listLineItems(
                    session.id,
                    { limit: 50 }
                );

                items = lineItems.data.map((item) => ({
                    name: item.description || "Item",
                    quantity: item.quantity || 1,
                    amount: item.amount_total || 0
                }));
            } catch (err) {
                console.error("Line item fetch error:", err.message);
            }

            const savedStatus =
                adminData.orderStatuses[session.id] || {};

            const paymentIntent =
                typeof session.payment_intent === "string"
                    ? session.payment_intent
                    : session.payment_intent?.id || "";

            return {
                id: session.id,
                amount_total: session.amount_total || 0,
                currency: session.currency || "gbp",
                status: session.payment_status || "unknown",
                payment_intent: paymentIntent,
                customer_email: session.customer_details?.email || "No email",
                customer_name: session.customer_details?.name || "No name",
                phone: session.customer_details?.phone || "No phone",
                created: session.created,
                items,
                admin: {
                    fulfilment: savedStatus.fulfilment || "new",
                    note: savedStatus.note || "",
                    updatedAt: savedStatus.updatedAt || null
                }
            };
        })
    );

    return orders;
}

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

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
    try {
        const orders = await getRecentStripeOrders(30);

        res.json({
            success: true,
            orders
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

app.get("/api/admin/verify", requireAdmin, (req, res) => {
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
    try {
        const now = new Date();
        const adminData = readAdminData();

        let orders = [];
        let stripeApiConnected = false;
        let stripeMessage = "Stripe not checked";

        const warnings = [];

        if (!process.env.STRIPE_SECRET_KEY) {
            warnings.push("Stripe secret key is missing.");
            stripeMessage = "Stripe key missing";
        } else {
            try {
                orders = await getRecentStripeOrders(12);
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

        const paidOrders = orders.filter((order) => {
            return order.status === "paid";
        });

        const unpaidOrders = orders.filter((order) => {
            return order.status !== "paid";
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
                todayPaidRevenue,
                unreadMessages: unreadMessages.length,
                totalMessages: adminData.messages.length
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

const pages = ["shop", 
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
               "admin-products", 
               "admin-status",
               "admin-messages"
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