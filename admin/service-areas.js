"use strict";
document.addEventListener("DOMContentLoaded", () => {
  const host = document.querySelector("#store-settings .admin-panel");
  const dashboard = document.getElementById("adminDashboard");
  if (!host || !window.L) return;

  const section = document.createElement("section");
  section.className = "service-area-settings settings-subsection";
  section.innerHTML = `
    <div class="subsection-heading"><span class="subsection-icon" aria-hidden="true">MAP</span><div><h3>Order Regions</h3><p>Set the places where customers may order. Customers share their device location; pickup stays at the store.</p></div></div>
    <label class="admin-checkbox service-area-gate"><input id="serviceAreaGate" type="checkbox"> Only allow orders from enabled regions</label>
    <p class="service-area-note">If this is enabled with no active regions, new orders will be blocked. Location checks do not save customer coordinates.</p>
    <form id="serviceAreaForm" class="admin-form service-area-form">
      <label>Region name<input id="serviceAreaName" maxlength="100" required placeholder="For example: Mathenge TTI area"></label>
      <label>Radius in metres<input id="serviceAreaRadius" type="number" min="50" max="50000" step="50" value="1000" required></label>
      <div id="serviceAreaMap" class="service-area-map" aria-label="Click the map to set the centre of this order region"></div>
      <p id="serviceAreaMapHint" class="service-area-map-hint">Click the map to set a region centre. Drag the map to find the right place.</p>
      <div class="admin-form-actions"><button class="btn" type="submit">Save region</button><button class="admin-secondary" id="serviceAreaNew" type="button">New region</button><button class="admin-secondary" id="serviceAreaSaveGate" type="button">Save region access</button></div>
    </form>
    <ul id="serviceAreaList" class="admin-record-list service-area-list" aria-label="Configured order regions"><li>Loading order regions...</li></ul>
    <p id="serviceAreaMessage" class="admin-message" role="status" aria-live="polite"></p>`;
  host.append(section);

  const $ = id => document.getElementById(id);
  const form = $("serviceAreaForm"), nameInput = $("serviceAreaName"), radiusInput = $("serviceAreaRadius");
  const gate = $("serviceAreaGate"), mapHint = $("serviceAreaMapHint"), list = $("serviceAreaList"), message = $("serviceAreaMessage");
  const center = [-0.5087698, 36.8917955];
  let selectedArea = null, pin = null, circle = null, map = null, areas = [], mapReady = false;

  function say(text, kind) {
    message.textContent = text;
    message.dataset.kind = kind || "";
  }
  function draw(lat, lng, radius) {
    if (!map) return;
    const point = [lat, lng];
    if (pin) pin.remove();
    if (circle) circle.remove();
    pin = L.marker(point).addTo(map);
    circle = L.circle(point, { radius, color: "#2f684b", weight: 2, fillColor: "#80ae72", fillOpacity: .18 }).addTo(map);
    mapHint.textContent = "Centre: " + lat.toFixed(5) + ", " + lng.toFixed(5) + " | Radius: " + Number(radius).toLocaleString() + " m";
  }
  function resetEditor() {
    selectedArea = null;
    form.reset();
    radiusInput.value = "1000";
    if (pin) pin.remove();
    if (circle) circle.remove();
    pin = circle = null;
    mapHint.textContent = "Click the map to set a region centre. Drag the map to find the right place.";
    say("");
  }
  function initMap() {
    if (mapReady || map.clientWidth < 50 || map.clientHeight < 50) return;
    mapReady = true;
    const mapInstance = L.map(map, { scrollWheelZoom: false }).setView(center, 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapInstance);
    map = mapInstance;
    map.on("click", event => {
      draw(event.latlng.lat, event.latlng.lng, Math.max(50, Number(radiusInput.value) || 1000));
    });
    radiusInput.addEventListener("input", () => {
      if (pin) draw(pin.getLatLng().lat, pin.getLatLng().lng, Math.max(50, Number(radiusInput.value) || 50));
    });
    setTimeout(() => map.invalidateSize(), 100);
  }

  async function call(action, body = {}) {
    const result = await supabaseClient.functions.invoke("peak-fresh-operations", { body: { action, ...body } });
    if (result.error) throw result.error;
    return result.data || {};
  }
  function renderAreas() {
    list.replaceChildren();
    if (!areas.length) {
      const empty = document.createElement("li");
      empty.textContent = "No regions configured yet.";
      list.append(empty);
      return;
    }
    for (const area of areas) {
      const row = document.createElement("li");
      row.className = "service-area-item";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = area.name;
      const details = document.createElement("span");
      details.textContent = Number(area.radius_meters).toLocaleString() + " m radius | " + (area.enabled ? "Enabled" : "Paused");
      copy.append(title, details);
      const actions = document.createElement("div");
      actions.className = "service-area-actions";
      const edit = document.createElement("button");
      edit.type = "button"; edit.className = "admin-secondary"; edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        selectedArea = area;
        nameInput.value = area.name;
        radiusInput.value = String(area.radius_meters);
        draw(area.center_lat, area.center_lng, area.radius_meters);
        map.setView([area.center_lat, area.center_lng], 16);
        form.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const toggle = document.createElement("button");
      toggle.type = "button"; toggle.className = "admin-secondary"; toggle.textContent = area.enabled ? "Pause" : "Enable";
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          await call("admin_save_service_area", { area: { ...area, enabled: !area.enabled } });
          await load();
          say("Region " + (area.enabled ? "paused." : "enabled."), "success");
        } catch {
          toggle.disabled = false;
          say("Region setting could not be saved. Refresh and retry.", "error");
        }
      });
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "admin-secondary service-area-delete"; remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!confirm("Delete the " + area.name + " service region?")) return;
        remove.disabled = true;
        try { await call("admin_delete_service_area", { area_id: area.id }); await load(); say("Region deleted.", "success"); }
        catch { remove.disabled = false; say("Region could not be deleted. Refresh and retry.", "error"); }
      });
      actions.append(edit, toggle, remove);
      row.append(copy, actions);
      list.append(row);
    }
  }
  async function load() {
    try {
      const data = await call("admin_list_service_areas");
      areas = Array.isArray(data.areas) ? data.areas : [];
      gate.checked = data.order_region_check_enabled === true;
      renderAreas();
    } catch {
      list.replaceChildren();
      const error = document.createElement("li");
      error.textContent = "Order regions could not be loaded. Confirm administrator access and retry.";
      list.append(error);
    }
  }

  map = $("serviceAreaMap");
  const resize = new ResizeObserver(() => {
    if (!mapReady) initMap();
    else if (map && typeof map.invalidateSize === "function") map.invalidateSize();
  });
  resize.observe(map);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!pin) { say("Click the map to choose this region center.", "error"); return; }
    const centerPoint = pin.getLatLng();
    const area = {
      ...(selectedArea ? { id: selectedArea.id } : {}),
      name: nameInput.value.trim(),
      center_lat: centerPoint.lat,
      center_lng: centerPoint.lng,
      radius_meters: Number(radiusInput.value),
      enabled: selectedArea ? selectedArea.enabled : true
    };
    if (!Number.isFinite(area.radius_meters) || area.radius_meters < 50 || area.radius_meters > 50000) {
      say("Set a radius between 50 and 50,000 metres.", "error"); return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await call("admin_save_service_area", { area });
      await load();
      resetEditor();
      say("Region saved.", "success");
    } catch {
      say("Region could not be saved. Refresh and retry.", "error");
    } finally { submit.disabled = false; }
  });
  $("serviceAreaSaveGate").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await call("admin_save_service_area_settings", { order_region_check_enabled: gate.checked });
      say(gate.checked ? "Orders are now limited to enabled regions." : "Region checking is off. Orders can be placed from any area.", "success");
    } catch {
      say("Region access setting could not be saved. Refresh and retry.", "error");
    } finally { button.disabled = false; }
  });
  $("serviceAreaNew").addEventListener("click", resetEditor);
  const authObserver = new MutationObserver(() => {
    if (!dashboard.hidden && !section.dataset.loaded) {
      section.dataset.loaded = "true";
      void load();
    }
  });
  authObserver.observe(dashboard, { attributes: true, attributeFilter: ["hidden"] });
  if (!dashboard.hidden) { section.dataset.loaded = "true"; void load(); }
});
