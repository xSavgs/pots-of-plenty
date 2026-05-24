const stripe = Stripe("pk_test_51TZyqWBIpzBwfSxfZzCGIp706IWgNweJWfmEszmJPORS92Pg6tXetWOvpLz3EXQQcJvrj3u8alEo7YOswEqETP87008indfBww");

console.log("script loaded");

document.addEventListener("DOMContentLoaded", () => {

    const menuBtn = document.getElementById("menuBtn");
    const cartBtn = document.getElementById("cartBtn");
    const searchBtn = document.getElementById("searchBtn");

    const searchInput = document.getElementById("searchInput");
    const searchSubmit = document.getElementById("searchSubmit");

    const menuOverlay = document.getElementById("menuOverlay");
    const closeMenu = document.getElementById("closeMenu");

    const sideMenu = document.getElementById("sideMenu");
    const cartPanel = document.getElementById("cartPanel");

    const cartItems = document.getElementById("cartItems");
    const cartTotal = document.getElementById("cartTotal");

    const closeCart = document.getElementById("closeCart");
    const checkoutBtn = document.getElementById("checkoutBtn");

    const searchBar = document.getElementById("searchBar");

    /* =========================
       PRODUCTS
    ========================= */

    const products = {
        "white-hoodie": {
            title: "Hoodie — White",
            price: 55,
            images: ["/assets/hoodie.jpg", "/assets/hoodieback.jpg"]
        },
        "black-hoodie": {
            title: "Hoodie — Black",
            price: 55,
            images: ["/assets/hoodie2.jpg", "/assets/hoodie2back.jpg"]
        },
        "white-tshirt": {
            title: "T-Shirt — White",
            price: 30,
            images: ["/assets/tshirt.jpg", "/assets/tshirtback.jpg"]
        },
        "black-tshirt": {
            title: "T-Shirt — Black",
            price: 30,
            images: ["/assets/tshirt2.jpg", "/assets/tshirt2back.jpg"]
        }
    };

    /* =========================
       CART
    ========================= */

    let cart = JSON.parse(localStorage.getItem("cart")) || [];

    function saveCart() {
        localStorage.setItem("cart", JSON.stringify(cart));
    }

    function updateCart() {
        if (!cartItems || !cartTotal) return;

        cartItems.innerHTML = "";

        let total = 0;

        if (cart.length === 0) {
            cartItems.innerHTML = `<div class="empty-cart">Your cart is empty.</div>`;
        }

        cart.forEach((item, index) => {
            total += item.price;

            const div = document.createElement("div");
            div.className = "cart-item";

            div.innerHTML = `
                <div class="cart-item-info">
                    <h4>${item.name} (${item.size || "M"})</h4>
                    <p>£${item.price.toFixed(2)}</p>
                </div>
                <button class="remove-item" data-index="${index}">✕</button>
            `;

            cartItems.appendChild(div);
        });

        cartTotal.textContent = `Total: £${total.toFixed(2)}`;

        document.querySelectorAll(".remove-item").forEach((btn) => {
            btn.onclick = () => {
                cart.splice(btn.dataset.index, 1);
                saveCart();
                updateCart();
            };
        });
    }

    updateCart();

    /* =========================
       PRODUCT PAGE
    ========================= */

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    console.log("URL product id:", id);

    function loadProduct(productId) {
        const product = products[productId];

        if (!product) {
            console.warn("Invalid product id:", productId);
            return;
        }

        const title = document.getElementById("productTitle");
        const price = document.getElementById("productPrice");
        const img = document.getElementById("productImage");
        const addBtn = document.getElementById("addToCartBtn");

        if (title) title.textContent = product.title;
        if (price) price.textContent = `£${product.price.toFixed(2)}`;
        if (img) img.src = product.images[0];

        if (addBtn) {
            addBtn.onclick = () => {

                const sizeEl = document.getElementById("size");
                const size = sizeEl ? sizeEl.value : "M";

                cart.push({
                    name: product.title,
                    price: product.price,
                    size: size
                });

                saveCart();
                updateCart();

                cartPanel?.classList.add("open");

                console.log("Added:", product.title, "Size:", size);
            };
        }
    }

    if (id) loadProduct(id);

    /* =========================
       PRODUCT CARDS
    ========================= */

    function setupProductClicks() {
        const cards = document.querySelectorAll(".product-card");

        console.log("Product cards found:", cards.length);

        cards.forEach((card) => {
            card.addEventListener("click", () => {
                const productId = card.dataset.product;

                if (!productId) return;

                window.location.href = `/product?id=${encodeURIComponent(productId)}`;
            });
        });
    }

    setupProductClicks();

    /* =========================
       MENU
    ========================= */

    menuBtn?.addEventListener("click", () => {
        sideMenu?.classList.add("open");
        menuOverlay?.classList.add("active");
    });

    closeMenu?.addEventListener("click", () => {
        sideMenu?.classList.remove("open");
        menuOverlay?.classList.remove("active");
    });

    menuOverlay?.addEventListener("click", () => {
        sideMenu?.classList.remove("open");
        menuOverlay?.classList.remove("active");
    });

    /* =========================
       CART
    ========================= */

    cartBtn?.addEventListener("click", () => {
        cartPanel?.classList.toggle("open");
    });

    closeCart?.addEventListener("click", () => {
        cartPanel?.classList.remove("open");
    });

    /* =========================
       SEARCH
    ========================= */

    searchBtn?.addEventListener("click", () => {
        searchBar?.classList.add("open");
        setTimeout(() => searchInput?.focus(), 100);
    });

    searchSubmit?.addEventListener("click", () => {
        searchBar?.classList.remove("open");
    });

    /* =========================
       CHECKOUT
    ========================= */

    checkoutBtn?.addEventListener("click", async () => {
        try {
            console.log("Sending cart:", cart);

            const res = await fetch("create-checkout-session", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ items: cart })
            });

            const data = await res.json();

            console.log("Stripe response:", data);

            if (data.url) {
                window.location.href = data.url;
            } else {
                console.error("No checkout URL returned", data);
            }

        } catch (err) {
            console.error("Checkout failed:", err);
        }
    });

});