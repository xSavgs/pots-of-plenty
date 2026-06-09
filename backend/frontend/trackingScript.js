// Custom radar-style boat icon
const vesselIcon = L.divIcon({
    html: '<div style="font-size: 32px; filter: drop-shadow(0 0 3px #00e5ff);">⛵</div>',
    iconSize: [32, 32],
    className: "vessel-marker"
});

// Use standard map tiles that are bright and clear
const map = L.map("map", {
    zoomControl: true,
    fadeAnimation: true,
    zoomAnimation: true
}).setView([54.2798, -0.4044], 14);

// Use standard OpenStreetMap tiles (they're bright and clear)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}).addTo(map);

let marker = null;
let radarCircle = null;
let radarMode = false;

// Function to add radar range rings
function updateRadarRings(centerLat, centerLon) {
    if (radarCircle) {
        map.removeLayer(radarCircle);
    }

    radarCircle = L.circle([centerLat, centerLon], {
        color: "#00e5ff",
        fillColor: "rgba(0, 229, 255, 0.05)",
        weight: 2,
        opacity: 0.6,
        radius: 500 // 500 meters range
    }).addTo(map);
}

async function loadVessel() {
    try {
        const res = await fetch("/api/vessel");
        const data = await res.json();

        if (!data.success) {
            document.getElementById("signalStatus").innerHTML = '<span style="color: #ff6666;">⚠ SIGNAL LOST</span>';
            return;
        }

        const lat = data.latitude;
        const lon = data.longitude;

        // Update signal status
        document.getElementById("signalStatus").innerHTML = '<span class="signal-strength"></span> SIGNAL ACQUIRED';

        // Update position display
        document.getElementById("position").innerHTML = `${lat.toFixed(6)}° N<br>${lon.toFixed(6)}° E`;

        // Update speed and course if available
        if (data.sog !== undefined && data.sog > 0) {
            const speedKnots = data.sog;
            const speedKmph = (speedKnots * 1.852).toFixed(1);
            document.getElementById("speed").innerHTML =
                `${speedKnots.toFixed(1)} kn<br><span style="font-size:11px;">${speedKmph} km/h</span>`;
        } else {
            document.getElementById("speed").innerHTML = '0 kn<br><span style="font-size:11px;">At anchor</span>';
        }

        if (data.cog !== undefined && data.cog > 0) {
            document.getElementById("course").innerHTML =
                `${data.cog.toFixed(0)}°<br><span style="font-size:11px;">${getCardinalDirection(data.cog)}</span>`;
        } else {
            document.getElementById("course").innerHTML = '---°<br><span style="font-size:11px;">--</span>';
        }

        const updateTime = new Date(data.timestamp); // Real AIS time
        const serverTime = new Date(data.serverTime || data.timestamp); // Server time
        const receivedTime = new Date(data.receivedAt || data.timestamp); // When server got it

        const now = new Date();
        const diffFromAIS = Math.floor((now - updateTime) / 1000);
        const diffFromReceived = Math.floor((now - receivedTime) / 1000);

        let timeDisplay = "";
        if (diffFromAIS > 60) {
            timeDisplay = `${Math.floor(diffFromAIS / 60)} minutes ${diffFromAIS % 60} seconds ago`;
        } else {
            timeDisplay = `${diffFromAIS} seconds ago`;
        }

        // Show both the AIS timestamp and when the server received it
        document.getElementById("lastUpdate").innerHTML =
            `${updateTime.toLocaleTimeString()}<br><span style="font-size:11px;">AIS data age: ${timeDisplay}</span>`;

        // Optional: Add debug info to console
        console.log(`AIS timestamp: ${updateTime.toLocaleTimeString()}`);
        console.log(`Server received: ${receivedTime.toLocaleTimeString()}`);
        console.log(`Current time: ${now.toLocaleTimeString()}`);
        console.log(`Age: ${diffFromAIS} seconds`);

        // Update marker
        if (!marker) {
            marker = L.marker([lat, lon], { icon: vesselIcon }).addTo(map).bindPopup(`
                <div style="font-family: monospace; background: #fff; color: #061220; padding: 5px;">
                    <b>⚓ POTS OF PLENTY</b><br>
                    ${data.sog ? `Speed: ${data.sog.toFixed(1)} kn<br>` : ""}
                    ${data.cog ? `Course: ${data.cog.toFixed(0)}°<br>` : ""}
                    Last update: ${updateTime.toLocaleTimeString()}
                </div>
            `);
        } else {
            marker.setLatLng([lat, lon]);
        }

        // Update radar rings if in radar mode
        if (radarMode) {
            updateRadarRings(lat, lon);
        }

        // Only auto-center if user hasn't moved the map recently
        if (!userMovedMap) {
            map.setView([lat, lon], 14);
        }
    } catch (err) {
        console.error(err);
        document.getElementById("signalStatus").innerHTML = '<span style="color: #ff6666;">⚠ CONNECTION ERROR</span>';
    }
}

// Helper function for cardinal directions
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
    const index = Math.round(degrees / 22.5) % 16;
    return directions[index];
}

let userMovedMap = false;

// Detect when user moves the map
map.on("dragstart", () => {
    userMovedMap = true;
});

function centerOnVessel() {
    if (marker) {
        const pos = marker.getLatLng();
        map.setView(pos, 15);
        marker.openPopup();
        userMovedMap = false;
    } else {
        alert("Waiting for vessel position data...");
    }
}

function refreshData() {
    loadVessel();
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = "🔄 UPDATING...";
    setTimeout(() => {
        btn.textContent = originalText;
    }, 1000);
}

function toggleRadarMode() {
    radarMode = !radarMode;
    if (radarMode && marker) {
        const pos = marker.getLatLng();
        updateRadarRings(pos.lat, pos.lng);
    } else if (radarCircle) {
        map.removeLayer(radarCircle);
        radarCircle = null;
    }
}

// Load initial data
loadVessel();

// Update every 30 seconds
setInterval(loadVessel, 30000);