(() => {
    "use strict";

    const API_URL = "/api/vessel";
    const DEFAULT_POSITION = [54.2798, -0.4044];
    const DEFAULT_ZOOM = 14;
    const FOCUSED_ZOOM = 15;
    const REFRESH_MS = 30000;

    let map = null;
    let marker = null;
    let radarCircle = null;
    let radarMode = false;
    let userMovedMap = false;
    let suppressMoveTracking = false;
    let isLoading = false;

    const vesselIconHtml = '<div style="font-size: 32px; filter: drop-shadow(0 0 3px #00e5ff);">⛵</div>';

    function byId(id) {
        return document.getElementById(id);
    }

    function setHtml(id, html) {
        const el = byId(id);

        if (el) {
            el.innerHTML = html;
        }
    }

    function toNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function formatCoordinate(value, positiveLabel, negativeLabel) {
        const direction = value >= 0 ? positiveLabel : negativeLabel;
        return `${Math.abs(value).toFixed(6)}° ${direction}`;
    }

    function formatPosition(lat, lon) {
        return `${formatCoordinate(lat, "N", "S")}<br>${formatCoordinate(lon, "E", "W")}`;
    }

    function formatAge(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return "timestamp unavailable";
        }

        const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

        if (seconds >= 3600) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m ago`;
        }

        if (seconds >= 60) {
            return `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds ago`;
        }

        return `${seconds} seconds ago`;
    }

    function getCardinalDirection(degrees) {
        const directions = [
            "N",
            "NNE",
            "NE",
            "ENE",
            "E",
            "ESE",
            "SE",
            "SSE",
            "S",
            "SSW",
            "SW",
            "WSW",
            "W",
            "WNW",
            "NW",
            "NNW"
        ];

        return directions[Math.round(degrees / 22.5) % 16];
    }

    function safeSetView(position, zoom) {
        if (!map) return;

        suppressMoveTracking = true;
        map.setView(position, zoom);

        window.setTimeout(() => {
            suppressMoveTracking = false;
        }, 300);
    }

    function updateRadarRings(lat, lon) {
        if (!map || typeof L === "undefined") return;

        if (radarCircle) {
            map.removeLayer(radarCircle);
            radarCircle = null;
        }

        radarCircle = L.circle([lat, lon], {
            color: "#00e5ff",
            fillColor: "rgba(0, 229, 255, 0.05)",
            weight: 2,
            opacity: 0.6,
            radius: 500
        }).addTo(map);
    }

    function buildPopup(data, updateTime) {
        const sog = toNumber(data.sog);
        const cog = toNumber(data.cog);

        return `
            <div style="font-family: monospace; background: #fff; color: #061220; padding: 5px;">
                <b>⚓ POTS OF PLENTY</b><br>
                ${sog !== null ? `Speed: ${sog.toFixed(1)} kn<br>` : ""}
                ${cog !== null ? `Course: ${cog.toFixed(0)}° ${getCardinalDirection(cog)}<br>` : ""}
                Last update: ${Number.isNaN(updateTime.getTime()) ? "Unavailable" : updateTime.toLocaleTimeString()}
            </div>
        `;
    }

    async function loadVessel() {
        if (!map || isLoading) return;

        isLoading = true;

        try {
            const res = await fetch(API_URL, {
                cache: "no-store"
            });

            if (!res.ok) {
                throw new Error(`Vessel endpoint returned HTTP ${res.status}`);
            }

            const data = await res.json();

            if (!data || !data.success) {
                setHtml("signalStatus", '<span style="color: #ff6666;">⚠ SIGNAL LOST</span>');
                return;
            }

            const lat = toNumber(data.latitude);
            const lon = toNumber(data.longitude);

            if (lat === null || lon === null) {
                throw new Error("Vessel endpoint did not return valid latitude/longitude values");
            }

            const sog = toNumber(data.sog);
            const cog = toNumber(data.cog);
            const updateTime = new Date(data.timestamp || data.receivedAt || Date.now());

            setHtml("signalStatus", '<span class="signal-strength"></span> SIGNAL ACQUIRED');
            setHtml("position", formatPosition(lat, lon));

            if (sog !== null && sog > 0) {
                setHtml(
                    "speed",
                    `${sog.toFixed(1)} kn<br><span style="font-size:11px;">${(sog * 1.852).toFixed(1)} km/h</span>`
                );
            } else {
                setHtml("speed", '0 kn<br><span style="font-size:11px;">At anchor</span>');
            }

            if (cog !== null) {
                setHtml(
                    "course",
                    `${cog.toFixed(0)}°<br><span style="font-size:11px;">${getCardinalDirection(cog)}</span>`
                );
            } else {
                setHtml("course", '---°<br><span style="font-size:11px;">--</span>');
            }

            setHtml(
                "lastUpdate",
                `${Number.isNaN(updateTime.getTime()) ? "Unavailable" : updateTime.toLocaleTimeString()}<br><span style="font-size:11px;">AIS data age: ${formatAge(updateTime)}</span>`
            );

            const popup = buildPopup(data, updateTime);

            if (!marker) {
                marker = L.marker([lat, lon], {
                    icon: window.vesselIcon
                })
                    .addTo(map)
                    .bindPopup(popup);
            } else {
                marker.setLatLng([lat, lon]);
                marker.setPopupContent(popup);
            }

            if (radarMode) {
                updateRadarRings(lat, lon);
            }

            if (!userMovedMap) {
                safeSetView([lat, lon], DEFAULT_ZOOM);
            }
        } catch (err) {
            console.error("Vessel tracker error:", err);
            setHtml("signalStatus", '<span style="color: #ff6666;">⚠ CONNECTION ERROR</span>');
        } finally {
            isLoading = false;
        }
    }

    function centerOnVessel() {
        if (!marker) {
            alert("Waiting for vessel position data...");
            return;
        }

        userMovedMap = false;
        safeSetView(marker.getLatLng(), FOCUSED_ZOOM);
        marker.openPopup();
    }

    function refreshData(event) {
        loadVessel();

        const btn = event?.currentTarget || event?.target;

        if (!btn) return;

        const originalText = btn.textContent;
        btn.textContent = "🔄 UPDATING...";

        window.setTimeout(() => {
            btn.textContent = originalText;
        }, 1000);
    }

    function toggleRadarMode() {
        radarMode = !radarMode;

        if (radarMode && marker) {
            const pos = marker.getLatLng();
            updateRadarRings(pos.lat, pos.lng);
            return;
        }

        if (!radarMode && radarCircle) {
            map.removeLayer(radarCircle);
            radarCircle = null;
        }
    }

    function initMap() {
        if (typeof L === "undefined") {
            setHtml("signalStatus", '<span style="color: #ff6666;">⚠ MAP LIBRARY FAILED</span>');
            console.error("Leaflet did not load. Check the Leaflet script tag/order.");
            return;
        }

        const mapElement = byId("map");

        if (!mapElement) {
            console.error("Cannot initialise tracker: #map element was not found.");
            return;
        }

        window.vesselIcon = L.divIcon({
            html: vesselIconHtml,
            iconSize: [32, 32],
            className: "vessel-marker"
        });

        map = L.map(mapElement, {
            zoomControl: true,
            fadeAnimation: true,
            zoomAnimation: true
        }).setView(DEFAULT_POSITION, DEFAULT_ZOOM);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);

        map.on("dragstart zoomstart", () => {
            if (!suppressMoveTracking) {
                userMovedMap = true;
            }
        });

        byId("centerVesselBtn")?.addEventListener("click", centerOnVessel);
        byId("refreshVesselBtn")?.addEventListener("click", refreshData);
        byId("toggleRadarBtn")?.addEventListener("click", toggleRadarMode);

        loadVessel();

        window.setInterval(loadVessel, REFRESH_MS);
    }

    window.centerOnVessel = centerOnVessel;
    window.refreshData = refreshData;
    window.toggleRadarMode = toggleRadarMode;

    document.addEventListener("DOMContentLoaded", initMap);
})();