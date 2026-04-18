/**
 * PaperLens — Scientific Paper Study Tool
 * Splits English scientific articles into sentences for Eng-Viet translation practice.
 */

(function () {
    'use strict';

    // ===== DOM Elements =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const els = {
        // Tabs
        tabText: $('#tabText'),
        tabUrl: $('#tabUrl'),
        tabPdf: $('#tabPdf'),
        contentText: $('#contentText'),
        contentUrl: $('#contentUrl'),
        contentPdf: $('#contentPdf'),
        // Inputs
        articleText: $('#articleText'),
        articleUrl: $('#articleUrl'),
        pdfFileInput: $('#pdfFileInput'),
        pdfDropZone: $('#pdfDropZone'),
        pdfFileName: $('#pdfFileName'),
        // Buttons
        processBtn: $('#processBtn'),
        clearBtn: $('#clearBtn'),
        exportBtn: $('#exportBtn'),
        saveBtn: $('#saveBtn'),
        backBtn: $('#backBtn'),
        themeToggle: $('#themeToggle'),
        // Sections
        inputSection: $('#inputSection'),
        resultsSection: $('#resultsSection'),
        loadingOverlay: $('#loadingOverlay'),
        // Stats
        totalSentences: $('#totalSentences'),
        translatedCount: $('#translatedCount'),
        progressPercent: $('#progressPercent'),
        progressBar: $('#progressBar'),
        // Table
        tableBody: $('#tableBody'),
        // Saved
        savedToggle: $('#savedToggle'),
        savedList: $('#savedList'),
    };

    // ===== PDF File State =====
    let pendingPdfFile = null;

    // ===== State =====
    let sentences = [];
    let translations = {};
    let currentSessionId = null;

    // ===== Toast Notifications =====
    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    // ===== Theme Toggle =====
    function initTheme() {
        const saved = localStorage.getItem('paperlens-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        updateThemeIcons(saved);
    }

    function updateThemeIcons(theme) {
        const sunIcon = $('.icon-sun');
        const moonIcon = $('.icon-moon');
        if (theme === 'dark') {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
        } else {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
        }
    }

    els.themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('paperlens-theme', next);
        updateThemeIcons(next);
    });

    // ===== Tabs =====
    $$('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.tab').forEach(t => t.classList.remove('active'));
            $$('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            $(`#content${target.charAt(0).toUpperCase() + target.slice(1)}`).classList.add('active');
        });
    });

    // ===== Section Detection & References Removal =====

    // Known section headings in scientific papers (regex patterns)
    const SECTION_PATTERNS = [
        { key: 'abstract',      label: 'Abstract',       regex: /^\s*(Abstract|Summary|Overview)\s*$/i },
        { key: 'introduction',  label: 'Introduction',   regex: /^\s*(Introduction|Background)\s*$/i },
        { key: 'methods',       label: 'Methods',        regex: /^\s*(Methods?|Methodology|Materials?\s+and\s+Methods?|Study\s+Design|Study\s+Protocol|Patients\s+and\s+Methods?)\s*$/i },
        { key: 'results',       label: 'Results',        regex: /^\s*(Results?|Findings?)\s*$/i },
        { key: 'discussion',    label: 'Discussion',     regex: /^\s*(Discussion|Interpretation)\s*$/i },
        { key: 'conclusion',    label: 'Conclusion',     regex: /^\s*(Conclusions?|Concluding\s+Remarks?)\s*$/i },
        { key: 'other',         label: null,             regex: null }, // fallback
    ];

    // Patterns that signal start of References section — stop processing here
    const REFERENCES_PATTERN = /^\s*(References?|Bibliography|Works?\s+Cited|Literature\s+Cited|Acknowledgem[e]?nts?|Funding|Conflicts?\s+of\s+Interest|Disclosure|Abbreviations|Supplementary|Appendix|Author\s+Contributions?|Data\s+Availability)\s*$/i;

    function removeReferences(text) {
        const lines = text.split('\n');
        let cutIndex = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && REFERENCES_PATTERN.test(line)) {
                // Make sure it's a standalone heading (not mid-sentence)
                const isShortLine = line.length < 80;
                const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
                // Confirm by checking it looks like a heading (short + next line is content or empty)
                if (isShortLine) {
                    cutIndex = i;
                    break;
                }
            }
        }
        
        if (cutIndex > 0) {
            return lines.slice(0, cutIndex).join('\n');
        }
        return text;
    }

    function detectSectionLabel(line) {
        const clean = line.trim();
        for (const sec of SECTION_PATTERNS) {
            if (sec.regex && sec.regex.test(clean)) {
                return { key: sec.key, label: sec.label };
            }
        }
        return null;
    }

    // Parse text into sections: [{key, label, sentences: []}]
    function parseIntoSections(text) {
        const lines = text.split('\n');
        const sections = [];
        let currentSection = { key: 'other', label: null, paragraphs: [] };
        let currentParagraph = '';

        for (const line of lines) {
            const trimmed = line.trim();

            // Check if this line is a section heading
            const sectionMatch = detectSectionLabel(trimmed);

            if (sectionMatch && trimmed.length < 80) {
                // Save current paragraph then start new section
                if (currentParagraph.trim()) {
                    currentSection.paragraphs.push(currentParagraph.trim());
                    currentParagraph = '';
                }
                if (currentSection.paragraphs.length > 0 || sections.length === 0) {
                    sections.push(currentSection);
                }
                currentSection = { key: sectionMatch.key, label: sectionMatch.label, paragraphs: [] };
            } else if (!trimmed) {
                // Empty line = paragraph break
                if (currentParagraph.trim()) {
                    currentSection.paragraphs.push(currentParagraph.trim());
                    currentParagraph = '';
                }
            } else {
                // Regular content line
                if (currentParagraph) {
                    currentParagraph += ' ' + trimmed;
                } else {
                    currentParagraph = trimmed;
                }
            }
        }

        // Flush remaining
        if (currentParagraph.trim()) {
            currentSection.paragraphs.push(currentParagraph.trim());
        }
        sections.push(currentSection);

        // Convert paragraphs to sentences in each section
        return sections
            .filter(sec => sec.paragraphs.length > 0)
            .map(sec => ({
                key: sec.key,
                label: sec.label,
                sentences: sec.paragraphs.flatMap(para => {
                    const sents = splitSmart(para);
                    return sents.map(s => s.trim()).filter(s => s.length > 5);
                })
            }))
            .filter(sec => sec.sentences.length > 0);
    }

    // ===== Sentence Splitting =====
    function splitIntoSentences(text) {
        // Step 1: Remove References and trailing sections
        text = removeReferences(text);

        // Step 2: Clean up the text
        text = text.replace(/\r\n/g, '\n');
        // Remove inline reference numbers like [1], [2,3], [1-5]
        text = text.replace(/\s*\[\d+[\d,\-\u2013\s]*\]/g, '');
        // Remove excessive whitespace but keep paragraph breaks
        text = text.replace(/\n{3,}/g, '\n\n');

        // Step 3: Parse into sections
        const parsed = parseIntoSections(text);
        
        // If sections were detected (more than 1 meaningful section), return sectioned data
        if (parsed.length > 1 || (parsed.length === 1 && parsed[0].label !== null)) {
            return parsed; // Return array of {key, label, sentences[]}
        }
        
        // Fallback: no sections detected, return flat array
        const allSentences = parsed.flatMap(sec => sec.sentences);
        return allSentences;
    }

    function splitSmart(text) {
        // Common abbreviations in scientific papers that shouldn't trigger a split
        const abbreviations = [
            'Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Jr', 'Sr',
            'Fig', 'Figs', 'Eq', 'Eqs', 'Ref', 'Refs',
            'Vol', 'No', 'pp', 'Ed', 'Eds',
            'et al', 'vs', 'etc', 'i\\.e', 'e\\.g',
            'approx', 'ca', 'cf', 'viz',
            'Inc', 'Ltd', 'Corp',
            'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];

        // Protect abbreviations by replacing their dots with a placeholder
        const placeholder = '##DOT##';
        let processed = text;

        abbreviations.forEach(abbr => {
            const regex = new RegExp(`\\b(${abbr})\\.`, 'g');
            processed = processed.replace(regex, `$1${placeholder}`);
        });

        // Protect decimal numbers (e.g., 3.14, 0.05)
        processed = processed.replace(/(\d)\.([\d])/g, `$1${placeholder}$2`);

        // Protect initials (e.g., "J. K. Rowling")
        processed = processed.replace(/\b([A-Z])\.(\s[A-Z])/g, `$1${placeholder}$2`);

        // Now split on sentence boundaries
        const parts = [];
        let current = '';

        for (let i = 0; i < processed.length; i++) {
            current += processed[i];

            if ((processed[i] === '.' || processed[i] === '!' || processed[i] === '?')) {
                // Check if next character is space + uppercase, or end of string
                const restAfterPunc = processed.substring(i + 1).trimStart();

                if (
                    i === processed.length - 1 || // End of string
                    (restAfterPunc.length > 0 && /^[A-Z""\(]/.test(restAfterPunc)) // Next sentence starts with uppercase
                ) {
                    // Restore placeholders and push
                    parts.push(current.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '.').trim());
                    current = '';
                }
            }
        }

        // Push remaining text
        if (current.trim()) {
            parts.push(current.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '.').trim());
        }

        return parts;
    }

    // ===== PDF Text Extraction =====
    function isPdfUrl(url) {
        const lower = url.toLowerCase();
        return lower.endsWith('.pdf') || lower.includes('/pdf') || lower.includes('pdf?');
    }

    async function extractTextFromPdf(arrayBuffer) {
        if (!window.pdfjsLib) {
            throw new Error('Thư viện PDF.js chưa được tải. Vui lòng tải lại trang.');
        }

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;
        const allLines = [];

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            // Build lines from text items based on Y position
            let lastY = null;
            let lineText = '';
            
            textContent.items.forEach(item => {
                const currentY = item.transform[5]; // Y position
                
                if (lastY !== null && Math.abs(currentY - lastY) > 3) {
                    // New line detected
                    if (lineText.trim()) {
                        allLines.push(lineText.trim());
                    }
                    lineText = '';
                }
                
                // Add space between words if needed  
                if (lineText && !lineText.endsWith(' ') && !lineText.endsWith('-') && item.str && !item.str.startsWith(' ')) {
                    lineText += ' ';
                }
                lineText += item.str;
                lastY = currentY;
            });
            
            if (lineText.trim()) {
                allLines.push(lineText.trim());
            }
            allLines.push(''); // Page break marker
        }

        // Reconstruct paragraphs by joining lines that are part of the same paragraph
        // A new paragraph typically starts after an empty line or after a line that ends with a period
        const paragraphs = [];
        let currentParagraph = '';
        
        for (const line of allLines) {
            if (!line) {
                // Empty line = paragraph break
                if (currentParagraph.trim()) {
                    paragraphs.push(currentParagraph.trim());
                }
                currentParagraph = '';
                continue;
            }
            
            // Skip common PDF artifacts: page numbers, very short metadata lines
            if (/^\d+$/.test(line)) continue; // Pure numbers (page numbers)
            if (/^(page|Page)\s+\d+/i.test(line)) continue; // "Page X"
            if (line.length < 3) continue; // Very short fragments
            
            // Join with previous line (PDF wraps at column width)
            if (currentParagraph) {
                // If previous line ended with a hyphen, join without space (word was split)
                if (currentParagraph.endsWith('-')) {
                    currentParagraph = currentParagraph.slice(0, -1) + line;
                } else {
                    currentParagraph += ' ' + line;
                }
            } else {
                currentParagraph = line;
            }
        }
        
        if (currentParagraph.trim()) {
            paragraphs.push(currentParagraph.trim());
        }

        return paragraphs.join('\n\n');
    }

    // ===== Fetch Article from URL =====
    
    // Try multiple CORS proxies for reliability
    const CORS_PROXIES = [
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    ];

    async function fetchWithProxy(url, asBinary = false) {
        let lastError = null;
        
        for (const proxyFn of CORS_PROXIES) {
            const proxyUrl = proxyFn(url);
            try {
                const response = await fetch(proxyUrl);
                if (!response.ok) continue;
                
                if (asBinary) {
                    return await response.arrayBuffer();
                } else {
                    return await response.text();
                }
            } catch (err) {
                lastError = err;
                continue;
            }
        }
        
        throw lastError || new Error('Tất cả proxy đều thất bại');
    }

    async function fetchPdfFromUrl(url) {
        showToast('Đang tải file PDF...', 'info');
        
        const arrayBuffer = await fetchWithProxy(url, true);
        
        // Verify it's a real PDF
        const header = new Uint8Array(arrayBuffer.slice(0, 5));
        const magic = String.fromCharCode(...header);
        
        if (magic !== '%PDF-') {
            throw new Error('URL này không trả về file PDF hợp lệ. Hãy tải PDF về máy rồi dùng tab "Tải PDF".');
        }
        
        showToast('Đang trích xuất nội dung PDF...', 'info');
        return await extractTextFromPdf(arrayBuffer);
    }

    async function fetchHtmlFromUrl(url) {
        const html = await fetchWithProxy(url, false);
        
        // Parse HTML and extract text content
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Remove scripts, styles, nav, footer, etc.
        const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'figure', 'figcaption', '.references', '#references', '.supplementary'];
        removeSelectors.forEach(sel => {
            doc.querySelectorAll(sel).forEach(el => el.remove());
        });

        // Try to find the main content area
        const contentSelectors = [
            'article', 
            '[role="main"]', 
            '.article-body', 
            '.article-content',
            '.content-body',
            '.fulltext-view',
            '#article-body',
            '.c-article-body',
            'main',
            '.paper-content',
            '.abstract',
        ];

        let content = null;
        for (const sel of contentSelectors) {
            content = doc.querySelector(sel);
            if (content) break;
        }

        if (!content) {
            content = doc.body;
        }

        // Get text from paragraphs
        const paragraphs = content.querySelectorAll('p');
        if (paragraphs.length > 0) {
            return Array.from(paragraphs)
                .map(p => p.textContent.trim())
                .filter(t => t.length > 20)
                .join('\n\n');
        }

        return content.textContent;
    }

    async function fetchArticle(url) {
        try {
            // Check if URL looks like a PDF
            if (isPdfUrl(url)) {
                return await fetchPdfFromUrl(url);
            }
            
            // Try as HTML first
            const text = await fetchHtmlFromUrl(url);
            
            // If we got very little text, it might be a non-standard PDF URL
            if (!text || text.trim().length < 50) {
                // Try as PDF as fallback
                try {
                    return await fetchPdfFromUrl(url);
                } catch {
                    throw new Error('Không trích xuất được đủ nội dung. Hãy thử copy-paste trực tiếp hoặc dùng tab "Tải PDF".');
                }
            }
            
            return text;
        } catch (err) {
            throw new Error(`${err.message}`);
        }
    }

    // ===== Render Table =====
    // sections is either:
    //   - Array of {key, label, sentences[]}  (when sections detected)
    //   - Array of strings (flat, no sections)
    function renderTable() {
        els.tableBody.innerHTML = '';
        let globalIndex = 0;

        const isSectioned = sentences.length > 0 && typeof sentences[0] === 'object';

        if (isSectioned) {
            sentences.forEach(section => {
                // Section header row
                if (section.label) {
                    const headerRow = document.createElement('div');
                    headerRow.className = 'section-header-row';
                    headerRow.dataset.section = section.key;
                    const icons = {
                        abstract: '📋',
                        introduction: '📖',
                        methods: '🔬',
                        results: '📊',
                        discussion: '💬',
                        conclusion: '✅',
                        other: '📄',
                    };
                    const icon = icons[section.key] || '📄';
                    headerRow.innerHTML = `
                        <div class="section-header-content">
                            <span class="section-icon">${icon}</span>
                            <span class="section-label">${section.label}</span>
                            <span class="section-count">${section.sentences.length} câu</span>
                        </div>
                    `;
                    els.tableBody.appendChild(headerRow);
                }

                // Sentence rows
                section.sentences.forEach(sentence => {
                    appendSentenceRow(sentence, globalIndex);
                    globalIndex++;
                });
            });
        } else {
            // Flat array (no sections detected)
            sentences.forEach((sentence, index) => {
                appendSentenceRow(sentence, index);
            });
            globalIndex = sentences.length;
        }

        // Auto-resize textareas & attach listeners
        els.tableBody.querySelectorAll('textarea').forEach(ta => {
            autoResize(ta);
            ta.addEventListener('input', handleTranslationInput);
            ta.addEventListener('focus', handleTextareaFocus);
            ta.addEventListener('blur', handleTextareaBlur);
        });

        updateStats();
    }

    function appendSentenceRow(sentence, index) {
        const row = document.createElement('div');
        row.className = 'table-row';
        row.id = `row-${index}`;

        if (translations[index] && translations[index].trim()) {
            row.classList.add('translated');
        }

        row.innerHTML = `
            <div class="row-num">
                <span class="row-num-text">${index + 1}</span>
                <button class="row-delete-btn" data-index="${index}" title="Xóa câu này">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="row-en">${escapeHtml(sentence)}</div>
            <div class="row-vi">
                <textarea
                    placeholder="Nhập bản dịch tiếng Việt..."
                    data-index="${index}"
                    spellcheck="false"
                >${escapeHtml(translations[index] || '')}</textarea>
            </div>
        `;

        // Wire up delete button
        row.querySelector('.row-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSentence(index);
        });

        els.tableBody.appendChild(row);
    }

    // ===== Delete Sentence =====
    function deleteSentence(globalIndex) {
        const isSectioned = sentences.length > 0 && typeof sentences[0] === 'object';
        
        if (isSectioned) {
            // Find which section & local index this globalIndex maps to
            let counter = 0;
            for (const section of sentences) {
                for (let i = 0; i < section.sentences.length; i++) {
                    if (counter === globalIndex) {
                        section.sentences.splice(i, 1);
                        break;
                    }
                    counter++;
                }
                if (counter > globalIndex) break;
            }
            // Remove empty sections
            sentences = sentences.filter(sec => sec.sentences.length > 0 || sec.label === null);
        } else {
            sentences.splice(globalIndex, 1);
        }

        // Remap translations: shift all indices above deleted one down by 1
        const newTranslations = {};
        Object.keys(translations).forEach(k => {
            const idx = parseInt(k);
            if (idx < globalIndex) {
                newTranslations[idx] = translations[idx];
            } else if (idx > globalIndex) {
                newTranslations[idx - 1] = translations[idx];
            }
            // idx === globalIndex is dropped
        });
        translations = newTranslations;

        // Animate out then re-render
        const row = $(`#row-${globalIndex}`);
        if (row) {
            row.style.transition = 'opacity 0.2s, transform 0.2s';
            row.style.opacity = '0';
            row.style.transform = 'translateX(-8px)';
            setTimeout(() => renderTable(), 200);
        } else {
            renderTable();
        }

        // Auto-save
        if (currentSessionId) saveSession(currentSessionId, true);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function autoResize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
    }

    function handleTranslationInput(e) {
        const index = parseInt(e.target.dataset.index);
        translations[index] = e.target.value;
        autoResize(e.target);

        // Update row class
        const row = $(`#row-${index}`);
        if (e.target.value.trim()) {
            row.classList.add('translated');
        } else {
            row.classList.remove('translated');
        }

        updateStats();
        debouncedAutoSave();
    }

    function handleTextareaFocus(e) {
        const row = e.target.closest('.table-row');
        row.style.boxShadow = '0 0 0 1px var(--accent-glow)';
    }

    function handleTextareaBlur(e) {
        const row = e.target.closest('.table-row');
        row.style.boxShadow = '';
    }

    // ===== Stats =====
    function getAllSentences() {
        // Handle both sectioned and flat structures
        if (sentences.length === 0) return [];
        if (typeof sentences[0] === 'object') {
            return sentences.flatMap(sec => sec.sentences);
        }
        return sentences;
    }

    function getTotalCount() {
        return getAllSentences().length;
    }

    function updateStats() {
        const total = getTotalCount();
        const translated = Object.values(translations).filter(v => v && v.trim()).length;
        const percent = total > 0 ? Math.round((translated / total) * 100) : 0;

        els.totalSentences.textContent = total;
        els.translatedCount.textContent = translated;
        els.progressPercent.textContent = percent + '%';
        els.progressBar.style.width = percent + '%';
    }

    // ===== Auto Save Debounce =====
    let autoSaveTimer = null;
    function debouncedAutoSave() {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            if (currentSessionId) {
                saveSession(currentSessionId, true);
            }
        }, 2000);
    }

    // ===== Save / Load =====
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    function saveSession(id = null, silent = false) {
        const allSents = getAllSentences();
        if (allSents.length === 0) {
            if (!silent) showToast('Không có nội dung để lưu', 'error');
            return;
        }

        const sessionId = id || generateId();
        currentSessionId = sessionId;

        const previewSents = allSents.slice(0, 2).join(' ');
        const session = {
            id: sessionId,
            sentences: sentences,
            translations: translations,
            timestamp: Date.now(),
            preview: previewSents.substring(0, 80) + '...',
        };

        // Get existing sessions
        const sessions = JSON.parse(localStorage.getItem('paperlens-sessions') || '{}');
        sessions[sessionId] = session;
        localStorage.setItem('paperlens-sessions', JSON.stringify(sessions));

        if (!silent) showToast('Đã lưu phiên làm việc!', 'success');
        renderSavedSessions();
    }

    function loadSession(id) {
        const sessions = JSON.parse(localStorage.getItem('paperlens-sessions') || '{}');
        const session = sessions[id];
        if (!session) {
            showToast('Không tìm thấy phiên làm việc', 'error');
            return;
        }

        sentences = session.sentences;
        translations = session.translations || {};
        currentSessionId = id;

        showResults();
        showToast('Đã tải phiên làm việc', 'success');
    }

    function deleteSession(id) {
        const sessions = JSON.parse(localStorage.getItem('paperlens-sessions') || '{}');
        delete sessions[id];
        localStorage.setItem('paperlens-sessions', JSON.stringify(sessions));
        renderSavedSessions();
        showToast('Đã xóa phiên làm việc', 'info');
    }

    function renderSavedSessions() {
        const sessions = JSON.parse(localStorage.getItem('paperlens-sessions') || '{}');
        const list = Object.values(sessions).sort((a, b) => b.timestamp - a.timestamp);

        if (list.length === 0) {
            els.savedList.innerHTML = '<div class="empty-saved">Chưa có phiên nào được lưu</div>';
            return;
        }

        els.savedList.innerHTML = list.map(session => {
            const date = new Date(session.timestamp);
            const dateStr = date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const translated = Object.values(session.translations || {}).filter(v => v && v.trim()).length;
            // Handle both old (flat array) and new (sectioned) session formats
            const sents = session.sentences;
            const totalSents = Array.isArray(sents) && sents.length > 0 && typeof sents[0] === 'object'
                ? sents.flatMap(s => s.sentences).length
                : (sents || []).length;

            return `
                <div class="saved-item" data-id="${session.id}">
                    <div class="saved-item-info" onclick="window._loadSession('${session.id}')">
                        <div class="saved-item-title">${escapeHtml(session.preview)}</div>
                        <div class="saved-item-meta">${dateStr} • ${totalSents} câu • ${translated} đã dịch</div>
                    </div>
                    <div class="saved-item-actions">
                        <button class="delete-btn" onclick="event.stopPropagation(); window._deleteSession('${session.id}')" title="Xóa">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Expose to global for inline onclick
    window._loadSession = loadSession;
    window._deleteSession = deleteSession;

    // ===== Export =====
    function exportToTxt() {
        const allSents = getAllSentences();
        if (allSents.length === 0) return;

        const isSectioned = sentences.length > 0 && typeof sentences[0] === 'object';
        let content = 'PaperLens — Bản dịch bài báo khoa học\n';
        content += '='.repeat(50) + '\n\n';

        if (isSectioned) {
            let globalIdx = 0;
            sentences.forEach(section => {
                if (section.label) {
                    content += `\n===== ${section.label.toUpperCase()} =====\n\n`;
                }
                section.sentences.forEach(sentence => {
                    content += `--- Câu ${globalIdx + 1} ---\n`;
                    content += `[EN] ${sentence}\n`;
                    content += `[VI] ${translations[globalIdx] || '(chưa dịch)'}\n\n`;
                    globalIdx++;
                });
            });
        } else {
            allSents.forEach((sentence, i) => {
                content += `--- Câu ${i + 1} ---\n`;
                content += `[EN] ${sentence}\n`;
                content += `[VI] ${translations[i] || '(chưa dịch)'}\n\n`;
            });
        }

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `paperlens_translation_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        showToast('Đã xuất file TXT!', 'success');
    }

    // ===== Export: Notion (Direct API Integration) =====

    // --- Notion modal state ---
    let notionToken = '';
    let notionPages = [];
    let notionFilteredPages = [];
    let notionSelectedPageId = '';
    let notionSelectedPageName = '';

    // CORS proxies that support POST + custom headers
    const NOTION_PROXIES = [
        (path) => `https://corsproxy.io/?url=${encodeURIComponent('https://api.notion.com/v1' + path)}`,
        (path) => `https://proxy.cors.sh/https://api.notion.com/v1${path}`,
        (path) => `https://api.allorigins.win/raw?url=${encodeURIComponent('https://api.notion.com/v1' + path)}`,
    ];

    async function notionFetch(path, options = {}) {
        const fetchOptions = {
            ...options,
            headers: {
                'Authorization': `Bearer ${notionToken}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        };

        let lastError = null;
        for (const proxyFn of NOTION_PROXIES) {
            const url = proxyFn(path);
            try {
                const resp = await fetch(url, fetchOptions);
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.message || `HTTP ${resp.status}`);
                }
                return await resp.json();
            } catch (err) {
                lastError = err;
                // If it's an API error (not a network error), don't retry
                if (err.message && !err.message.includes('fetch') && !err.message.includes('network') && !err.message.includes('Failed')) {
                    throw err;
                }
                continue;
            }
        }
        throw lastError || new Error('Không thể kết nối Notion API. Hãy thử lại sau.');
    }

    // Open modal
    function openNotionModal() {
        const allSents = getAllSentences();
        if (allSents.length === 0) {
            showToast('Không có nội dung để xuất', 'error');
            return;
        }

        // Restore saved token if exists
        const saved = localStorage.getItem('paperlens-notion-token');
        if (saved) {
            document.getElementById('notionTokenInput').value = saved;
            document.getElementById('notionSaveToken').checked = true;
        }

        document.getElementById('notionStep1').style.display = '';
        document.getElementById('notionStep2').style.display = 'none';
        document.getElementById('notionError1').style.display = 'none';
        document.getElementById('notionError2').style.display = 'none';
        document.getElementById('notionSelectedInfo').style.display = 'none';
        document.getElementById('notionExportBtn').disabled = true;
        notionSelectedPageId = '';
        notionSelectedPageName = '';

        document.getElementById('notionModalOverlay').style.display = 'flex';
        setTimeout(() => document.getElementById('notionTokenInput').focus(), 100);
    }

    function closeNotionModal() {
        document.getElementById('notionModalOverlay').style.display = 'none';
    }

    // Step 1 → Connect
    async function notionConnect() {
        const token = document.getElementById('notionTokenInput').value.trim();
        if (!token.startsWith('secret_') && !token.startsWith('ntn_')) {
            showNotionError(1, 'Token không hợp lệ. Token phải bắt đầu bằng "secret_" hoặc "ntn_". Hãy kiểm tra lại.');
            return;
        }
        notionToken = token;

        // Save token if checked
        if (document.getElementById('notionSaveToken').checked) {
            localStorage.setItem('paperlens-notion-token', token);
        } else {
            localStorage.removeItem('paperlens-notion-token');
        }

        setNotionLoading(1, true);
        document.getElementById('notionError1').style.display = 'none';

        try {
            // Search all pages accessible to this integration
            const data = await notionFetch('/search', {
                method: 'POST',
                body: JSON.stringify({
                    filter: { value: 'page', property: 'object' },
                    sort: { direction: 'descending', timestamp: 'last_edited_time' },
                    page_size: 100,
                }),
            });

            notionPages = (data.results || []).map(page => {
                const emoji = page.icon?.emoji || '📄';
                let name = 'Untitled';
                if (page.properties?.title?.title?.[0]?.plain_text) {
                    name = page.properties.title.title[0].plain_text;
                } else if (page.properties?.Name?.title?.[0]?.plain_text) {
                    name = page.properties.Name.title[0].plain_text;
                }
                return { id: page.id, name, emoji };
            });

            if (notionPages.length === 0) {
                throw new Error('Không tìm thấy trang nào. Hãy đảm bảo bạn đã chia sẻ (Share) ít nhất một trang với integration PaperLens trong Notion.');
            }

            // Go to step 2
            setNotionLoading(1, false);
            document.getElementById('notionStep1').style.display = 'none';
            document.getElementById('notionStep2').style.display = '';
            notionFilteredPages = [...notionPages];
            renderNotionPageList();
            setTimeout(() => document.getElementById('notionPageSearch').focus(), 100);

        } catch (err) {
            setNotionLoading(1, false);
            showNotionError(1, `❌ ${err.message}`);
        }
    }

    function renderNotionPageList() {
        const list = document.getElementById('notionPageList');
        if (notionFilteredPages.length === 0) {
            list.innerHTML = `<div class="notion-empty-pages"><strong>Không tìm thấy trang nào</strong>Hãy chia sẻ trang Notion với integration <em>PaperLens</em> trước.</div>`;
            return;
        }
        list.innerHTML = notionFilteredPages.map(p => `
            <div class="notion-page-item${p.id === notionSelectedPageId ? ' selected' : ''}" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
                <span class="notion-page-emoji">${p.emoji}</span>
                <div class="notion-page-info">
                    <div class="notion-page-name">${escapeHtml(p.name)}</div>
                    <div class="notion-page-type">Notion Page</div>
                </div>
                ${p.id === notionSelectedPageId ? `<svg class="notion-page-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
            </div>
        `).join('');

        list.querySelectorAll('.notion-page-item').forEach(el => {
            el.addEventListener('click', () => {
                notionSelectedPageId = el.dataset.id;
                notionSelectedPageName = el.dataset.name;
                document.getElementById('notionSelectedName').textContent = notionSelectedPageName;
                document.getElementById('notionSelectedInfo').style.display = 'flex';
                document.getElementById('notionExportBtn').disabled = false;
                renderNotionPageList();
            });
        });
    }

    // Export to selected Notion page
    async function doNotionExport() {
        if (!notionSelectedPageId) return;

        setNotionLoading(2, true);
        document.getElementById('notionError2').style.display = 'none';

        try {
            const allSents = getAllSentences();
            const isSectioned = sentences.length > 0 && typeof sentences[0] === 'object';
            const date = new Date().toLocaleDateString('vi-VN');

            // Build blocks
            const blocks = [];

            // Heading
            blocks.push({
                object: 'block', type: 'heading_1',
                heading_1: { rich_text: [{ type: 'text', text: { content: `📄 PaperLens — Bản dịch bài báo` } }] },
            });
            blocks.push({
                object: 'block', type: 'paragraph',
                paragraph: { rich_text: [{ type: 'text', text: { content: `Xuất ngày ${date} • ${allSents.length} câu` }, annotations: { italic: true } }] },
            });
            blocks.push({ object: 'block', type: 'divider', divider: {} });

            const sectionIcons = { abstract: '📋', introduction: '📖', methods: '🔬', results: '📊', discussion: '💬', conclusion: '✅', other: '📄' };

            if (isSectioned) {
                let globalIdx = 0;
                sentences.forEach(section => {
                    if (section.label) {
                        const icon = sectionIcons[section.key] || '📄';
                        blocks.push({
                            object: 'block', type: 'heading_2',
                            heading_2: { rich_text: [{ type: 'text', text: { content: `${icon} ${section.label}` } }] },
                        });
                    }
                    section.sentences.forEach(sentence => {
                        const vi = translations[globalIdx] || '';
                        // English sentence
                        blocks.push({
                            object: 'block', type: 'paragraph',
                            paragraph: {
                                rich_text: [
                                    { type: 'text', text: { content: `${globalIdx + 1}. ` }, annotations: { bold: true, color: 'gray' } },
                                    { type: 'text', text: { content: sentence } },
                                ],
                            },
                        });
                        // Vietnamese translation (callout)
                        if (vi) {
                            blocks.push({
                                object: 'block', type: 'callout',
                                callout: {
                                    rich_text: [{ type: 'text', text: { content: vi } }],
                                    icon: { emoji: '🇻🇳' },
                                    color: 'blue_background',
                                },
                            });
                        }
                        globalIdx++;
                    });
                    blocks.push({ object: 'block', type: 'divider', divider: {} });
                });
            } else {
                allSents.forEach((sentence, i) => {
                    const vi = translations[i] || '';
                    blocks.push({
                        object: 'block', type: 'paragraph',
                        paragraph: {
                            rich_text: [
                                { type: 'text', text: { content: `${i + 1}. ` }, annotations: { bold: true, color: 'gray' } },
                                { type: 'text', text: { content: sentence } },
                            ],
                        },
                    });
                    if (vi) {
                        blocks.push({
                            object: 'block', type: 'callout',
                            callout: {
                                rich_text: [{ type: 'text', text: { content: vi } }],
                                icon: { emoji: '🇻🇳' },
                                color: 'blue_background',
                            },
                        });
                    }
                });
            }

            // Notion API limit: max 100 blocks per request
            const CHUNK = 100;
            const firstChunk = blocks.slice(0, CHUNK);

            // Create child page inside selected page
            const newPage = await notionFetch('/pages', {
                method: 'POST',
                body: JSON.stringify({
                    parent: { page_id: notionSelectedPageId },
                    icon: { emoji: '📄' },
                    properties: {
                        title: { title: [{ type: 'text', text: { content: `PaperLens — ${date}` } }] },
                    },
                    children: firstChunk,
                }),
            });

            // Append remaining blocks in chunks
            for (let i = CHUNK; i < blocks.length; i += CHUNK) {
                await notionFetch(`/blocks/${newPage.id}/children`, {
                    method: 'PATCH',
                    body: JSON.stringify({ children: blocks.slice(i, i + CHUNK) }),
                });
            }

            setNotionLoading(2, false);
            closeNotionModal();
            showToast(`✅ Đã xuất sang Notion: "${notionSelectedPageName}" thành công!`, 'success');

        } catch (err) {
            setNotionLoading(2, false);
            showNotionError(2, `❌ Lỗi: ${err.message}`);
        }
    }

    function setNotionLoading(step, loading) {
        if (step === 1) {
            const btn = document.getElementById('notionConnectBtn');
            document.getElementById('notionConnectBtnText').style.display = loading ? 'none' : '';
            document.getElementById('notionConnectSpinner').style.display = loading ? '' : 'none';
            btn.disabled = loading;
        } else {
            const btn = document.getElementById('notionExportBtn');
            document.getElementById('notionExportBtnText').style.display = loading ? 'none' : '';
            document.getElementById('notionExportSpinner').style.display = loading ? '' : 'none';
            btn.disabled = loading;
        }
    }

    function showNotionError(step, msg) {
        const el = document.getElementById(`notionError${step}`);
        el.textContent = msg;
        el.style.display = '';
    }

    // --- Wire up modal events ---
    function initNotionModal() {
        document.getElementById('notionModalClose').addEventListener('click', closeNotionModal);
        document.getElementById('notionCancelBtn1').addEventListener('click', closeNotionModal);
        document.getElementById('notionBackBtn').addEventListener('click', () => {
            document.getElementById('notionStep2').style.display = 'none';
            document.getElementById('notionStep1').style.display = '';
        });

        document.getElementById('notionConnectBtn').addEventListener('click', notionConnect);
        document.getElementById('notionTokenInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') notionConnect();
        });

        // Eye toggle
        document.getElementById('notionEyeBtn').addEventListener('click', () => {
            const inp = document.getElementById('notionTokenInput');
            inp.type = inp.type === 'password' ? 'text' : 'password';
        });

        // Page search filter
        document.getElementById('notionPageSearch').addEventListener('input', e => {
            const q = e.target.value.toLowerCase();
            notionFilteredPages = q ? notionPages.filter(p => p.name.toLowerCase().includes(q)) : [...notionPages];
            renderNotionPageList();
        });

        document.getElementById('notionExportBtn').addEventListener('click', doNotionExport);

        // Close on overlay click
        document.getElementById('notionModalOverlay').addEventListener('click', e => {
            if (e.target === document.getElementById('notionModalOverlay')) closeNotionModal();
        });

        // Escape key
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && document.getElementById('notionModalOverlay').style.display !== 'none') {
                closeNotionModal();
            }
        });
    }

    initNotionModal();

    // ===== Export: Google Docs (HTML → Clipboard) =====
    async function exportToGoogleDocs() {
        const allSents = getAllSentences();
        if (allSents.length === 0) return;

        const isSectioned = sentences.length > 0 && typeof sentences[0] === 'object';
        const date = new Date().toLocaleDateString('vi-VN');

        // Build rich HTML for Google Docs
        let html = `<h1>📄 PaperLens — Bản dịch bài báo</h1>`;
        html += `<p><em>Xuất ngày ${date} • ${allSents.length} câu</em></p><hr>`;

        if (isSectioned) {
            let globalIdx = 0;
            sentences.forEach(section => {
                if (section.label) {
                    html += `<h2>${section.label}</h2>`;
                }
                html += `<table border="1" cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse">`;
                html += `<tr style="background:#f0f0f0"><th style="width:50%">English</th><th style="width:50%">Tiếng Việt</th></tr>`;
                section.sentences.forEach(sentence => {
                    const vi = translations[globalIdx] || '<em style="color:#999">Chưa dịch</em>';
                    html += `<tr><td>${globalIdx + 1}. ${sentence}</td><td>${vi}</td></tr>`;
                    globalIdx++;
                });
                html += `</table><br>`;
            });
        } else {
            html += `<table border="1" cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse">`;
            html += `<tr style="background:#f0f0f0"><th>#</th><th style="width:45%">English</th><th style="width:45%">Tiếng Việt</th></tr>`;
            allSents.forEach((sentence, i) => {
                const vi = translations[i] || '<em style="color:#999">Chưa dịch</em>';
                html += `<tr><td>${i + 1}</td><td>${sentence}</td><td>${vi}</td></tr>`;
            });
            html += `</table>`;
        }

        // Copy HTML to clipboard (Google Docs accepts pasted HTML tables)
        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })
            ]);
            showToast('Đã copy! Mở Google Docs → Ctrl+V để dán bảng vào 🎉', 'success');
        } catch {
            // Fallback: download as HTML file
            const blob = new Blob([`<!DOCTYPE html><html><body>${html}</body></html>`], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `paperlens_gdocs_${new Date().toISOString().slice(0, 10)}.html`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Đã tải file HTML — Mở Google Docs → File → Open → Upload file này', 'info');
        }
    }

    // ===== UI State =====
    function showResults() {
        els.inputSection.style.display = 'none';
        els.resultsSection.style.display = 'block';
        renderTable();
    }

    function showInput() {
        els.inputSection.style.display = 'block';
        els.resultsSection.style.display = 'none';
        sentences = [];
        translations = {};
        currentSessionId = null;
    }

    function showLoading(show) {
        if (show) {
            els.loadingOverlay.classList.add('show');
        } else {
            els.loadingOverlay.classList.remove('show');
        }
    }

    // ===== Process Article =====
    async function processArticle() {
        const activeTab = document.querySelector('.tab.active').dataset.tab;
        let text = '';

        if (activeTab === 'text') {
            text = els.articleText.value.trim();
            if (!text) {
                showToast('Vui lòng dán nội dung bài báo', 'error');
                return;
            }
        } else if (activeTab === 'url') {
            const url = els.articleUrl.value.trim();
            if (!url) {
                showToast('Vui lòng nhập link bài báo', 'error');
                return;
            }

            showLoading(true);
            try {
                text = await fetchArticle(url);
                if (!text || text.trim().length < 50) {
                    throw new Error('Không trích xuất được đủ nội dung từ trang web.');
                }
            } catch (err) {
                showLoading(false);
                showToast(err.message, 'error');
                return;
            }
        } else if (activeTab === 'pdf') {
            if (!pendingPdfFile) {
                showToast('Vui lòng chọn file PDF', 'error');
                return;
            }

            showLoading(true);
            try {
                const arrayBuffer = await pendingPdfFile.arrayBuffer();
                text = await extractTextFromPdf(arrayBuffer);
                if (!text || text.trim().length < 50) {
                    throw new Error('Không trích xuất được đủ nội dung từ file PDF.');
                }
            } catch (err) {
                showLoading(false);
                showToast(err.message, 'error');
                return;
            }
        }

        showLoading(true);

        // Simulate slight delay for UX
        await new Promise(r => setTimeout(r, 300));

        sentences = splitIntoSentences(text);
        translations = {};
        currentSessionId = generateId();

        showLoading(false);

        if (sentences.length === 0) {
            showToast('Không tìm thấy câu nào trong nội dung', 'error');
            return;
        }

        const isSectioned = sentences.length > 0 && typeof sentences[0] === 'object';
        const totalCount = getTotalCount();
        const sectionCount = isSectioned ? sentences.filter(s => s.label).length : 0;

        if (isSectioned && sectionCount > 0) {
            showToast(`Đã phân tích ${totalCount} câu trong ${sectionCount} phần!`, 'success');
        } else {
            showToast(`Đã phân tích được ${totalCount} câu!`, 'success');
        }
        showResults();
    }

    // ===== Saved Section Toggle =====
    els.savedToggle.addEventListener('click', () => {
        const isOpen = els.savedList.style.display !== 'none';
        els.savedList.style.display = isOpen ? 'none' : 'block';
        els.savedToggle.classList.toggle('open', !isOpen);
    });

    // ===== Event Listeners =====
    els.processBtn.addEventListener('click', processArticle);
    els.clearBtn.addEventListener('click', () => {
        els.articleText.value = '';
        els.articleUrl.value = '';
        pendingPdfFile = null;
        els.pdfFileName.textContent = '';
    });
    els.exportBtn.addEventListener('click', exportToTxt);
    document.getElementById('exportNotionBtn').addEventListener('click', openNotionModal);
    document.getElementById('exportGDocsBtn').addEventListener('click', exportToGoogleDocs);
    els.saveBtn.addEventListener('click', () => saveSession(currentSessionId));
    els.backBtn.addEventListener('click', showInput);

    // ===== PDF File Input & Drag-and-Drop =====
    function handlePdfFile(file) {
        if (file && file.type === 'application/pdf') {
            pendingPdfFile = file;
            els.pdfFileName.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
            showToast(`Đã chọn: ${file.name}`, 'success');
        } else {
            showToast('Vui lòng chọn file PDF hợp lệ', 'error');
        }
    }

    els.pdfFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handlePdfFile(file);
    });

    // Drag and drop
    const dropZone = els.pdfDropZone;
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handlePdfFile(file);
    });

    // Keyboard shortcut: Ctrl/Cmd + S to save
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (sentences.length > 0) {
                saveSession(currentSessionId);
            }
        }
    });

    // ===== Initialize =====
    initTheme();
    renderSavedSessions();

    // =========================================================
    // ===== TASK MANAGER MODULE =====
    // =========================================================

    // --- App-level tab switching ---
    const appTabs = document.querySelectorAll('.app-tab');
    appTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            appTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const panel = tab.dataset.appTab;
            document.getElementById('translatePanel').style.display = panel === 'translate' ? '' : 'none';
            document.getElementById('tasksPanel').style.display = panel === 'tasks' ? '' : 'none';
            if (panel === 'tasks') {
                renderTaskTable();
                updateTaskDashboard();
            }
        });
    });

    // --- Task data ---
    let tasks = JSON.parse(localStorage.getItem('paperlens-tasks') || '[]');
    let taskFilter = 'all';
    let taskSearchQ = '';
    let taskSortMode = 'date-desc';
    let editingTaskId = null;

    // Notion task DB state
    let taskNotionToken = localStorage.getItem('paperlens-notion-token') || '';
    let taskNotionDbId = localStorage.getItem('paperlens-task-db-id') || '';
    let taskNotionDbName = localStorage.getItem('paperlens-task-db-name') || '';
    let taskDbs = [];
    let taskDbsFiltered = [];
    let taskSelectedDbId = '';
    let taskSelectedDbName = '';

    const STATUS_LABELS = {
        todo:    '🔵 Chưa bắt đầu',
        doing:   '🟡 Đang làm',
        done:    '🟢 Hoàn thành',
        blocked: '🔴 Bị chặn',
    };

    function saveTasks() {
        localStorage.setItem('paperlens-tasks', JSON.stringify(tasks));
    }

    function genTaskId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function getFilteredTasks() {
        let list = [...tasks];
        if (taskFilter !== 'all') list = list.filter(t => t.status === taskFilter);
        if (taskSearchQ) {
            const q = taskSearchQ.toLowerCase();
            list = list.filter(t =>
                (t.content || '').toLowerCase().includes(q) ||
                (t.notes || '').toLowerCase().includes(q)
            );
        }
        if (taskSortMode === 'date-desc') list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        else if (taskSortMode === 'date-asc') list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        else if (taskSortMode === 'status') {
            const order = { doing: 0, blocked: 1, todo: 2, done: 3 };
            list.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));
        }
        return list;
    }

    function formatDate(d) {
        if (!d) return '—';
        const [y, m, day] = d.split('-');
        return `${day}/${m}/${y}`;
    }

    function renderTaskTable() {
        const body = document.getElementById('taskTableBody');
        const empty = document.getElementById('taskEmpty');
        const list = getFilteredTasks();

        if (list.length === 0) {
            body.innerHTML = '';
            empty.style.display = 'flex';
            return;
        }
        empty.style.display = 'none';

        body.innerHTML = list.map((t, i) => `
            <div class="task-row" data-id="${t.id}">
                <div class="task-cell task-cell-num">${i + 1}</div>
                <div class="task-cell task-cell-date">${formatDate(t.date)}</div>
                <div class="task-cell task-cell-content">${escapeHtml(t.content || '')}</div>
                <div class="task-cell task-cell-status">
                    <span class="status-badge status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
                </div>
                <div class="task-cell task-cell-notes">${escapeHtml(t.notes || '')}</div>
                <div class="task-cell task-cell-actions">
                    <button class="task-row-btn edit-task-btn" data-id="${t.id}" title="Sửa">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="task-row-btn del del-task-btn" data-id="${t.id}" title="Xoá">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `).join('');

        body.querySelectorAll('.edit-task-btn').forEach(btn =>
            btn.addEventListener('click', () => openTaskModal(btn.dataset.id))
        );
        body.querySelectorAll('.del-task-btn').forEach(btn =>
            btn.addEventListener('click', () => deleteTask(btn.dataset.id))
        );
    }

    function updateTaskDashboard() {
        const total = tasks.length;
        const todo = tasks.filter(t => t.status === 'todo').length;
        const doing = tasks.filter(t => t.status === 'doing').length;
        const done = tasks.filter(t => t.status === 'done').length;
        const blocked = tasks.filter(t => t.status === 'blocked').length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        document.getElementById('dashTotal').textContent = total;
        document.getElementById('dashTodo').textContent = todo;
        document.getElementById('dashDoing').textContent = doing;
        document.getElementById('dashDone').textContent = done;
        document.getElementById('dashBlocked').textContent = blocked;
        document.getElementById('taskProgressBar').style.setProperty('--prog', pct + '%');
        document.getElementById('taskProgressLabel').textContent = `${pct}% hoàn thành`;
    }

    function deleteTask(id) {
        tasks = tasks.filter(t => t.id !== id);
        saveTasks();
        renderTaskTable();
        updateTaskDashboard();
        showToast('Đã xoá task', 'info');
    }

    // --- Task Modal ---
    function openTaskModal(editId = null) {
        editingTaskId = editId;
        const modal = document.getElementById('taskModalOverlay');
        document.getElementById('taskModalTitle').textContent = editId ? 'Sửa task' : 'Thêm task mới';

        if (editId) {
            const t = tasks.find(t => t.id === editId);
            if (t) {
                document.getElementById('taskFormDate').value = t.date || '';
                document.getElementById('taskFormContent').value = t.content || '';
                document.getElementById('taskFormStatus').value = t.status || 'todo';
                document.getElementById('taskFormNotes').value = t.notes || '';
            }
        } else {
            document.getElementById('taskFormDate').value = new Date().toISOString().slice(0, 10);
            document.getElementById('taskFormContent').value = '';
            document.getElementById('taskFormStatus').value = 'todo';
            document.getElementById('taskFormNotes').value = '';
        }
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('taskFormContent').focus(), 100);
    }

    function closeTaskModal() {
        document.getElementById('taskModalOverlay').style.display = 'none';
        editingTaskId = null;
    }

    function saveTaskForm() {
        const content = document.getElementById('taskFormContent').value.trim();
        if (!content) { showToast('Vui lòng nhập nội dung task', 'error'); return; }

        const data = {
            date: document.getElementById('taskFormDate').value,
            content,
            status: document.getElementById('taskFormStatus').value,
            notes: document.getElementById('taskFormNotes').value.trim(),
        };

        if (editingTaskId) {
            const idx = tasks.findIndex(t => t.id === editingTaskId);
            if (idx >= 0) tasks[idx] = { ...tasks[idx], ...data };
            showToast('Đã cập nhật task!', 'success');
        } else {
            tasks.unshift({ id: genTaskId(), ...data });
            showToast('Đã thêm task mới!', 'success');
        }

        saveTasks();
        closeTaskModal();
        renderTaskTable();
        updateTaskDashboard();
    }

    // Task modal events
    document.getElementById('addTaskBtn').addEventListener('click', () => openTaskModal());
    document.getElementById('taskModalClose').addEventListener('click', closeTaskModal);
    document.getElementById('taskFormCancel').addEventListener('click', closeTaskModal);
    document.getElementById('taskFormSave').addEventListener('click', saveTaskForm);
    document.getElementById('taskModalOverlay').addEventListener('click', e => {
        if (e.target === document.getElementById('taskModalOverlay')) closeTaskModal();
    });

    // Filter buttons
    document.getElementById('taskFilters').addEventListener('click', e => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        taskFilter = btn.dataset.filter;
        renderTaskTable();
    });

    // Search
    document.getElementById('taskSearch').addEventListener('input', e => {
        taskSearchQ = e.target.value;
        renderTaskTable();
    });

    // Sort
    document.getElementById('taskSort').addEventListener('change', e => {
        taskSortMode = e.target.value;
        renderTaskTable();
    });

    // ===== Task Notion Sync =====

    function updateTaskNotionBar() {
        const connected = !!taskNotionDbId;
        const dot = document.getElementById('taskNotionDot');
        const txt = document.getElementById('taskNotionStatusText');
        const dbName = document.getElementById('taskNotionDbName');
        const pullBtn = document.getElementById('taskPullBtn');
        const pushBtn = document.getElementById('taskPushBtn');
        const connectBtn = document.getElementById('taskNotionConnectBtn');

        dot.classList.toggle('connected', connected);
        txt.textContent = connected ? 'Kết nối Notion:' : 'Chưa kết nối Notion';
        dbName.textContent = taskNotionDbName;
        dbName.style.display = connected ? '' : 'none';
        pullBtn.style.display = connected ? '' : 'none';
        pushBtn.style.display = connected ? '' : 'none';
        connectBtn.textContent = connected ? '⚙ Đổi database' : 'Kết nối Notion';
    }

    async function taskNotionFetch(path, options = {}) {
        // Reuse same proxy logic as main Notion fetch but with task token
        const tkn = taskNotionToken;
        const proxies = [
            p => `https://corsproxy.io/?url=${encodeURIComponent('https://api.notion.com/v1' + p)}`,
            p => `https://proxy.cors.sh/https://api.notion.com/v1${p}`,
            p => `https://api.allorigins.win/raw?url=${encodeURIComponent('https://api.notion.com/v1' + p)}`,
        ];
        const fetchOpts = {
            ...options,
            headers: {
                'Authorization': `Bearer ${tkn}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        };
        let lastErr = null;
        for (const fn of proxies) {
            try {
                const r = await fetch(fn(path), fetchOpts);
                if (!r.ok) {
                    const e = await r.json().catch(() => ({}));
                    throw new Error(e.message || `HTTP ${r.status}`);
                }
                return await r.json();
            } catch (e) {
                lastErr = e;
                if (e.message && !['fetch','network','Failed'].some(w => e.message.includes(w))) throw e;
            }
        }
        throw lastErr || new Error('Không thể kết nối Notion API');
    }

    // Open task Notion modal
    function openTaskNotionModal() {
        const savedTkn = localStorage.getItem('paperlens-notion-token') || '';
        document.getElementById('taskNotionTokenInput').value = savedTkn;
        document.getElementById('taskNotionSaveToken').checked = !!savedTkn;
        document.getElementById('taskNotionStep1').style.display = '';
        document.getElementById('taskNotionStep2').style.display = 'none';
        document.getElementById('taskNotionErr1').style.display = 'none';
        document.getElementById('taskNotionErr2').style.display = 'none';
        document.getElementById('taskDbSelectedInfo').style.display = 'none';
        document.getElementById('taskNotionConfirm').disabled = true;
        taskSelectedDbId = '';
        taskSelectedDbName = '';
        document.getElementById('taskNotionModalOverlay').style.display = 'flex';
    }

    function closeTaskNotionModal() {
        document.getElementById('taskNotionModalOverlay').style.display = 'none';
    }

    async function taskNotionConnect() {
        const token = document.getElementById('taskNotionTokenInput').value.trim();
        if (!token.startsWith('secret_') && !token.startsWith('ntn_')) {
            document.getElementById('taskNotionErr1').textContent = 'Token không hợp lệ (phải bắt đầu bằng ntn_ hoặc secret_)';
            document.getElementById('taskNotionErr1').style.display = '';
            return;
        }
        taskNotionToken = token;
        if (document.getElementById('taskNotionSaveToken').checked) {
            localStorage.setItem('paperlens-notion-token', token);
        }

        document.getElementById('taskNotionConnectText').style.display = 'none';
        document.getElementById('taskNotionConnectSpinner').style.display = '';
        document.getElementById('taskNotionConnect').disabled = true;
        document.getElementById('taskNotionErr1').style.display = 'none';

        try {
            // Search for databases
            const data = await taskNotionFetch('/search', {
                method: 'POST',
                body: JSON.stringify({
                    filter: { value: 'database', property: 'object' },
                    sort: { direction: 'descending', timestamp: 'last_edited_time' },
                    page_size: 100,
                }),
            });

            taskDbs = (data.results || []).map(db => {
                const emoji = db.icon?.emoji || '🗃️';
                const name = db.title?.[0]?.plain_text || 'Untitled Database';
                return { id: db.id, name, emoji };
            });

            document.getElementById('taskNotionConnectText').style.display = '';
            document.getElementById('taskNotionConnectSpinner').style.display = 'none';
            document.getElementById('taskNotionConnect').disabled = false;
            document.getElementById('taskNotionStep1').style.display = 'none';
            document.getElementById('taskNotionStep2').style.display = '';
            taskDbsFiltered = [...taskDbs];
            renderTaskDbList();
            setTimeout(() => document.getElementById('taskDbSearch').focus(), 100);

        } catch (err) {
            document.getElementById('taskNotionConnectText').style.display = '';
            document.getElementById('taskNotionConnectSpinner').style.display = 'none';
            document.getElementById('taskNotionConnect').disabled = false;
            document.getElementById('taskNotionErr1').textContent = '❌ ' + err.message;
            document.getElementById('taskNotionErr1').style.display = '';
        }
    }

    function renderTaskDbList() {
        const list = document.getElementById('taskDbList');
        if (taskDbsFiltered.length === 0) {
            list.innerHTML = `<div class="notion-empty-pages"><strong>Không tìm thấy database nào</strong>Hãy share database Notion với integration PaperLense và thử lại.</div>`;
            return;
        }
        list.innerHTML = taskDbsFiltered.map(db => `
            <div class="notion-page-item${db.id === taskSelectedDbId ? ' selected' : ''}" data-id="${db.id}" data-name="${escapeHtml(db.name)}">
                <span class="notion-page-emoji">${db.emoji}</span>
                <div class="notion-page-info">
                    <div class="notion-page-name">${escapeHtml(db.name)}</div>
                    <div class="notion-page-type">Notion Database</div>
                </div>
                ${db.id === taskSelectedDbId ? `<svg class="notion-page-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
            </div>
        `).join('');

        list.querySelectorAll('.notion-page-item').forEach(el => {
            el.addEventListener('click', () => {
                taskSelectedDbId = el.dataset.id;
                taskSelectedDbName = el.dataset.name;
                document.getElementById('taskDbSelectedName').textContent = taskSelectedDbName;
                document.getElementById('taskDbSelectedInfo').style.display = 'flex';
                document.getElementById('taskNotionConfirm').disabled = false;
                renderTaskDbList();
            });
        });
    }

    async function confirmTaskNotionDb() {
        if (!taskSelectedDbId) return;
        taskNotionDbId = taskSelectedDbId;
        taskNotionDbName = taskSelectedDbName;
        localStorage.setItem('paperlens-task-db-id', taskNotionDbId);
        localStorage.setItem('paperlens-task-db-name', taskNotionDbName);
        closeTaskNotionModal();
        updateTaskNotionBar();
        showToast(`✅ Đã kết nối database "${taskNotionDbName}"!`, 'success');
    }

    // Pull tasks from Notion database
    async function pullTasksFromNotion() {
        if (!taskNotionDbId) return;
        const pullBtn = document.getElementById('taskPullBtn');
        pullBtn.disabled = true;
        pullBtn.textContent = '⌛ Đang tải...';
        try {
            const data = await taskNotionFetch(`/databases/${taskNotionDbId}/query`, {
                method: 'POST',
                body: JSON.stringify({ page_size: 100 }),
            });

            const pulled = (data.results || []).map(page => {
                const props = page.properties || {};
                const getTitle = p => p?.title?.[0]?.plain_text || p?.rich_text?.[0]?.plain_text || '';
                const getRichText = p => p?.rich_text?.[0]?.plain_text || '';
                const getSelect = p => p?.select?.name?.toLowerCase() || 'todo';
                const getDate = p => p?.date?.start || '';

                return {
                    id: page.id.replace(/-/g, ''),
                    notionId: page.id,
                    content: getTitle(props['Nội dung'] || props['Title'] || props['Name'] || Object.values(props).find(p => p.type === 'title')),
                    status: getSelect(props['Tình hình'] || props['Status']),
                    date: getDate(props['Ngày'] || props['Date']),
                    notes: getRichText(props['Ghi chú'] || props['Notes']),
                };
            }).filter(t => t.content);

            tasks = pulled;
            saveTasks();
            renderTaskTable();
            updateTaskDashboard();
            showToast(`✅ Đã tải ${pulled.length} tasks từ Notion!`, 'success');
        } catch (err) {
            showToast(`❌ Pull thất bại: ${err.message}`, 'error');
        }
        pullBtn.disabled = false;
        pullBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Pull`;
    }

    // Push tasks to Notion database
    async function pushTasksToNotion() {
        if (!taskNotionDbId || tasks.length === 0) {
            showToast('Không có tasks để push', 'error');
            return;
        }
        const pushBtn = document.getElementById('taskPushBtn');
        pushBtn.disabled = true;
        pushBtn.textContent = '⌛ Đang push...';

        const statusMap = { todo: 'Chưa bắt đầu', doing: 'Đang làm', done: 'Hoàn thành', blocked: 'Bị chặn' };
        let success = 0;
        for (const task of tasks) {
            try {
                const body = {
                    parent: { database_id: taskNotionDbId },
                    properties: {
                        'Nội dung': { title: [{ text: { content: task.content || '' } }] },
                        'Tình hình': { select: { name: statusMap[task.status] || 'Chưa bắt đầu' } },
                        'Ghi chú': { rich_text: [{ text: { content: task.notes || '' } }] },
                    },
                };
                if (task.date) body.properties['Ngày'] = { date: { start: task.date } };
                await taskNotionFetch('/pages', { method: 'POST', body: JSON.stringify(body) });
                success++;
            } catch (e) { /* skip failed */ }
        }
        showToast(`✅ Đã push ${success}/${tasks.length} tasks lên Notion!`, 'success');
        pushBtn.disabled = false;
        pushBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Push`;
    }

    // Task Notion modal events
    document.getElementById('taskNotionConnectBtn').addEventListener('click', openTaskNotionModal);
    document.getElementById('taskNotionModalClose').addEventListener('click', closeTaskNotionModal);
    document.getElementById('taskNotionCancel1').addEventListener('click', closeTaskNotionModal);
    document.getElementById('taskNotionConnect').addEventListener('click', taskNotionConnect);
    document.getElementById('taskNotionTokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') taskNotionConnect(); });
    document.getElementById('taskNotionEyeBtn').addEventListener('click', () => {
        const inp = document.getElementById('taskNotionTokenInput');
        inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('taskDbSearch').addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        taskDbsFiltered = q ? taskDbs.filter(d => d.name.toLowerCase().includes(q)) : [...taskDbs];
        renderTaskDbList();
    });
    document.getElementById('taskNotionBack').addEventListener('click', () => {
        document.getElementById('taskNotionStep2').style.display = 'none';
        document.getElementById('taskNotionStep1').style.display = '';
    });
    document.getElementById('taskNotionConfirm').addEventListener('click', confirmTaskNotionDb);
    document.getElementById('taskNotionModalOverlay').addEventListener('click', e => {
        if (e.target === document.getElementById('taskNotionModalOverlay')) closeTaskNotionModal();
    });
    document.getElementById('taskPullBtn').addEventListener('click', pullTasksFromNotion);
    document.getElementById('taskPushBtn').addEventListener('click', pushTasksToNotion);

    // Init task notion bar state
    updateTaskNotionBar();

})();
