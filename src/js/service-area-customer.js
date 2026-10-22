"use strict";
(() => {
  const storeCenter = [-0.5087698, 36.8917955];
  const tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  function checkLocation(lat, lng) {
    return supabaseClient.rpc("peak_fresh_check_order_location", { p_lat: lat, p_lng: lng });
  }
  window.peakFreshCheckOrderLocation = async () => {
    const point = window.peakFreshOrderLocation;
    if (!point) return { allowed: false, error: new Error("Share your current location to check this area.") };
    const { data, error } = await checkLocation(point.lat, point.lng);
    return { allowed: !error && data?.allowed === true, data, error };
  };

  function attach(form) {
    if (form.dataset.locationReady === "true") return;
    const pickup = form.querySelector("#pickupSection");
    if (!pickup || !window.L) return;
    form.dataset.locationReady = "true";

    const panel = document.createElement("section");
    panel.className = "order-location-panel";
    panel.setAttribute("aria-labelledby", "orderLocationTitle");
    const title = document.createElement("h3");
    title.id = "orderLocationTitle";
    title.textContent = "Check your area";
    const description = document.createElement("p");
    description.textContent = "Share your device location to see whether ordering is available where you are.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "order-location-button";
    button.textContent = "Use my current location";
    const mapElement = document.createElement("div");
    mapElement.className = "order-location-map";
    mapElement.setAttribute("aria-label", "Map showing your current location");
    const status = document.createElement("p");
    status.className = "order-location-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Your exact location is used only to check the enabled service areas.";
    panel.append(title, description, button, mapElement, status);
    pickup.insertAdjacentElement("beforebegin", panel);

    const map = L.map(mapElement, { scrollWheelZoom: false }).setView(storeCenter, 15);
    L.tileLayer(tileUrl, { maxZoom: 19, attribution }).addTo(map);
    let marker = null;
    let locating = false;

    button.addEventListener("click", () => {
      if (!navigator.geolocation) {
        status.textContent = "This browser cannot share device location. Allow location access in a supported browser and try again.";
        status.classList.add("is-error");
        return;
      }
      if (locating) return;
      locating = true;
      button.disabled = true;
      button.textContent = "Finding your location...";
      status.textContent = "Waiting for your device location permission...";
      status.classList.remove("is-error", "is-success");
      navigator.geolocation.getCurrentPosition(async position => {
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        const accuracy = Number(position.coords.accuracy);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy) || accuracy > 5000) {
          status.textContent = "Your device could not provide an accurate location. Move to a place with a clearer signal and retry.";
          status.classList.add("is-error");
          locating = false;
          button.disabled = false;
          button.textContent = "Try location again";
          return;
        }
        window.peakFreshOrderLocation = { lat, lng };
        map.setView([lat, lng], 16);
        if (marker) marker.remove();
        marker = L.circleMarker([lat, lng], { radius: 8, color: "#174d37", weight: 3, fillColor: "#b6d898", fillOpacity: 1 }).addTo(map);
        map.invalidateSize();
        status.textContent = "Checking enabled service areas...";
        try {
          const { allowed, data, error } = await window.peakFreshCheckOrderLocation();
          if (error) throw error;
          status.textContent = allowed
            ? (data.restriction_enabled ? "Ordering is available in " + (data.area_name || "your area") + ". Choose a pickup time to continue." : "Location received. You can continue to choose a pickup time.")
            : "Not yet available in your region.";
          status.classList.toggle("is-error", !allowed);
          status.classList.toggle("is-success", allowed);
        } catch {
          window.peakFreshOrderLocation = null;
          status.textContent = "Your location could not be checked. Please sign in and try again.";
          status.classList.add("is-error");
        } finally {
          locating = false;
          button.disabled = false;
          button.textContent = "Refresh my location";
        }
      }, error => {
        const messages = {
          1: "Location permission was denied. Allow location access in your browser settings to check ordering in your area.",
          2: "Your device location is unavailable. Check location services and try again.",
          3: "Location lookup timed out. Try again."
        };
        status.textContent = messages[error.code] || "Your device location could not be read. Try again.";
        status.classList.add("is-error");
        locating = false;
        button.disabled = false;
        button.textContent = "Try location again";
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
    requestAnimationFrame(() => map.invalidateSize());
  }

  function scan() {
    document.querySelectorAll("#orderForm").forEach(attach);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
