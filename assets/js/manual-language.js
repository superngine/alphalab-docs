(function (root) {
  "use strict";

  const VIEWER_LANGUAGE_CODES = new Set(["ko", "en", "jp"]);
  const VIEWER_LANGUAGE_STORAGE_KEY = "manual-viewer-language";

  function normalizeViewerLanguageCode(value) {
    const normalizedValue = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    const primaryLanguage = normalizedValue.split("-")[0];

    if (primaryLanguage === "ja" || primaryLanguage === "jp") {
      return "jp";
    }
    if (VIEWER_LANGUAGE_CODES.has(primaryLanguage)) {
      return primaryLanguage;
    }
    return "";
  }

  function getNavigatorLanguageCandidates(navigatorLike) {
    const languages = Array.isArray(navigatorLike?.languages)
      ? navigatorLike.languages
      : [];
    const fallbackLanguage = navigatorLike?.language ? [navigatorLike.language] : [];
    return [...languages, ...fallbackLanguage];
  }

  function getAvailableLanguageCodeSet(availableLanguages) {
    return new Set(
      (availableLanguages || [])
        .map((language) =>
          typeof language === "string" ? language : language?.code
        )
        .filter(Boolean)
    );
  }

  function isPublishedViewerLanguage(languageCode, availableLanguages) {
    return getAvailableLanguageCodeSet(availableLanguages).has(languageCode);
  }

  function getViewerLanguageStorage(storage) {
    if (storage) {
      return storage;
    }
    try {
      return root.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function getStoredViewerLanguagePreference(storage) {
    const storageLike = getViewerLanguageStorage(storage);
    if (!storageLike || typeof storageLike.getItem !== "function") {
      return "";
    }

    try {
      return normalizeViewerLanguageCode(
        storageLike.getItem(VIEWER_LANGUAGE_STORAGE_KEY)
      );
    } catch (_error) {
      return "";
    }
  }

  function setStoredViewerLanguagePreference(languageCode, storage) {
    const viewerLanguageCode = normalizeViewerLanguageCode(languageCode);
    if (!viewerLanguageCode) {
      return false;
    }

    const storageLike = getViewerLanguageStorage(storage);
    if (!storageLike || typeof storageLike.setItem !== "function") {
      return false;
    }

    try {
      storageLike.setItem(VIEWER_LANGUAGE_STORAGE_KEY, viewerLanguageCode);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function resolveStoredViewerLanguage({ storage, availableLanguages } = {}) {
    const viewerLanguageCode = getStoredViewerLanguagePreference(storage);
    return viewerLanguageCode &&
      isPublishedViewerLanguage(viewerLanguageCode, availableLanguages)
      ? viewerLanguageCode
      : "";
  }

  function resolveBrowserViewerLanguage({
    navigator: navigatorLike,
    availableLanguages,
  } = {}) {
    const availableLanguageCodes = getAvailableLanguageCodeSet(availableLanguages);
    for (const language of getNavigatorLanguageCandidates(navigatorLike)) {
      const viewerLanguageCode = normalizeViewerLanguageCode(language);
      if (viewerLanguageCode && availableLanguageCodes.has(viewerLanguageCode)) {
        return viewerLanguageCode;
      }
    }
    return "";
  }

  function getHashParts(hash) {
    return String(hash ?? "")
      .replace(/^#\/?/, "")
      .split("/")
      .filter(Boolean);
  }

  function resolveInitialViewerLanguage({
    hash,
    defaultLanguage,
    availableLanguages,
    navigator: navigatorLike,
    storage,
  } = {}) {
    const parts = getHashParts(hash);
    if (parts.length >= 2) {
      return parts[0] || defaultLanguage;
    }
    if (parts.length === 1) {
      return defaultLanguage;
    }

    return (
      resolveStoredViewerLanguage({
        storage,
        availableLanguages,
      }) ||
      resolveBrowserViewerLanguage({
        navigator: navigatorLike,
        availableLanguages,
      }) ||
      (isPublishedViewerLanguage("ko", availableLanguages) ? "ko" : "") ||
      defaultLanguage
    );
  }

  root.ManualViewerLanguage = {
    VIEWER_LANGUAGE_STORAGE_KEY,
    getStoredViewerLanguagePreference,
    getHashParts,
    normalizeViewerLanguageCode,
    resolveBrowserViewerLanguage,
    resolveInitialViewerLanguage,
    resolveStoredViewerLanguage,
    setStoredViewerLanguagePreference,
  };
})(typeof window !== "undefined" ? window : globalThis);
