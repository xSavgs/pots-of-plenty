const stripe = Stripe("pk_live_51TZyqWBIpzBwfSxf63REdO08GRFlVnoNlnIBG2ZVyDo5eyov3wIToXCQKlzUUHroShELNeORnuaGPMOZDAQudj1N00qAQO2r5B");

console.log("script loaded");

document.addEventListener("DOMContentLoaded", () => {

    /* =========================
       STATE
    ========================= */

    let currentImageIndex = 0;
    let currentImages = [];

    const DELIVERY_THRESHOLD = 50;
    const DELIVERY_CHARGE = 4.95;

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
       SCROLLING TOP BAR
    ========================= */

    function setupTopBarTicker() {
        const topBars = document.querySelectorAll(".top-bar");

        topBars.forEach((topBar) => {
            if (topBar.querySelector(".top-bar-track")) return;

            const originalText = topBar.textContent.trim();

            if (!originalText) return;

            topBar.setAttribute("aria-label", originalText);
            topBar.textContent = "";

            const track = document.createElement("div");
            track.className = "top-bar-track";
            track.setAttribute("aria-hidden", "true");

            for (let i = 0; i < 4; i++) {
                const span = document.createElement("span");
                span.className = "top-bar-message";
                span.textContent = originalText;
                track.appendChild(span);
            }

            topBar.appendChild(track);
        });
    }

    setupTopBarTicker();

    /* =========================
       PRODUCTS
    ========================= */

    const products = {
        "white-hoodie": {
            title: "Hoodie — White",
            price: 34.99,
            images: ["/assets/hoodie.jpg", "/assets/hoodieback.jpg"]
        },
        "black-hoodie": {
            title: "Hoodie — Black",
            price: 34.99,
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

    function getCartSubtotal() {
        return cart.reduce((total, item) => {
            return total + Number(item.price || 0);
        }, 0);
    }

    function getDeliveryCharge(subtotal) {
        if (subtotal > 0 && subtotal < DELIVERY_THRESHOLD) {
            return DELIVERY_CHARGE;
        }

        return 0;
    }

    function updateCartBadge() {
        if (!cartBtn) return;

        let badge = document.getElementById("cartCountBadge");

        if (!badge) {
            badge = document.createElement("span");
            badge.id = "cartCountBadge";
            badge.className = "cart-count-badge";
            cartBtn.appendChild(badge);
        }

        badge.textContent = cart.length;
        badge.style.display = cart.length > 0 ? "flex" : "none";
    }

    function updateCart() {
        if (!cartItems || !cartTotal) return;

        cartItems.innerHTML = "";

        if (cart.length === 0) {
            cartItems.innerHTML = `
                <div class="empty-cart">
                    Your cart is empty.
                </div>
            `;

            cartTotal.innerHTML = `
                <div class="cart-line">
                    <span>Total</span>
                    <strong>£0.00</strong>
                </div>
            `;

            if (checkoutBtn) {
                checkoutBtn.disabled = true;
            }

            updateCartBadge();
            return;
        }

        cart.forEach((item, index) => {
            const itemLabel = item.size
                ? `${item.name} — Size ${item.size}`
                : item.name;

            const div = document.createElement("div");
            div.className = "cart-item";

            div.innerHTML = `
                <div class="cart-item-info">
                    <h4>${itemLabel}</h4>
                    <p>£${Number(item.price || 0).toFixed(2)}</p>
                </div>

                <button class="remove-item" data-index="${index}">
                    ✕
                </button>
            `;

            cartItems.appendChild(div);
        });

        const subtotal = getCartSubtotal();
        const delivery = getDeliveryCharge(subtotal);
        const total = subtotal + delivery;

        cartTotal.innerHTML = `
            <div class="cart-line">
                <span>Subtotal</span>
                <strong>£${subtotal.toFixed(2)}</strong>
            </div>

            <div class="cart-line">
                <span>Delivery / handling</span>
                <strong>${delivery > 0 ? `£${delivery.toFixed(2)}` : "Free"}</strong>
            </div>

            <div class="cart-line">
                <span>Total</span>
                <strong>£${total.toFixed(2)}</strong>
            </div>

            <div class="cart-collection-note">
                Collection from Scarborough Harbour. Orders may take up to 2 weeks.
            </div>

            ${
                delivery > 0
                    ? `<div class="cart-delivery-note">Spend £${DELIVERY_THRESHOLD.toFixed(2)} or more to remove the extra charge.</div>`
                    : `<div class="cart-delivery-note">No delivery / handling charge added.</div>`
            }
        `;

        if (checkoutBtn) {
            checkoutBtn.disabled = false;
        }

        document.querySelectorAll(".remove-item").forEach((btn) => {
            btn.onclick = () => {
                cart.splice(Number(btn.dataset.index), 1);
                saveCart();
                updateCart();
            };
        });

        updateCartBadge();
    }

    updateCart();

    /* =========================
       PRODUCT PAGE + IMAGE SLIDER
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

        const hoodieOptions = document.getElementById("hoodieOptions");
        const versionSelect = document.getElementById("version");
        const hoodieDescription = document.getElementById("hoodieDescription");

        const isHoodie =
            productId === "white-hoodie" ||
            productId === "black-hoodie";

        if (title) {
            title.textContent = product.title;
        }

        let selectedPrice = product.price;

        if (price) {
            price.textContent = `£${selectedPrice.toFixed(2)}`;
        }

        if (hoodieOptions) {
            if (isHoodie) {
                hoodieOptions.style.display = "block";

                if (versionSelect) {
                    versionSelect.value = "standard";
                }

                selectedPrice = 34.99;

                if (price) {
                    price.textContent = "£34.99";
                }

                if (hoodieDescription) {
                    hoodieDescription.textContent =
                        "Durable everyday hoodie with a comfortable regular-weight fabric.";
                }

                versionSelect?.addEventListener("change", () => {
                    if (versionSelect.value === "premium") {
                        selectedPrice = 49.99;

                        if (price) {
                            price.textContent = "£49.99";
                        }

                        if (hoodieDescription) {
                            hoodieDescription.textContent =
                                "Premium heavyweight hoodie made from a softer fabric blend for greater comfort and warmth.";
                        }
                    } else {
                        selectedPrice = 34.99;

                        if (price) {
                            price.textContent = "£34.99";
                        }

                        if (hoodieDescription) {
                            hoodieDescription.textContent =
                                "Durable everyday hoodie with a comfortable regular-weight fabric.";
                        }
                    }
                });
            } else {
                hoodieOptions.style.display = "none";
            }
        }

        /* =========================
           IMAGE SLIDER
        ========================= */

        currentImages = product.images;
        currentImageIndex = 0;

        if (img) {
            img.src = currentImages[0];
        }

        const nextBtn = document.getElementById("nextImg");
        const prevBtn = document.getElementById("prevImg");

        const newNext = nextBtn ? nextBtn.cloneNode(true) : null;
        const newPrev = prevBtn ? prevBtn.cloneNode(true) : null;

        if (nextBtn && newNext) {
            nextBtn.replaceWith(newNext);
        }

        if (prevBtn && newPrev) {
            prevBtn.replaceWith(newPrev);
        }

        const finalNext = document.getElementById("nextImg");
        const finalPrev = document.getElementById("prevImg");

        if (finalNext && img) {
            finalNext.addEventListener("click", () => {
                currentImageIndex =
                    (currentImageIndex + 1) %
                    currentImages.length;

                img.src = currentImages[currentImageIndex];
            });
        }

        if (finalPrev && img) {
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

                let finalPrice = product.price;
                let version = "";

                if (isHoodie) {
                    version =
                        document.getElementById("version")?.value ||
                        "standard";

                    finalPrice =
                        version === "premium"
                            ? 49.99
                            : 34.99;
                }

                cart.push({
                    name: isHoodie
                        ? `${product.title} (${version === "premium" ? "Premium" : "Standard"})`
                        : product.title,
                    price: finalPrice,
                    size: size
                });

                saveCart();
                updateCart();

                cartPanel?.classList.add("open");
            };
        }
    }

    if (id) {
        loadProduct(id);
    }

    /* =========================
       PRODUCT CARDS
    ========================= */

    function setupProductClicks() {
        const cards = document.querySelectorAll(".product-card");

        cards.forEach((card) => {
            card.addEventListener("click", () => {
                const productId = card.dataset.product;

                if (!productId) return;

                window.location.href =
                    `/product?id=${encodeURIComponent(productId)}`;
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
       CART PANEL
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

        setTimeout(() => {
            searchInput?.focus();
        }, 100);
    });

    searchSubmit?.addEventListener("click", () => {
        searchBar?.classList.remove("open");
    });

    /* =========================
       CHECKOUT
    ========================= */

    checkoutBtn?.addEventListener("click", async () => {
        if (cart.length === 0) {
            alert("Your cart is empty.");
            return;
        }

        checkoutBtn.disabled = true;
        checkoutBtn.textContent = "LOADING...";

        try {
            const res = await fetch("/create-checkout-session", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    items: cart
                })
            });

            const data = await res.json();

            if (data.url) {
                window.location.href = data.url;
                return;
            }

            console.error("No checkout URL returned", data);
            alert("Checkout could not start. Please try again.");

        } catch (err) {
            console.error("Checkout failed:", err);
            alert("Checkout failed. Please try again.");
        } finally {
            checkoutBtn.disabled = false;
            checkoutBtn.textContent = "CHECKOUT";
        }
    });

});