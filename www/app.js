(function () {
  const STORAGE_KEYS = {
    wardrobe: "mylook.wardrobe",
    history: "mylook.history",
    settings: "mylook.settings",
  };
  const SUPABASE_URL = "https://fyvaczvzghtdnioxgrqo.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_B5RAGP-6jEB2F6-yqGQ0KA_xvYh0Q2s";
  const SUPABASE_BUCKET = "wardrobe-images";

  const PREDEFINED_LOOKS = [
    "Smart Casual",
    "Sport Casual",
    "Business",
    "Streetwear",
    "Date Night",
    "Formal",
  ];

  const CATEGORY_ORDER = ["tops", "bottoms", "outerwear", "dresses", "shoes", "accessories"];

  const appState = {
    wardrobe: readJson(STORAGE_KEYS.wardrobe, []),
    history: readJson(STORAGE_KEYS.history, []),
    settings: readJson(STORAGE_KEYS.settings, { apiKey: "", model: "gpt-4.1-mini" }),
    selectedLookType: PREDEFINED_LOOKS[0],
    context: {
      lat: null,
      lon: null,
      city: "Unknown",
      season: inferSeason(new Date().getMonth() + 1),
      weatherLabel: "unknown",
      temperatureC: null,
      timeOfDay: inferTimeOfDay(new Date().getHours()),
      source: "fallback",
    },
    latestSuggestion: null,
    pendingItemImageData: "",
    supabase: {
      client: null,
      enabled: false,
    },
    filters: {
      wardrobeSearch: "",
      wardrobeCategory: "all",
      wardrobeFavoritesOnly: false,
      historyLookFilter: "",
      historyFavoritesOnly: false,
    },
    pendingSuggestionFavorite: false,
  };

  const refs = {
    tabButtons: document.querySelectorAll(".tab-btn"),
    tabPanels: document.querySelectorAll(".tab-panel"),
    lookButtons: document.getElementById("predefinedLookButtons"),
    customLook: document.getElementById("customLook"),
    timeOverride: document.getElementById("timeOverride"),
    generateLookBtn: document.getElementById("generateLookBtn"),
    contextStatus: document.getElementById("contextStatus"),
    suggestedOutfit: document.getElementById("suggestedOutfit"),
    regenerateBtn: document.getElementById("regenerateBtn"),
    acceptBtn: document.getElementById("acceptBtn"),
    favoriteSuggestedBtn: document.getElementById("favoriteSuggestedBtn"),
    suggestionFavStatus: document.getElementById("suggestionFavStatus"),
    addItemForm: document.getElementById("addItemForm"),
    itemName: document.getElementById("itemName"),
    itemCategory: document.getElementById("itemCategory"),
    itemStyle: document.getElementById("itemStyle"),
    itemSeason: document.getElementById("itemSeason"),
    itemImage: document.getElementById("itemImage"),
    analyzeItemBtn: document.getElementById("analyzeItemBtn"),
    aiItemStatus: document.getElementById("aiItemStatus"),
    aiSuggestionCard: document.getElementById("aiSuggestionCard"),
    wardrobeSearch: document.getElementById("wardrobeSearch"),
    wardrobeCategoryFilter: document.getElementById("wardrobeCategoryFilter"),
    wardrobeFavoritesOnly: document.getElementById("wardrobeFavoritesOnly"),
    wardrobeList: document.getElementById("wardrobeList"),
    itemTemplate: document.getElementById("wardrobeItemTemplate"),
    historyList: document.getElementById("historyList"),
    historyLookFilter: document.getElementById("historyLookFilter"),
    historyFavoritesOnly: document.getElementById("historyFavoritesOnly"),
    openaiApiKey: document.getElementById("openaiApiKey"),
    openaiModel: document.getElementById("openaiModel"),
    saveSettingsBtn: document.getElementById("saveSettingsBtn"),
    settingsSaved: document.getElementById("settingsSaved"),
    syncStatus: document.getElementById("syncStatus"),
  };

  init();

  function init() {
    if (!refs.lookButtons || !refs.tabButtons.length) {
      return;
    }

    renderPredefinedLookButtons();
    bindTabNavigation();
    bindEvents();
    hydrateSettingsForm();
    initSupabase();
    renderWardrobe();
    renderHistory();
    syncFromSupabase();
    refs.regenerateBtn.disabled = true;
    refs.acceptBtn.disabled = true;
    refs.favoriteSuggestedBtn.disabled = true;
    refreshContext();
  }

  function initSupabase() {
    if (!window.supabase || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      refs.syncStatus.textContent = "Supabase: not configured. Using local storage only.";
      return;
    }
    try {
      appState.supabase.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      appState.supabase.enabled = true;
      refs.syncStatus.textContent = "Supabase: connected.";
    } catch (e) {
      refs.syncStatus.textContent = "Supabase: connection failed. Using local storage only.";
      logError("supabase_init_failed", e, {});
    }
  }

  async function syncFromSupabase() {
    if (!appState.supabase.enabled) return;
    refs.syncStatus.textContent = "Supabase: syncing wardrobe and history...";
    try {
      const remote = await fetchSupabaseData();

      const localWardrobe = readJson(STORAGE_KEYS.wardrobe, []);
      const localHistory = readJson(STORAGE_KEYS.history, []);
      if (!remote.wardrobe.length && localWardrobe.length) {
        await migrateLocalWardrobeToSupabase(localWardrobe);
      }
      if (!remote.history.length && localHistory.length) {
        await migrateLocalHistoryToSupabase(localHistory);
      }

      const afterMigration = await fetchSupabaseData();
      appState.wardrobe = afterMigration.wardrobe;
      appState.history = afterMigration.history;
      persist(STORAGE_KEYS.wardrobe, appState.wardrobe);
      persist(STORAGE_KEYS.history, appState.history);
      renderWardrobe();
      renderHistory();
      refs.syncStatus.textContent = "Supabase: synced.";
    } catch (e) {
      refs.syncStatus.textContent = "Supabase: sync failed. Working locally.";
      logError("supabase_sync_failed", e, {});
    }
  }

  function bindTabNavigation() {
    document.addEventListener("click", function (event) {
      const btn = event.target.closest(".tab-btn");
      if (!btn) return;
      showTab(btn.getAttribute("data-tab"));
    });
  }

  function showTab(tabName) {
    if (!tabName) return;
    refs.tabButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
    });
    refs.tabPanels.forEach(function (panel) {
      panel.classList.toggle("active", panel.getAttribute("data-panel") === tabName);
    });
  }

  function bindEvents() {
    refs.addItemForm.addEventListener("submit", onAddWardrobeItem);
    refs.itemImage.addEventListener("change", onItemImageChange);
    refs.analyzeItemBtn.addEventListener("click", onAnalyzeItemImage);
    refs.generateLookBtn.addEventListener("click", onGenerateLook);
    refs.regenerateBtn.addEventListener("click", onGenerateLook);
    refs.acceptBtn.addEventListener("click", onAcceptLook);
    refs.favoriteSuggestedBtn.addEventListener("click", onTogglePendingSuggestedFavorite);
    refs.saveSettingsBtn.addEventListener("click", onSaveSettings);
    refs.wardrobeSearch.addEventListener("input", onFiltersChanged);
    refs.wardrobeCategoryFilter.addEventListener("change", onFiltersChanged);
    refs.wardrobeFavoritesOnly.addEventListener("change", onFiltersChanged);
    refs.historyLookFilter.addEventListener("input", onFiltersChanged);
    refs.historyFavoritesOnly.addEventListener("change", onFiltersChanged);
  }

  function renderPredefinedLookButtons() {
    refs.lookButtons.innerHTML = "";
    PREDEFINED_LOOKS.forEach(function (type) {
      const btn = document.createElement("button");
      btn.textContent = type;
      btn.type = "button";
      if (type === appState.selectedLookType) btn.classList.add("selected");
      btn.addEventListener("click", function () {
        appState.selectedLookType = type;
        refs.customLook.value = "";
        renderPredefinedLookButtons();
      });
      refs.lookButtons.appendChild(btn);
    });
  }

  async function onAddWardrobeItem(event) {
    event.preventDefault();
    const file = refs.itemImage.files && refs.itemImage.files[0];
    if (!file) return;

    const imageData = await getSelectedItemImageData();
    const itemName = refs.itemName.value.trim() || "Untitled item";

    const item = {
      id: newId(),
      name: itemName,
      category: refs.itemCategory.value,
      styleTags: refs.itemStyle.value
        .split(",")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean),
      season: refs.itemSeason.value,
      imageData: imageData,
      isFavorite: false,
      createdAt: new Date().toISOString(),
    };
    if (appState.supabase.enabled) {
      try {
        const uploaded = await uploadImageDataToSupabase(imageData);
        const remoteItem = {
          id: item.id,
          name: item.name,
          category: item.category,
          style_tags: item.styleTags,
          season: item.season,
          is_favorite: false,
          image_url: uploaded.imageUrl,
          image_path: uploaded.imagePath,
          created_at: item.createdAt,
        };
        const insertResult = await appState.supabase.client
          .from("wardrobe_items")
          .insert(remoteItem)
          .select("*")
          .single();
        if (insertResult.error) throw insertResult.error;
        appState.wardrobe.unshift(mapWardrobeRowToItem(insertResult.data));
      } catch (e) {
        refs.aiItemStatus.textContent = "Supabase save failed. Saved locally on this device.";
        logError("wardrobe_insert_failed", e, { category: item.category, name: item.name });
        appState.wardrobe.unshift(item);
      }
    } else {
      appState.wardrobe.unshift(item);
    }
    persist(STORAGE_KEYS.wardrobe, appState.wardrobe);

    refs.addItemForm.reset();
    appState.pendingItemImageData = "";
    refs.aiItemStatus.textContent = "";
    refs.aiSuggestionCard.textContent = "";
    refs.aiSuggestionCard.classList.add("hidden");
    renderWardrobe();
  }

  function onItemImageChange() {
    appState.pendingItemImageData = "";
    refs.aiItemStatus.textContent = "";
    refs.aiSuggestionCard.textContent = "";
    refs.aiSuggestionCard.classList.add("hidden");
  }

  async function onAnalyzeItemImage() {
    const file = refs.itemImage.files && refs.itemImage.files[0];
    if (!file) {
      refs.aiItemStatus.textContent = "Pick a photo first.";
      return;
    }

    if (!appState.settings.apiKey) {
      refs.aiItemStatus.textContent = "Add OpenAI API key in Settings first.";
      return;
    }

    refs.analyzeItemBtn.disabled = true;
    refs.aiItemStatus.textContent = "Analyzing photo...";

    try {
      const imageData = await getSelectedItemImageData();
      const resizedImageData = await resizeImageDataUrl(imageData, 1200, 0.82);
      const suggestion = await analyzeItemWithOpenAI(resizedImageData);
      applyItemSuggestion(suggestion);
      refs.aiItemStatus.textContent = "AI suggestion ready. Review and save.";
      refs.aiSuggestionCard.classList.remove("hidden");
      refs.aiSuggestionCard.textContent =
        "Name: " +
        suggestion.name +
        "\nCategory: " +
        capitalize(suggestion.category) +
        "\nSeason: " +
        capitalize(suggestion.season) +
        "\nTags: " +
        (suggestion.styleTags.join(", ") || "none") +
        "\nWhy: " +
        (suggestion.reason || "Detected from image.");
    } catch (e) {
      refs.aiItemStatus.textContent = "AI analysis failed: " + (e && e.message ? e.message : "unknown error");
      logError("ai_analyze_failed", e, { model: appState.settings.model || "gpt-4.1-mini" });
    } finally {
      refs.analyzeItemBtn.disabled = false;
    }
  }

  async function getSelectedItemImageData() {
    if (appState.pendingItemImageData) {
      return appState.pendingItemImageData;
    }
    const file = refs.itemImage.files && refs.itemImage.files[0];
    if (!file) throw new Error("No file selected");
    appState.pendingItemImageData = await fileToDataUrl(file);
    return appState.pendingItemImageData;
  }

  async function analyzeItemWithOpenAI(imageData) {
    const models = [appState.settings.model || "gpt-4.1-mini", "gpt-4.1"];
    let parsed = null;
    let lastError = null;
    for (let i = 0; i < models.length; i += 1) {
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + appState.settings.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: models[i],
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text:
                      "Analyze this clothing image and return only JSON with this shape: " +
                      '{"name":"...","category":"tops|bottoms|outerwear|dresses|shoes|accessories","styleTags":["..."],"season":"all|spring|summer|autumn|winter","reason":"..."}',
                  },
                  { type: "input_image", image_url: imageData },
                ],
              },
            ],
            max_output_tokens: 300,
          }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error("OpenAI " + response.status + " " + errorText.slice(0, 200));
        }
        const payload = await response.json();
        const rawText = extractResponseText(payload);
        const jsonText = normalizeJsonText(rawText);
        parsed = JSON.parse(jsonText);
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!parsed) throw lastError || new Error("No analysis result");

    return {
      name: sanitizeName(parsed.name),
      category: sanitizeCategory(parsed.category),
      styleTags: sanitizeTags(parsed.styleTags),
      season: sanitizeSeason(parsed.season),
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
    };
  }

  function applyItemSuggestion(suggestion) {
    if (refs.itemName.value.trim().length === 0) {
      refs.itemName.value = suggestion.name;
    }
    refs.itemCategory.value = suggestion.category;
    refs.itemSeason.value = suggestion.season;
    refs.itemStyle.value = suggestion.styleTags.join(", ");
  }

  function onFiltersChanged() {
    appState.filters.wardrobeSearch = refs.wardrobeSearch.value.trim().toLowerCase();
    appState.filters.wardrobeCategory = refs.wardrobeCategoryFilter.value;
    appState.filters.wardrobeFavoritesOnly = refs.wardrobeFavoritesOnly.checked;
    appState.filters.historyLookFilter = refs.historyLookFilter.value.trim().toLowerCase();
    appState.filters.historyFavoritesOnly = refs.historyFavoritesOnly.checked;
    renderWardrobe();
    renderHistory();
  }

  function onTogglePendingSuggestedFavorite() {
    appState.pendingSuggestionFavorite = !appState.pendingSuggestionFavorite;
    refs.suggestionFavStatus.textContent = appState.pendingSuggestionFavorite
      ? "This suggestion will be saved as favorite when accepted."
      : "";
  }

  function renderWardrobe() {
    refs.wardrobeList.innerHTML = "";
    if (!appState.wardrobe.length) {
      refs.wardrobeList.innerHTML = "<div class='card'>No items yet. Add your first piece.</div>";
      return;
    }

    CATEGORY_ORDER.forEach(function (category) {
      const items = appState.wardrobe.filter(function (i) {
        return i.category === category && matchesWardrobeFilters(i);
      });
      if (!items.length) return;

      const group = document.createElement("details");
      group.className = "group";
      group.open = true;

      const title = document.createElement("summary");
      title.textContent = capitalize(category) + " (" + items.length + ")";
      group.appendChild(title);

      const itemsWrap = document.createElement("div");
      itemsWrap.className = "group-items";

      items.forEach(function (item) {
        const node = refs.itemTemplate.content.cloneNode(true);
        const img = node.querySelector("img");
        const name = node.querySelector("h4");
        const details = node.querySelector(".details");
        const delBtn = node.querySelector(".danger");
        const favBtn = node.querySelector(".fav-btn");

        img.src = item.imageUrl || item.imageData;
        img.alt = item.name;
        name.textContent = item.name;
        details.textContent =
          item.category + " | " + item.season + " | " + (item.styleTags.join(", ") || "no tags");
        favBtn.textContent = item.isFavorite ? "Unfavorite" : "Favorite";
        favBtn.classList.toggle("active", !!item.isFavorite);
        favBtn.addEventListener("click", function () {
          toggleWardrobeFavorite(item);
        });

        delBtn.addEventListener("click", function () {
          deleteWardrobeItem(item);
        });

        itemsWrap.appendChild(node);
      });

      group.appendChild(itemsWrap);
      refs.wardrobeList.appendChild(group);
    });

    if (refs.wardrobeList.children.length === 0) {
      refs.wardrobeList.innerHTML = "<div class='card'>No wardrobe items match current filters.</div>";
    }
  }

  async function deleteWardrobeItem(item) {
    if (appState.supabase.enabled) {
      try {
        if (item.imagePath) {
          await appState.supabase.client.storage.from(SUPABASE_BUCKET).remove([item.imagePath]);
        }
        await appState.supabase.client.from("wardrobe_items").delete().eq("id", item.id);
      } catch (e) {
        refs.aiItemStatus.textContent = "Delete sync failed. Removing local copy.";
        logError("wardrobe_delete_failed", e, { itemId: item.id });
      }
    }
    appState.wardrobe = appState.wardrobe.filter(function (w) {
      return w.id !== item.id;
    });
    persist(STORAGE_KEYS.wardrobe, appState.wardrobe);
    renderWardrobe();
  }

  function matchesWardrobeFilters(item) {
    const f = appState.filters;
    if (f.wardrobeCategory !== "all" && item.category !== f.wardrobeCategory) return false;
    if (f.wardrobeFavoritesOnly && !item.isFavorite) return false;
    if (!f.wardrobeSearch) return true;
    const hay = [item.name, item.category, item.season, (item.styleTags || []).join(" ")].join(" ").toLowerCase();
    return hay.indexOf(f.wardrobeSearch) !== -1;
  }

  async function toggleWardrobeFavorite(item) {
    const next = !item.isFavorite;
    item.isFavorite = next;
    persist(STORAGE_KEYS.wardrobe, appState.wardrobe);
    renderWardrobe();

    if (!appState.supabase.enabled) return;
    const result = await appState.supabase.client
      .from("wardrobe_items")
      .update({ is_favorite: next })
      .eq("id", item.id);
    if (result.error) {
      logError("wardrobe_favorite_update_failed", result.error, { itemId: item.id, isFavorite: next });
    }
  }

  function renderHistory() {
    refs.historyList.innerHTML = "";
    if (!appState.history.length) {
      refs.historyList.innerHTML = "<div class='card'>No accepted looks yet.</div>";
      return;
    }

    appState.history
      .slice()
      .reverse()
      .forEach(function (entry) {
        if (!matchesHistoryFilters(entry)) return;
        const div = document.createElement("article");
        div.className = "history-item";
        const date = new Date(entry.acceptedAt).toLocaleString();
        const head = document.createElement("div");
        head.className = "history-head";
        head.innerHTML =
          "<div class='history-meta'><strong>" +
          escapeHtml(entry.lookType) +
          "</strong><br><span class='small'>" +
          escapeHtml(date) +
          "</span></div>";
        const favBtn = document.createElement("button");
        favBtn.type = "button";
        favBtn.className = "fav-btn" + (entry.isFavorite ? " active" : "");
        favBtn.textContent = entry.isFavorite ? "Favorited" : "Favorite";
        favBtn.addEventListener("click", function () {
          toggleHistoryFavorite(entry);
        });
        head.appendChild(favBtn);
        div.appendChild(head);

        const outfitGrid = document.createElement("div");
        outfitGrid.className = "outfit-grid";
        entry.outfit.forEach(function (o) {
          const item = document.createElement("div");
          item.className = "outfit-item";
          const img = document.createElement("img");
          img.src = o.imageUrl || findWardrobeImageById(o.id) || "";
          img.alt = o.name || "Outfit item";
          const caption = document.createElement("div");
          caption.className = "caption";
          caption.textContent = capitalize(o.category || "item") + ": " + (o.name || "Unknown");
          item.appendChild(img);
          item.appendChild(caption);
          outfitGrid.appendChild(item);
        });
        div.appendChild(outfitGrid);

        const ctx = document.createElement("div");
        ctx.className = "small history-context";
        ctx.textContent = "Context: " + entry.contextSummary;
        div.appendChild(ctx);
        refs.historyList.appendChild(div);
      });

    if (refs.historyList.children.length === 0) {
      refs.historyList.innerHTML = "<div class='card'>No history entries match current filters.</div>";
    }
  }

  function matchesHistoryFilters(entry) {
    const f = appState.filters;
    if (f.historyFavoritesOnly && !entry.isFavorite) return false;
    if (!f.historyLookFilter) return true;
    return (entry.lookType || "").toLowerCase().indexOf(f.historyLookFilter) !== -1;
  }

  async function toggleHistoryFavorite(entry) {
    const next = !entry.isFavorite;
    entry.isFavorite = next;
    persist(STORAGE_KEYS.history, appState.history);
    renderHistory();
    if (!appState.supabase.enabled) return;

    const result = await appState.supabase.client
      .from("history_entries")
      .update({ is_favorite: next })
      .eq("id", entry.id);
    if (result.error) {
      logError("history_favorite_update_failed", result.error, { historyId: entry.id, isFavorite: next });
    }
  }

  async function onGenerateLook() {
    if (!appState.wardrobe.length) {
      refs.suggestedOutfit.textContent = "Add wardrobe items first.";
      refs.favoriteSuggestedBtn.disabled = true;
      return;
    }

    const lookType = refs.customLook.value.trim() || appState.selectedLookType;
    const timeOfDay = refs.timeOverride.value === "auto" ? appState.context.timeOfDay : refs.timeOverride.value;
    const context = Object.assign({}, appState.context, { timeOfDay: timeOfDay });

    refs.suggestedOutfit.textContent = "Generating...";
    refs.generateLookBtn.disabled = true;

    try {
      const aiSuggestion = await generateWithOpenAI(lookType, context);
      appState.latestSuggestion = aiSuggestion || fallbackSuggestion(lookType, context);
    } catch (e) {
      logError("generate_look_failed", e, { lookType: lookType });
      appState.latestSuggestion = fallbackSuggestion(lookType, context);
    } finally {
      refs.generateLookBtn.disabled = false;
    }

    renderSuggestion(appState.latestSuggestion, lookType, context);
  }

  function fallbackSuggestion(lookType, context) {
    const seasonal = appState.wardrobe.filter(function (item) {
      return item.season === "all" || item.season === context.season;
    });

    const pools = {};
    CATEGORY_ORDER.forEach(function (category) {
      pools[category] = seasonal.filter(function (i) {
        return i.category === category;
      });
    });

    const outfit = [];
    const useDress = pools.dresses.length > 0 && Math.random() > 0.6;

    if (useDress) {
      outfit.push(randomPick(pools.dresses));
    } else {
      if (pools.tops.length) outfit.push(randomPick(pools.tops));
      if (pools.bottoms.length) outfit.push(randomPick(pools.bottoms));
    }

    if (pools.outerwear.length && (context.temperatureC == null || context.temperatureC < 16)) {
      outfit.push(randomPick(pools.outerwear));
    }

    if (pools.shoes.length) outfit.push(randomPick(pools.shoes));
    if (pools.accessories.length) outfit.push(randomPick(pools.accessories));

    return {
      outfit: dedupeById(outfit.filter(Boolean)),
      rationale:
        "Generated locally for " +
        lookType +
        ", " +
        context.season +
        ", " +
        context.weatherLabel +
        ", " +
        context.timeOfDay +
        ".",
      source: "fallback",
    };
  }

  async function generateWithOpenAI(lookType, context) {
    const apiKey = appState.settings.apiKey;
    const model = appState.settings.model;
    if (!apiKey) return null;

    const wardrobeForPrompt = appState.wardrobe.map(function (item) {
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        season: item.season,
        styleTags: item.styleTags,
      };
    });

    const prompt = [
      "You are a personal stylist.",
      "Choose one outfit from the user wardrobe.",
      "Return ONLY valid JSON:",
      '{"selectedItemIds":["id1","id2"],"reason":"..."}',
      "Constraints:",
      "- include shoes if available",
      "- include accessories if matching",
      "- use season/weather/time context",
      "- match requested look type",
      "lookType: " + lookType,
      "context: " + JSON.stringify(context),
      "wardrobe: " + JSON.stringify(wardrobeForPrompt),
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "gpt-4.1-mini",
        input: prompt,
        tools: [{ type: "web_search_preview" }],
        max_output_tokens: 400,
      }),
    });

    if (!response.ok) {
      throw new Error("OpenAI error " + response.status);
    }

    const payload = await response.json();
    const rawText = extractResponseText(payload);
    const jsonText = normalizeJsonText(rawText);
    if (!jsonText) throw new Error("No text response");

    const parsed = JSON.parse(jsonText);
    const selectedIds = Array.isArray(parsed.selectedItemIds) ? parsed.selectedItemIds : [];
    const outfit = selectedIds
      .map(function (id) {
        return appState.wardrobe.find(function (item) {
          return item.id === id;
        });
      })
      .filter(Boolean);

    if (!outfit.length) throw new Error("AI returned no valid items");

    return {
      outfit: dedupeById(outfit),
      rationale: parsed.reason || "AI-generated style suggestion.",
      source: "openai",
    };
  }

  function renderSuggestion(suggestion, lookType, context) {
    const topLine =
      "<div class='suggestion-topline'>Look: " +
      escapeHtml(lookType) +
      " | Source: " +
      escapeHtml(suggestion.source) +
      "</div>";
    const outfitCards = suggestion.outfit
      .map(function (item) {
        return (
          "<div class='outfit-item'>" +
          "<img src='" +
          escapeHtmlAttr(item.imageUrl || item.imageData || "") +
          "' alt='" +
          escapeHtmlAttr(item.name || "item") +
          "'>" +
          "<div class='caption'>" +
          escapeHtml(capitalize(item.category) + ": " + item.name) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    refs.suggestedOutfit.innerHTML =
      topLine +
      "<div class='outfit-grid'>" +
      (outfitCards || "<div class='small'>No valid outfit generated.</div>") +
      "</div>" +
      "<div class='suggestion-why'>Why: " +
      escapeHtml(suggestion.rationale) +
      "</div>";

    refs.regenerateBtn.disabled = false;
    refs.acceptBtn.disabled = !suggestion.outfit.length;
    refs.favoriteSuggestedBtn.disabled = !suggestion.outfit.length;
    refs.suggestionFavStatus.textContent = "";
    appState.pendingSuggestionFavorite = false;

    appState.latestSuggestion = {
      outfit: suggestion.outfit,
      rationale: suggestion.rationale,
      source: suggestion.source,
      lookType: lookType,
      context: context,
    };
  }

  async function onAcceptLook() {
    if (!appState.latestSuggestion || !appState.latestSuggestion.outfit || !appState.latestSuggestion.outfit.length) return;

    const isFavorite = !!appState.pendingSuggestionFavorite;
    const entry = {
      id: newId(),
      acceptedAt: new Date().toISOString(),
      lookType: appState.latestSuggestion.lookType,
      outfit: appState.latestSuggestion.outfit.map(function (i) {
        return { id: i.id, name: i.name, category: i.category, imageUrl: i.imageUrl || i.imageData || "" };
      }),
      contextSummary: summarizeContext(appState.latestSuggestion.context),
      isFavorite: isFavorite,
    };

    if (appState.supabase.enabled) {
      try {
        const insertResult = await appState.supabase.client
          .from("history_entries")
          .insert({
            id: entry.id,
            accepted_at: entry.acceptedAt,
            look_type: entry.lookType,
            outfit: entry.outfit,
            context_summary: entry.contextSummary,
            is_favorite: entry.isFavorite,
          })
          .select("*")
          .single();
        if (insertResult.error) throw insertResult.error;
        appState.history.push(mapHistoryRowToEntry(insertResult.data));
      } catch (e) {
        logError("history_insert_failed", e, { lookType: entry.lookType });
        appState.history.push(entry);
      }
    } else {
      appState.history.push(entry);
    }

    persist(STORAGE_KEYS.history, appState.history);
    renderHistory();
    refs.acceptBtn.disabled = true;
    refs.favoriteSuggestedBtn.disabled = true;
    appState.pendingSuggestionFavorite = false;
    refs.suggestionFavStatus.textContent = "";
  }

  function summarizeContext(context) {
    return (
      (context.city || "Unknown") +
      ", " +
      context.season +
      ", " +
      context.weatherLabel +
      ", " +
      (context.temperatureC == null ? "?" : context.temperatureC) +
      "C, " +
      context.timeOfDay
    );
  }

  function onSaveSettings() {
    appState.settings = {
      apiKey: refs.openaiApiKey.value.trim(),
      model: refs.openaiModel.value.trim() || "gpt-4.1-mini",
    };
    persist(STORAGE_KEYS.settings, appState.settings);
    refs.settingsSaved.textContent = "Settings saved locally.";
  }

  function hydrateSettingsForm() {
    refs.openaiApiKey.value = appState.settings.apiKey || "";
    refs.openaiModel.value = appState.settings.model || "gpt-4.1-mini";
  }

  async function refreshContext() {
    refs.contextStatus.textContent = "Fetching location and weather...";

    let lat = null;
    let lon = null;
    let city = "Unknown";
    let locationSource = "device_gps";
    try {
      const pos = await getCurrentPosition();
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
    } catch (e) {
      try {
        const ipGeo = await fetchWithTimeout("https://ipapi.co/json/", 8000).then(function (r) {
          return r.json();
        });
        lat = ipGeo && typeof ipGeo.latitude === "number" ? ipGeo.latitude : null;
        lon = ipGeo && typeof ipGeo.longitude === "number" ? ipGeo.longitude : null;
        city = ipGeo && ipGeo.city ? ipGeo.city : city;
        locationSource = "ip_fallback";
      } catch (geoErr) {
        logError("location_failed", geoErr, {});
      }
    }

    if (lat == null || lon == null) {
      appState.context.city = "Unknown";
      appState.context.source = "fallback";
      updateContextView();
      return;
    }

    try {
      const weather = await fetchWithTimeout(
        "https://api.open-meteo.com/v1/forecast?latitude=" +
          encodeURIComponent(lat) +
          "&longitude=" +
          encodeURIComponent(lon) +
          "&current=temperature_2m,weather_code&timezone=auto",
        10000
      ).then(function (r) {
        return r.json();
      });

      if (city === "Unknown") {
        city = await reverseGeocodeCity(lat, lon);
      }

      const current = weather.current || {};
      const nowMonth = new Date().getMonth() + 1;
      appState.context = {
        lat: lat,
        lon: lon,
        city: city,
        season: inferSeason(nowMonth),
        temperatureC: typeof current.temperature_2m === "number" ? current.temperature_2m : null,
        weatherLabel: weatherCodeToLabel(current.weather_code),
        timeOfDay: inferTimeOfDay(new Date().getHours()),
        source: "weather+" + locationSource,
      };
      updateContextView();
    } catch (e) {
      logError("weather_fetch_failed", e, { lat: lat, lon: lon });
      appState.context = Object.assign({}, appState.context, {
        lat: lat,
        lon: lon,
        city: city,
        source: "location_only",
      });
      updateContextView();
    }
  }

  function updateContextView() {
    const c = appState.context;
    refs.contextStatus.innerHTML =
      "<strong>" +
      escapeHtml(c.city || "Unknown city") +
      "</strong><br>" +
      "Weather: " +
      escapeHtml(c.weatherLabel) +
      (c.temperatureC == null ? "" : " (" + escapeHtml(String(c.temperatureC)) + " C)") +
      "<br>Season: " +
      escapeHtml(c.season) +
      " | Time: " +
      escapeHtml(c.timeOfDay);
  }

  async function fetchSupabaseData() {
    const client = appState.supabase.client;
    const wardrobeResult = await client
      .from("wardrobe_items")
      .select("*")
      .order("created_at", { ascending: false });
    if (wardrobeResult.error) throw wardrobeResult.error;

    const historyResult = await client
      .from("history_entries")
      .select("*")
      .order("accepted_at", { ascending: true });
    if (historyResult.error) throw historyResult.error;

    return {
      wardrobe: (wardrobeResult.data || []).map(mapWardrobeRowToItem),
      history: (historyResult.data || []).map(mapHistoryRowToEntry),
    };
  }

  async function migrateLocalWardrobeToSupabase(localItems) {
    for (let i = 0; i < localItems.length; i += 1) {
      const item = localItems[i];
      try {
        const uploaded = await uploadImageDataToSupabase(item.imageData);
        await appState.supabase.client.from("wardrobe_items").insert({
          id: item.id || newId(),
          name: item.name || "Untitled item",
          category: sanitizeCategory(item.category),
          style_tags: Array.isArray(item.styleTags) ? item.styleTags : [],
          season: sanitizeSeason(item.season),
          is_favorite: !!item.isFavorite,
          image_url: uploaded.imageUrl,
          image_path: uploaded.imagePath,
          created_at: item.createdAt || new Date().toISOString(),
        });
      } catch (e) {
        continue;
      }
    }
  }

  async function migrateLocalHistoryToSupabase(localEntries) {
    const payload = localEntries.map(function (entry) {
      return {
        id: entry.id || newId(),
        accepted_at: entry.acceptedAt || new Date().toISOString(),
        look_type: entry.lookType || "Look",
        outfit: Array.isArray(entry.outfit) ? entry.outfit : [],
        context_summary: entry.contextSummary || "",
        is_favorite: !!entry.isFavorite,
      };
    });
    if (!payload.length) return;
    const result = await appState.supabase.client.from("history_entries").insert(payload);
    if (result.error) throw result.error;
  }

  async function uploadImageDataToSupabase(imageData) {
    const client = appState.supabase.client;
    const blob = dataUrlToBlob(imageData);
    const ext = guessExtensionFromDataUrl(imageData);
    const path = "items/" + Date.now() + "_" + newId() + "." + ext;

    const uploadResult = await client.storage.from(SUPABASE_BUCKET).upload(path, blob, {
      contentType: blob.type || "image/jpeg",
      upsert: false,
    });
    if (uploadResult.error) throw uploadResult.error;

    const publicUrlResult = client.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
    const imageUrl = publicUrlResult.data && publicUrlResult.data.publicUrl ? publicUrlResult.data.publicUrl : "";
    if (!imageUrl) throw new Error("No public URL returned");

    return {
      imagePath: path,
      imageUrl: imageUrl,
    };
  }

  function mapWardrobeRowToItem(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      styleTags: Array.isArray(row.style_tags) ? row.style_tags : [],
      season: row.season,
      imageData: row.image_url,
      imageUrl: row.image_url,
      imagePath: row.image_path || "",
      isFavorite: !!row.is_favorite,
      createdAt: row.created_at,
    };
  }

  function mapHistoryRowToEntry(row) {
    return {
      id: row.id,
      acceptedAt: row.accepted_at,
      lookType: row.look_type,
      outfit: Array.isArray(row.outfit) ? row.outfit : [],
      contextSummary: row.context_summary || "",
      isFavorite: !!row.is_favorite,
    };
  }

  function extractResponseText(payload) {
    if (payload && payload.output_text) return payload.output_text;

    if (payload && Array.isArray(payload.output)) {
      const textParts = [];
      payload.output.forEach(function (entry) {
        if (!Array.isArray(entry.content)) return;
        entry.content.forEach(function (chunk) {
          if (chunk.type === "output_text" && chunk.text) {
            textParts.push(chunk.text);
          }
        });
      });
      return textParts.join("\n").trim();
    }

    return "";
  }

  function normalizeJsonText(text) {
    if (!text) return "";
    const trimmed = text.trim();
    if (trimmed[0] === "{") return trimmed;
    const fence = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
    if (fence && fence[1]) return fence[1].trim();
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
  }

  function sanitizeName(value) {
    if (typeof value !== "string") return "Untitled item";
    const cleaned = value.trim();
    return cleaned || "Untitled item";
  }

  function sanitizeCategory(value) {
    if (typeof value !== "string") return "tops";
    const lower = value.trim().toLowerCase();
    return CATEGORY_ORDER.indexOf(lower) !== -1 ? lower : "tops";
  }

  function sanitizeSeason(value) {
    const valid = ["all", "spring", "summer", "autumn", "winter"];
    if (typeof value !== "string") return "all";
    const lower = value.trim().toLowerCase();
    return valid.indexOf(lower) !== -1 ? lower : "all";
  }

  function sanitizeTags(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(function (tag) {
        return String(tag).trim();
      })
      .filter(Boolean)
      .slice(0, 8);
  }

  function randomPick(items) {
    if (!items || !items.length) return null;
    return items[Math.floor(Math.random() * items.length)];
  }

  function dedupeById(items) {
    const seen = {};
    return items.filter(function (item) {
      if (!item || seen[item.id]) return false;
      seen[item.id] = true;
      return true;
    });
  }

  function findWardrobeImageById(id) {
    const found = appState.wardrobe.find(function (item) {
      return item.id === id;
    });
    return found ? found.imageUrl || found.imageData || "" : "";
  }

  function getCurrentPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation unavailable"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 8000,
      });
    });
  }

  function inferSeason(month) {
    if (month === 12 || month <= 2) return "winter";
    if (month <= 5) return "spring";
    if (month <= 8) return "summer";
    return "autumn";
  }

  function inferTimeOfDay(hour) {
    return hour >= 6 && hour < 19 ? "day" : "night";
  }

  function weatherCodeToLabel(code) {
    if (code == null) return "unknown";
    if ([0].indexOf(code) !== -1) return "clear";
    if ([1, 2, 3].indexOf(code) !== -1) return "cloudy";
    if ([45, 48].indexOf(code) !== -1) return "fog";
    if ([51, 53, 55, 56, 57].indexOf(code) !== -1) return "drizzle";
    if ([61, 63, 65, 66, 67, 80, 81, 82].indexOf(code) !== -1) return "rain";
    if ([71, 73, 75, 77, 85, 86].indexOf(code) !== -1) return "snow";
    if ([95, 96, 99].indexOf(code) !== -1) return "thunderstorm";
    return "mixed";
  }

  async function reverseGeocodeCity(lat, lon) {
    try {
      const payload = await fetchWithTimeout(
        "https://geocoding-api.open-meteo.com/v1/reverse?latitude=" +
          encodeURIComponent(lat) +
          "&longitude=" +
          encodeURIComponent(lon) +
          "&language=en&format=json",
        8000
      ).then(function (r) {
        return r.json();
      });
      const first = payload && payload.results && payload.results[0] ? payload.results[0] : null;
      return first && first.name ? first.name : "Unknown";
    } catch (e) {
      return "Unknown";
    }
  }

  function fetchWithTimeout(url, timeoutMs) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = setTimeout(function () {
      if (controller) controller.abort();
    }, timeoutMs || 10000);
    const options = controller ? { signal: controller.signal } : {};
    return fetch(url, options).finally(function () {
      clearTimeout(timeout);
    });
  }

  async function resizeImageDataUrl(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      const image = new Image();
      image.onload = function () {
        const width = image.width;
        const height = image.height;
        const ratio = Math.min(1, (maxSide || 1200) / Math.max(width, height));
        const targetW = Math.max(1, Math.round(width * ratio));
        const targetH = Math.max(1, Math.round(height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(image, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL("image/jpeg", quality || 0.82));
      };
      image.onerror = function () {
        resolve(dataUrl);
      };
      image.src = dataUrl;
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(",");
    const meta = parts[0] || "";
    const b64 = parts[1] || "";
    const mimeMatch = meta.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  function guessExtensionFromDataUrl(dataUrl) {
    if (typeof dataUrl !== "string") return "jpg";
    if (dataUrl.indexOf("image/png") !== -1) return "png";
    if (dataUrl.indexOf("image/webp") !== -1) return "webp";
    return "jpg";
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function persist(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function logError(code, error, meta) {
    const message = error && error.message ? error.message : String(error || "unknown_error");
    const payload = {
      code: code,
      message: message,
      meta: meta || {},
      user_agent: navigator.userAgent,
      created_at_client: new Date().toISOString(),
    };
    try {
      console.error("[MyLook]", code, message, meta || {});
    } catch (e) {
      // ignore
    }
    if (!appState.supabase.enabled || !appState.supabase.client) return;
    appState.supabase.client.from("app_logs").insert(payload).then(function () {}).catch(function () {});
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/`/g, "");
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
  }
})();
