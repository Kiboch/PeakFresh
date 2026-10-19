document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("feedbackForm");
  const contentInput = document.getElementById("feedbackContent");
  const prompt = document.getElementById("communityAuthPrompt");
  const message = document.getElementById("feedbackMessage");
  const list = document.getElementById("feedbackList");
  if (!form || !list) return;
  if (typeof supabaseClient === "undefined") {
    list.replaceChildren();
    const failure = document.createElement("p");
    failure.textContent = "Community feedback could not start because the Peak Fresh connection is unavailable. Reload the page and try again.";
    list.appendChild(failure);
    return;
  }

  let currentUser = null;
  let authEventSeen = false;
  let submitting = false;
  let loadGeneration = 0;
  let edgeUnavailable = false;
  const busyPosts = new Set();

  function setAuth(user) {
    const nextUser = user || null;
    currentUser = nextUser;
    form.hidden = !currentUser;
    prompt.hidden = Boolean(currentUser);
    void loadFeedback();
  }

  function safeAvatar(url, name) {
    if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
    const image = document.createElement("img");
    image.className = "feedback-avatar";
    image.src = url;
    image.alt = name ? name + " profile photo" : "Customer profile photo";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    return image;
  }

  function renderFeedback(posts) {
    list.replaceChildren();
    if (!posts.length) {
      const empty = document.createElement("p");
      empty.textContent = "No feedback has been shared yet. Be the first to post.";
      list.appendChild(empty);
      return;
    }
    posts.forEach(post => {
      const article = document.createElement("article");
      article.className = "feedback-card";
      const header = document.createElement("div");
      header.className = "feedback-author";
      const avatar = safeAvatar(post.avatar_url, post.display_name);
      if (avatar) header.appendChild(avatar);
      const author = document.createElement("strong");
      author.textContent = String(post.display_name || "Peak Fresh customer");
      const date = document.createElement("time");
      date.dateTime = String(post.created_at || "");
      const parsedDate = new Date(post.created_at);
      date.textContent = Number.isNaN(parsedDate.valueOf()) ? "" : parsedDate.toLocaleString();
      header.append(author, date);
      const body = document.createElement("p");
      body.className = "feedback-content";
      body.textContent = String(post.content || "");
      const actions = document.createElement("div");
      actions.className = "feedback-actions";
      ["like", "dislike"].forEach(reaction => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "feedback-action";
        const active = post.reaction_by_me === reaction;
        const count = reaction === "like" ? post.like_count : post.dislike_count;
        button.textContent = (reaction === "like" ? "Like" : "Dislike") +
          (Number.isSafeInteger(count) ? " · " + count : "");
        button.setAttribute("aria-pressed", String(active));
        button.disabled = !currentUser || busyPosts.has(post.id) || edgeUnavailable;
        if (!currentUser) button.title = "Sign in to react to feedback";
        else if (edgeUnavailable) button.title = "The feedback reaction service is unavailable";
        button.addEventListener("click", () => toggleReaction(post, reaction));
        actions.appendChild(button);
      });
      article.append(header, body, actions);

      const replies = document.createElement("div");
      replies.className = "feedback-replies";
      (post.replies || []).forEach(reply => {
        const row = document.createElement("div");
        row.className = "feedback-reply";
        const replyHead = document.createElement("strong");
        replyHead.textContent = String(reply.display_name || "Peak Fresh customer");
        const replyBody = document.createElement("p");
        replyBody.textContent = String(reply.content || "");
        row.append(replyHead, replyBody);
        replies.appendChild(row);
      });
      if (currentUser) {
        const replyForm = document.createElement("form");
        replyForm.className = "feedback-reply-form";
        const replyLabel = document.createElement("label");
        const replyId = "reply-" + post.id;
        replyLabel.htmlFor = replyId;
        replyLabel.textContent = "Write a reply";
        const replyInput = document.createElement("textarea");
        replyInput.id = replyId;
        replyInput.name = "content";
        replyInput.rows = 2;
        replyInput.maxLength = 1000;
        replyInput.required = true;
        const replyButton = document.createElement("button");
        replyButton.type = "submit";
        replyButton.className = "admin-secondary";
        replyButton.textContent = "Reply";
        replyForm.append(replyLabel, replyInput, replyButton);
        replyForm.addEventListener("submit", event => submitReply(event, post.id, replyInput, replyButton));
        replies.appendChild(replyForm);
      }
      article.appendChild(replies);
      list.appendChild(article);
    });
  }

  async function loadFeedback() {
    const generation = ++loadGeneration;
    list.setAttribute("aria-busy", "true");
    if (!list.childElementCount) {
      const loading = document.createElement("p");
      loading.setAttribute("role", "status");
      loading.textContent = "Loading approved community feedback…";
      list.appendChild(loading);
    }
    try {
      let posts;
      try {
        const { data, error } = await supabaseClient.functions.invoke("peak-fresh-feedback-reaction", {
          body: { action: "community_list" }
        });
        if (error) throw error;
        if (!Array.isArray(data?.posts)) throw new Error("Community response was incomplete.");
        posts = data.posts;
        edgeUnavailable = false;
      } catch (edgeError) {
        edgeUnavailable = true;
        console.info("Peak Fresh community is using public RLS reads while its Edge Function update is pending.", {
          status: Number(edgeError?.status || edgeError?.statusCode || 0) || undefined,
          code: String(edgeError?.code || "") || undefined
        });
        const { data: publicPosts, error: postsError } = await supabaseClient.from("feedback_posts")
          .select("id,content,display_name,avatar_url,created_at")
          .eq("status", "published").is("parent_id", null)
          .order("created_at", { ascending: false }).limit(50);
        if (postsError) throw postsError;
        const ids = (publicPosts || []).map(post => post.id);
        let replies = [];
        if (ids.length) {
          const { data: replyRows, error: replyError } = await supabaseClient.from("feedback_replies")
            .select("id,post_id,content,display_name,avatar_url,created_at")
            .in("post_id", ids).eq("status", "published").order("created_at", { ascending: true });
          if (replyError) throw replyError;
          replies = replyRows || [];
        }
        posts = (publicPosts || []).map(post => ({
          ...post,
          like_count: null,
          dislike_count: null,
          reaction_by_me: null,
          replies: replies.filter(reply => reply.post_id === post.id)
        }));
      }
      if (generation !== loadGeneration) return;
      renderFeedback(posts);
      if (edgeUnavailable) {
        message.textContent = currentUser
          ? "Published feedback is shown, but reactions are temporarily unavailable. Please try again shortly."
          : "Sign in to like or dislike published feedback.";
        message.className = "community-message";
      } else if (message.classList.contains("loading-error")) {
        message.textContent = "";
        message.className = "community-message";
      }
    } catch (error) {
      if (generation !== loadGeneration) return;
      console.error("Peak Fresh community load failed:", {
        status: Number(error?.status || error?.statusCode || 0) || undefined,
        code: String(error?.code || "") || undefined,
        name: String(error?.name || "Error")
      });
      list.replaceChildren();
      const failure = document.createElement("p");
      failure.textContent = "Community feedback could not be loaded. Check your connection and try again.";
      list.appendChild(failure);
      message.textContent = "The published feedback query was denied or unavailable. Please try again later.";
      message.className = "community-message error loading-error";
    } finally {
      if (generation === loadGeneration) list.setAttribute("aria-busy", "false");
    }
  }

  async function toggleReaction(post, reaction) {
    if (!currentUser || busyPosts.has(post.id)) return;
    busyPosts.add(post.id);
    try {
      const nextReaction = post.reaction_by_me === reaction ? null : reaction;
      const { data, error } = await supabaseClient.functions.invoke("peak-fresh-feedback-reaction", {
        body: { action: "community_react", post_id: post.id, reaction: nextReaction }
      });
      if (error) throw error;
      if (!Number.isSafeInteger(data?.like_count) || !Number.isSafeInteger(data?.dislike_count)) {
        throw new Error("Reaction response was incomplete.");
      }
      message.textContent = nextReaction ? "Your reaction was saved." : "Your reaction was removed.";
      message.className = "community-message success";
    } catch (error) {
      if (error?.code === "42501" || Number(error?.status) === 401 || Number(error?.status) === 403) {
        message.textContent = "Sign in again to react to this feedback.";
      } else if (error?.code === "unsupported_action" || Number(error?.status) === 400 || /Dislikes need the updated community service/.test(String(error?.message || ""))) {
        message.textContent = "Dislikes need the updated Peak Fresh service and database migration. Your reaction was not changed.";
      } else {
        message.textContent = "That reaction could not be saved. Check your connection and try again.";
      }
      message.className = "community-message error";
    } finally {
      busyPosts.delete(post.id);
      await loadFeedback();
    }
  }

  async function submitReply(event, postId, input, button) {
    event.preventDefault();
    if (!currentUser || button.disabled || !input.value.trim()) return;
    button.disabled = true;
    try {
      const { error } = await supabaseClient.from("feedback_replies").insert({
        post_id: postId,
        user_id: currentUser.id,
        content: input.value.trim(),
        display_name: "",
        status: "published"
      });
      if (error) throw error;
      message.textContent = "Your reply was submitted.";
      message.className = "community-message success";
      await loadFeedback();
    } catch (error) {
      console.warn("Peak Fresh reply rejected:", {
        status: Number(error?.status || error?.statusCode || 0) || undefined,
        code: String(error?.code || "") || undefined,
        name: String(error?.name || "Error")
      });
      message.textContent = error?.code === "42501" || /permission denied|row-level security/i.test(String(error?.message || ""))
        ? "The feedback moderation service is awaiting its reviewed database migration. Your reply was not posted."
        : "Your reply could not be posted. Check your connection and try again.";
      message.className = "community-message error";
      button.disabled = false;
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser || submitting || !form.reportValidity()) return;
    const text = contentInput.value.trim();
    if (!text) { contentInput.focus(); return; }
    submitting = true;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await supabaseClient.from("feedback_posts").insert({
        user_id: currentUser.id,
        content: text,
        display_name: "",
        status: "published"
      });
      if (error) throw error;
      contentInput.value = "";
      message.textContent = "Your feedback was submitted.";
      message.className = "community-message success";
      await loadFeedback();
    } catch (error) {
      console.warn("Peak Fresh feedback rejected:", {
        status: Number(error?.status || error?.statusCode || 0) || undefined,
        code: String(error?.code || "") || undefined,
        name: String(error?.name || "Error")
      });
      message.textContent = error?.code === "42501" || /permission denied|row-level security/i.test(String(error?.message || ""))
        ? "The feedback moderation service is awaiting its reviewed database migration. Your feedback was not posted."
        : "Your feedback could not be posted. Check your connection and try again.";
      message.className = "community-message error";
    } finally {
      submitting = false;
      button.disabled = false;
    }
  });

  window.addEventListener("peakfresh:auth-change", event => {
    authEventSeen = true;
    setAuth(event.detail?.user || null);
  });
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (authEventSeen) return;
    if (error) throw error;
    setAuth(data.session?.user || null);
  }).catch(error => {
    setAuth(null);
    message.textContent = "We could not confirm your sign-in. You can browse published feedback; reload or sign in again to post, reply, or like.";
    message.className = "community-message error";
    console.warn("Peak Fresh community session check failed:", {
      status: Number(error?.status || error?.statusCode || 0) || undefined,
      code: String(error?.code || "") || undefined,
      name: String(error?.name || "Error")
    });
  });
  if (!authEventSeen) void loadFeedback();
});
