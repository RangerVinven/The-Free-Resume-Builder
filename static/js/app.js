(() => {
  'use strict';

  const MAX_TEXTAREA_HEIGHT = 220;

  const AUTO_SAVE_DELAY_MS = 700;

  const state = {
    view: 'directory', // 'directory' | 'wizard'
    resumes: [],
    searchQuery: '',
    isNewResume: false,
    activeResumeId: null,
    activeResumeSlug: 'resume',
    data: null,
    isDirty: false,
    localEditSeq: 0,
    autoSaveTimer: null,
    saveInFlight: false,
    pendingSave: null, // { saveMode, silent }
    wizardStep: 1, // 1..4
    activeSectionIdx: 0,
    previewMode: 'live', // 'live' | 'pdf'
    zoom: 0.85,
    renameSectionIdx: null,
    deleteTargetId: null,
    deleteTargetName: '',
    aiOpen: false,
    aiTarget: null, // { secIdx, itemIdx, detailIdx }
    aiMessages: [], // { role: 'user'|'assistant', content: string, suggestions?: Array }
    aiLoading: false,
    aiConfig: { provider: 'OpenAI', model: 'gpt-4o-mini', hasActiveKey: false },
    formatting: {
      header_content_gap_pt: 6,
      section_gap_pt: 6,
      entry_gap_pt: 6,
      header_gap_overrides: {},
      auto_bold_stats: false,
    },
    editorMode: 'manual', // 'manual' | 'ai'
    fullAiChats: [], // [{ id, title, message_count, updated_at }]
    activeFullAiChatId: null,
    aiSidebarOpen: null, // null = auto (open if chats exist on wide viewport)
    fullAiMessages: [], // { role: 'user'|'assistant', content: string, changes?: string[] }
    fullAiLoading: false,
    lastAiUndoState: null, // deep copy of resume data prior to latest AI edit
  };

  // DOM Elements
  const el = {
    // Topbar
    wizardTopContext: document.getElementById('wizardTopContext'),
    btnBackToDirectory: document.getElementById('btnBackToDirectory'),
    activeResumeLabel: document.getElementById('activeResumeLabel'),
    directoryTopActions: document.getElementById('directoryTopActions'),
    wizardTopActions: document.getElementById('wizardTopActions'),
    importJsonFileInput: document.getElementById('importJsonFileInput'),
    btnDirImportJson: document.getElementById('btnDirImportJson'),
    btnDirTour: document.getElementById('btnDirTour'),
    btnDirSettings: document.getElementById('btnDirSettings'),
    btnDirNewResume: document.getElementById('btnDirNewResume'),
    btnWizTour: document.getElementById('btnWizTour'),
    btnWizSettings: document.getElementById('btnWizSettings'),
    saveStatus: document.getElementById('saveStatus'),
    saveStatusText: document.getElementById('saveStatusText'),
    btnSave: document.getElementById('btnSave'),
    btnHistory: document.getElementById('btnHistory'),
    historyBadge: document.getElementById('historyBadge'),
    btnExportJson: document.getElementById('btnExportJson'),
    btnExportDocx: document.getElementById('btnExportDocx'),
    btnExportPdf: document.getElementById('btnExportPdf'),

    // Directory View
    directoryView: document.getElementById('directoryView'),
    resumeSearch: document.getElementById('resumeSearch'),
    directoryEmpty: document.getElementById('directoryEmpty'),
    btnEmptyCreate: document.getElementById('btnEmptyCreate'),
    directoryList: document.getElementById('directoryList'),
    directoryRows: document.getElementById('directoryRows'),

    // Wizard View
    wizardView: document.getElementById('wizardView'),
    modeManualEditor: document.getElementById('modeManualEditor'),
    modeAiBuilder: document.getElementById('modeAiBuilder'),
    btnToggleEditorMode: document.getElementById('btnToggleEditorMode'),
    toggleEditorModeLabel: document.getElementById('toggleEditorModeLabel'),
    manualEditorView: document.getElementById('manualEditorView'),
    aiBuilderView: document.getElementById('aiBuilderView'),
    stepButtons: Array.from(document.querySelectorAll('.wizard-stepper .step-item')),
    stages: {
      1: document.getElementById('stage1'),
      2: document.getElementById('stage2'),
      3: document.getElementById('stage3'),
      4: document.getElementById('stage4'),
    },
    btnWizardPrev: document.getElementById('btnWizardPrev'),
    btnWizardNext: document.getElementById('btnWizardNext'),
    wizardStepIndicator: document.getElementById('wizardStepIndicator'),

    // Stage 1
    fieldName: document.getElementById('fieldName'),
    fieldPhone: document.getElementById('fieldPhone'),
    fieldEmail: document.getElementById('fieldEmail'),
    fieldPortfolio: document.getElementById('fieldPortfolio'),
    fieldLinkedin: document.getElementById('fieldLinkedin'),

    // Stage 2
    formQuickAddSection: document.getElementById('formQuickAddSection'),
    quickSectionTitle: document.getElementById('quickSectionTitle'),
    quickSectionType: document.getElementById('quickSectionType'),
    outlineCountLabel: document.getElementById('outlineCountLabel'),
    outlineList: document.getElementById('outlineList'),

    // Stage 3
    stage3Empty: document.getElementById('stage3Empty'),
    stage3Content: document.getElementById('stage3Content'),
    btnGoToStep2: document.getElementById('btnGoToStep2'),
    sectionTabs: document.getElementById('sectionTabs'),
    btnPrevSection: document.getElementById('btnPrevSection'),
    btnNextSection: document.getElementById('btnNextSection'),
    sectionGuidanceText: document.getElementById('sectionGuidanceText'),
    activeSectionContainer: document.getElementById('activeSectionContainer'),

    // Stage 4
    preflightList: document.getElementById('preflightList'),
    btnStage4Save: document.getElementById('btnStage4Save'),
    btnStage4PreviewPdf: document.getElementById('btnStage4PreviewPdf'),
    btnStage4Docx: document.getElementById('btnStage4Docx'),
    btnStage4Json: document.getElementById('btnStage4Json'),
    btnStage4Pdf: document.getElementById('btnStage4Pdf'),
    btnStage4OpenHistory: document.getElementById('btnStage4OpenHistory'),
    stage4HistoryPreview: document.getElementById('stage4HistoryPreview'),

    // Preview Pane
    modeLiveHtml: document.getElementById('modeLiveHtml'),
    modeNativePdf: document.getElementById('modeNativePdf'),
    livePageBadge: document.getElementById('livePageBadge'),
    btnRefreshPdf: document.getElementById('btnRefreshPdf'),
    zoomControls: document.getElementById('zoomControls'),
    btnZoomOut: document.getElementById('btnZoomOut'),
    btnZoomIn: document.getElementById('btnZoomIn'),
    zoomLabel: document.getElementById('zoomLabel'),
    livePaperWrapper: document.getElementById('livePaperWrapper'),
    resumePaper: document.getElementById('resumePaper'),
    pdfPreviewWrapper: document.getElementById('pdfPreviewWrapper'),
    pdfLoadingState: document.getElementById('pdfLoadingState'),
    pdfFrame: document.getElementById('pdfFrame'),

    // Mobile Tabs
    tabEditor: document.getElementById('tabEditor'),
    tabPreview: document.getElementById('tabPreview'),
    editorPane: document.getElementById('editorPane'),
    previewPane: document.getElementById('previewPane'),

    // Modals
    modalSectionTitle: document.getElementById('modalSectionTitle'),
    formSectionTitle: document.getElementById('formSectionTitle'),
    inputSectionTitle: document.getElementById('inputSectionTitle'),
    selectSectionFormat: document.getElementById('selectSectionFormat'),
    sectionFormatHint: document.getElementById('sectionFormatHint'),
    sectionFormatHintText: document.getElementById('sectionFormatHintText'),

    modalDeleteResume: document.getElementById('modalDeleteResume'),
    formDeleteResume: document.getElementById('formDeleteResume'),
    deleteTargetName: document.getElementById('deleteTargetName'),
    confirmDeleteInput: document.getElementById('confirmDeleteInput'),
    btnConfirmDeleteResume: document.getElementById('btnConfirmDeleteResume'),

    modalConfirmAction: document.getElementById('modalConfirmAction'),
    modalConfirmTitle: document.getElementById('modalConfirmTitle'),
    modalConfirmMessage: document.getElementById('modalConfirmMessage'),
    modalConfirmPreview: document.getElementById('modalConfirmPreview'),
    btnConfirmAction: document.getElementById('btnConfirmAction'),

    modalHistory: document.getElementById('modalHistory'),
    historyList: document.getElementById('historyList'),

    modalSettings: document.getElementById('modalSettings'),
    formSettings: document.getElementById('formSettings'),
    aiProviderSelect: document.getElementById('aiProviderSelect'),
    aiModelInput: document.getElementById('aiModelInput'),
    keyOpenAI: document.getElementById('keyOpenAI'),
    keyGemini: document.getElementById('keyGemini'),
    keyClaude: document.getElementById('keyClaude'),
    keyOther: document.getElementById('keyOther'),
    resumeFormattingSettingsLockedNote: document.getElementById('resumeFormattingSettingsLockedNote'),
    resumeFormattingSettingsGroup: document.getElementById('resumeFormattingSettingsGroup'),
    resumeFormattingTargetLabel: document.getElementById('resumeFormattingTargetLabel'),
    settingHeaderContentGap: document.getElementById('settingHeaderContentGap'),
    settingSectionGap: document.getElementById('settingSectionGap'),
    settingEntryGap: document.getElementById('settingEntryGap'),
    headerGapOverridesList: document.getElementById('headerGapOverridesList'),
    btnAddHeaderOverride: document.getElementById('btnAddHeaderOverride'),
    headerOverrideSuggestions: document.getElementById('headerOverrideSuggestions'),
    settingAutoBoldStats: document.getElementById('settingAutoBoldStats'),

    modalCreateMode: document.getElementById('modalCreateMode'),
    btnChooseManualCreate: document.getElementById('btnChooseManualCreate'),
    btnChooseAiCreate: document.getElementById('btnChooseAiCreate'),

    // Interactive Tour
    tourWelcomeBanner: document.getElementById('tourWelcomeBanner'),
    btnStartWelcomeTour: document.getElementById('btnStartWelcomeTour'),
    btnDismissWelcomeTour: document.getElementById('btnDismissWelcomeTour'),
    tourOverlay: document.getElementById('tourOverlay'),
    tourSpotlight: document.getElementById('tourSpotlight'),
    tourPopover: document.getElementById('tourPopover'),
    tourStepCounter: document.getElementById('tourStepCounter'),
    tourStepTitle: document.getElementById('tourStepTitle'),
    tourStepBody: document.getElementById('tourStepBody'),
    btnTourClose: document.getElementById('btnTourClose'),
    btnTourSkip: document.getElementById('btnTourSkip'),
    btnTourPrev: document.getElementById('btnTourPrev'),
    btnTourNext: document.getElementById('btnTourNext'),

    // Full-Resume AI Builder View
    aiChatsSidebar: document.getElementById('aiChatsSidebar'),
    btnToggleAiSidebar: document.getElementById('btnToggleAiSidebar'),
    aiChatsCountBadge: document.getElementById('aiChatsCountBadge'),
    btnSidebarNewChat: document.getElementById('btnSidebarNewChat'),
    aiChatsList: document.getElementById('aiChatsList'),
    fullAiModelBadge: document.getElementById('fullAiModelBadge'),
    btnFullAiUndo: document.getElementById('btnFullAiUndo'),
    btnFullAiReset: document.getElementById('btnFullAiReset'),
    fullAiNoKeyBanner: document.getElementById('fullAiNoKeyBanner'),
    fullAiNoKeyText: document.getElementById('fullAiNoKeyText'),
    btnFullAiOpenSettings: document.getElementById('btnFullAiOpenSettings'),
    fullAiMessages: document.getElementById('fullAiMessages'),
    fullAiQuickChips: document.getElementById('fullAiQuickChips'),
    fullAiComposerForm: document.getElementById('fullAiComposerForm'),
    fullAiInput: document.getElementById('fullAiInput'),
    btnFullAiSend: document.getElementById('btnFullAiSend'),

    // Writing Assistant Drawer
    aiDrawer: document.getElementById('aiDrawer'),
    aiTargetLabel: document.getElementById('aiTargetLabel'),
    aiModelBadge: document.getElementById('aiModelBadge'),
    btnAiReset: document.getElementById('btnAiReset'),
    btnAiClose: document.getElementById('btnAiClose'),
    aiContextBar: document.getElementById('aiContextBar'),
    aiKeyMissingBanner: document.getElementById('aiKeyMissingBanner'),
    aiNoKeyText: document.getElementById('aiNoKeyText'),
    btnAiOpenSettings: document.getElementById('btnAiOpenSettings'),
    aiChatThread: document.getElementById('aiChatThread'),
    aiQuickChips: document.getElementById('aiQuickChips'),
    aiComposerForm: document.getElementById('aiComposerForm'),
    aiInput: document.getElementById('aiInput'),
    btnAiSend: document.getElementById('btnAiSend'),

    toastContainer: document.getElementById('toastContainer'),
  };

  // Utilities
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function applyEmphasisMarkdown(escapedStr) {
    return escapedStr
      .replace(/\*\*\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(>])__([^\s_\n](?:[^_\n]*?[^\s_\n])?)__(?=$|[\s.,;:!?)\]<])/g, '$1<strong>$2</strong>')
      .replace(/\*([^\s*\n](?:[^*\n]*?[^\s*\n])?)\*/g, '<em>$1</em>')
      .replace(/(^|[\s(>])_([^\s_\n](?:[^_\n]*?[^\s_\n])?)_(?=$|[\s.,;:!?)\]<])/g, '$1<em>$2</em>');
  }

  function renderInlineMarkdown(rawStr) {
    if (!rawStr) return '';
    const cleaned = String(rawStr).replace(/\u0000/g, '');
    const codeTokens = [];
    const withCodeTokens = cleaned.replace(/`([^`\n]+)`/g, (_, code) => {
      const idx = codeTokens.length;
      codeTokens.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
      return `\u0000CODE${idx}\u0000`;
    });

    const escaped = escapeHtml(withCodeTokens);
    const linkTokens = [];
    const withLinkTokens = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      const idx = linkTokens.length;
      const renderedLabel = applyEmphasisMarkdown(label);
      linkTokens.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${renderedLabel}</a>`);
      return `\u0000LINK${idx}\u0000`;
    });

    let out = applyEmphasisMarkdown(withLinkTokens);
    out = out.replace(/\u0000LINK(\d+)\u0000/g, (_, idx) => linkTokens[Number(idx)] || '');
    out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeTokens[Number(idx)] || '');
    return out;
  }

  function parseTableCells(rowLine) {
    const trimmed = rowLine.trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((c) => c.trim());
  }

  function renderMarkdownBlocks(lines) {
    const html = [];
    let paragraph = [];
    let blockquote = [];
    const listStack = []; // [{ tag: 'ul'|'ol', indent: number, hasOpenLi: boolean }]

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const body = paragraph.map((l) => renderInlineMarkdown(l)).join('<br />');
      html.push(`<p>${body}</p>`);
      paragraph = [];
    };

    const flushBlockquote = () => {
      if (blockquote.length === 0) return;
      const inner = blockquote.map((l) => renderInlineMarkdown(l)).join('<br />');
      html.push(`<blockquote>${inner}</blockquote>`);
      blockquote = [];
    };

    const closeListsDownTo = (targetLen) => {
      while (listStack.length > targetLen) {
        const top = listStack.pop();
        if (top.hasOpenLi) html.push('</li>');
        html.push(`</${top.tag}>`);
      }
    };

    const flushAllOpen = () => {
      flushParagraph();
      flushBlockquote();
      closeListsDownTo(0);
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        flushAllOpen();
        continue;
      }

      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushAllOpen();
        html.push('<hr />');
        continue;
      }

      const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushAllOpen();
        const level = headingMatch[1].length;
        const tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
        html.push(`<${tag} class="md-heading md-h${Math.min(level, 3)}">${renderInlineMarkdown(headingMatch[2])}</${tag}>`);
        continue;
      }

      // GFM pipe table (header + separator row)
      if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?:\s*:?-{3,}:?\s*\|?)?\s*$/.test(lines[i + 1])) {
        flushAllOpen();
        const headers = parseTableCells(line);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          rows.push(parseTableCells(lines[i]));
          i += 1;
        }
        i -= 1;
        const thead = `<thead><tr>${headers.map((h) => `<th>${renderInlineMarkdown(h)}</th>`).join('')}</tr></thead>`;
        const tbody = rows.length
          ? `<tbody>${rows.map((r) => `<tr>${headers.map((_, idx) => `<td>${renderInlineMarkdown(r[idx] || '')}</td>`).join('')}</tr>`).join('')}</tbody>`
          : '';
        html.push(`<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`);
        continue;
      }

      const bqMatch = line.match(/^\s*>\s?(.*)$/);
      if (bqMatch) {
        flushParagraph();
        closeListsDownTo(0);
        blockquote.push(bqMatch[1]);
        continue;
      }

      const ulMatch = line.match(/^(\s*)[-*•]\s+(.+)$/);
      const olMatch = !ulMatch ? line.match(/^(\s*)\d+[.)]\s+(.+)$/) : null;
      if (ulMatch || olMatch) {
        flushParagraph();
        flushBlockquote();
        const match = ulMatch || olMatch;
        const tag = ulMatch ? 'ul' : 'ol';
        const indent = match[1].replace(/\t/g, '  ').length;
        const content = match[2];

        if (listStack.length === 0) {
          html.push(`<${tag}>`);
          listStack.push({ tag, indent, hasOpenLi: false });
        } else {
          while (listStack.length > 0 && indent < listStack[listStack.length - 1].indent) {
            const top = listStack.pop();
            if (top.hasOpenLi) html.push('</li>');
            html.push(`</${top.tag}>`);
          }
          if (listStack.length === 0) {
            html.push(`<${tag}>`);
            listStack.push({ tag, indent, hasOpenLi: false });
          } else {
            const top = listStack[listStack.length - 1];
            if (indent > top.indent) {
              if (!top.hasOpenLi) {
                html.push('<li>');
                top.hasOpenLi = true;
              }
              html.push(`<${tag}>`);
              listStack.push({ tag, indent, hasOpenLi: false });
            } else if (top.tag !== tag) {
              if (top.hasOpenLi) html.push('</li>');
              html.push(`</${top.tag}><${tag}>`);
              top.tag = tag;
              top.hasOpenLi = false;
            } else if (top.hasOpenLi) {
              html.push('</li>');
              top.hasOpenLi = false;
            }
          }
        }

        html.push(`<li>${renderInlineMarkdown(content)}`);
        listStack[listStack.length - 1].hasOpenLi = true;
        continue;
      }

      flushBlockquote();
      closeListsDownTo(0);
      paragraph.push(line);
    }

    flushAllOpen();
    return html.join('');
  }

  function renderMarkdownToSafeHtml(rawText) {
    if (!rawText) return '';
    const normalized = String(rawText).replace(/\r\n?/g, '\n');
    const rawLines = normalized.split('\n');
    const out = [];
    let proseLines = [];
    let inFence = false;
    let fenceLines = [];

    const flushProse = () => {
      if (proseLines.length > 0) {
        out.push(renderMarkdownBlocks(proseLines));
        proseLines = [];
      }
    };

    rawLines.forEach((line) => {
      if (/^\s*```/.test(line)) {
        if (!inFence) {
          flushProse();
          inFence = true;
          fenceLines = [];
        } else {
          out.push(`<pre class="md-pre"><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
          inFence = false;
          fenceLines = [];
        }
      } else if (inFence) {
        fenceLines.push(line);
      } else {
        proseLines.push(line);
      }
    });

    if (inFence && fenceLines.length > 0) {
      out.push(`<pre class="md-pre"><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
    }
    flushProse();

    return out.join('');
  }

  function autoResizeTextarea(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    const minH = ta.classList.contains('ai-input') ? 38 : 40;
    const nextHeight = Math.min(Math.max(ta.scrollHeight, minH), MAX_TEXTAREA_HEIGHT);
    ta.style.height = `${nextHeight}px`;
  }

  function resizeAllVisibleTextareas() {
    el.activeSectionContainer.querySelectorAll('textarea.textarea-control').forEach(autoResizeTextarea);
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function openModal(modalEl) {
    modalEl.hidden = false;
  }

  function closeModal(modalEl) {
    modalEl.hidden = true;
    if (modalEl === el.modalConfirmAction) {
      pendingConfirmFn = null;
    }
  }

  let pendingConfirmFn = null;

  function openConfirmModal({ title, message, previewText = '', confirmLabel = 'Delete', onConfirm }) {
    el.modalConfirmTitle.textContent = title || 'Are you sure?';
    el.modalConfirmMessage.textContent = message || 'Are you sure you want to proceed?';
    const cleanPreview = String(previewText || '').trim();
    if (cleanPreview) {
      el.modalConfirmPreview.textContent = cleanPreview.length > 220 ? `${cleanPreview.slice(0, 217)}...` : cleanPreview;
      el.modalConfirmPreview.hidden = false;
    } else {
      el.modalConfirmPreview.textContent = '';
      el.modalConfirmPreview.hidden = true;
    }
    el.btnConfirmAction.textContent = confirmLabel;
    pendingConfirmFn = onConfirm;
    openModal(el.modalConfirmAction);
    el.btnConfirmAction.focus();
  }

  function swapItems(arr, i, j) {
    if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return;
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }

  function updateSaveIndicator(modeLabel) {
    if (modeLabel === 'saving') {
      el.saveStatus.className = 'status-pill status-dirty';
      el.saveStatusText.textContent = 'Saving...';
      return;
    }
    if (state.isNewResume) {
      el.saveStatus.className = 'status-pill status-dirty';
      el.saveStatusText.textContent = (state.data?.name || '').trim()
        ? 'Saving draft...'
        : 'Enter name to auto-save';
    } else if (state.isDirty) {
      el.saveStatus.className = 'status-pill status-dirty';
      el.saveStatusText.textContent = 'Saving...';
    } else {
      el.saveStatus.className = 'status-pill status-saved';
      el.saveStatusText.textContent = 'All changes saved';
    }
  }

  function scheduleAutoSave(delayMs = AUTO_SAVE_DELAY_MS) {
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer);
      state.autoSaveTimer = null;
    }
    if (state.view !== 'wizard' || !state.data) return;
    const hasName = Boolean((state.data.name || '').trim());
    if (state.isNewResume && !hasName) return;

    state.autoSaveTimer = setTimeout(() => {
      state.autoSaveTimer = null;
      saveCurrentResume({ saveMode: 'autosave', silent: true }).catch(() => {
        // Keep status accurate without spamming errors on transient keystroke
        if (state.isDirty) {
          el.saveStatus.className = 'status-pill status-dirty';
          el.saveStatusText.textContent = 'Auto-save retrying';
        }
      });
    }, delayMs);
  }

  function setDirty(dirty, skipAutoSave = false) {
    state.isDirty = dirty;
    if (dirty) {
      state.localEditSeq += 1;
    }
    updateSaveIndicator();
    if (dirty && !skipAutoSave && state.view === 'wizard') {
      scheduleAutoSave();
    }
  }

  function updateZoom() {
    el.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    el.livePaperWrapper.style.transform = `scale(${state.zoom})`;
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return body;
  }

  // =========================================================
  // VIEW SWITCHING: DIRECTORY <-> WIZARD
  // =========================================================
  async function showDirectoryView() {
    if (state.view === 'wizard' && state.data) {
      if (state.autoSaveTimer) {
        clearTimeout(state.autoSaveTimer);
        state.autoSaveTimer = null;
      }
      if (state.isDirty) {
        const hasName = Boolean((state.data.name || '').trim());
        if (!state.isNewResume || hasName) {
          try {
            await saveCurrentResume({ saveMode: 'autosave', silent: true });
          } catch {
            if (!confirm('Could not auto-save recent changes. Return to the resume list anyway?')) {
              return;
            }
          }
        } else if ((state.data.sections || []).length > 0) {
          if (!confirm('This draft has no Full Name yet and has not been saved. Discard draft and return to the resume list?')) {
            return;
          }
        }
      }
    }
    state.view = 'directory';
    state.activeResumeId = null;
    state.activeResumeSlug = 'resume';
    state.data = null;
    state.isNewResume = false;
    state.isDirty = false;
    state.aiOpen = false;
    state.aiTarget = null;
    state.editorMode = 'manual';
    state.fullAiChats = [];
    state.activeFullAiChatId = null;
    state.aiSidebarOpen = null;
    state.fullAiMessages = [];
    state.fullAiLoading = false;
    state.lastAiUndoState = null;
    el.aiDrawer.hidden = true;

    el.directoryView.hidden = false;
    el.wizardView.hidden = true;
    el.wizardTopContext.hidden = true;
    el.wizardTopActions.hidden = true;
    el.directoryTopActions.hidden = false;

    if (el.tourWelcomeBanner) {
      el.tourWelcomeBanner.hidden = Boolean(localStorage.getItem('rb_tour_completed'));
    }

    await loadResumeList();
  }

  function enterWizardView(initialMode = 'manual') {
    state.view = 'wizard';
    el.directoryView.hidden = true;
    el.wizardView.hidden = false;
    el.wizardTopContext.hidden = false;
    el.wizardTopActions.hidden = false;
    el.directoryTopActions.hidden = true;

    // Reset preview mode to live HTML when entering wizard
    setPreviewMode('live');
    updateWizardHeaderMeta();
    bindContactFields();
    renderWizardStep();
    renderPreview();
    setEditorMode(initialMode);
  }

  function updateWizardHeaderMeta() {
    if (state.isNewResume) {
      el.activeResumeLabel.textContent = state.data?.name?.trim() || 'New Resume';
      el.btnSave.disabled = false;
      el.btnHistory.disabled = true;
      el.btnExportJson.disabled = true;
      el.btnExportDocx.disabled = true;
      el.btnExportPdf.disabled = true;
      el.historyBadge.hidden = true;
    } else {
      el.activeResumeLabel.textContent = state.data?.name || 'Untitled Resume';
      el.btnSave.disabled = false;
      el.btnHistory.disabled = false;
      el.btnExportJson.disabled = false;
      el.btnExportDocx.disabled = false;
      el.btnExportPdf.disabled = false;
      const count = (state.data && Array.isArray(state.data._history)) ? state.data._history.length : 0;
      el.historyBadge.textContent = count;
      el.historyBadge.hidden = count === 0;
    }
  }

  // =========================================================
  // DIRECTORY RENDERING & ACTIONS
  // =========================================================
  async function loadResumeList() {
    const { resumes } = await fetchJson('/api/resumes');
    state.resumes = resumes;
    renderDirectory();
  }

  function renderDirectory() {
    const q = state.searchQuery.trim().toLowerCase();
    const filtered = state.resumes.filter((r) => {
      if (!q) return true;
      return (r.name || '').toLowerCase().includes(q)
        || (r.email || '').toLowerCase().includes(q)
        || (r.phone || '').toLowerCase().includes(q);
    });

    if (state.resumes.length === 0) {
      el.directoryEmpty.hidden = false;
      el.directoryList.hidden = true;
      return;
    }

    el.directoryEmpty.hidden = true;
    el.directoryList.hidden = false;
    el.directoryRows.innerHTML = '';

    if (filtered.length === 0) {
      el.directoryRows.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);">No resumes match your filter.</div>';
      return;
    }

    filtered.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'directory-row';

      // Candidate
      const colCand = document.createElement('div');
      colCand.className = 'dir-candidate';
      colCand.innerHTML = `
        <span class="dir-name">${escapeHtml(r.name)}</span>
        <div class="dir-meta-line">
          ${r.email ? `<span>${escapeHtml(r.email)}</span>` : ''}
          ${r.phone ? `<span>${escapeHtml(r.phone)}</span>` : ''}
        </div>
      `;

      // Section tags
      const colSecs = document.createElement('div');
      colSecs.className = 'dir-sections-wrap';
      if (r.section_titles && r.section_titles.length > 0) {
        r.section_titles.forEach((t) => {
          const tag = document.createElement('span');
          tag.className = 'dir-section-tag';
          tag.textContent = t;
          colSecs.appendChild(tag);
        });
      } else {
        colSecs.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">No sections</span>';
      }

      // Updated at
      const colTime = document.createElement('div');
      colTime.className = 'dir-mono-cell';
      colTime.textContent = r.updated_at || '';

      // Actions
      const colActions = document.createElement('div');
      colActions.className = 'dir-actions';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-primary btn-xs';
      btnEdit.innerHTML = '<i data-lucide="pencil"></i><span>Edit</span>';
      btnEdit.addEventListener('click', () => openExistingResumeInWizard(r.id, 1));

      const btnJson = document.createElement('button');
      btnJson.type = 'button';
      btnJson.className = 'btn btn-secondary btn-xs';
      btnJson.title = 'Export as JSON';
      btnJson.textContent = 'JSON';
      btnJson.addEventListener('click', () => downloadDirectFile(r.id, r.slug || 'resume', 'json', btnJson));

      const btnDocx = document.createElement('button');
      btnDocx.type = 'button';
      btnDocx.className = 'btn btn-secondary btn-xs';
      btnDocx.title = 'Download DOCX';
      btnDocx.textContent = 'DOCX';
      btnDocx.addEventListener('click', () => downloadDirectFile(r.id, r.slug || 'resume', 'docx', btnDocx));

      const btnPdf = document.createElement('button');
      btnPdf.type = 'button';
      btnPdf.className = 'btn btn-secondary btn-xs';
      btnPdf.title = 'Download PDF';
      btnPdf.textContent = 'PDF';
      btnPdf.addEventListener('click', () => downloadDirectFile(r.id, r.slug || 'resume', 'pdf', btnPdf));

      const btnDup = makeIconButton('copy', 'Duplicate Resume', false, () => duplicateResume(r.id));
      const btnDel = makeIconButton('trash-2', 'Delete Resume', false, () => openDeleteModal(r.id, r.name), 'btn-danger-hover');

      colActions.append(btnEdit, btnJson, btnDocx, btnPdf, btnDup, btnDel);
      row.append(colCand, colSecs, colTime, colActions);
      el.directoryRows.appendChild(row);
    });

    if (window.lucide) lucide.createIcons();
  }

  async function duplicateResume(resumeId) {
    try {
      const res = await fetchJson(`/api/resumes/${encodeURIComponent(resumeId)}/duplicate`, {
        method: 'POST',
      });
      await loadResumeList();
      showToast(`Duplicated as "${res.data?.name || 'Copy'}".`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function importResumeFromJsonFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JSON file must contain a resume object.');
      }
      const fallbackName = file.name.replace(/\.json$/i, '').replace(/[_-]+/g, ' ').trim();
      const res = await fetchJson('/api/resumes/import', {
        method: 'POST',
        body: JSON.stringify({ data: parsed, fallback_name: fallbackName }),
      });
      await loadResumeList();
      showToast(`Imported "${res.data?.name || 'Resume'}".`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to import JSON file.', 'error');
    } finally {
      el.importJsonFileInput.value = '';
    }
  }

  async function downloadDirectFile(resumeId, slug, format, btn) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await fetch(`/api/resumes/${encodeURIComponent(resumeId)}/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Export failed.');
      }
      const blob = await res.blob();
      const safeSlug = slug || 'resume';
      const outName = format === 'json' ? `${safeSlug}.json` : `${safeSlug}_generated.${format}`;
      triggerDownload(blob, outName);
      showToast(`Exported ${outName}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  function triggerDownload(blob, outName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openCreateModeModal() {
    openModal(el.modalCreateMode);
    if (window.lucide) lucide.createIcons();
  }

  function startNewResumeWizard(initialMode = 'manual') {
    state.isNewResume = true;
    state.activeResumeId = null;
    state.activeResumeSlug = 'resume';
    state.wizardStep = 1;
    state.activeSectionIdx = 0;
    state.fullAiChats = [];
    state.activeFullAiChatId = null;
    state.aiSidebarOpen = null;
    state.fullAiMessages = [];
    state.lastAiUndoState = null;
    state.data = {
      name: '',
      phone: '',
      email: '',
      portfolio: '',
      linkedin: '',
      sections: [],
      formatting: normalizeFormattingConfig({}),
    };
    setDirty(false, true);
    enterWizardView(initialMode);
    if (initialMode === 'manual') {
      el.fieldName.focus();
    }
  }

  async function openExistingResumeInWizard(resumeId, startStep = 1) {
    const res = await fetchJson(`/api/resumes/${encodeURIComponent(resumeId)}`);
    state.isNewResume = false;
    state.activeResumeId = res.id;
    state.activeResumeSlug = res.slug || 'resume';
    state.data = res.data;
    if (!Array.isArray(state.data.sections)) {
      state.data.sections = [];
    }
    state.data.formatting = normalizeFormattingConfig(state.data.formatting);
    state.wizardStep = startStep;
    state.activeSectionIdx = 0;
    state.fullAiChats = [];
    state.activeFullAiChatId = null;
    state.aiSidebarOpen = null;
    state.fullAiMessages = [];
    state.lastAiUndoState = null;
    setDirty(false, true);
    enterWizardView();
  }

  // =========================================================
  // WIZARD STEP MANAGEMENT
  // =========================================================
  function renderWizardStep() {
    const step = state.wizardStep;

    // Stepper Pills (all 4 steps accessible even before first disk save)
    el.stepButtons.forEach((btn) => {
      const btnStep = Number(btn.dataset.step);
      btn.classList.toggle('active', btnStep === step);
      btn.classList.toggle('completed', btnStep < step);
      btn.disabled = false;
    });

    // Show/Hide Stage Containers
    Object.entries(el.stages).forEach(([k, stageEl]) => {
      stageEl.hidden = Number(k) !== step;
    });

    // Footer buttons
    el.wizardStepIndicator.textContent = `Step ${step} of 4`;
    el.btnWizardPrev.disabled = step === 1;

    if (step < 4) {
      el.btnWizardNext.innerHTML = '<span>Next Step</span><i data-lucide="arrow-right"></i>';
    } else {
      el.btnWizardNext.innerHTML = '<span>Done (Back to List)</span><i data-lucide="check"></i>';
    }

    // Stage-specific render
    if (step === 2) {
      renderStage2Outline();
    } else if (step === 3) {
      renderStage3Content();
    } else if (step === 4) {
      renderStage4Review();
    }

    if (window.lucide) lucide.createIcons();
  }

  async function goToWizardStep(targetStep) {
    if (targetStep < 1 || targetStep > 4) return;
    if (targetStep !== 3 && state.aiOpen) {
      closeAiDrawer();
    }
    state.wizardStep = targetStep;
    renderWizardStep();
  }

  async function createDraftResumeOnServer({ silent = false } = {}) {
    const name = (state.data?.name || '').trim();
    if (!name) {
      if (!silent) {
        showToast('Please enter a Full Name (or tell the AI your name) before saving.', 'error');
        if (state.editorMode === 'manual') {
          el.fieldName.focus();
        }
      }
      return false;
    }
    const sentSeq = state.localEditSeq;
    updateSaveIndicator('saving');
    try {
      const res = await fetchJson('/api/resumes', {
        method: 'POST',
        body: JSON.stringify({
          name: state.data.name,
          phone: state.data.phone,
          email: state.data.email,
          portfolio: state.data.portfolio,
          linkedin: state.data.linkedin,
          sections: Array.isArray(state.data.sections) ? state.data.sections : [],
        }),
      });
      state.isNewResume = false;
      state.activeResumeId = res.id;
      state.activeResumeSlug = res.slug || 'resume';
      // Preserve live in-memory object references in case user kept typing during request
      state.data._history = res.data._history || [];
      if (state.activeFullAiChatId !== null) {
        await fetchJson(`/api/chats/${encodeURIComponent(state.activeFullAiChatId)}`, {
          method: 'PUT',
          body: JSON.stringify({ resume_id: res.id, messages: state.fullAiMessages }),
        }).catch(() => {});
        loadFullAiChats().catch(() => {});
      }
      if (state.localEditSeq === sentSeq) {
        setDirty(false, true);
      } else {
        setDirty(true);
      }
      updateWizardHeaderMeta();
      if (!silent) {
        showToast(`Created resume for ${res.data.name}`, 'success');
      }
      return true;
    } catch (err) {
      if (!silent) {
        showToast(err.message, 'error');
      }
      return false;
    }
  }

  async function saveCurrentResume(opts = {}) {
    // Support legacy boolean call saveCurrentResume(true/false) as well as options object
    const options = typeof opts === 'boolean'
      ? { saveMode: opts ? 'autosave' : 'snapshot', silent: opts }
      : { saveMode: 'snapshot', silent: false, ...opts };

    if (!state.data) return false;

    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer);
      state.autoSaveTimer = null;
    }

    if (state.saveInFlight) {
      const prevMode = state.pendingSave?.saveMode;
      const mergedMode = (prevMode === 'snapshot' || options.saveMode === 'snapshot')
        ? 'snapshot'
        : ((prevMode === 'ai' || options.saveMode === 'ai') ? 'ai' : 'autosave');
      state.pendingSave = {
        saveMode: mergedMode,
        silent: Boolean(state.pendingSave?.silent ?? true) && options.silent,
      };
      return true;
    }

    state.saveInFlight = true;
    try {
      if (state.isNewResume) {
        const created = await createDraftResumeOnServer({ silent: options.silent });
        if (created && state.wizardStep === 4) {
          renderStage4Review();
        }
        return created;
      }

      const sentSeq = state.localEditSeq;
      updateSaveIndicator('saving');
      const res = await fetchJson(`/api/resumes/${encodeURIComponent(state.activeResumeId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          save_mode: options.saveMode,
          data: state.data,
        }),
      });
      state.activeResumeSlug = res.slug || state.activeResumeSlug;
      const prevHistoryLen = Array.isArray(state.data._history) ? state.data._history.length : 0;
      const nextHistory = Array.isArray(res.data?._history) ? res.data._history : [];
      // Preserve live section/item object references so active inputs/textareas stay bound
      state.data._history = nextHistory;

      if (state.localEditSeq === sentSeq) {
        setDirty(false, true);
      } else {
        setDirty(true);
      }
      updateWizardHeaderMeta();
      if (state.wizardStep === 4) {
        renderStage4Review();
      }
      if (!options.silent) {
        if (options.saveMode === 'snapshot' && nextHistory.length > prevHistoryLen) {
          showToast('Saved snapshot to Version History.', 'success');
        } else if (options.saveMode === 'snapshot') {
          showToast('All changes saved (matches latest snapshot).', 'success');
        } else {
          showToast('Resume saved.', 'success');
        }
      }
      return true;
    } finally {
      state.saveInFlight = false;
      if (state.pendingSave) {
        const nextOpts = state.pendingSave;
        state.pendingSave = null;
        await saveCurrentResume(nextOpts);
      }
    }
  }

  // =========================================================
  // STAGE 1: CONTACT INFO
  // =========================================================
  function bindContactFields() {
    const d = state.data || {};
    el.fieldName.value = d.name || '';
    el.fieldPhone.value = d.phone || '';
    el.fieldEmail.value = d.email || '';
    el.fieldPortfolio.value = d.portfolio || '';
    el.fieldLinkedin.value = d.linkedin || '';
  }

  // =========================================================
  // STAGE 2: SECTIONS OUTLINE
  // =========================================================
  function addSection(title, isSkills) {
    const cleanTitle = (title || '').trim().toUpperCase();
    if (!cleanTitle || !state.data) return;
    state.data.sections.push({
      title: cleanTitle,
      is_skills: Boolean(isSkills),
      items: [],
    });
    setDirty(true);
    renderStage2Outline();
    renderPreview();
    showToast(`Added section "${cleanTitle}"`, 'success');
  }

  function convertKeyValueToStandardItems(items) {
    const details = [];
    (items || []).forEach((kv) => {
      const cat = (kv.category || '').trim();
      const val = (kv.text || '').trim();
      const combined = (cat && val) ? `${cat}: ${val}` : (cat || val);
      if (combined) {
        details.push({ is_bullet: true, text: combined });
      }
    });
    if (details.length === 0) return [];
    return [{
      role: '',
      company: '',
      location: '',
      date: '',
      subtitle: '',
      subtitle_right: '',
      details,
    }];
  }

  function convertStandardToKeyValueItems(items) {
    const kvItems = [];
    let bulletCounter = 1;
    (items || []).forEach((item) => {
      const details = item.details || [];
      if (details.length > 0) {
        details.forEach((d) => {
          kvItems.push({
            category: `Bullet ${bulletCounter}`,
            text: (d.text || '').trim(),
          });
          bulletCounter += 1;
        });
      } else {
        const headerSummary = [item.role, item.company, item.location, item.subtitle, item.subtitle_right]
          .filter((v) => v && String(v).trim().length > 0)
          .join(', ');
        if (headerSummary || item.date) {
          kvItems.push({
            category: `Bullet ${bulletCounter}`,
            text: item.date ? `${headerSummary} (${item.date})` : headerSummary,
          });
          bulletCounter += 1;
        }
      }
    });
    return kvItems;
  }

  function convertSectionFormat(sec, targetIsSkills) {
    const currentlyKV = Boolean(sec.is_skills);
    if (currentlyKV === Boolean(targetIsSkills)) return false;

    if (currentlyKV) {
      sec.items = convertKeyValueToStandardItems(sec.items);
      sec.is_skills = false;
    } else {
      sec.items = convertStandardToKeyValueItems(sec.items);
      sec.is_skills = true;
    }
    return true;
  }

  function updateSectionFormatHint() {
    if (state.renameSectionIdx === null || !state.data) {
      el.sectionFormatHint.hidden = true;
      return;
    }
    const sec = state.data.sections[state.renameSectionIdx];
    const currentKV = Boolean(sec.is_skills);
    const selectedKV = el.selectSectionFormat.value === 'skills';
    const hasItems = Array.isArray(sec.items) && sec.items.length > 0;

    if (currentKV === selectedKV || !hasItems) {
      el.sectionFormatHint.hidden = true;
      return;
    }

    el.sectionFormatHint.hidden = false;
    el.sectionFormatHintText.innerHTML = selectedKV
      ? 'Converting to <strong>Key-Value</strong> will turn each detail into a row formatted as <code class="mono-code">Bullet x: &lt;value&gt;</code>.'
      : 'Converting to <strong>Standard</strong> will turn each key-value pair into a bullet point (<code class="mono-code">&lt;category&gt;: &lt;value&gt;</code>).';
  }

  function openEditSectionModal(secIdx) {
    const sec = state.data?.sections?.[secIdx];
    if (!sec) return;
    state.renameSectionIdx = secIdx;
    el.inputSectionTitle.value = sec.title || '';
    el.selectSectionFormat.value = sec.is_skills ? 'skills' : 'standard';
    updateSectionFormatHint();
    openModal(el.modalSectionTitle);
    if (window.lucide) lucide.createIcons();
    el.inputSectionTitle.focus();
  }

  function renderStage2Outline() {
    const sections = state.data?.sections || [];
    el.outlineCountLabel.textContent = `${sections.length} section${sections.length === 1 ? '' : 's'}`;
    el.outlineList.innerHTML = '';

    if (sections.length === 0) {
      el.outlineList.innerHTML = '<p class="field-hint">No sections added yet. Use a preset above or enter a custom title.</p>';
      return;
    }

    sections.forEach((sec, idx) => {
      const row = document.createElement('div');
      row.className = 'outline-row';

      const info = document.createElement('div');
      info.className = 'outline-info';

      const order = document.createElement('span');
      order.className = 'outline-order';
      order.textContent = `${idx + 1}.`;

      const title = document.createElement('span');
      title.className = 'outline-title';
      title.textContent = (sec.title || 'UNTITLED').toUpperCase();

      const typeTag = document.createElement('span');
      typeTag.className = `type-tag${sec.is_skills ? '' : ' tag-standard'}`;
      typeTag.textContent = sec.is_skills ? 'Key-Value' : 'Standard';

      const count = document.createElement('span');
      count.className = 'outline-count';
      const itemLen = (sec.items || []).length;
      count.textContent = `${itemLen} ${itemLen === 1 ? 'entry' : 'entries'}`;

      info.append(order, title, typeTag, count);

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      actions.append(
        makeIconButton('arrow-up', 'Move up', idx === 0, () => {
          swapItems(sections, idx, idx - 1);
          setDirty(true);
          renderStage2Outline();
          renderPreview();
        }),
        makeIconButton('arrow-down', 'Move down', idx === sections.length - 1, () => {
          swapItems(sections, idx, idx + 1);
          setDirty(true);
          renderStage2Outline();
          renderPreview();
        }),
        makeIconButton('pencil', 'Edit section', false, () => openEditSectionModal(idx)),
        makeIconButton('trash-2', 'Delete section', false, () => {
          openConfirmModal({
            title: 'Delete Section?',
            message: `Are you sure you want to delete "${sec.title}" and all of its entries?`,
            confirmLabel: 'Delete Section',
            onConfirm: () => {
              sections.splice(idx, 1);
              if (state.activeSectionIdx >= sections.length) {
                state.activeSectionIdx = Math.max(0, sections.length - 1);
              }
              setDirty(true);
              renderStage2Outline();
              renderPreview();
            },
          });
        }, 'btn-danger-hover')
      );

      row.append(info, actions);
      el.outlineList.appendChild(row);
    });

    if (window.lucide) lucide.createIcons();
  }

  // =========================================================
  // STAGE 3: ONE SECTION AT A TIME CONTENT EDITOR
  // =========================================================
  function getGuidanceForSection(sec) {
    if (!sec) return '';
    if (sec.is_skills) {
      return '<strong>Key-Value Formatting:</strong> Each row renders as a bold key followed by its value (e.g., <em>Languages: Python, Go, Docker</em> or <em>Certification: AWS Solutions Architect</em>).';
    }
    const title = (sec.title || '').toUpperCase();
    if (title.includes('SUMMARY') || title.includes('PROFILE')) {
      return '<strong>Summary Tip:</strong> Leave Role, Company, Location, Date, and Subtitles blank for a clean prose summary block. Switch the detail style to <strong>Prose</strong>.';
    }
    if (title.includes('EDUCATION')) {
      return '<strong>Education Tip:</strong> Put the institution in <em>Role/Title</em>, Degree in <em>Subtitle Left</em>, and GPA/Honors in <em>Subtitle Right</em> to align them on opposite sides.';
    }
    if (title.includes('EXPERIENCE') || title.includes('WORK')) {
      return '<strong>Experience Tip:</strong> Start bullets with strong action verbs and include measurable outcomes. Use the <strong>Bullet / Prose</strong> toggle to mix concise paragraphs with bullet lists.';
    }
    return '<strong>Entry Tip:</strong> All header fields are optional—blank fields are omitted cleanly in the final Word and PDF layout.';
  }

  function renderStage3Content() {
    const sections = state.data?.sections || [];
    if (sections.length === 0) {
      el.stage3Empty.hidden = false;
      el.stage3Content.hidden = true;
      return;
    }

    el.stage3Empty.hidden = true;
    el.stage3Content.hidden = false;

    if (state.activeSectionIdx >= sections.length) {
      state.activeSectionIdx = sections.length - 1;
    }
    if (state.activeSectionIdx < 0) {
      state.activeSectionIdx = 0;
    }

    // Render Section Tabs
    el.sectionTabs.innerHTML = '';
    sections.forEach((sec, idx) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `section-tab${idx === state.activeSectionIdx ? ' active' : ''}`;
      tab.textContent = `${idx + 1}. ${(sec.title || 'UNTITLED').toUpperCase()}`;
      tab.addEventListener('click', () => {
        state.activeSectionIdx = idx;
        renderStage3Content();
      });
      el.sectionTabs.appendChild(tab);
    });

    el.btnPrevSection.disabled = state.activeSectionIdx === 0;
    el.btnNextSection.disabled = state.activeSectionIdx === sections.length - 1;

    const activeSec = sections[state.activeSectionIdx];
    el.sectionGuidanceText.innerHTML = getGuidanceForSection(activeSec);

    renderActiveSectionCard(activeSec, state.activeSectionIdx);
  }

  function renderActiveSectionCard(sec, secIdx) {
    el.activeSectionContainer.innerHTML = '';
    const isSkills = Boolean(sec.is_skills);

    const card = document.createElement('section');
    card.className = 'editor-card';

    const header = document.createElement('div');
    header.className = 'card-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'card-title-group';
    titleGroup.innerHTML = `
      <i data-lucide="${isSkills ? 'tags' : 'briefcase'}" class="card-icon"></i>
      <h3 class="card-title">${escapeHtml((sec.title || 'UNTITLED').toUpperCase())}</h3>
      <span class="type-tag${isSkills ? '' : ' tag-standard'}">${isSkills ? 'Key-Value' : 'Standard'}</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    actions.append(
      makeIconButton('pencil', 'Edit section', false, () => openEditSectionModal(secIdx))
    );

    header.append(titleGroup, actions);

    const body = document.createElement('div');
    body.className = 'card-body';

    const itemsList = document.createElement('div');
    itemsList.className = 'items-list';

    const items = sec.items || [];
    if (items.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.textContent = isSkills
        ? 'No key-value entries yet. Add one below.'
        : 'No entries in this section yet. Add your first entry below.';
      itemsList.appendChild(hint);
    } else {
      items.forEach((item, itemIdx) => {
        itemsList.appendChild(buildItemEditor(sec, item, itemIdx, items.length));
      });
    }

    const addItemBtn = document.createElement('button');
    addItemBtn.type = 'button';
    addItemBtn.className = 'btn btn-secondary btn-sm';
    addItemBtn.innerHTML = `<i data-lucide="plus"></i><span>${isSkills ? 'Add Key-Value Row' : 'Add Entry'}</span>`;
    addItemBtn.addEventListener('click', () => {
      if (!Array.isArray(sec.items)) sec.items = [];
      if (isSkills) {
        sec.items.push({ category: '', text: '' });
      } else {
        sec.items.push({
          role: '',
          company: '',
          location: '',
          date: '',
          subtitle: '',
          subtitle_right: '',
          details: [{ is_bullet: true, text: '' }],
        });
      }
      setDirty(true);
      renderActiveSectionCard(sec, secIdx);
      renderPreview();
    });

    body.append(itemsList, addItemBtn);
    card.append(header, body);
    el.activeSectionContainer.appendChild(card);

    if (window.lucide) lucide.createIcons();
    // Auto-resize all textareas now that they are in the live visible DOM
    requestAnimationFrame(resizeAllVisibleTextareas);
  }

  function makeIconButton(iconName, title, disabled, onClick, extraClass = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-ghost btn-xs ${extraClass}`.trim();
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.disabled = disabled;
    btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function getItemSummaryLabel(item, isSkills, idx) {
    if (isSkills) {
      return item.category ? item.category : `Key-Value #${idx + 1}`;
    }
    const parts = [item.role, item.company].filter(Boolean);
    if (parts.length > 0) return parts.join(' — ');
    if (item.subtitle) return item.subtitle;
    return `Entry #${idx + 1}`;
  }

  function buildItemEditor(sec, item, itemIdx, totalItems) {
    const isSkills = Boolean(sec.is_skills);
    const box = document.createElement('div');
    box.className = 'item-box';

    const boxHeader = document.createElement('div');
    boxHeader.className = 'item-box-header';

    const label = document.createElement('span');
    label.className = 'item-box-label';
    label.textContent = getItemSummaryLabel(item, isSkills, itemIdx);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    actions.append(
      makeIconButton('arrow-up', 'Move entry up', itemIdx === 0, () => {
        swapItems(sec.items, itemIdx, itemIdx - 1);
        setDirty(true);
        renderActiveSectionCard(sec, state.activeSectionIdx);
        renderPreview();
      }),
      makeIconButton('arrow-down', 'Move entry down', itemIdx === totalItems - 1, () => {
        swapItems(sec.items, itemIdx, itemIdx + 1);
        setDirty(true);
        renderActiveSectionCard(sec, state.activeSectionIdx);
        renderPreview();
      }),
      makeIconButton('trash-2', 'Delete entry', false, () => {
        const entryLabel = getItemSummaryLabel(item, isSkills, itemIdx);
        openConfirmModal({
          title: 'Delete Entry?',
          message: `Are you sure you want to delete "${entryLabel}"?`,
          confirmLabel: 'Delete Entry',
          onConfirm: () => {
            sec.items.splice(itemIdx, 1);
            setDirty(true);
            renderActiveSectionCard(sec, state.activeSectionIdx);
            renderPreview();
          },
        });
      }, 'btn-danger-hover')
    );

    boxHeader.append(label, actions);

    const boxBody = document.createElement('div');
    boxBody.className = 'item-box-body';

    if (isSkills) {
      const grid = document.createElement('div');
      grid.className = 'form-grid-2';

      grid.append(
        createInputField('Key / Category', item.category || '', 'e.g. Languages', (val) => {
          item.category = val;
          label.textContent = getItemSummaryLabel(item, true, itemIdx);
          setDirty(true);
          renderPreview();
        }),
        createInputField('Value', item.text || '', 'e.g. Python, Go, Docker', (val) => {
          item.text = val;
          setDirty(true);
          renderPreview();
        })
      );
      boxBody.appendChild(grid);
    } else {
      const grid = document.createElement('div');
      grid.className = 'form-grid-2';

      const updateSummary = () => {
        label.textContent = getItemSummaryLabel(item, false, itemIdx);
      };

      grid.append(
        createInputField('Role / Title', item.role || '', 'e.g. Software Engineer', (val) => {
          item.role = val;
          updateSummary();
          setDirty(true);
          renderPreview();
        }),
        createInputField('Company / School', item.company || '', 'e.g. Acme Corp', (val) => {
          item.company = val;
          updateSummary();
          setDirty(true);
          renderPreview();
        }),
        createInputField('Location', item.location || '', 'e.g. San Francisco, CA', (val) => {
          item.location = val;
          setDirty(true);
          renderPreview();
        }),
        createInputField('Date', item.date || '', 'e.g. Aug 2022 - Present', (val) => {
          item.date = val;
          setDirty(true);
          renderPreview();
        }),
        createInputField('Subtitle Left (Degree)', item.subtitle || '', 'e.g. B.S. Computer Science', (val) => {
          item.subtitle = val;
          updateSummary();
          setDirty(true);
          renderPreview();
        }),
        createInputField('Subtitle Right (GPA / Honors)', item.subtitle_right || '', 'e.g. GPA: 3.9/4.0', (val) => {
          item.subtitle_right = val;
          setDirty(true);
          renderPreview();
        })
      );

      boxBody.appendChild(grid);

      // Details Block
      const detailsBlock = document.createElement('div');
      detailsBlock.className = 'details-block';

      const detailsHeader = document.createElement('div');
      detailsHeader.className = 'details-header';

      const detailsTitle = document.createElement('span');
      detailsTitle.className = 'details-title';
      detailsTitle.textContent = 'Bullets & Prose';

      const detailsHeaderActions = document.createElement('div');
      detailsHeaderActions.className = 'details-header-actions';

      const draftAiBtn = document.createElement('button');
      draftAiBtn.type = 'button';
      draftAiBtn.className = 'btn btn-secondary btn-xs';
      draftAiBtn.title = 'Open Writing Assistant to draft a new bullet';
      draftAiBtn.innerHTML = '<i data-lucide="pen-line"></i><span>Draft with AI</span>';
      draftAiBtn.addEventListener('click', () => {
        if (!Array.isArray(item.details)) item.details = [];
        item.details.push({ is_bullet: true, text: '' });
        const newDetailIdx = item.details.length - 1;
        setDirty(true);
        openAiDrawer({ secIdx: state.activeSectionIdx, itemIdx, detailIdx: newDetailIdx });
        renderActiveSectionCard(sec, state.activeSectionIdx);
        renderPreview();
      });

      const addDetailBtn = document.createElement('button');
      addDetailBtn.type = 'button';
      addDetailBtn.className = 'btn btn-secondary btn-xs';
      addDetailBtn.innerHTML = '<i data-lucide="plus"></i><span>Add Detail</span>';
      addDetailBtn.addEventListener('click', () => {
        if (!Array.isArray(item.details)) item.details = [];
        item.details.push({ is_bullet: true, text: '' });
        setDirty(true);
        renderActiveSectionCard(sec, state.activeSectionIdx);
        renderPreview();
      });

      detailsHeaderActions.append(draftAiBtn, addDetailBtn);
      detailsHeader.append(detailsTitle, detailsHeaderActions);
      detailsBlock.appendChild(detailsHeader);

      const details = item.details || [];
      details.forEach((detail, dIdx) => {
        const isTargeted = Boolean(
          state.aiOpen &&
          state.aiTarget &&
          state.aiTarget.secIdx === state.activeSectionIdx &&
          state.aiTarget.itemIdx === itemIdx &&
          state.aiTarget.detailIdx === dIdx
        );
        const row = document.createElement('div');
        row.className = `detail-row${isTargeted ? ' detail-row-active' : ''}`;

        const toggle = document.createElement('div');
        toggle.className = 'style-toggle';

        const btnBullet = document.createElement('button');
        btnBullet.type = 'button';
        btnBullet.className = `style-toggle-btn${detail.is_bullet ? ' active' : ''}`;
        btnBullet.textContent = 'Bullet';
        btnBullet.addEventListener('click', () => {
          detail.is_bullet = true;
          btnBullet.classList.add('active');
          btnProse.classList.remove('active');
          setDirty(true);
          renderPreview();
        });

        const btnProse = document.createElement('button');
        btnProse.type = 'button';
        btnProse.className = `style-toggle-btn${!detail.is_bullet ? ' active' : ''}`;
        btnProse.textContent = 'Prose';
        btnProse.addEventListener('click', () => {
          detail.is_bullet = false;
          btnProse.classList.add('active');
          btnBullet.classList.remove('active');
          setDirty(true);
          renderPreview();
        });

        toggle.append(btnBullet, btnProse);

        const textarea = document.createElement('textarea');
        textarea.className = 'textarea-control';
        textarea.rows = 1;
        textarea.placeholder = 'Enter bullet point or prose text...';
        textarea.value = detail.text || '';
        textarea.addEventListener('input', (e) => {
          detail.text = e.target.value;
          autoResizeTextarea(textarea);
          setDirty(true);
          renderPreview();
          if (state.aiOpen && state.aiTarget && state.aiTarget.secIdx === state.activeSectionIdx && state.aiTarget.itemIdx === itemIdx && state.aiTarget.detailIdx === dIdx) {
            renderAiContextBar();
          }
        });

        const assistBtn = document.createElement('button');
        assistBtn.type = 'button';
        assistBtn.className = 'btn btn-secondary btn-xs';
        assistBtn.title = 'Open Writing Assistant for this detail';
        assistBtn.innerHTML = '<i data-lucide="pen-line"></i><span>Assist</span>';
        assistBtn.addEventListener('click', () => {
          openAiDrawer({ secIdx: state.activeSectionIdx, itemIdx, detailIdx: dIdx });
          renderActiveSectionCard(sec, state.activeSectionIdx);
        });

        const dActions = document.createElement('div');
        dActions.className = 'detail-actions';
        dActions.append(
          assistBtn,
          makeIconButton('arrow-up', 'Move detail up', dIdx === 0, () => {
            swapItems(details, dIdx, dIdx - 1);
            if (state.aiOpen && state.aiTarget && state.aiTarget.secIdx === state.activeSectionIdx && state.aiTarget.itemIdx === itemIdx) {
              if (state.aiTarget.detailIdx === dIdx) state.aiTarget.detailIdx = dIdx - 1;
              else if (state.aiTarget.detailIdx === dIdx - 1) state.aiTarget.detailIdx = dIdx;
            }
            setDirty(true);
            renderActiveSectionCard(sec, state.activeSectionIdx);
            renderPreview();
          }),
          makeIconButton('arrow-down', 'Move detail down', dIdx === details.length - 1, () => {
            swapItems(details, dIdx, dIdx + 1);
            if (state.aiOpen && state.aiTarget && state.aiTarget.secIdx === state.activeSectionIdx && state.aiTarget.itemIdx === itemIdx) {
              if (state.aiTarget.detailIdx === dIdx) state.aiTarget.detailIdx = dIdx + 1;
              else if (state.aiTarget.detailIdx === dIdx + 1) state.aiTarget.detailIdx = dIdx;
            }
            setDirty(true);
            renderActiveSectionCard(sec, state.activeSectionIdx);
            renderPreview();
          }),
          makeIconButton('x', 'Delete detail', false, () => {
            const kindLabel = detail.is_bullet ? 'bullet point' : 'prose block';
            openConfirmModal({
              title: detail.is_bullet ? 'Delete Bullet Point?' : 'Delete Prose?',
              message: `Are you sure you want to delete this ${kindLabel}?`,
              previewText: detail.text || '',
              confirmLabel: 'Delete',
              onConfirm: () => {
                details.splice(dIdx, 1);
                if (state.aiOpen && state.aiTarget && state.aiTarget.secIdx === state.activeSectionIdx && state.aiTarget.itemIdx === itemIdx && state.aiTarget.detailIdx === dIdx) {
                  closeAiDrawer();
                }
                setDirty(true);
                renderActiveSectionCard(sec, state.activeSectionIdx);
                renderPreview();
              },
            });
          }, 'btn-danger-hover')
        );

        row.append(toggle, textarea, dActions);
        detailsBlock.appendChild(row);
      });

      boxBody.appendChild(detailsBlock);
    }

    box.append(boxHeader, boxBody);
    return box;
  }

  function createInputField(labelText, value, placeholder, onInput) {
    const wrap = document.createElement('div');
    wrap.className = 'form-field';

    const id = `f-${Math.random().toString(36).slice(2, 9)}`;
    const lbl = document.createElement('label');
    lbl.setAttribute('for', id);
    lbl.textContent = labelText;

    const inp = document.createElement('input');
    inp.id = id;
    inp.type = 'text';
    inp.className = 'input-control';
    inp.value = value;
    inp.placeholder = placeholder;
    inp.addEventListener('input', (e) => onInput(e.target.value));

    wrap.append(lbl, inp);
    return wrap;
  }

  // =========================================================
  // STAGE 4: PREFLIGHT CHECKLIST & HISTORY PREVIEW
  // =========================================================
  function renderStage4Review() {
    const d = state.data || {};
    const sections = d.sections || [];
    const checks = [];

    const hasContact = Boolean((d.name || '').trim() && (d.email || '').trim() && (d.phone || '').trim());
    checks.push({
      ok: hasContact,
      label: hasContact
        ? 'Contact header is complete (Name, Phone, Email).'
        : 'Missing Name, Phone, or Email in Contact Information.',
      fixStep: 1,
    });

    checks.push({
      ok: sections.length > 0,
      label: sections.length > 0
        ? `${sections.length} resume section(s) configured.`
        : 'No resume sections added yet.',
      fixStep: 2,
    });

    const emptySections = sections.filter((s) => !s.items || s.items.length === 0);
    checks.push({
      ok: emptySections.length === 0,
      label: emptySections.length === 0
        ? 'All sections contain at least one entry.'
        : `${emptySections.length} section(s) have no entries (${emptySections.map((s) => s.title).join(', ')}).`,
      fixStep: 3,
      fixSecIdx: emptySections.length > 0 ? sections.indexOf(emptySections[0]) : 0,
    });

    el.preflightList.innerHTML = '';
    checks.forEach((chk) => {
      const li = document.createElement('li');
      li.className = 'preflight-item';

      const left = document.createElement('div');
      left.className = 'preflight-left';
      left.innerHTML = `
        <i data-lucide="${chk.ok ? 'check-circle-2' : 'alert-triangle'}" class="${chk.ok ? 'preflight-icon-ok' : 'preflight-icon-warn'}"></i>
        <span>${escapeHtml(chk.label)}</span>
      `;
      li.appendChild(left);

      if (!chk.ok) {
        const fixBtn = document.createElement('button');
        fixBtn.type = 'button';
        fixBtn.className = 'btn btn-secondary btn-xs';
        fixBtn.textContent = 'Fix';
        fixBtn.addEventListener('click', () => {
          if (chk.fixSecIdx !== undefined) state.activeSectionIdx = chk.fixSecIdx;
          goToWizardStep(chk.fixStep);
        });
        li.appendChild(fixBtn);
      }
      el.preflightList.appendChild(li);
    });

    // Inline recent history (up to 3 most recent)
    const history = d._history || [];
    el.stage4HistoryPreview.innerHTML = '';
    if (history.length === 0) {
      el.stage4HistoryPreview.innerHTML = '<p class="field-hint margin-none">No versions recorded yet. Click "Save Snapshot" to capture one.</p>';
    } else {
      const start = Math.max(0, history.length - 3);
      for (let i = history.length - 1; i >= start; i--) {
        el.stage4HistoryPreview.appendChild(buildHistoryRow(history[i], i));
      }
    }

    if (window.lucide) lucide.createIcons();
  }

  function buildHistoryRow(entry, idx) {
    const sCount = (entry.state && entry.state.sections) ? entry.state.sections.length : 0;
    const versionNum = entry.version_num || (idx + 1);
    const versionId = entry.id;
    const labelText = entry.label ? ` (${entry.label})` : '';
    const row = document.createElement('div');
    row.className = 'history-row';

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.innerHTML = `
      <span class="history-time">Version #${versionNum}${escapeHtml(labelText)} &mdash; ${escapeHtml(entry.timestamp)}</span>
      <span class="history-summary">${escapeHtml(entry.state?.name || '')} &bull; ${sCount} section(s)</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const btnJson = document.createElement('a');
    btnJson.className = 'btn btn-secondary btn-xs';
    btnJson.href = `/api/resumes/${encodeURIComponent(state.activeResumeId)}/history/${encodeURIComponent(versionId)}/export/json`;
    btnJson.textContent = 'JSON';

    const btnDocx = document.createElement('a');
    btnDocx.className = 'btn btn-secondary btn-xs';
    btnDocx.href = `/api/resumes/${encodeURIComponent(state.activeResumeId)}/history/${encodeURIComponent(versionId)}/export/docx`;
    btnDocx.textContent = 'DOCX';

    const btnPdf = document.createElement('a');
    btnPdf.className = 'btn btn-secondary btn-xs';
    btnPdf.href = `/api/resumes/${encodeURIComponent(state.activeResumeId)}/history/${encodeURIComponent(versionId)}/export/pdf`;
    btnPdf.textContent = 'PDF';

    const btnRevert = document.createElement('button');
    btnRevert.type = 'button';
    btnRevert.className = 'btn btn-primary btn-xs';
    btnRevert.textContent = 'Revert';
    btnRevert.addEventListener('click', async () => {
      if (!confirm(`Revert to Version #${versionNum} (${entry.timestamp})? Your current state will be archived in history.`)) {
        return;
      }
      try {
        const res = await fetchJson(`/api/resumes/${encodeURIComponent(state.activeResumeId)}/history/${encodeURIComponent(versionId)}/revert`, {
          method: 'POST',
        });
        state.data = res.data;
        state.activeResumeSlug = res.slug || state.activeResumeSlug;
        setDirty(false, true);
        updateWizardHeaderMeta();
        bindContactFields();
        renderWizardStep();
        renderPreview();
        closeModal(el.modalHistory);
        showToast(`Reverted to Version #${versionNum}.`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    actions.append(btnJson, btnDocx, btnPdf, btnRevert);
    row.append(meta, actions);
    return row;
  }

  // =========================================================
  // LIVE PAPER PREVIEW & NATIVE PDF PREVIEW
  // =========================================================
  const STAT_BOLD_RE = new RegExp(
    '(?<![A-Za-z0-9_\\\\/\\x00-])(?:' +
      '[$£€]\\d+(?:[.,]\\d+)*(?:[KkMmBbTt]\\b|\\+)?|' +
      '\\d+(?:[.,]\\d+)*%|' +
      '\\d+(?:[.,]\\d+)*[xX]\\b|' +
      '\\d+(?:[.,]\\d+)*(?:ms|us|ns|s|KB|MB|GB|TB|PB|Mbps|Gbps|rps|qps|fps)\\b\\+?|' +
      '\\d+(?:[.,]\\d+)*(?:[KkMmBb]\\+?(?![A-Za-z0-9])|\\+)|' +
      '\\d{1,3}(?:,\\d{3})+(?:\\+)?|' +
      '\\d+(?:[.,]\\d+)?(?:-bed|-person|-member|-hour|-day|-week)?(?=\\s+(?:[a-z][A-Za-z-]*\\s+)?(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|users?|clients?|customers?|accounts?|patients?|students?|engineers?|developers?|nurses?|staff|baristas?|teams?|apps?|applications?|services?|microservices?|endpoints?|servers?|containers?|orders?|transactions?|requests?|tickets?|records?|CVEs?|bugs?|vulnerabilities|issues?|percent|times|shifts?|beds?)\\b)|' +
      '\\d+(?:[.,]\\d+)?(?:-(?:bed|person|member|hour|day|week))\\b' +
    ')',
    'g'
  );
  const BOLD_MD_RE = /\*\*(.+?)\*\*/g;
  const ESCAPED_TOKEN_RE = /\\(\d+(?:[.,]\d+)?[A-Za-z%+-]*|[$£€]\d+(?:[.,]\d+)*[A-Za-z%+-]*|\*|\\)/g;

  function clampPt(val, fallback = 6) {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(Math.max(0, Math.min(24, n)) * 100) / 100;
  }

  function normalizeFormattingConfig(rawFmt) {
    const fmt = (rawFmt && typeof rawFmt === 'object') ? rawFmt : {};
    const headerGap = clampPt(fmt.header_content_gap_pt, 6);
    const sectionGap = clampPt(fmt.section_gap_pt, 6);
    const entryGap = clampPt(fmt.entry_gap_pt, 6);
    const overrides = {};
    if (fmt.header_gap_overrides && typeof fmt.header_gap_overrides === 'object') {
      Object.entries(fmt.header_gap_overrides).forEach(([k, v]) => {
        const title = String(k || '').trim().toUpperCase();
        if (title) overrides[title] = clampPt(v, headerGap);
      });
    } else if (fmt.standardize_skills_gap === false) {
      overrides.SKILLS = 0;
      overrides['TECHNICAL SKILLS'] = 0;
    }
    return {
      header_content_gap_pt: headerGap,
      section_gap_pt: sectionGap,
      entry_gap_pt: entryGap,
      header_gap_overrides: overrides,
      auto_bold_stats: Boolean(fmt.auto_bold_stats),
    };
  }

  function parseFormattedSegments(text, autoBoldStats) {
    if (!text) return [];
    const placeholders = {};
    const protectedText = String(text).replace(ESCAPED_TOKEN_RE, (_, inner) => {
      const idx = Object.keys(placeholders).length;
      const tag = String(idx).split('').map((d) => String.fromCharCode(65 + Number(d))).join('');
      const key = `\x00ESC${tag}\x00`;
      placeholders[key] = inner;
      return key;
    });
    const restore = (s) => {
      let out = s;
      Object.entries(placeholders).forEach(([k, v]) => {
        out = out.split(k).join(v);
      });
      return out;
    };

    const mdMatches = [...protectedText.matchAll(BOLD_MD_RE)];
    if (mdMatches.length > 0) {
      const segs = [];
      let pos = 0;
      mdMatches.forEach((m) => {
        if (m.index > pos) segs.push([restore(protectedText.slice(pos, m.index)), false]);
        segs.push([restore(m[1]), true]);
        pos = m.index + m[0].length;
      });
      if (pos < protectedText.length) segs.push([restore(protectedText.slice(pos)), false]);
      return segs.filter(([t]) => Boolean(t));
    }

    if (!autoBoldStats) return [[restore(protectedText), false]];

    const segs = [];
    let pos = 0;
    for (const m of protectedText.matchAll(STAT_BOLD_RE)) {
      if (m.index > pos) segs.push([restore(protectedText.slice(pos, m.index)), false]);
      segs.push([restore(m[0]), true]);
      pos = m.index + m[0].length;
    }
    if (pos < protectedText.length) segs.push([restore(protectedText.slice(pos)), false]);
    return segs.filter(([t]) => Boolean(t));
  }

  function renderFormattedTextHtml(text, autoBoldStats) {
    return parseFormattedSegments(text, autoBoldStats)
      .map(([seg, isBold]) => (isBold ? `<strong>${escapeHtml(seg)}</strong>` : escapeHtml(seg)))
      .join('');
  }

  function renderPreview() {
    if (!state.data) {
      el.resumePaper.innerHTML = '';
      return;
    }

    const fmt = normalizeFormattingConfig(state.data.formatting);
    el.resumePaper.style.setProperty('--paper-section-gap', `${fmt.section_gap_pt}pt`);
    el.resumePaper.style.setProperty('--paper-entry-gap', `${fmt.entry_gap_pt}pt`);

    const d = state.data;
    const contactParts = [d.phone, d.email, d.portfolio, d.linkedin]
      .filter((v) => v && String(v).trim().length > 0)
      .map((v) => escapeHtml(v.trim()));

    let html = `
      <h1 class="paper-name">${escapeHtml(d.name || 'Your Name')}</h1>
      <p class="paper-contact">&nbsp;${contactParts.join(' | ')}</p>
    `;

    (d.sections || []).forEach((sec) => {
      const secTitle = (sec.title || '').trim().toUpperCase();
      const headerGapPt = Object.prototype.hasOwnProperty.call(fmt.header_gap_overrides, secTitle)
        ? fmt.header_gap_overrides[secTitle]
        : fmt.header_content_gap_pt;
      html += `<div class="paper-section" style="--sec-header-gap: ${headerGapPt}pt;">`;
      html += `<h2 class="paper-section-title">${escapeHtml(secTitle)}</h2>`;

      if (sec.is_skills) {
        (sec.items || []).forEach((skill, skillIdx) => {
          const firstClass = skillIdx === 0 ? ' paper-skill-row-first' : '';
          html += `<p class="paper-skill-row${firstClass}"><span class="paper-skill-cat">${escapeHtml(skill.category || '')}:</span> ${escapeHtml(skill.text || '')}</p>`;
        });
      } else {
        const isProjectSection = (sec.title || '').toLowerCase().includes('project');
        (sec.items || []).forEach((item) => {
          html += `<div class="paper-item">`;

          const hasHeader = item.role || item.company || item.location || item.date;
          if (hasHeader) {
            let leftHeader = '';
            if (item.role) {
              leftHeader += `<span class="paper-item-role">${escapeHtml(item.role)}</span>`;
            }
            if (item.company) {
              const companyHtml = isProjectSection
                ? `<span class="paper-item-company-italic">${escapeHtml(item.company)}</span>`
                : escapeHtml(item.company);
              leftHeader += `${item.role ? ', ' : ''}${companyHtml}`;
            }
            if (item.location) {
              leftHeader += `<span class="paper-item-location"> &ndash; ${escapeHtml(item.location)}</span>`;
            }
            html += `
              <div class="paper-item-header">
                <span class="paper-item-title">${leftHeader}</span>
                <span class="paper-item-date">${escapeHtml(item.date || '')}</span>
              </div>
            `;
          }

          if (item.subtitle || item.subtitle_right) {
            html += `
              <div class="paper-item-subrow">
                <span>${escapeHtml(item.subtitle || '')}</span>
                <span>${escapeHtml(item.subtitle_right || '')}</span>
              </div>
            `;
          }

          const details = item.details || [];
          let inBulletList = false;
          details.forEach((detail) => {
            const renderedDetail = renderFormattedTextHtml(detail.text || '', fmt.auto_bold_stats);
            if (detail.is_bullet) {
              if (!inBulletList) {
                html += `<ul class="paper-details-list">`;
                inBulletList = true;
              }
              html += `<li class="paper-detail-bullet">${renderedDetail}</li>`;
            } else {
              if (inBulletList) {
                html += `</ul>`;
                inBulletList = false;
              }
              html += `<p class="paper-detail-prose">${renderedDetail}</p>`;
            }
          });
          if (inBulletList) {
            html += `</ul>`;
          }

          html += `</div>`;
        });
      }

      html += `</div>`;
    });

    el.resumePaper.innerHTML = html;
    updatePageBreakIndicators();
  }

  function updatePageBreakIndicators() {
    if (!el.resumePaper) return;
    el.resumePaper.querySelectorAll('.paper-page-break').forEach((n) => n.remove());

    // Match Base_Template.docx US Letter dimensions (8.5 x 11 in, margins top 0.39in, bottom 0.30in)
    const PX_PER_IN = 96;
    const PAGE_HEIGHT_IN = 11;
    const TOP_MARGIN_IN = 0.39;
    const BOTTOM_MARGIN_IN = 0.30;
    const PAGE_1_LIMIT_PX = (PAGE_HEIGHT_IN - BOTTOM_MARGIN_IN) * PX_PER_IN; // 1027.2px
    const PRINTABLE_PX = (PAGE_HEIGHT_IN - TOP_MARGIN_IN - BOTTOM_MARGIN_IN) * PX_PER_IN; // 989.76px

    const children = Array.from(el.resumePaper.children);
    let contentBottom = 0;
    if (children.length > 0) {
      const lastEl = children[children.length - 1];
      contentBottom = lastEl.offsetTop + lastEl.offsetHeight;
    }

    let pageCount = 1;
    if (contentBottom > PAGE_1_LIMIT_PX + 2) {
      pageCount = 1 + Math.ceil((contentBottom - PAGE_1_LIMIT_PX) / PRINTABLE_PX);
    }
    el.resumePaper.style.minHeight = `${pageCount * PAGE_HEIGHT_IN}in`;

    for (let p = 1; p < pageCount; p += 1) {
      const topPx = PAGE_1_LIMIT_PX + (p - 1) * PRINTABLE_PX;
      const marker = document.createElement('div');
      marker.className = 'paper-page-break';
      marker.style.top = `${topPx}px`;
      marker.innerHTML = `<span class="paper-page-break-label">Page ${p} / Page ${p + 1} Break</span>`;
      el.resumePaper.appendChild(marker);
    }

    if (el.livePageBadge) {
      el.livePageBadge.classList.remove('is-ok', 'is-overflow');
      if (pageCount === 1) {
        el.livePageBadge.textContent = '1 Page';
        el.livePageBadge.classList.add('is-ok');
      } else {
        el.livePageBadge.textContent = `~${pageCount} Pages (Overflow)`;
        el.livePageBadge.classList.add('is-overflow');
      }
    }
  }

  function setPreviewMode(mode) {
    state.previewMode = mode;
    const isLive = mode === 'live';
    el.modeLiveHtml.classList.toggle('active', isLive);
    el.modeNativePdf.classList.toggle('active', !isLive);
    el.livePaperWrapper.hidden = !isLive;
    el.pdfPreviewWrapper.hidden = isLive;
    el.btnRefreshPdf.hidden = isLive;
    el.zoomControls.hidden = !isLive;
    if (el.livePageBadge) {
      el.livePageBadge.hidden = !isLive;
    }
    if (!isLive) {
      refreshNativePdfPreview();
    } else {
      updatePageBreakIndicators();
    }
  }

  async function refreshNativePdfPreview() {
    if (state.isNewResume) {
      const ok = await createDraftResumeOnServer();
      if (!ok) {
        setPreviewMode('live');
        return;
      }
      renderWizardStep();
    }
    if (!state.activeResumeId) return;
    if (state.isDirty) {
      await saveCurrentResume({ saveMode: 'autosave', silent: true });
    }
    el.pdfLoadingState.hidden = false;
    el.pdfFrame.onload = () => {
      el.pdfLoadingState.hidden = true;
    };
    el.pdfFrame.src = `/api/resumes/${encodeURIComponent(state.activeResumeId)}/preview-pdf?t=${Date.now()}`;
  }

  async function exportWizardFile(format) {
    if (state.isNewResume) {
      const ok = await createDraftResumeOnServer();
      if (!ok) return;
      renderWizardStep();
    }
    if (!state.activeResumeId || !state.data) return;
    if (state.isDirty) {
      await saveCurrentResume({ saveMode: 'autosave', silent: true });
    }

    const btn = format === 'pdf' ? el.btnExportPdf : (format === 'json' ? el.btnExportJson : el.btnExportDocx);
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>Exporting...</span>';

    try {
      const res = await fetch(`/api/resumes/${encodeURIComponent(state.activeResumeId)}/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: state.data }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Export failed.');
      }
      const blob = await res.blob();
      const safeSlug = state.activeResumeSlug || 'resume';
      const outName = format === 'json' ? `${safeSlug}.json` : `${safeSlug}_generated.${format}`;
      triggerDownload(blob, outName);
      showToast(`Exported ${outName}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      if (window.lucide) lucide.createIcons();
    }
  }

  // =========================================================
  // MODALS
  // =========================================================
  function openDeleteModal(resumeId, resumeName) {
    state.deleteTargetId = resumeId;
    state.deleteTargetName = (resumeName || '').trim();
    el.deleteTargetName.textContent = state.deleteTargetName;
    el.confirmDeleteInput.value = '';
    el.btnConfirmDeleteResume.disabled = true;
    openModal(el.modalDeleteResume);
    el.confirmDeleteInput.focus();
  }

  function openHistoryModal() {
    const history = (state.data && state.data._history) ? state.data._history : [];
    el.historyList.innerHTML = '';

    if (history.length === 0) {
      el.historyList.innerHTML = '<p class="field-hint">No saved versions yet. Make edits and click Save to record snapshots.</p>';
    } else {
      for (let i = history.length - 1; i >= 0; i--) {
        el.historyList.appendChild(buildHistoryRow(history[i], i));
      }
    }
    openModal(el.modalHistory);
  }

  // =========================================================
  // DOCKED WRITING ASSISTANT DRAWER
  // =========================================================
  function getAiTargetObjects() {
    if (!state.data || !state.aiTarget) return null;
    const sec = state.data.sections?.[state.aiTarget.secIdx];
    const item = sec?.items?.[state.aiTarget.itemIdx];
    const detail = item?.details?.[state.aiTarget.detailIdx];
    if (!sec || !item || !detail) return null;
    return { sec, item, detail };
  }

  const PROVIDER_DEFAULTS = {
    OpenAI: { model: 'gpt-4o-mini', listId: 'openaiModelSuggestions' },
    Gemini: { model: 'gemini-2.5-flash', listId: 'geminiModelSuggestions' },
    Claude: { model: 'claude-sonnet-4-5', listId: 'claudeModelSuggestions' },
  };

  async function refreshAiSettingsStatus() {
    try {
      const { settings } = await fetchJson('/api/settings');
      const keys = settings.api_keys || {};
      const ai = settings.ai || {};
      const provider = PROVIDER_DEFAULTS[ai.provider] ? ai.provider : 'OpenAI';
      const defaultModel = PROVIDER_DEFAULTS[provider].model;
      state.aiConfig = {
        provider,
        model: (ai.model || '').trim() || defaultModel,
        hasActiveKey: Boolean((keys[provider] || '').trim()),
      };
    } catch {
      // Leave existing config on transient failure
    }
    const provider = state.aiConfig.provider || 'OpenAI';
    const activeModel = state.aiConfig.model || PROVIDER_DEFAULTS[provider]?.model || 'gpt-4o-mini';
    const hasKey = Boolean(state.aiConfig.hasActiveKey);

    el.aiModelBadge.textContent = `${provider}: ${activeModel}`;
    el.aiKeyMissingBanner.hidden = hasKey;
    el.aiNoKeyText.textContent = `No ${provider} API key is configured. Add your key in Settings to use the Writing Assistant.`;

    el.fullAiModelBadge.textContent = `${provider}: ${activeModel}`;
    el.fullAiNoKeyBanner.hidden = hasKey;
    el.fullAiNoKeyText.textContent = `No ${provider} API key is configured. Add your key in Settings to use the AI Builder.`;
  }

  function syncSettingsProviderFields(resetModelIfForeign = false) {
    const provider = el.aiProviderSelect.value || 'OpenAI';
    const meta = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.OpenAI;
    el.aiModelInput.setAttribute('list', meta.listId);
    el.aiModelInput.placeholder = meta.model;
    if (resetModelIfForeign) {
      const cur = el.aiModelInput.value.trim();
      const knownDefaults = Object.values(PROVIDER_DEFAULTS).map((d) => d.model);
      const isForeignDefault = knownDefaults.includes(cur) && cur !== meta.model;
      const matchesOtherPrefix = (
        (provider !== 'OpenAI' && /^(gpt-|o[134]-)/i.test(cur))
        || (provider !== 'Gemini' && /^gemini-/i.test(cur))
        || (provider !== 'Claude' && /^claude-/i.test(cur))
      );
      if (!cur || isForeignDefault || matchesOtherPrefix) {
        el.aiModelInput.value = meta.model;
      }
    }
  }

  function renderAiContextBar() {
    const objs = getAiTargetObjects();
    if (!objs) return;
    const { sec, item, detail } = objs;
    const kind = detail.is_bullet ? 'Bullet' : 'Prose';
    el.aiTargetLabel.textContent = `${kind} #${state.aiTarget.detailIdx + 1}`;

    const headerBits = [item.role, item.company, item.subtitle].filter(Boolean);
    const entryText = headerBits.length > 0 ? headerBits.join(' — ') : 'General Entry';
    const currentDraft = (detail.text || '').trim();

    el.aiContextBar.innerHTML = `
      <div class="ai-context-entry">${escapeHtml((sec.title || '').toUpperCase())} &bull; ${escapeHtml(entryText)}</div>
      ${currentDraft ? `<div class="ai-context-draft">Current draft: ${escapeHtml(currentDraft)}</div>` : '<div class="ai-context-draft">Empty box &mdash; ready to draft from your notes</div>'}
    `;
  }

  function renderAiQuickChips() {
    const objs = getAiTargetObjects();
    el.aiQuickChips.innerHTML = '';
    if (!objs || state.aiLoading) return;

    const hasDraft = Boolean((objs.detail.text || '').trim());
    const chips = hasDraft
      ? [
          { label: 'Improve & suggest options', prompt: 'Review my current draft and suggest 2-3 stronger variations.' },
          { label: 'Ask questions to strengthen', prompt: 'What specific details or metrics would make this bullet stronger? Ask me 2-3 quick questions.' },
          { label: 'Make more concise', prompt: 'Give me shorter, punchier versions of my current draft.' },
        ]
      : [
          { label: 'Ask me questions to draft this', prompt: 'Ask me 2-3 short questions about what I worked on so we can write this bullet together.' },
          { label: 'Show 3 role examples', prompt: 'Show me 3 realistic example bullets for this role so I can pick a style and customize it.' },
        ];

    chips.forEach((chip) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-quick-chip';
      btn.textContent = chip.label;
      btn.disabled = !state.aiConfig.hasActiveKey || state.aiLoading;
      btn.addEventListener('click', () => sendAiMessage(chip.prompt));
      el.aiQuickChips.appendChild(btn);
    });
  }

  function applyAiSuggestion(text, mode) {
    const objs = getAiTargetObjects();
    if (!objs) return;
    const { sec, item, detail } = objs;

    if (mode === 'replace') {
      detail.text = text;
      setDirty(true);
      renderActiveSectionCard(sec, state.aiTarget.secIdx);
      renderPreview();
      renderAiContextBar();
      showToast('Applied suggestion to active bullet.', 'success');
    } else if (mode === 'add') {
      item.details.splice(state.aiTarget.detailIdx + 1, 0, {
        is_bullet: detail.is_bullet,
        text,
      });
      state.aiTarget.detailIdx += 1;
      setDirty(true);
      renderActiveSectionCard(sec, state.aiTarget.secIdx);
      renderPreview();
      renderAiContextBar();
      showToast('Added suggestion as a new detail row.', 'success');
    }
  }

  function renderAiThread() {
    el.aiChatThread.innerHTML = '';

    if (state.aiMessages.length === 0) {
      const welcome = document.createElement('div');
      welcome.className = 'ai-msg ai-msg-assistant';
      welcome.innerHTML = `
        <div class="ai-msg-bubble">Describe roughly what you did for this role (tools used, problems solved, or outcomes), or click one of the prompts below to be guided step by step.</div>
      `;
      el.aiChatThread.appendChild(welcome);
    }

    state.aiMessages.forEach((msg) => {
      const wrap = document.createElement('div');
      wrap.className = `ai-msg ai-msg-${msg.role}`;

      if (msg.content) {
        const bubble = document.createElement('div');
        if (msg.role === 'assistant') {
          bubble.className = 'ai-msg-bubble ai-msg-markdown';
          bubble.innerHTML = renderMarkdownToSafeHtml(msg.content);
        } else {
          bubble.className = 'ai-msg-bubble';
          bubble.textContent = msg.content;
        }
        wrap.appendChild(bubble);
      }

      if (msg.role === 'assistant' && Array.isArray(msg.suggestions) && msg.suggestions.length > 0) {
        const sugList = document.createElement('div');
        sugList.className = 'ai-suggestions-list';

        msg.suggestions.forEach((sug) => {
          const card = document.createElement('div');
          card.className = 'ai-suggestion-card';

          const top = document.createElement('div');
          top.className = 'ai-suggestion-top';
          top.innerHTML = `<span class="ai-suggestion-label">${escapeHtml(sug.label || 'Option')}</span>`;

          const textEl = document.createElement('p');
          textEl.className = 'ai-suggestion-text';
          textEl.textContent = sug.text;

          const actions = document.createElement('div');
          actions.className = 'ai-suggestion-actions';

          const btnCopy = document.createElement('button');
          btnCopy.type = 'button';
          btnCopy.className = 'btn btn-ghost btn-xs';
          btnCopy.textContent = 'Copy';
          btnCopy.addEventListener('click', () => {
            navigator.clipboard?.writeText(sug.text);
            showToast('Copied to clipboard.', 'success');
          });

          const btnAdd = document.createElement('button');
          btnAdd.type = 'button';
          btnAdd.className = 'btn btn-secondary btn-xs';
          btnAdd.textContent = 'Add Below';
          btnAdd.addEventListener('click', () => applyAiSuggestion(sug.text, 'add'));

          const btnReplace = document.createElement('button');
          btnReplace.type = 'button';
          btnReplace.className = 'btn btn-primary btn-xs';
          btnReplace.textContent = 'Replace Bullet';
          btnReplace.addEventListener('click', () => applyAiSuggestion(sug.text, 'replace'));

          actions.append(btnCopy, btnAdd, btnReplace);
          card.append(top, textEl, actions);
          sugList.appendChild(card);
        });

        wrap.appendChild(sugList);
      }

      el.aiChatThread.appendChild(wrap);
    });

    if (state.aiLoading) {
      const loading = document.createElement('div');
      loading.className = 'ai-msg-loading';
      loading.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div><span>Drafting response...</span>';
      el.aiChatThread.appendChild(loading);
    }

    el.aiChatThread.scrollTop = el.aiChatThread.scrollHeight;
    renderAiQuickChips();
  }

  async function sendAiMessage(text) {
    const trimmed = (text || '').trim();
    if (!trimmed || state.aiLoading) return;

    const objs = getAiTargetObjects();
    if (!objs) return;

    if (!state.aiConfig.hasActiveKey) {
      el.aiKeyMissingBanner.hidden = false;
      showToast(`Configure your ${state.aiConfig.provider || 'AI'} API key in Settings first.`, 'error');
      return;
    }

    state.aiMessages.push({ role: 'user', content: trimmed });
    state.aiLoading = true;
    el.btnAiSend.disabled = true;
    el.aiInput.value = '';
    autoResizeTextarea(el.aiInput);
    renderAiThread();

    const { sec, item, detail } = objs;
    const siblingDetails = (item.details || [])
      .filter((_, idx) => idx !== state.aiTarget.detailIdx)
      .map((d) => d.text || '')
      .filter(Boolean);

    const apiMessages = state.aiMessages.map((m) => ({
      role: m.role,
      content: m.content || (m.suggestions?.length ? m.suggestions.map((s) => `${s.label}: ${s.text}`).join('\n') : ''),
    }));

    try {
      const res = await fetchJson('/api/ai/assist', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'bullet',
          context: {
            section_title: sec.title || '',
            role: item.role || '',
            company: item.company || '',
            location: item.location || '',
            date: item.date || '',
            subtitle: item.subtitle || '',
            is_bullet: Boolean(detail.is_bullet),
            current_text: detail.text || '',
            sibling_details: siblingDetails,
          },
          messages: apiMessages,
        }),
      });
      state.aiMessages.push({
        role: 'assistant',
        content: res.reply || '',
        suggestions: res.suggestions || [],
      });
    } catch (err) {
      state.aiMessages.push({
        role: 'assistant',
        content: `Error: ${err.message}`,
        suggestions: [],
      });
    } finally {
      state.aiLoading = false;
      el.btnAiSend.disabled = false;
      renderAiThread();
      el.aiInput.focus();
    }
  }

  async function openAiDrawer(target) {
    const isSameTarget = Boolean(
      state.aiTarget &&
      state.aiTarget.secIdx === target.secIdx &&
      state.aiTarget.itemIdx === target.itemIdx &&
      state.aiTarget.detailIdx === target.detailIdx
    );

    if (!isSameTarget) {
      state.aiMessages = [];
    }
    state.aiTarget = target;
    state.aiOpen = true;
    el.aiDrawer.hidden = false;

    if (window.innerWidth < 1024) {
      el.previewPane.classList.remove('mobile-hidden');
      el.editorPane.classList.add('mobile-hidden');
    }

    renderAiContextBar();
    await refreshAiSettingsStatus();
    renderAiThread();
    if (window.lucide) lucide.createIcons();
    el.aiInput.focus();
  }

  function closeAiDrawer() {
    state.aiOpen = false;
    state.aiTarget = null;
    el.aiDrawer.hidden = true;
    if (window.innerWidth < 1024) {
      el.tabEditor.click();
    }
    if (state.view === 'wizard' && state.editorMode === 'manual' && state.wizardStep === 3) {
      renderStage3Content();
    }
  }

  // =========================================================
  // FULL-RESUME CONVERSATIONAL AI BUILDER & MODE SWITCHING
  // =========================================================
  async function setEditorMode(mode) {
    state.editorMode = mode === 'ai' ? 'ai' : 'manual';
    const isAi = state.editorMode === 'ai';

    el.modeManualEditor.classList.toggle('active', !isAi);
    el.modeManualEditor.setAttribute('aria-selected', String(!isAi));
    el.modeAiBuilder.classList.toggle('active', isAi);
    el.modeAiBuilder.setAttribute('aria-selected', String(isAi));
    el.toggleEditorModeLabel.textContent = isAi ? 'Switch to Manual Editor' : 'Switch to AI Builder';

    el.manualEditorView.hidden = isAi;
    el.aiBuilderView.hidden = !isAi;

    if (isAi) {
      if (state.aiOpen) closeAiDrawer();
      await refreshAiSettingsStatus();
      await loadFullAiChats({ loadLatestIfEmpty: true });
      renderFullAiThread();
      renderFullAiQuickChips();
      renderFullAiSidebar();
      el.btnFullAiUndo.hidden = !state.lastAiUndoState;
      if (window.lucide) lucide.createIcons();
      el.fullAiInput.focus();
    } else {
      // Sync any AI updates into Manual Wizard stages cleanly
      if (state.activeSectionIdx >= (state.data?.sections?.length || 0)) {
        state.activeSectionIdx = Math.max(0, (state.data?.sections?.length || 1) - 1);
      }
      bindContactFields();
      renderWizardStep();
      renderPreview();
      if (window.lucide) lucide.createIcons();
    }
  }

  function renderFullAiQuickChips() {
    el.fullAiQuickChips.innerHTML = '';
    if (state.fullAiLoading) return;

    const hasContent = Boolean((state.data?.name || '').trim() || (state.data?.sections || []).length > 0);
    const chips = hasContent
      ? [
          { label: 'Review & suggest improvements', prompt: 'Review my current resume and suggest concrete improvements or missing sections.' },
          { label: 'Add a new experience or project', prompt: 'Ask me a few quick questions to add a new role or project to my resume.' },
          { label: 'Organize or tighten skills', prompt: 'Help organize or refine my technical skills section.' },
        ]
      : [
          { label: 'Walk me through step by step', prompt: 'Start from the beginning and ask me a few clear questions (name, contact info, target role, education, experience) to build my resume.' },
          { label: 'I will paste my notes / background', prompt: 'I want to paste my rough background and work history so you can structure it into my resume.' },
        ];

    chips.forEach((chip) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-quick-chip';
      btn.textContent = chip.label;
      btn.addEventListener('click', () => sendFullAiMessage(chip.prompt));
      el.fullAiQuickChips.appendChild(btn);
    });
  }

  function renderFullAiThread() {
    el.fullAiMessages.innerHTML = '';

    if (state.fullAiMessages.length === 0) {
      const welcome = document.createElement('div');
      welcome.className = 'ai-msg ai-msg-assistant';
      const hasExisting = Boolean((state.data?.name || '').trim() || (state.data?.sections || []).length > 0);
      welcome.innerHTML = `
        <div class="ai-msg-bubble">${
          hasExisting
            ? 'Your current resume is loaded. Tell me what you would like to add, rewrite, or reorganize—I will outline any proposed edits and ask before applying them.'
            : 'Describe your background, target role, work history, education, and skills in your own words. I will propose structured updates for you to review and apply with one click.'
        }</div>
      `;
      el.fullAiMessages.appendChild(welcome);
    }

    state.fullAiMessages.forEach((msg, msgIdx) => {
      const wrap = document.createElement('div');
      wrap.className = `ai-msg ai-msg-${msg.role}`;

      if (msg.content) {
        const bubble = document.createElement('div');
        if (msg.role === 'assistant') {
          bubble.className = 'ai-msg-bubble ai-msg-markdown';
          bubble.innerHTML = renderMarkdownToSafeHtml(msg.content);
        } else {
          bubble.className = 'ai-msg-bubble';
          bubble.textContent = msg.content;
        }
        wrap.appendChild(bubble);
      }

      const hasProposal = msg.role === 'assistant' && msg.proposed_resume && typeof msg.proposed_resume === 'object';
      const hasChangesList = msg.role === 'assistant' && Array.isArray(msg.changes) && msg.changes.length > 0;
      if (hasProposal || hasChangesList) {
        const status = hasProposal ? (msg.proposal_status || 'pending') : 'applied';
        const banner = document.createElement('div');
        banner.className = `ai-changes-banner is-${status}`;
        const listItems = hasChangesList
          ? msg.changes.map((c) => `<li>${renderInlineMarkdown(c)}</li>`).join('')
          : '<li>Updated resume draft ready for your review.</li>';
        const titleText =
          status === 'pending'
            ? 'Proposed Changes (Authorization Required)'
            : status === 'dismissed'
              ? 'Proposed Changes (Dismissed)'
              : 'Applied to Live Resume';
        banner.innerHTML = `
          <div class="ai-changes-title">${titleText}</div>
          <ul class="ai-changes-list">${listItems}</ul>
        `;

        if (hasProposal && status === 'pending') {
          const actions = document.createElement('div');
          actions.className = 'ai-changes-actions';

          const btnDismiss = document.createElement('button');
          btnDismiss.type = 'button';
          btnDismiss.className = 'btn btn-ghost btn-xs';
          btnDismiss.textContent = 'Dismiss';
          btnDismiss.addEventListener('click', () => dismissFullAiProposal(msgIdx));

          const btnApply = document.createElement('button');
          btnApply.type = 'button';
          btnApply.className = 'btn btn-primary btn-xs';
          btnApply.textContent = 'Apply Changes';
          btnApply.addEventListener('click', () => applyFullAiProposal(msgIdx));

          actions.append(btnDismiss, btnApply);
          banner.appendChild(actions);
        }

        wrap.appendChild(banner);
      }

      el.fullAiMessages.appendChild(wrap);
    });

    if (state.fullAiLoading) {
      const loading = document.createElement('div');
      loading.className = 'ai-msg ai-msg-assistant';
      loading.innerHTML = '<div class="ai-msg-bubble ai-msg-loading">Drafting proposed changes...</div>';
      el.fullAiMessages.appendChild(loading);
    }

    el.fullAiMessages.scrollTop = el.fullAiMessages.scrollHeight;
  }

  function renderFullAiSidebar() {
    if (!el.aiChatsSidebar || !el.aiChatsList) return;
    const chats = Array.isArray(state.fullAiChats) ? state.fullAiChats : [];
    const count = chats.length;
    if (el.aiChatsCountBadge) {
      el.aiChatsCountBadge.textContent = String(count);
      el.aiChatsCountBadge.hidden = count === 0;
    }

    const isOpen = state.aiSidebarOpen === null
      ? (count > 0 && window.innerWidth >= 1024)
      : Boolean(state.aiSidebarOpen);

    el.aiChatsSidebar.hidden = !isOpen;
    if (el.btnToggleAiSidebar) {
      el.btnToggleAiSidebar.classList.toggle('is-open', isOpen);
      el.btnToggleAiSidebar.setAttribute('aria-expanded', String(isOpen));
    }

    el.aiChatsList.innerHTML = '';
    if (chats.length === 0) {
      el.aiChatsList.innerHTML = '<div class="ai-chats-empty">No saved chats yet. Start typing below to save this conversation.</div>';
      return;
    }

    chats.forEach((chat) => {
      const row = document.createElement('div');
      row.className = 'ai-chat-item';
      row.setAttribute('role', 'listitem');
      if (chat.id === state.activeFullAiChatId) {
        row.classList.add('active');
      }

      const body = document.createElement('div');
      body.className = 'ai-chat-item-body';
      body.innerHTML = `
        <div class="ai-chat-item-title">${escapeHtml(chat.title || 'New Chat')}</div>
        <div class="ai-chat-item-meta">${escapeHtml(`${chat.message_count || 0} msgs`)} &bull; ${escapeHtml(chat.updated_at || '')}</div>
      `;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ai-chat-item-delete';
      delBtn.title = 'Delete saved chat';
      delBtn.setAttribute('aria-label', `Delete ${chat.title || 'chat'}`);
      delBtn.innerHTML = '<i data-lucide="trash-2"></i>';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const chatTitle = chat.title || 'New Chat';
        openConfirmModal({
          title: 'Delete AI Chat?',
          message: `Are you sure you want to delete "${chatTitle}"? This permanently removes the saved conversation and cannot be undone.`,
          confirmLabel: 'Delete Chat',
          onConfirm: () => deleteFullAiChat(chat.id),
        });
      });

      row.append(body, delBtn);
      row.addEventListener('click', () => selectFullAiChat(chat.id));
      el.aiChatsList.appendChild(row);
    });

    if (window.lucide) lucide.createIcons();
  }

  function toggleAiSidebar() {
    const currentlyOpen = !el.aiChatsSidebar.hidden;
    state.aiSidebarOpen = !currentlyOpen;
    renderFullAiSidebar();
  }

  async function loadFullAiChats({ loadLatestIfEmpty = false } = {}) {
    if (!state.activeResumeId || state.isNewResume) {
      renderFullAiSidebar();
      return;
    }
    try {
      const { chats } = await fetchJson(`/api/resumes/${encodeURIComponent(state.activeResumeId)}/chats`);
      state.fullAiChats = Array.isArray(chats) ? chats : [];
      if (loadLatestIfEmpty && state.activeFullAiChatId === null && state.fullAiMessages.length === 0 && state.fullAiChats.length > 0) {
        await selectFullAiChat(state.fullAiChats[0].id, { skipFocus: true });
      } else {
        renderFullAiSidebar();
      }
    } catch {
      renderFullAiSidebar();
    }
  }

  async function selectFullAiChat(chatId, { skipFocus = false } = {}) {
    if (state.fullAiLoading) return;
    try {
      const chat = await fetchJson(`/api/chats/${encodeURIComponent(chatId)}`);
      state.activeFullAiChatId = chat.id;
      state.fullAiMessages = Array.isArray(chat.messages) ? chat.messages : [];
      renderFullAiThread();
      renderFullAiQuickChips();
      renderFullAiSidebar();
      if (!skipFocus) {
        el.fullAiInput.focus();
      }
    } catch (err) {
      showToast(err.message || 'Failed to load chat.', 'error');
    }
  }

  async function persistFullAiChat() {
    const messagesPayload = state.fullAiMessages.map((m) => ({
      role: m.role,
      content: m.content || '',
      ...(Array.isArray(m.changes) ? { changes: m.changes } : {}),
    }));

    let saved;
    if (state.activeFullAiChatId === null) {
      saved = await fetchJson('/api/chats', {
        method: 'POST',
        body: JSON.stringify({
          resume_id: state.activeResumeId || null,
          messages: messagesPayload,
        }),
      });
      state.activeFullAiChatId = saved.id;
    } else {
      saved = await fetchJson(`/api/chats/${encodeURIComponent(state.activeFullAiChatId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          resume_id: state.activeResumeId || null,
          messages: messagesPayload,
        }),
      });
    }

    if (state.activeResumeId && !state.isNewResume) {
      const { chats } = await fetchJson(`/api/resumes/${encodeURIComponent(state.activeResumeId)}/chats`);
      state.fullAiChats = Array.isArray(chats) ? chats : [];
    } else if (saved) {
      const summary = {
        id: saved.id,
        resume_id: saved.resume_id,
        title: saved.title,
        message_count: (saved.messages || []).length,
        updated_at: (saved.updated_at || '').slice(0, 16),
      };
      const existingIdx = state.fullAiChats.findIndex((c) => c.id === saved.id);
      if (existingIdx >= 0) {
        state.fullAiChats.splice(existingIdx, 1);
      }
      state.fullAiChats.unshift(summary);
    }

    renderFullAiSidebar();
  }

  async function deleteFullAiChat(chatId) {
    try {
      await fetchJson(`/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
      state.fullAiChats = state.fullAiChats.filter((c) => c.id !== chatId);
      if (state.activeFullAiChatId === chatId) {
        state.activeFullAiChatId = null;
        state.fullAiMessages = [];
        renderFullAiThread();
        renderFullAiQuickChips();
      }
      renderFullAiSidebar();
      showToast('Deleted saved chat.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to delete chat.', 'error');
    }
  }

  async function sendFullAiMessage(rawText) {
    if (state.fullAiLoading || !state.data) return;
    const text = (rawText || '').trim();
    if (!text) return;

    state.fullAiMessages.push({ role: 'user', content: text });
    el.fullAiInput.value = '';
    autoResizeTextarea(el.fullAiInput);
    state.fullAiLoading = true;
    el.btnFullAiSend.disabled = true;
    renderFullAiThread();
    renderFullAiQuickChips();
    await persistFullAiChat().catch(() => {});

    const apiMessages = state.fullAiMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const resumeSnapshot = { ...state.data };
      delete resumeSnapshot._history;

      const res = await fetchJson('/api/ai/assist', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'full_resume',
          resume_data: resumeSnapshot,
          messages: apiMessages,
        }),
      });

      const hasProposal = Boolean(res.updated_resume && typeof res.updated_resume === 'object');
      state.fullAiMessages.push({
        role: 'assistant',
        content: res.reply || (hasProposal ? 'Here are the proposed resume updates. Click Apply Changes when ready.' : 'Here is my response.'),
        changes: Array.isArray(res.changes_summary) ? res.changes_summary : [],
        ...(hasProposal ? { proposed_resume: res.updated_resume, proposal_status: 'pending' } : {}),
      });
    } catch (err) {
      state.fullAiMessages.push({
        role: 'assistant',
        content: `Error: ${err.message}`,
        changes: [],
      });
    } finally {
      state.fullAiLoading = false;
      el.btnFullAiSend.disabled = false;
      await persistFullAiChat().catch(() => {});
      renderFullAiThread();
      renderFullAiQuickChips();
      el.fullAiInput.focus();
    }
  }

  async function applyFullAiProposal(msgIdx) {
    const msg = state.fullAiMessages[msgIdx];
    if (!msg || !msg.proposed_resume || typeof msg.proposed_resume !== 'object') return;
    state.lastAiUndoState = JSON.parse(JSON.stringify(state.data));
    const preservedHistory = state.data?._history;
    const preservedFormatting = state.data?.formatting;
    state.data = JSON.parse(JSON.stringify(msg.proposed_resume));
    if (preservedHistory !== undefined) {
      state.data._history = preservedHistory;
    }
    if (preservedFormatting && typeof preservedFormatting === 'object') {
      state.data.formatting = normalizeFormattingConfig(preservedFormatting);
    }
    state.formatting = normalizeFormattingConfig(state.data.formatting);
    state.fullAiMessages.forEach((m, idx) => {
      if (m.proposed_resume && m.proposal_status === 'pending' && idx !== msgIdx) {
        m.proposal_status = 'dismissed';
      }
    });
    msg.proposal_status = 'applied';
    el.btnFullAiUndo.hidden = false;
    setDirty(true, true);
    updateWizardHeaderMeta();
    bindContactFields();
    renderPreview();
    renderFullAiThread();
    if ((state.data?.name || '').trim()) {
      await saveCurrentResume({ saveMode: 'ai', silent: true }).catch(() => {});
    }
    await persistFullAiChat().catch(() => {});
    showToast('Applied proposed AI changes to your resume.', 'success');
  }

  async function dismissFullAiProposal(msgIdx) {
    const msg = state.fullAiMessages[msgIdx];
    if (!msg || !msg.proposed_resume) return;
    msg.proposal_status = 'dismissed';
    renderFullAiThread();
    await persistFullAiChat().catch(() => {});
  }

  function undoLastFullAiChange() {
    if (!state.lastAiUndoState) return;
    state.data = state.lastAiUndoState;
    state.lastAiUndoState = null;
    el.btnFullAiUndo.hidden = true;
    setDirty(true);
    updateWizardHeaderMeta();
    bindContactFields();
    renderPreview();
    showToast('Reverted the last AI resume update.', 'success');
  }

  function resetFullAiConversation() {
    if (state.fullAiLoading) return;
    state.activeFullAiChatId = null;
    state.fullAiMessages = [];
    renderFullAiThread();
    renderFullAiQuickChips();
    renderFullAiSidebar();
    el.fullAiInput.focus();
  }

  function refreshHeaderOverrideDatalist() {
    if (!el.headerOverrideSuggestions) return;
    const baseTitles = [
      'PROFESSIONAL SUMMARY',
      'EXPERIENCE',
      'EDUCATION',
      'PROJECTS',
      'SKILLS',
      'TECHNICAL SKILLS',
    ];
    const activeTitles = (state.data?.sections || [])
      .map((s) => (s.title || '').trim().toUpperCase())
      .filter(Boolean);
    const merged = Array.from(new Set([...activeTitles, ...baseTitles]));
    el.headerOverrideSuggestions.innerHTML = merged
      .map((t) => `<option value="${escapeHtml(t)}"></option>`)
      .join('');
  }

  function renderHeaderOverridesList(overridesObj) {
    el.headerGapOverridesList.innerHTML = '';
    const entries = Object.entries(overridesObj || {});
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'override-empty';
      empty.textContent = 'No per-header overrides set (all headers use the default gap above).';
      el.headerGapOverridesList.appendChild(empty);
      return;
    }
    entries.forEach(([title, gapVal]) => {
      el.headerGapOverridesList.appendChild(createHeaderOverrideRow(title, gapVal));
    });
    if (window.lucide) lucide.createIcons();
  }

  function createHeaderOverrideRow(title = '', gapPt = 6) {
    const row = document.createElement('div');
    row.className = 'override-row';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'input-control override-title-input';
    titleInput.setAttribute('list', 'headerOverrideSuggestions');
    titleInput.placeholder = 'Header name (e.g. SKILLS)';
    titleInput.value = title;

    const gapWrap = document.createElement('div');
    gapWrap.className = 'override-gap-unit';

    const gapInput = document.createElement('input');
    gapInput.type = 'number';
    gapInput.className = 'input-control override-gap-input';
    gapInput.min = '0';
    gapInput.max = '24';
    gapInput.step = '0.5';
    gapInput.value = String(clampPt(gapPt, 6));

    const unit = document.createElement('span');
    unit.textContent = 'pt';
    gapWrap.append(gapInput, unit);

    const removeBtn = makeIconButton('x', 'Remove override', false, () => {
      row.remove();
      if (el.headerGapOverridesList.querySelectorAll('.override-row').length === 0) {
        renderHeaderOverridesList({});
      }
    }, 'btn-danger-hover');

    row.append(titleInput, gapWrap, removeBtn);
    return row;
  }

  function collectHeaderOverrides() {
    const result = {};
    el.headerGapOverridesList.querySelectorAll('.override-row').forEach((row) => {
      const title = (row.querySelector('.override-title-input')?.value || '').trim().toUpperCase();
      const gap = row.querySelector('.override-gap-input')?.value;
      if (title) {
        result[title] = clampPt(gap, 6);
      }
    });
    return result;
  }

  async function openSettingsModal() {
    try {
      const { settings } = await fetchJson('/api/settings');
      const keys = settings.api_keys || {};
      const ai = settings.ai || {};
      el.aiProviderSelect.value = ai.provider || 'OpenAI';
      el.aiModelInput.value = ai.model || (PROVIDER_DEFAULTS[el.aiProviderSelect.value]?.model || 'gpt-4o-mini');
      syncSettingsProviderFields(false);
      el.keyOpenAI.value = keys.OpenAI || '';
      el.keyGemini.value = keys.Gemini || '';
      el.keyClaude.value = keys.Claude || '';
      el.keyOther.value = keys.Other || '';

      const hasOpenResume = state.view === 'wizard' && Boolean(state.data);
      el.resumeFormattingSettingsGroup.hidden = !hasOpenResume;
      el.resumeFormattingSettingsLockedNote.hidden = hasOpenResume;

      if (hasOpenResume) {
        const resumeTitle = (state.data.name || '').trim() || 'Current Resume';
        el.resumeFormattingTargetLabel.textContent = `— ${resumeTitle}`;
        const fmt = normalizeFormattingConfig(state.data.formatting);
        el.settingHeaderContentGap.value = String(fmt.header_content_gap_pt);
        el.settingSectionGap.value = String(fmt.section_gap_pt);
        el.settingEntryGap.value = String(fmt.entry_gap_pt);
        el.settingAutoBoldStats.checked = Boolean(fmt.auto_bold_stats);
        refreshHeaderOverrideDatalist();
        renderHeaderOverridesList(fmt.header_gap_overrides);
      }

      openModal(el.modalSettings);
      if (window.lucide) lucide.createIcons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =========================================================
  // EVENT WIRING
  // =========================================================
  function bindEvents() {
    // Directory events
    el.resumeSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderDirectory();
    });
    el.btnDirNewResume.addEventListener('click', openCreateModeModal);
    el.btnEmptyCreate.addEventListener('click', openCreateModeModal);
    el.btnChooseManualCreate.addEventListener('click', () => {
      closeModal(el.modalCreateMode);
      startNewResumeWizard('manual');
    });
    el.btnChooseAiCreate.addEventListener('click', () => {
      closeModal(el.modalCreateMode);
      startNewResumeWizard('ai');
    });
    el.modeManualEditor.addEventListener('click', () => setEditorMode('manual'));
    el.modeAiBuilder.addEventListener('click', () => setEditorMode('ai'));
    el.btnToggleEditorMode.addEventListener('click', () => {
      setEditorMode(state.editorMode === 'ai' ? 'manual' : 'ai');
    });
    el.btnDirImportJson.addEventListener('click', () => el.importJsonFileInput.click());
    el.importJsonFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) importResumeFromJsonFile(file);
    });
    el.btnDirSettings.addEventListener('click', openSettingsModal);
    el.btnWizSettings.addEventListener('click', openSettingsModal);
    el.btnBackToDirectory.addEventListener('click', showDirectoryView);

    // Stepper navigation
    el.stepButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        goToWizardStep(Number(btn.dataset.step));
      });
    });

    el.btnWizardPrev.addEventListener('click', () => {
      if (state.wizardStep > 1) {
        goToWizardStep(state.wizardStep - 1);
      }
    });

    el.btnWizardNext.addEventListener('click', () => {
      if (state.wizardStep < 4) {
        goToWizardStep(state.wizardStep + 1);
      } else {
        showDirectoryView();
      }
    });

    // Contact live inputs
    const bindContact = (inputEl, key) => {
      inputEl.addEventListener('input', (e) => {
        if (!state.data) return;
        state.data[key] = e.target.value;
        if (key === 'name' && state.isNewResume) {
          el.activeResumeLabel.textContent = e.target.value.trim() || 'New Resume';
        }
        setDirty(true);
        renderPreview();
      });
    };
    bindContact(el.fieldName, 'name');
    bindContact(el.fieldPhone, 'phone');
    bindContact(el.fieldEmail, 'email');
    bindContact(el.fieldPortfolio, 'portfolio');
    bindContact(el.fieldLinkedin, 'linkedin');

    // Stage 2 presets & custom section form
    document.querySelectorAll('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        addSection(chip.dataset.preset, chip.dataset.skills === 'true');
      });
    });

    el.formQuickAddSection.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = el.quickSectionTitle.value.trim();
      if (!title) return;
      addSection(title, el.quickSectionType.value === 'skills');
      el.quickSectionTitle.value = '';
    });

    // Stage 3 section arrows
    el.btnGoToStep2.addEventListener('click', () => goToWizardStep(2));
    el.btnPrevSection.addEventListener('click', () => {
      if (state.activeSectionIdx > 0) {
        state.activeSectionIdx -= 1;
        renderStage3Content();
      }
    });
    el.btnNextSection.addEventListener('click', () => {
      const len = (state.data?.sections || []).length;
      if (state.activeSectionIdx < len - 1) {
        state.activeSectionIdx += 1;
        renderStage3Content();
      }
    });

    // Stage 4 actions
    el.btnStage4Save.addEventListener('click', () => saveCurrentResume({ saveMode: 'snapshot', silent: false }).catch((e) => showToast(e.message, 'error')));
    el.btnStage4PreviewPdf.addEventListener('click', () => setPreviewMode('pdf'));
    el.btnStage4Docx.addEventListener('click', () => exportWizardFile('docx'));
    el.btnStage4Json.addEventListener('click', () => exportWizardFile('json'));
    el.btnStage4Pdf.addEventListener('click', () => exportWizardFile('pdf'));
    el.btnStage4OpenHistory.addEventListener('click', openHistoryModal);

    // Topbar wizard actions
    el.btnSave.addEventListener('click', () => saveCurrentResume({ saveMode: 'snapshot', silent: false }).catch((e) => showToast(e.message, 'error')));
    el.btnHistory.addEventListener('click', openHistoryModal);
    el.btnExportJson.addEventListener('click', () => exportWizardFile('json'));
    el.btnExportDocx.addEventListener('click', () => exportWizardFile('docx'));
    el.btnExportPdf.addEventListener('click', () => exportWizardFile('pdf'));

    // Flush unsaved changes if user closes or navigates away from tab
    window.addEventListener('beforeunload', () => {
      if (state.view === 'wizard' && state.isDirty && state.activeResumeId && state.data) {
        try {
          fetch(`/api/resumes/${encodeURIComponent(state.activeResumeId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify({ save_mode: 'autosave', data: state.data }),
          });
        } catch {
          // ignore
        }
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (state.view === 'wizard') {
          e.preventDefault();
          saveCurrentResume({ saveMode: 'snapshot', silent: false }).catch((err) => showToast(err.message, 'error'));
        }
      }
      if (e.key === 'Escape') {
        [el.modalSectionTitle, el.modalDeleteResume, el.modalConfirmAction, el.modalHistory, el.modalSettings, el.modalCreateMode].forEach(closeModal);
      }
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (state.view === 'wizard' && state.previewMode === 'live' && state.data) {
          updatePageBreakIndicators();
        }
      });
    }

    el.btnConfirmAction.addEventListener('click', () => {
      const fn = pendingConfirmFn;
      closeModal(el.modalConfirmAction);
      if (typeof fn === 'function') fn();
    });

    // Modal close buttons
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.getAttribute('data-close'));
        if (target) closeModal(target);
      });
    });

    // Edit Section Modal
    el.selectSectionFormat.addEventListener('change', updateSectionFormatHint);

    el.formSectionTitle.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = el.inputSectionTitle.value.trim().toUpperCase();
      if (!title || !state.data || state.renameSectionIdx === null) return;
      const sec = state.data.sections[state.renameSectionIdx];
      sec.title = title;

      const targetIsSkills = el.selectSectionFormat.value === 'skills';
      const converted = convertSectionFormat(sec, targetIsSkills);

      setDirty(true);
      closeModal(el.modalSectionTitle);
      if (state.wizardStep === 2) renderStage2Outline();
      if (state.wizardStep === 3) renderStage3Content();
      renderPreview();
      if (converted) {
        showToast(`Updated "${sec.title}" (${targetIsSkills ? 'Key-Value' : 'Standard'} format).`, 'success');
      } else {
        showToast(`Updated section "${sec.title}".`, 'success');
      }
    });

    // Delete Resume Modal
    el.confirmDeleteInput.addEventListener('input', () => {
      el.btnConfirmDeleteResume.disabled = el.confirmDeleteInput.value.trim() !== state.deleteTargetName;
    });

    el.formDeleteResume.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJson(`/api/resumes/${encodeURIComponent(state.deleteTargetId)}`, {
          method: 'DELETE',
          body: JSON.stringify({ confirm_name: el.confirmDeleteInput.value.trim() }),
        });
        closeModal(el.modalDeleteResume);
        showToast(`Deleted "${state.deleteTargetName}"`, 'success');
        await loadResumeList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Settings Modal
    el.aiProviderSelect.addEventListener('change', () => syncSettingsProviderFields(true));
    el.btnAddHeaderOverride.addEventListener('click', () => {
      const emptyMsg = el.headerGapOverridesList.querySelector('.override-empty');
      if (emptyMsg) emptyMsg.remove();
      const row = createHeaderOverrideRow('', clampPt(el.settingHeaderContentGap.value, 6));
      el.headerGapOverridesList.appendChild(row);
      if (window.lucide) lucide.createIcons();
      row.querySelector('.override-title-input')?.focus();
    });
    el.formSettings.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJson('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            ai: {
              provider: el.aiProviderSelect.value,
              model: el.aiModelInput.value.trim() || 'gpt-4o-mini',
            },
            api_keys: {
              OpenAI: el.keyOpenAI.value,
              Gemini: el.keyGemini.value,
              Claude: el.keyClaude.value,
              Other: el.keyOther.value,
            },
          }),
        });

        const hasOpenResume = state.view === 'wizard' && Boolean(state.data);
        if (hasOpenResume) {
          state.data.formatting = normalizeFormattingConfig({
            header_content_gap_pt: clampPt(el.settingHeaderContentGap.value, 6),
            section_gap_pt: clampPt(el.settingSectionGap.value, 6),
            entry_gap_pt: clampPt(el.settingEntryGap.value, 6),
            header_gap_overrides: collectHeaderOverrides(),
            auto_bold_stats: Boolean(el.settingAutoBoldStats.checked),
          });
          renderPreview();
          if (!state.isNewResume && state.activeResumeId) {
            await saveCurrentResume({ saveMode: 'autosave', silent: true });
          } else {
            setDirty(true);
          }
          if (state.previewMode === 'pdf') {
            refreshNativePdfPreview();
          }
        }

        closeModal(el.modalSettings);
        showToast(hasOpenResume ? 'AI & resume formatting settings saved.' : 'Global AI settings saved.', 'success');
        if (state.aiOpen || state.editorMode === 'ai') {
          await refreshAiSettingsStatus();
          if (state.aiOpen) renderAiQuickChips();
          if (state.editorMode === 'ai') renderFullAiQuickChips();
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Full-Resume AI Builder Composer & Sidebar
    el.btnToggleAiSidebar.addEventListener('click', toggleAiSidebar);
    el.btnSidebarNewChat.addEventListener('click', resetFullAiConversation);
    el.btnFullAiUndo.addEventListener('click', undoLastFullAiChange);
    el.btnFullAiReset.addEventListener('click', resetFullAiConversation);
    el.btnFullAiOpenSettings.addEventListener('click', openSettingsModal);
    el.fullAiInput.addEventListener('input', () => autoResizeTextarea(el.fullAiInput));
    el.fullAiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendFullAiMessage(el.fullAiInput.value);
      }
    });
    el.fullAiComposerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendFullAiMessage(el.fullAiInput.value);
    });

    // Writing Assistant Drawer
    el.btnAiClose.addEventListener('click', closeAiDrawer);
    el.btnAiReset.addEventListener('click', () => {
      state.aiMessages = [];
      renderAiThread();
      el.aiInput.focus();
    });
    el.btnAiOpenSettings.addEventListener('click', openSettingsModal);

    el.aiInput.addEventListener('input', () => autoResizeTextarea(el.aiInput));
    el.aiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAiMessage(el.aiInput.value);
      }
    });
    el.aiComposerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendAiMessage(el.aiInput.value);
    });

    // Preview Mode & Zoom
    el.modeLiveHtml.addEventListener('click', () => setPreviewMode('live'));
    el.modeNativePdf.addEventListener('click', () => setPreviewMode('pdf'));
    el.btnRefreshPdf.addEventListener('click', refreshNativePdfPreview);

    el.btnZoomIn.addEventListener('click', () => {
      state.zoom = Math.min(1.25, +(state.zoom + 0.1).toFixed(2));
      updateZoom();
    });
    el.btnZoomOut.addEventListener('click', () => {
      state.zoom = Math.max(0.5, +(state.zoom - 0.1).toFixed(2));
      updateZoom();
    });

    // Mobile Tabs
    el.tabEditor.addEventListener('click', () => {
      el.tabEditor.classList.add('active');
      el.tabPreview.classList.remove('active');
      el.editorPane.classList.remove('mobile-hidden');
      el.previewPane.classList.add('mobile-hidden');
    });
    el.tabPreview.addEventListener('click', () => {
      el.tabPreview.classList.add('active');
      el.tabEditor.classList.remove('active');
      el.previewPane.classList.remove('mobile-hidden');
      el.editorPane.classList.add('mobile-hidden');
    });

    // Interactive Tour Triggers & Controls
    if (el.btnDirTour) el.btnDirTour.addEventListener('click', () => startTour(0));
    if (el.btnWizTour) el.btnWizTour.addEventListener('click', () => startTour(3));
    if (el.btnStartWelcomeTour) {
      el.btnStartWelcomeTour.addEventListener('click', () => {
        localStorage.setItem('rb_tour_completed', '1');
        if (el.tourWelcomeBanner) el.tourWelcomeBanner.hidden = true;
        startTour(0);
      });
    }
    if (el.btnDismissWelcomeTour) {
      el.btnDismissWelcomeTour.addEventListener('click', () => {
        localStorage.setItem('rb_tour_completed', '1');
        if (el.tourWelcomeBanner) el.tourWelcomeBanner.hidden = true;
      });
    }
    if (el.btnTourClose) el.btnTourClose.addEventListener('click', endTour);
    if (el.btnTourSkip) el.btnTourSkip.addEventListener('click', endTour);
    if (el.btnTourPrev) el.btnTourPrev.addEventListener('click', () => goToTourStep(tourState.stepIdx - 1));
    if (el.btnTourNext) {
      el.btnTourNext.addEventListener('click', () => {
        if (tourState.stepIdx >= TOUR_STEPS.length - 1) {
          endTour();
        } else {
          goToTourStep(tourState.stepIdx + 1);
        }
      });
    }
    window.addEventListener('resize', () => {
      if (tourState.active) positionCurrentTourStep();
    });
    document.addEventListener('keydown', (e) => {
      if (!tourState.active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        endTour();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (tourState.stepIdx >= TOUR_STEPS.length - 1) endTour();
        else goToTourStep(tourState.stepIdx + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (tourState.stepIdx > 0) goToTourStep(tourState.stepIdx - 1);
      }
    });
  }

  // =========================================================
  // INTERACTIVE VIRTUAL TOUR
  // =========================================================
  const TOUR_DEMO_RESUME = {
    name: 'Elena Vance',
    phone: '(415) 555-0148',
    email: 'elena.vance@example.com',
    portfolio: 'github.com/elenavance',
    linkedin: 'linkedin.com/in/elenavance',
    sections: [
      {
        title: 'PROFESSIONAL SUMMARY',
        is_skills: false,
        items: [{
          role: '', company: '', location: '', date: '', subtitle: '', subtitle_right: '',
          details: [{ is_bullet: false, text: 'Cloud security and backend engineer with 6+ years building high-throughput APIs and automated DevSecOps pipelines.' }],
        }],
      },
      {
        title: 'EXPERIENCE',
        is_skills: false,
        items: [{
          role: 'Senior Security Engineer',
          company: 'Aegis Cloud Systems',
          location: 'San Francisco, CA',
          date: 'Mar 2023 - Present',
          subtitle: '',
          subtitle_right: '',
          details: [
            { is_bullet: true, text: 'Re-engineered payment queue in Go and RabbitMQ, reducing checkout latency by 60% (1.2s to 450ms) across 50K peak orders.' },
            { is_bullet: true, text: 'Automated SAST/DAST scanning in GitLab CI/CD with SonarQube and Trivy, cutting remediation time by 35%.' },
          ],
        }],
      },
      {
        title: 'TECHNICAL SKILLS',
        is_skills: true,
        items: [
          { category: 'Languages', text: 'Go, Python, TypeScript, SQL' },
          { category: 'Cloud & Security', text: 'AWS, Kubernetes, Docker, Trivy, SonarQube' },
        ],
      },
    ],
  };

  const tourState = {
    active: false,
    stepIdx: 0,
    origin: null,
    demoLoaded: false,
  };

  function showTourDirectoryUiOnly() {
    el.directoryView.hidden = false;
    el.wizardView.hidden = true;
    el.wizardTopContext.hidden = true;
    el.wizardTopActions.hidden = true;
    el.directoryTopActions.hidden = false;
    closeModal(el.modalSettings);
  }

  async function ensureTourWorkspaceReady() {
    closeModal(el.modalSettings);
    if (state.view === 'wizard' && state.data) {
      el.directoryView.hidden = true;
      el.wizardView.hidden = false;
      el.wizardTopContext.hidden = false;
      el.wizardTopActions.hidden = false;
      el.directoryTopActions.hidden = true;
      return;
    }
    if (!tourState.demoLoaded) {
      if (state.resumes && state.resumes.length > 0) {
        try {
          const rec = await fetchJson(`/api/resumes/${encodeURIComponent(state.resumes[0].id)}`);
          state.data = rec.data;
          state.activeResumeId = rec.id;
          state.activeResumeSlug = rec.slug || 'resume';
          state.isNewResume = false;
          state.isDirty = false;
        } catch {
          state.data = JSON.parse(JSON.stringify(TOUR_DEMO_RESUME));
          state.isNewResume = true;
        }
      } else {
        state.data = JSON.parse(JSON.stringify(TOUR_DEMO_RESUME));
        state.isNewResume = true;
      }
      tourState.demoLoaded = true;
    }
    state.activeSectionIdx = 0;
    enterWizardView('manual');
  }

  const TOUR_STEPS = [
    {
      title: '1. Local Resume Directory',
      body: `
        <p>Every resume and version snapshot lives locally in SQLite (<code>resumes.db</code>) on your machine.</p>
        <ul>
          <li><strong>Search</strong> live by candidate name, email, or phone.</li>
          <li><strong>Edit</strong>, <strong>Duplicate</strong>, or download <strong>DOCX / PDF / JSON</strong> directly from any row.</li>
        </ul>
      `,
      selector: () => (el.directoryList && !el.directoryList.hidden ? '#directoryList' : '#directoryEmpty'),
      prepare: async () => {
        showTourDirectoryUiOnly();
      },
    },
    {
      title: '2. Creating & Importing Resumes',
      body: `
        <p>Use the top-right toolbar to get started quickly:</p>
        <ul>
          <li><strong>Create New Resume:</strong> Choose between the guided <strong>Manual Wizard</strong> or conversational <strong>AI Builder</strong>.</li>
          <li><strong>Import JSON:</strong> Load any previously exported <code>.json</code> resume backup straight into your database.</li>
        </ul>
      `,
      selector: () => '#directoryTopActions',
      prepare: async () => {
        showTourDirectoryUiOnly();
      },
    },
    {
      title: '3. Global Settings: AI Providers & Local Keys',
      body: `
        <p>Your AI provider, model, and API keys are <strong>global</strong> across the whole app (stored locally in <code>settings.json</code>).</p>
        <ul>
          <li>Pick <strong>OpenAI</strong> (e.g. <code>gpt-4o-mini</code>), <strong>Google Gemini</strong>, or <strong>Anthropic Claude</strong>, or leave blank if you only use manual editing.</li>
          <li><em>Note:</em> Spacing and bolding settings are saved <strong>per resume</strong>—open any resume to customize those.</li>
        </ul>
      `,
      selector: () => '#modalSettings .form-grid-2',
      prepare: async () => {
        showTourDirectoryUiOnly();
        await openSettingsModal();
        const mb = el.modalSettings.querySelector('.modal-body');
        if (mb) mb.scrollTop = 0;
      },
    },
    {
      title: '4. Manual Wizard ↔ AI Builder Sync',
      body: `
        <p>Inside a resume workspace, switch tabs anytime between <strong>Manual Wizard</strong> and <strong>AI Builder</strong>.</p>
        <p>Both edit the exact same live resume—any changes you make in one mode appear immediately in the other.</p>
      `,
      selector: () => '.editor-mode-bar',
      prepare: async () => {
        await ensureTourWorkspaceReady();
        setEditorMode('manual');
        goToWizardStep(1);
      },
    },
    {
      title: '5. Per-Resume Spacing & Per-Header Overrides',
      body: `
        <p>When you open <strong>Settings</strong> inside a resume, you can tailor layout gaps <strong>specifically for this resume</strong> (saved in SQLite &amp; JSON exports):</p>
        <ul>
          <li><strong>Under Headers / Between Sections / Between Entries:</strong> Standardized to <code>6pt</code> by default so Summary, Experience, and Skills match.</li>
          <li><strong>Per-Header Gap Overrides:</strong> Click <strong>Add Override</strong> to set a custom gap for one specific header (e.g. <code>SKILLS: 3pt</code>) without affecting your other resumes.</li>
        </ul>
      `,
      selector: () => '#modalSettings .form-grid-3',
      prepare: async () => {
        await ensureTourWorkspaceReady();
        if (el.modalSettings.hidden) await openSettingsModal();
        el.settingHeaderContentGap?.scrollIntoView({ block: 'center' });
      },
    },
    {
      title: '6. Per-Resume Auto-Bold Statistics & Markdown',
      body: `
        <p>Enable or disable <strong>Auto-bold statistics</strong> independently for each resume:</p>
        <ul>
          <li><strong>Auto-bold statistics:</strong> Automatically bolds percentages, currency, multipliers, and scale counts (ignoring years &amp; tech versions).</li>
          <li><strong>Manual Markdown:</strong> Wrap text in <code>**bold**</code> anytime—if a bullet has manual <code>**...**</code>, auto-bold skips the rest of that bullet. Prefix a stat with <code>\\</code> (e.g. <code>\\24-bed</code>) to ignore it.</li>
        </ul>
      `,
      selector: () => '#settingAutoBoldStats',
      selectorClosest: '.form-toggle-row',
      prepare: async () => {
        await ensureTourWorkspaceReady();
        if (el.modalSettings.hidden) await openSettingsModal();
        el.settingAutoBoldStats?.scrollIntoView({ block: 'center' });
      },
    },
    {
      title: '7. Sections & Layout Formats (Step 2)',
      body: `
        <p>In <strong>Step 2 (Sections)</strong>, add presets or custom sections, rename them, and reorder them up or down.</p>
        <ul>
          <li><strong>Standard Format:</strong> Used for Professional Summary, Experience, Education, and Projects.</li>
          <li><strong>Key-Value Format:</strong> Two-column <code>Category: Items</code> rows ideal for Skills and Certifications.</li>
        </ul>
      `,
      selector: () => '#stage2',
      prepare: async () => {
        await ensureTourWorkspaceReady();
        setEditorMode('manual');
        goToWizardStep(2);
      },
    },
    {
      title: '8. Bullets, Prose, AI Assist & Safe Delete (Step 3)',
      body: `
        <p>In <strong>Step 3 (Content)</strong>, fill in entries or fine-tune individual lines:</p>
        <ul>
          <li><strong>Bullet vs. Prose:</strong> Toggle any detail row—leave Role/Company/Date blank + <strong>Prose</strong> for a clean Summary paragraph.</li>
          <li><strong>Draft with AI / Assist:</strong> Get Google XYZ coaching and 1-line rewrites for any bullet.</li>
          <li><strong>Safe Delete:</strong> Clicking <code>×</code> opens an <em>"Are you sure?"</em> confirmation dialog so you never lose a bullet by accident.</li>
        </ul>
      `,
      selector: () => {
        const container = document.getElementById('activeSectionContainer');
        return container && container.children.length > 0 ? '#activeSectionContainer' : '#stage3';
      },
      prepare: async () => {
        await ensureTourWorkspaceReady();
        setEditorMode('manual');
        const sections = state.data?.sections || [];
        const expIdx = sections.findIndex((s) => !s.is_skills && (s.items || []).length > 0);
        state.activeSectionIdx = expIdx >= 0 ? expIdx : 0;
        goToWizardStep(3);
      },
    },
    {
      title: '9. Conversational AI Builder & Undo',
      body: `
        <p>Prefer chatting? Describe your background, target job, or edits in plain English and the AI populates your resume in real time.</p>
        <ul>
          <li>Saved conversations live in the <strong>Saved Chats</strong> sidebar.</li>
          <li>Use <strong>Undo Last Edit</strong> anytime to revert the latest AI change in one click.</li>
        </ul>
      `,
      selector: () => '#aiBuilderView',
      prepare: async () => {
        await ensureTourWorkspaceReady();
        setEditorMode('ai');
      },
    },
    {
      title: '10. Live Layout, Page Counter & PDF Render',
      body: `
        <p>The right pane gives you real-time visual feedback in Cambria/Caladea:</p>
        <ul>
          <li><strong>Page Badge &amp; Break Line:</strong> Tracks US Letter length (<code>1 Page</code> vs. <code>~2 Pages Overflow</code>) and draws a dashed page-break line if you spill onto Page 2.</li>
          <li><strong>PDF Render:</strong> Click <strong>PDF Render</strong> to inspect the exact LibreOffice/Word paginated PDF before exporting.</li>
        </ul>
      `,
      selector: () => '#previewPane .preview-toolbar',
      prepare: async () => {
        await ensureTourWorkspaceReady();
        setEditorMode('manual');
        goToWizardStep(1);
        setPreviewMode('live');
      },
    },
    {
      title: '11. Auto-Save, History & Exports',
      body: `
        <p>Your work is protected automatically as you type:</p>
        <ul>
          <li><strong>Save Snapshot (<code>Cmd+S</code> / <code>Ctrl+S</code>):</strong> Create named checkpoints anytime.</li>
          <li><strong>History:</strong> Inspect, export, or restore any earlier snapshot without losing safety.</li>
          <li><strong>DOCX / PDF / JSON:</strong> Export publication-ready Word and PDF files from <code>Base_Template.docx</code>, or replay this tour anytime via the compass icon.</li>
        </ul>
      `,
      selector: () => '#wizardTopActions',
      prepare: async () => {
        await ensureTourWorkspaceReady();
      },
    },
  ];

  async function startTour(startIndex = 0) {
    tourState.active = true;
    tourState.demoLoaded = false;
    tourState.origin = {
      view: state.view,
      wizardStep: state.wizardStep,
      editorMode: state.editorMode,
      previewMode: state.previewMode,
      activeSectionIdx: state.activeSectionIdx,
      settingsOpen: !el.modalSettings.hidden,
    };
    el.tourOverlay.hidden = false;
    await goToTourStep(startIndex);
  }

  async function endTour() {
    if (!tourState.active) return;
    tourState.active = false;
    el.tourOverlay.hidden = true;
    closeModal(el.modalSettings);
    localStorage.setItem('rb_tour_completed', '1');
    if (el.tourWelcomeBanner) el.tourWelcomeBanner.hidden = true;

    const orig = tourState.origin;
    if (orig) {
      if (orig.view === 'directory') {
        if (tourState.demoLoaded) {
          state.data = null;
          state.activeResumeId = null;
          state.isNewResume = false;
          state.isDirty = false;
        }
        showTourDirectoryUiOnly();
      } else {
        el.directoryView.hidden = true;
        el.wizardView.hidden = false;
        el.wizardTopContext.hidden = false;
        el.wizardTopActions.hidden = false;
        el.directoryTopActions.hidden = true;
        state.activeSectionIdx = orig.activeSectionIdx || 0;
        setEditorMode(orig.editorMode || 'manual');
        goToWizardStep(orig.wizardStep || 1);
        setPreviewMode(orig.previewMode || 'live');
      }
      if (orig.settingsOpen) {
        await openSettingsModal();
      }
    }
    tourState.origin = null;
    tourState.demoLoaded = false;
  }

  function positionCurrentTourStep() {
    const step = TOUR_STEPS[tourState.stepIdx];
    if (!step) return;
    const rawSel = typeof step.selector === 'function' ? step.selector() : step.selector;
    let targetEl = rawSel ? document.querySelector(rawSel) : null;
    if (targetEl && step.selectorClosest) {
      targetEl = targetEl.closest(step.selectorClosest) || targetEl;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popEl = el.tourPopover;
    const spotEl = el.tourSpotlight;

    if (!targetEl) {
      spotEl.style.top = '50%';
      spotEl.style.left = '50%';
      spotEl.style.width = '0px';
      spotEl.style.height = '0px';
      popEl.style.top = `${Math.max(16, (vh - popEl.offsetHeight) / 2)}px`;
      popEl.style.left = `${Math.max(16, (vw - popEl.offsetWidth) / 2)}px`;
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const pad = 6;
    const sTop = Math.max(4, rect.top - pad);
    const sLeft = Math.max(4, rect.left - pad);
    const sWidth = Math.min(vw - sLeft - 4, rect.width + pad * 2);
    const sHeight = Math.min(vh - sTop - 4, rect.height + pad * 2);

    spotEl.style.top = `${sTop}px`;
    spotEl.style.left = `${sLeft}px`;
    spotEl.style.width = `${sWidth}px`;
    spotEl.style.height = `${sHeight}px`;

    const popW = popEl.offsetWidth || 380;
    const popH = popEl.offsetHeight || 220;
    const gap = 14;
    let pTop = 16;
    let pLeft = 16;

    if (vh - rect.bottom >= popH + gap + 12) {
      pTop = rect.bottom + gap;
      pLeft = Math.min(vw - popW - 12, Math.max(12, rect.left));
    } else if (rect.top >= popH + gap + 12) {
      pTop = rect.top - popH - gap;
      pLeft = Math.min(vw - popW - 12, Math.max(12, rect.left));
    } else if (vw - rect.right >= popW + gap + 12) {
      pTop = Math.min(vh - popH - 12, Math.max(12, rect.top));
      pLeft = rect.right + gap;
    } else if (rect.left >= popW + gap + 12) {
      pTop = Math.min(vh - popH - 12, Math.max(12, rect.top));
      pLeft = rect.left - popW - gap;
    } else {
      pTop = vh - popH - 16;
      pLeft = vw - popW - 16;
    }

    popEl.style.top = `${Math.max(12, Math.min(vh - popH - 12, pTop))}px`;
    popEl.style.left = `${Math.max(12, Math.min(vw - popW - 12, pLeft))}px`;
  }

  async function goToTourStep(idx) {
    if (idx < 0 || idx >= TOUR_STEPS.length) return;
    tourState.stepIdx = idx;
    const step = TOUR_STEPS[idx];
    if (typeof step.prepare === 'function') {
      await step.prepare();
    }
    el.tourStepCounter.textContent = `Step ${idx + 1} of ${TOUR_STEPS.length}`;
    el.tourStepTitle.textContent = step.title;
    el.tourStepBody.innerHTML = step.body;
    el.btnTourPrev.disabled = idx === 0;
    el.btnTourNext.textContent = idx === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
    if (window.lucide) lucide.createIcons();

    requestAnimationFrame(() => {
      positionCurrentTourStep();
      setTimeout(positionCurrentTourStep, 60);
    });
  }

  // Init
  async function init() {
    if (window.lucide) lucide.createIcons();
    updateZoom();
    bindEvents();
    await refreshAiSettingsStatus();
    try {
      const params = new URLSearchParams(window.location.search);
      const resumeParam = params.get('resume');
      const stepParam = Math.min(4, Math.max(1, Number(params.get('step') || 1)));
      if (resumeParam) {
        await openExistingResumeInWizard(resumeParam, stepParam);
      } else {
        await showDirectoryView();
      }
    } catch (err) {
      await showDirectoryView();
      showToast(`Failed to load resumes: ${err.message}`, 'error');
    }
  }

  init();
})();
