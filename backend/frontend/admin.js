document.addEventListener("DOMContentLoaded", () => {

    const form = document.getElementById("loginForm");
    const message = document.getElementById("message");

    form?.addEventListener("submit", async (e) => {

        e.preventDefault();

        const username =
            document.getElementById("username").value;

        const password =
            document.getElementById("password").value;

        try {

            const res = await fetch("/api/admin/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    password
                })
            });

            const data = await res.json();

            if (data.success) {

                localStorage.setItem(
                    "adminToken",
                    data.token
                );

                window.location.href = "/admin-dashboard";

            } else {

                message.textContent =
                    "Invalid login";

            }

        } catch (err) {

            console.error(err);

            message.textContent =
                "Login failed";

        }

    });

});