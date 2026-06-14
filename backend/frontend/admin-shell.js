const adminToken = localStorage.getItem("adminToken");

if (!adminToken) {
    window.location.href = "/admin";
}

function adminLogout() {
    localStorage.removeItem("adminToken");
    window.location.href = "/admin";
}

async function adminVerify() {
    try {
        const res = await fetch("/api/admin/verify", {
            headers: {
                Authorization: `Bearer ${adminToken}`
            }
        });

        if (!res.ok) {
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
    document.body.classList.add("admin-page");

    const existingContent = document.body.innerHTML;

    document.body.innerHTML = `
        <div class="admin-mobile-top">
            <strong>⚓ Pots Admin</strong>
            <button class="admin-small-btn" id="mobileMenuBtn">Menu</button>
        </div>

        <div class="admin-layout">
            <aside class="admin-sidebar" id="adminSidebar">
                <div class="admin-brand">
                    <strong>⚓ Pots of Plenty</strong>
                    <span>Admin Control Centre</span>
                </div>

                <nav class="admin-nav">
                    ${adminNavItem("/admin-dashboard", "Dashboard", "📊")}
                    ${adminNavItem("/admin-orders", "Orders", "🧾")}
                    ${adminNavItem("/admin-products", "Products", "👕")}
                    ${adminNavItem("/admin-messages", "Messages", "✉️")}
                    ${adminNavItem("/admin-status", "Status", "🟢")}
                    <a href="/track" target="_blank" rel="noopener noreferrer">📡 Vessel Tracking</a>
                    <a href="/" target="_blank" rel="noopener noreferrer">🌍 Open Website</a>
                    <button id="adminLogoutBtn">🚪 Logout</button>
                </nav>

                <div class="admin-sidebar-footer">
                    Logged in securely<br>
                    Pots of Plenty Admin
                </div>
            </aside>

            <main class="admin-main">
                ${existingContent}
            </main>
        </div>
    `;

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

window.adminFetch = async function adminFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${adminToken}`
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