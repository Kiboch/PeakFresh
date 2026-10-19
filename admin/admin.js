"use strict";
document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);
  const login = $("adminSignIn"), form = $("adminSignInForm"), google = $("adminGoogleSignIn");
  const checking = $("adminChecking"), denied = $("adminDenied"), dashboard = $("adminDashboard");
  const msg = $("adminMessage"), signMsg = $("signInMessage"), tbody = $("ordersBody"), filters = $("filters");
  const toast = $("adminToast"), toastText = $("adminToastText"), toastDismiss = $("adminToastDismiss");
  let toastTimer = 0;
  function hideToast() {
    window.clearTimeout(toastTimer);
    toast.hidden = true;
    toast.classList.remove("is-visible");
  }
  function showToast(text, kind) {
    window.clearTimeout(toastTimer);
    toastText.textContent = text;
    toast.dataset.kind = kind;
    toast.setAttribute("role", kind === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    toast.hidden = false;
    toast.classList.remove("is-visible");
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    toastTimer = window.setTimeout(hideToast, kind === "error" ? 8000 : 5500);
  }
  toastDismiss.addEventListener("click", hideToast);
  const storeForm = $("storeForm"), productForm = $("productForm"), memberForm = $("adminMemberForm");
  const productImageInput = productForm.elements.image_file;
  const productSizeAvailability = $("productSizeAvailability");
  const productSizeAvailabilityByMl = new Map();
  const productImagePreview = $("productImagePreview"), productImagePreviewEmpty = $("productImagePreviewEmpty");
  const productAssetsButton = $("connectProductAssets"), productAssetsStatus = $("productAssetsStatus");
  const cleanupMessage = $("cleanupPreview"), cleanupButton = $("archiveCancelledOrders");
  const cleanupRetryButton = document.createElement("button");
  cleanupRetryButton.type = "button";
  cleanupRetryButton.className = "admin-secondary cleanup-retry";
  cleanupRetryButton.textContent = "Retry preview";
  cleanupRetryButton.setAttribute("aria-label", "Retry checking cancelled orders");
  $("cancelled-orders").appendChild(cleanupRetryButton);
  productImagePreview.addEventListener("error", () => {
    productImagePreview.hidden = true;
    productImagePreviewEmpty.hidden = false;
    productImagePreviewEmpty.textContent = "The saved photo preview is unavailable.";
  });
  let busy = false, managerBusy = false, authorized = false, epoch = 0, authEventSeen = false;
  let cleanupPreviewBusy = false;
  let productsCache = [];
  const say = (el, text, kind = "") => {
    el.textContent = text;
    el.className = "admin-message" + (kind ? " " + kind : "");
    const actionSuccess = kind === "success" && /\b(saved|save confirmed|archived|removed|revoked|granted|sent|updated|confirmed)\b/i.test(text);
    if (kind === "error" || actionSuccess) showToast(text, kind);
  };
  function responseStatus(error) { return Number(error?.context?.status || error?.status || 0); }
  async function responsePayload(error) {
    try { return error?.context?.clone ? await error.context.clone().json() : null; }
    catch { return null; }
  }
  async function previewFailureMessage(error) {
    const status = responseStatus(error), response = await responsePayload(error);
    if (status === 401) return "Your session expired. Sign in again to check cancelled orders.";
    if (status === 403) return "This account is not authorized to view cancelled orders.";
    if (response?.code === "unsupported_action" || response?.error === "Unknown action.") {
      return "The deployed operations function does not support the cancelled-order preview yet. Deploy the updated Peak Fresh operations function to enable it.";
    }
    if (status === 400) return response?.error || "The preview request was rejected. Refresh and retry.";
    if (status >= 500 || status === 409) return response?.error || "The database could not check cancelled orders. Retry the preview.";
    if (error instanceof Error && error.message === "Invalid cleanup preview response.") return "The server returned an invalid cancelled-order count. Retry the preview.";
    return "Could not contact the server to check cancelled orders. Check your connection and retry.";
  }
  async function productUploadFailure(error) {
    const status = responseStatus(error), response = await responsePayload(error);
    if (status === 401) return "Your session expired. Sign in again before uploading the product photo.";
    if (status === 403) return "This account is not authorized to upload product photos.";

    if (response?.code === "unsupported_action" || response?.error === "Unknown action.") {
      return "The product image upload service does not recognize this request. Check that peak-fresh-product-image is deployed.";
    }
    if (response?.code === "product_image_storage_unavailable") {
      return "Product image storage is not configured. Apply the reviewed product image storage migration, then retry.";
    }
    if (status === 400) return response?.error || "The product photo was rejected. Choose a supported image and retry.";
    if (response?.error) return response.error;
    return "The product photo could not be uploaded. Check your connection and retry.";
  }
  async function productSaveFailure(error) {
    const status = responseStatus(error), response = await responsePayload(error);
    if (status === 401) return "Your session expired. Sign in again before saving the product.";
    if (status === 403) return "This account is not authorized to save products.";
    if (response?.error === "Invalid order ID.") return "The deployed operations function is routing product data through order-ID validation. Update the Peak Fresh operations function before retrying; no product was saved.";
    if (response?.code === "unsupported_action" || response?.error === "Unknown action.") return "The deployed operations function does not support product management yet. Update the Peak Fresh operations function before retrying.";
    if (status === 400) return response?.error || "Check the product details, sizes and prices, then retry.";
    if (status === 409) return "The product could not be saved because its data changed or the server rejected the operation. Refresh and retry.";
    return "The connection was interrupted before the save could be confirmed. Refresh the product list before retrying; it may already be saved.";
  }
  function safeError(error, fallback, unavailable = "This admin feature is not available on the current server version.") {
    const status = responseStatus(error);
    if (status === 401) return "Your session expired. Sign in again and retry.";
    if (status === 403) return "This account is not authorized to perform that action.";
    if (status === 404 || status === 400) return unavailable;
    if (status === 409) return "The saved data changed or the action is no longer valid. Refresh and try again.";
    return fallback;
  }
  async function refreshAfterSave(refresh, successMessage) {
    try {
      await refresh();
      say(msg, successMessage, "success");
    } catch {
      say(msg, `${successMessage} The view could not refresh; reload it to see the latest data.`, "success");
    }
  }
  function hide() { login.hidden = checking.hidden = denied.hidden = dashboard.hidden = true; }
  function loggedOut(text = "") { authorized = false; hide(); login.hidden = false; say(signMsg, text, text ? "error" : ""); }
  async function call(action, values = {}) {
    const { data, error } = await supabaseClient.functions.invoke("peak-fresh-operations", { body: { action, ...values } });
    if (error) throw error;
    return data;
  }
  async function removeCancelledOrder(orderId) {
    const { data, error } = await supabaseClient.functions.invoke("peak-fresh-cancelled-order-removal", {
      body: { order_id: orderId }
    });
    if (error) throw error;
    if (!data || data.ok !== true || data.order_id !== orderId) {
      throw new Error("The server did not confirm cancelled-order removal.");
    }
    return data;
  }
  async function cancelledRemovalFailure(error) {
    const status = responseStatus(error), response = await responsePayload(error);
    if (status === 401) return "Your session expired. Sign in again and retry.";
    if (status === 403) return "This account is not authorized to remove cancelled orders.";
    if (status === 404) return response?.error || "The cancelled order was not found. Refresh the list and retry.";
    if (status === 400 || status === 409) return response?.error || "The server rejected this cancelled-order removal. Refresh and retry.";
    if (status >= 500) return response?.error || "The server could not complete cancelled-order removal. Check the list before retrying.";
    if (error instanceof Error && error.message === "The server did not confirm cancelled-order removal.") return error.message;
    return "Could not reach the cancelled-order removal service. Check your connection and retry.";
  }
  function cell(tr, value) {
    const td = document.createElement("td");
    td.textContent = value == null || value === "" ? " - " : String(value);
    tr.appendChild(td);
    return td;
  }
  function actionButton(label, action, id) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => runOrderAction(action, id, button));
    return button;
  }
  function deleteCancelledOrderButton(order) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete from cancelled orders";
    button.addEventListener("click", async () => {
      const reference = "PF-" + String(order.order_number).padStart(4, "0");
      if (!authorized || busy || !confirm(`Remove ${reference} from the cancelled-orders list? The order and its item, customer, payment, and audit history will be retained.`)) return;
      busy = true; button.disabled = true; say(msg, "Removing cancelled order…");
      try {
        await removeCancelledOrder(order.id);
        try {
          await Promise.all([fetchOrders(), loadCleanupPreview()]);
          say(msg, `${reference} was removed from the cancelled-orders list. Its history was retained.`, "success");
        } catch {
          say(msg, `${reference} was removed from the cancelled-orders list and its history was retained, but the view could not refresh. Reload to see current data.`, "success");
        }
      } catch (error) {
        button.disabled = false;
        say(msg, await cancelledRemovalFailure(error), "error");
      } finally { busy = false; }
    });
    return button;
  }
  function renderOrders(rows) {
    tbody.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement("tr"), td = cell(tr, "No orders match these filters.");
      td.colSpan = 8; tbody.appendChild(tr); return;
    }
    rows.forEach(order => {
      const tr = document.createElement("tr");
      cell(tr, "PF-" + String(order.order_number).padStart(4, "0"));
      cell(tr, [order.customer_name, order.customer_phone].filter(Boolean).join(" — ") || "Customer details unavailable");
      const itemsCell = document.createElement("td"), list = document.createElement("ul");
      list.className = "order-items-list";
      (order.items || []).forEach(item => {
        const li = document.createElement("li");
        li.textContent = String(item.quantity) + " × " + String(item.size_ml) + " ml " + String(item.product);
        list.appendChild(li);
      });
      itemsCell.appendChild(list); tr.appendChild(itemsCell);
      cell(tr, "KSh " + Number(order.total_amount).toFixed(2));
      cell(tr, String(order.pickup_date) + " — " + String(order.start_time).slice(0, 5) + "–" + String(order.end_time).slice(0, 5));
      const statusCell = cell(tr, order.status);
      statusCell.classList.add("admin-status", "status-" + String(order.status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      const paymentCell = cell(tr, order.payment_status);
      paymentCell.classList.add("admin-status", "status-" + String(order.payment_status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      if (order.customer_payment_reported_at) {
        const report = document.createElement("small");
        report.textContent = "Customer says they paid: " + new Date(order.customer_payment_reported_at).toLocaleString();
        paymentCell.append(document.createElement("br"), report);
      }
      const actions = document.createElement("td"); actions.className = "admin-actions";
      if (order.status === "CANCELLED" && activeSection === "cancelled-orders") {
        actions.appendChild(deleteCancelledOrderButton(order));
      } else if (order.status === "PAYMENT_PENDING" && order.payment_status === "PENDING") {
        actions.append(actionButton("Verify after Pochi check", "verify", order.id), actionButton("Reject payment", "reject", order.id));
      } else if (order.status === "PAYMENT_PENDING" && order.payment_status === "REJECTED") {
        actions.appendChild(actionButton("Cancel order", "cancel", order.id));
      } else if (order.payment_status === "VERIFIED" && order.status === "PREPARING") {
        actions.appendChild(actionButton("Mark ready", "ready", order.id));
      } else if (order.payment_status === "VERIFIED" && order.status === "READY") {
        actions.appendChild(actionButton("Mark collected", "collected", order.id));
      }
      if (!actions.childElementCount) actions.textContent = " - ";
      tr.appendChild(actions); tbody.appendChild(tr);
    });
  }
  function orderFilters() {
    const values = {};
    for (const key of ["order_number", "pickup_date", "order_status", "payment_status"]) {
      const value = String(new FormData(filters).get(key) || "").trim();
      if (value) values[key] = value;
    }
    return values;
  }
  async function fetchOrders() {
    const result = await call("admin_list_orders", orderFilters());
    if (authorized) renderOrders(Array.isArray(result.orders) ? result.orders : []);
  }
  async function loadOrders(event) {
    if (event) event.preventDefault();
    if (!authorized || busy) return;
    busy = true; say(msg, "Loading orders…"); tbody.replaceChildren();
    try { await fetchOrders(); if (authorized) say(msg, "Orders loaded.", "success"); }
    catch (error) { if (authorized) { renderOrders([]); say(msg, safeError(error, "Orders could not be loaded. Please retry."), "error"); } }
    finally { busy = false; }
  }
  async function loadDashboardSummary() {
    const result = await call("admin_dashboard_summary");
    $("summaryActive").textContent = String(result.active_orders);
    $("summaryPayment").textContent = String(result.awaiting_payment);
    $("summaryPreparing").textContent = String(result.preparing);
    $("summaryReady").textContent = String(result.ready_for_pickup);
  }
  async function runOrderAction(action, id, button) {
    if (!authorized || busy) return;
    const request = { order_id: id };
    let operation = action;
    if (action === "verify") {
      if (!confirm("Continue only after matching this order against actual Pochi la Biashara records. Has the payment been confirmed?")) return;
      operation = "verify_payment";
    } else if (action === "reject" || action === "cancel") {
      if (action === "cancel" && !confirm("Cancel this rejected order and release reserved pickup quantity? This does not issue a refund.")) return;
      const reason = prompt(action === "cancel" ? "Required cancellation reason:" : "Reject only after checking Pochi records. A delayed or unmatched payment should remain pending. Reason:");
      if (!reason || !reason.trim()) return;
      request.reason = reason.trim(); operation = action === "cancel" ? "cancel_order" : "reject_payment";
    } else {
      if (!confirm("Confirm order status change to " + action.toUpperCase() + "?")) return;
      request.next_status = action.toUpperCase(); operation = "advance_order";
    }
    busy = true; button.disabled = true; say(msg, "Saving action…");
    try { await call(operation, request); await refreshAfterSave(fetchOrders, "Action saved."); }
    catch (error) { button.disabled = false; say(msg, safeError(error, "The order action could not be completed. Refresh and retry."), "error"); }
    finally { busy = false; }
  }

  async function loadStore() {
    const { data, error } = await supabaseClient.from("site_settings")
      .select("is_open,opening_time,closing_time,closed_message,announcement").eq("id", 1).single();
    if (error) throw error;
    storeForm.elements.is_open.checked = data.is_open;
    storeForm.elements.opening_time.value = String(data.opening_time).slice(0, 5);
    storeForm.elements.closing_time.value = String(data.closing_time).slice(0, 5);
    storeForm.elements.closed_message.value = data.closed_message || "";
    storeForm.elements.announcement.value = data.announcement || "";
  }
  async function loadProducts() {
    const result = await call("admin_list_products");
    productsCache = Array.isArray(result.products) ? result.products : [];
    const list = $("productListAdmin"); list.replaceChildren();
    if (!productsCache.length) { const empty = document.createElement("li"); empty.textContent = "No products yet."; list.appendChild(empty); return; }
    productsCache.forEach(product => {
      const row = document.createElement("li"), label = document.createElement("span");
      const statusKey = ["available", "unavailable", "coming_soon"].includes(product.status) ? product.status : product.available === true ? "available" : "unavailable";
      label.textContent = product.name + " — " + (product.product_sizes || []).map(size => size.size_ml + " ml: KSh " + Number(size.price).toFixed(2) + (size.available === true ? "" : " (paused)")).join(", ");
      const status = document.createElement("span"); status.className = "product-admin-status product-status-badge product-status-" + statusKey.replace("_", "-");
      status.textContent = statusKey === "coming_soon" ? "Coming Soon" : statusKey === "unavailable" ? "Unavailable" : "Available";
      const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Edit"; edit.addEventListener("click", () => editProduct(product)); row.append(label, status);
      if (product.storefront_visible === false) { const hidden = document.createElement("span"); hidden.className = "product-admin-status"; hidden.textContent = "Hidden from storefront"; row.appendChild(hidden); }
      if (product.archived_at) { const archived = document.createElement("span"); archived.className = "product-admin-status"; archived.textContent = "Archived"; row.appendChild(archived); }
      row.appendChild(edit);
      if (!product.archived_at) { const archive = document.createElement("button"); archive.type = "button"; archive.textContent = "Archive"; archive.addEventListener("click", () => archiveProduct(product)); row.appendChild(archive); }
      list.appendChild(row);
    });
  }
  async function loadCleanupPreview() {
    if (cleanupPreviewBusy) return;
    cleanupPreviewBusy = true;
    cleanupButton.disabled = true;
    cleanupRetryButton.disabled = true;
    cleanupButton.dataset.count = "";
    say(cleanupMessage, "Checking cancelled orders…");
    try {
      const result = await call("admin_cleanup_preview");
      const count = Number(result?.count);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid cleanup preview response.");
      cleanupButton.disabled = count === 0;
      cleanupButton.dataset.count = String(count);
      say(cleanupMessage, count
        ? `${count} cancelled order${count === 1 ? "" : "s"} can be archived.`
        : "There are no cancelled orders to archive.", count ? "success" : "");
    } finally {
      cleanupPreviewBusy = false;
      cleanupRetryButton.disabled = false;
    }
  }
  function showProductImage(url) {
    if (productImagePreview.dataset.objectUrl) URL.revokeObjectURL(productImagePreview.dataset.objectUrl);
    delete productImagePreview.dataset.objectUrl;
    productImagePreview.src = url || "";
    productImagePreview.hidden = !url;
    productImagePreviewEmpty.hidden = Boolean(url);
    productImagePreviewEmpty.textContent = "No photo selected.";
  }
  productImageInput.addEventListener("change", () => {
    const file = productImageInput.files?.[0];
    if (!file) { showProductImage(productForm.elements.image_url.value); return; }
    if (!new Set(["image/webp", "image/jpeg", "image/png"]).has(file.type) || file.size > 5 * 1024 * 1024) {
      productImageInput.value = "";
      say(msg, "Choose a WebP, JPEG, or PNG image no larger than 5 MB.", "error");
      return;
    }
    showProductImage("");
    const previewUrl = URL.createObjectURL(file);
    productImagePreview.src = previewUrl;
    productImagePreview.dataset.objectUrl = previewUrl;
    productImagePreview.hidden = false;
    productImagePreviewEmpty.hidden = true;
  });
  productForm.elements.image_url.addEventListener("input", () => {
    if (!productImageInput.files?.length) showProductImage(productForm.elements.image_url.value.trim());
  });
  let productAssetsDirectory = null;
  productAssetsButton?.addEventListener("click", async () => {
    if (typeof window.showDirectoryPicker !== "function") {
      productAssetsStatus.textContent = "This browser cannot grant folder access. Uploaded photos will still be saved in Supabase; a local copy can be downloaded.";
      return;
    }
    try {
      const directory = await window.showDirectoryPicker({ id: "peak-fresh-product-assets", mode: "readwrite" });
      if (directory.name.toLowerCase() !== "assets") {
        productAssetsStatus.textContent = "Choose the project's src/assets folder.";
        return;
      }
      productAssetsDirectory = directory;
      productAssetsStatus.textContent = "Project assets folder connected for this admin session.";
    } catch (error) {
      if (error?.name !== "AbortError") productAssetsStatus.textContent = "Folder access was not granted. Supabase image uploads remain available.";
    }
  });
  function downloadProductAsset(blob, fileName) {
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = fileName; anchor.hidden = true;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveProductAssetCopy(blob, fileName) {
    if (!productAssetsDirectory) {
      downloadProductAsset(blob, fileName);
      productAssetsStatus.textContent = "Local folder was not connected; a copy was downloaded. Move it into src/assets.";
      return false;
    }
    try {
      const fileHandle = await productAssetsDirectory.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob); await writable.close();
      productAssetsStatus.textContent = fileName + " saved in the connected src/assets folder.";
      return true;
    } catch {
      downloadProductAsset(blob, fileName);
      productAssetsStatus.textContent = "Could not write to src/assets; a copy was downloaded instead.";
      return false;
    }
  }
  async function prepareProductImage(file) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image processing is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.84));
      if (!blob || blob.type !== "image/webp" || blob.size > 3_000_000) throw new Error("Image could not be prepared.");
      return blob;
    } catch {
      throw new Error("The photo could not be prepared. Try a different WebP, JPEG, or PNG image.");
    }
  }
  cleanupRetryButton.addEventListener("click", async () => {
    if (!authorized) return;
    try { await loadCleanupPreview(); }
    catch (error) { say(cleanupMessage, await previewFailureMessage(error), "error"); }
  });
  function renderProductSizeAvailability() {
    if (!productSizeAvailability) return;
    const sizes = parseSizes(productForm.elements.sizes.value);
    productSizeAvailability.replaceChildren();
    if (!sizes.length) { const note = document.createElement("p"); note.textContent = "Enter sizes to manage their individual order availability."; productSizeAvailability.appendChild(note); return; }
    sizes.forEach(size => {
      const label = document.createElement("label"); label.className = "admin-checkbox product-size-availability-option";
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = productSizeAvailabilityByMl.get(size.size_ml) !== false;
      input.addEventListener("change", () => productSizeAvailabilityByMl.set(size.size_ml, input.checked));
      const text = document.createElement("span"); text.textContent = size.size_ml + " ml can be ordered";
      label.append(input, text); productSizeAvailability.appendChild(label);
    });
  }
  productForm.elements.sizes.addEventListener("input", () => {
    try { renderProductSizeAvailability(); }
    catch { productSizeAvailability.replaceChildren(); const note = document.createElement("p"); note.textContent = "Use valid millilitres=price pairs to manage size availability."; productSizeAvailability.appendChild(note); }
  });
  async function editProduct(product) {
    productForm.elements.product_id.value = product.id;
    productForm.elements.name.value = product.name || "";
    productForm.elements.description.value = product.description || "";
    productForm.elements.ingredients.value = product.ingredients || "";
    productForm.elements.image_url.value = product.image_url || "";
    productImageInput.value = ""; showProductImage(product.image_url || "");
    productForm.elements.status.value = ["available", "unavailable", "coming_soon"].includes(product.status) ? product.status : product.available === true ? "available" : "unavailable";
    productForm.elements.storefront_visible.checked = product.storefront_visible !== false;
    productForm.elements.featured.checked = product.featured === true;
    productSizeAvailabilityByMl.clear(); (product.product_sizes || []).forEach(size => productSizeAvailabilityByMl.set(Number(size.size_ml), size.available === true));
    productForm.elements.sizes.value = (product.product_sizes || []).map(size => size.size_ml + "=" + size.price).join(", ");
    renderProductSizeAvailability(); productForm.scrollIntoView({ behavior: "smooth", block: "center" }); productForm.elements.name.focus();
  }
  function resetProduct() {
    productForm.reset(); productForm.elements.product_id.value = ""; productForm.elements.status.value = "available"; productForm.elements.storefront_visible.checked = true;
    productSizeAvailabilityByMl.clear(); showProductImage(""); renderProductSizeAvailability();
  }
  function savedProductMatches(product, attempted) {
    const sameText = (left, right) => String(left || "").trim() === String(right || "").trim();
    if (!product || product.id !== attempted.product_id || product.archived_at ||
        !sameText(product.name, attempted.product.name) || !sameText(product.description, attempted.product.description) ||
        !sameText(product.ingredients, attempted.product.ingredients) || !sameText(product.image_url, attempted.product.image_url) ||
        product.status !== attempted.product.status || product.storefront_visible !== attempted.product.storefront_visible ||
        product.available !== attempted.product.available || product.featured !== attempted.product.featured) return false;
    const currentSizes = product.product_sizes || [];
    return attempted.sizes.every(size => {
      const saved = currentSizes.find(item => Number(item.size_ml) === Number(size.size_ml));
      return saved && Number(saved.price) === Number(size.price) && saved.available === size.available;
    });
  }
  function parseSizes(value) {
    const pairs = value.split(",").map(item => item.trim()).filter(Boolean);
    if (!pairs.length) throw new Error("Add at least one size and price, such as 200=40.");
    const sizes = pairs.map(pair => {
      const match = pair.match(/^(\d{1,4})\s*=\s*(\d{1,6}(?:\.\d{1,2})?)$/);
      if (!match) throw new Error("Use millilitres=price pairs, separated by commas.");
      const sizeMl = Number(match[1]); return { size_ml: sizeMl, price: match[2], available: productSizeAvailabilityByMl.get(sizeMl) !== false };
    });
    if (new Set(sizes.map(size => size.size_ml)).size !== sizes.length) throw new Error("Each size may appear only once.");
    if (sizes.some(size => size.size_ml < 1 || size.size_ml > 5000 || Number(size.price) > 999999)) throw new Error("Sizes must be 1–5000 ml and prices must not exceed KSh 999,999.");
    return sizes;
  }
  async function archiveProduct(product) {
    if (managerBusy || !confirm("Archive “" + product.name + "”? Existing order history will stay intact.")) return;
    managerBusy = true;
    try { await call("admin_archive_product", { product_id: product.id }); await refreshAfterSave(loadProducts, "Product archived."); }
    catch (error) { say(msg, safeError(error, "Product could not be archived. Please retry.", "Product management is not enabled on the server yet."), "error"); }
    finally { managerBusy = false; }
  }
  async function loadMembers() {
    const result = await call("admin_list_members");
    const list = $("adminMembersList"); list.replaceChildren();
    const members = Array.isArray(result.members) ? result.members : [];
    if (!members.length) { const empty = document.createElement("li"); empty.textContent = "No administrator accounts are currently listed."; list.appendChild(empty); return; }
    members.forEach(member => {
      const row = document.createElement("li"), label = document.createElement("span");
      label.textContent = member.email + " — " + member.role + " — " + member.user_id;
      const revoke = document.createElement("button"); revoke.type = "button"; revoke.textContent = "Revoke";
      revoke.addEventListener("click", async () => {
        if (managerBusy || !confirm("Revoke admin access for " + member.email + "?")) return;
        managerBusy = true;
        try { await call("admin_manage_member", { target_user_id: member.user_id, member_action: "revoke" }); await refreshAfterSave(loadMembers, "Admin access revoked."); }
        catch (error) { say(msg, safeError(error, "Admin access could not be revoked. Please retry.", "Admin management is not enabled on the server yet."), "error"); }
        finally { managerBusy = false; }
      });
      row.append(label, revoke); list.appendChild(row);
    });
  }
  async function loadManagement() {
    try { await loadDashboardSummary(); } catch { say(msg, "Dashboard totals could not be loaded. Please refresh and retry.", "error"); }
    try { await loadStore(); } catch { say(msg, "Store settings could not be loaded. Please refresh and retry.", "error"); }
    try { await loadProducts(); } catch (error) { say(msg, safeError(error, "Products could not be loaded. No changes were made.", "Product management is not enabled on the server yet."), "error"); }
    try { await loadMembers(); } catch (error) { say(msg, safeError(error, "Admin access list could not be loaded. No changes were made.", "Admin management is not enabled on the server yet."), "error"); }
    try { await loadCleanupPreview(); } catch (error) {
      cleanupButton.disabled = true;
      say(cleanupMessage, await previewFailureMessage(error), "error");
    }
  }

  $("refreshArchivedOrders").addEventListener("click", () => { if (authorized) void loadArchivedOrders(); });
  $("refreshSummary").addEventListener("click", async () => {
    try { await loadDashboardSummary(); say(msg, "Dashboard totals refreshed.", "success"); }
    catch { say(msg, "Dashboard totals could not be refreshed. Please retry.", "error"); }
  });
  const sidebar = $("adminSidebar"), sidebarNav = $("adminSidebarNav"), shell = dashboard, sidebarToggle = $("sidebarToggle");
  let activeSection = "";
  function setActiveNav(section) {
    sidebarNav.querySelectorAll("[data-section]").forEach(link => {
      const active = link.dataset.section === section;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    const activeLink = sidebarNav.querySelector("[data-section=\"" + section + "\"]");
    if (activeLink) $("dashboardTitle").textContent = activeLink.querySelector(".sidebar-label").textContent;
  }
  function showView(view) {
    const views = [...dashboard.querySelectorAll(".admin-view")];
    if (!views.some(section => section.id === view)) view = "overview";
    views.forEach(section => { section.hidden = section.id !== view; });
  }
  function navigate(link, refreshOrders = true) {
    if (!link) return;
    const section = link.dataset.section;
    const changed = section !== activeSection;
    showView(link.dataset.view);
    setActiveNav(section);
    if (refreshOrders && changed && (section === "cancelled-orders" || section === "orders" || section === "order-management")) {
      if (section === "cancelled-orders") {
        filters.elements.order_status.value = "CANCELLED";
        filters.elements.order_number.value = "";
        filters.elements.pickup_date.value = "";
        filters.elements.payment_status.value = "";
      } else filters.elements.order_status.value = "";
      void loadOrders();
    }
    activeSection = section;
    if (matchMedia("(max-width: 760px)").matches) {
      shell.classList.remove("mobile-nav-open");
      sidebarToggle.setAttribute("aria-expanded", "false");
      sidebarToggle.setAttribute("aria-label", "Open navigation");
    }
  }
  function navigateFromHash(refreshOrders = true) {
    const key = decodeURIComponent(location.hash.slice(1));
    const link = key && [...sidebarNav.querySelectorAll("a[data-section]")].find(item => item.getAttribute("href") === "#" + key);
    navigate(link || sidebarNav.querySelector('[data-section="overview"]'), refreshOrders);
  }
  sidebarToggle.addEventListener("click", () => {
    if (matchMedia("(max-width: 760px)").matches) {
      const open = shell.classList.toggle("mobile-nav-open");
      sidebarToggle.setAttribute("aria-expanded", String(open));
      sidebarToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    } else {
      const collapsed = shell.classList.toggle("is-collapsed");
      sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      sidebarToggle.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
    }
  });
  window.addEventListener("hashchange", navigateFromHash);
  sidebarNav.addEventListener("click", event => {
    const link = event.target.closest("a[data-section]");
    if (link) navigate(link);
  });
  document.addEventListener("click", event => {
    if (matchMedia("(max-width: 760px)").matches && shell.classList.contains("mobile-nav-open") &&
        !sidebar.contains(event.target) && !sidebarToggle.contains(event.target)) {
      shell.classList.remove("mobile-nav-open");
      sidebarToggle.setAttribute("aria-expanded", "false");
      sidebarToggle.setAttribute("aria-label", "Open navigation");
    }
  });

  async function loadArchivedOrders() {
    const list = $("archivedOrdersBody"), status = $("archiveMessage");
    list.replaceChildren(); status.textContent = "Loading archived orders…";
    try {
      const result = await call("admin_list_archived_orders");
      const rows = Array.isArray(result?.orders) ? result.orders : [];
      if (!rows.length) {
        status.textContent = "No archived orders yet.";
        const tr = document.createElement("tr"), td = cell(tr, "Archived orders will appear here after cancelled orders are archived.");
        td.colSpan = 7; list.appendChild(tr); return;
      }
      status.textContent = rows.length === 100 ? "Showing the 100 most recently archived orders." :
        String(rows.length) + " archived order" + (rows.length === 1 ? "." : "s.");
      rows.forEach(order => {
        const tr = document.createElement("tr"); cell(tr, "PF-" + String(order.order_number).padStart(4, "0"));
        cell(tr, [order.customer_name, order.customer_phone].filter(Boolean).join(" — ") || "Customer details unavailable");
        const itemCell = document.createElement("td"), items = document.createElement("ul"); items.className = "order-items-list";
        (order.order_items || []).forEach(item => {
          const li = document.createElement("li");
          const product = Array.isArray(item.products) ? item.products[0] : item.products;
          const size = Array.isArray(item.product_sizes) ? item.product_sizes[0] : item.product_sizes;
          li.textContent = String(item.quantity) + " × " + (product?.name || "Smoothie") + (size?.size_ml ? " · " + size.size_ml + " ml" : "");
          items.appendChild(li);
        });
        itemCell.appendChild(items); tr.appendChild(itemCell);
        cell(tr, "KSh " + Number(order.total_amount || 0).toFixed(2));
        const slot = Array.isArray(order.pickup_slots) ? order.pickup_slots[0] : order.pickup_slots;
        cell(tr, [slot?.pickup_date, slot?.start_time && String(slot.start_time).slice(0, 5), slot?.end_time && String(slot.end_time).slice(0, 5)].filter(Boolean).join(" — "));
        const badge = cell(tr, order.status);
        badge.classList.add("admin-status", "status-" + String(order.status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        cell(tr, order.archived_at ? new Date(order.archived_at).toLocaleString() : "—"); list.appendChild(tr);
      });
    } catch (error) {
      const response = await responsePayload(error);
      const missingAction = responseStatus(error) === 400 && response?.error === "Unknown action.";
      const message = missingAction
        ? "The deployed Peak Fresh operations function does not support archived-order listing yet. The local function includes this action; deployment is required before this page can load."
        : safeError(error, response?.error || "Archived orders could not be loaded. Please retry.", "The deployed operations function could not load archived orders.");
      status.textContent = message;
    }
  }

  async function authorize(session) {
    const currentEpoch = ++epoch; authorized = false; hide();
    if (!session?.access_token || !session?.user?.id) { loggedOut(); return; }
    checking.hidden = false;
    try {
      const result = await call("admin_access");
      if (currentEpoch !== epoch) return;
      if (result?.authorized !== true) { hide(); denied.hidden = false; return; }
      authorized = true; hide(); dashboard.hidden = false;
      $("adminProfileName").textContent = String(session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || "Administrator");
      $("adminProfileEmail").textContent = session.user.email || "Signed in";
      activeSection = "";
      navigateFromHash(false);
      await Promise.all([loadOrders(), loadManagement(), loadArchivedOrders()]);
    } catch (error) {
      if (currentEpoch !== epoch) return;
      hide(); denied.hidden = false;
      $("deniedMessage").textContent = error?.context?.status === 403
        ? "This signed-in account is not authorized to manage orders."
        : "We could not confirm admin access. Check your connection and try again.";
      console.error("Peak Fresh admin access check failed; HTTP status:", responseStatus(error) || "unavailable");
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !form.reportValidity()) return;
    busy = true; const button = form.querySelector('[type="submit"]'); button.disabled = google.disabled = true;
    say(signMsg, "Signing in…");
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: form.elements.email.value.trim(), password: form.elements.password.value
      });
      if (error) throw error;
      if (data.session) await authorize(data.session);
    } catch (error) { say(signMsg, error.message || "Sign in failed. Check your details and try again.", "error"); }
    finally { busy = false; button.disabled = google.disabled = false; }
  });
  google.addEventListener("click", async () => {
    if (busy) return; busy = true; google.disabled = form.querySelector('[type="submit"]').disabled = true;
    say(signMsg, "Connecting to Google…");
    try {
      const redirectTo = new URL(location.pathname, location.origin).toString();
      const { error } = await supabaseClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (error) throw error;
    } catch (error) { say(signMsg, error.message || "Google sign in could not be started.", "error"); busy = false; google.disabled = form.querySelector('[type="submit"]').disabled = false; }
  });
  $("adminForgotPassword").addEventListener("click", async event => {
    const email = form.elements.email.value.trim();
    if (!email || !form.elements.email.reportValidity()) {
      form.elements.email.focus();
      say(signMsg, "Enter your account email first.", "error");
      return;
    }
    event.currentTarget.disabled = true;
    try {
      const redirectTo = new URL("../index.html", location.href).toString();
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      say(signMsg, "If that email is registered, a password reset link has been sent.", "success");
    } catch (error) {
      say(signMsg, "The password reset request could not be completed. Please try again.", "error");
    } finally { event.currentTarget.disabled = false; }
  });
  async function signOut(button) {
    if (busy) return; busy = true; button.disabled = true; say(msg, "Signing out…");
    try { const { error } = await supabaseClient.auth.signOut({ scope: "local" }); if (error) throw error; location.replace("../index.html"); }
    catch { button.disabled = false; const target = button.id === "deniedSignOut" ? $("deniedMessage") : msg; say(target, "Could not sign out. You are still signed in; please retry.", "error"); }
    finally { busy = false; }
  }
  $("signOut").addEventListener("click", event => signOut(event.currentTarget));
  $("deniedSignOut").addEventListener("click", event => signOut(event.currentTarget));
  filters.addEventListener("submit", loadOrders);
  storeForm.addEventListener("submit", async event => {
    event.preventDefault(); if (!authorized || managerBusy || !storeForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(storeForm));
    managerBusy = true;
    try {
      await call("admin_update_store", { is_open: storeForm.elements.is_open.checked,
        opening_time: values.opening_time, closing_time: values.closing_time,
        closed_message: values.closed_message, announcement: values.announcement });
      say(msg, "Store settings saved.", "success");
    } catch (error) { say(msg, safeError(error, "Store settings were not saved. Please retry.", "Store controls are not enabled on the server yet."), "error"); }
    finally { managerBusy = false; }
  });
  productForm.addEventListener("submit", async event => {
    event.preventDefault(); if (!authorized || managerBusy || !productForm.reportValidity()) return;
    let sizes;
    try { sizes = parseSizes(productForm.elements.sizes.value); }
    catch (error) { say(msg, error.message, "error"); return; }
    managerBusy = true;
    let attemptedSave = null;
    try {
      const value = element => productForm.elements[element].value.trim();
      let imageUrl = value("image_url");
      const photo = productImageInput.files?.[0];
      let imageBlob = null;
      if (photo) {
        say(msg, "Preparing and uploading product photo…");

        try { imageBlob = await prepareProductImage(photo); }
        catch (error) {
          const preparationError = new Error(error instanceof Error ? error.message : "The product photo could not be prepared. Choose a supported image and retry.");
          preparationError.name = "ProductUploadError";
          throw preparationError;
        }
        const imagePayload = new FormData();
        imagePayload.append("file", imageBlob, "peak-fresh-product.webp");
        let upload;
        try {
          const result = await supabaseClient.functions.invoke("peak-fresh-product-image", { body: imagePayload });
          if (result.error) throw result.error;
          upload = result.data;
        } catch (error) {
          const uploadError = new Error(await productUploadFailure(error));
          uploadError.name = "ProductUploadError";
          throw uploadError;
        }
        if (upload?.ok !== true || typeof upload.url !== "string" || !upload.url.startsWith("https://") || typeof upload.path !== "string") {
          const uploadError = new Error("The photo upload response was incomplete. The product was not saved.");
          uploadError.name = "ProductUploadError";
          throw uploadError;
        }
        imageUrl = upload.url;
      }
      const productId = value("product_id") || null;
      const product = { name: value("name"), description: value("description"), ingredients: value("ingredients"),
        image_url: imageUrl, status: productForm.elements.status.value, storefront_visible: productForm.elements.storefront_visible.checked,
        available: productForm.elements.status.value === "available", featured: productForm.elements.featured.checked };
      attemptedSave = { product_id: productId, product, sizes };
      await call("admin_save_product", { product_id: productId, product, sizes });
      let savedLocally = null;
      if (photo && imageBlob) {
        const slug = value("name").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "smoothie";
        const localFileName = "product-" + slug + "-" + crypto.randomUUID().slice(0, 8) + ".webp";
        savedLocally = await saveProductAssetCopy(imageBlob, localFileName);
      }
      resetProduct();
      const productSavedMessage = photo
        ? savedLocally ? "Product and photo saved to Supabase; a copy was also saved in src/assets." : "Product saved to Supabase; the local copy was downloaded because src/assets was not writable." 
        : "Product saved.";
      await refreshAfterSave(loadProducts, productSavedMessage);
    } catch (error) {
      if (responseStatus(error) === 0 && attemptedSave?.product_id) {
        try {
          const result = await call("admin_list_products");
          const saved = (result.products || []).find(product => product.id === attemptedSave.product_id);
          if (savedProductMatches(saved, attemptedSave)) {
            resetProduct();
            await refreshAfterSave(loadProducts, "Product save confirmed in Supabase after a connection interruption.");
            return;
          }
        } catch { /* Keep the outcome explicitly unconfirmed below. */ }
      }
      say(msg, error instanceof Error && error.name === "ProductUploadError" ? error.message : await productSaveFailure(error), "error");
    }
    finally { managerBusy = false; }
  });
  $("resetProduct").addEventListener("click", resetProduct);
  cleanupButton.addEventListener("click", async () => {
    const count = Number(cleanupButton.dataset.count);
    if (!authorized || managerBusy || !Number.isSafeInteger(count) || count < 1) return;
    if (!confirm(`Archive ${count} cancelled order${count === 1 ? "" : "s"}? This hides them from the active order list but retains all order, item, payment-report and audit history. No records will be deleted.`)) return;
    managerBusy = true; cleanupButton.disabled = true;
    try {
      const result = await call("admin_archive_cancelled_orders", { expected_count: count });
      const success = `${Number(result?.archived_count) || 0} cancelled order(s) archived. Order history was retained.`;
      await refreshAfterSave(async () => { await Promise.all([fetchOrders(), loadCleanupPreview()]); }, success);
    } catch (error) {
      cleanupButton.disabled = false;
      const response = await responsePayload(error);
      if (response?.code === "archive_preview_stale") {
        try {
          await loadCleanupPreview();
          const refreshedCount = Number(cleanupButton.dataset.count || 0);
          say(cleanupMessage, refreshedCount
            ? `The preview changed. It now shows ${refreshedCount} cancelled order${refreshedCount === 1 ? "" : "s"}. Review it and confirm again.`
            : "The preview changed and has been refreshed. There are no cancelled orders to archive.", "error");
        } catch {
          say(cleanupMessage, "The preview changed, but the latest count could not be loaded. Refresh the preview before trying again.", "error");
        }
      } else {
        say(cleanupMessage, safeError(error, response?.error || "Cancelled orders could not be archived. No records were deleted.", "Order cleanup is not enabled on the server yet."), "error");
      }
    } finally { managerBusy = false; }
  });
  memberForm.addEventListener("submit", async event => {
    event.preventDefault(); if (!authorized || managerBusy || !memberForm.reportValidity()) return;
    const id = memberForm.elements.target_user_id.value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      say(msg, "Enter a valid Supabase Auth user UUID.", "error"); return;
    }
    if (!confirm("Grant admin access to Auth user " + id + "? Verify this UUID in Supabase Authentication first.")) return;
    managerBusy = true;
    try { await call("admin_manage_member", { target_user_id: id, member_action: "grant" }); memberForm.reset(); await refreshAfterSave(loadMembers, "Admin access granted."); }
    catch (error) { say(msg, safeError(error, "Admin access was not granted. Please retry.", "Admin management is not enabled on the server yet."), "error"); }
    finally { managerBusy = false; }
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => { authEventSeen = true; void authorize(session); });
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (authEventSeen) return; if (error) throw error; return authorize(data.session);
  }).catch(error => { hide(); login.hidden = false; say(signMsg, error.message || "Could not retrieve your session. Please sign in again.", "error"); });
  const query = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (query.has("error") || hash.has("error")) setTimeout(() => {
    if (!authorized && !login.hidden) say(signMsg, "Google sign-in was cancelled or could not be completed. Please try again.", "error");
  }, 0);
});
