import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

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

        const line_items = items.map((item) => ({
            price_data: {
                currency: "gbp",
                product_data: {
                    name: item.size ? `${item.name} (Size ${item.size})` : item.name
                },
                unit_amount: Math.round(Number(item.price) * 100)
            },
            quantity: 1
        }));

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
   STATIC FRONTEND
========================= */

const frontendPath = path.join(__dirname, "frontend");
console.log("Frontend path:", frontendPath);

app.use(express.static(frontendPath));

const pages = ["shop", "product", "about", "contact", "index", "success", "cancel", "refund", "privacy", "terms"];

pages.forEach((page) => {
    app.get(`/${page}`, (req, res) => {
        res.sendFile(path.join(frontendPath, `${page}.html`));
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});