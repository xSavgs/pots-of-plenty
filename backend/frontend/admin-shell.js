(function () {
    const token =
        localStorage.getItem("adminToken") ||
        localStorage.getItem("admin_token");

    if (!token) {
        window.location.href = "/admin";
        return;
    }

    function adminLogout() {
        localStorage.removeItem("adminToken");
        localStorage.removeItem("admin_token");
        window.location.href = "/admin";
    }

    window.adminLogout = adminLogout;

    window.adminFetch = async function adminFetch(url, options = {}) {
        const headers = {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`
        };

        const res = await fetch(url, {
            ...options,
            headers
        });

        if (res.status === 401) {
            adminLogout();
            return null;
        }

        return res;
    };

    async function adminVerify() {
        try {
            const res = await window.adminFetch("/api/admin/verify");

            if (!res || !res.ok) {
                adminLogout();
            }
        } catch {
            adminLogout();
        }
    }

    function adminNavItem(path, label, icon) {
        const current = window.location.pathname;
        const active = current === path ? "active" : "";

        return `
            <a href="${path}" class="${active}">
                ${icon} ${label}
            </a>
        `;
    }

    function buildAdminShell() {
        if (document.body.dataset.adminShellReady === "true") {
            return;
        }

        document.body.dataset.adminShellReady = "true";
        document.body.classList.add("admin-page");

        const mobileTop = document.createElement("div");
        mobileTop.className = "admin-mobile-top";
        mobileTop.innerHTML = `
            <strong>⚓ Pots Admin</strong>
            <button class="admin-small-btn" id="mobileMenuBtn">
                Menu
            </button>
        `;

        const layout = document.createElement("div");
        layout.className = "admin-layout";

        const sidebar = document.createElement("aside");
        sidebar.className = "admin-sidebar";
        sidebar.id = "adminSidebar";

        sidebar.innerHTML = `
            <div class="admin-brand">
                <strong>⚓ Pots of Plenty</strong>
                <span>Admin Control Centre</span>
            </div>

            <nav class="admin-nav">
                ${adminNavItem("/admin-dashboard", "Dashboard", "📊")}
                ${adminNavItem("/admin-orders", "Orders", "🧾")}
                ${adminNavItem("/admin-giveaway", "Giveaway", "🏆")}
                ${adminNavItem("/admin-products", "Products", "👕")}
                ${adminNavItem("/admin-messages", "Messages", "✉️")}
                ${adminNavItem("/admin-status", "Status", "🟢")}
                ${adminNavItem("/admin-tools", "API Tools", "🛠️")}

                <a href="/api/order-count" target="_blank" rel="noopener noreferrer">
                    📈 Public Order Count
                </a>

                <a href="/track" target="_blank" rel="noopener noreferrer">
                    📡 Vessel Tracking
                </a>

                <a href="/" target="_blank" rel="noopener noreferrer">
                    🌍 Open Website
                </a>

                <button id="adminLogoutBtn">
                    🚪 Logout
                </button>
            </nav>

            <div class="admin-sidebar-footer">
                Protected admin endpoints use your Bearer token automatically from inside this panel.<br>
                Pots of Plenty Admin
            </div>
        `;

        const main = document.createElement("main");
        main.className = "admin-main";

        while (document.body.firstChild) {
            main.appendChild(document.body.firstChild);
        }

        layout.appendChild(sidebar);
        layout.appendChild(main);

        document.body.appendChild(mobileTop);
        document.body.appendChild(layout);

        document
            .getElementById("adminLogoutBtn")
            ?.addEventListener("click", adminLogout);

        document
            .getElementById("mobileMenuBtn")
            ?.addEventListener("click", () => {
                document
                    .getElementById("adminSidebar")
                    ?.classList.toggle("open");
            });
    }

    document.addEventListener("DOMContentLoaded", () => {
        buildAdminShell();
        adminVerify();
    });
})();
