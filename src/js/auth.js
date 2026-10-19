document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector("header nav");
    if (!nav || !window.supabase || !supabaseClient) return;

    const wrap = document.createElement("div");
    wrap.className = "account-control";
    nav.appendChild(wrap);

    const signIn = document.createElement("button");
    signIn.type = "button";
    signIn.className = "btn account-btn";
    signIn.textContent = "Sign in";

    const createAccount = document.createElement("button");
    createAccount.type = "button";
    createAccount.className = "auth-link account-create";
    createAccount.textContent = "Create account";

    const account = document.createElement("button");
    account.type = "button";
    account.className = "btn account-btn";
    account.textContent = "My account";
    account.setAttribute("aria-haspopup", "dialog");
    account.setAttribute("aria-expanded", "false");

    const modal = document.createElement("div");
    modal.className = "auth-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<section class="auth-box" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button type="button" class="auth-close" aria-label="Close">&times;</button><div class="auth-brand"><img src="src/assets/brand/peak-fresh-logo.svg" width="170" height="38" alt="Peak Fresh"></div><div class="auth-content"></div></section>';
    document.body.appendChild(modal);
    const content = modal.querySelector(".auth-content");
    const closeButton = modal.querySelector(".auth-close");

    let currentSession = null;
    let profileName = "";
    let mode = "login";
    let pending = false;
    let authEventSeen = false;
    let restoreFocus = null;

    function emitSession(session) {
        window.dispatchEvent(new CustomEvent("peakfresh:auth-change", {
            detail: { user: session?.user || null }
        }));
    }

    async function loadProfileName(userId) {
        try {
            const { data, error } = await supabaseClient.from("profiles")
                .select("display_name,full_name").eq("id", userId).maybeSingle();
            if (error || currentSession?.user?.id !== userId) return;
            profileName = String(data?.display_name || data?.full_name || "").trim();
            const metadataName = String(currentSession.user.user_metadata?.display_name || "").trim();
            const displayName = profileName || metadataName;
            account.textContent = displayName || "My account";
            account.setAttribute("aria-label", displayName ? "Account for " + displayName : "My account");
            if (mode === "account" && modal.classList.contains("active")) {
                const nameRow = content.querySelector(".name-row");
                if (nameRow) {
                    nameRow.hidden = !displayName;
                    content.querySelector(".account-name").textContent = displayName;
                }
            }
        } catch {
            // A profile is optional; "My account" remains a safe fallback.
        }
    }
    function setAccount(session) {
        currentSession = session || null;
        profileName = "";
        const user = currentSession?.user;
        wrap.replaceChildren();
        if (!user) {
            wrap.append(signIn, createAccount);
        } else {
            const name = String(user.user_metadata?.display_name || "").trim() || profileName;
            account.textContent = name || "My account";
            account.setAttribute("aria-label", name ? "Account for " + name : "My account");
            wrap.appendChild(account);
        }
        emitSession(currentSession);
        if (user) setTimeout(() => loadProfileName(user.id), 0);
    }

    function message(text, type = "") {
        const node = content.querySelector(".auth-message");
        if (node) {
            node.textContent = text;
            node.className = "auth-message" + (type ? " " + type : "");
        }
    }

    function setupProfileEditor() {
        const form = content.querySelector("#profileForm");
        const fileInput = form.elements.avatar;
        const preview = content.querySelector(".profile-avatar-preview");
        const placeholder = content.querySelector(".profile-avatar-placeholder");
        const userId = currentSession?.user?.id;
        let croppedImage = null;
        let previewUrl = "";
        let profileBusy = false;
        const safeErrorCode = error => String(error?.code || "");
        const profileErrorText = (error, stage) => {
            const code = safeErrorCode(error);
            const status = Number(error?.status || error?.statusCode || 0);
            const detail = String(error?.message || "").toLowerCase();
            if (stage === "upload" && (status === 404 || /bucket.*not found|not found.*bucket/.test(detail))) {
                return "Profile image storage is not set up yet. The pending Peak Fresh migration must be reviewed and applied first.";
            }
            if (status === 401 || status === 403 || code === "42501" || /row-level security|permission denied|not authorized/.test(detail)) {
                return "Supabase denied this profile change. Confirm you are signed in and that the approved profile and avatar Storage policies are active.";
            }
            if (stage === "session") return "Your sign-in could not be confirmed. Sign in again, then save your profile.";
            if (stage === "upload") return "The profile image could not be uploaded. Check your connection and the avatar Storage setup, then try again.";
            return "Your profile could not be saved. Check your connection and profile permissions, then try again.";
        };
        const logProfileDiagnostic = (stage, error) => {
            console.warn("Peak Fresh profile operation failed:", {
                stage,
                status: Number(error?.status || error?.statusCode || 0) || undefined,
                code: safeErrorCode(error) || undefined,
                name: String(error?.name || "Error")
            });
        };

        const showAvatar = url => {
            if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
            let displayUrl = url || "";
            if (displayUrl && !/^(blob:|data:)/i.test(displayUrl)) {
                try {
                    const cacheBusted = new URL(displayUrl, location.href);
                    cacheBusted.searchParams.set("pfv", String(Date.now()));
                    displayUrl = cacheBusted.href;
                } catch { /* Keep the stored URL if it is not a valid URL. */ }
            }
            previewUrl = displayUrl;
            if (url) {
                preview.src = displayUrl;
                preview.hidden = false;
                placeholder.hidden = true;
            } else {
                preview.removeAttribute("src");
                preview.hidden = true;
                placeholder.hidden = false;
            }
        };

        supabaseClient.from("profiles").select("display_name,full_name,avatar_url,avatar_storage_path")
            .eq("id", userId).maybeSingle().then(({ data, error }) => {
                if (currentSession?.user?.id !== userId || !form.isConnected) return;
                if (error) {
                    logProfileDiagnostic("load", error);
                    message("Your saved profile could not be loaded. You can still edit your display name; image saving also needs working profile access.", "error");
                    return;
                }
                const displayName = String(data?.display_name || data?.full_name || currentSession.user.user_metadata?.display_name || "");
                form.elements.display_name.value = displayName;
                if (data?.avatar_url && /^https:\/\//i.test(data.avatar_url)) showAvatar(data.avatar_url);
            }).catch(error => {
                if (!form.isConnected) return;
                logProfileDiagnostic("load", error);
                message("Your saved profile could not be loaded. Check your connection and try again.", "error");
            });

        fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            if (!new Set(["image/webp", "image/jpeg", "image/png"]).has(file.type) || file.size > 12 * 1024 * 1024) {
                message("Choose a WebP, JPEG, or PNG image smaller than 12 MB.", "error");
                fileInput.value = "";
                croppedImage = null;
                return;
            }
            message("Preparing your image…");
            let bitmap;
            try {
                if (typeof createImageBitmap !== "function") throw new Error("Image processing is unavailable in this browser.");
                bitmap = await createImageBitmap(file);
                const crop = Math.min(bitmap.width, bitmap.height);
                const canvas = document.createElement("canvas");
                canvas.width = 512;
                canvas.height = 512;
                const context = canvas.getContext("2d", { alpha: false });
                if (!context) throw new Error("Image processing is unavailable in this browser.");
                context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, 512, 512);
                let quality = 0.84;
                let blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
                while (blob && blob.size > 1024 * 1024 && quality > 0.25) {
                    quality -= 0.1;
                    blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
                }
                if (!blob || blob.type !== "image/webp" || blob.size > 1024 * 1024) {
                    throw new Error("This browser could not prepare a small WebP profile image.");
                }
                croppedImage = blob;
                showAvatar(URL.createObjectURL(blob));
                message("Image preview ready. Save your profile to upload it.", "success");
            } catch (error) {
                croppedImage = null;
                showAvatar("");
                message(error.message || "The image could not be prepared.", "error");
            } finally {
                bitmap?.close?.();
            }
        });

        form.addEventListener("submit", async event => {
            event.preventDefault();
            if (profileBusy || !form.reportValidity()) return;
            const displayName = form.elements.display_name.value.trim();
            if (!displayName || displayName.length > 80) {
                message("Enter a display name of 1 to 80 characters.", "error");
                return;
            }
            profileBusy = true;
            const button = form.querySelector(".profile-save");
            button.disabled = true;
            button.textContent = "Saving…";
            let stage = "session";
            try {
                const { data: sessionResult, error: sessionError } = await supabaseClient.auth.getSession();
                if (sessionError) throw sessionError;
                if (!sessionResult?.session?.user?.id || sessionResult.session.user.id !== userId || currentSession?.user?.id !== userId) {
                    throw new Error("The active account changed or signed out.");
                }
                const updates = { display_name: displayName };
                if (croppedImage) {
                    if (!(croppedImage instanceof Blob) || croppedImage.type !== "image/webp" || croppedImage.size > 1024 * 1024) {
                        throw new Error("The prepared image is not a valid compressed WebP file.");
                    }
                    stage = "upload";
                    const path = userId + "/avatar.webp";
                    const { data: upload, error: uploadError } = await supabaseClient.storage
                        .from("peak-fresh-avatars").upload(path, croppedImage, {
                            contentType: "image/webp", upsert: true, cacheControl: "3600"
                        });
                    if (uploadError) throw uploadError;
                    if (!upload?.path || upload.path !== path) throw new Error("Storage did not return the expected avatar path.");
                    updates.avatar_storage_path = upload.path;
                    updates.avatar_url = supabaseClient.storage.from("peak-fresh-avatars").getPublicUrl(upload.path).data.publicUrl;
                }
                stage = "profile";
                let { data, error } = await supabaseClient.from("profiles").update(updates)
                    .eq("id", userId).select("id").maybeSingle();
                if (error) throw error;
                if (!data) {
                    const { error: insertError } = await supabaseClient.from("profiles").insert({ id: userId, ...updates });
                    if (insertError) throw insertError;
                }
                profileName = displayName;
                await loadProfileName(userId);
                if (croppedImage) {
                    const { data: saved, error: readError } = await supabaseClient.from("profiles")
                        .select("avatar_url,avatar_storage_path").eq("id", userId).maybeSingle();
                    if (readError) throw readError;
                    if (!saved?.avatar_url || saved.avatar_storage_path !== updates.avatar_storage_path) {
                        throw new Error("The saved avatar could not be confirmed on the profile.");
                    }
                    const savedPublicUrl = supabaseClient.storage.from("peak-fresh-avatars")
                        .getPublicUrl(saved.avatar_storage_path).data.publicUrl;
                    showAvatar(savedPublicUrl);
                    croppedImage = null;
                    fileInput.value = "";
                }
                message("Profile saved.", "success");
                const nameRow = content.querySelector(".name-row");
                if (nameRow) { nameRow.hidden = false; content.querySelector(".account-name").textContent = displayName; }
            } catch (error) {
                logProfileDiagnostic(stage, error);
                message(profileErrorText(error, stage), "error");
            } finally {
                profileBusy = false;
                if (button.isConnected) { button.disabled = false; button.textContent = "Save profile"; }
            }
        });

        content.querySelector(".delete-account-button").addEventListener("click", async event => {
            if (profileBusy) return;
            if (!confirm("Delete this Peak Fresh account? Completed order history is retained without your account link. Active orders must be completed or cancelled first.")) return;
            if (prompt('Type DELETE to confirm account deletion:') !== "DELETE") return;
            profileBusy = true;
            event.currentTarget.disabled = true;
            message("Preparing account deletion…");
            try {
                const { data, error } = await supabaseClient.functions.invoke("peak-fresh-operations", {
                    body: { action: "delete_account" }
                });
                if (error) throw error;
                if (data?.deleted !== true) throw new Error("The account was not deleted.");
                setAccount(null);
                close();
            } catch (error) {
                message(error.message || "Account deletion could not be completed.", "error");
                event.currentTarget.disabled = false;
                profileBusy = false;
            }
        });
    }

    async function loadAccountOrders() {
        const panel = content.querySelector(".account-orders");
        const list = panel?.querySelector(".account-order-list");
        const status = panel?.querySelector(".account-orders-status");
        if (!panel || !list || !status || !currentSession?.user?.id) return;
        status.textContent = "Loading your orders…";
        list.replaceChildren();
        try {
            const { data: result, error } = await supabaseClient.functions.invoke("peak-fresh-operations", {
                body: { action: "account_order_history" }
            });
            if (error) throw error;
            const orders = Array.isArray(result?.orders) ? result.orders : [];
            if (!orders.length) { status.textContent = "Your order history will appear here after your first order."; return; }
            status.textContent = orders.length === 25 ? "Your latest 25 orders" : orders.length + (orders.length === 1 ? " order" : " orders");
            orders.forEach(order => {
                const card = document.createElement("article"); card.className = "account-order-card";
                const head = document.createElement("div"); head.className = "account-order-head";
                const number = document.createElement("strong"); number.textContent = "PF-" + String(order.order_number).padStart(4, "0");
                const badge = document.createElement("span"); badge.className = "account-order-status status-" + String(order.status || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
                badge.textContent = String(order.status || "UNKNOWN").replaceAll("_", " "); head.append(number, badge);
                const details = document.createElement("p");
                details.textContent = (order.pickup_date ? new Date(order.pickup_date + "T12:00:00") : new Date(order.created_at)).toLocaleDateString() +
                    (order.start_time ? " · " + String(order.start_time).slice(0, 5) + (order.end_time ? "–" + String(order.end_time).slice(0, 5) : "") : "");
                const items = document.createElement("ul");
                (order.order_items || []).forEach(item => {
                    const entry = document.createElement("li"), size = Array.isArray(item.product_sizes) ? item.product_sizes[0] : item.product_sizes;
                    const product = Array.isArray(size?.products) ? size.products[0] : size?.products;
                    entry.textContent = item.quantity + " × " + (product?.name || "Smoothie") + (size?.size_ml ? " · " + size.size_ml + " ml" : "");
                    items.appendChild(entry);
                });
                const total = document.createElement("strong"); total.className = "account-order-total"; total.textContent = "KSh " + Number(order.total_amount || 0).toFixed(2);
                card.append(head, details, items, total); list.appendChild(card);
            });
        } catch (error) {
            console.error("Peak Fresh order history could not be loaded:", error?.message || "unknown error");
            status.textContent = "Order history is temporarily unavailable. Please try again later.";
        }
    }
    function render(nextMode, notice = "") {
        mode = nextMode;
        if (nextMode === "account") {
            content.innerHTML = '<h2 id="auth-title">Your account</h2><p>Your signed-in Peak Fresh account.</p><section class="account-orders" aria-labelledby="accountOrdersTitle"><h3 id="accountOrdersTitle">Your orders</h3><p class="account-orders-status" role="status" aria-live="polite">Loading your orders…</p><div class="account-order-list"></div></section><div class="profile-editor"><img class="profile-avatar-preview" alt="Profile photo preview" hidden><div class="profile-avatar-placeholder">Your profile photo</div><form id="profileForm"><label for="profileDisplayName">Display name</label><input id="profileDisplayName" name="display_name" maxlength="80" required><label for="profileAvatarFile">Profile photo</label><input id="profileAvatarFile" name="avatar" type="file" accept="image/webp,image/jpeg,image/png"><p class="profile-help">The image is center-cropped to a square and compressed before upload.</p><button type="submit" class="btn profile-save">Save profile</button></form></div><dl class="account-details"><div class="name-row"><dt>Name</dt><dd class="account-name"></dd></div><div><dt>Email</dt><dd class="account-email"></dd></div></dl><p class="auth-message" role="status" aria-live="polite"></p><button type="button" class="btn auth-submit sign-out-button">Sign out</button><button type="button" class="auth-link delete-account-button">Delete account</button>';
            const name = String(profileName || currentSession?.user?.user_metadata?.display_name || "").trim();
            content.querySelector(".name-row").hidden = !name;
            content.querySelector(".account-name").textContent = name;
            content.querySelector(".account-email").textContent = currentSession?.user?.email || "Email unavailable";
            content.querySelector(".sign-out-button").addEventListener("click", signOut);
            setupProfileEditor();
            void loadAccountOrders();
            requestAnimationFrame(() => content.querySelector(".sign-out-button")?.focus());
            return;
        }

        const titles = {
            login: ["Welcome back", "Sign in to continue your smoothie order."],
            signup: ["Create your account", "Create an account to place and track orders."],
            forgot: ["Reset your password", "We'll email you a password reset link."],
            reset: ["Choose a new password", "Enter a new password for your account."]
        };
        const [title, subtitle] = titles[nextMode] || titles.login;
        let fields = '<label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required>';
        let submitLabel = "Sign in";
        let links = "";

        if (nextMode === "signup") {
            fields = '<label for="auth-name">Name</label><input id="auth-name" name="name" autocomplete="name" maxlength="80" required>' + fields +
                '<label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" required><label for="auth-password-confirm">Confirm password</label><input id="auth-password-confirm" name="password_confirm" type="password" autocomplete="new-password" minlength="8" required><label class="auth-toggle"><input type="checkbox" data-toggle-password> Show password</label><label class="terms-accept"><input type="checkbox" name="terms_accepted" required><span>I have read and agree to the <a href="pages/terms.html" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a> and <a href="pages/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>';
            submitLabel = "Create account";
            links = '<button type="button" class="auth-link" data-mode="login">Already have an account? Sign in</button><div class="auth-oauth"><span>or</span><button type="button" class="btn google-auth-button" data-google-signin>Continue with Google</button></div>';
        } else if (nextMode === "login") {
            fields += '<label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" required><label class="auth-toggle"><input type="checkbox" data-toggle-password> Show password</label>';
            links = '<div class="auth-links"><button type="button" class="auth-link" data-mode="forgot">Forgot password?</button><button type="button" class="auth-link" data-mode="signup">Create account</button></div><div class="auth-oauth"><span>or</span><button type="button" class="btn google-auth-button" data-google-signin>Continue with Google</button></div>';
        } else if (nextMode === "forgot") {
            submitLabel = "Send reset link";
            links = '<button type="button" class="auth-link" data-mode="login">Back to sign in</button>';
        } else if (nextMode === "reset") {
            fields = '<label for="auth-password">New password</label><input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" required><label for="auth-password-confirm">Confirm new password</label><input id="auth-password-confirm" name="password_confirm" type="password" autocomplete="new-password" minlength="8" required><label class="auth-toggle"><input type="checkbox" data-toggle-password> Show password</label>';
            submitLabel = "Update password";
        }

        const policyLinks = nextMode === "signup" ? "" : '<p class="auth-policy-links"><a href="pages/terms.html" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a> · <a href="pages/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a></p>';
        content.innerHTML = '<h2 id="auth-title">' + title + '</h2><p>' + subtitle + '</p><form id="auth-form" novalidate>' +
            fields + '<button type="submit" class="btn auth-submit">' + submitLabel +
            '</button></form><p class="auth-message" role="status" aria-live="polite">' + notice + '</p>' + policyLinks + links;
        const first = content.querySelector("input");
        if (first) requestAnimationFrame(() => first.focus());
    }

    function open(modeToOpen, notice = "") {
        restoreFocus = document.activeElement;
        render(modeToOpen);
        if (notice) message(notice, "error");
        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
        account.setAttribute("aria-expanded", modeToOpen === "account" ? "true" : "false");
    }

    function close() {
        modal.classList.remove("active");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
        account.setAttribute("aria-expanded", "false");
        if (restoreFocus?.isConnected) restoreFocus.focus();
    }

    async function signOut() {
        const button = content.querySelector(".sign-out-button");
        if (!button || button.disabled) return;
        button.disabled = true;
        button.textContent = "Signing out...";
        message("Signing out...");
        try {
            const { error } = await supabaseClient.auth.signOut({ scope: "local" });
            if (error) throw error;
            setAccount(null);
            close();
            signIn.textContent = "Signed out";
            signIn.focus();
            setTimeout(() => { if (!currentSession) signIn.textContent = "Sign in"; }, 1500);
        } catch (error) {
            console.error("Peak Fresh sign-out error:", error?.message || "unknown error");
            button.disabled = false;
            button.textContent = "Sign out";
            message("We could not sign you out. You are still signed in; please try again.", "error");
        }
    }

    async function signInWithGoogle() {
        if (pending) return;
        const button = content.querySelector("[data-google-signin]");
        pending = true;
        if (button) button.disabled = true;
        message("Connecting to Google...");
        try {
            const redirectTo = new URL(location.pathname, location.origin).toString();
            const { error } = await supabaseClient.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo }
            });
            if (error) throw error;
        } catch (error) {
            console.error("Peak Fresh Google sign-in error:", error?.message || "unknown error");
            message("Google sign-in could not be completed. Please try again.", "error");
            pending = false;
            if (button?.isConnected) button.disabled = false;
        }
    }
    signIn.addEventListener("click", () => open("login"));
    createAccount.addEventListener("click", () => open("signup"));
    account.addEventListener("click", () => open("account"));
    closeButton.addEventListener("click", close);
    modal.addEventListener("click", event => {
        if (event.target === modal) close();
        if (event.target.matches("[data-toggle-password]")) {
            content.querySelectorAll('input[name="password"],input[name="password_confirm"]').forEach(input => {
                input.type = event.target.checked ? "text" : "password";
            });
        }
    });
    content.addEventListener("click", event => {
        const googleButton = event.target.closest("[data-google-signin]");
        if (googleButton) { void signInWithGoogle(); return; }
        const link = event.target.closest("[data-mode]");
        if (link && !pending) render(link.dataset.mode);
    });
    content.addEventListener("input", event => {
        if (event.target.name === "password_confirm") event.target.setCustomValidity("");
    });
    document.addEventListener("keydown", event => {
        if (!modal.classList.contains("active")) return;
        if (event.key === "Escape") { close(); return; }
        if (event.key === "Tab") {
            const focusable = [...modal.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
            if (!focusable.length) return;
            if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
            else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
        }
    });

    content.addEventListener("submit", async event => {
        if (event.target.id !== "auth-form") return;
        event.preventDefault();
        const form = event.target;
        const button = form.querySelector('[type="submit"]');
        if (pending || !form.reportValidity()) return;
        if (mode === "signup" && !form.elements.terms_accepted?.checked) {
            message("Please accept both policies to create an account.", "error");
            form.elements.terms_accepted?.focus();
            return;
        }
        if ((mode === "signup" || mode === "reset") &&
            form.elements.password?.value !== form.elements.password_confirm?.value) {
            message("The passwords do not match.", "error");
            form.elements.password_confirm?.setCustomValidity("Passwords do not match.");
            form.elements.password_confirm?.reportValidity();
            form.elements.password_confirm?.focus();
            return;
        }
        pending = true;
        button.disabled = true;
        button.textContent = "Please wait...";
        const submittedMode = mode;
        const email = form.elements.email?.value.trim();
        const password = form.elements.password?.value;
        const name = form.elements.name?.value.trim();
        message(submittedMode === "login" ? "Signing in..." : "Processing...");
        try {
            let result;
            if (submittedMode === "login") {
                result = await supabaseClient.auth.signInWithPassword({ email, password });
            } else if (submittedMode === "signup") {
                result = await supabaseClient.auth.signUp({ email, password, options: { data: { display_name: name } } });
            } else if (submittedMode === "forgot") {
                result = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
            } else if (submittedMode === "reset") {
                result = await supabaseClient.auth.updateUser({ password });
            }
            if (result?.error) throw result.error;
            if (submittedMode === "login") {
                setAccount(result.data.session);
                close();
            } else if (submittedMode === "signup") {
                if (result.data.session) {
                    setAccount(result.data.session);
                    close();
                } else {
                    render("login", "If that email can register, Supabase will send a confirmation link.");
                }
            } else if (submittedMode === "forgot") {
                message("If an account exists for that email, a reset link will be sent.", "success");
            } else if (submittedMode === "reset") {
                render("login", "Password updated. Please sign in.");
            }
        } catch (error) {
            console.error("Peak Fresh authentication error:", error?.message || "unknown error");
            message("We could not complete that request. Please check your details and try again.", "error");
        } finally {
            pending = false;
            const active = content.querySelector("#auth-form [type=submit]");
            if (active) {
                active.disabled = false;
                active.textContent = mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Update password" : "Sign in";
            }
        }
    });

    supabaseClient.auth.onAuthStateChange((event, session) => {
        authEventSeen = true;
        setAccount(session);
        if (event === "SIGNED_OUT" && modal.classList.contains("active")) close();
        if (event === "PASSWORD_RECOVERY") open("reset");
    });
    supabaseClient.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        if (!authEventSeen) setAccount(data.session);
    }).catch(error => console.error("Peak Fresh session check error:", error?.message || "unknown error"));

    const oauthQuery = new URLSearchParams(location.search);
    const oauthHash = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (oauthQuery.has("error") || oauthHash.has("error")) {
        setTimeout(() => open("login", "Google sign-in was cancelled or could not be completed. Please try again."), 0);
    }
});
