const stripe = Stripe("pk_live_51TZyqWBIpzBwfSxf63REdO08GRFlVnoNlnIBG2ZVyDo5eyov3wIToXCQKlzUUHroShELNeORnuaGPMOZDAQudj1N00qAQO2r5B");

console.log("script loaded");

document.addEventListener("DOMContentLoaded", () => {

    /* =========================
       STATE (IMAGE SLIDER FIX)
    ========================= */
    let currentImageIndex = 0;
    let currentImages = [];

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
            price: 49.99,
            images: ["/assets/hoodie.jpg", "/assets/hoodieback.jpg"]
        },
        "black-hoodie": {
            title: "Hoodie — Black",
            price: 49.99,
            images: ["/assets/hoodie2.jpg", "/assets/hoodie2back.jpg"]
        },
        "white-tshirt": {
            title: "T-Shirt — White",
            price: 24.99,
            images: ["/assets/tshirt.jpg", "/assets/tshirtback.jpg"]
        },
        "black-tshirt": {
            title: "T-Shirt — Black",
            price: 24.99,
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
       PRODUCT PAGE + IMAGE SLIDER FIX
    ========================= */

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

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

        /* =========================
           IMAGE SLIDER (FIXED)
        ========================= */

        currentImages = product.images;
        currentImageIndex = 0;

        if (img) img.src = currentImages[0];

        const nextBtn = document.getElementById("nextImg");
        const prevBtn = document.getElementById("prevImg");

        // SAFE RESET (prevents duplicate listeners)
        const newNext = nextBtn ? nextBtn.cloneNode(true) : null;
        const newPrev = prevBtn ? prevBtn.cloneNode(true) : null;

        if (nextBtn && newNext) nextBtn.replaceWith(newNext);
        if (prevBtn && newPrev) prevBtn.replaceWith(newPrev);

        const finalNext = document.getElementById("nextImg");
        const finalPrev = document.getElementById("prevImg");

        if (finalNext) {
            finalNext.addEventListener("click", () => {
                currentImageIndex = (currentImageIndex + 1) % currentImages.length;
                img.src = currentImages[currentImageIndex];
            });
        }

        if (finalPrev) {
            finalPrev.addEventListener("click", () => {
                currentImageIndex =
                    (currentImageIndex - 1 + currentImages.length) %
                    currentImages.length;

                img.src = currentImages[currentImageIndex];
            });
        }

        /* =========================
           ADD TO CART
        ========================= */

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
            };
        }
    }

    if (id) loadProduct(id);

    /* =========================
       PRODUCT CARDS
    ========================= */

    function setupProductClicks() {
        const cards = document.querySelectorAll(".product-card");

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
            const res = await fetch("create-checkout-session", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ items: cart })
            });

            const data = await res.json();

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