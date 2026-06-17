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
       GIVEAWAY COUNTER
    ========================= */

    function injectGiveawayStyles() {
        // Giveaway styles now live in style.css.
    }

    function getCurrentPagePath() {
        return window.location.pathname.replace(/\/+$/, "") || "/";
    }

    function shouldShowGiveawayBanner() {
        const path = getCurrentPagePath();

        return [
            "/",
            "/index",
            "/shop",
            "/product",
            "/success"
        ].includes(path);
    }

    function buildGiveawayBanner() {
        if (!shouldShowGiveawayBanner()) {
            document.getElementById("giveawayBanner")?.remove();
            return null;
        }

        if (document.getElementById("giveawayBanner")) {
            return document.getElementById("giveawayBanner");
        }

        const banner = document.createElement("section");
        banner.id = "giveawayBanner";
        banner.className = "giveaway-banner";
        banner.innerHTML = `
            <div class="giveaway-inner">
                <div class="giveaway-copy">
                    <span class="giveaway-kicker">Premium Gold Hoodie Giveaway</span>
                    <h2>Win the premium gold hoodie</h2>
                    <p>
                        Every paid website order is automatically entered. The winner will be picked at random when the site reaches 100 paid orders.
                    </p>
                </div>

                <div class="giveaway-progress-card">
                    <div class="giveaway-progress-top">
                        <div class="giveaway-count">
                            <strong id="giveawayCount">--</strong><span id="giveawayTarget"> / 100</span>
                        </div>
                        <div class="giveaway-remaining" id="giveawayRemaining">
                            Loading order count...
                        </div>
                    </div>
                    <div class="giveaway-bar" aria-hidden="true">
                        <span class="giveaway-fill" id="giveawayFill"></span>
                    </div>
                    <div class="giveaway-footnote" id="giveawayFootnote">
                        Previous paid website orders are included.
                    </div>
                </div>
            </div>
        `;

        const hero = document.querySelector(".hero");
        const productPage = document.querySelector(".product-page");
        const navbar = document.querySelector(".navbar");

        if (productPage) {
            banner.classList.add("giveaway-banner-product-page");
            productPage.insertAdjacentElement("beforebegin", banner);
        } else if (hero) {
            hero.insertAdjacentElement("afterend", banner);
        } else if (navbar) {
            navbar.insertAdjacentElement("afterend", banner);
        } else {
            document.body.prepend(banner);
        }

        return banner;
    }

    function updateGiveawayBanner(progress) {
        const countEl = document.getElementById("giveawayCount");
        const targetEl = document.getElementById("giveawayTarget");
        const remainingEl = document.getElementById("giveawayRemaining");
        const fillEl = document.getElementById("giveawayFill");
        const footnoteEl = document.getElementById("giveawayFootnote");

        if (!countEl || !targetEl || !remainingEl || !fillEl || !footnoteEl) return;

        countEl.textContent = progress.displayCount ?? progress.count ?? "--";
        targetEl.textContent = ` / ${progress.target || 100}`;
        fillEl.style.width = `${progress.percentage || 0}%`;

        if (progress.reached) {
            remainingEl.textContent = "Target reached — winner selection pending";
        } else {
            remainingEl.textContent = `${progress.remaining} orders to go`;
        }

        footnoteEl.textContent = progress.stripeHasMoreAfterThisBatch
            ? "Previous paid website orders are included. Admin note: Stripe has more sessions beyond the current scan limit."
            : "Previous paid website orders are included. Every new paid order updates the count automatically.";
    }

    function setupProductGiveawayNote() {
        const addBtn = document.getElementById("addToCartBtn");

        if (!addBtn || document.getElementById("productGiveawayNote")) return;

        const note = document.createElement("div");
        note.id = "productGiveawayNote";
        note.className = "product-giveaway-note";
        note.innerHTML = "🏆 <strong>Giveaway entry included:</strong> place a paid website order and you are automatically entered for the Premium Gold Hoodie Giveaway.";

        addBtn.insertAdjacentElement("afterend", note);
    }

    async function setupGiveawayCounter() {
        setupProductGiveawayNote();

        if (!shouldShowGiveawayBanner()) {
            document.getElementById("giveawayBanner")?.remove();
            return;
        }

        injectGiveawayStyles();

        const banner = buildGiveawayBanner();

        if (!banner) {
            return;
        }

        try {
            const res = await fetch("/api/order-count");
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || "Giveaway count unavailable");
            }

            updateGiveawayBanner(data);
        } catch (err) {
            console.error("Giveaway counter failed:", err);

            updateGiveawayBanner({
                displayCount: "--",
                target: 100,
                remaining: "",
                percentage: 0,
                reached: false
            });

            const remainingEl = document.getElementById("giveawayRemaining");
            const footnoteEl = document.getElementById("giveawayFootnote");

            if (remainingEl) {
                remainingEl.textContent = "Giveaway is live";
            }

            if (footnoteEl) {
                footnoteEl.textContent = "Every paid website order is automatically entered. Count temporarily unavailable.";
            }
        }
    }

    setupGiveawayCounter();
    setInterval(setupGiveawayCounter, 60000);

    /* =========================
       PRODUCTS
    ========================= */

    const products = {
        "white-hoodie": {
            title: "Hoodie — White",
            price: 34.99,
            images: ["/assets/hoodie.png", "/assets/hoodieback.png"]
        },
        "black-hoodie": {
            title: "Hoodie — Black",
            price: 34.99,
            images: ["/assets/hoodie2.png", "/assets/hoodie2back.png"]
        },
        "white-tshirt": {
            title: "T-Shirt — White",
            price: 24.99,
            images: ["/assets/tshirt.png", "/assets/tshirtback.png"]
        },
        "black-tshirt": {
            title: "T-Shirt — Black",
            price: 24.99,
            images: ["/assets/tshirt2.png", "/assets/tshirt2back.png"]
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
                Delivery may take up to 2 weeks.
            </div>

            ${
                delivery > 0
                    ? `<div class="cart-delivery-note">Spend £${DELIVERY_THRESHOLD.toFixed(2)} or more to remove the extra charge.</div>`
                    : `<div class="cart-delivery-note">No delivery / handling charge added.</div>`
            }

            <div class="cart-giveaway-note">
                🏆 This paid order automatically enters you into the Premium Gold Hoodie Giveaway.
            </div>
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