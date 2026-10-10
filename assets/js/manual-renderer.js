(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  }

  function resolveAssetUrl(rawUrl, options) {
    if (!rawUrl || !String(rawUrl).startsWith('manual-asset://')) {
      return rawUrl;
    }
    const assetId = String(rawUrl).replace('manual-asset://', '');
    if (typeof options.resolveAssetUrl === 'function') {
      return options.resolveAssetUrl(assetId) || rawUrl;
    }
    if (options.assetPathMap && options.assetPathMap[assetId]) {
      return options.assetPathMap[assetId];
    }
    return rawUrl;
  }

  function normalizeAnnotationLanguageCode(languageCode, fallback) {
    const primary = String(languageCode ?? '')
      .trim()
      .toLowerCase()
      .replace(/_/g, '-')
      .split('-')[0];
    if (primary === 'jp') return 'ja';
    if (/^[a-z][a-z0-9-]{0,15}$/.test(primary)) return primary;
    return fallback ? normalizeAnnotationLanguageCode(fallback, '') : '';
  }

  function resolveAnnotationConfigForLanguage(config, options = {}) {
    const sourceLanguageCode =
      normalizeAnnotationLanguageCode(config.sourceLanguageCode) || 'ko';
    const languageCode =
      normalizeAnnotationLanguageCode(options.languageCode, sourceLanguageCode) ||
      sourceLanguageCode;
    const image = resolveAnnotationImageForLanguage(config, {
      languageCode,
      sourceLanguageCode,
    });
    const points = Array.isArray(config.points)
      ? config.points.map((point, index) =>
          resolveAnnotationPointForLanguage(point, {
            languageCode,
            sourceLanguageCode,
            index,
          })
        )
      : [];

    return {
      ...config,
      asset: image.asset,
      alt: image.imageTitle,
      imageAssetId: image.imageAssetId,
      imageSrc: image.imageSrc,
      imageTitle: image.imageTitle,
      points,
    };
  }

  function resolveAnnotationImageForLanguage(config, languageContext) {
    const baseImage = readBaseAnnotationImage(config);
    const imageByLanguage = readAnnotationImageByLanguage(config);
    const selectedImage =
      languageContext.languageCode === languageContext.sourceLanguageCode
        ? null
        : imageByLanguage[languageContext.languageCode] || null;
    const sourceImage = imageByLanguage[languageContext.sourceLanguageCode] || null;
    return selectedImage || sourceImage || baseImage;
  }

  function resolveAnnotationPointForLanguage(point, languageContext) {
    const sourcePoint = point && typeof point === 'object' ? point : {};
    const label = resolveAnnotationTextField(sourcePoint, 'label', languageContext);
    const title = resolveAnnotationTextField(sourcePoint, 'title', languageContext);
    const description = resolveAnnotationTextField(
      sourcePoint,
      'description',
      languageContext
    );

    return {
      ...sourcePoint,
      id: sourcePoint.id || `point-${(Number(languageContext.index) || 0) + 1}`,
      label,
      title,
      description,
      body: description,
    };
  }

  function resolveAnnotationTextField(point, field, languageContext) {
    const selected = readLocalizedAnnotationText(
      point,
      field,
      languageContext.languageCode
    );
    if (selected.hasValue) return selected.value;

    const source = readLocalizedAnnotationText(
      point,
      field,
      languageContext.sourceLanguageCode
    );
    if (source.hasValue) return source.value;

    const aliases = field === 'description' ? ['description', 'body'] : [field];
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(point, alias) && typeof point[alias] === 'string') {
        return point[alias];
      }
    }
    return '';
  }

  function readLocalizedAnnotationText(point, field, languageCode) {
    const textByLanguage = normalizeAnnotationTextByLanguage(
      point.textByLanguage || point.translations || point.i18n
    );
    const text = textByLanguage[languageCode];
    const aliases = field === 'description' ? ['description', 'body'] : [field];
    for (const alias of aliases) {
      if (text && Object.prototype.hasOwnProperty.call(text, alias) && typeof text[alias] === 'string') {
        return { hasValue: true, value: text[alias] };
      }
    }

    const mapKeys = aliases.flatMap((alias) => [`${alias}ByLanguage`, `${alias}ByLang`, alias]);
    for (const key of mapKeys) {
      const map = point[key];
      if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
      for (const [rawLanguageCode, value] of Object.entries(map)) {
        if (
          normalizeAnnotationLanguageCode(rawLanguageCode) === languageCode &&
          typeof value === 'string'
        ) {
          return { hasValue: true, value };
        }
      }
    }

    return { hasValue: false, value: '' };
  }

  function normalizeAnnotationTextByLanguage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const [rawLanguageCode, rawText] of Object.entries(value)) {
      const languageCode = normalizeAnnotationLanguageCode(rawLanguageCode);
      if (!languageCode || !rawText || typeof rawText !== 'object' || Array.isArray(rawText)) continue;
      result[languageCode] = rawText;
    }
    return result;
  }

  function readAnnotationImageByLanguage(config) {
    const raw =
      config.imageByLanguage || config.imagesByLanguage || config.imageOverrides;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result = {};
    for (const [rawLanguageCode, rawImage] of Object.entries(raw)) {
      const languageCode = normalizeAnnotationLanguageCode(rawLanguageCode);
      const image = normalizeAnnotationImageOverride(rawImage);
      if (languageCode && image) result[languageCode] = image;
    }
    return result;
  }

  function readBaseAnnotationImage(config) {
    const asset = config.asset || config.imageSrc || '';
    const imageAssetId = config.imageAssetId || extractManualAssetId(asset);
    const imageSrc = config.imageSrc || asset;
    const imageTitle = config.imageTitle || config.alt || config.title || 'Annotation image';
    return {
      imageAssetId,
      imageSrc,
      imageTitle,
      asset: imageAssetId ? `manual-asset://${imageAssetId}` : imageSrc,
    };
  }

  function normalizeAnnotationImageOverride(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rawAsset = value.asset || value.imageSrc || value.src || value.url || '';
    const imageAssetId = value.imageAssetId || value.assetId || extractManualAssetId(rawAsset);
    const imageSrc = value.imageSrc || value.src || rawAsset;
    if (!imageAssetId && !imageSrc) return null;
    return {
      imageAssetId,
      imageSrc,
      imageTitle: value.imageTitle || value.title || value.alt || 'Annotation image',
      asset: imageAssetId ? `manual-asset://${imageAssetId}` : imageSrc,
    };
  }

  function extractManualAssetId(value) {
    const raw = String(value ?? '');
    return raw.startsWith('manual-asset://') ? raw.replace(/^manual-asset:\/\//, '') : '';
  }

  function resolvePointColor(rawColor) {
    const value = String(rawColor ?? '').trim();
    const hexColor = resolveHexColor(value);
    if (hexColor) {
      return hexColor;
    }
    return resolveRgbColor(value);
  }

  function resolveHexColor(value) {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
      ? value.toLowerCase()
      : '';
  }

  function resolveRgbColor(value) {
    const match = value.match(/^rgba?\(\s*([.\d]+%?)\s*,\s*([.\d]+%?)\s*,\s*([.\d]+%?)(?:\s*,\s*([.\d]+%?))?\s*\)$/i);
    if (!match) {
      return '';
    }

    const red = normalizeCssColorChannel(match[1]);
    const green = normalizeCssColorChannel(match[2]);
    const blue = normalizeCssColorChannel(match[3]);
    const alpha = normalizeCssAlpha(match[4] ?? '1');

    if (!red || !green || !blue || !alpha) {
      return '';
    }

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function normalizeCssColorChannel(value) {
    if (String(value).endsWith('%')) {
      const percent = Number.parseFloat(value);
      return Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? `${formatCssNumber(percent)}%`
        : '';
    }

    const channel = Number.parseFloat(value);
    return Number.isFinite(channel) && channel >= 0 && channel <= 255
      ? String(Math.round(channel))
      : '';
  }

  function normalizeCssAlpha(value) {
    if (String(value).endsWith('%')) {
      const percent = Number.parseFloat(value);
      return Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? `${formatCssNumber(percent)}%`
        : '';
    }

    const alpha = Number.parseFloat(value);
    return Number.isFinite(alpha) && alpha >= 0 && alpha <= 1
      ? formatCssNumber(alpha)
      : '';
  }

  function formatCssNumber(value) {
    return Number(value.toFixed(3)).toString();
  }

  function extractYouTubeEmbed(url) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
      const host = parsed.hostname.replace(/^www\./, '');
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        if (parsed.pathname === '/watch') {
          const videoId = parsed.searchParams.get('v');
          return videoId && /^[\w-]+$/.test(videoId)
            ? `https://www.youtube.com/embed/${videoId}`
            : null;
        }
        const shortsMatch = /^\/shorts\/([\w-]+)\/?$/.exec(parsed.pathname);
        return shortsMatch ? `https://www.youtube.com/embed/${shortsMatch[1]}` : null;
      }
      if (host === 'youtu.be') {
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        return pathParts.length === 1 && /^[\w-]+$/.test(pathParts[0])
          ? `https://www.youtube.com/embed/${pathParts[0]}`
          : null;
      }
    } catch (_error) {
      return null;
    }
    return null;
  }

  function renderVideoBlock(config, options) {
    if (!config || !config.url) {
      return '<div class="manual-rich-error">Invalid manual-video block</div>';
    }
    const caption = config.caption ? `<figcaption>${escapeHtml(config.caption)}</figcaption>` : '';
    const sourceType = config.sourceType || 'direct';
    if (sourceType === 'youtube') {
      const embedUrl = extractYouTubeEmbed(config.url);
      if (!embedUrl) {
        return '<div class="manual-rich-error">Unsupported YouTube URL</div>';
      }
      return [
        '<figure class="manual-rich-video" data-component="manual-video-block">',
        `<div class="manual-video-embed"><iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(config.title || config.caption || 'YouTube video')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`,
        caption,
        '</figure>',
      ].join('');
    }
    const videoUrl = resolveAssetUrl(config.url, options);
    const poster = config.poster ? ` poster="${escapeHtml(resolveAssetUrl(config.poster, options))}"` : '';
    return [
      '<figure class="manual-rich-video" data-component="manual-video-block">',
      `<video controls preload="metadata"${poster} src="${escapeHtml(videoUrl)}"></video>`,
      caption,
      '</figure>',
    ].join('');
  }

  function renderManualTableBlock(config, options) {
    const rows = Array.isArray(config?.rows) ? config.rows : [];
    if (!rows.length) {
      return '<div class="manual-rich-error">Invalid manual-table block</div>';
    }

    const normalizedRows = rows
      .map((row) => ({
        cells: Array.isArray(row?.cells) ? row.cells : [],
      }))
      .filter((row) => row.cells.length > 0);

    if (!normalizedRows.length) {
      return '<div class="manual-rich-error">Invalid manual-table block</div>';
    }

    const firstRowIsHeader = normalizedRows[0].cells.some((cell) => cell?.header === true);
    const headHtml = firstRowIsHeader
      ? `<thead>${renderManualTableRow(normalizedRows[0], options, true)}</thead>`
      : '';
    const bodyRows = firstRowIsHeader ? normalizedRows.slice(1) : normalizedRows;
    const bodyHtml = bodyRows.map((row) => renderManualTableRow(row, options, false)).join('');
    const colgroupHtml = renderManualTableColgroup(normalizedRows);

    return [
      '<table data-component="manual-table-block">',
      colgroupHtml,
      headHtml,
      `<tbody>${bodyHtml}</tbody>`,
      '</table>',
    ].join('');
  }

  function renderManualTableColgroup(rows) {
    const widths = deriveManualTableColumnWidths(rows);
    if (!widths.some((width) => width > 0)) return '';

    return [
      '<colgroup>',
      widths.map((width) => {
        return width > 0
          ? `<col style="width:${width}px">`
          : '<col>';
      }).join(''),
      '</colgroup>',
    ].join('');
  }

  function deriveManualTableColumnWidths(rows) {
    const widths = [];
    let activeRowspans = [];

    rows.forEach((row) => {
      let columnIndex = 0;
      row.cells.forEach((cell) => {
        while (activeRowspans[columnIndex] > 0) {
          columnIndex += 1;
        }

        const colspan = normalizeTableSpan(cell?.colspan);
        const rowspan = normalizeTableSpan(cell?.rowspan);
        const colwidth = normalizeTableColwidth(cell?.colwidth);

        for (let offset = 0; offset < colspan; offset += 1) {
          const width = colwidth[offset];
          if (width > 0 && !(widths[columnIndex + offset] > 0)) {
            widths[columnIndex + offset] = width;
          }
          if (rowspan > 1) {
            activeRowspans[columnIndex + offset] = Math.max(
              activeRowspans[columnIndex + offset] || 0,
              rowspan
            );
          }
        }

        columnIndex += colspan;
      });

      activeRowspans = activeRowspans.map((rowspan) => Math.max(0, (rowspan || 0) - 1));
    });

    return widths;
  }

  function renderManualTableRow(row, options, forceHeader) {
    return `<tr>${row.cells.map((cell) => renderManualTableCell(cell, options, forceHeader)).join('')}</tr>`;
  }

  function renderManualTableCell(cell, options, forceHeader) {
    const tagName = forceHeader || cell?.header === true ? 'th' : 'td';
    const attrs = [
      renderTableSpanAttribute('colspan', cell?.colspan),
      renderTableSpanAttribute('rowspan', cell?.rowspan),
      renderTableAlignAttribute(cell?.align),
    ].filter(Boolean).join('');
    const contentHtml = Array.isArray(cell?.content)
      ? renderTiptapContent(cell.content, options)
      : renderMarkdownFragment(cell?.markdown, options);
    return `<${tagName}${attrs}>${contentHtml}</${tagName}>`;
  }

  function renderTiptapContent(content, options) {
    return Array.isArray(content)
      ? content.map((node) => renderTiptapNode(node, options)).join('')
      : '';
  }

  function renderTiptapNode(node, options) {
    if (!node || typeof node !== 'object') return '';

    switch (node.type) {
      case 'text':
        return renderTiptapText(node);
      case 'paragraph':
        return `<p>${renderTiptapContent(node.content, options)}</p>`;
      case 'heading': {
        const level = Math.round(clampNumber(Number(node.attrs?.level ?? 2), 1, 6));
        return `<h${level}>${renderTiptapContent(node.content, options)}</h${level}>`;
      }
      case 'hardBreak':
        return '<br>';
      case 'bulletList':
        return `<ul>${renderTiptapContent(node.content, options)}</ul>`;
      case 'orderedList': {
        const start = Number(node.attrs?.start);
        const startAttr = Number.isInteger(start) && start > 1 ? ` start="${start}"` : '';
        return `<ol${startAttr}>${renderTiptapContent(node.content, options)}</ol>`;
      }
      case 'listItem':
        return `<li>${renderTiptapContent(node.content, options)}</li>`;
      case 'blockquote':
        return `<blockquote>${renderTiptapContent(node.content, options)}</blockquote>`;
      case 'codeBlock':
        return `<pre><code>${escapeHtml(renderPlainTiptapText(node))}</code></pre>`;
      case 'image':
        return renderTiptapImageNode(node, options);
      case 'manualAssetNode':
        return renderTiptapManualAssetNode(node, options);
      case 'annotationAssetNode':
        return renderTiptapAnnotationAssetNode(node, options);
      case 'youtube':
        return renderVideoBlock(
          { sourceType: 'youtube', url: node.attrs?.src },
          options
        );
      default:
        return renderTiptapContent(node.content, options);
    }
  }

  function renderTiptapText(node) {
    const marks = Array.isArray(node.marks) ? node.marks : [];
    return marks.reduce(
      (html, mark) => wrapTiptapMark(html, mark),
      escapeHtml(node.text || '')
    );
  }

  function wrapTiptapMark(html, mark) {
    if (!mark || typeof mark !== 'object') return html;
    if (mark.type === 'bold') return `<strong>${html}</strong>`;
    if (mark.type === 'italic') return `<em>${html}</em>`;
    if (mark.type === 'strike') return `<s>${html}</s>`;
    if (mark.type === 'code') return `<code>${html}</code>`;
    if (mark.type === 'underline') return `<u>${html}</u>`;
    if (mark.type === 'subscript') return `<sub>${html}</sub>`;
    if (mark.type === 'superscript') return `<sup>${html}</sup>`;
    if (mark.type === 'highlight') {
      const color = sanitizeManualHighlightColor(mark.attrs?.color);
      return `<mark class="manual-highlight" data-component="manual-highlight" style="--manual-highlight-color: ${escapeHtml(color)};">${html}</mark>`;
    }
    if (mark.type === 'link') {
      const href = sanitizeHref(mark.attrs?.href);
      return href ? `<a href="${escapeHtml(href)}">${html}</a>` : html;
    }
    return html;
  }

  function sanitizeHref(value) {
    const href = String(value ?? '').trim();
    return /^(https?:\/\/|mailto:|#|\/)/i.test(href) ? href : '';
  }

  function renderPlainTiptapText(node) {
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'text') return node.text || '';
    return Array.isArray(node.content)
      ? node.content.map(renderPlainTiptapText).join('')
      : '';
  }

  function renderTiptapImageNode(node, options) {
    const src = resolveAssetUrl(node.attrs?.src, options);
    return src
      ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.attrs?.alt || 'Image')}" loading="lazy" />`
      : '';
  }

  function renderTiptapManualAssetNode(node, options) {
    const attrs = node.attrs || {};
    const kind = attrs.kind || 'image';
    const source = attrs.assetId ? `manual-asset://${attrs.assetId}` : attrs.src;
    const url = resolveAssetUrl(source, options);
    const title = attrs.title || attrs.fileName || 'Manual asset';
    if (!url) return '';
    if (kind === 'image') {
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" loading="lazy" />`;
    }
    if (kind === 'video') {
      return `<video controls preload="metadata" src="${escapeHtml(url)}"></video>`;
    }
    return `<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`;
  }

  function renderTiptapAnnotationAssetNode(node, options) {
    const attrs = node.attrs || {};
    const resolvedAttrs = resolveAnnotationConfigForLanguage(attrs, options);
    return renderHotspotBlock(
      {
        asset: resolvedAttrs.asset || `manual-asset://${resolvedAttrs.imageAssetId || ''}`,
        alt: resolvedAttrs.imageTitle || resolvedAttrs.title || 'Annotation image',
        layout: resolvedAttrs.layout,
        renderMode: resolvedAttrs.layout === 'vertical' ? 'image-plus-description' : 'overlay-on-image',
        points: Array.isArray(resolvedAttrs.points) ? resolvedAttrs.points.map((point) => ({
          ...point,
          body: point.body || point.description || '',
        })) : [],
        shapes: Array.isArray(resolvedAttrs.shapes) ? resolvedAttrs.shapes : [],
      },
      options,
      'manual-annotation-ui'
    );
  }

  function renderTableSpanAttribute(name, value) {
    const span = normalizeTableSpan(value);
    return span > 1 ? ` ${name}="${span}"` : '';
  }

  function normalizeTableSpan(value) {
    const span = Number(value);
    return Number.isInteger(span) && span > 1 ? Math.min(span, 100) : 1;
  }

  function normalizeTableColwidth(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((width) => Number(width))
      .filter((width) => Number.isFinite(width) && width > 0)
      .map((width) => Math.min(Math.round(width), 10000));
  }

  function renderTableAlignAttribute(value) {
    const align = String(value || '');
    return align === 'left' || align === 'center' || align === 'right'
      ? ` style="text-align:${align}"`
      : '';
  }

  function renderHotspotBlock(config, options, blockType = 'manual-annotation-ui') {
    if (!config || !config.asset) {
      return '<div class="manual-rich-error">Invalid manual-annotation-ui block</div>';
    }
    const renderConfig =
      blockType === 'manual-annotation-ui'
        ? resolveAnnotationConfigForLanguage(config, options)
        : config;
    const points = Array.isArray(renderConfig.points) ? renderConfig.points : [];
    const pointById = new Map(
      points
        .filter((point) => point && typeof point === 'object')
        .map((point, index) => [String(point.id || `point-${index + 1}`), point])
    );
    const shapes = Array.isArray(renderConfig.shapes) ? renderConfig.shapes : [];
    const figureId = `hotspot-${slugify(renderConfig.asset)}-${slugify(renderConfig.alt || 'image')}`;
    const imageUrl = resolveAssetUrl(renderConfig.asset, options);
    if (!imageUrl) {
      return '<div class="manual-rich-error">Invalid manual-annotation-ui asset</div>';
    }
    const layout = renderConfig.layout === 'vertical' || renderConfig.renderMode === 'image-plus-description'
      ? 'vertical'
      : 'horizontal';
    const renderMode = layout === 'vertical' ? 'image-plus-description' : 'overlay-on-image';
    const isLegacyHotspot = blockType === 'manual-hotspot';
    // Data attributes are the renderer contract consumed by preview runtime geometry resets.
    // Initial inline percentages remain valid for no-JS export and print paths.
    const shapesHtml = shapes.map((shape, index) => {
      const shapePoint = pointById.get(String(shape.pointId || ''));
      if (!shapePoint) {
        return '';
      }

      const pointX = clampNumber(Number(shapePoint.x ?? 50), 0, 100);
      const pointY = clampNumber(Number(shapePoint.y ?? 50), 0, 100);
      const offsetX = clampNumber(Number(shape.offsetX ?? 0), -100, 100);
      const offsetY = clampNumber(Number(shape.offsetY ?? 0), -100, 100);
      const width = clampNumber(Number(shape.width ?? 24), 4, 100);
      const height = clampNumber(Number(shape.height ?? 18), 4, 100);
      const borderColor = resolvePointColor(shape.borderColor) || '#ea580c';
      const fillColor = resolvePointColor(shape.fillColor) || 'rgba(15, 23, 42, 0)';
      const borderWidth = clampNumber(Number(shape.borderWidth ?? 2), 1, 12);
      const kind = shape.kind === 'circle' ? 'circle' : 'rectangle';

      return [
        `<span class="manual-hotspot-shape manual-hotspot-shape--${kind}"`,
        ` data-shape-id="${escapeHtml(String(shape.id || `shape-${index + 1}`))}"`,
        ` data-point-id="${escapeHtml(String(shape.pointId || ''))}"`,
        ` data-x="${pointX}"`,
        ` data-y="${pointY}"`,
        ` data-offset-x="${offsetX}"`,
        ` data-offset-y="${offsetY}"`,
        ` data-width="${width}"`,
        ` data-height="${height}"`,
        ` style="left:${pointX + offsetX}%;top:${pointY + offsetY}%;width:${width}%;height:${height}%;border-width:${borderWidth}px;border-color:${borderColor};background-color:${fillColor};">`,
        '</span>',
      ].join('');
    }).join('');
    const markersHtml = points.map((point, index) => {
      const label = escapeHtml(point.label || String(index + 1));
      const x = Number(point.x ?? 50);
      const y = Number(point.y ?? 50);
      const markerX = clampNumber(x, 0, 100);
      const markerY = clampNumber(y, 0, 100);
      const title = escapeHtml(point.title || '');
      const body = escapeHtml(point.body || '');
      const color = resolvePointColor(point.color);
      const fontColor = resolvePointColor(point.fontColor) || '#ffffff';
      const tooltipPlacement = getTooltipPlacement(x, y);
      const tooltipClass = [
        y <= 18 ? 'is-tooltip-below' : '',
        x <= 18 ? 'is-tooltip-left' : '',
        x >= 82 ? 'is-tooltip-right' : '',
      ].filter(Boolean).join(' ');
      const markerClass = `manual-hotspot-marker${tooltipClass ? ` ${tooltipClass}` : ''}`;
      const markerStyle = [
        `left:clamp(18px,${x}%,calc(100% - 18px))`,
        `top:clamp(18px,${y}%,calc(100% - 18px))`,
        tooltipPlacement,
        color ? `background-color:${color}` : '',
        color ? `color:${fontColor}` : '',
      ].filter(Boolean).join(';');
      return [
        `<button class="${markerClass}" type="button" style="${markerStyle}" aria-label="${title || `${isLegacyHotspot ? 'Hotspot' : 'AnnotationUI'} ${label}`}" data-id="${isLegacyHotspot ? 'hotspot' : 'annotation'}-${index + 1}" data-x="${markerX}" data-y="${markerY}">`,
        `<span>${label}</span>`,
        `<span class="manual-hotspot-tooltip"><strong>${title || `Point ${label}`}</strong>${body ? `<small>${body}</small>` : ''}</span>`,
        '</button>',
      ].join('');
    }).join('');
    const listHtml = points.length
      ? isLegacyHotspot
        ? [
            '<ol class="manual-hotspot-list" data-slot="hotspot-list">',
            points.map((point, index) => {
              const label = escapeHtml(point.label || String(index + 1));
              const title = escapeHtml(point.title || `Point ${label}`);
              const body = escapeHtml(point.body || '');
              return `<li data-id="hotspot-list-${index + 1}"><strong>${title}</strong>${body ? `<span>${body}</span>` : ''}</li>`;
            }).join(''),
            '</ol>',
          ].join('')
        : [
            '<div class="manual-annotation-list" data-component="manual-annotation-list" data-slot="annotation-list" data-state="ready">',
            points.map((point, index) => {
              const label = escapeHtml(point.label || String(index + 1));
              const title = escapeHtml(point.title || `Point ${label}`);
              const body = escapeHtml(point.body || '');
              const color = resolvePointColor(point.color) || '#5b7cf7';
              const fontColor = resolvePointColor(point.fontColor) || '#ffffff';
              const badgeStyle = `background-color:${color};color:${fontColor};`;
              return [
                `<div class="manual-annotation-row" data-component="manual-annotation-row" data-id="annotation-list-${index + 1}" data-state="ready">`,
                `<span class="manual-annotation-badge" data-slot="point-badge" style="${badgeStyle}">${label}</span>`,
                `<strong class="manual-annotation-title" data-slot="point-title">${title}</strong>`,
                `<span class="manual-annotation-description" data-slot="point-description">${body || 'No description'}</span>`,
                '</div>',
              ].join('');
            }).join(''),
            '</div>',
          ].join('')
      : '';
    return [
      `<figure class="manual-hotspot manual-annotation-ui is-layout-${layout} ${renderMode === 'image-plus-description' ? 'is-image-plus-description' : 'is-overlay-on-image'}" id="${figureId}" data-component="manual-hotspot-block" data-slot="annotation-ui-block" data-state="${renderMode}" data-layout="${layout}" data-kind="annotation-ui">`,
      '<div class="manual-annotation-ui-layout" data-slot="annotation-layout">',
      '<div class="manual-hotspot-stage" data-slot="hotspot-stage">',
      '<div class="manual-hotspot-image-frame" data-component="manual-hotspot-image-frame" data-slot="hotspot-image-frame">',
      `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(renderConfig.alt || 'AnnotationUI image')}" loading="lazy" />`,
      shapesHtml,
      '</div>',
      markersHtml,
      '</div>',
      listHtml,
      '</div>',
      !isLegacyHotspot && blockType === 'manual-annotation-ui' ? '' : (renderConfig.caption ? `<figcaption>${escapeHtml(renderConfig.caption)}</figcaption>` : ''),
      '</figure>',
    ].join('');
  }

  function getTooltipPlacement(x, y) {
    const markerXPercent = clampNumber(x, 0, 100);
    const markerYPercent = clampNumber(y, 0, 100);
    const horizontal =
      markerXPercent <= 28
        ? {
            left: '0',
            right: 'auto',
            translateX: '0',
          }
        : markerXPercent >= 72
          ? {
              left: 'auto',
              right: '0',
              translateX: '0',
            }
          : {
              left: '50%',
              right: 'auto',
              translateX: '-50%',
            };
    const vertical =
      markerYPercent <= 50
        ? {
            top: 'calc(100% + 16px)',
            bottom: 'auto',
            activeY: '4px',
          }
        : {
            top: 'auto',
            bottom: 'calc(100% + 16px)',
            activeY: '-4px',
          };

    return [
      `--tooltip-left:${horizontal.left}`,
      `--tooltip-right:${horizontal.right}`,
      `--tooltip-translate-x:${horizontal.translateX}`,
      `--tooltip-top:${vertical.top}`,
      `--tooltip-bottom:${vertical.bottom}`,
      `--tooltip-active-y:${vertical.activeY}`,
    ].join(';');
  }

  function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
  }

  function replaceIconShortcodes(markdown) {
    return markdown.replace(/\{\{\s*icon\s+remix:([a-z0-9-]+)\s*\}\}/gi, (_match, iconName) => {
      const normalized = String(iconName || '').trim().toLowerCase().replace(/^ri-/, '');
      const safe = slugify(normalized);
      const remixClass = `ri-${safe}`;
      return `<span class="manual-inline-icon" data-component="manual-inline-icon"><i class="${remixClass}" aria-hidden="true"></i><span class="manual-inline-icon-label">${remixClass}</span></span>`;
    });
  }

  function replaceManagedAssetUrls(markdown, options) {
    return markdown.replace(/!\[([^\]]*)\]\((manual-asset:\/\/[^)]+)\)/g, (_match, alt, rawUrl) => {
      const resolved = resolveAssetUrl(rawUrl, options);
      return `![${alt}](${resolved})`;
    });
  }

  function replaceLegacyScreenshotUrls(markdown) {
    return markdown.replace(/!\[([^\]]*)\]\((_screenshots\/[^)]+)\)/g, (_match, alt, src) => `![${alt}](../${src})`);
  }

  function replaceRichBlocks(markdown, options) {
    return replaceFencedBlocks(markdown, isRichBlockType, (blockType, blockBody) => {
      try {
        const config = JSON.parse(blockBody.trim());
        if (blockType === 'manual-video') {
          return renderVideoBlock(config, options);
        }
        if (blockType === 'manual-table') {
          return renderManualTableBlock(config, options);
        }
        return renderHotspotBlock(config, options, blockType);
      } catch (_error) {
        return `<div class="manual-rich-error">Invalid ${blockType} JSON</div>`;
      }
    });
  }

  function isRichBlockType(blockType) {
    return [
      'manual-video',
      'manual-hotspot',
      'manual-annotation-ui',
      'manual-table',
    ].includes(blockType);
  }

  function replaceFencedBlocks(markdown, shouldReplace, replacer) {
    const blocks = findFencedBlocks(markdown, shouldReplace);
    if (!blocks.length) return markdown;

    let output = '';
    let cursor = 0;
    for (const block of blocks) {
      output += markdown.slice(cursor, block.start);
      output += renderMarkdownBlockBoundary(replacer(block.type, block.body, block.raw));
      cursor = block.end;
    }
    output += markdown.slice(cursor);
    return output;
  }

  function renderMarkdownBlockBoundary(html) {
    const blockHtml = String(html ?? '').trim();
    return blockHtml ? `\n\n${blockHtml}\n\n` : '';
  }

  function findFencedBlocks(markdown, predicate) {
    const blocks = [];
    const openerPattern = /^```([A-Za-z0-9-]*)[^\n]*\n/gm;
    let opener;

    while ((opener = openerPattern.exec(markdown)) !== null) {
      const blockType = opener[1] || '';
      const bodyStart = opener.index + opener[0].length;
      const closePattern = /^```\s*$/gm;
      closePattern.lastIndex = bodyStart;
      const closer = closePattern.exec(markdown);
      if (!closer) break;

      const end = closer.index + closer[0].length;
      if (!predicate || predicate(blockType)) {
        blocks.push({
          type: blockType,
          start: opener.index,
          body: markdown.slice(bodyStart, closer.index),
          raw: markdown.slice(opener.index, end),
          end,
        });
      }
      openerPattern.lastIndex = end;
    }

    return blocks;
  }

  function sanitizeManualHighlightColor(value) {
    const raw = String(value ?? '').trim();
    const highlightColors = {
      'var(--tt-color-highlight-yellow)': '#fef9c3',
      'var(--tt-color-highlight-green)': '#dcfce7',
      'var(--tt-color-highlight-blue)': '#e0f2fe',
      'var(--tt-color-highlight-purple)': '#f3e8ff',
      'var(--tt-color-highlight-red)': '#ffe4e6',
      'var(--tt-color-highlight-gray)': '#f8f8f7',
      'var(--tt-color-highlight-brown)': '#f4eeee',
      'var(--tt-color-highlight-orange)': '#fbecdd',
      'var(--tt-color-highlight-pink)': '#fcf1f6',
    };
    if (highlightColors[raw]) {
      return highlightColors[raw];
    }
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) {
      return raw;
    }
    if (/^rgba?\(\d{1,3},\d{1,3},\d{1,3}(,(0|1|0?\.\d+))?\)$/i.test(raw)) {
      return raw;
    }
    return '#fef9c3';
  }

  function replaceGeneratedInlineMarks(html) {
    return String(html ?? '')
      .replace(/\{\{manual-highlight:([^}\n]+)\}\}/g, (_match, color) => {
        const safeColor = sanitizeManualHighlightColor(color);
        return `<mark class="manual-highlight" data-component="manual-highlight" style="--manual-highlight-color: ${escapeHtml(safeColor)};">`;
      })
      .replace(/\{\{\/manual-highlight\}\}/g, '</mark>');
  }

  function escapeRawHtmlSegment(segment) {
    return segment
      .replace(/<!--[\s\S]*?-->/g, (match) => escapeHtml(match))
      .replace(/<([^>\n]+)>/g, (match, inner) => {
        const trimmed = String(inner || '').trim();
        if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
          return match;
        }
        if (!/^[/?A-Za-z!][^>]*$/.test(trimmed)) {
          return match;
        }
        return escapeHtml(match);
      });
  }

  function escapeRawHtmlOutsideFences(markdown) {
    const fencedBlocks = findFencedBlocks(markdown);
    if (!fencedBlocks.length) {
      return escapeRawHtmlSegment(markdown);
    }
    let cursor = 0;
    let output = '';
    for (const block of fencedBlocks) {
      output += escapeRawHtmlSegment(markdown.slice(cursor, block.start));
      output += block.raw;
      cursor = block.end;
    }
    output += escapeRawHtmlSegment(markdown.slice(cursor));
    return output;
  }

  function prepareMarkdown(markdown, options) {
    let prepared = String(markdown ?? '');
    prepared = escapeRawHtmlOutsideFences(prepared);
    prepared = replaceLegacyScreenshotUrls(prepared);
    prepared = replaceManagedAssetUrls(prepared, options);
    prepared = replaceIconShortcodes(prepared);
    prepared = replaceRichBlocks(prepared, options);
    return prepared;
  }

  function renderMarkdownFragment(markdown, options) {
    return replaceGeneratedInlineMarks(window.marked.parse(prepareMarkdown(markdown, options)));
  }

  function renderMarkdown(markdown, options) {
    const resolvedOptions = options || {};
    const prepared = prepareMarkdown(markdown, resolvedOptions);
    return replaceGeneratedInlineMarks(window.marked.parse(prepared));
  }

  window.ManualRenderer = {
    renderMarkdown,
    slugify,
    resolveAssetUrl,
    extractYouTubeEmbed,
  };
})();
