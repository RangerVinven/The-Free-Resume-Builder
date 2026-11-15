(() => {
  'use strict';

  const MAX_TEXTAREA_HEIGHT = 220;

  const state = {
    view: 'directory', // 'directory' | 'wizard'
    resumes: [],
    searchQuery: '',
    isNewResume: false,
    activeFilename: null,
    data: null,
    isDirty: false,
    wizardStep: 1, // 1..4
    activeSectionIdx: 0,
    previewMode: 'live', // 'live' | 'pdf'
    zoom: 0.85,
    renameSectionIdx: null,
    deleteTargetFilename: null,
    aiOpen: false,
    aiTarget: null, // { secIdx, itemIdx, detailIdx }
    aiMessages: [], // { role: 'user'|'assistant', content: string, suggestions?: Array }
    aiLoading: false,
    aiConfig: { provider: 'OpenAI', model: 'gpt-4o-mini', hasOpenAIKey: false },
    editorMode: 'manual', // 'manual' | 'ai'
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
    activeFileBadge: document.getElementById('activeFileBadge'),
    directoryTopActions: document.getElementById('directoryTopActions'),
    wizardTopActions: document.getElementById('wizardTopActions'),
    btnDirSettings: document.getElementById('btnDirSettings'),
    btnDirNewResume: document.getElementById('btnDirNewResume'),
    btnWizSettings: document.getElementById('btnWizSettings'),
    saveStatus: document.getElementById('saveStatus'),
    saveStatusText: document.getElementById('saveStatusText'),
    btnSave: document.getElementById('btnSave'),
    btnHistory: document.getElementById('btnHistory'),
    historyBadge: document.getElementById('historyBadge'),
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
    btnStage4Pdf: document.getElementById('btnStage4Pdf'),
    btnStage4OpenHistory: document.getElementById('btnStage4OpenHistory'),
    stage4HistoryPreview: document.getElementById('stage4HistoryPreview'),

    // Preview Pane
    modeLiveHtml: document.getElementById('modeLiveHtml'),
    modeNativePdf: document.getElementById('modeNativePdf'),
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

    modalCreateMode: document.getElementById('modalCreateMode'),
    btnChooseManualCreate: document.getElementById('btnChooseManualCreate'),
    btnChooseAiCreate: document.getElementById('btnChooseAiCreate'),

    // Full-Resume AI Builder View
    fullAiModelBadge: document.getElementById('fullAiModelBadge'),
    btnFullAiUndo: document.getElementById('btnFullAiUndo'),
    btnFullAiReset: document.getElementById('btnFullAiReset'),
    fullAiNoKeyBanner: document.getElementById('fullAiNoKeyBanner'),
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
  }

  function swapItems(arr, i, j) {
    if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return;
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }

  function setDirty(dirty) {
    state.isDirty = dirty;
    if (state.isNewResume) {
      el.saveStatus.className = 'status-pill status-dirty';
      el.saveStatusText.textContent = 'Draft (not saved)';
    } else if (dirty) {
      el.saveStatus.className = 'status-pill status-dirty';
      el.saveStatusText.textContent = 'Unsaved changes';
    } else {
      el.saveStatus.className = 'status-pill status-saved';
      el.saveStatusText.textContent = 'Saved';
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
    if (state.view === 'wizard' && state.isDirty && !state.isNewResume) {
      if (!confirm('You have unsaved changes. Return to the resume list without saving?')) {
        return;
      }
    }
    state.view = 'directory';
    state.activeFilename = null;
    state.data = null;
    state.isNewResume = false;
    state.isDirty = false;
    state.aiOpen = false;
    state.aiTarget = null;
    state.editorMode = 'manual';
    state.fullAiMessages = [];
    state.fullAiLoading = false;
    state.lastAiUndoState = null;
    el.aiDrawer.hidden = true;

    el.directoryView.hidden = false;
    el.wizardView.hidden = true;
    el.wizardTopContext.hidden = true;
    el.wizardTopActions.hidden = true;
    el.directoryTopActions.hidden = false;

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
      el.activeFileBadge.hidden = true;
      el.btnSave.disabled = false;
      el.btnHistory.disabled = true;
      el.btnExportDocx.disabled = true;
      el.btnExportPdf.disabled = true;
      el.historyBadge.hidden = true;
    } else {
      el.activeResumeLabel.textContent = state.data?.name || state.activeFilename;
      el.activeFileBadge.textContent = state.activeFilename;
      el.activeFileBadge.hidden = false;
      el.btnSave.disabled = false;
      el.btnHistory.disabled = false;
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
      return (r.name || '').toLowerCase().includes(q) || (r.filename || '').toLowerCase().includes(q);
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

      // Candidate & file
      const colCand = document.createElement('div');
      colCand.className = 'dir-candidate';
      colCand.innerHTML = `
        <span class="dir-name">${escapeHtml(r.name)}</span>
        <div class="dir-meta-line">
          <span class="mono-code">${escapeHtml(r.filename)}</span>
          ${r.email ? `<span>${escapeHtml(r.email)}</span>` : ''}
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

      // History count
      const colHist = document.createElement('div');
      colHist.className = 'dir-mono-cell';
      colHist.textContent = `${r.history_count || 0} saved`;

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
      btnEdit.addEventListener('click', () => openExistingResumeInWizard(r.filename, 1));

      const btnDocx = document.createElement('button');
      btnDocx.type = 'button';
      btnDocx.className = 'btn btn-secondary btn-xs';
      btnDocx.title = 'Download DOCX';
      btnDocx.textContent = 'DOCX';
      btnDocx.addEventListener('click', () => downloadDirectFile(r.filename, 'docx', btnDocx));

      const btnPdf = document.createElement('button');
      btnPdf.type = 'button';
      btnPdf.className = 'btn btn-secondary btn-xs';
      btnPdf.title = 'Download PDF';
      btnPdf.textContent = 'PDF';
      btnPdf.addEventListener('click', () => downloadDirectFile(r.filename, 'pdf', btnPdf));

      const btnDel = makeIconButton('trash-2', 'Delete Resume', false, () => openDeleteModal(r.filename), 'btn-danger-hover');

      colActions.append(btnEdit, btnDocx, btnPdf, btnDel);
      row.append(colCand, colSecs, colHist, colTime, colActions);
      el.directoryRows.appendChild(row);
    });

    if (window.lucide) lucide.createIcons();
  }

  async function downloadDirectFile(filename, format, btn) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await fetch(`/api/resumes/${encodeURIComponent(filename)}/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Export failed.');
      }
      const blob = await res.blob();
      const outName = `${filename.replace('.json', '')}_generated.${format}`;
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
    state.activeFilename = null;
    state.wizardStep = 1;
    state.activeSectionIdx = 0;
    state.fullAiMessages = [];
    state.lastAiUndoState = null;
    state.data = {
      name: '',
      phone: '',
      email: '',
      portfolio: '',
      linkedin: '',
      sections: [],
    };
    setDirty(true);
    enterWizardView(initialMode);
    if (initialMode === 'manual') {
      el.fieldName.focus();
    }
  }

  async function openExistingResumeInWizard(filename, startStep = 1) {
    const res = await fetchJson(`/api/resumes/${encodeURIComponent(filename)}`);
    state.isNewResume = false;
    state.activeFilename = res.filename;
    state.data = res.data;
    if (!Array.isArray(state.data.sections)) {
      state.data.sections = [];
    }
    state.wizardStep = startStep;
    state.activeSectionIdx = 0;
    setDirty(false);
    enterWizardView();
  }

  // =========================================================
  // WIZARD STEP MANAGEMENT
  // =========================================================
  function renderWizardStep() {
    const step = state.wizardStep;

    // Stepper Pills
    el.stepButtons.forEach((btn) => {
      const btnStep = Number(btn.dataset.step);
      btn.classList.toggle('active', btnStep === step);
      btn.classList.toggle('completed', !state.isNewResume && btnStep < step);
      // Lock steps 2-4 until new resume has been saved/created
      btn.disabled = state.isNewResume && btnStep > 1;
    });

    // Show/Hide Stage Containers
    Object.entries(el.stages).forEach(([k, stageEl]) => {
      stageEl.hidden = Number(k) !== step;
    });

    // Footer buttons
    el.wizardStepIndicator.textContent = `Step ${step} of 4`;
    el.btnWizardPrev.disabled = step === 1;

    if (step === 1 && state.isNewResume) {
      el.btnWizardNext.innerHTML = '<span>Create &amp; Continue</span><i data-lucide="arrow-right"></i>';
    } else if (step < 4) {
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
    if (state.isNewResume && targetStep > 1) {
      const created = await createDraftResumeOnServer();
      if (!created) return;
    }
    if (targetStep !== 3 && state.aiOpen) {
      closeAiDrawer();
    }
    state.wizardStep = targetStep;
    renderWizardStep();
  }

  async function createDraftResumeOnServer() {
    const name = (state.data.name || '').trim();
    if (!name) {
      showToast('Please enter a Full Name (or tell the AI your name) before saving.', 'error');
      if (state.editorMode === 'manual') {
        el.fieldName.focus();
      }
      return false;
    }
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
      state.activeFilename = res.filename;
      state.data = res.data;
      setDirty(false);
      updateWizardHeaderMeta();
      showToast(`Created ${res.filename}`, 'success');
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    }
  }

  async function saveCurrentResume(silent = false) {
    if (!state.data) return;
    if (state.isNewResume) {
      await createDraftResumeOnServer();
      renderWizardStep();
      return;
    }
    const res = await fetchJson(`/api/resumes/${encodeURIComponent(state.activeFilename)}`, {
      method: 'PUT',
      body: JSON.stringify(state.data),
    });
    state.data = res.data;
    setDirty(false);
    updateWizardHeaderMeta();
    if (state.wizardStep === 4) {
      renderStage4Review();
    }
    if (!silent) {
      showToast('Resume saved successfully.', 'success');
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
          if (confirm(`Delete section "${sec.title}" and all of its entries?`)) {
            sections.splice(idx, 1);
            if (state.activeSectionIdx >= sections.length) {
              state.activeSectionIdx = Math.max(0, sections.length - 1);
            }
            setDirty(true);
            renderStage2Outline();
            renderPreview();
          }
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
        if (confirm('Delete this entry?')) {
          sec.items.splice(itemIdx, 1);
          setDirty(true);
          renderActiveSectionCard(sec, state.activeSectionIdx);
          renderPreview();
        }
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
            details.splice(dIdx, 1);
            if (state.aiOpen && state.aiTarget && state.aiTarget.secIdx === state.activeSectionIdx && state.aiTarget.itemIdx === itemIdx && state.aiTarget.detailIdx === dIdx) {
              closeAiDrawer();
            }
            setDirty(true);
            renderActiveSectionCard(sec, state.activeSectionIdx);
            renderPreview();
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
      el.stage4HistoryPreview.innerHTML = '<p class="field-hint margin-none">No snapshots recorded yet. Click "Save Snapshot" after making edits.</p>';
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
    const row = document.createElement('div');
    row.className = 'history-row';

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.innerHTML = `
      <span class="history-time">Version #${idx + 1} &mdash; ${escapeHtml(entry.timestamp)}</span>
      <span class="history-summary">${escapeHtml(entry.state?.name || '')} &bull; ${sCount} section(s)</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const btnDocx = document.createElement('a');
    btnDocx.className = 'btn btn-secondary btn-xs';
    btnDocx.href = `/api/resumes/${encodeURIComponent(state.activeFilename)}/history/${idx}/export/docx`;
    btnDocx.textContent = 'DOCX';

    const btnPdf = document.createElement('a');
    btnPdf.className = 'btn btn-secondary btn-xs';
    btnPdf.href = `/api/resumes/${encodeURIComponent(state.activeFilename)}/history/${idx}/export/pdf`;
    btnPdf.textContent = 'PDF';

    const btnRevert = document.createElement('button');
    btnRevert.type = 'button';
    btnRevert.className = 'btn btn-primary btn-xs';
    btnRevert.textContent = 'Revert';
    btnRevert.addEventListener('click', async () => {
      if (!confirm(`Revert to Version #${idx + 1} (${entry.timestamp})? Your current state will be archived in history.`)) {
        return;
      }
      try {
        const res = await fetchJson(`/api/resumes/${encodeURIComponent(state.activeFilename)}/history/${idx}/revert`, {
          method: 'POST',
        });
        state.data = res.data;
        setDirty(false);
        updateWizardHeaderMeta();
        bindContactFields();
        renderWizardStep();
        renderPreview();
        closeModal(el.modalHistory);
        showToast(`Reverted to Version #${idx + 1}.`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    actions.append(btnDocx, btnPdf, btnRevert);
    row.append(meta, actions);
    return row;
  }

  // =========================================================
  // LIVE PAPER PREVIEW & NATIVE PDF PREVIEW
  // =========================================================
  function renderPreview() {
    if (!state.data) {
      el.resumePaper.innerHTML = '';
      return;
    }

    const d = state.data;
    const contactParts = [d.phone, d.email, d.portfolio, d.linkedin]
      .filter((v) => v && String(v).trim().length > 0)
      .map((v) => escapeHtml(v.trim()));

    let html = `
      <h1 class="paper-name">${escapeHtml(d.name || 'Your Name')}</h1>
      <p class="paper-contact">${contactParts.join(' | ')}</p>
    `;

    (d.sections || []).forEach((sec) => {
      html += `<div class="paper-section">`;
      html += `<h2 class="paper-section-title">${escapeHtml((sec.title || '').toUpperCase())}</h2>`;

      if (sec.is_skills) {
        (sec.items || []).forEach((skill) => {
          html += `<p class="paper-skill-row"><span class="paper-skill-cat">${escapeHtml(skill.category || '')}:</span> ${escapeHtml(skill.text || '')}</p>`;
        });
      } else {
        (sec.items || []).forEach((item) => {
          html += `<div class="paper-item">`;

          const hasHeader = item.role || item.company || item.location || item.date;
          if (hasHeader) {
            let leftHeader = '';
            if (item.role) {
              leftHeader += `<span class="paper-item-role">${escapeHtml(item.role)}</span>`;
            }
            if (item.company) {
              leftHeader += `${item.role ? ', ' : ''}${escapeHtml(item.company)}`;
            }
            if (item.location) {
              leftHeader += ` &ndash; ${escapeHtml(item.location)}`;
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
            if (detail.is_bullet) {
              if (!inBulletList) {
                html += `<ul class="paper-details-list">`;
                inBulletList = true;
              }
              html += `<li class="paper-detail-bullet">${escapeHtml(detail.text || '')}</li>`;
            } else {
              if (inBulletList) {
                html += `</ul>`;
                inBulletList = false;
              }
              html += `<p class="paper-detail-prose">${escapeHtml(detail.text || '')}</p>`;
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
    if (!isLive) {
      refreshNativePdfPreview();
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
    if (!state.activeFilename) return;
    if (state.isDirty) {
      await saveCurrentResume(true);
    }
    el.pdfLoadingState.hidden = false;
    el.pdfFrame.onload = () => {
      el.pdfLoadingState.hidden = true;
    };
    el.pdfFrame.src = `/api/resumes/${encodeURIComponent(state.activeFilename)}/preview-pdf?t=${Date.now()}`;
  }

  async function exportWizardFile(format) {
    if (state.isNewResume) {
      const ok = await createDraftResumeOnServer();
      if (!ok) return;
      renderWizardStep();
    }
    if (!state.activeFilename || !state.data) return;
    if (state.isDirty) {
      await saveCurrentResume(true);
    }

    const btn = format === 'pdf' ? el.btnExportPdf : el.btnExportDocx;
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>Exporting...</span>';

    try {
      const res = await fetch(`/api/resumes/${encodeURIComponent(state.activeFilename)}/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: state.data }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Export failed.');
      }
      const blob = await res.blob();
      const outName = `${state.activeFilename.replace('.json', '')}_generated.${format}`;
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
  function openDeleteModal(filename) {
    state.deleteTargetFilename = filename;
    el.deleteTargetName.textContent = filename;
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

  async function refreshAiSettingsStatus() {
    try {
      const { settings } = await fetchJson('/api/settings');
      const keys = settings.api_keys || {};
      const ai = settings.ai || {};
      state.aiConfig = {
        provider: ai.provider || 'OpenAI',
        model: ai.model || 'gpt-4o-mini',
        hasOpenAIKey: Boolean((keys.OpenAI || '').trim()),
      };
    } catch {
      // Leave existing config on transient failure
    }
    const activeModel = state.aiConfig.model || 'gpt-4o-mini';
    el.aiModelBadge.textContent = activeModel;
    el.aiKeyMissingBanner.hidden = state.aiConfig.hasOpenAIKey;
    el.fullAiModelBadge.textContent = activeModel;
    el.fullAiNoKeyBanner.hidden = state.aiConfig.hasOpenAIKey;
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
      btn.disabled = !state.aiConfig.hasOpenAIKey || state.aiLoading;
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
        bubble.className = 'ai-msg-bubble';
        bubble.textContent = msg.content;
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

    if (!state.aiConfig.hasOpenAIKey) {
      el.aiKeyMissingBanner.hidden = false;
      showToast('Configure your OpenAI API key in Settings first.', 'error');
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
      renderFullAiThread();
      renderFullAiQuickChips();
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
            ? 'Your current resume is loaded. Tell me what you would like to add, rewrite, or reorganize—or switch back to the Manual Wizard anytime.'
            : 'Describe your background, target role, work history, education, and skills in your own words. I will populate your resume structure live on the right as we go, and you can switch to the Manual Wizard anytime.'
        }</div>
      `;
      el.fullAiMessages.appendChild(welcome);
    }

    state.fullAiMessages.forEach((msg) => {
      const wrap = document.createElement('div');
      wrap.className = `ai-msg ai-msg-${msg.role}`;

      if (msg.content) {
        const bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble';
        bubble.textContent = msg.content;
        wrap.appendChild(bubble);
      }

      if (msg.role === 'assistant' && Array.isArray(msg.changes) && msg.changes.length > 0) {
        const banner = document.createElement('div');
        banner.className = 'ai-changes-banner';
        const itemsHtml = msg.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('');
        banner.innerHTML = `
          <div class="ai-changes-title">Applied to Live Resume</div>
          <ul class="ai-changes-list">${itemsHtml}</ul>
        `;
        wrap.appendChild(banner);
      }

      el.fullAiMessages.appendChild(wrap);
    });

    if (state.fullAiLoading) {
      const loading = document.createElement('div');
      loading.className = 'ai-msg ai-msg-assistant';
      loading.innerHTML = '<div class="ai-msg-bubble ai-msg-loading">Updating resume draft...</div>';
      el.fullAiMessages.appendChild(loading);
    }

    el.fullAiMessages.scrollTop = el.fullAiMessages.scrollHeight;
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

      if (res.updated_resume && typeof res.updated_resume === 'object') {
        state.lastAiUndoState = JSON.parse(JSON.stringify(state.data));
        const preservedHistory = state.data._history;
        state.data = res.updated_resume;
        if (preservedHistory !== undefined) {
          state.data._history = preservedHistory;
        }
        el.btnFullAiUndo.hidden = false;
        setDirty(true);
        updateWizardHeaderMeta();
        bindContactFields();
        renderPreview();
      }

      state.fullAiMessages.push({
        role: 'assistant',
        content: res.reply || 'Updated your resume.',
        changes: Array.isArray(res.changes_summary) ? res.changes_summary : [],
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
      renderFullAiThread();
      renderFullAiQuickChips();
      el.fullAiInput.focus();
    }
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
    state.fullAiMessages = [];
    renderFullAiThread();
    renderFullAiQuickChips();
    el.fullAiInput.focus();
  }

  async function openSettingsModal() {
    try {
      const { settings } = await fetchJson('/api/settings');
      const keys = settings.api_keys || {};
      const ai = settings.ai || {};
      el.aiProviderSelect.value = ai.provider || 'OpenAI';
      el.aiModelInput.value = ai.model || 'gpt-4o-mini';
      el.keyOpenAI.value = keys.OpenAI || '';
      el.keyGemini.value = keys.Gemini || '';
      el.keyClaude.value = keys.Claude || '';
      el.keyOther.value = keys.Other || '';
      openModal(el.modalSettings);
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
    el.btnStage4Save.addEventListener('click', () => saveCurrentResume(false).catch((e) => showToast(e.message, 'error')));
    el.btnStage4PreviewPdf.addEventListener('click', () => setPreviewMode('pdf'));
    el.btnStage4Docx.addEventListener('click', () => exportWizardFile('docx'));
    el.btnStage4Pdf.addEventListener('click', () => exportWizardFile('pdf'));
    el.btnStage4OpenHistory.addEventListener('click', openHistoryModal);

    // Topbar wizard actions
    el.btnSave.addEventListener('click', () => saveCurrentResume(false).catch((e) => showToast(e.message, 'error')));
    el.btnHistory.addEventListener('click', openHistoryModal);
    el.btnExportDocx.addEventListener('click', () => exportWizardFile('docx'));
    el.btnExportPdf.addEventListener('click', () => exportWizardFile('pdf'));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (state.view === 'wizard') {
          e.preventDefault();
          saveCurrentResume(false).catch((err) => showToast(err.message, 'error'));
        }
      }
      if (e.key === 'Escape') {
        [el.modalSectionTitle, el.modalDeleteResume, el.modalHistory, el.modalSettings].forEach(closeModal);
      }
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
      el.btnConfirmDeleteResume.disabled = el.confirmDeleteInput.value !== state.deleteTargetFilename;
    });

    el.formDeleteResume.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJson(`/api/resumes/${encodeURIComponent(state.deleteTargetFilename)}`, {
          method: 'DELETE',
          body: JSON.stringify({ confirm_filename: el.confirmDeleteInput.value }),
        });
        closeModal(el.modalDeleteResume);
        showToast(`Deleted ${state.deleteTargetFilename}`, 'success');
        await loadResumeList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Settings Modal
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
        closeModal(el.modalSettings);
        showToast('Settings saved.', 'success');
        if (state.aiOpen || state.editorMode === 'ai') {
          await refreshAiSettingsStatus();
          if (state.aiOpen) renderAiQuickChips();
          if (state.editorMode === 'ai') renderFullAiQuickChips();
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Full-Resume AI Builder Composer
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
  }

  // Init
  async function init() {
    if (window.lucide) lucide.createIcons();
    updateZoom();
    bindEvents();
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
