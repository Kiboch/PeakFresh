/* =========================================
   PEAK FRESH — REAL ORDER SYSTEM
   ========================================= */


window.addEventListener("peakfresh:auth-change", event => {
    if (event.detail?.user) return;
    const reportButton = document.querySelector(".report-payment");
    if (reportButton) {
        reportButton.disabled = true;
        reportButton.textContent = "Sign in again to report payment";
        const reportMessage = document.querySelector(".payment-report-message");
        if (reportMessage) reportMessage.textContent = "Sign in to this account again to report payment.";
    }
});

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    /* -----------------------------------------
       PRODUCT SELECTION
       ----------------------------------------- */

    const productList = document.querySelector("#productList");
    const storeNotice = document.querySelector("#storeNotice");
    const storeAnnouncement = document.querySelector("#storeAnnouncement");
    const storeClosedMessage = document.querySelector("#storeClosedMessage");
    let catalogProducts = [];
    let catalogLoadState = "loading";
    let catalogRequest = null;
    let storeCanAcceptOrders = false;
    let storeSettingsLoading = false;
    const formatKES = new Intl.NumberFormat("en-KE", {
        style: "currency", currency: "KES", minimumFractionDigits: 0, maximumFractionDigits: 2
    });

    function normalizeProductSize(size) {
        const rawPrice = size?.price;
        const priceValue = typeof rawPrice === "number" || (typeof rawPrice === "string" && rawPrice.trim() !== "")
            ? Number(rawPrice)
            : Number.NaN;
        const sizeMl = Number(size?.size_ml);
        return {
            ...size,
            size_ml: sizeMl,
            priceValue,
            orderable: typeof size?.id === "string" && size.id.length > 0 && size.available === true &&
                Number.isInteger(sizeMl) && sizeMl > 0 && Number.isFinite(priceValue) && priceValue >= 0
        };
    }

    function storeIsWithinHours(settings, localTime) {
        const opening = String(settings.opening_time || "").slice(0, 8);
        const closing = String(settings.closing_time || "").slice(0, 8);
        if (!/^\d{2}:\d{2}:\d{2}$/.test(opening) || !/^\d{2}:\d{2}:\d{2}$/.test(closing)) return false;
        return opening < closing
            ? localTime >= opening && localTime < closing
            : localTime >= opening || localTime < closing;
    }

    async function loadStoreSettings() {
        if (storeSettingsLoading) return;
        storeSettingsLoading = true;
        try {
            const { data, error } = await supabaseClient.from("site_settings")
                .select("is_open,opening_time,closing_time,closed_message,announcement")
                .eq("id", 1).single();
            if (error) throw error;
            const localTime = getKenyaLocalDateTime(new Date()).time;
            storeCanAcceptOrders = data.is_open === true && storeIsWithinHours(data, localTime);
            storeAnnouncement.textContent = data.announcement || "";
            storeAnnouncement.hidden = !data.announcement;
            storeClosedMessage.hidden = storeCanAcceptOrders;
            if (!storeCanAcceptOrders) {
                storeClosedMessage.textContent = data.closed_message || "We are currently closed. Please check back during opening hours.";
            }
            storeNotice.hidden = !data.announcement && storeCanAcceptOrders;
            if (!storeCanAcceptOrders) storeNotice.hidden = false;
            renderCatalog(catalogProducts);
        } catch (error) {
            console.error("Peak Fresh store settings could not be loaded:", error?.message || "unknown error");
            storeCanAcceptOrders = false;
            storeClosedMessage.textContent = "Ordering availability could not be confirmed. Please try again soon.";
            storeClosedMessage.hidden = false;
            storeNotice.hidden = false;
            renderCatalog(catalogProducts);
        } finally {
            storeSettingsLoading = false;
        }
    }

    function renderCatalogError() {
        productList.replaceChildren();
        const state = document.createElement("div");
        state.className = "catalog-error-state";
        state.setAttribute("role", "alert");
        const message = document.createElement("p");
        message.className = "catalog-message";
        message.textContent = "We couldn't load the live menu. Check your connection and try again.";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "btn catalog-retry";
        retry.textContent = "Retry menu";
        retry.setAttribute("aria-label", "Retry loading the menu");
        retry.addEventListener("click", () => { void loadCatalog(); });
        state.append(message, retry);
        productList.appendChild(state);
    }

    async function loadCatalog() {
        if (!productList || catalogRequest) return catalogRequest;
        catalogLoadState = "loading";
        productList.replaceChildren();
        const loading = document.createElement("p");
        loading.className = "catalog-message";
        loading.setAttribute("role", "status");
        loading.textContent = "Loading the current menu…";
        productList.appendChild(loading);
        catalogRequest = (async () => {
            try {
                const [productsResult, sizesResult] = await Promise.all([
                    supabaseClient.from("products")
                        .select("id,name,status,storefront_visible,description,ingredients,image_url,featured,archived_at")
                        .eq("storefront_visible", true).is("archived_at", null)
                        .order("featured", { ascending: false }).order("name"),
                    supabaseClient.from("product_sizes")
                        .select("id,product_id,size_ml,price,available")
                        .order("size_ml")
                ]);
                if (productsResult.error) throw productsResult.error;
                if (sizesResult.error) throw sizesResult.error;
                const sizesByProduct = new Map();
                (sizesResult.data || []).forEach(size => {
                    const sizes = sizesByProduct.get(size.product_id) || [];
                    sizes.push(size);
                    sizesByProduct.set(size.product_id, sizes);
                });
                catalogProducts = (productsResult.data || []).map(product => ({
                    ...product,
                    sizes: (sizesByProduct.get(product.id) || []).map(normalizeProductSize)
                }));
                catalogLoadState = "loaded";
                renderCatalog(catalogProducts);
            } catch (error) {
                console.error("Peak Fresh menu could not be loaded:", {
                    status: Number(error?.status) || "unavailable",
                    code: error?.code || "unavailable"
                });
                catalogLoadState = "error";
                renderCatalogError();
            } finally {
                catalogRequest = null;
            }
        })();
        return catalogRequest;
    }

    function renderCatalog(products) {
        if (!productList || (!products.length && catalogLoadState === "loading")) return;
        if (!products.length) {
            productList.replaceChildren();
            if (catalogLoadState === "error") { renderCatalogError(); return; }
            const message = document.createElement("p");
            message.className = "catalog-message";
            message.setAttribute("role", "status");
            message.textContent = "No smoothies are currently available.";
            productList.appendChild(message);
            return;
        }
        productList.replaceChildren();
        products.forEach(product => {
            const productStatus = ["available", "unavailable", "coming_soon"].includes(product.status)
                ? product.status : product.available === true ? "available" : "unavailable";
            const validSizes = product.sizes || [];
            const orderableSizes = validSizes.filter(size => size.orderable);
            const defaultSize = orderableSizes[0] || validSizes.find(size => Number.isFinite(size.priceValue)) || null;
            const canOrder = productStatus === "available" && product.storefront_visible !== false &&
                product.archived_at == null && storeCanAcceptOrders && orderableSizes.length > 0;
            const card = document.createElement("article");
            card.className = "product-card";
            card.dataset.cardProductId = product.id;
            card.dataset.productStatus = productStatus;
            if (orderableSizes[0]) card.dataset.selectedSizeId = orderableSizes[0].id;

            const imageWrap = document.createElement("div");
            imageWrap.className = "product-image";
            const image = document.createElement("img");
            const imageUrl = String(product.image_url || "");
            const safeImageUrl = imageUrl.startsWith("https://") || (imageUrl.startsWith("/") && !imageUrl.startsWith("//")) ||
                /^src\/assets\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(imageUrl);
            const fallbackImageUrl = "src/assets/smoothie.jpg";
            image.src = safeImageUrl ? imageUrl : fallbackImageUrl;
            image.alt = String(product.name || "Peak Fresh smoothie");
            image.loading = "lazy";
            image.decoding = "async";
            image.addEventListener("error", () => {
                if (!image.dataset.fallbackApplied && image.src !== new URL(fallbackImageUrl, document.baseURI).href) {
                    image.dataset.fallbackApplied = "true";
                    image.src = fallbackImageUrl;
                    return;
                }
                image.remove();
                imageWrap.classList.add("is-unavailable");
            });
            imageWrap.appendChild(image);

            const info = document.createElement("div");
            info.className = "product-info";
            const availability = document.createElement("p");
            availability.className = "available product-status-badge";
            if (productStatus === "coming_soon") {
                availability.classList.add("product-status-coming-soon");
                availability.textContent = "COMING SOON";
            } else if (productStatus === "unavailable" || orderableSizes.length === 0) {
                availability.classList.add("product-status-unavailable");
                availability.textContent = "CURRENTLY UNAVAILABLE";
            } else if (!storeCanAcceptOrders) {
                availability.classList.add("product-status-closed");
                availability.textContent = "STORE CLOSED";
            } else {
                availability.classList.add("product-status-available");
                availability.textContent = "AVAILABLE";
            }
            const title = document.createElement("h3");
            title.textContent = String(product.name || "Smoothie");
            const description = document.createElement("p");
            description.className = "product-description";
            description.textContent = String(product.description || product.ingredients || "Freshly prepared at Peak Fresh.");
            const currentPrice = document.createElement("p");
            currentPrice.className = "product-current-price";
            currentPrice.setAttribute("aria-live", "polite");
            const currentPriceLabel = document.createElement("span");
            currentPriceLabel.textContent = defaultSize ? "Selected price" : "Price";
            const currentPriceValue = document.createElement("strong");
            currentPriceValue.textContent = defaultSize && Number.isFinite(defaultSize.priceValue)
                ? formatKES.format(defaultSize.priceValue) : "Unavailable";
            currentPrice.append(currentPriceLabel, currentPriceValue);

            const sizes = document.createElement("div");
            sizes.className = "sizes";
            sizes.setAttribute("role", "group");
            sizes.setAttribute("aria-label", "Choose size for " + String(product.name || "this smoothie"));
            validSizes.forEach(size => {
                const choice = document.createElement("button");
                const selected = size.id === orderableSizes[0]?.id;
                choice.type = "button";
                choice.className = "size-option" + (selected ? " selected" : "");
                choice.dataset.sizeId = size.id;
                choice.setAttribute("aria-pressed", String(selected));
                choice.disabled = !size.orderable;
                if (!size.orderable) choice.classList.add("is-unavailable");
                const sizeText = document.createElement("span");
                sizeText.textContent = Number.isInteger(size.size_ml) && size.size_ml > 0 ? size.size_ml + " ml" : "Size unavailable";
                const price = document.createElement("strong");
                price.textContent = Number.isFinite(size.priceValue) ? formatKES.format(size.priceValue) : "Price unavailable";
                choice.append(sizeText, price);
                sizes.appendChild(choice);
            });
            if (!validSizes.length) {
                sizes.hidden = true;
                const noSize = document.createElement("p");
                noSize.className = "product-size-empty";
                noSize.textContent = "No sizes are currently listed.";
                info.append(noSize);
            }
            const order = document.createElement("button");
            order.type = "button";
            order.className = "btn order-btn";
            order.dataset.productId = product.id;
            order.textContent = productStatus === "coming_soon" ? "Coming soon" :
                productStatus === "unavailable" || orderableSizes.length === 0 ? "Currently unavailable" :
                    !storeCanAcceptOrders ? "Ordering closed" : "Order now";
            order.disabled = !canOrder;
            info.append(availability, title, description, currentPrice, sizes, order);
            card.append(imageWrap, info);
            productList.appendChild(card);
        });
    }
    function refreshCatalogVariantPrice(productId, size) {
        const card = Array.from(productList.querySelectorAll(".product-card"))
            .find(item => item.dataset.cardProductId === productId);
        if (!card) return;
        const button = Array.from(card.querySelectorAll(".size-option"))
            .find(item => item.dataset.sizeId === size.id);
        const buttonLabel = button?.querySelector("span");
        if (buttonLabel) buttonLabel.textContent = size.size_ml + " ml";
        const buttonPrice = button?.querySelector("strong");
        if (buttonPrice) buttonPrice.textContent = formatKES.format(size.priceValue);
        if (card.dataset.selectedSizeId === size.id) {
            const currentPrice = card.querySelector(".product-current-price strong");
            if (currentPrice) currentPrice.textContent = formatKES.format(size.priceValue);
        }
    }

    productList?.addEventListener("click", event => {
        const sizeButton = event.target.closest("[data-size-id]");
        if (sizeButton && !sizeButton.disabled) {
            const card = sizeButton.closest(".product-card");
            const product = catalogProducts.find(item => item.id === card?.dataset.cardProductId);
            const size = product?.sizes.find(item => item.id === sizeButton.dataset.sizeId && item.orderable);
            if (!card || !size) return;
            card.dataset.selectedSizeId = size.id;
            card.querySelectorAll(".size-option").forEach(button => {
                const selected = button === sizeButton;
                button.classList.toggle("selected", selected);
                button.setAttribute("aria-pressed", String(selected));
            });
            const priceValue = card.querySelector(".product-current-price strong");
            if (priceValue) priceValue.textContent = formatKES.format(size.priceValue);
            return;
        }
        const order = event.target.closest("[data-product-id]");
        if (!order || order.disabled) return;
        const card = order.closest(".product-card");
        const selectedProduct = catalogProducts.find(product => product.id === order.dataset.productId) || null;
        const selectedSize = selectedProduct?.sizes.find(size => size.id === card?.dataset.selectedSizeId && size.orderable) || null;
        const selectedStatus = selectedProduct?.status || (selectedProduct?.available === true ? "available" : "unavailable");
        if (selectedProduct && selectedStatus === "available" && selectedProduct.storefront_visible !== false && selectedSize) {
            openOrderModal(selectedProduct, selectedSize);
        }
    });

    if (!productList) {
        console.error("Peak Fresh: #productList was not found.");
        return;
    }

    void loadCatalog();
    void loadStoreSettings();
    // Store settings are database-backed; refresh after returning to the tab and periodically
    // so an admin opening/closing the store is reflected without a code edit or hard reload.
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void loadStoreSettings();
    });
    window.setInterval(() => void loadStoreSettings(), 60_000);

    function getKenyaLocalDateTime(date) {
        const parts = new Intl.DateTimeFormat("en-KE", {
            timeZone: "Africa/Nairobi",
            calendar: "gregory",
            numberingSystem: "latn",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).formatToParts(date);

        const local = {};
        parts.forEach(({ type, value }) => {
            if (type !== "literal") local[type] = value;
        });

        return {
            date: `${local.year}-${local.month}-${local.day}`,
            time: `${local.hour}:${local.minute}:${local.second}`
        };
    }

    async function openOrderModal(selectedProduct, initialSize) {

        let selectedSize = initialSize;

        const existingModal = document.querySelector(".order-modal");

        if (existingModal) {
            return;
        }

        const modal = document.createElement("div");

        modal.className = "order-modal";

        modal.innerHTML = `
            <div class="order-box">

                <button
                    type="button"
                    class="close-order"
                    aria-label="Close order form"
                >
                    &times;
                </button>

                <p class="eyebrow">PEAK FRESH</p>

                <h2>Order <span class="order-product-name">smoothie</span></h2>

                <p class="order-subtitle">
                    Choose your size and quantity.
                </p>

                <form id="orderForm">

                    <label for="orderSize">
                        Size
                    </label>

                    <select id="orderSize" name="product_size_id" required></select>

                    <label for="orderQuantity">
                        Quantity
                    </label>

                    <select id="orderQuantity" name="quantity" required>

                        <option value="1">
                            1 smoothie
                        </option>

                        <option value="2">
                            2 smoothies
                        </option>

                        <option value="3">
                            3 smoothies
                        </option>

                    </select>

                    <div class="order-total">
                        <span>Total</span>

                        <strong id="totalPrice">
                            ${formatKES.format(selectedSize.priceValue)}
                        </strong>
                    </div>

                    <!-- Pickup slot section -->
                    <div id="pickupSection" hidden>

                        <label for="pickupSlot">
                            Pickup time
                        </label>

                        <select id="pickupSlot" name="pickup_slot_id" required disabled>
                            <option value="">
                                Loading pickup times...
                            </option>
                        </select>

                    </div>

                    <p
                        id="orderMessage"
                        class="order-message"
                        aria-live="polite"
                    ></p>

                    <button
                        type="submit"
                        class="btn confirm-order"
                        id="confirmOrderButton"
                    >
                        Continue
                    </button>

                </form>

            </div>
        `;

        document.body.appendChild(modal);
        document.body.classList.add("modal-open");

        /* -----------------------------------------
           GET MODAL ELEMENTS
           ----------------------------------------- */

        const sizeSelect =
            modal.querySelector("#orderSize");

        const quantitySelect =
            modal.querySelector("#orderQuantity");

        const totalPrice =
            modal.querySelector("#totalPrice");

        const closeButton =
            modal.querySelector(".close-order");

        const form =
            modal.querySelector("#orderForm");

        const pickupSection =
            modal.querySelector("#pickupSection");

        const pickupSlot =
            modal.querySelector("#pickupSlot");

        const orderMessage =
            modal.querySelector("#orderMessage");

        const confirmButton =
            modal.querySelector("#confirmOrderButton");


        modal.querySelector(".order-product-name").textContent = String(selectedProduct.name);
        selectedProduct.sizes.forEach(size => {
            const option = document.createElement("option");
            option.value = size.id;
            option.dataset.size = String(size.size_ml);
            option.textContent = size.orderable
                ? `${size.size_ml} ml — ${formatKES.format(size.priceValue)}`
                : `${Number.isInteger(size.size_ml) && size.size_ml > 0 ? size.size_ml + " ml" : "Size"} — Unavailable`;
            option.disabled = !size.orderable;
            sizeSelect.appendChild(option);
        });
        sizeSelect.value = selectedSize.id;


        /* -----------------------------------------
           UPDATE TOTAL
           ----------------------------------------- */

        function updateTotal() {
            const price = selectedSize?.priceValue;
            if (!selectedSize?.orderable || !Number.isFinite(price) || price < 0) {
                totalPrice.textContent = "Unavailable";
                confirmButton.disabled = true;
                orderMessage.textContent = "This size is unavailable. Choose another size to continue.";
                orderMessage.classList.add("error");
                return;
            }

            const quantity =
                Number(quantitySelect.value);

            const total =
                price * quantity;

            totalPrice.textContent = formatKES.format(total);
            confirmButton.disabled = false;
            orderMessage.textContent = "";
            orderMessage.className = "order-message";
        }


        /* -----------------------------------------
           SIZE CHANGE
           ----------------------------------------- */

        sizeSelect.addEventListener("change", () => {

            const selectedOption =
                sizeSelect.options[
                    sizeSelect.selectedIndex
                ];

            selectedSize = selectedProduct.sizes.find(size => size.id === selectedOption.value) || null;

            updateTotal();
        });


        /* -----------------------------------------
           QUANTITY CHANGE
           ----------------------------------------- */

        quantitySelect.addEventListener("change", () => {
            updateTotal();
        });


        /* -----------------------------------------
           CLOSE BUTTON
           ----------------------------------------- */

        closeButton.addEventListener("click", () => {
            closeOrderModal();
        });


        /* -----------------------------------------
           CLICK OUTSIDE POPUP
           ----------------------------------------- */

        modal.addEventListener("click", (event) => {

            if (event.target === modal) {
                closeOrderModal();
            }

        });


        /* -----------------------------------------
           FORM SUBMIT
           ----------------------------------------- */

        let submissionLocked = false;

        form.addEventListener("submit", async (event) => {

            event.preventDefault();

            if (submissionLocked) return;
            submissionLocked = true;
            confirmButton.disabled = true;

            const releaseSubmissionLock = (buttonText) => {
                submissionLocked = false;
                confirmButton.disabled = false;
                if (buttonText) confirmButton.textContent = buttonText;
            };

            orderMessage.textContent = "";
            orderMessage.className = "order-message";

            /* -----------------------------
               CHECK LOGIN
               ----------------------------- */

            let sessionData;
            let sessionError;
            try {
                ({ data: sessionData, error: sessionError } =
                    await supabaseClient.auth.getSession());
            } catch (error) {
                console.error("Peak Fresh session check error:", error);
                orderMessage.textContent =
                    "Unable to check your account. Please try again.";
                orderMessage.classList.add("error");
                releaseSubmissionLock();
                return;
            }

            if (sessionError) {

                orderMessage.textContent =
                    "Unable to check your account. Please try again.";

                orderMessage.classList.add("error");
                releaseSubmissionLock();

                return;
            }

            if (!sessionData.session) {

                orderMessage.textContent =
                    "Please login to your Peak Fresh account before placing an order.";

                orderMessage.classList.add("error");
                releaseSubmissionLock();

                return;
            }

            if (!storeCanAcceptOrders) {
                orderMessage.textContent = storeClosedMessage.textContent ||
                    "Ordering is currently unavailable. Please check back soon.";
                orderMessage.classList.add("error");
                releaseSubmissionLock(pickupSection.hidden ? "Continue" : "Place order");
                return;
            }


            /* -----------------------------
               FIRST CLICK:
               LOAD PICKUP SLOTS
               ----------------------------- */

            if (pickupSection.hidden) {
                const locationPoint = window.peakFreshOrderLocation;
                if (!locationPoint || typeof window.peakFreshCheckOrderLocation !== "function") {
                    orderMessage.textContent = "Use your current location to check whether ordering is available in your area.";
                    orderMessage.classList.add("error");
                    releaseSubmissionLock("Continue");
                    return;
                }
                const regionCheck = await window.peakFreshCheckOrderLocation();
                if (regionCheck.error) {
                    orderMessage.textContent = "Your location could not be checked. Please retry.";
                    orderMessage.classList.add("error");
                    releaseSubmissionLock("Continue");
                    return;
                }
                if (!regionCheck.allowed) {
                    orderMessage.textContent = "Not yet available in your region.";
                    orderMessage.classList.add("error");
                    releaseSubmissionLock("Continue");
                    return;
                }

                confirmButton.disabled = true;
                confirmButton.textContent = "Loading...";

                try {

                    const now = new Date();
                    const kenyaNow = getKenyaLocalDateTime(now);
                    const nowTimestamp = now.getTime();

                    const {
                        data: slots,
                        error: slotsError
                    } = await supabaseClient
                        .from("pickup_slots")
                        .select(`
                            id,
                            pickup_date,
                            start_time,
                            end_time,
                            capacity,
                            reserved_quantity,
                            order_cutoff,
                            available
                        `)
                        .eq("available", true)
                        .gte("pickup_date", kenyaNow.date)
                        .order("pickup_date", {
                            ascending: true
                        })
                        .order("start_time", {
                            ascending: true
                        });

                    if (slotsError) {
                        throw slotsError;
                    }

                    pickupSlot.innerHTML = "";

                    const eligibleSlots = (slots || []).filter((slot) => {
                        const capacity = Number(slot.capacity);
                        const reserved = Number(slot.reserved_quantity);
                        const pickupDate = String(slot.pickup_date || "");
                        const startTime = typeof slot.start_time === "string"
                            ? slot.start_time.slice(0, 8)
                            : "";

                        if (slot.available !== true ||
                            !Number.isFinite(capacity) ||
                            !Number.isFinite(reserved) ||
                            capacity - reserved <= 0 ||
                            !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) ||
                            !/^\d{2}:\d{2}:\d{2}$/.test(startTime) ||
                            pickupDate < kenyaNow.date) {
                            return false;
                        }

                        if (pickupDate === kenyaNow.date &&
                            startTime <= kenyaNow.time) {
                            return false;
                        }

                        if (slot.order_cutoff !== null &&
                            slot.order_cutoff !== undefined) {
                            const cutoffTimestamp = Date.parse(slot.order_cutoff);
                            if (!Number.isFinite(cutoffTimestamp) ||
                                cutoffTimestamp <= nowTimestamp) {
                                return false;
                            }
                        }

                        return true;
                    });

                    if (eligibleSlots.length === 0) {

                        pickupSlot.innerHTML = `
                            <option value="">
                                No pickup times are available
                            </option>
                        `;

                        pickupSection.hidden = false;

                        confirmButton.disabled = true;
                        confirmButton.textContent =
                            "No pickup times available";
                        submissionLocked = false;

                        orderMessage.textContent =
                            "No pickup times are currently available. Please check back soon.";

                        orderMessage.classList.add("error");

                        return;
                    }


                    /* -----------------------------
                       ADD AVAILABLE SLOTS
                       ----------------------------- */

                    eligibleSlots.forEach((slot) => {

                        const remaining =
                            slot.capacity -
                            slot.reserved_quantity;

                        const option =
                            document.createElement("option");

                        option.value = slot.id;

                        const date = new Date(`${slot.pickup_date}T12:00:00Z`);

                        const dateText =
                            date.toLocaleDateString(
                                "en-KE",
                                {
                                    weekday: "short",
                                    day: "numeric",
                                    month: "short",
                                    timeZone: "Africa/Nairobi"
                                }
                            );

                        const startTime =
                            slot.start_time.slice(0, 5);

                        const endTime =
                            slot.end_time.slice(0, 5);

                        option.textContent =
                            `${dateText} • ${startTime}–${endTime} (${remaining} left)`;

                        pickupSlot.appendChild(option);
                    });


                    /* -----------------------------
                       SHOW PICKUP
                       ----------------------------- */

                    pickupSlot.disabled = false;
                    pickupSection.hidden = false;

                    confirmButton.disabled = false;

                    confirmButton.textContent =
                        "Place order";
                    submissionLocked = false;

                    orderMessage.textContent =
                        "Choose your pickup time.";

                    orderMessage.classList.add("success");

                } catch (error) {

                    console.error(
                        "Peak Fresh pickup slot error:",
                        error
                    );

                    orderMessage.textContent =
                        "Could not load pickup slots. Please try again.";

                    orderMessage.classList.add("error");

                    releaseSubmissionLock("Continue");
                }

                return;
            }


            /* -----------------------------------------
               PLACE REAL ORDER
               ----------------------------------------- */

            const quantity =
                Number(quantitySelect.value);

            const selectedPickupSlot =
                pickupSlot.value;

            if (!selectedPickupSlot) {

                orderMessage.textContent =
                    "Please choose a pickup time.";

                orderMessage.classList.add("error");
                releaseSubmissionLock("Place order");

                return;
            }


            /* -----------------------------------------
               DISABLE BUTTON
               PREVENT DOUBLE SUBMISSION
               ----------------------------------------- */

            confirmButton.disabled = true;

            confirmButton.textContent =
                "Placing order...";


            try {

                /* -----------------------------
                   GET PRODUCT
                   ----------------------------- */

                const {
                    data: product,
                    error: productError
                } = await supabaseClient
                    .from("products")
                    .select("id,status,storefront_visible,archived_at")
                    .eq("id", selectedProduct.id)
                    .maybeSingle();

                if (productError) throw productError;
                if (!product || product.status !== "available" || product.storefront_visible !== true || product.archived_at) {
                    throw new Error("This smoothie is no longer available for ordering. Refresh the menu to see its current status.");
                }


                /* -----------------------------
                   GET PRODUCT SIZE
                   ----------------------------- */

                const {
                    data: productSize,
                    error: productSizeError
                } = await supabaseClient
                    .from("product_sizes")
                    .select(
                        "id, size_ml, price, available"
                    )
                    .eq(
                        "id",
                        selectedSize.id
                    )
                    .eq("product_id", product.id)
                    .maybeSingle();

                if (productSizeError) throw productSizeError;
                if (!productSize || productSize.available !== true) {
                    throw new Error("This smoothie size is currently unavailable. Choose another size or refresh the menu.");
                }

                const currentVariant = normalizeProductSize(productSize);
                if (!currentVariant.orderable) {
                    throw new Error("This smoothie size is currently unavailable. Choose another size or refresh the menu.");
                }
                if (currentVariant.priceValue !== selectedSize.priceValue || currentVariant.size_ml !== selectedSize.size_ml) {
                    selectedSize.price = productSize.price;
                    selectedSize.priceValue = currentVariant.priceValue;
                    selectedSize.size_ml = currentVariant.size_ml;
                    refreshCatalogVariantPrice(selectedProduct.id, selectedSize);
                    const selectedOption = sizeSelect.options[sizeSelect.selectedIndex];
                    if (selectedOption) {
                        selectedOption.textContent = `${selectedSize.size_ml} ml — ${formatKES.format(selectedSize.priceValue)}`;
                    }
                    updateTotal();
                    orderMessage.textContent = "The menu price changed. Review the updated total and submit again.";
                    orderMessage.classList.add("error");
                    releaseSubmissionLock("Place order");
                    return;
                }


                /* -----------------------------
                   SECURE DATABASE ORDER
                   ----------------------------- */

                const { data: activeSessionData, error: activeSessionError } = await supabaseClient.auth.getSession();
                if (activeSessionError || !activeSessionData.session ||
                    activeSessionData.session.user.id !== sessionData.session.user.id) {
                    throw new Error("Your sign-in changed before submission. Please sign in again; no order was submitted.");
                }

                

                const {
                    data: orderResult,
                    error: orderError
                } = await supabaseClient.rpc(
                    "create_peak_fresh_order",
                    {
                        p_product_size_id:
                            productSize.id,

                        p_quantity:
                            quantity,

                        p_pickup_slot_id: selectedPickupSlot, 
                        p_location_lat: window.peakFreshOrderLocation?.lat, 
                        p_location_lng: window.peakFreshOrderLocation?.lng
                    }
                );

                if (orderError) {
                    throw orderError;
                }


                /* --------------------------------
                   FUNCTION RETURNS ONE ROW
                   -------------------------------- */

                const order =
                    Array.isArray(orderResult)
                        ? orderResult[0]
                        : orderResult;
                if (!order) {
                    throw new Error(
                        "The order was created but no order information was returned."
                    );
                }


                /* --------------------------------
                   FORMAT CUSTOMER ORDER NUMBER
                   -------------------------------- */

                const orderNumber =
                    `PF-${String(
                        order.order_number
                    ).padStart(4, "0")}`;


                /* --------------------------------
   SUCCESS SCREEN
   -------------------------------- */

const finalTotal = Number(order.total_amount);
const finalQuantity = quantity;
const finalSize = Number(productSize.size_ml) || Number(selectedSize.size_ml);
let persistedPaymentStatus = null;
let persistedOrderStatus = null;
try {
    const { data: savedState, error: savedStateError } = await supabaseClient
        .from("orders")
        .select("status, payment_status")
        .eq("id", order.order_id)
        .single();
    if (!savedStateError && savedState) {
        persistedPaymentStatus = savedState.payment_status;
        persistedOrderStatus = savedState.status;
    }
} catch {
    console.warn("Peak Fresh order status could not be refreshed.");
}
const rawPaymentStatus = order.payment_status ?? order.paymentStatus ?? persistedPaymentStatus;
const rawOrderStatus = order.status ?? order.order_status ?? persistedOrderStatus;
const paymentStatus = rawPaymentStatus
    ? String(rawPaymentStatus).replace(/[_-]+/g, " ")
    : "Status unavailable";
const paymentExplanation = rawPaymentStatus === "PENDING" && rawOrderStatus === "PAYMENT_PENDING" ? "Your payment is awaiting manual admin verification." : rawPaymentStatus ? "Payment status returned by the order record." : "Payment status could not be retrieved.";

/* Find the selected pickup slot */
const selectedSlot =
    pickupSlot.options[pickupSlot.selectedIndex];

const selectedPickupText =
    selectedSlot ? selectedSlot.textContent : "Selected pickup slot";

modal.querySelector(".order-box").innerHTML = `

    <div class="order-success">

        <div class="success-icon">
            ✓
        </div>

        <p class="eyebrow">
            PEAK FRESH
        </p>

        <h2>
            Order sent successfully!
        </h2>

        <p class="order-subtitle">
            We've received your smoothie order.
            Please don't place it again.
        </p>

        <div class="order-success-card">

            <div class="success-row">
                <span>Order number</span>
                <strong>${orderNumber}</strong>
            </div>

            <div class="success-row">
                <span>Order</span>
                <strong>
                    ${finalQuantity} × ${finalSize} ml
                </strong>
            </div>

            <div class="success-row">
                <span>Total</span>
                <strong>
                    ${formatKES.format(finalTotal)}
                </strong>
            </div>

            <div class="success-row">
                <span>Pickup</span>
                <strong>
                    ${selectedPickupText}
                </strong>
            </div>

        </div>

        <section class="mpesa-payment" aria-labelledby="mpesa-heading">
            <h3 id="mpesa-heading">Pay by M-PESA — Pochi la Biashara</h3>
            <p>Merchant number <strong>0117543603</strong></p>
            <button type="button" class="btn copy-payment-number">Copy number</button>
            <ol>
                <li>Open M-PESA and choose Pochi la Biashara.</li>
                <li>Pay <strong>${formatKES.format(finalTotal)}</strong> to 0117543603.</li>
                <li>Keep your M-PESA confirmation message.</li>
            </ol>

            <button type="button" class="btn report-payment" data-order-id="${order.order_id}">I've placed my M-PESA payment</button>
            <p class="payment-report-message" role="status" aria-live="polite"></p>
        </section>
        <div class="order-status-box">

            <span class="status-dot"></span>

            <div>
                <strong>Payment: ${paymentStatus}</strong>

                <p>${paymentExplanation}</p>
            </div>

        </div>

        <p class="success-note">
            Keep your order number
            <strong>${orderNumber}</strong>
            for pickup and tracking.
        </p>

        <button
            type="button"
            class="btn close-success"
        >
            Done
        </button>

    </div>
`;


/* --------------------------------
   SUCCESS DONE BUTTON
   -------------------------------- */

const doneButton =
    modal.querySelector(".close-success");

doneButton.addEventListener(
    "click",
    closeOrderModal
);


const copyPaymentButton = modal.querySelector(".copy-payment-number");
copyPaymentButton.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText("0117543603");
        copyPaymentButton.textContent = "Number copied";
    } catch {
        copyPaymentButton.textContent = "Copy unavailable — 0117543603";
    }
});
const reportPaymentButton = modal.querySelector(".report-payment");
const reportPaymentMessage = modal.querySelector(".payment-report-message");
reportPaymentButton.addEventListener("click", async () => {
    if (reportPaymentButton.disabled) return;
    reportPaymentButton.disabled = true;
    reportPaymentButton.textContent = "Sending report...";
    try {
        const { data, error } = await supabaseClient.functions.invoke("peak-fresh-operations", {
            body: { action: "report_payment", order_id: order.order_id }
        });
        if (error) throw error;
        reportPaymentButton.textContent = "Payment reported";
        reportPaymentMessage.textContent = "Your report is recorded; payment is still awaiting manual admin verification.";
        const statusLine = modal.querySelector(".order-status-box p");
        if (statusLine) statusLine.textContent = "Customer reported payment. Awaiting manual admin verification.";
        reportPaymentButton.dataset.reportedAt = data?.reported_at || "";
    } catch (error) {
        console.error("Peak Fresh payment report error:", error?.message || "unknown error");
        reportPaymentButton.disabled = false;
        reportPaymentButton.textContent = "I've placed my M-PESA payment";
        reportPaymentMessage.textContent = "We couldn't record the report. Please try again. Payment has not been marked verified.";
    }
});
/* --------------------------------
   LOG SUCCESS
   -------------------------------- */



            } catch (error) {

                console.error(
                    "Peak Fresh order error:",
                    error
                );

                let message = error.message && error.message.includes("Your sign-in changed") ? error.message : "We could not place your order. Please try again.";

                if (error.message && error.message.includes("Not yet available in your region")) {
                    message = "Not yet available in your region.";
                }

                /* Friendly database errors */

                if (
                    error.message &&
                    error.message.includes(
                        "already have an active order"
                    )
                ) {
                    message =
                        "You already have an active order for this pickup slot.";
                }

                else if (
                    error.message &&
                    error.message.includes(
                        "not enough capacity"
                    )
                ) {
                    message =
                        "Sorry, that pickup slot just became full.";
                }

                else if (
                    error.message &&
                    error.message.includes(
                        "cutoff"
                    )
                ) {
                    message =
                        "The ordering cutoff for this pickup slot has passed.";
                }

                else if (
                    error.message &&
                    (error.message.includes("not available") || error.message.includes("unavailable"))
                ) {
                    message =
                        "Sorry, this smoothie or pickup slot is no longer available.";
                }

                orderMessage.textContent =
                    message;

                orderMessage.classList.add("error");

                releaseSubmissionLock("Place order");
            }

        });


        /* -----------------------------------------
           ESC KEY
           ----------------------------------------- */

        document.addEventListener(
            "keydown",
            handleEscape
        );

        function handleEscape(event) {

            if (event.key === "Escape") {
                closeOrderModal();
            }
        }


        /* -----------------------------------------
           CLOSE FUNCTION
           ----------------------------------------- */

        function closeOrderModal() {

            document.removeEventListener(
                "keydown",
                handleEscape
            );

            modal.remove();

            document.body.classList.remove(
                "modal-open"
            );
        }


        /* -----------------------------------------
           INITIAL TOTAL
           ----------------------------------------- */

        updateTotal();
    }
});
