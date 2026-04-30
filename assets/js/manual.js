(function () {
  "use strict";

  let manifest = null;
  let state = { lang: "ko", version: "", pageId: "" };

  const $ = (id) => document.getElementById(id);
  const versionSelect = $("versionSelect");
  const langSelect = $("langSelect");
  const tocContainer = $("tocContainer");
  const contentLoading = $("contentLoading");
  const contentBody = $("contentBody");
  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const prevLabel = $("prevLabel");
  const nextLabel = $("nextLabel");
  const prevTitle = $("prevTitle");
  const nextTitle = $("nextTitle");
  const themeToggle = $("themeToggle");
  const html = document.documentElement;
  const IMAGE_LIGHTBOX_SCALE_MIN = 0.4;
  const IMAGE_LIGHTBOX_SCALE_MAX = 5;
  const IMAGE_LIGHTBOX_SCALE_STEP = 0.2;
  const SAFE_CANVAS_MAX_IMAGE_HEIGHT = 180;
  const SAFE_CANVAS_MIN_ASPECT_RATIO = 3.2;
  const SAFE_CANVAS_MARKER_RADIUS = 18;
  const SAFE_CANVAS_TOOLTIP_GAP = 16;
  const SAFE_CANVAS_EDGE_GAP = 4;
  const SAFE_CANVAS_MAX_PADDING = 180;
  const SAFE_CANVAS_TOOLTIP_MIN_WIDTH = 180;
  const SAFE_CANVAS_TOOLTIP_MAX_WIDTH = 560;
  let imageLightbox = null;

  const NAV_LABELS = {
    ko: { prev: "이전", next: "다음" },
    en: { prev: "Previous", next: "Next" },
    jp: { prev: "前へ", next: "次へ" },
  };

  function applyTheme(theme) {
    html.setAttribute("data-theme", theme);
    localStorage.setItem("manual-theme", theme);
    themeToggle?.setAttribute("data-state", theme);
  }

  function initTheme() {
    const saved = localStorage.getItem("manual-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved || (prefersDark ? "dark" : "light"));
  }

  function getServeHelpHtml() {
    return [
      "manifest.json 로드 실패. file:// 대신 HTTP 서버로 실행하세요.",
      "<code>python3 -m http.server 8080</code>",
    ].join("<br>");
  }

  async function init() {
    try {
      const res = await fetch("manifest.json", { cache: "no-store" });
      manifest = await res.json();
    } catch (_error) {
      showError(getServeHelpHtml(), { html: true });
      return;
    }

    buildSelectors();
    parseHash();
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    window.addEventListener("resize", refreshPreviewAnnotationSafeCanvasStages);
    contentBody.addEventListener("click", onContentImageLightboxClick);
    contentBody.addEventListener("keydown", onContentImageLightboxKeyDown);
    navigate(state.lang, state.version, state.pageId, false);
  }

  function buildSelectors() {
    versionSelect.innerHTML = "";
    manifest.versions.forEach((version) => {
      const option = document.createElement("option");
      option.value = version;
      option.textContent = manifest.versionLabels?.[version] || version;
      option.dataset.id = `version-${versionId(version)}`;
      versionSelect.appendChild(option);
    });

    renderLanguageOptions(state.version || manifest.defaultVersion);

    versionSelect.addEventListener("change", () => {
      navigate(state.lang, versionSelect.value, state.pageId);
    });
    langSelect.addEventListener("change", () => {
      navigate(langSelect.value, state.version, state.pageId);
    });
  }

  function getPublishedLanguages(version) {
    const codes =
      manifest.publishedLanguagesByVersion?.[version] ??
      (manifest.languages || []).map((item) => item.code);
    const labelMap = new Map((manifest.languages || []).map((item) => [item.code, item.label]));
    return codes.map((code) => ({ code, label: labelMap.get(code) || code }));
  }

  function getResolvedLanguage(version, preferredLanguage) {
    const available = getPublishedLanguages(version);
    if (!available.length) return preferredLanguage || manifest.defaultLanguage;
    return available.some((item) => item.code === preferredLanguage)
      ? preferredLanguage
      : available[0].code;
  }

  function renderLanguageOptions(version) {
    langSelect.innerHTML = "";
    getPublishedLanguages(version).forEach((language) => {
      const option = document.createElement("option");
      option.value = language.code;
      option.textContent = language.label;
      option.dataset.id = `language-${language.code}`;
      langSelect.appendChild(option);
    });
  }

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    state.version = manifest.defaultVersion;
    state.lang = manifest.defaultLanguage;
    state.pageId = getFirstPageId();

    if (parts.length >= 3) {
      state.lang = parts[0];
      state.version = parts[1];
      state.pageId = parts[2];
    } else if (parts.length === 2) {
      state.lang = parts[0];
      state.version = parts[1];
    } else if (parts.length === 1) {
      state.pageId = parts[0];
    }

    if (!manifest.versions.includes(state.version)) {
      state.version = manifest.defaultVersion;
    }
    state.lang = getResolvedLanguage(state.version, state.lang);
  }

  function onHashChange() {
    const previous = { ...state };
    parseHash();
    if (
      previous.lang !== state.lang ||
      previous.version !== state.version ||
      previous.pageId !== state.pageId
    ) {
      renderPage();
    }
  }

  function navigate(lang, version, pageId, pushHash = true) {
    const resolvedLanguage = getResolvedLanguage(version, lang);
    const toc = getToc(resolvedLanguage, version);
    const flat = flatPages(toc);
    const resolvedPage = flat.find((page) => page.id === pageId)?.id ?? flat[0]?.id ?? pageId;

    state = { lang: resolvedLanguage, version, pageId: resolvedPage };

    if (pushHash) {
      const nextHash = `#/${state.lang}/${state.version}/${state.pageId}`;
      if (location.hash !== nextHash) {
        history.pushState(null, "", nextHash);
      }
    }

    renderPage();
  }

  function renderPage() {
    versionSelect.value = state.version;
    renderLanguageOptions(state.version);
    langSelect.value = state.lang;
    renderToc();
    loadPage();
  }

  function getToc(lang, version) {
    const resolvedLanguage = getResolvedLanguage(version, lang);
    return manifest.toc?.[version]?.[resolvedLanguage] ?? [];
  }

  function flatPages(toc) {
    return toc.flatMap((section) => section.pages || []);
  }

  function getFirstPageId() {
    return flatPages(getToc(state.lang, state.version || manifest.defaultVersion))[0]?.id ?? "overview";
  }

  function renderToc() {
    const toc = getToc(state.lang, state.version);
    tocContainer.innerHTML = "";

    toc.forEach((section) => {
      const sectionEl = document.createElement("div");
      sectionEl.className = "toc-section";
      sectionEl.dataset.component = "manual-toc-section";
      sectionEl.dataset.id = `section-${section.id}`;
      sectionEl.dataset.kind = section.kind || "folder";

      const ul = document.createElement("ul");
      ul.className = "toc-pages";
      ul.dataset.slot = "section-pages";

      if (section.kind === "document") {
        const page = (section.pages || [])[0];
        if (page) appendTocPageLink(ul, page);
        sectionEl.appendChild(ul);
        tocContainer.appendChild(sectionEl);
        return;
      }

      const titleEl = document.createElement("span");
      titleEl.className = "toc-section-title";
      titleEl.dataset.slot = "section-title";
      titleEl.textContent = section.title;
      sectionEl.appendChild(titleEl);

      (section.pages || []).forEach((page) => {
        appendTocPageLink(ul, page);
      });

      sectionEl.appendChild(ul);
      tocContainer.appendChild(sectionEl);
    });
  }

  function appendTocPageLink(ul, page) {
    const li = document.createElement("li");
    li.dataset.id = `toc-item-${page.id}`;

    const a = document.createElement("a");
    a.className = "toc-page-link" + (page.id === state.pageId ? " is-active" : "");
    a.href = `#/${state.lang}/${state.version}/${page.id}`;
    a.textContent = page.title;
    a.dataset.component = "manual-toc-link";
    a.dataset.id = `toc-link-${page.id}`;
    a.dataset.pageId = page.id;
    a.dataset.state = page.id === state.pageId ? "active" : "ready";
    li.appendChild(a);
    ul.appendChild(li);
  }

  async function loadPage() {
    const flat = flatPages(getToc(state.lang, state.version));
    const page = flat.find((item) => item.id === state.pageId);
    if (!page) {
      showError(`페이지를 찾을 수 없습니다: ${state.pageId}`);
      return;
    }

    showLoading();

    const path = `_content/${state.lang}/${state.version}/${page.file}`;
    let markdown;
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      markdown = await res.text();
    } catch (_error) {
      if (state.lang !== manifest.defaultLanguage) {
        const fallback = `_content/${manifest.defaultLanguage}/${state.version}/${page.file}`;
        try {
          const res = await fetch(fallback, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          markdown = `> **번역이 준비되지 않았습니다.** 한국어 버전을 표시합니다.\n\n${await res.text()}`;
        } catch {
          showError(`콘텐츠 파일을 불러올 수 없습니다: ${path}`);
          return;
        }
      } else {
        showError(`콘텐츠 파일을 불러올 수 없습니다: ${path}`);
        return;
      }
    }

    contentBody.innerHTML = window.ManualRenderer
      ? window.ManualRenderer.renderMarkdown(markdown, {
          assetPathMap: manifest.assetPathMap || {},
        })
      : window.marked.parse(markdown);
    contentBody.dataset.id = `content-${page.id}`;
    contentBody.style.display = "block";
    contentLoading.style.display = "none";
    window.scrollTo({ top: 0, behavior: "instant" });
    updatePageNav(flat);
    updateActiveToc();
    initPreviewImageLightboxTriggers();
  }

  function showLoading() {
    contentLoading.style.display = "flex";
    contentBody.style.display = "none";
  }

  function showError(message, options = {}) {
    contentBody[options.html ? "innerHTML" : "textContent"] = message;
    contentBody.style.display = "block";
    contentLoading.style.display = "none";
  }

  function updatePageNav(flat) {
    const index = flat.findIndex((page) => page.id === state.pageId);
    const previous = flat[index - 1];
    const next = flat[index + 1];
    const labels = NAV_LABELS[state.lang] ?? NAV_LABELS.ko;

    prevLabel.textContent = labels.prev;
    nextLabel.textContent = labels.next;
    configurePageNavButton(prevBtn, prevTitle, previous, "previous");
    configurePageNavButton(nextBtn, nextTitle, next, "next");
  }

  function configurePageNavButton(button, titleEl, page, direction) {
    button.dataset.id = `${direction}-page`;
    if (!page) {
      button.disabled = true;
      button.dataset.state = "disabled";
      titleEl.textContent = "";
      button.onclick = null;
      return;
    }

    button.disabled = false;
    button.dataset.state = "ready";
    titleEl.textContent = page.title;
    button.onclick = () => navigate(state.lang, state.version, page.id);
  }

  function updateActiveToc() {
    document.querySelectorAll(".toc-page-link").forEach((link) => {
      const active = link.dataset.pageId === state.pageId;
      link.classList.toggle("is-active", active);
      link.dataset.state = active ? "active" : "ready";
    });
  }

  function ensurePreviewImageLightbox() {
    if (imageLightbox) return imageLightbox;

    const root = document.createElement("div");
    root.className = "preview-image-lightbox";
    root.dataset.component = "preview-image-lightbox";
    root.dataset.id = "preview-image-lightbox";
    root.dataset.state = "closed";
    root.hidden = true;
    root.innerHTML = [
      '<div class="preview-image-lightbox__backdrop" data-slot="backdrop"></div>',
      '<div class="preview-image-lightbox__dialog" role="dialog" aria-modal="true" aria-label="Image preview" data-slot="dialog">',
      '<div class="preview-image-lightbox__toolbar" data-slot="toolbar">',
      '<button type="button" class="preview-image-lightbox__control" data-component="preview-image-lightbox-control" data-id="preview-lightbox-zoom-out" data-state="ready" aria-label="Zoom out">-</button>',
      '<button type="button" class="preview-image-lightbox__control" data-component="preview-image-lightbox-control" data-id="preview-lightbox-zoom-in" data-state="ready" aria-label="Zoom in">+</button>',
      '<button type="button" class="preview-image-lightbox__control" data-component="preview-image-lightbox-control" data-id="preview-lightbox-reset" data-state="ready" aria-label="Reset zoom">Reset</button>',
      '<button type="button" class="preview-image-lightbox__control" data-component="preview-image-lightbox-control" data-id="preview-lightbox-close" data-state="ready" aria-label="Close image preview">Close</button>',
      '</div>',
      '<div class="preview-image-lightbox__viewport" data-slot="viewport">',
      '<div class="preview-image-lightbox__surface" data-slot="surface"></div>',
      '</div>',
      '</div>',
    ].join("");

    document.body.appendChild(root);

    imageLightbox = {
      root,
      viewport: root.querySelector('[data-slot="viewport"]'),
      surface: root.querySelector('[data-slot="surface"]'),
      scale: 1,
      panX: 0,
      panY: 0,
      dragging: false,
      pointerId: null,
      dragStartX: 0,
      dragStartY: 0,
      dragPanX: 0,
      dragPanY: 0,
      dragMoved: false,
      pointerStartedOnSurface: false,
      suppressNextViewportClick: false,
      previousFocus: null,
    };

    root
      .querySelector('[data-id="preview-lightbox-close"]')
      ?.addEventListener("click", closePreviewImageLightbox);
    root
      .querySelector('[data-id="preview-lightbox-zoom-in"]')
      ?.addEventListener("click", () => zoomPreviewImageLightbox(IMAGE_LIGHTBOX_SCALE_STEP));
    root
      .querySelector('[data-id="preview-lightbox-zoom-out"]')
      ?.addEventListener("click", () => zoomPreviewImageLightbox(-IMAGE_LIGHTBOX_SCALE_STEP));
    root
      .querySelector('[data-id="preview-lightbox-reset"]')
      ?.addEventListener("click", resetPreviewImageLightboxTransform);
    root.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.slot === "backdrop") {
        closePreviewImageLightbox();
      }
    });
    imageLightbox.viewport?.addEventListener("wheel", onPreviewImageLightboxWheel, {
      passive: false,
    });
    imageLightbox.viewport?.addEventListener("pointerdown", onPreviewImageLightboxPointerDown);
    imageLightbox.viewport?.addEventListener("pointermove", onPreviewImageLightboxPointerMove);
    imageLightbox.viewport?.addEventListener("pointerup", onPreviewImageLightboxPointerUp);
    imageLightbox.viewport?.addEventListener("pointercancel", onPreviewImageLightboxPointerUp);
    imageLightbox.viewport?.addEventListener("click", onPreviewImageLightboxViewportClick);
    root.addEventListener("dragstart", (event) => {
      event.preventDefault();
    });
    document.addEventListener("keydown", onPreviewImageLightboxDocumentKeyDown);

    return imageLightbox;
  }

  function initPreviewImageLightboxTriggers() {
    ensurePreviewImageLightbox();

    contentBody
      .querySelectorAll(".manual-annotation-ui .manual-hotspot-stage")
      .forEach((stage, index) => {
        stage.classList.add("is-preview-lightbox-trigger");
        stage.dataset.component = "preview-image-lightbox-trigger";
        stage.dataset.id = `preview-lightbox-trigger-annotation-${index + 1}`;
        stage.dataset.state = "ready";
        stage.setAttribute("role", "button");
        stage.setAttribute("tabindex", "0");
        stage.setAttribute("aria-label", "Open annotation image preview");
      });

    Array.from(contentBody.querySelectorAll("img"))
      .filter((image) => !image.closest(".manual-hotspot-stage"))
      .filter((image) => !image.closest("a[href]"))
      .forEach((image, index) => {
        image.classList.add("is-preview-lightbox-trigger");
        image.dataset.component = "preview-image-lightbox-trigger";
        image.dataset.id = `preview-lightbox-trigger-image-${index + 1}`;
        image.dataset.state = "ready";
        image.setAttribute("role", "button");
        image.setAttribute("tabindex", "0");
        image.setAttribute("aria-label", "Open image preview");
      });

    initPreviewAnnotationSafeCanvasStages();
  }

  function initPreviewAnnotationSafeCanvasStages() {
    contentBody
      .querySelectorAll(".manual-annotation-ui .manual-hotspot-stage")
      .forEach((stage) => {
        const image = stage.querySelector("img");
        if (!(image instanceof HTMLImageElement)) return;
        if (!stage.__annotationSafeCanvasBound) {
          image.addEventListener("load", () => refreshPreviewAnnotationSafeCanvasStage(stage));
          stage.__annotationSafeCanvasBound = true;
        }
        if (image.complete) {
          refreshPreviewAnnotationSafeCanvasStage(stage);
        }
      });
  }

  function refreshPreviewAnnotationSafeCanvasStages() {
    contentBody
      .querySelectorAll(".manual-annotation-ui .manual-hotspot-stage")
      .forEach((stage) => refreshPreviewAnnotationSafeCanvasStage(stage));
  }

  function refreshPreviewAnnotationSafeCanvasStage(stage) {
    const image = stage.querySelector("img");
    if (!(image instanceof HTMLImageElement) || !image.complete) return;

    const imageRect = image.getBoundingClientRect();
    const imageWidth = imageRect.width;
    const imageHeight = imageRect.height;
    const aspectRatio = imageHeight > 0 ? imageWidth / imageHeight : 0;
    const imageAspectRatio = getPreviewImageAspectRatio(image);
    const shouldUseSafeCanvas =
      imageHeight > 0 &&
      imageHeight <= SAFE_CANVAS_MAX_IMAGE_HEIGHT &&
      aspectRatio >= SAFE_CANVAS_MIN_ASPECT_RATIO;

    if (!shouldUseSafeCanvas) {
      resetPreviewAnnotationSafeCanvasStage(stage);
      return;
    }

    stage.classList.add("is-tooltip-safe-canvas");
    stage.dataset.state = "tooltip-safe-canvas";

    const padding = measurePreviewAnnotationSafeCanvasPadding(
      stage,
      imageWidth,
      imageHeight
    );
    stage.style.setProperty("--safe-canvas-padding-top", `${padding.top}px`);
    stage.style.setProperty("--safe-canvas-padding-bottom", `${padding.bottom}px`);

    stage.querySelectorAll(".manual-hotspot-marker").forEach((marker) => {
      const x = readMarkerPercent(marker, "x");
      const y = readMarkerPercent(marker, "y");
      const markerY = clamp(
        (imageHeight * y) / 100,
        SAFE_CANVAS_MARKER_RADIUS,
        Math.max(SAFE_CANVAS_MARKER_RADIUS, imageHeight - SAFE_CANVAS_MARKER_RADIUS)
      );
      marker.style.left = `clamp(18px, ${x}%, calc(100% - 18px))`;
      marker.style.top = `${padding.top + markerY}px`;
    });

    stage.querySelectorAll(".manual-hotspot-shape").forEach((shape) => {
      const x = readShapePercent(shape, "x");
      const y = readShapePercent(shape, "y");
      const offsetX = readShapePercent(shape, "offsetX");
      const offsetY = readShapePercent(shape, "offsetY");
      const dimensions = readRenderedShapePercent(shape, imageAspectRatio);
      const shapeCenterY = clamp(
        (imageHeight * (y + offsetY)) / 100,
        0,
        imageHeight
      );

      shape.style.left = `${x + offsetX}%`;
      shape.style.top = `${padding.top + shapeCenterY}px`;
      shape.style.width = `${dimensions.width}%`;
      shape.style.height = `${(imageHeight * dimensions.height) / 100}px`;
    });
  }

  function measurePreviewAnnotationSafeCanvasPadding(stage, imageWidth, imageHeight) {
    let top = 0;
    let bottom = 0;

    stage.querySelectorAll(".manual-hotspot-marker").forEach((marker) => {
      const tooltip = marker.querySelector(".manual-hotspot-tooltip");
      if (!(tooltip instanceof HTMLElement)) return;

      const x = readMarkerPercent(marker, "x");
      const y = readMarkerPercent(marker, "y");
      const markerX = clamp(
        (imageWidth * x) / 100,
        SAFE_CANVAS_MARKER_RADIUS,
        Math.max(SAFE_CANVAS_MARKER_RADIUS, imageWidth - SAFE_CANVAS_MARKER_RADIUS)
      );
      const markerY = clamp(
        (imageHeight * y) / 100,
        SAFE_CANVAS_MARKER_RADIUS,
        Math.max(SAFE_CANVAS_MARKER_RADIUS, imageHeight - SAFE_CANVAS_MARKER_RADIUS)
      );
      const tooltipMaxWidth = getPreviewTooltipSafeWidth(x, imageWidth, markerX);
      tooltip.style.setProperty("--tooltip-width", "max-content");
      tooltip.style.setProperty("--tooltip-max-width", `${tooltipMaxWidth}px`);
      const tooltipHeight = measurePreviewTooltipHeight(tooltip);
      const tooltipExtent =
        SAFE_CANVAS_MARKER_RADIUS +
        SAFE_CANVAS_TOOLTIP_GAP +
        tooltipHeight +
        SAFE_CANVAS_EDGE_GAP;

      if (y <= 50) {
        bottom = Math.max(bottom, markerY + tooltipExtent - imageHeight);
      } else {
        top = Math.max(top, tooltipExtent - markerY);
      }
    });

    return {
      top: Math.round(clamp(top, 0, SAFE_CANVAS_MAX_PADDING)),
      bottom: Math.round(clamp(bottom, 0, SAFE_CANVAS_MAX_PADDING)),
    };
  }

  function getPreviewTooltipSafeWidth(markerXPercent, imageWidth, markerX) {
    const horizontalPadding = SAFE_CANVAS_EDGE_GAP + SAFE_CANVAS_MARKER_RADIUS;
    let availableWidth;

    if (markerXPercent <= 28) {
      availableWidth = imageWidth - markerX - horizontalPadding;
    } else if (markerXPercent >= 72) {
      availableWidth = markerX - horizontalPadding;
    } else {
      availableWidth =
        Math.min(markerX, imageWidth - markerX) * 2 - horizontalPadding * 2;
    }

    return Math.round(
      clamp(
        availableWidth,
        SAFE_CANVAS_TOOLTIP_MIN_WIDTH,
        SAFE_CANVAS_TOOLTIP_MAX_WIDTH
      )
    );
  }

  function measurePreviewTooltipHeight(tooltip) {
    const previousVisibility = tooltip.style.visibility;
    const previousOpacity = tooltip.style.opacity;
    const previousTransition = tooltip.style.transition;
    const previousPointerEvents = tooltip.style.pointerEvents;

    tooltip.style.visibility = "hidden";
    tooltip.style.opacity = "1";
    tooltip.style.transition = "none";
    tooltip.style.pointerEvents = "none";

    const rect = tooltip.getBoundingClientRect();
    const height = rect.height || tooltip.scrollHeight || 0;

    tooltip.style.visibility = previousVisibility;
    tooltip.style.opacity = previousOpacity;
    tooltip.style.transition = previousTransition;
    tooltip.style.pointerEvents = previousPointerEvents;

    return height;
  }

  function resetPreviewAnnotationSafeCanvasStage(stage) {
    const image = stage.querySelector("img");
    const imageAspectRatio =
      image instanceof HTMLImageElement ? getPreviewImageAspectRatio(image) : 1;

    stage.classList.remove("is-tooltip-safe-canvas");
    if (stage.dataset.state === "tooltip-safe-canvas") {
      stage.dataset.state = "ready";
    }
    stage.style.removeProperty("--safe-canvas-padding-y");
    stage.style.removeProperty("--safe-canvas-padding-top");
    stage.style.removeProperty("--safe-canvas-padding-bottom");
    stage.querySelectorAll(".manual-hotspot-tooltip").forEach((tooltip) => {
      tooltip.style.removeProperty("--tooltip-width");
      tooltip.style.removeProperty("--tooltip-max-width");
    });
    stage.querySelectorAll(".manual-hotspot-marker").forEach((marker) => {
      const x = readMarkerPercent(marker, "x");
      const y = readMarkerPercent(marker, "y");
      marker.style.left = `clamp(18px, ${x}%, calc(100% - 18px))`;
      marker.style.top = `clamp(18px, ${y}%, calc(100% - 18px))`;
    });
    stage.querySelectorAll(".manual-hotspot-shape").forEach((shape) => {
      const x = readShapePercent(shape, "x");
      const y = readShapePercent(shape, "y");
      const offsetX = readShapePercent(shape, "offsetX");
      const offsetY = readShapePercent(shape, "offsetY");
      const dimensions = readRenderedShapePercent(shape, imageAspectRatio);

      shape.style.left = `${x + offsetX}%`;
      shape.style.top = `${y + offsetY}%`;
      shape.style.width = `${dimensions.width}%`;
      shape.style.height = `${dimensions.height}%`;
    });
  }

  function readMarkerPercent(marker, axis) {
    const rawValue = axis === "x" ? marker.dataset.x : marker.dataset.y;
    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue)) {
      return clamp(numericValue, 0, 100);
    }
    return 50;
  }

  function readShapePercent(shape, axis) {
    let rawValue = "";
    if (axis === "x") rawValue = shape.dataset.x;
    else if (axis === "y") rawValue = shape.dataset.y;
    else if (axis === "offsetX") rawValue = shape.dataset.offsetX;
    else if (axis === "offsetY") rawValue = shape.dataset.offsetY;
    else if (axis === "width") rawValue = shape.dataset.width;
    else rawValue = shape.dataset.height;

    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
    return axis === "width" ? 24 : axis === "height" ? 18 : 0;
  }

  function getPreviewImageAspectRatio(image) {
    const naturalWidth = image.naturalWidth || image.clientWidth || image.getBoundingClientRect().width;
    const naturalHeight = image.naturalHeight || image.clientHeight || image.getBoundingClientRect().height;
    const aspectRatio = naturalWidth / naturalHeight;
    return Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  }

  function readRenderedShapePercent(shape, imageAspectRatio) {
    const width = readShapePercent(shape, "width");
    const height = readShapePercent(shape, "height");

    if (
      !shape.classList.contains("manual-hotspot-shape--circle") ||
      !Number.isFinite(imageAspectRatio) ||
      imageAspectRatio <= 0
    ) {
      return { width, height };
    }

    return {
      width: Math.min(width, height / imageAspectRatio),
      height: Math.min(height, width * imageAspectRatio),
    };
  }

  function onContentImageLightboxClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(".manual-hotspot-marker")) return;

    const trigger = target.closest('[data-component="preview-image-lightbox-trigger"]');
    if (!(trigger instanceof HTMLElement) || !contentBody.contains(trigger)) return;
    if (trigger.tagName === "IMG" && trigger.closest("a[href]")) return;

    event.preventDefault();
    event.stopPropagation();
    openPreviewImageLightbox(trigger);
  }

  function onContentImageLightboxKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const trigger = target.closest('[data-component="preview-image-lightbox-trigger"]');
    if (trigger !== target || !contentBody.contains(trigger)) return;

    event.preventDefault();
    openPreviewImageLightbox(trigger);
  }

  function openPreviewImageLightbox(trigger) {
    const lightbox = ensurePreviewImageLightbox();
    const content = createPreviewImageLightboxContent(trigger);
    if (!content) return;

    lightbox.surface.replaceChildren(content);
    lightbox.previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lightbox.root.hidden = false;
    lightbox.root.dataset.state = "open";
    document.body.classList.add("has-preview-image-lightbox");
    resetPreviewImageLightboxTransform();
    lightbox.root.querySelector('[data-id="preview-lightbox-close"]')?.focus();
  }

  function createPreviewImageLightboxContent(trigger) {
    if (trigger.classList.contains("manual-hotspot-stage")) {
      const stage = trigger.cloneNode(true);
      stage.classList.remove("is-preview-lightbox-trigger");
      resetPreviewAnnotationSafeCanvasStage(stage);
      stage.removeAttribute("role");
      stage.removeAttribute("tabindex");
      stage.removeAttribute("aria-label");
      stage.dataset.component = "preview-image-lightbox-hotspot-stage";
      stage.dataset.id = "preview-lightbox-hotspot-stage";
      stage.dataset.state = "ready";
      stage.querySelectorAll("img").forEach((image) => {
        image.draggable = false;
        image.setAttribute("draggable", "false");
      });
      return stage;
    }

    if (trigger instanceof HTMLImageElement) {
      const image = trigger.cloneNode(false);
      image.classList.remove("is-preview-lightbox-trigger");
      image.classList.add("preview-image-lightbox__image");
      image.removeAttribute("role");
      image.removeAttribute("tabindex");
      image.removeAttribute("aria-label");
      image.dataset.component = "preview-image-lightbox-image";
      image.dataset.id = "preview-lightbox-image";
      image.dataset.state = "ready";
      image.loading = "eager";
      image.draggable = false;
      image.setAttribute("draggable", "false");
      return image;
    }

    return null;
  }

  function closePreviewImageLightbox() {
    if (!imageLightbox || imageLightbox.root.dataset.state !== "open") return;
    imageLightbox.root.dataset.state = "closed";
    imageLightbox.root.hidden = true;
    imageLightbox.surface.replaceChildren();
    document.body.classList.remove("has-preview-image-lightbox");
    resetPreviewImageLightboxTransform();
    if (imageLightbox.previousFocus && document.contains(imageLightbox.previousFocus)) {
      imageLightbox.previousFocus.focus();
    }
    imageLightbox.previousFocus = null;
  }

  function onPreviewImageLightboxDocumentKeyDown(event) {
    if (event.key === "Escape") {
      closePreviewImageLightbox();
    }
  }

  function zoomPreviewImageLightbox(delta) {
    if (!imageLightbox || imageLightbox.root.dataset.state !== "open") return;
    imageLightbox.scale = clamp(
      imageLightbox.scale + delta,
      IMAGE_LIGHTBOX_SCALE_MIN,
      IMAGE_LIGHTBOX_SCALE_MAX
    );
    applyPreviewImageLightboxTransform();
  }

  function resetPreviewImageLightboxTransform() {
    if (!imageLightbox) return;
    imageLightbox.scale = 1;
    imageLightbox.panX = 0;
    imageLightbox.panY = 0;
    imageLightbox.dragging = false;
    imageLightbox.pointerId = null;
    imageLightbox.dragMoved = false;
    imageLightbox.pointerStartedOnSurface = false;
    imageLightbox.suppressNextViewportClick = false;
    applyPreviewImageLightboxTransform();
  }

  function applyPreviewImageLightboxTransform() {
    if (!imageLightbox) return;
    imageLightbox.surface.style.transform =
      `translate(${imageLightbox.panX}px, ${imageLightbox.panY}px) scale(${imageLightbox.scale})`;
    imageLightbox.surface.dataset.scale = String(Math.round(imageLightbox.scale * 100));
    imageLightbox.surface
      .querySelectorAll(".manual-hotspot-stage")
      .forEach((stage) => stage.style.setProperty("--preview-lightbox-scale", String(imageLightbox.scale)));
  }

  function onPreviewImageLightboxWheel(event) {
    if (!imageLightbox || imageLightbox.root.dataset.state !== "open") return;
    event.preventDefault();
    zoomPreviewImageLightbox(event.deltaY < 0 ? IMAGE_LIGHTBOX_SCALE_STEP : -IMAGE_LIGHTBOX_SCALE_STEP);
  }

  function onPreviewImageLightboxPointerDown(event) {
    if (!imageLightbox || imageLightbox.root.dataset.state !== "open") return;
    const target = event.target;
    if (
      event.button !== 0 ||
      (target instanceof Element && target.closest(".manual-hotspot-marker"))
    ) {
      return;
    }

    imageLightbox.dragging = true;
    imageLightbox.pointerId = event.pointerId;
    imageLightbox.pointerStartedOnSurface =
      target instanceof Element && Boolean(target.closest('[data-slot="surface"]'));
    imageLightbox.dragStartX = event.clientX;
    imageLightbox.dragStartY = event.clientY;
    imageLightbox.dragPanX = imageLightbox.panX;
    imageLightbox.dragPanY = imageLightbox.panY;
    imageLightbox.dragMoved = false;
    imageLightbox.viewport.setPointerCapture?.(event.pointerId);
    imageLightbox.viewport.dataset.state = "dragging";
  }

  function onPreviewImageLightboxPointerMove(event) {
    if (
      !imageLightbox ||
      !imageLightbox.dragging ||
      imageLightbox.pointerId !== event.pointerId
    ) {
      return;
    }

    imageLightbox.panX = imageLightbox.dragPanX + event.clientX - imageLightbox.dragStartX;
    imageLightbox.panY = imageLightbox.dragPanY + event.clientY - imageLightbox.dragStartY;
    if (
      Math.abs(event.clientX - imageLightbox.dragStartX) > 3 ||
      Math.abs(event.clientY - imageLightbox.dragStartY) > 3
    ) {
      imageLightbox.dragMoved = true;
    }
    applyPreviewImageLightboxTransform();
  }

  function onPreviewImageLightboxPointerUp(event) {
    if (!imageLightbox || imageLightbox.pointerId !== event.pointerId) return;
    if (imageLightbox.dragMoved) {
      imageLightbox.suppressNextViewportClick = true;
    }
    imageLightbox.dragging = false;
    imageLightbox.pointerId = null;
    imageLightbox.viewport.releasePointerCapture?.(event.pointerId);
    imageLightbox.viewport.dataset.state = "ready";
  }

  function onPreviewImageLightboxViewportClick(event) {
    if (!imageLightbox || imageLightbox.root.dataset.state !== "open") return;
    if (imageLightbox.suppressNextViewportClick) {
      imageLightbox.suppressNextViewportClick = false;
      return;
    }

    const target = event.target;
    if (
      imageLightbox.pointerStartedOnSurface ||
      (target instanceof Element && target.closest('[data-slot="surface"]'))
    ) {
      imageLightbox.pointerStartedOnSurface = false;
      return;
    }

    closePreviewImageLightbox();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function versionId(version) {
    return String(version).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      applyTheme(html.getAttribute("data-theme") === "light" ? "dark" : "light");
    });
  }

  initTheme();
  document.addEventListener("DOMContentLoaded", init);
})();
