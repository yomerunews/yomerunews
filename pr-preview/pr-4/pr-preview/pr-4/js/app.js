(() => {
  "use strict";

  const STORAGE_KEY = "ezjp_vocab";
  const WK_VOCAB_STORAGE = "ezjp_wk_vocab";
  const WK_API_KEY_STORAGE = "ezjp_wk_api_key";
  const WK_INCLUDE_KANJI_STORAGE = "ezjp_wk_include_kanji";
  const WK_API_BASE = "https://api.wanikani.com/v2";
  const ARTICLES_URL = "data/articles.json";

  // DOM elements
  const vocabInput = document.getElementById("vocab-input");
  const vocabFile = document.getElementById("vocab-file");
  const saveBtn = document.getElementById("save-vocab");
  const clearBtn = document.getElementById("clear-vocab");
  const vocabStatus = document.getElementById("vocab-status");
  const articlesLoading = document.getElementById("articles-loading");
  const articlesList = document.getElementById("articles-list");
  const noVocabMessage = document.getElementById("no-vocab-message");
  const sortSelect = document.getElementById("sort-select");
  const pagination = document.getElementById("pagination");

  const PAGE_SIZE = 20;
  let articles = [];
  let manualVocab = new Set();  // Words from textarea/file upload
  let wkVocab = new Set();      // Words from WaniKani (kept separate)
  let sortedArticles = [];
  let displayCount = PAGE_SIZE;

  /** Combined vocab for scoring (manual + WaniKani) */
  function getAllVocab() {
    const combined = new Set(manualVocab);
    for (const w of wkVocab) combined.add(w);
    return combined;
  }

  // --- Vocab Management ---

  function parseVocabText(text) {
    return text
      .split(/[\n,\t]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
  }

  function parseCSVFirstColumn(text) {
    const lines = text.split(/\n/);
    const words = [];
    for (const line of lines) {
      const cols = line.split(",");
      const word = cols[0].trim().replace(/^["']|["']$/g, "");
      if (word.length > 0) {
        words.push(word);
      }
    }
    return words;
  }

  function loadVocab() {
    // Load manual vocab
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const words = JSON.parse(stored);
        manualVocab = new Set(words);
        vocabInput.value = words.join("\n");
      } catch {
        manualVocab = new Set();
      }
    }
    // Load cached WaniKani vocab
    const wkStored = localStorage.getItem(WK_VOCAB_STORAGE);
    if (wkStored) {
      try {
        wkVocab = new Set(JSON.parse(wkStored));
      } catch {
        wkVocab = new Set();
      }
    }
    updateVocabStatus();
  }

  function saveVocab() {
    const words = parseVocabText(vocabInput.value);
    manualVocab = new Set(words);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...manualVocab]));
    updateVocabStatus();
    renderArticles();
  }

  function clearVocab() {
    const hasWk = wkVocab.size > 0 || localStorage.getItem(WK_API_KEY_STORAGE);
    const msg = hasWk
      ? "This will clear your vocabulary, WaniKani words, and saved API key. Continue?"
      : "This will clear all your vocabulary. Continue?";
    if (!confirm(msg)) return;

    manualVocab = new Set();
    wkVocab = new Set();
    vocabInput.value = "";
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(WK_VOCAB_STORAGE);
    localStorage.removeItem(WK_API_KEY_STORAGE);
    localStorage.removeItem(WK_INCLUDE_KANJI_STORAGE);
    updateVocabStatus();
    renderArticles();
  }

  function updateVocabStatus() {
    const manualCount = manualVocab.size;
    const wkCount = wkVocab.size;
    const totalCount = getAllVocab().size;

    if (totalCount > 0) {
      const parts = [];
      if (manualCount > 0) parts.push(`${manualCount} words`);
      if (wkCount > 0) parts.push(`${wkCount} from WaniKani`);
      vocabStatus.textContent = parts.join(" + ");
      vocabStatus.className = "status-badge has-vocab";
    } else {
      vocabStatus.textContent = "No vocabulary loaded";
      vocabStatus.className = "status-badge";
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      let words;
      if (file.name.endsWith(".csv")) {
        words = parseCSVFirstColumn(text);
      } else {
        words = parseVocabText(text);
      }

      for (const w of words) {
        manualVocab.add(w);
      }
      vocabInput.value = [...manualVocab].join("\n");
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...manualVocab]));
      updateVocabStatus();
      renderArticles();
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // --- WaniKani Import ---

  const wkImportBtn = document.getElementById("wanikani-import");
  const wkModal = document.getElementById("wk-modal");
  const wkApiKeyInput = document.getElementById("wk-api-key");
  const wkIncludeKanji = document.getElementById("wk-include-kanji");
  const wkStartBtn = document.getElementById("wk-start");
  const wkCancelBtn = document.getElementById("wk-cancel");
  const wkKeySection = document.getElementById("wk-key-section");
  const wkProgressSection = document.getElementById("wk-progress-section");
  const wkProgressFill = document.getElementById("wk-progress-fill");
  const wkProgressText = document.getElementById("wk-progress-text");
  const wkError = document.getElementById("wk-error");

  function openWkModal() {
    const savedKey = localStorage.getItem(WK_API_KEY_STORAGE);
    if (savedKey) wkApiKeyInput.value = savedKey;
    const savedKanji = localStorage.getItem(WK_INCLUDE_KANJI_STORAGE);
    wkIncludeKanji.checked = savedKanji === "true";
    wkKeySection.hidden = false;
    wkProgressSection.hidden = true;
    wkError.hidden = true;
    wkStartBtn.disabled = false;
    wkStartBtn.textContent = "Import";
    wkStartBtn.onclick = null;
    wkModal.classList.remove("wk-hidden");
  }

  function closeWkModal() {
    wkModal.classList.add("wk-hidden");
  }

  function updateWkProgress(percent, text) {
    wkProgressFill.style.width = `${Math.min(percent, 100)}%`;
    wkProgressText.textContent = text;
  }

  function showWkError(message) {
    wkError.textContent = message;
    wkError.hidden = false;
  }

  async function wkFetch(url, apiKey) {
    return fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }

  /**
   * Fetch WaniKani vocabulary. Called both from the modal and on page load.
   * @param {string} apiKey - WaniKani API bearer token
   * @param {boolean} includeKanji - whether to also import kanji
   * @param {boolean} silent - if true, don't show modal progress (background refresh)
   */
  async function fetchWaniKaniVocab(apiKey, includeKanji, silent) {
    const subjectTypes = includeKanji ? "vocabulary,kanji" : "vocabulary";

    // Phase 1: Fetch all started assignments
    if (!silent) updateWkProgress(0, "Fetching your learned items...");
    const subjectIds = [];
    let url = `${WK_API_BASE}/assignments?subject_types=${subjectTypes}&started=true`;

    while (url) {
      const resp = await wkFetch(url, apiKey);
      if (!resp.ok) {
        if (resp.status === 401) throw new Error("Invalid API token. Check your key at wanikani.com/settings.");
        if (resp.status === 429) throw new Error("Rate limited by WaniKani. Please wait a moment and try again.");
        throw new Error(`WaniKani API error (${resp.status}). Try again later.`);
      }
      const json = await resp.json();
      for (const item of json.data) {
        subjectIds.push(item.data.subject_id);
      }
      url = json.pages.next_url;
      if (!silent) updateWkProgress(20, `Found ${subjectIds.length} learned items...`);
    }

    if (subjectIds.length === 0) {
      throw new Error("No learned vocabulary found on your WaniKani account.");
    }

    // Phase 2: Fetch subjects in batches of 1000
    const words = [];
    const batchSize = 1000;
    for (let i = 0; i < subjectIds.length; i += batchSize) {
      const batch = subjectIds.slice(i, i + batchSize);
      let batchUrl = `${WK_API_BASE}/subjects?ids=${batch.join(",")}`;

      while (batchUrl) {
        const resp = await wkFetch(batchUrl, apiKey);
        if (!resp.ok) throw new Error(`WaniKani API error (${resp.status}). Try again later.`);
        const json = await resp.json();
        for (const item of json.data) {
          if (item.data.characters) {
            words.push(item.data.characters);
          }
        }
        batchUrl = json.pages.next_url;
      }

      if (!silent) {
        const pct = 20 + ((i + batch.length) / subjectIds.length) * 80;
        updateWkProgress(pct, `Fetching vocabulary... ${words.length} words`);
      }
    }

    return words;
  }

  async function importFromWaniKani() {
    const apiKey = wkApiKeyInput.value.trim();
    if (!apiKey) {
      showWkError("Please enter your API token.");
      return;
    }

    localStorage.setItem(WK_API_KEY_STORAGE, apiKey);
    localStorage.setItem(WK_INCLUDE_KANJI_STORAGE, wkIncludeKanji.checked.toString());
    wkKeySection.hidden = true;
    wkProgressSection.hidden = false;
    wkError.hidden = true;
    wkStartBtn.disabled = true;

    try {
      const words = await fetchWaniKaniVocab(apiKey, wkIncludeKanji.checked, false);

      // Store WaniKani vocab separately
      wkVocab = new Set(words);
      localStorage.setItem(WK_VOCAB_STORAGE, JSON.stringify([...wkVocab]));
      updateVocabStatus();
      renderArticles();

      updateWkProgress(100, `Imported ${words.length} words from WaniKani!`);
      wkStartBtn.textContent = "Done";
      wkStartBtn.disabled = false;
      wkStartBtn.onclick = closeWkModal;
    } catch (err) {
      showWkError(err.message);
      wkKeySection.hidden = false;
      wkProgressSection.hidden = true;
      wkStartBtn.disabled = false;
    }
  }

  /** Silently refresh WaniKani vocab on page load if API key is saved */
  async function refreshWaniKaniOnLoad() {
    const apiKey = localStorage.getItem(WK_API_KEY_STORAGE);
    if (!apiKey) return;

    const includeKanji = localStorage.getItem(WK_INCLUDE_KANJI_STORAGE) === "true";
    try {
      const words = await fetchWaniKaniVocab(apiKey, includeKanji, true);
      wkVocab = new Set(words);
      localStorage.setItem(WK_VOCAB_STORAGE, JSON.stringify([...wkVocab]));
      updateVocabStatus();
      renderArticles();
    } catch {
      // Silent fail — use cached WaniKani vocab from localStorage
    }
  }

  // --- Article Scoring ---

  function scoreArticle(article) {
    const vocab = getAllVocab();
    if (vocab.size === 0) return 0;
    const knownCount = article.words.filter((w) => vocab.has(w)).length;
    return (knownCount / article.word_count) * 100;
  }

  function getDifficultyClass(percent) {
    if (percent >= 80) return "easy";
    if (percent >= 50) return "medium";
    return "hard";
  }

  // --- Rendering ---

  function renderArticles() {
    articlesLoading.hidden = true;
    displayCount = PAGE_SIZE;

    const vocab = getAllVocab();
    if (vocab.size === 0) {
      noVocabMessage.hidden = false;
      sortedArticles = [...articles];
    } else {
      noVocabMessage.hidden = true;
      sortedArticles = articles.map((a) => ({ ...a, score: scoreArticle(a) }));
      const sortMode = sortSelect.value;
      if (sortMode === "easiest") {
        sortedArticles.sort((a, b) => b.score - a.score);
      } else if (sortMode === "hardest") {
        sortedArticles.sort((a, b) => a.score - b.score);
      } else {
        sortedArticles.sort((a, b) => b.date.localeCompare(a.date));
      }
    }

    renderPage();
  }

  function renderPage() {
    articlesList.innerHTML = "";
    const vocab = getAllVocab();
    const hasVocab = vocab.size > 0;
    for (const article of sortedArticles.slice(0, displayCount)) {
      articlesList.appendChild(createArticleCard(article, hasVocab ? article.score : null));
    }
    renderPagination();
  }

  function renderPagination() {
    pagination.innerHTML = "";
    if (displayCount >= sortedArticles.length) return;
    const remaining = sortedArticles.length - displayCount;
    const loadMore = document.createElement("button");
    loadMore.className = "btn btn-load-more";
    loadMore.textContent = `Load more (${remaining} remaining)`;
    loadMore.addEventListener("click", () => {
      displayCount += PAGE_SIZE;
      renderPage();
    });
    pagination.appendChild(loadMore);
  }

  function createArticleCard(article, score) {
    const card = document.createElement("a");
    card.className = "article-card";
    card.href = article.url || article.nhkeasier_url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    const thumbHtml = article.image_url
      ? `<img class="article-thumb" src="${escapeHtml(article.image_url)}" alt="" loading="lazy">`
      : "";

    let difficultyHtml = "";
    if (score !== null) {
      const level = getDifficultyClass(score);
      difficultyHtml = `
        <div class="difficulty-bar-container">
          <div class="difficulty-bar">
            <div class="difficulty-bar-fill ${level}" style="width: ${Math.min(score, 100)}%"></div>
          </div>
          <span class="difficulty-label ${level}">${Math.round(score)}% readable</span>
        </div>
      `;
    }

    card.innerHTML = `
      ${thumbHtml}
      <div class="article-info">
        <div class="article-title">${escapeHtml(article.title)}</div>
        <div class="article-date">${escapeHtml(article.date)}</div>
        ${difficultyHtml}
      </div>
    `;

    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Initialization ---

  async function loadArticles() {
    try {
      const resp = await fetch(ARTICLES_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      articles = await resp.json();
      renderArticles();
    } catch (err) {
      articlesLoading.textContent =
        "Could not load articles. Make sure the scraper has run at least once.";
      console.error("Failed to load articles:", err);
    }
  }

  // --- Theme ---

  const themeToggle = document.getElementById("theme-toggle");
  const THEME_KEY = "ezjp_theme";

  function updateToggleLabel() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
  }

  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
    updateToggleLabel();
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem(THEME_KEY, "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem(THEME_KEY, "dark");
    }
    updateToggleLabel();
  }

  // --- Sponsor Heart Animation ---

  const sponsorLink = document.querySelector(".sponsor-link");
  let heartInterval = null;

  function spawnHeart() {
    const rect = sponsorLink.getBoundingClientRect();
    const heart = document.createElement("span");
    heart.className = "heart-particle";
    heart.textContent = "♥";
    const dx = (Math.random() - 0.5) * 30;
    const dy = -(Math.random() * 40 + 20);
    heart.style.setProperty("--dx", dx + "px");
    heart.style.setProperty("--dy", dy + "px");
    heart.style.left = (rect.left + 2) + "px";
    heart.style.top = (rect.top - 5) + "px";
    document.body.appendChild(heart);
    heart.addEventListener("animationend", () => heart.remove());
  }

  if (sponsorLink) {
    let heartTimeout = null;
    sponsorLink.addEventListener("mouseover", () => {
      if (heartInterval || heartTimeout) return;
      spawnHeart();
      heartInterval = setInterval(() => spawnHeart(), 250);
      heartTimeout = setTimeout(() => {
        clearInterval(heartInterval);
        heartInterval = null;
      }, 600);
    });
    sponsorLink.addEventListener("mouseout", () => {
      clearInterval(heartInterval);
      clearTimeout(heartTimeout);
      heartInterval = null;
      heartTimeout = null;
    });
  }

  // Event listeners
  saveBtn.addEventListener("click", saveVocab);
  clearBtn.addEventListener("click", clearVocab);
  vocabFile.addEventListener("change", handleFileUpload);
  sortSelect.addEventListener("change", renderArticles);
  themeToggle.addEventListener("click", toggleTheme);
  wkImportBtn.addEventListener("click", openWkModal);
  wkCancelBtn.addEventListener("click", closeWkModal);
  wkStartBtn.addEventListener("click", importFromWaniKani);
  wkModal.addEventListener("click", (e) => {
    if (e.target === wkModal) closeWkModal();
  });

  // Boot
  initTheme();
  loadVocab();
  loadArticles();
  refreshWaniKaniOnLoad();
})();
