import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.join(__dirname, ".env")
});

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const BASE_URL =
    process.env.BASE_URL || "https://pots-of-plenty-production.up.railway.app";

app.use(express.json());

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST"]
    })
);

/* =========================
   STRIPE
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
                    name: item.size
                        ? `${item.name} (Size ${item.size})`
                        : item.name
                },
                unit_amount: Math.round(Number(item.price) * 100)
            },
            quantity: 1
        }));

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items,

            success_url: `${BASE_URL}/success.html`,
            cancel_url: `${BASE_URL}/cancel.html`
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error("STRIPE ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

/* =========================
   STATIC FILES
========================= */

const frontendPath = path.join(__dirname, "../frontend");

app.use(express.static(frontendPath));

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running");
});