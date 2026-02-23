/* VibeSim AI Editor - Advanced Vibe Logic */
const PRIVACY_VERSION = '15/2/2026';
import DOMPurify from "dompurify";
import html2canvas from "html2canvas";

/**
 * Utility: Determine MIME type from file path
 */
function getMime(path) {
    const ext = (path || '').split('.').pop().toLowerCase();
    const map = {
        'html': 'text/html', 'htm': 'text/html', 'css': 'text/css', 
        'js': 'application/javascript', 'jsx': 'application/javascript',
        'ts': 'application/typescript', 'tsx': 'application/typescript',
        'json': 'application/json', 'png': 'image/png', 'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp',
        'svg': 'image/svg+xml', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
        'ogg': 'audio/ogg', 'mp4': 'video/mp4', 'txt': 'text/plain',
        'md': 'text/markdown'
    };
    return map[ext] || 'application/octet-stream';
}

/**
 * Utility: Robustly convert VibeSim file object to a binary Blob.
 * Handles plain text, Data URLs, and wrapped binary markers.
 */
async function vibesimToBlob(file, path) {
    if (!file) return new Blob([''], { type: 'text/plain' });
    
    // If it's already a blobUrl, we might want to fetch it, 
    // but usually this helper is called when we want to process the in-memory content.
    let content = file.content;
    const mime = getMime(path);

    if (typeof content !== 'string') {
        return new Blob([content || ''], { type: mime });
    }

    // 1. Handle Import Wrapper: "/* binary data url */\n<data...>"
    if (content.startsWith('/* binary data url */')) {
        content = content.split('\n').slice(1).join('\n').trim();
    }

    // 2. Handle standard Data URL
    if (content.startsWith('data:')) {
        try {
            const parts = content.split(',');
            if (parts.length < 2) throw new Error('Invalid data URL');
            const byteString = atob(parts[1]);
            const mimeMatch = parts[0].match(/:(.*?);/);
            const actualMime = mimeMatch ? mimeMatch[1] : mime;
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            return new Blob([ab], { type: actualMime });
        } catch (e) {
            console.warn('Failed to parse Data URL as binary, falling back to text', e);
        }
    }

    // 3. Handle raw base64 (heuristic: long string, no spaces, base64-ish charset)
    if (/^[A-Za-z0-9+/=]{128,}$/.test(content.replace(/\s/g, ''))) {
        try {
            const b64 = content.replace(/\s/g, '');
            const byteString = atob(b64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            return new Blob([ab], { type: mime });
        } catch (e) { /* ignore and treat as text */ }
    }

    // 4. Default: Plain text
    return new Blob([content], { type: mime });
}

/*
  Suppress noisy ResizeObserver loop warnings and related harmless messages that
  can surface from iframe content and postMessage shims. These are benign and
  clutter the UI/console; swallow them early to avoid showing "undefined" or
  spammy notifications to users.
*/
(function suppressBenignFrontendNoise() {
    // Ignore ResizeObserver loop completed messages (commonly benign)
    window.addEventListener('error', (ev) => {
        try {
            const msg = ev && ev.message ? String(ev.message) : '';
            if (msg.includes('ResizeObserver loop completed with undelivered notifications')) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                return;
            }
        } catch (e) { /* ignore suppression errors */ }
    }, true);

    // Also ignore same message if it appears via postMessage payload strings
    window.addEventListener('message', (e) => {
        try {
            const d = e && e.data;
            if (typeof d === 'string' && d.includes('ResizeObserver loop completed with undelivered notifications')) {
                // swallow this particular message
                return;
            }
            // If message is undefined or the literal string "undefined", ignore it to avoid noise
            if (typeof d === 'undefined' || d === 'undefined') return;
        } catch (err) { /* noop */ }
    }, true);

    // Silently ignore Promise rejections that only contain this specific message
    window.addEventListener('unhandledrejection', (ev) => {
        try {
            const reason = ev && ev.reason ? String(ev.reason) : '';
            if (reason.includes('ResizeObserver loop completed with undelivered notifications')) {
                ev.preventDefault();
            }
        } catch (e) {}
    });
})();

// Resolve project-local assets (files/blob/data URLs) for runtime previews and media.
// This helper tries several fallbacks: explicit blobUrl, data: URLs, in-memory file content -> blob URL,
// and basename lookups (so "img.png" or "./img.png" references still work).
window.resolveVibesimAsset = function (path) {
    try {
        if (!path) return path;
        let p = String(path);
        // strip surrounding quotes and leading ./ or / if any
        p = p.replace(/^['"]|['"]$/g, '').trim();
        const normalized = p.replace(/^\.\//, '').replace(/^\//, '');

        // direct absolute/data URLs pass through
        if (/^https?:\/\//i.test(p) || /^data:/i.test(p) || p.startsWith('blob:')) return p;

        const files = (window.state && window.state.files) ? window.state.files : {};

        // 1. Try normalized exact match
        if (files[normalized]) {
            const f = files[normalized];
            if (f.blobUrl) return f.blobUrl;
            if (typeof f.content === 'string' && f.content.startsWith('data:')) return f.content;
            if (isImportWrappedDataUrl(f.content)) return f.content.split('\n').slice(1).join('\n').trim();
        }

        // 2. Try original exact match
        if (files[p]) {
            const f = files[p];
            if (f.blobUrl) return f.blobUrl;
            if (typeof f.content === 'string' && f.content.startsWith('data:')) return f.content;
        }

        // 3. Try basename fallback (e.g., "image.png" referenced from code)
        const base = normalized.split('/').pop();
        if (base && files[base]) {
            const fb = files[base];
            if (fb.blobUrl) return fb.blobUrl;
            if (typeof fb.content === 'string' && fb.content.startsWith('data:')) return fb.content;
        }

        // 4. Try scanning all keys for partial matches (best effort for deep paths)
        for (const key of Object.keys(files)) {
            if (key.endsWith('/' + normalized) || normalized.endsWith('/' + key)) {
                const fk = files[key];
                if (fk.blobUrl) return fk.blobUrl;
                if (fk.content && fk.content.startsWith('data:')) return fk.content;
            }
        }
    } catch (e) {
        console.warn('resolveVibesimAsset error', e);
    }
    return path;
};

// Patch audio constructor and CSS url() setters so runtime code that uses
// new Audio('path.mp3') or element.style.backgroundImage = `url('path.png')`
// gets a resolved blob/data URL when possible.
(function patchMediaAndCssUrlRemap() {
    try {
        // Patch Audio constructor to resolve local project assets first
        const OriginalAudio = window.Audio;
        function PatchedAudio(src) {
            // allow being called without "new"
            const resolved = window.resolveVibesimAsset(src || '') || src;
            return new OriginalAudio(resolved);
        }
        // keep prototype chain so instanceof checks still work
        PatchedAudio.prototype = OriginalAudio.prototype;
        window.Audio = PatchedAudio;

        // Patch CSSStyleDeclaration.backgroundImage setter to rewrite url(...) values
        const bgDesc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'backgroundImage') || {};
        if (bgDesc && typeof bgDesc.set === 'function') {
            Object.defineProperty(CSSStyleDeclaration.prototype, 'backgroundImage', {
                configurable: true,
                enumerable: bgDesc.enumerable,
                get: bgDesc.get,
                set: function (val) {
                    try {
                        if (typeof val === 'string' && val.includes('url(')) {
                            const replaced = val.replace(/url\((['"]?)(.*?)\1\)/g, function (_, q, url) {
                                try {
                                    const r = window.resolveVibesimAsset(url);
                                    return 'url("' + (r || url) + '")';
                                } catch (e) { return `url("${url}")`; }
                            });
                            return bgDesc.set.call(this, replaced);
                        }
                    } catch (e) { /* fall through */ }
                    return bgDesc.set.call(this, val);
                }
            });
        }

        // Patch setProperty to also rewrite url(...) values (covers element.style.setProperty)
        const origSetProperty = CSSStyleDeclaration.prototype.setProperty;
        CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
            try {
                if (typeof value === 'string' && value.includes('url(')) {
                    value = value.replace(/url\((['"]?)(.*?)\1\)/g, function (_, q, url) {
                        try {
                            const r = window.resolveVibesimAsset(url);
                            return 'url("' + (r || url) + '")';
                        } catch (e) { return `url("${url}")`; }
                    });
                }
            } catch (e) { /* ignore */ }
            return origSetProperty.call(this, name, value, priority);
        };

        // Real-time DOM remapping: rewrite element attributes and inline styles when elements are added or on load.
        // This ensures dynamic scripts that call new Audio('file.mp3') or set backgroundImage/src/href after DOMReady will get resolved URLs.
        function remapAttributesOnElement(el) {
            try {
                if (!el || el.nodeType !== 1) return;
                // Attributes to consider
                const attrs = ['src', 'href', 'poster', 'data-src', 'data-href'];
                attrs.forEach(attr => {
                    if (el.hasAttribute && el.hasAttribute(attr)) {
                        const val = el.getAttribute(attr);
                        if (typeof val === 'string' && val.trim()) {
                            const resolved = window.resolveVibesimAsset(val);
                            if (resolved && resolved !== val) {
                                try { el.setAttribute(attr, resolved); } catch (e) {}
                                // also update direct properties if present (image.src/audio.src)
                                try { if (attr === 'src' && 'src' in el) el.src = resolved; } catch (e) {}
                            }
                        }
                    }
                });

                // Inline style backgroundImage
                try {
                    const style = el.style && el.style.backgroundImage;
                    if (typeof style === 'string' && style.includes('url(')) {
                        const replaced = style.replace(/url\((['"]?)(.*?)\1\)/g, function (_, q, url) {
                            try {
                                const r = window.resolveVibesimAsset(url);
                                return 'url("' + (r || url) + '")';
                            } catch (e) { return `url("${url}")`; }
                        });
                        if (replaced !== style) el.style.backgroundImage = replaced;
                    }
                } catch (e) { /* ignore */ }

                // For <audio> and <video> with <source> children, remap their children
                if (el.tagName) {
                    const tag = el.tagName.toLowerCase();
                    if (tag === 'audio' || tag === 'video' || tag === 'source' || tag === 'img') {
                        // ensure .src property is consistent
                        if (el.src) {
                            const r = window.resolveVibesimAsset(el.src);
                            if (r && r !== el.src) try { el.src = r; } catch (e) {}
                        }
                        // remap <source> children
                        const sources = el.querySelectorAll && el.querySelectorAll('source');
                        if (sources && sources.length) {
                            sources.forEach(s => {
                                const ssrc = s.getAttribute('src') || s.src || '';
                                if (ssrc) {
                                    const rr = window.resolveVibesimAsset(ssrc);
                                    if (rr && rr !== ssrc) try { s.setAttribute('src', rr); if ('src' in s) s.src = rr; } catch (e) {}
                                }
                            });
                            // reload media element to pick up new sources if applicable
                            try { if (typeof el.load === 'function') el.load(); } catch (e) {}
                        }
                    }
                }
            } catch (err) {
                // avoid noisy failures
                console.warn('remapAttributesOnElement error', err);
            }
        }

        // Walk initial document and remap attributes/styles for existing nodes
        function remapAllExisting() {
            try {
                const treeWalker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, null, false);
                let node = treeWalker.currentNode;
                if (node) remapAttributesOnElement(node);
                while ((node = treeWalker.nextNode())) {
                    remapAttributesOnElement(node);
                }
                // Also remap top-level audio/image elements that may exist before DOMContentLoaded
                Array.from(document.querySelectorAll('audio,video,img,source,link')).forEach(remapAttributesOnElement);
            } catch (e) {
                console.warn('remapAllExisting failed', e);
            }
        }

        // Observe dynamic additions and attribute changes
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'childList') {
                    m.addedNodes && m.addedNodes.forEach(n => {
                        if (n.nodeType === 1) {
                            remapAttributesOnElement(n);
                            // also remap descendants
                            try {
                                n.querySelectorAll && n.querySelectorAll('*').forEach(remapAttributesOnElement);
                            } catch (e) {}
                        }
                    });
                } else if (m.type === 'attributes') {
                    remapAttributesOnElement(m.target);
                }
            }
        });

        // Start observing the document body once DOM is ready
        function startObserving() {
            try {
                if (document.body) {
                    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src','href','data-src','data-href','style','poster'] });
                    // initial pass
                    remapAllExisting();
                } else {
                    // try again shortly if body not yet present
                    setTimeout(startObserving, 50);
                }
            } catch (e) { console.warn('startObserving error', e); }
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserving, { once: true });
        } else {
            startObserving();
        }
    } catch (e) {
        console.warn('patchMediaAndCssUrlRemap failed', e);
    }
})();

const state = {
    consent: false, // whether the user consented to policy & cloud usage (persisted)
    privacyAgreedVersion: null, // track which privacy policy version the user agreed to
    files: {
        'index.html': {
            content: `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>VIBE CODING — Example</title>
  <link rel="stylesheet" href="styles.css" />
  <script defer src="main.js"></script>
  <style>
    /* minimal inlined helper so preview shows correctly even if external CSS not processed */
    html,body{height:100%;margin:0}
  </style>
</head>
<body class="app">
  <main class="center">
    <h1 id="vibe-logo" class="logo">VIBE CODING</h1>
    <p class="subtitle">Click the title to change the gradient — a small CSS example.</p>
    <button id="random-vibe" class="btn">Random Vibe</button>
  </main>
</body>
</html>`,
            language: 'html'
        },
        'styles.css': {
            content: `:root{--bg:#0b0b0d;--muted:#9ca3af}
body{margin:0;font-family:Inter,system-ui,Segoe UI,Roboto,-apple-system}
.app{background:linear-gradient(180deg,#07070a 0%,var(--bg) 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;color:#e6eef8}
.center{text-align:center;padding:48px}
.logo{font-family:'JetBrains Mono',monospace;font-weight:900;font-size:72px;cursor:pointer;background:linear-gradient(90deg,#60a5fa,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent;transition:background 400ms ease}
.subtitle{color:var(--muted);margin-top:8px}
.btn{margin-top:18px;padding:10px 14px;border-radius:10px;border:none;background:#3b82f6;color:white;cursor:pointer}
.logo[data-variant="1"]{background:linear-gradient(90deg,#60a5fa,#a78bfa)}
.logo[data-variant="2"]{background:linear-gradient(90deg,#34d399,#3b82f6)}
.logo[data-variant="3"]{background:linear-gradient(90deg,#f59e0b,#ef4444)}
.logo[data-variant="4"]{background:linear-gradient(90deg,#f472b6,#8b5cf6)}
.logo[data-variant="5"]{background:linear-gradient(90deg,#f97316,#f43f5e)}`,
            language: 'css'
        },
        'main.js': {
            content: `document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('random-vibe');
  const logo=document.getElementById('vibe-logo');
  btn?.addEventListener('click',()=>{const vibes=['Chill','Energetic','Lo-fi','Hyperpop','Ambient'];const v=vibes[Math.floor(Math.random()*vibes.length)];alert('Vibe: '+v);});
  // gradient variants
  let variant=1;
  logo?.addEventListener('click',()=>{
    variant = variant >=5 ? 1 : variant+1;
    logo.setAttribute('data-variant', String(variant));
  });
});`,
            language: 'javascript'
        }
    },
    tabs: ['index.html','styles.css','main.js'],
    activeTab: 'index.html',
    activeView: 'preview', // 'preview' or 'editor'
    activePanel: 'chat',
    sidebarOpen: true,
    apiEndpoint: 'https://aigenapi.alejognus17.workers.dev/api/chat',
    // internal preview pause state (holds previous preview src while project manager is open)
    _prevPreviewSrc: null,
    conversationHistory: [],
    isProcessing: false,
    shouldAbort: false,
    tasks: [],
    pendingChanges: [],
    balance: 0,
    currentModel: 'glm-4.7',
    availableModels: [],
    abilities: {
        websim_services: false,
        ads: false
    },
    projects: {}, // { id: { name, files, tabs, activeTab, screenshot } }
    currentProjectId: null,
    generationNotes: [], // collect runtime errors / important changes during agentic runs
    templates: [],
    room: null,
    // Track AI prompts so we can create version snapshots less frequently (every 1-2 prompts)
    aiPromptsSinceLastVersion: 0,
    // helper to indicate preview is paused due to Project Manager
    _previewPaused: false,
    communityPosts: [],
    currentViewingPost: null,
    externalResourceAllowances: new Set()
};

/* DOM Refs — Monaco replaces textarea/editor-highlight */
const elements = {
    monacoContainer: document.getElementById('monaco-container'),
    tabsBar: document.getElementById('tabs-bar'),
    breadcrumb: document.getElementById('breadcrumb'),
    fileTree: document.getElementById('file-tree'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    sendBtn: document.getElementById('send-btn'),
    abortBtn: document.getElementById('abort-btn'),
    previewIframe: document.getElementById('preview-iframe'),
    mainViewContainer: document.getElementById('main-view-container'),
    sidebar: document.getElementById('right-sidebar'),
    taskPanel: document.getElementById('task-panel'),
    taskList: document.getElementById('task-list'),
};

let monacoEditor = null;
let monacoLoaderReady = false;

// Init
/* Preview pause/resume helpers:
   pausePreview() saves current preview iframe src and navigates preview to about:blank so the preview halts.
   resumePreview() restores the saved src when the Project Manager closes.
*/
function pausePreview() {
    try {
        if (!elements || !elements.previewIframe) return;
        if (state._previewPaused) return;
        state._prevPreviewSrc = elements.previewIframe.src || '';
        // navigate to about:blank to stop active work in iframe and release resources
        try { elements.previewIframe.src = 'about:blank'; } catch (e) {}
        state._previewPaused = true;
    } catch (e) { console.warn('pausePreview failed', e); }
}

function resumePreview() {
    try {
        if (!elements || !elements.previewIframe) return;
        if (!state._previewPaused) return;
        const toRestore = state._prevPreviewSrc || '';
        // restore previous preview source (if any)
        if (toRestore && toRestore !== 'about:blank') {
            try { elements.previewIframe.src = toRestore; } catch (e) {}
        } else {
            // if nothing to restore, run a fresh updatePreview to recreate preview from current files
            try { updatePreview(); } catch (e) {}
        }
        state._prevPreviewSrc = null;
        state._previewPaused = false;
    } catch (e) { console.warn('resumePreview failed', e); }
}

async function attemptAutoLink() {
    try {
        if (window.websim && typeof window.websim.getCurrentUser === 'function') {
            const user = await window.websim.getCurrentUser();
            const username = user && user.username ? user.username : null;
            if (username) {
                const base = new URL(state.apiEndpoint).origin;
                const res = await fetch(`${base}/api/claim-id`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompterId: username })
                });
                const data = await res.json();
                if (data && data.success) {
                    state.prompterId = data.prompterId || username;
                    localStorage.setItem('vibesim_prompter_id', state.prompterId);
                    showSnackbar(`Linked as ${state.prompterId}`);
                    renderSettingsPanel();
                    renderCreditsPanel();
                }
            }
        }
    } catch (err) {
        console.warn('Auto-link background attempt failed', err);
    }
}

async function checkLoginStatus() {
    try {
        if (!window.websim || typeof window.websim.getUser !== 'function') return false;
        const user = await window.websim.getUser();
        return !!(user && user.username && user.username !== 'anonymous');
    } catch (e) {
        return false;
    }
}

// Start periodic re-check to catch login changes (keeps checking in background)
setInterval(async () => {
    try {
        await checkLoginStatus();
    } catch (e) { /* ignore periodic errors */ }
}, 5000);

async function showSnackbar(message) {
    const bar = document.getElementById('vibesim-snackbar');
    if (!bar) return;
    bar.textContent = message;
    bar.classList.add('show');
    setTimeout(() => bar.classList.remove('show'), 3000);
}

function showDialog({ title, body, input = false, confirmText = 'OK', cancelText = 'Cancel' }) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('vibesim-dialog');
        const titleEl = document.getElementById('dialog-title');
        const bodyEl = document.getElementById('dialog-body');
        const inputContainer = document.getElementById('dialog-input-container');
        const inputEl = document.getElementById('dialog-input');
        const confirmBtn = document.getElementById('dialog-confirm');
        const cancelBtn = document.getElementById('dialog-cancel');

        titleEl.textContent = title;
        bodyEl.textContent = body;
        inputContainer.classList.toggle('hidden', !input);
        if (input) inputEl.value = '';
        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;

        const cleanup = () => {
            dialog.classList.remove('show');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        confirmBtn.onclick = () => {
            const val = input ? inputEl.value : true;
            cleanup();
            resolve(val);
        };
        cancelBtn.onclick = () => {
            cleanup();
            resolve(null);
        };

        dialog.classList.add('show');
        if (input) setTimeout(() => inputEl.focus(), 100);
    });
}

async function init() {
    // Force consent for all users to match instructions and avoid UI fragmentation
    state.consent = true;
    localStorage.setItem('vibesim_consent', '1');

    // First: ensure the user is logged in (non-anonymous) before doing any linking or initializing room
    try {
        const loggedIn = await checkLoginStatus();
        if (!loggedIn) {
            // Show a blocking warning explaining login is required
            await showDialog({
                title: 'Login Required',
                body: 'You must be logged in to Websim to use VibeSim features. Please sign in to continue.',
                confirmText: 'OK',
                cancelText: 'Close'
            });
            // Intentionally throw to crash/stop further initialization as requested
            // throw new Error('Not logged into websim impersonating a WebsimSocket error');
        }
    } catch (e) {
        // If checkLoginStatus threw or returned false, we stop initialization and surface the error
        console.error('Login check failed or user is anonymous:', e);
        // throw e;
    }

    // If the user previously requested deletion, enforce a lockout message for 48 hours from request time.
    try {
        const req = localStorage.getItem('vibesim_deletion_requested_at');
        if (req) {
            const ts = Number(req);
            if (!isNaN(ts)) {
                const now = Date.now();
                const hoursSince = (now - ts) / (1000 * 60 * 60);
                // If within 48 hours, show a non-closable lockout modal and stop initialization
                // lockout for 14 days (converted to hours: 14 * 24 = 336)
                if (hoursSince < 336) {
                    // Create a blocking modal that cannot be closed
                    const existing = document.getElementById('vibesim-deletion-lockout-modal');
                    if (!existing) {
                        const modal = document.createElement('div');
                        modal.id = 'vibesim-deletion-lockout-modal';
                        modal.className = 'modal-overlay show';
                        modal.style.zIndex = 6000;
                        modal.innerHTML = `
                          <div class="project-modal" style="max-width:640px; padding: 20px;">
                            <div class="modal-header">Account Deletion Requested</div>
                            <div style="padding:16px; color:#cbd5e1; font-size:13px; line-height:1.45">
                              <p>You recently asked to remove your data; this request is being processed. For at least the next 14 days you may not use the app.</p>
                              <p style="margin-top:12px;color:#f87171;font-weight:700">You will lose all credits and access once deletion proceeds. This action is irreversible and will permanently remove your account. You will lose all access to the app and any associated accounts or data when deletion completes. Contact the creator if urgent.</p>
                            </div>
                            <div style="padding:16px;color:#9aa6b2;font-size:12px">This screen cannot be dismissed while deletion is being processed.</div>
                          </div>
                        `;
                        document.body.appendChild(modal);
                    }
                    // Prevent init from proceeding
                    throw new Error('User locked out due to recent deletion request');
                }
            }
        }
    } catch (lockErr) {
        // Surface lock error so initialization stops
        console.warn('Lockout enforced', lockErr);
        throw lockErr;
    }

    // Proceed with normal initialization for authenticated users (safe-fail if the bridge is unavailable)
    state.roomAvailable = false;
    try {
        state.room = new WebsimSocket();
        await state.room.initialize();
        state.roomAvailable = true;
    } catch (err) {
        console.warn('WebsimSocket init failed — falling back to local-only mode', err);
        state.room = null;
        state.roomAvailable = false;
    }
    
    // If room is available, subscribe to remote collections; otherwise use empty fallbacks so UI keeps working offline.
    if (state.roomAvailable && state.room && typeof state.room.collection === 'function') {
        // Subscribe to templates
        state.room.collection('template_v1').subscribe(templates => {
            state.templates = templates;
            if (document.getElementById('project-manager-modal')?.classList.contains('show')) {
                if (document.querySelector('.modal-tab-btn.active')?.dataset.tab === 'templates') renderTemplateGrid();
            }
        });

        // Subscribe to Community Feed
        state.room.collection('vibe_post_v3').subscribe(posts => {
            // Ensure posts have a reasonable default if data is sparse
            state.communityPosts = posts.filter(p => p.title && p.files);
            if (document.getElementById('project-manager-modal')?.classList.contains('show')) {
                const activeTab = document.querySelector('.modal-tab-btn.active')?.dataset.tab;
                if (activeTab === 'homepage') renderHomepage();
                else if (activeTab === 'projects') renderProjectList();
            }
        });
    } else {
        // Offline/local-only fallbacks to keep UI functional
        state.templates = state.templates || [];
        state.communityPosts = state.communityPosts || [];
    }

    loadProjectsFromStorage();
    // load consent and privacy version from storage
    const storedConsent = localStorage.getItem('vibesim_consent');
    const storedPrivacyVersion = localStorage.getItem('vibesim_privacy_version') || null;
    state.consent = storedConsent === '1';
    state.privacyAgreedVersion = storedPrivacyVersion;
    // If the stored privacy version is missing or older than the current policy version,
    // require re-consent (reset consent so the privacy modal will be shown later).
    if (state.privacyAgreedVersion !== PRIVACY_VERSION) {
        state.consent = false;
    }

    setupEventListeners();
    setupCustomDropdown();
    setupAbilitiesDropdown();
    setupProjectManager();

    // Enforce consent as granted by default in this build: mark and persist consent so there is no decline/unconsent path.
    // Persist and reflect consent immediately so hidden checkbox and settings behave consistently.
    state.consent = true;
    try { localStorage.setItem('vibesim_consent', '1'); } catch (e) {}

    // Fetch dynamic models list for v10.0
    await initializeModels();

    // Restore prompterId if exists
    state.prompterId = localStorage.getItem('vibesim_prompter_id') || null;

    if (state.consent && !state.prompterId) {
        // Try auto-linking once on load if consented but no ID
        setTimeout(() => attemptAutoLink(), 1000);
    }

    await loadMonaco();
    
    // Sync initial state
    renderFileTree();
    openFile(state.activeTab || 'index.html');
    updateView();
    
    // Initial balance fetch (will be no-op if not consented)
    updateBalanceDisplay();

    // Enforce consent-based UI restrictions immediately
    enforceConsentRestrictions();

    // Open the project manager immediately on startup
    openProjectManager();

    // If the user hasn't liked the current project yet, show an unlock-templates prompt
    // (non-blocking; helps encourage supporting the creator to unlock template creation)
    setTimeout(() => {
        showUnlockTemplatesIfNeeded().catch(err => console.warn('Unlock templates check failed', err));
    }, 600);

    // Render settings panel state if user navigates to it
    renderSettingsPanel();

    // Enforce consent-based UI restrictions immediately
    enforceConsentRestrictions();

    window.addEventListener('message', handleIframeMessage);

    // If on a mobile device in portrait, warn the user that the project isn't mobile-friendly and suggest trying landscape.
    function isMobileDevice() {
        try {
            const ua = navigator.userAgent || navigator.vendor || window.opera || '';
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(ua) || ('ontouchstart' in window && /Mobi|Android/i.test(ua));
        } catch (e) {
            return false;
        }
    }

    async function showMobileWarningIfNeeded() {
        try {
            // Treat as mobile when user agent hints mobile OR touch support and small viewport.
            const mobile = isMobileDevice();
            const portrait = window.innerHeight > window.innerWidth;
            if (mobile && portrait) {
                await showDialog({
                    title: 'Mobile Notice',
                    body: "This project is not mobile friendly in portrait orientation — you can try viewing it in landscape for a better experience.",
                    confirmText: 'OK'
                });
            }
        } catch (e) {
            // ignore any failures to avoid blocking init
            console.warn('Mobile warning check failed', e);
        }
    }

    // Run the mobile-friendly warning after initialization completes.
    setTimeout(() => { showMobileWarningIfNeeded(); }, 600);
}

async function loadProjectsFromStorage() {
    const stored = localStorage.getItem('vibesim_projects');
    if (stored) {
        try {
            state.projects = JSON.parse(stored);
            const lastId = localStorage.getItem('vibesim_current_project');
            if (lastId && state.projects[lastId]) {
                state.currentProjectId = lastId;
                const p = state.projects[lastId];
                
                // Hydrate files from blobs if necessary
                await hydrateProjectFiles(p);
                
                state.files = p.files;
                state.tabs = p.tabs || Object.keys(p.files);
                state.activeTab = p.activeTab || state.tabs[0];
                
                renderFileTree();
                openFile(state.activeTab);
            }
        } catch(e) { console.error("Storage load failed", e); }
    }

    if (!state.projects || Object.keys(state.projects).length === 0) {
        state.projects = {};
        state.currentProjectId = null;
        state.files = {};
        state.tabs = [];
        state.activeTab = null;
    }
}

async function hydrateProjectFiles(project) {
    if (!project.files) return;
    for (const [path, file] of Object.entries(project.files)) {
        if (file.blobUrl && !file.content) {
            try {
                const res = await fetch(file.blobUrl);
                if (res.ok) {
                    file.content = await res.text();
                }
            } catch (err) {
                console.error(`Failed to hydrate ${path} from ${file.blobUrl}`, err);
                file.content = "/* Error loading file content from cloud */";
            }
        }
    }
}

async function saveProjectsToStorage(forceSync = false, createVersion = false) {
    if (!state.currentProjectId) return;

    const saveBtn = document.getElementById('save-project-btn');
    if (saveBtn) {
        saveBtn.classList.add('opacity-50');
        saveBtn.querySelector('span').textContent = 'Saving...';
    }

    // Prepare files for storage: upload modified ones to blobs
    const currentFiles = JSON.parse(JSON.stringify(state.files));
    
    if (forceSync) {
        // Upload files to cloud storage while keeping in-memory content intact.
        // We use vibesimToBlob to ensure binary assets (images/audio) aren't corrupted during upload.
        for (const [path, file] of Object.entries(currentFiles)) {
            // Only upload if content exists and we don't already have a valid cloud URL
            if (file.content && (!file.blobUrl || !String(file.blobUrl).startsWith('http'))) {
                try {
                    const blob = await vibesimToBlob(file, path);
                    const f = new File([blob], path, { type: blob.type });
                    const url = await window.websim.upload(f);
                    file.blobUrl = url;
                } catch (err) {
                    console.error(`Failed to upload ${path} to blob storage`, err);
                }
            }
        }
    }

    const project = state.projects[state.currentProjectId] || {};
    const newMeta = {
        // Prefer stored project name; fall back to the title in the UI header (#project-name) then to Untitled
        name: (project && project.name) ? project.name : (document.getElementById('project-name') ? document.getElementById('project-name').textContent : 'Untitled'),
        files: currentFiles,
        tabs: state.tabs,
        activeTab: state.activeTab,
        modified: true,
        lastSynced: forceSync ? new Date().toISOString() : project.lastSynced
    };

    // Create a versions snapshot that preserves blob URLs (or data URLs) for rollback.
    try {
        const existingVersions = project.versions && Array.isArray(project.versions) ? [...project.versions] : [];

        // Helper to build a snapshot entry from currentFiles
        const buildSnapshot = (tag = '') => {
            const snapshotFiles = {};
            for (const [p, f] of Object.entries(currentFiles)) {
                snapshotFiles[p] = {
                    blobUrl: f.blobUrl || null,
                    content: (!f.blobUrl && typeof f.content !== 'undefined') ? f.content : undefined
                };
            }
            return {
                id: (tag ? `${tag}-` : '') + Date.now().toString(36),
                createdAt: new Date().toISOString(),
                tag: tag || null,
                files: snapshotFiles
            };
        };

        // If explicitly requested by caller, create a user-intended version snapshot (throttled by AI prompts).
        if (createVersion) {
            existingVersions.unshift(buildSnapshot('v'));
        } else {
            // preserve existing versions (will be possibly prepended by cloud snapshot below)
        }

        // Additionally, when forcing a cloud sync (forceSync === true) create a "cloud" snapshot entry
        // so users can roll back to the exact cloud-saved state from Versions.
        if (forceSync) {
            // mark this snapshot as a cloud-origin version
            existingVersions.unshift(buildSnapshot('cloud'));
        }

        // keep recent N versions to avoid unbounded storage (keep 20)
        newMeta.versions = existingVersions.slice(0, 20);
    } catch (e) {
        console.warn('Version snapshot failed', e);
    }

    state.projects[state.currentProjectId] = { ...(project || {}), ...newMeta };

    // Persist meta-heavy state to localStorage
    try {
        const toSave = {};
        Object.entries(state.projects).forEach(([id, p]) => {
            // strip massive contents from any file that has a blobUrl
            const strippedFiles = JSON.parse(JSON.stringify(p.files));
            Object.values(strippedFiles).forEach(f => {
                if (f && f.blobUrl) delete f.content;
            });

            // Also strip heavy version file contents where blobUrl exists (but keep blobUrl)
            const versionsCopy = (p.versions || []).map(v => {
                const vf = {};
                Object.entries(v.files || {}).forEach(([k, file]) => {
                    vf[k] = {};
                    if (file.blobUrl) vf[k].blobUrl = file.blobUrl;
                    else if (file.content) vf[k].content = file.content;
                });
                return { id: v.id, createdAt: v.createdAt, files: vf };
            });

            toSave[id] = { ...p, files: strippedFiles, versions: versionsCopy };
        });

        localStorage.setItem('vibesim_projects', JSON.stringify(toSave));
        localStorage.setItem('vibesim_current_project', state.currentProjectId);
        if (forceSync) showSnackbar('Project saved to cloud!');
    } catch (err) {
        console.warn('Storage failed', err);
        showSnackbar('Storage quota hit. Use the Save button to sync files to the cloud.');

        // Attempt automatic recovery: if the current project has versions, try restoring newest previous version
        try {
            const pid = state.currentProjectId;
            const proj = pid && state.projects && state.projects[pid] ? state.projects[pid] : null;
            if (proj && Array.isArray(proj.versions) && proj.versions.length > 0) {
                // Find newest version that is not the current in-memory snapshot and that doesn't contain the broken default message
                const findValidVersion = proj.versions.find(v => {
                    if (!v || !v.files) return false;
                    const idx = v.files['index.html'];
                    if (!idx) return true; // version without index.html is acceptable
                    const content = idx.content || '';
                    // detect the exact broken default message pattern and skip it
                    if (typeof content === 'string' && content.includes('Your project broke') && content.includes('Look in Versions')) return false;
                    return true;
                });

                if (findValidVersion) {
                    // Restore files from the version (prefer content over blobUrl for immediate usability)
                    const restored = {};
                    Object.entries(findValidVersion.files || {}).forEach(([p, f]) => {
                        if (f && f.blobUrl) restored[p] = { blobUrl: f.blobUrl, language: getLang(p) };
                        else restored[p] = { content: (f && typeof f.content !== 'undefined') ? f.content : '', language: getLang(p) };
                    });

                    // apply restore to in-memory project (do not override project metadata like versions)
                    state.projects[pid].files = restored;
                    // if this is the active project, swap state.files and tabs and activeTab
                    if (state.currentProjectId === pid) {
                        state.files = restored;
                        state.tabs = Object.keys(restored);
                        state.activeTab = state.tabs[0] || null;
                        renderFileTree();
                        renderTabs();
                        openFile(state.activeTab);
                        updatePreview();
                    }
                    showSnackbar('Storage failed — restored latest available version into memory. Save again to persist.');
                    // Try saving again once (best-effort)
                    try { await saveProjectsToStorage(true); } catch (e) { console.warn('Retry save after auto-restore failed', e); }
                } else {
                    console.warn('No valid version found to auto-restore.');
                }
            }
        } catch (re) {
            console.warn('Auto-restore attempt failed', re);
        }
    } finally {
        if (saveBtn) {
            saveBtn.classList.remove('opacity-50');
            saveBtn.querySelector('span').textContent = 'Save';
        }
    }
}

async function initializeModels() {
    try {
        const base = new URL(state.apiEndpoint).origin;
        const response = await fetch(`${base}/models`);
        const data = await response.json();
        
        if (data.success && Array.isArray(data.models)) {
            state.availableModels = data.models;
            // Update UI trigger if model changed
            const current = state.availableModels.find(m => m.id === state.currentModel);
            if (!current && state.availableModels.length > 0) {
                state.currentModel = state.availableModels[0].id;
                const nameSpan = document.getElementById('selected-model-name');
                if (nameSpan) nameSpan.textContent = state.availableModels[0].name;
            }
        }
    } catch (error) {
        console.error('Failed to fetch models', error);
        // Fallback to minimal hardcoded if fetch fails
        state.availableModels = [
            { id: 'glm-4.7-flash', name: 'GLM 4.7', cost: 2, info: 'Advanced GLM Model' },
            { id: 'glm-4.5-flash', name: 'GLM 4.5', cost: 1, info: 'Standard GLM Model' }
        ];
    }
}

async function updateBalanceDisplay() {
    // if not consented, do not call remote usage endpoints
    if (!state.consent) {
        state.balance = 0;
        const el = document.getElementById('balance-display');
        if (el) el.textContent = `Bal: hidden`;
        return;
    }

    const usage = await fetchUsage();
    const creditsData = await fetchCredits();
    
    const dr = (usage && usage.daily && typeof usage.daily.remaining === 'number') ? usage.daily.remaining : 0;
    const ar = (creditsData && creditsData.awardedCredits && typeof creditsData.awardedCredits.remaining === 'number') ? creditsData.awardedCredits.remaining : 0;
    
    state.balance = dr + ar;
    const el = document.getElementById('balance-display');
    if (el) el.textContent = `Bal: ${state.balance}`;
}

function setupEventListeners() {
    // Console Clear
    const clearConsoleBtn = document.getElementById('clear-console');
    if (clearConsoleBtn) {
        clearConsoleBtn.addEventListener('click', () => {
            const container = document.getElementById('console-logs');
            if (container) container.innerHTML = '<div class="text-[#666]">Console cleared.</div>';
        });
    }

    // Console Input
    const consoleInput = document.getElementById('console-input');
    if (consoleInput) {
        consoleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const code = consoleInput.value;
                if (!code.trim()) return;

                logToConsole('command', '> ' + code);
                if (elements.previewIframe && elements.previewIframe.contentWindow) {
                    elements.previewIframe.contentWindow.postMessage({ __vibesim_exec: true, code }, '*');
                }
                consoleInput.value = '';
            }
        });
    }

    // View tabs (Preview / Editor)
    document.querySelectorAll('.view-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeView = btn.dataset.view;
            updateView();
        });
    });

    // Panel tabs (Chat / Explorer / Search)
    document.querySelectorAll('.activity-item[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.activePanel = btn.dataset.panel;
            state.sidebarOpen = true;
            updateSidebar();
        });
    });

    // Sidebar Toggle
    document.getElementById('toggle-sidebar').addEventListener('click', () => {
        state.sidebarOpen = !state.sidebarOpen;
        updateSidebar();
    });

    // Chat
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Clear Chat (trash) button: clears UI messages and internal conversation/task state
    const clearChatBtn = document.getElementById('clear-chat');
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            // wipe chat pane
            const msgs = document.getElementById('chat-messages');
            if (msgs) msgs.innerHTML = '';

            // reset relevant runtime state
            state.conversationHistory = [];
            state.tasks = [];
            state.generationNotes = [];
            state.isProcessing = false;
            state.shouldAbort = false;

            // hide any generating indicator / abort controls
            hideGeneratingIndicator();
            const abortBtn = document.getElementById('abort-btn');
            if (abortBtn) {
                abortBtn.classList.add('hidden');
                abortBtn.disabled = false;
                abortBtn.textContent = 'Stop Generation';
            }

            // re-add the assistant welcome message to keep UI consistent
            addMessage('assistant-vibe', "What's the vibe today? I'm ready to build your project.");

            // persist that project state changed (if desired)
            try { saveProjectsToStorage(); } catch (e) { /* ignore */ }
        });
    }

    // Agentic mode PSA (one-time): warn the user when enabling autonomous agentic mode
    (function setupAgenticPSA() {
        const agentCheckbox = document.getElementById('agentic-mode');
        if (!agentCheckbox) return;
        agentCheckbox.addEventListener('change', async (e) => {
            // only trigger when being turned ON
            if (!e.target.checked) return;
            try {
                const flagged = localStorage.getItem('vibesim_agentic_psa_shown');
                if (flagged) return; // already shown before
                // Show a clear PSA modal / confirm dialog
                const ok = await showDialog({
                title: 'Agentic Mode (BETA)',
                body: 'When enabled, the AI will continue working on tasks autonomously. This is experimental and may spend significantly more credits as it iterates on its own. Continue?',
                confirmText: 'Enable',
                cancelText: 'Cancel'
            });
                if (ok) {
                    // mark as shown so we don't nag again
                    localStorage.setItem('vibesim_agentic_psa_shown', '1');
                    // leave checkbox checked (user confirmed)
                } else {
                    // user declined — revert checkbox off
                    agentCheckbox.checked = false;
                }
            } catch (err) {
                // fallback: if anything goes wrong, just don't block the toggle
                console.warn('Agentic PSA error', err);
            }
        });
    })();

    // Abort / Stop Generation behavior:
    // clicking stop will signal shouldAbort=true so the current generation completes but no further agentic iterations run
    elements.abortBtn.addEventListener('click', () => {
        if (state.isProcessing) {
            state.shouldAbort = true;
            elements.abortBtn.disabled = true;
            elements.abortBtn.textContent = 'Stopping...';
            // we keep the indicator visible until the current iteration finishes
        }
    });

    // Monaco content change sync
    // handled after monaco editor initialization in loadMonaco()

    // Resizer
    let isResizing = false;
    document.getElementById('main-resizer').addEventListener('mousedown', () => isResizing = true);
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const width = window.innerWidth - e.clientX;
        if (width > 200 && width < 800) {
            elements.sidebar.style.width = `${width}px`;
        }
    });
    document.addEventListener('mouseup', () => isResizing = false);

    // Search & Replace
    document.getElementById('replace-all-btn').addEventListener('click', handleReplaceAll);

    // Save Project Button
    const topSaveBtn = document.getElementById('save-project-btn');
    if (topSaveBtn) {
        topSaveBtn.addEventListener('click', () => {
            saveProjectsToStorage(true);
        });
    }

    // Post Project Buttons
    document.getElementById('post-to-websim-btn')?.addEventListener('click', () => {
        showGuide('export');
    });

    // Open a full Post modal when clicking the main Post button in the title bar
    document.getElementById('post-project-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPostModal();
    });

    // Keep legacy direct feed button (if present) wired to post immediately for quick posting
    document.getElementById('post-to-feed-btn')?.addEventListener('click', () => {
        postProjectToCommunity();
    });

    // Preview Tools
    document.getElementById('reload-preview').addEventListener('click', updatePreview);
    document.getElementById('popout-preview').addEventListener('click', () => {
        const url = elements.previewIframe.src;
        if (url) window.open(url, '_blank');
    });

    // Fullscreen preview control (uses preview-view container)
    const fsBtn = document.getElementById('fullscreen-preview');
    if (fsBtn) {
        fsBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const container = document.getElementById('preview-view') || elements.previewIframe;
            try {
                if (document.fullscreenElement) {
                    await document.exitFullscreen();
                } else {
                    if (container.requestFullscreen) await container.requestFullscreen();
                    else if (container.webkitRequestFullscreen) await container.webkitRequestFullscreen();
                }
            } catch (err) {
                console.warn('Fullscreen request failed', err);
            }
        });
    }

    // File Menu — click + hover behavior; and project-name opens Project Manager
    const menuBtn = document.getElementById('file-menu-btn');
    const submenu = document.getElementById('file-submenu');

    // click toggles as before
    if (menuBtn) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = submenu.getAttribute('aria-hidden') === 'false';
            submenu.setAttribute('aria-hidden', String(!isOpen));
        });

        // also open submenu on hover for discoverability
        menuBtn.addEventListener('mouseenter', () => {
            submenu.setAttribute('aria-hidden', 'false');
        });
        // and close when leaving menu area
        const fileMenuEl = document.getElementById('file-menu');
        if (fileMenuEl) {
            fileMenuEl.addEventListener('mouseleave', () => {
                submenu.setAttribute('aria-hidden', 'true');
            });

            // While hovering the VibeSim title, rename the top "New Project" menu item to "Proyect Manager"
            fileMenuEl.addEventListener('mouseenter', () => {
                const newProjBtn = document.getElementById('reset-workspace');
                if (newProjBtn) {
                    newProjBtn.dataset._orig = newProjBtn.textContent;
                    newProjBtn.textContent = 'Project Manager';
                }
            });
            fileMenuEl.addEventListener('mouseleave', () => {
                const newProjBtn = document.getElementById('reset-workspace');
                if (newProjBtn && newProjBtn.dataset._orig) {
                    newProjBtn.textContent = newProjBtn.dataset._orig;
                    delete newProjBtn.dataset._orig;
                }
            });
        }
    }
    document.addEventListener('click', () => submenu.setAttribute('aria-hidden', 'true'));

    // Allow clicking project name in title bar to open the Project Manager
    const projectNameEl = document.getElementById('project-name');
    if (projectNameEl) {
        projectNameEl.style.cursor = 'pointer';
        projectNameEl.title = 'Open Project Manager';
        projectNameEl.addEventListener('click', () => {
            openProjectManager();
        });
    }

    // Settings panel controls (consent toggle)
    document.addEventListener('click', (e) => {
        // attach after DOM ready
        const saveBtn = document.getElementById('save-consent');
        const reopen = document.getElementById('reopen-privacy');
        const consentToggle = document.getElementById('consent-toggle');
        if (saveBtn && !saveBtn._vibesim_listened) {
            saveBtn._vibesim_listened = 1;
            // Save consent button: consent is enforced (no revoke/unconsent allowed).
            saveBtn.addEventListener('click', async () => {
                // Always set consent to true and persist it. Do not allow revoking from this UI.
                state.consent = true;
                try { localStorage.setItem('vibesim_consent', '1'); } catch (e) {}
                addMessage('assistant-vibe', 'Consent saved. Attempting to link your Websim account...');
                try {
                    if (window.websim && typeof window.websim.getCurrentUser === 'function') {
                        const user = await window.websim.getCurrentUser();
                        const username = user && user.username ? user.username : null;
                        if (username) {
                            const base = new URL(state.apiEndpoint).origin;
                            const res = await fetch(`${base}/api/claim-id`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ prompterId: username })
                            });
                            const data = await res.json();
                            if (data && data.success) {
                                state.prompterId = data.prompterId || username;
                                addMessage('assistant-vibe', `Linked as ${state.prompterId}.`);
                                const settingsLinked = document.getElementById('settings-linked');
                                if (settingsLinked) settingsLinked.textContent = `Linked as: ${state.prompterId}`;
                            } else {
                                addMessage('assistant-vibe', 'Link failed.');
                            }
                        } else {
                            addMessage('assistant-vibe', 'Could not detect Websim user for linking.');
                        }
                    } else {
                        addMessage('assistant-vibe', 'Websim not available in this preview; linking will occur on export.');
                    }
                } catch (err) {
                    addMessage('assistant-vibe', `Link error: ${err.message}`);
                }
                // update model menu etc.
                setupCustomDropdown();
                renderCreditsPanel();
            });
        }
        if (reopen && !reopen._vibesim_listened) {
            reopen._vibesim_listened = 1;
            reopen.addEventListener('click', (ev) => {
                ev.stopPropagation();
                // reopen the privacy modal to allow reading full policy
                const modal = document.getElementById('vibesim-privacy-modal');
                if (modal) modal.classList.add('show');
            });
        }
        // Sync toggle ui with state when settings panel appears
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel && settingsPanel.parentNode && !settingsPanel._vibesim_init) {
            settingsPanel._vibesim_init = 1;
            const ct = document.getElementById('consent-toggle');
            const linked = document.getElementById('settings-linked');
            if (ct) ct.checked = !!state.consent;
            if (linked) linked.textContent = state.prompterId ? `Linked as: ${state.prompterId}` : '';
        }
    });

    // New Project -> Open Project Manager
    document.getElementById('reset-workspace').addEventListener('click', () => {
        openProjectManager();
    });

    // Enhanced ZIP Export using JSZip - attempt dynamic loading/fallbacks for reliability
    document.getElementById('export-zip').addEventListener('click', async () => {
        try {
            addMessage('assistant-vibe', 'Preparing ZIP export...');
            try {
                await ensureJSZip();
            } catch (errLoad) {
                throw new Error('JSZip library not loaded. ' + errLoad.message);
            }

            const zip = new JSZip();

            // Helper: convert various stored forms into a Blob or string
            async function fileToPayload(file) {
                // 1) If explicit blobUrl (uploaded), fetch it as blob
                if (file.blobUrl && typeof file.blobUrl === 'string') {
                    try {
                        const resp = await fetch(file.blobUrl);
                        if (resp.ok) return await resp.blob();
                    } catch (e) {
                        console.warn('Failed to fetch blobUrl for export', e);
                    }
                }

                // 2) If content is a data: URL (binary), fetch it via fetch(new Request(dataUrl)) which returns a blob
                if (typeof file.content === 'string' && file.content.trim().startsWith('data:')) {
                    try {
                        const resp = await fetch(file.content);
                        if (resp.ok) return await resp.blob();
                    } catch (e) {
                        console.warn('Failed to convert data URL to blob for export', e);
                    }
                }

                // 3) If content uses the import wrapper "/* binary data url */\n<data...>", extract and fetch it
                if (typeof file.content === 'string' && file.content.startsWith('/* binary data url */')) {
                    try {
                        const dataUrl = file.content.split('\n').slice(1).join('\n').trim();
                        if (dataUrl.startsWith('data:')) {
                            const resp = await fetch(dataUrl);
                            if (resp.ok) return await resp.blob();
                        }
                    } catch (e) {
                        console.warn('Failed to extract wrapped data URL for export', e);
                    }
                }

                // 4) If content looks like a long base64 string without a data: prefix, attempt to convert it to a blob using the path's extension to pick a mime
                if (typeof file.content === 'string') {
                    const maybe = file.content.replace(/\s/g, '');
                    if (/^[A-Za-z0-9+/=]{100,}$/.test(maybe)) {
                        try {
                            const byteString = atob(maybe);
                            const len = byteString.length;
                            const u8 = new Uint8Array(len);
                            for (let i = 0; i < len; i++) u8[i] = byteString.charCodeAt(i);
                            return new Blob([u8], { type: 'application/octet-stream' });
                        } catch (e) {
                            // fall through to treat as text
                        }
                    }
                }

                // 5) Fallback: treat as text (string). Ensure we always provide a string for textual files.
                return typeof file.content === 'string' ? file.content : String(file.content || '');
            }

            // Add files to the zip using the vibesimToBlob helper (ensuring binary assets are preserved)
            const entries = Object.entries(state.files || {});
            for (const [path, file] of entries) {
                try {
                    const blob = await vibesimToBlob(file, path);
                    zip.file(path, blob);
                } catch (e) {
                    console.warn('Failed to add file to zip, adding as text fallback:', path, e);
                    zip.file(path, typeof file.content === 'string' ? file.content : '');
                }
            }

            // Generate the zip blob
            const content = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });

            // Create download link
            const blobUrl = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${state.projects[state.currentProjectId]?.name || 'vibe-project'}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Cleanup
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            addMessage('assistant-vibe', `Successfully exported ${state.projects[state.currentProjectId]?.name}.zip!`);
        } catch (err) {
            console.error('ZIP export failed:', err);
            addMessage('assistant-vibe', `ZIP export failed: ${err.message}`);
            alert('ZIP export failed: ' + err.message + '\nTry again when online or check console for details.');
        }
    });

    // Upload / Import files (from menu or Files tab)
    const uploadMenuBtn = document.getElementById('upload-files');
    const importBtn = document.getElementById('import-files-btn');
    const importInput = document.getElementById('import-files-input');

    if (uploadMenuBtn) {
        uploadMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (importInput) importInput.click();
            // keep project manager open if user wants it
            openProjectManager();
        });
    }

    if (importBtn) {
        importBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (importInput) importInput.click();
            // ensure Files panel is visible
            state.activePanel = 'explorer';
            state.sidebarOpen = true;
            updateSidebar();
        });
    }

    if (importInput) {
        importInput.addEventListener('change', async (ev) => {
            const files = Array.from(ev.target.files || []);
            if (!files.length) return;
            await handleImportedFiles(files);
            importInput.value = '';
        });
    }

    // Restore and fix File Explorer buttons
    document.getElementById('new-file-btn').addEventListener('click', () => {
        const name = prompt("New File Name (e.g. style.css):", "script.js");
        if (name) {
            if (state.files[name]) {
                alert("File already exists!");
                return;
            }
            state.files[name] = { content: '', language: getLang(name) };
            renderFileTree();
            openFile(name);
            saveProjectsToStorage();
        }
    });

    document.getElementById('new-folder-btn').addEventListener('click', () => {
        const name = prompt("New Folder Path (e.g. components/):", "assets/");
        if (name) {
            const folderPath = name.endsWith('/') ? name : name + '/';
            // In a flat file structure, we just create a placeholder file
            const placeholder = folderPath + '.keep';
            state.files[placeholder] = { content: '', language: 'plaintext' };
            renderFileTree();
            saveProjectsToStorage();
            addMessage('assistant-vibe', `Created folder structure: ${folderPath}`);
        }
    });

    // Make the "Read Policy" / "Reopen Privacy" button reliably open the privacy modal.
    // Use direct binding so the button works even if earlier delegated handlers missed it.
    const reopenBtn = document.getElementById('reopen-privacy');
    if (reopenBtn && !reopenBtn._vibesim_direct) {
        reopenBtn._vibesim_direct = 1;
        reopenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // If modal already exists, show it; otherwise create by calling showPrivacyAgreement()
            const existing = document.getElementById('vibesim-privacy-modal');
            if (existing) {
                existing.classList.add('show');
                // ensure the agree button state reflects current checkbox
                const cb = existing.querySelector('#vibesim-privacy-accept');
                const agreeBtn = existing.querySelector('#vibesim-privacy-accept-btn');
                if (cb && agreeBtn) agreeBtn.disabled = !cb.checked;
            } else {
                // showPrivacyAgreement constructs and displays the modal
                showPrivacyAgreement();
            }
        });
    }
}

/**
 * Ensure JSZip is available in the page by checking global JSZip and attempting to load
 * from alternative CDNs if missing. Returns when JSZip is ready or throws after attempts.
 */
async function ensureJSZip(timeout = 10000) {
    // Fast-path if already present
    if (typeof JSZip !== 'undefined') return JSZip;

    // 1) Try modern ESM import (works in module-capable browsers and avoids AMD/RequireJS conflicts)
    try {
        // try pinning to a known ESM source
        const esmSrc = 'https://esm.sh/jszip@3.10.1';
        const mod = await Promise.race([
            import(esmSrc),
            new Promise((_, rej) => setTimeout(() => rej(new Error('ESM import timeout')), Math.min(timeout, 5000)))
        ]);
        // module may export default or named JSZip
        const maybe = mod && (mod.default || mod.JSZip || mod);
        if (maybe) {
            // attach to global so rest of app can use JSZip as expected
            window.JSZip = maybe.JSZip ? maybe.JSZip : maybe;
            return window.JSZip;
        }
    } catch (e) {
        console.warn('ESM import for JSZip failed, falling back to script injection:', e);
    }

    // 2) Fallback: inject UMD script but avoid AMD anonymous-define conflict by temporarily undefining window.define
    const sources = [
        'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
        'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    ];

    for (const src of sources) {
        try {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                let done = false;
                s.src = src;
                s.async = true;

                // Preserve any existing AMD define to restore later
                const hadDefine = typeof window.define !== 'undefined';
                const savedDefine = window.define;

                // Temporarily disable AMD define to avoid "anonymous define" collisions with RequireJS/Monaco
                try { window.define = undefined; } catch (err) { /* ignore if strict */ }

                s.onload = () => {
                    // restore define
                    try { window.define = savedDefine; } catch (err) { /* ignore */ }
                    if (!done) { done = true; resolve(); }
                };
                s.onerror = (e) => {
                    try { window.define = savedDefine; } catch (err) { /* ignore */ }
                    if (!done) { done = true; reject(new Error('Failed to load ' + src)); }
                };
                document.head.appendChild(s);

                // safety timeout
                setTimeout(() => {
                    if (!done) {
                        try { window.define = savedDefine; } catch (err) { /* ignore */ }
                        done = true;
                        reject(new Error('Timeout loading ' + src));
                    }
                }, Math.min(timeout, 8000));
            });

            // check for global
            if (typeof JSZip !== 'undefined') return JSZip;
            if (window.JSZip) return window.JSZip;
        } catch (e) {
            console.warn('ensureJSZip load failed for', src, e);
            // try next source
        }
    }

    throw new Error('JSZip library not available (all sources failed). Check your internet or use an offline environment.');
}

/* Add file-import handler (reads File objects and stores them into state.files)
   Improved: detect audio and other binary files and read them as Data URLs (FileReader)
   to avoid injecting binary text into Monaco (prevents mp3 gibberish appearing in editor).
*/
async function handleImportedFiles(fileList) {
    if (!fileList || !fileList.length) return;

    function readAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    for (const file of fileList) {
        try {
            // Determine if file is likely text or binary.
            const mime = file.type || '';
            const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
            const binaryLike = (
                // audio / image / video / font / zip / octet-stream are binary-like
                mime.startsWith('audio/') ||
                mime.startsWith('image/') ||
                mime.startsWith('video/') ||
                mime === 'application/zip' ||
                mime === 'application/octet-stream' ||
                ['mp3','wav','ogg','flac','png','jpg','jpeg','gif','webp','mp4','mov','zip','woff','woff2','ttf'].includes(ext)
            );

            const relative = file.webkitRelativePath && file.webkitRelativePath.length ? file.webkitRelativePath : file.name;
            let path = relative.replace(/^\/+/, '');
            if (state.files[path]) {
                // append timestamp to avoid accidental overwrite
                const dot = path.lastIndexOf('.');
                const base = dot > 0 ? path.slice(0, dot) : path;
                const extname = dot > 0 ? path.slice(dot) : '';
                path = `${base}_${Date.now()}${extname}`;
            }

            if (binaryLike) {
                // Read binary-like files as data URLs to provide a safe preview and avoid raw binary text in the editor.
                const dataUrl = await readAsDataURL(file);
                // Store as dataUrl explicitly so previews and editor know it's not text
                state.files[path] = { content: dataUrl, language: 'binary', blobUrl: dataUrl };
                addMessage('assistant-vibe', `Imported (binary): ${path}`);
            } else {
                // For text-like files, prefer .text()
                const text = await file.text();
                state.files[path] = { content: text, language: getLang(path) || 'plaintext' };
                addMessage('assistant-vibe', `Imported: ${path}`);
            }
        } catch (e) {
            // As a final fallback, attempt DataURL read
            try {
                const data = await new Promise((res, rej) => {
                    const reader = new FileReader();
                    reader.onload = () => res(reader.result);
                    reader.onerror = rej;
                    reader.readAsDataURL(file);
                });
                const relative = file.webkitRelativePath && file.webkitRelativePath.length ? file.webkitRelativePath : file.name;
                const path = relative.replace(/^\/+/, '');
                state.files[path] = { content: `/* binary data url */\n${data}`, language: getLang(path) || 'plaintext' };
                addMessage('assistant-vibe', `Imported (binary fallback): ${path}`);
            } catch (err) {
                console.warn('Import failed for', file.name, err);
                addMessage('assistant-vibe', `Failed to import: ${file.name}`);
            }
        }
    }

    // reflect changes in UI
    renderFileTree();
    saveProjectsToStorage();
    updatePreview();

    // open first imported file if any (prefer non-binary first)
    const importedPaths = Object.keys(state.files).slice(-fileList.length);
    if (importedPaths.length) {
        // prefer opening a textual file if present
        const textFile = importedPaths.find(p => !/^\/?(.+)\n?$/ || !/^\/?(.+)\n?$/) || importedPaths[0];
        openFile(importedPaths[0]);
    }
}

function setupCustomDropdown() {
    const trigger = document.getElementById('model-trigger');
    const menu = document.getElementById('model-menu');
    const nameSpan = document.getElementById('selected-model-name');

    function refreshModelOptions() {
        menu.innerHTML = '';

        // Sort models by cost descending (most to least expensive). Treat missing cost as 0.
        const sorted = (state.availableModels || []).slice().sort((a, b) => {
            const ca = typeof a.cost === 'number' ? a.cost : Number(a.cost) || 0;
            const cb = typeof b.cost === 'number' ? b.cost : Number(b.cost) || 0;
            return cb - ca;
        });

        sorted.forEach(model => {
            // Respect consent: if user hasn't consented, hide paid/cloud models
            if (!state.consent && model.cost > 0) return;

            const opt = document.createElement('div');
            opt.className = `dropdown-option ${state.currentModel === model.id ? 'selected' : ''}`;
            opt.dataset.value = model.id;
            opt.dataset.cost = model.cost;

            const left = document.createElement('div');
            left.style.display = 'flex';
            left.style.flexDirection = 'column';
            left.style.justifyContent = 'center';
            left.style.gap = '4px';

            // mark recommended models with a small badge
            const recommended = ['gemini-2.5-flash', 'glm-4.7', 'glm-5'].includes(model.id);
            const badgeHtml = recommended ? `<span style="background:rgba(59,130,246,0.08);color:#3b82f6;font-weight:700;font-size:10px;padding:2px 6px;border-radius:6px;margin-left:8px;">Recommended</span>` : '';

            left.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
                                  <span style="font-weight:600">${escapeHtml(model.name)}</span>
                                  ${badgeHtml}
                              </div>
                              <div style="font-size:10px;color:#8b98a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">
                                  Context: ${escapeHtml(String(formatContextAsKTokens(model.maxContext ?? '—')))}
                              </div>`;
            
            if (model.info) {
                const infoIcon = document.createElement('span');
                infoIcon.className = 'info-icon';
                infoIcon.dataset.tooltip = model.info;
                infoIcon.innerHTML = 'ⓘ';

                // show a floating tooltip appended to body to avoid clipping by the dropdown container
                let tipEl = null;
                const showTip = (ev) => {
                    // create tooltip element if missing
                    if (!tipEl) {
                        tipEl = document.createElement('div');
                        tipEl.className = 'vibesim-floating-tooltip';
                        tipEl.textContent = model.info;
                        document.body.appendChild(tipEl);
                    } else {
                        tipEl.textContent = model.info;
                    }

                    // position tooltip near the icon, prefer to the right but flip if near viewport edge
                    const rect = infoIcon.getBoundingClientRect();
                    const margin = 10;
                    const preferredLeft = rect.right + margin;
                    const preferredTop = rect.top + rect.height / 2;
                    // compute width/height after placing offscreen to measure
                    tipEl.style.left = '0px';
                    tipEl.style.top = '-9999px';
                    tipEl.classList.add('show');

                    // measure
                    const tipRect = tipEl.getBoundingClientRect();
                    let left = preferredLeft;
                    let top = preferredTop - tipRect.height / 2;

                    // If tooltip would overflow right edge, place it to the left of the icon
                    if (left + tipRect.width + 8 > window.innerWidth) {
                        left = rect.left - margin - tipRect.width;
                    }
                    // Clamp top within viewport
                    if (top < 8) top = 8;
                    if (top + tipRect.height > window.innerHeight - 8) top = window.innerHeight - tipRect.height - 8;

                    tipEl.style.left = `${Math.round(left)}px`;
                    tipEl.style.top = `${Math.round(top)}px`;
                    tipEl.style.transform = 'translateY(0)';
                };

                const hideTip = () => {
                    if (!tipEl) return;
                    tipEl.classList.remove('show');
                    // give transition a moment, then remove to keep DOM tidy
                    setTimeout(() => {
                        try { if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl); } catch(e){}
                        tipEl = null;
                    }, 180);
                };

                // Attach mouseenter/mouseleave and focus/blur for accessibility
                infoIcon.addEventListener('mouseenter', showTip);
                infoIcon.addEventListener('mouseleave', hideTip);
                infoIcon.addEventListener('focus', showTip);
                infoIcon.addEventListener('blur', hideTip);

                // For touch devices: tap toggles tooltip (short-lived)
                infoIcon.addEventListener('touchstart', (ev) => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    if (!tipEl) showTip(ev);
                    else hideTip();
                }, { passive: false });

                left.appendChild(infoIcon);
            }

            const right = document.createElement('span');
            right.className = 'cost-tag';
            // show float-friendly cost (remove trailing .0 if integer)
            const costNum = typeof model.cost === 'number' ? model.cost : (parseFloat(model.cost) || 0);
            right.textContent = `${Number.isInteger(costNum) ? costNum : costNum.toFixed(1)} credit${costNum === 1 ? '' : 's'}`;

            opt.appendChild(left);
            opt.appendChild(right);

            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!state.consent && model.cost > 0) {
                    addMessage('assistant-vibe', 'Cloud models require consent. Use Settings to agree.');
                    menu.classList.remove('show');
                    return;
                }
                state.currentModel = model.id;
                nameSpan.textContent = model.name;
                menu.classList.remove('show');
                // update selection visuals without recreating all listeners
                refreshModelOptions();
            });

            menu.appendChild(opt);
        });

        // Ensure current selected model name is correct
        const active = (state.availableModels || []).find(m => m.id === state.currentModel);
        if (active) nameSpan.textContent = active.name;

        // Append a small tips/footer to help users choose models
        // Avoid duplicating if it's already present
        if (!menu.querySelector('.model-picker-tips')) {
            const tipDiv = document.createElement('div');
            tipDiv.className = 'model-picker-tips';
            tipDiv.style.padding = '10px 12px';
            tipDiv.style.marginTop = '6px';
            tipDiv.style.borderTop = '1px solid rgba(255,255,255,0.03)';
            tipDiv.style.fontSize = '11px';
            tipDiv.style.color = '#9aa6b2';
            tipDiv.style.lineHeight = '1.4';
            tipDiv.innerHTML = `<strong style="color:#e6eef8;display:block;margin-bottom:6px">Model tips</strong>
                GLM, Gemini and Llama families generally offer the highest chance of success for code and project tasks; if you run into issues, try switching among them. Note: on rare occasions some model endpoints may experience downtime or degraded performance — switching models can help while services recover.`;
            menu.appendChild(tipDiv);
        }
    }

    trigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.dropdown-menu').forEach(m => m !== menu && m.classList.remove('show'));
        refreshModelOptions();
        // ensure menu is visible and fits on screen; CSS now limits height and enables scroll
        menu.classList.toggle('show');
    };

    // close menus when clicking outside
    document.addEventListener('click', () => menu.classList.remove('show'));
    refreshModelOptions();
}

function setupAbilitiesDropdown() {
    const trigger = document.getElementById('abilities-trigger');
    const menu = document.getElementById('abilities-menu');
    const options = menu.querySelectorAll('.dropdown-checkbox-option');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.dropdown-menu').forEach(m => m !== menu && m.classList.remove('show'));
        menu.classList.toggle('show');
    });

    options.forEach(opt => {
        const checkbox = opt.querySelector('input');
        const ability = opt.dataset.ability;
        
        // Sync initial state
        if (state.abilities[ability]) {
            checkbox.checked = true;
            opt.classList.add('enabled');
        }

        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target && e.target.closest && e.target.closest('a')) return;
            
            const newValue = !checkbox.checked;
            checkbox.checked = newValue;
            state.abilities[ability] = newValue;
            
            if (newValue) {
                opt.classList.add('enabled');
                addMessage('assistant-vibe', `Ability Enabled: ${ability.replace('_', ' ')}`);
            } else {
                opt.classList.remove('enabled');
            }
            saveProjectsToStorage();
        });
    });

    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => menu.classList.remove('show'));
}

function setupProjectManager() {
    const modal = document.createElement('div');
    modal.id = 'project-manager-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="project-modal fullscreen-home">
            <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between; padding: 12px 24px; border-bottom: 1px solid #222; background: #0d0d0d;">
                <div style="display:flex; align-items:center; gap: 24px;">
                    <span style="font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -0.5px;">vibesim</span>
                    <div style="position: relative; width: 400px;">
                        <input type="text" id="project-search" placeholder="Search community..." style="width: 100%; background: #1a1a1a; border: 1px solid #333; border-radius: 999px; padding: 8px 16px 8px 40px; color: #fff; font-size: 14px; outline: none;">
                        <svg style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: #666;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    </div>
                </div>
                <div style="display:flex; gap: 12px; align-items:center;">
                    <button id="import-websim-guide" class="btn-secondary">Import Guide</button>
                    <button id="export-websim-guide" class="btn-secondary">Export Guide</button>
                    <button class="btn-primary" id="open-create-popup">Create</button>
                </div>
            </div>

            <div class="modal-tabs" style="padding: 0 24px; background: #0d0d0d;">
                <div class="modal-tab-btn active" data-tab="homepage">Homepage</div>
                <div class="modal-tab-btn" data-tab="projects">My Projects</div>
                <div class="modal-tab-btn" data-tab="templates">Templates</div>
            </div>

            <div id="modal-homepage" class="flex-1 overflow-auto bg-[#070707]">
                <div class="carousel-container">
                    <h2 class="text-sm font-bold text-gray-400 mb-4 uppercase tracking-widest">Recent Projects</h2>
                    <div id="homepage-carousel" class="carousel-track"></div>
                </div>
                <div class="p-6">
                    <div class="flex items-center justify-between mb-6">
                        <h2 class="text-xl font-bold">Community Feed</h2>
                        <div class="flex gap-2">
                            <button id="feed-filter-hot" class="btn-secondary active">Hot</button>
                            <button id="feed-filter-new" class="btn-secondary">New</button>
                        </div>
                    </div>
                    <div id="community-feed-grid" class="feed-grid p-0"></div>
                </div>
            </div>

            <div class="project-list websim-grid hidden" id="modal-project-list" style="flex: 1; overflow-y: auto;"></div>

            <div class="template-grid websim-grid hidden" id="modal-template-grid" style="flex: 1; overflow-y: auto;">
                <div class="col-span-full flex justify-between items-center mb-4">
                    <div class="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Community Templates</div>
                    <button id="upload-template-btn" class="btn-secondary" style="font-size: 11px; padding: 6px 12px; border-radius: 6px;">Upload Template</button>
                </div>
                <div id="template-catalog-inner" class="col-span-full grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);



    // Open a separate Create Project popup (new UX)
    document.getElementById('open-create-popup').addEventListener('click', () => {
        openCreateProjectPopup();
    });

    // Tab switching (homepage/projects/templates)
    modal.querySelectorAll('.modal-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            modal.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.getElementById('modal-homepage').classList.toggle('hidden', tab !== 'homepage');
            document.getElementById('modal-project-list').classList.toggle('hidden', tab !== 'projects');
            document.getElementById('modal-template-grid').classList.toggle('hidden', tab !== 'templates');
            if (tab === 'homepage') renderHomepage();
            else if (tab === 'projects') renderProjectList();
            else if (tab === 'templates') renderTemplateGrid();
        });
    });

    // Feed filter buttons (Hot / New) - ensure they toggle and visually indicate active state
    const feedHotBtn = modal.querySelector('#feed-filter-hot');
    const feedNewBtn = modal.querySelector('#feed-filter-new');
    function setFeedFilter(mode) {
        if (feedHotBtn) feedHotBtn.classList.toggle('active', mode === 'hot');
        if (feedNewBtn) feedNewBtn.classList.toggle('active', mode === 'new');
        // re-render feed with new order
        renderCommunityFeed();
    }
    if (feedHotBtn) {
        feedHotBtn.addEventListener('click', (e) => { e.preventDefault(); setFeedFilter('hot'); });
    }
    if (feedNewBtn) {
        feedNewBtn.addEventListener('click', (e) => { e.preventDefault(); setFeedFilter('new'); });
    }

    // Upload Template button behavior — open a modal using the same modal-overlay system
    document.getElementById('upload-template-btn')?.addEventListener('click', () => {
        // if modal already exists, show it
        if (document.getElementById('template-upload-modal')) {
            document.getElementById('template-upload-modal').classList.add('show');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'template-upload-modal';
        modal.className = 'modal-overlay show';
        modal.style.zIndex = 4200;
        modal.innerHTML = `
            <div class="project-modal" style="max-width:720px;">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
                    <span>Upload Template</span>
                    <button id="template-upload-close" class="btn-secondary">Close</button>
                </div>
                <div style="padding:16px;color:#cbd5e1;">
                    <label style="display:block;font-weight:700;margin-bottom:8px">Template Name</label>
                    <input id="template-name-input" type="text" placeholder="My cool template" style="width:100%;padding:10px;border-radius:8px;border:1px solid #222;background:#0b0b0b;color:#e6eef8;margin-bottom:12px">
                    <label style="display:block;font-weight:700;margin-bottom:8px">Description (optional)</label>
                    <textarea id="template-desc-input" rows="3" placeholder="Brief description" style="width:100%;padding:10px;border-radius:8px;border:1px solid #222;background:#0b0b0b;color:#e6eef8;margin-bottom:12px"></textarea>
                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                        <div>
                            <label style="display:block;font-weight:700;margin-bottom:6px">Upload Files</label>
                            <input id="template-files-input" type="file" multiple webkitdirectory directory style="display:block;color:#e6eef8;" />
                            <div style="font-size:12px;color:#9aa6b2;margin-top:8px">Select files or a folder; supported: code files and images. You may also upload a .zip file below.</div>
                        </div>
                        <div>
                            <label style="display:block;font-weight:700;margin-bottom:6px">Or Upload ZIP</label>
                            <input id="template-zip-input" type="file" accept=".zip" style="display:block;color:#e6eef8;" />
                        </div>
                    </div>
                    <div id="template-upload-feedback" style="margin-top:12px;font-size:13px;color:#9aa6b2"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" id="template-upload-cancel">Cancel</button>
                    <button class="btn-primary" id="template-upload-confirm" disabled>Create Template</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const nameInput = modal.querySelector('#template-name-input');
        const descInput = modal.querySelector('#template-desc-input');
        const filesInput = modal.querySelector('#template-files-input');
        const zipInput = modal.querySelector('#template-zip-input');
        const feedback = modal.querySelector('#template-upload-feedback');
        const confirmBtn = modal.querySelector('#template-upload-confirm');
        const cancelBtn = modal.querySelector('#template-upload-cancel');
        const closeBtn = modal.querySelector('#template-upload-close');

        function updateConfirmState() {
            confirmBtn.disabled = !nameInput.value.trim() || (!(filesInput.files && filesInput.files.length) && !(zipInput.files && zipInput.files.length));
        }

        nameInput.addEventListener('input', updateConfirmState);
        filesInput.addEventListener('change', updateConfirmState);
        zipInput.addEventListener('change', updateConfirmState);

        closeBtn.addEventListener('click', () => modal.remove());
        cancelBtn.addEventListener('click', () => modal.remove());

        // Helper to read File objects into the template.files map
        async function readFilesFromFileList(fileList) {
            const files = {};
            for (const f of Array.from(fileList)) {
                try {
                    // if zip, skip here
                    if (f.name && f.name.toLowerCase().endsWith('.zip')) continue;
                    const relative = f.webkitRelativePath && f.webkitRelativePath.length ? f.webkitRelativePath : f.name;
                    const text = await (f.text ? f.text() : (new Response(f).text()));
                    files[relative.replace(/^\/+/, '')] = { content: text, language: getLang(relative) };
                } catch (e) {
                    // fallback to dataURL for binaries (images)
                    try {
                        const data = await new Promise((res, rej) => {
                            const reader = new FileReader();
                            reader.onload = () => res(reader.result);
                            reader.onerror = rej;
                            reader.readAsDataURL(f);
                        });
                        const relative = f.webkitRelativePath && f.webkitRelativePath.length ? f.webkitRelativePath : f.name;
                        files[relative.replace(/^\/+/, '')] = { content: `/* binary data url */\n${data}`, language: getLang(relative) || 'plaintext' };
                    } catch (err) {
                        console.warn('Failed to read file', f.name, err);
                    }
                }
            }
            return files;
        }

        // handle ZIP uploads (use JSZip if available)
        async function readZipFile(zipFile) {
            if (!zipFile) return {};
            try {
                const jszip = (typeof JSZip !== 'undefined') ? JSZip : await ensureJSZip();
                const z = await jszip.loadAsync(zipFile);
                const files = {};
                const entries = Object.entries(z.files).filter(([p, e]) => !e.dir);
                for (const [path, entry] of entries) {
                    const content = await entry.async('string');
                    files[path] = { content, language: getLang(path) };
                }
                return files;
            } catch (e) {
                feedback.textContent = 'ZIP read failed. See console for details.';
                console.error('ZIP read failed', e);
                return {};
            }
        }

        confirmBtn.addEventListener('click', async () => {
            confirmBtn.disabled = true;
            feedback.textContent = 'Preparing template…';
            const tName = nameInput.value.trim();
            const tDesc = descInput.value.trim();

            let collectedFiles = {};

            // Prefer ZIP if provided
            if (zipInput.files && zipInput.files.length) {
                const zFiles = await readZipFile(zipInput.files[0]);
                Object.assign(collectedFiles, zFiles);
            }

            if (filesInput.files && filesInput.files.length) {
                const fFiles = await readFilesFromFileList(filesInput.files);
                Object.assign(collectedFiles, fFiles);
            }

            if (Object.keys(collectedFiles).length === 0) {
                feedback.textContent = 'No files found to create template.';
                confirmBtn.disabled = false;
                return;
            }

            // create a minimal template object and add to state.templates
            const tpl = {
                id: `tpl-${Date.now().toString(36).slice(2,9)}`,
                name: tName,
                description: tDesc,
                username: (window.websim && typeof window.websim.getCurrentUser === 'function') ? (await (window.websim.getCurrentUser()).then(u => u.username).catch(()=> 'you')) : 'you',
                files: collectedFiles,
                images: [], // optional
                screenshot: ''
            };

            // push to local templates list and re-render
            state.templates = state.templates || [];
            state.templates.unshift(tpl);
            feedback.textContent = 'Template created locally.';
            renderTemplateGrid();

            // close modal after short delay
            setTimeout(() => {
                try { modal.remove(); } catch (e) {}
            }, 600);
        });

        // close on outside click
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    });

    // Guide buttons — open centered modal
    const exportGuideBtn = document.getElementById('export-websim-guide');
    const importGuideBtn = document.getElementById('import-websim-guide');
    const showGuide = (type) => {
        const existing = document.getElementById('project-manager-guide-modal');
        if (existing) existing.remove();

        const m = document.createElement('div');
        m.id = 'project-manager-guide-modal';
        m.className = 'modal-overlay show';
        m.style.zIndex = 4000;
        m.innerHTML = `
            <div class="project-modal" style="max-width:720px; width: min(92vw, 720px);">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
                    <span>${type === 'export' ? 'How to export & post to Websim!' : 'How to upload your Websim project?'}</span>
                    <button id="pm-guide-close" class="btn-secondary">Close</button>
                </div>
                <div style="padding:16px; color:#cbd5e1; font-size:13px; line-height:1.45; max-height:60vh; overflow:auto">
                    ${type === 'export' ? `
                        <strong>Export to Websim — Quick Guide</strong>
                        <div style="margin-top:8px">Firstly, develop your project, then go to the Project Manager and press the Download (Export ZIP) button. Extract the files and upload them to a new Websim project.</div>
                        <div style="margin-top:8px">After uploading, prompt GPT-5 Mini: <span style="font-family:monospace;color:#d1fae5">"I uploaded all files. Fix any issues after this import, otherwise do nothing!"</span></div>
                        <div style="margin-top:8px;font-size:12px;color:#9aa6b2"><strong>Note:</strong> Please add <code>#vibesim</code> to your description to help others know where this project came from!</div>
                    ` : `
                        <strong>How to upload your Websim Project?</strong>
                        <div style="margin-top:8px">Go to the three dots on the right on any Websim project, press "Download" in the options. You'll get a ZIP file of your Websim project to upload here!</div>
                    `}
                </div>
            </div>
        `;
        document.body.appendChild(m);
        m.querySelector('#pm-guide-close').addEventListener('click', () => m.remove());
        m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    };
    if (exportGuideBtn) exportGuideBtn.onclick = () => showGuide('export');
    if (importGuideBtn) importGuideBtn.onclick = () => showGuide('import');

    // Expose showGuide globally so other modules (e.g., openPostModal) can call it
    window.showGuide = showGuide;

    // Render initial list
    renderProjectList();
}

/**
 * New: Separate Create Project popup
 * - Requires a project name before allowing creation.
 * - Offers: Blank Page, From Template (selects a template then closes), Import ZIP with feedback.
 */
function openCreateProjectPopup() {
    // avoid duplicates
    if (document.getElementById('create-project-modal')) {
        document.getElementById('create-project-modal').classList.add('show');
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'create-project-modal';
    modal.className = 'modal-overlay show';
    modal.style.zIndex = 5000;
    modal.innerHTML = `
        <div class="project-modal" style="max-width:720px; width: min(92vw,720px);">
            <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
                <span>Create Project</span>
                <button id="create-close" class="btn-secondary">Close</button>
            </div>
            <div style="padding:16px; color:#cbd5e1;">
                <label style="display:block;font-weight:700;margin-bottom:8px">Project Name</label>
                <input id="create-project-name" type="text" placeholder="My new project" style="width:100%;padding:10px;border-radius:8px;border:1px solid #222;background:#0b0b0b;color:#e6eef8;margin-bottom:12px">
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
                    <div class="creation-option" id="cp-blank" style="padding:14px">
                        <div style="font-weight:700">Blank Page</div>
                        <div style="font-size:12px;color:#888;margin-top:6px">Start from scratch</div>
                    </div>
                    <div class="creation-option" id="cp-template" style="padding:14px">
                        <div style="font-weight:700">From Template</div>
                        <div style="font-size:12px;color:#888;margin-top:6px">Choose a template</div>
                    </div>
                    <div class="creation-option" id="cp-zip" style="padding:14px">
                        <div style="font-weight:700">Import ZIP</div>
                        <div style="font-size:12px;color:#888;margin-top:6px">Upload a ZIP</div>
                    </div>
                </div>
                <div id="create-feedback" style="margin-top:12px;font-size:13px;color:#9aa6b2"></div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="create-cancel">Cancel</button>
                <button class="btn-primary" id="create-confirm" disabled>Create Project</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const nameInput = modal.querySelector('#create-project-name');
    const confirmBtn = modal.querySelector('#create-confirm');
    const cancelBtn = modal.querySelector('#create-cancel');
    const closeBtn = modal.querySelector('#create-close');
    const feedback = modal.querySelector('#create-feedback');

    // enable confirm when name entered
    nameInput.addEventListener('input', () => {
        confirmBtn.disabled = !nameInput.value.trim();
    });

    // Cancel/Close handlers
    const closeModal = () => { try { modal.remove(); } catch (e) {} };
    cancelBtn.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);

    // Blank creation
    modal.querySelector('#cp-blank').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) { feedback.textContent = 'Please enter a project name first.'; return; }
        confirmBtn.disabled = true;
        feedback.textContent = 'Creating blank project…';
        try {
            const id = `project-${Date.now()}`;
            state.projects[id] = {
                name,
                files: { 'index.html': { content: '<!doctype html><html><body><h1>New Project</h1></body></html>', language: 'html' } },
                tabs: ['index.html'],
                activeTab: 'index.html',
                screenshot: '',
                modified: true
            };
            saveProjectsToStorage();
            switchProject(id);
            showSnackbar('Project created');
            closeModal();
            // ensure Project Manager closes as well if open
            const pm = document.getElementById('project-manager-modal'); if (pm) pm.classList.remove('show');
        } catch (e) {
            feedback.textContent = 'Failed to create project.';
        } finally { confirmBtn.disabled = false; }
    });

    // From Template -> open templates tab in Project Manager and close create popup
    modal.querySelector('#cp-template').addEventListener('click', () => {
        // If templates are not loaded yet, open the manager and switch to templates
        const pm = document.getElementById('project-manager-modal');
        if (pm) {
            pm.classList.add('show');
            const btn = pm.querySelector('.modal-tab-btn[data-tab="templates"]');
            if (btn) btn.click();
        } else {
            openProjectManager();
            const pm2 = document.getElementById('project-manager-modal');
            pm2?.querySelector('.modal-tab-btn[data-tab="templates"]')?.click();
        }
        // Close this create popup
        closeModal();
        // Note: choosing a template in the templates grid will now create the project and close the manager (handled in renderTemplateGrid/create card)
    });

    // Import ZIP flow with immediate feedback and icons
    modal.querySelector('#cp-blank').innerHTML = `
        <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        <div style="font-weight:700">Blank Page</div>
        <div style="font-size:12px;color:#666;margin-top:2px">Start fresh</div>
    `;
    modal.querySelector('#cp-template').innerHTML = `
        <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"/></svg>
        <div style="font-weight:700">From Template</div>
        <div style="font-size:12px;color:#666;margin-top:2px">Use a blueprint</div>
    `;
    modal.querySelector('#cp-zip').innerHTML = `
        <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
        <div style="font-weight:700">Import ZIP</div>
        <div style="font-size:12px;color:#666;margin-top:2px">Upload workspace</div>
    `;

    modal.querySelector('#cp-zip').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) { feedback.textContent = 'Please enter a project name first.'; return; }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            feedback.textContent = 'Reading ZIP...';
            try {
                const jszip = await ensureJSZip();
                const zip = await jszip.loadAsync(file);
                const files = {};
                const fileEntries = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);
                
                for (const [path, entry] of fileEntries) {
                    feedback.textContent = `Unpacking ${path}...`;
                    files[path] = { content: await entry.async('string'), language: getLang(path) };
                }
                
                const id = `project-${Date.now()}`;
                state.projects[id] = { name, files, tabs: Object.keys(files).slice(0,3), activeTab: Object.keys(files)[0] || null, screenshot: '', modified: true };
                
                feedback.textContent = 'Syncing to cloud...';
                await switchProject(id);
                await saveProjectsToStorage(true);
                
                feedback.textContent = 'Imported successfully.';
                showSnackbar('Project imported from ZIP!');
                closeModal();
                const pm = document.getElementById('project-manager-modal'); if (pm) pm.classList.remove('show');
            } catch (err) {
                feedback.textContent = 'ZIP import failed. See console.';
                console.error('ZIP import error', err);
            }
        };
        input.click();
    });

    // Confirm main button (same as blank creation)
    confirmBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) return;
        confirmBtn.disabled = true;
        try {
            const id = `project-${Date.now()}`;
            state.projects[id] = {
                name,
                files: { 'index.html': { content: '<!doctype html><html><body><h1>New Project</h1></body></html>', language: 'html' } },
                tabs: ['index.html'],
                activeTab: 'index.html',
                screenshot: '',
                modified: true
            };
            saveProjectsToStorage();
            switchProject(id);
            showSnackbar('Project created');
            closeModal();
            const pm = document.getElementById('project-manager-modal'); if (pm) pm.classList.remove('show');
        } catch (e) {
            modal.querySelector('#create-feedback').textContent = 'Failed to create project.';
        } finally {
            confirmBtn.disabled = false;
        }
    });

    // close on outside click
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
}

/* Privacy agreement modal shown on startup; resolves when user accepts or times out (decline leaves linking disabled) */
function showPrivacyAgreement() {
    return new Promise((resolve) => {
        const existing = document.getElementById('vibesim-privacy-modal');
        if (existing) { existing.classList.add('show'); return resolve(); }

        const modal = document.createElement('div');
        modal.id = 'vibesim-privacy-modal';
        modal.className = 'modal-overlay show';
        modal.style.zIndex = 3000;
        modal.innerHTML = `
            <div class="project-modal" style="max-width:720px">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
                    <span>Privacy & Linking Agreement</span>
                </div>
                <div style="padding:16px; color:#cbd5e1; font-size:13px; line-height:1.45; max-height:60vh; overflow:auto">
                    <p>This may be boring to you, a websim user and many other people, but I used my own api and for security reasons I collect simple data to identify each user (like linking your websim user to an api account). To continue, you must read the full privacy statement below and then agree.</p>

                    <div style="margin-top:12px">
                        <label style="display:flex;align-items:center;gap:8px">
                            <input type="checkbox" id="vibesim-privacy-accept" />
                            <span>I have read and agree to the privacy policy.</span>
                        </label>
                        <div style="margin-top:8px; color:#8fbce6">
                            <a href="#" id="vibesim-privacy-readmore" style="color:#8fbce6; text-decoration:underline">Read full policy</a>
                        </div>
                    </div>

                    <div id="vibesim-privacy-full" style="display:none; margin-top:12px; padding:12px; background:#071019; border-radius:8px; border:1px solid #16212a; color:#cbd5e1; font-size:12px; white-space:pre-wrap">
Last Updated: 15/2/2026

Important note about third-party models:
Some models accessible via this service are provided by NVIDIA under a trial arrangement; NVIDIA may collect and log API success/failure metrics and portions of prompts (for quality, telemetry, and anti-abuse purposes). Do not submit any sensitive or private data to prompts intended for these models.

When you use our Service, we collect the following information:

Usage Data: We automatically collect your IP address to identify you and enforce rate limits. If you claim a websim Username, we link it to your IP address.
User Content: To function, the Service requires you to send prompts and optionally codebases. This content is necessary to generate AI responses.
Usage Statistics: We track the number of API requests you make daily and your credit balance.

2. How We Use Information

We use the collected information for the following purposes:

To Provide the Service: Your prompts and code are sent to third-party AI providers (specifically z.ai) to generate responses.
To Enforce Limits: We use your IP address and Username to track daily request quotas and credit usage.
To Award Credits: If you request credit conversion, we check your public Websim profile for eligible tip comments to award API credits.

3. Data Storage

Data is stored securely in a Cloudflare D1 Database. We retain your usage data (IP, Username, credit history) indefinitely to maintain your account state and prevent abuse.

For EU users and for API security purposes, please be advised that after a data deletion request certain technical data—specifically IP addresses used for API requests—may be retained for up to 14 days to support rate-limits and prevent abuse, in line with legitimate interests and applicable GDPR provisions.

4. Third-Party Services

We utilize third-party services to operate:

AI Processing (z.ai): Your text prompts and code snippets are transmitted to z.ai servers for processing. We do not control their data retention policies.
Websim API: We access public Websim comment data solely to verify tips for credit conversion.

5. Data Security

We implement standard security measures (CORS restrictions, sanitized inputs) to protect your data. However, no method of transmission over the Internet is 100% secure. You send code and prompts at your own risk.

6. Your Responsibilities

Do not submit sensitive personal data (passwords, API keys, PII) in your prompts or codebases.
Do not attempt to bypass rate limits or abuse the credit system.

7. Changes to This Policy

We may update this policy periodically. Continued use of the Service after changes constitutes acceptance of the new policy.

8. Contact

For questions regarding this policy, please tag @CoponStackos via a Websim comment.
                    </div>
                </div>
                <div class="modal-footer" style="display:flex;justify-content:flex-end;align-items:center">
                    <div style="display:flex;gap:8px">
                        <button class="btn-primary" id="vibesim-privacy-accept-btn" disabled>Agree & Link Account</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const checkbox = modal.querySelector('#vibesim-privacy-accept');
        const readmore = modal.querySelector('#vibesim-privacy-readmore');
        const full = modal.querySelector('#vibesim-privacy-full');
        const agreeBtn = modal.querySelector('#vibesim-privacy-accept-btn');

        readmore.addEventListener('click', (e) => {
            e.preventDefault();
            // toggle full policy visibility (checkbox is usable even if user doesn't open this)
            if (full.style.display === 'none' || full.style.display === '') {
                full.style.display = 'block';
            } else {
                full.style.display = 'none';
            }
            modal.querySelector('.modal-header').scrollIntoView({ behavior: 'smooth' });
        });

        checkbox.addEventListener('change', () => {
            agreeBtn.disabled = !checkbox.checked;
        });



        agreeBtn.addEventListener('click', async () => {
            agreeBtn.disabled = true;
            agreeBtn.textContent = 'Linking…';
            try {
                // record consent and persist it, also persist the privacy policy version agreed to
                state.consent = true;
                localStorage.setItem('vibesim_consent', '1');
                try { localStorage.setItem('vibesim_privacy_version', PRIVACY_VERSION); } catch(e){}
                state.privacyAgreedVersion = PRIVACY_VERSION;

                // attempt automatic linking: get current user from websim and call claim endpoint
                let username = null;
                try {
                    if (window.websim && typeof window.websim.getCurrentUser === 'function') {
                        const user = await window.websim.getCurrentUser();
                        username = user && user.username ? user.username : null;
                    }
                } catch (e) {
                    username = null;
                }

                if (!username) {
                    addMessage('assistant-vibe', 'Could not detect Websim user automatically. Linking skipped.');
                    modal.classList.remove('show');
                    return resolve();
                }

                const base = new URL(state.apiEndpoint).origin;
                const res = await fetch(`${base}/api/claim-id`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompterId: username })
                });
                const data = await res.json();
                if (data && data.success) {
                    state.prompterId = data.prompterId || username;
                    addMessage('assistant-vibe', `Websim account automatically linked as "${state.prompterId}".`);
                    // Update credits panel summary if already rendered
                    const summaryText = document.getElementById('credits-summary-text');
                    if (summaryText) {
                        const cur = summaryText.innerHTML || '';
                        summaryText.innerHTML = cur + `<div style="font-size:12px;color:#9aa6b2;margin-top:6px">Linked: ${escapeHtml(state.prompterId)}</div>`;
                    }
                    // show in settings if visible
                    const settingsLinked = document.getElementById('settings-linked');
                    if (settingsLinked) settingsLinked.textContent = `Linked as: ${state.prompterId}`;
                } else {
                    addMessage('assistant-vibe', `Auto-link failed: ${data && data.message ? data.message : 'unknown error'}`);
                }
            } catch (e) {
                addMessage('assistant-vibe', `Auto-link error: ${e.message}`);
            } finally {
                modal.classList.remove('show');
                resolve();
            }
        });

        // Safety timeout: if user does nothing for 2 minutes, hide modal and continue without linking
        setTimeout(() => {
            if (document.body.contains(modal)) {
                try { modal.classList.remove('show'); } catch (e) {}
                resolve();
            }
        }, 120000);
    });
}

function openProjectManager() {
    const modal = document.getElementById('project-manager-modal');
    // Pause preview immediately when opening the Project Manager
    try { pausePreview(); } catch (e) {}
    modal.classList.add('show');
    
    // Default to homepage tab
    modal.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'homepage'));
    document.getElementById('modal-homepage').classList.remove('hidden');
    document.getElementById('modal-project-list').classList.add('hidden');
    document.getElementById('modal-template-grid').classList.add('hidden');
    
    renderHomepage();
}

/* Open the Post Project modal (replaces hover dropdown) */
function openPostModal() {
    // chooser modal (Community vs Templates vs Websim) shown before the actual post modal
    // avoid duplicates
    if (document.getElementById('post-chooser-modal')) {
        document.getElementById('post-chooser-modal').classList.add('show');
        return;
    }

    const chooser = document.createElement('div');
    chooser.id = 'post-chooser-modal';
    chooser.className = 'modal-overlay show';
    chooser.style.zIndex = 5200;
    chooser.innerHTML = `
      <div class="project-modal" style="max-width:800px; width: min(92vw,800px);">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
          <span>Share Project</span>
          <button id="post-chooser-close" class="btn-secondary" style="padding:6px 10px;border-radius:8px">Close</button>
        </div>
        <div style="padding:18px; color:#cbd5e1;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div id="post-choice-community" class="creation-option" style="cursor:pointer; text-align:left; padding:18px; border-radius:12px; border:1px solid #222; background:#0b0b0b; display:flex; flex-direction:column; justify-content:space-between; gap:12px;">
                <div style="display:flex;gap:12px;align-items:center">
                  <svg style="width:36px;height:36px;color:white;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M7 8h10M7 12h6m-6 4h4"/><path d="M3 5a2 2 0 012-2h14a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" stroke-width="1.2"/></svg>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:800;font-size:14px;color:#fff;line-height:1">Community</div>
                    <div style="font-size:11px;color:#9aa6b2;margin-top:6px">Post to the feed</div>
                  </div>
                </div>
                <div style="display:flex;justify-content:flex-end">
                  <button class="creation-option-btn btn-primary" style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-radius:8px;font-weight:800;font-size:11px">
                    <span>Feed</span>
                  </button>
                </div>
            </div>

            <div id="post-choice-template" class="creation-option" style="cursor:pointer; text-align:left; padding:18px; border-radius:12px; border:1px solid #222; background:#0b0b0b; display:flex; flex-direction:column; justify-content:space-between; gap:12px;">
                <div style="display:flex;gap:12px;align-items:center">
                  <svg style="width:36px;height:36px;color:#3b82f6;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z"/></svg>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:800;font-size:14px;color:#fff;line-height:1">Template</div>
                    <div style="font-size:11px;color:#9aa6b2;margin-top:6px">Share as blueprint</div>
                  </div>
                </div>
                <div style="display:flex;justify-content:flex-end">
                  <button class="creation-option-btn btn-primary" style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-radius:8px;font-weight:800;font-size:11px">
                    <span>Post Template</span>
                  </button>
                </div>
            </div>

            <div id="post-choice-websim" class="creation-option" style="cursor:pointer; text-align:left; padding:18px; border-radius:12px; border:1px solid #222; background:#0b0b0b; display:flex; flex-direction:column; justify-content:space-between; gap:12px;">
                <div style="display:flex;gap:12px;align-items:center">
                  <svg style="width:36px;height:36px;color:#fbbf24;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 2l4 4h-3v7H11V6H8l4-4z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2" d="M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6"/></svg>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:800;font-size:14px;color:#fff;line-height:1">Websim</div>
                    <div style="font-size:11px;color:#9aa6b2;margin-top:6px">External Export</div>
                  </div>
                </div>
                <div style="display:flex;justify-content:flex-end">
                  <button class="creation-option-btn btn-secondary" style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-radius:8px;font-weight:800;font-size:11px">
                    <span>Guide</span>
                  </button>
                </div>
            </div>
          </div>
          <div id="post-chooser-note" style="margin-top:14px;font-size:12px;color:#9aa6b2">Choose how you'd like to share your project.</div>
        </div>
      </div>
    `;
    document.body.appendChild(chooser);

    const closeBtn = chooser.querySelector('#post-chooser-close');
    const communityCard = chooser.querySelector('#post-choice-community');
    const websimCard = chooser.querySelector('#post-choice-websim');

    const removeChooser = () => {
        try { chooser.remove(); } catch (e) {}
    };

    closeBtn.addEventListener('click', removeChooser);
    chooser.addEventListener('click', (ev) => { if (ev.target === chooser) removeChooser(); });

    communityCard.addEventListener('click', (e) => {
        e.stopPropagation();
        removeChooser();
        // open the original Post modal (community flow)
        showPostCommunityModal();
    });

    chooser.querySelector('#post-choice-template').addEventListener('click', (e) => {
        e.stopPropagation();
        removeChooser();
        showPostTemplateModal();
    });

    websimCard.addEventListener('click', (e) => {
        e.stopPropagation();
        removeChooser();
        // call existing guide helper without opening the Project Manager
        showGuide('export');
    });
}



/* Modal to post project as a template */
async function showPostTemplateModal() {
    if (document.getElementById('post-template-modal')) {
        document.getElementById('post-template-modal').classList.add('show');
        return;
    }

    const proj = state.projects[state.currentProjectId] || {};
    const modal = document.createElement('div');
    modal.id = 'post-template-modal';
    modal.className = 'modal-overlay show';
    modal.style.zIndex = 5200;
    modal.innerHTML = `
      <div class="project-modal" style="max-width:720px; width: min(92vw,720px);">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
          <span>Post as Community Template</span>
        </div>
        <div style="padding:16px; color:#cbd5e1;">
          <label style="display:block;font-weight:700;margin-bottom:6px">Template Name</label>
          <input id="tpl-title-input" type="text" placeholder="Template title" style="width:100%;padding:10px;border-radius:8px;border:1px solid #222;background:#0b0b0b;color:#e6eef8;margin-bottom:12px">
          <label style="display:block;font-weight:700;margin-bottom:6px">Description (optional)</label>
          <textarea id="tpl-desc-input" rows="4" placeholder="What is this template for?" style="width:100%;padding:10px;border-radius:8px;border:1px solid #222;background:#0b0b0b;color:#e6eef8;margin-bottom:12px"></textarea>
          <div id="tpl-modal-feedback" style="margin-top:12px;font-size:13px;color:#9aa6b2"></div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:12px;padding:16px;border-top:1px solid #262626">
            <button class="btn-secondary" id="tpl-cancel">Cancel</button>
            <button class="btn-primary" id="tpl-confirm">Post Template</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const titleInput = modal.querySelector('#tpl-title-input');
    const descInput = modal.querySelector('#tpl-desc-input');
    const confirmBtn = modal.querySelector('#tpl-confirm');
    const feedback = modal.querySelector('#tpl-modal-feedback');

    titleInput.value = proj.name || '';
    
    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        feedback.textContent = 'Uploading template assets...';
        try {
            const user = (window.websim && typeof window.websim.getCurrentUser === 'function') ? (await window.websim.getCurrentUser()) : { username: 'unknown' };
            const screenshot = await takeScreenshot();
            
            const uploadedFiles = {};
            for (const [path, f] of Object.entries(proj.files || {})) {
                if (f.blobUrl) uploadedFiles[path] = { blobUrl: f.blobUrl };
                else uploadedFiles[path] = { content: f.content || '' };
            }

            if (state.room && typeof state.room.collection === 'function') {
                await state.room.collection('template_v1').create({
                    name: titleInput.value.trim(),
                    description: descInput.value.trim(),
                    username: user.username,
                    files: uploadedFiles,
                    screenshot: screenshot,
                    images: [screenshot],
                    created_at: new Date().toISOString()
                });
                showSnackbar('Template posted successfully!');
                modal.remove();
            } else {
                throw new Error('Room not available for posting templates.');
            }
        } catch (err) {
            console.error('Template post failed', err);
            feedback.textContent = 'Failed to post template: ' + err.message;
            confirmBtn.disabled = false;
        }
    });

    modal.querySelector('#tpl-cancel').onclick = () => modal.remove();
    modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove(); });
}

/* The original Post Project modal extracted into a separate function so the chooser can call it */
function showPostCommunityModal() {
    // prevent duplicates
    if (document.getElementById('post-project-modal')) {
        document.getElementById('post-project-modal').classList.add('show');
        return;
    }

    // detect whether current project already has an associated community post
    const proj = state.projects[state.currentProjectId] || {};
    const existingPostId = proj.postId || null;

    const modal = document.createElement('div');
    modal.id = 'post-project-modal';
    modal.className = 'modal-overlay show';
    modal.style.zIndex = 5200;
    modal.innerHTML = `
      <div class="project-modal" style="max-width:720px; width: min(92vw,720px);">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
          <span id="post-modal-title">${existingPostId ? 'Update Project Version on Vibesim' : 'Post Project to Community'}</span>
        </div>
        <div style="padding:16px; color:#cbd5e1;">
          <label style="display:block;font-weight:700;margin-bottom:6px">Title</label>
          <input id="post-title-input" type="text" placeholder="Project title" style="width:100%;padding:10px;border-radius:8px;border:1px solid #222;background:#0b0b0b;color:#e6eef8;margin-bottom:12px">
          <label style="display:block;font-weight:700;margin-bottom:6px">Description (optional)</label>
          <textarea id="post-desc-input" rows="4" placeholder="Short description" style="width:100%;padding:10px;border-radius:8px;border:1px solid #222;background:#0b0b0b;color:#e6eef8;margin-bottom:12px"></textarea>
          <label style="display:block;font-weight:700;margin-bottom:6px">Thumbnail (optional)</label>
          <div style="display:flex;gap:12px;align-items:center">
            <input id="post-thumb-input" type="file" accept="image/*" style="color:#e6eef8" />
            <div id="post-thumb-preview" style="width:120px;height:68px;background:#0b0b0b;border:1px solid #222;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px">No preview</div>
          </div>
          <div id="post-modal-feedback" style="margin-top:12px;font-size:13px;color:#9aa6b2"></div>
          <div id="post-update-note" style="margin-top:10px;font-size:12px;color:#9aa6b2;display:${existingPostId ? 'block' : 'none'}">
            A new version of your project will be posted to Vibesim — previous likes, comments and metadata will be preserved when possible. You can edit title/description/thumbnail before updating.
          </div>
        </div>
        <div class="modal-footer">
            <button class="btn-secondary" id="post-cancel">Cancel</button>
            <button class="btn-primary" id="post-confirm">${existingPostId ? 'Update' : 'Post'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const cancelBtn = modal.querySelector('#post-cancel');
    const confirmBtn = modal.querySelector('#post-confirm');
    const titleInput = modal.querySelector('#post-title-input');
    const descInput = modal.querySelector('#post-desc-input');
    const thumbInput = modal.querySelector('#post-thumb-input');
    const preview = modal.querySelector('#post-thumb-preview');
    const feedback = modal.querySelector('#post-modal-feedback');
    const modalTitle = modal.querySelector('#post-modal-title');

    // Prefill with existing post data when updating
    if (existingPostId && state.communityPosts) {
        const post = state.communityPosts.find(p => String(p.id) === String(existingPostId));
        if (post) {
            titleInput.value = post.title || proj.name || '';
            descInput.value = post.description || '';
            if (post.thumbnail) {
                preview.style.backgroundImage = `url(${post.thumbnail})`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
                preview.textContent = '';
            } else if (proj.screenshot) {
                preview.style.backgroundImage = `url(${proj.screenshot})`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
                preview.textContent = '';
            }
        } else {
            // fallback to project fields
            titleInput.value = proj.name || '';
            descInput.value = '';
            if (proj.screenshot) {
                preview.style.backgroundImage = `url(${proj.screenshot})`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
                preview.textContent = '';
            }
        }
    } else {
        // new post: prefill from project metadata if available
        titleInput.value = (proj && proj.name) ? proj.name : '';
        descInput.value = '';
        if (proj && proj.screenshot) {
            preview.style.backgroundImage = `url(${proj.screenshot})`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
            preview.textContent = '';
        }
    }

    // Initialize confirm button state immediately so "Update" flows are actionable without user edits
    try { if (typeof updateConfirmState === 'function') updateConfirmState(); } catch (e) {}

    function updateConfirmState(){ confirmBtn.disabled = !titleInput.value.trim(); }
    titleInput.addEventListener('input', updateConfirmState);
    descInput.addEventListener('input', updateConfirmState);

    // handle image preview
    thumbInput.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) { preview.textContent = 'No preview'; preview.style.backgroundImage = ''; preview._file = null; return; }
        try {
            const url = URL.createObjectURL(f);
            preview.style.backgroundImage = `url(${url})`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
            preview.textContent = '';
            preview._file = f; // store file for use on confirm
        } catch (err) {
            preview.textContent = 'Preview error';
            console.warn('Thumbnail preview failed', err);
        }
    });

    cancelBtn.addEventListener('click', () => modal.remove());

    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        feedback.textContent = existingPostId ? 'Updating post...' : 'Posting...';
        try {
            const t = titleInput.value.trim();
            const d = descInput.value.trim();

            let thumbUrl = null;
            if (preview._file) {
                try {
                    const uploaded = await window.websim.upload(preview._file);
                    thumbUrl = uploaded;
                } catch (err) {
                    console.warn('Thumbnail upload failed', err);
                }
            } else if (!preview._file) {
                // use live screenshot as fallback
                thumbUrl = await takeScreenshot();
            }

            // Call posting routine with gathered inputs and the update flag/post id
            await postProjectToCommunity(t, d, thumbUrl, { update: !!existingPostId, postId: existingPostId });
            feedback.textContent = existingPostId ? 'Updated!' : 'Posted!';
            setTimeout(() => modal.remove(), 800);
        } catch (err) {
            console.error('Post failed', err);
            feedback.textContent = 'Post failed. See console.';
            confirmBtn.disabled = false;
        }
    });

    // click outside closes
    modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove(); });
}

async function renderHomepage() {
    // Insert a prominent purple banner at the top of the homepage (non-destructive)
    try {
        const modalHome = document.getElementById('modal-homepage');
        if (modalHome) {
            // If banner already exists, don't recreate
            if (!document.getElementById('homepage-banner')) {
                const banner = document.createElement('div');
                banner.id = 'homepage-banner';
                banner.className = 'homepage-banner';
                banner.innerHTML = `
                    <div class="hb-icon">💜</div>
                    <div>
                      <div class="hb-title">Support the Creator</div>
                      <div class="hb-body">Help keep this project running by playing the creator's human-made game: <a href="https://playgama.com/game/neon-ball-slope?clid=p_a82a9f71-448f-42fd-beda-a3e4138d26fa" target="_blank" rel="noopener noreferrer">playgama.com/game/neon-ball-slope</a></div>
                      <div style="margin-top:6px;font-size:11px;color:#ffdede;line-height:1.2">
                        Disclosure: This is an affiliate link — I may earn commissions from ads and purchases (including in this and other games) when the link is used.
                      </div>
                    </div>
                `;
                // insert banner above the carousel container for visibility
                const carouselContainer = modalHome.querySelector('.carousel-container');
                if (carouselContainer) modalHome.insertBefore(banner, carouselContainer);
                else modalHome.prepend(banner);
            }
        }
    } catch (err) {
        console.warn('Failed to inject homepage banner', err);
    }

    // Carousel of my projects ordered by latest edit
    const carousel = document.getElementById('homepage-carousel');
    const searchVal = (document.getElementById('project-search')?.value || '').toLowerCase().trim();

    const projects = Object.entries(state.projects)
        .filter(([id, p]) => {
            if (!searchVal) return true;
            const name = (p.name || '').toLowerCase();
            const filesCount = String(Object.keys(p.files || {}).length);
            return name.includes(searchVal) || filesCount.includes(searchVal);
        })
        .sort((a, b) => {
            const da = new Date(a[1].lastSynced || a[1].downloadedAt || 0);
            const db = new Date(b[1].lastSynced || b[1].downloadedAt || 0);
            return db - da;
        });

    carousel.innerHTML = projects.map(([id, p]) => `
        <div class="carousel-item" onclick="switchProject('${id}'); document.getElementById('project-manager-modal').classList.remove('show')">
            <div class="aspect-video bg-black flex items-center justify-center">
                ${p.screenshot ? `<img src="${p.screenshot}" class="w-full h-full object-cover">` : '<span class="text-[10px] text-gray-700">NO PREVIEW</span>'}
            </div>
            <div class="p-3">
                <div class="text-xs font-bold text-white truncate">${escapeHtml(p.name)}</div>
                <div class="text-[10px] text-gray-500 mt-1">${Object.keys(p.files || {}).length} assets</div>
            </div>
        </div>
    `).join('');

    renderCommunityFeed();
}

async function renderCommunityFeed() {
    const feed = document.getElementById('community-feed-grid');

    // Determine filter by checking the explicit filter buttons (fall back to 'hot')
    const hotBtn = document.getElementById('feed-filter-hot');
    const newBtn = document.getElementById('feed-filter-new');
    let filter = 'hot';
    if (hotBtn && hotBtn.classList.contains('active')) filter = 'hot';
    else if (newBtn && newBtn.classList.contains('active')) filter = 'new';

    // Respect the project search bar: allow searching community posts by title or author
    const searchVal = (document.getElementById('project-search')?.value || '').toLowerCase().trim();

    let posts = [...state.communityPosts];

    // Apply search filtering if present
    if (searchVal) {
        posts = posts.filter(p => {
            const title = (p.title || '').toLowerCase();
            const username = (p.username || '').toLowerCase();
            const desc = (p.description || '').toLowerCase();
            return title.includes(searchVal) || username.includes(searchVal) || desc.includes(searchVal);
        });
    }

    // Simple Hot logic: (likes * 2 + views * 0.1)
    if (filter === 'hot') {
        posts.sort((a, b) => (b.likes || 0) * 2 + (b.views || 0) * 0.1 - ((a.likes || 0) * 2 + (a.views || 0) * 0.1));
    } else {
        posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    feed.innerHTML = posts.map(post => {
        return `
        <div class="websim-card group" onclick="playProject('${post.id}')">
            <div class="relative overflow-hidden aspect-video bg-[#050505]">
                <img src="${post.thumbnail || 'https://via.placeholder.com/400x224?text=No+Preview'}" class="websim-card-preview group-hover:scale-105 transition-transform duration-700">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div class="p-2 bg-blue-600 rounded-full shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                        <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
            </div>
            <div class="websim-card-content">
                <div class="websim-card-title">${escapeHtml(post.title)}</div>
                <div class="flex items-center gap-2 mt-2">
                    <img src="https://images.websim.com/avatar/${post.username}" class="social-avatar w-5 h-5">
                    <span class="text-[11px] text-gray-400 font-medium">@${escapeHtml(post.username)}</span>
                </div>
                <div class="websim-card-meta border-t border-[#1f1f1f] pt-3 mt-3">
                    <span class="social-stat">👁️ ${post.views || 0}</span>
                    <span class="social-stat">❤️ ${post.likes || 0}</span>
                    <span class="social-stat ml-auto">📦 ${Object.keys(typeof post.files === 'string' ? JSON.parse(post.files) : (post.files || {})).length}</span>
                </div>
            </div>
        </div>
    `}).join('');
}

async function playProject(postId) {
    const post = state.communityPosts.find(p => p.id === postId);
    if (!post) return;

    // Safely increment views if room is available
    try {
        state.currentViewingPost = postId;
        if (state.room && typeof state.room.collection === 'function') {
            state.room.collection('vibe_post_v3').update(postId, { views: (post.views || 0) + 1 }).catch(()=>{});
        }
    } catch (e) {}

    const modal = document.createElement('div');
    modal.id = 'player-modal';
    modal.className = 'modal-overlay show';
    modal.style.zIndex = 5000;
    
    modal.innerHTML = `
        <div class="project-modal fullscreen-home flex flex-row">
            <div class="flex-1 bg-[#050505] relative flex flex-col">
                <div class="absolute top-4 left-4 z-20 flex gap-2">
                    <button class="px-4 py-2 bg-[#1a1a1a]/80 backdrop-blur border border-[#333] hover:bg-[#333] rounded-lg text-xs font-bold transition-all" onclick="document.getElementById('player-modal').remove()">Back</button>
                    <button class="px-4 py-2 bg-[#1a1a1a]/80 backdrop-blur border border-[#333] hover:bg-[#333] rounded-lg text-xs font-bold transition-all" id="player-share-btn">Share</button>
                    <button class="px-4 py-2 bg-[#1a1a1a]/80 backdrop-blur border border-[#333] hover:bg-[#333] rounded-lg text-xs font-bold transition-all" id="player-fs-btn">Fullscreen</button>
                </div>
                <div id="player-loading" class="absolute inset-0 flex items-center justify-center bg-black z-10 transition-opacity duration-500">
                    <div class="flex flex-col items-center gap-4">
                        <div class="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        <span class="text-sm font-bold tracking-widest uppercase text-gray-500">Loading ${escapeHtml(post.title)}</span>
                    </div>
                </div>
                <iframe id="player-iframe" class="flex-1 w-full border-none opacity-0 transition-opacity duration-500"></iframe>
            </div>
            <div class="w-[340px] bg-[#0d0d0d] border-l border-[#1f1f1f] flex flex-col p-6 overflow-y-auto">
                <div class="flex items-start justify-between mb-6">
                    <div class="flex-1 min-w-0">
                        <h1 class="text-xl font-extrabold tracking-tight text-white leading-tight mb-2">${escapeHtml(post.title)}</h1>
                        <div class="flex items-center gap-3">
                            <img src="https://images.websim.com/avatar/${post.username}" class="social-avatar w-7 h-7">
                            <span class="text-sm text-gray-400 font-semibold">@${escapeHtml(post.username)}</span>
                        </div>
                    </div>
                </div>
                
                <div class="text-sm text-gray-400 mb-8 whitespace-pre-wrap leading-relaxed border-l-2 border-blue-600/30 pl-4 py-1">${escapeHtml(post.description || 'A VibeSim creation.')}</div>
                
                <div class="grid grid-cols-2 gap-3 mb-8">
                    <button class="btn-primary py-3 font-bold shadow-lg shadow-blue-600/20 active:scale-95 transition-transform" id="player-remix-btn">REMIX</button>
                    <button class="btn-secondary py-3 font-bold active:scale-95 transition-transform" id="player-like-btn">❤️ ${post.likes || 0}</button>
                </div>

                <div class="border-t border-[#1f1f1f] pt-6 flex-1 flex flex-col min-h-0">
                    <h3 class="text-[10px] font-black uppercase text-gray-600 mb-4 tracking-[0.2em]">Community Feedback</h3>
                    <div id="player-comments-list" class="flex-1 overflow-auto space-y-4 mb-4 pr-2"></div>
                    <div class="mt-auto border-t border-[#1f1f1f] pt-4">
                        <textarea id="player-comment-input" class="w-full bg-[#141414] border border-[#222] rounded-xl p-4 text-sm text-white resize-none focus:border-blue-600 outline-none transition-all placeholder:text-gray-600" rows="2" placeholder="Tell the creator what you think..."></textarea>
                        <button class="btn-primary w-full mt-3 font-black text-xs uppercase tracking-widest" id="player-post-comment">Post Comment</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const iframe = modal.querySelector('#player-iframe');
    const loader = modal.querySelector('#player-loading');

    // For play view, we need the files. Community posts should store their files as a JSON string or linked assets.
    const projectFiles = typeof post.files === 'string' ? JSON.parse(post.files) : (post.files || {});
    
    if (Object.keys(projectFiles).length === 0) {
        loader.innerHTML = '<div class="text-red-500 font-bold">Error: Project has no files</div>';
        return;
    }

    // Strategy: create a temporary project in user's workspace, open it (without disrupting tabs), generate the normal editor preview,
    // then point the player iframe to that same preview blob so the community viewer matches the editor preview behavior.
    try {
        const tempId = `community-temp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
        // shallow copy files but keep blobUrls where present
        const copied = {};
        Object.entries(projectFiles).forEach(([p, f]) => {
            copied[p] = { ...(f || {}) };
        });
        // Create a transient tempProject for preview only — do NOT add to persistent state.projects
        const tempProject = {
            id: tempId,
            name: `Community: ${post.title}`,
            files: copied,
            tabs: Object.keys(copied).slice(0,3),
            activeTab: Object.keys(copied)[0] || null,
            screenshot: post.thumbnail || '',
            modified: false
        };
        // store transient preview object so it can be referenced during the preview lifecycle
        state._tempPreviewProject = tempProject;

        // Save previous in-memory project snapshot to restore after preview (do not persist to state.projects)
        const prevProjectId = state.currentProjectId;
        const prevFiles = JSON.parse(JSON.stringify(state.files || {}));
        const prevTabs = Array.isArray(state.tabs) ? [...state.tabs] : (Object.keys(prevFiles) || []);
        const prevActiveTab = state.activeTab || (prevTabs[0] || null);

        // Switch to the temp project but avoid showing blocking overlays by calling hydrate only and not forcing UI focus.
        await hydrateProjectFiles(state._tempPreviewProject);
        // set in-memory state for preview generation using the transient tempProject (do not persist)
        state.currentProjectId = tempId;
        state.files = JSON.parse(JSON.stringify(state._tempPreviewProject.files || {}));
        state.tabs = state._tempPreviewProject.tabs || Object.keys(state.files);
        state.activeTab = state._tempPreviewProject.activeTab || state.tabs[0] || null;

        // Use the same preview engine: updatePreview will create a blob URL and set elements.previewIframe.src
        updatePreview();

        // Wait briefly for preview iframe to be assigned and loaded
        await new Promise(res => setTimeout(res, 300));

        // Use the host preview iframe blob as the source for the player iframe to match behavior exactly
        try {
            const hostSrc = elements.previewIframe && elements.previewIframe.src ? elements.previewIframe.src : null;
            if (hostSrc) {
                iframe.onload = () => {
                    iframe.classList.remove('opacity-0');
                    loader.classList.add('opacity-0');
                    setTimeout(() => loader.remove(), 500);
                };
                iframe.src = hostSrc;
            } else {
                renderIframeFromFiles(iframe, projectFiles);
            }
        } catch (err) {
            console.warn('Failed to reuse editor preview for player, falling back to direct render', err);
            renderIframeFromFiles(iframe, projectFiles);
        }

        // restore previous in-memory project state after a short delay so the user's workspace isn't changed permanently
        setTimeout(() => {
            try {
                // Always restore the exact in-memory files/tabs/activeTab that were active before the preview,
                // even if there was no prior saved project. This prevents the temporary preview from becoming a user's project.
                state.files = prevFiles;
                state.tabs = prevTabs;
                state.activeTab = prevActiveTab;
                state.currentProjectId = prevProjectId || null;

                // re-render UI to reflect restoration
                renderFileTree();
                renderTabs();
                // update the editor preview again for the user's active project (if any)
                updatePreview();
            } catch (e) {
                console.warn('Failed to fully restore previous project state after community preview', e);
            } finally {
                // Remove transient preview object to avoid polluting runtime state
                try { delete state._tempPreviewProject; } catch (e) {}
            }
        }, 800);
    } catch (e) {
        console.warn('Community project preview fallback:', e);
        // fallback direct render if anything fails
        iframe.onload = () => {
            iframe.classList.remove('opacity-0');
            loader.classList.add('opacity-0');
            setTimeout(() => loader.remove(), 500);
        };
        renderIframeFromFiles(iframe, projectFiles);
    }

    // Fullscreen for player (still wired)
    modal.querySelector('#player-fs-btn').onclick = () => {
        if (iframe.requestFullscreen) iframe.requestFullscreen();
        else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
    };

    // Share logic
    modal.querySelector('#player-share-btn').onclick = () => {
        navigator.clipboard.writeText(window.location.href);
        showSnackbar("Platform link copied to clipboard!");
    };

    // Likes
    modal.querySelector('#player-like-btn').onclick = async () => {
        const btn = modal.querySelector('#player-like-btn');
        btn.classList.add('like-animation');
        try { state.room.collection('vibe_post_v3').update(postId, { likes: (post.likes || 0) + 1 }); } catch(e){}
        btn.textContent = `❤️ ${(post.likes || 0) + 1}`;
        setTimeout(() => btn.classList.remove('like-animation'), 400);
    };

    // Remix
    modal.querySelector('#player-remix-btn').onclick = async () => {
        const liked = await checkUserLikedStatus(); // User must like the VibeSim project to remix
        if (!liked) {
            alert("Please like the VibeSim project on Websim to unlock Remixing!");
            return;
        }
        const id = `project-${Date.now()}`;
        state.projects[id] = {
            name: `Remix of ${post.title}`,
            files: projectFiles,
            tabs: Object.keys(projectFiles).slice(0,3),
            activeTab: Object.keys(projectFiles)[0],
            screenshot: post.thumbnail,
            modified: true
        };
        saveProjectsToStorage();
        modal.remove();
        document.getElementById('project-manager-modal').classList.remove('show');
        switchProject(id);
        showSnackbar('Project remixed to My Projects!');
    };

    // Comments
    loadPlayerComments(postId);
    modal.querySelector('#player-post-comment').onclick = () => {
        const text = modal.querySelector('#player-comment-input').value;
        if (!text) return;
        try {
            window.websim.postComment({
                content: `[vibe-id: ${postId}] ${text}`
            });
        } catch (e) {
            console.warn('postComment failed', e);
        }
        modal.querySelector('#player-comment-input').value = '';
        setTimeout(() => loadPlayerComments(postId), 1000);
    };
}

async function loadPlayerComments(postId) {
    const list = document.getElementById('player-comments-list');
    if (!list) return;

    // Defensive: show a friendly fallback when comments can't be loaded in preview environments.
    try {
        // Prefer Websim SDK if available and safe; otherwise attempt public API with absolute origin.
        let comments = [];

        // Try using window.websim if it provides a safer helper
        try {
            if (window.websim && typeof window.websim.getCurrentProject === 'function') {
                const proj = await window.websim.getCurrentProject();
                if (proj && proj.id) {
                    // Use absolute Websim API endpoint to avoid relative path issues in preview frames
                    const apiUrl = `https://websim.com/api/v1/projects/${encodeURIComponent(proj.id)}/comments`;
                    const res = await fetch(apiUrl);
                    if (res.ok) {
                        const data = await res.json();
                        comments = (data.comments && Array.isArray(data.comments.data)) ? data.comments.data.map(d => d.comment) : [];
                    }
                }
            }
        } catch (innerErr) {
            console.warn('Primary comments fetch failed, trying local room fallback', innerErr);
        }

        // If that failed, try to fetch comments via the room (if available) as a best-effort fallback.
        if ((!comments || comments.length === 0) && state.room && typeof state.room.collection === 'function') {
            try {
                // Attempt to read comment-like records related to this post (best-effort)
                const all = state.communityPosts || [];
                const post = all.find(p => p.id === postId) || {};
                // If post has an explicit comments array stored, use it
                if (post.comments && Array.isArray(post.comments)) {
                    comments = post.comments;
                }
            } catch (roomErr) {
                console.warn('Room-based comments fallback failed', roomErr);
            }
        }

        // Filter and render comments that match the VibeSim post id pattern if necessary
        const filtered = (comments || []).filter(c => {
            try {
                const raw = c && c.raw_content ? String(c.raw_content) : (c.content ? String(c.content) : '');
                return raw.includes(`[vibe-id: ${postId}]`) || (c.post_id && String(c.post_id) === String(postId));
            } catch (e) { return false; }
        });

        // If filtered is empty but we have comments, render them; otherwise show friendly message
        if (filtered && filtered.length > 0) {
            list.innerHTML = filtered.map(c => {
                const author = (c.author && c.author.username) ? c.author.username : (c.username || 'anon');
                const raw = c.raw_content ? c.raw_content : (c.content ? c.content : '');
                const body = String(raw).replace(`[vibe-id: ${postId}]`, '').trim();
                return `
                    <div class="bg-[#111] p-3 rounded-lg border border-[#222]">
                        <div class="text-[10px] text-gray-500 mb-1">@${escapeHtml(author)}</div>
                        <div class="text-sm text-gray-200">${escapeHtml(body)}</div>
                    </div>
                `;
            }).join('');
        } else {
            // No comments available in preview environment — invite first comment
            list.innerHTML = '<div class="text-xs text-gray-600 italic">No comments on this project yet, be the first!</div>';
        }
    } catch (e) {
        console.warn('loadPlayerComments unexpected error', e);
        list.innerHTML = '<div class="text-xs text-red-500">Failed to load comments.</div>';
    }
}

// Post Project to Community
async function postProjectToCommunity(titleArg = null, descArg = null, thumbArg = null, options = {}) {
    // options: { update: boolean, postId: string }
    const proj = state.projects[state.currentProjectId];
    let user = { username: 'unknown' };
    try { user = await window.websim.getCurrentUser(); } catch (e) { /* preview fallback */ }

    // If title/desc were not provided (other code paths), fall back to prompt
    const title = titleArg ?? (proj && proj.name) ?? await showDialog({ title: 'Post to Community', body: 'Project Title:', input: true });
    if (!title) return;
    const desc = (typeof descArg === 'string') ? descArg : (proj && proj.description) ?? '';

    // Use provided thumbnail if present, otherwise take a live screenshot
    const screenshot = thumbArg || proj && proj.screenshot || await takeScreenshot();

    // Upload files to blob storage for persistent community access (best-effort)
    const uploadedFiles = {};
    if (proj && proj.files) {
        for (const [path, f] of Object.entries(proj.files)) {
            try {
                // Reuse existing cloud blobUrl if it's already a Websim storage URL
                if (f.blobUrl && String(f.blobUrl).startsWith('https://')) {
                    uploadedFiles[path] = { blobUrl: f.blobUrl };
                    continue;
                }

                if (f.content) {
                    const blob = await vibesimToBlob(f, path);
                    const url = (window.websim && typeof window.websim.upload === 'function') ? await window.websim.upload(new File([blob], path, { type: blob.type })) : null;
                    if (url) uploadedFiles[path] = { blobUrl: url };
                    else uploadedFiles[path] = { content: f.content };
                } else if (f.blobUrl) {
                    uploadedFiles[path] = { blobUrl: f.blobUrl };
                } else {
                    uploadedFiles[path] = { content: f.content || '' };
                }
            } catch (err) {
                console.warn('Upload failed for', path, err);
                // fallback to inline content
                uploadedFiles[path] = { content: f.content || '' };
            }
        }
    }

    try {
        const collection = state.room && typeof state.room.collection === 'function' ? state.room.collection('vibe_post_v3') : null;

        if (options.update && options.postId && collection) {
            // Update existing post record
            try {
                await collection.update(options.postId, {
                    title,
                    description: desc || '',
                    thumbnail: screenshot,
                    files: uploadedFiles,
                    updated_at: new Date().toISOString()
                });
                // persist postId in project metadata to retain linkage
                if (!state.projects[state.currentProjectId]) state.projects[state.currentProjectId] = {};
                state.projects[state.currentProjectId].postId = options.postId;
                saveProjectsToStorage();
                showSnackbar('Project updated on Community Feed!');
                addMessage('assistant-vibe', 'Your project version was updated on Vibesim.');
                return;
            } catch (upErr) {
                console.warn('Update failed, attempting to create new post', upErr);
                // fallback to create if update fails
            }
        }

        // Create a new post
        if (collection) {
            const rec = await collection.create({
                title,
                description: desc || '',
                thumbnail: screenshot,
                files: uploadedFiles,
                username: user.username,
                likes: 0,
                views: 0,
                created_at: new Date().toISOString()
            });

            // Save the created post id to the project so future updates will target it
            if (rec && rec.id) {
                if (!state.projects[state.currentProjectId]) state.projects[state.currentProjectId] = {};
                state.projects[state.currentProjectId].postId = rec.id;
                saveProjectsToStorage();
            }

            showSnackbar('Posted to Community Feed!');
            addMessage('assistant-vibe', 'Your project was posted to the Community Feed.');
        } else {
            // If no collection available (preview/no room), fall back to local simulation behavior
            showSnackbar('Posted (preview mode)');
            addMessage('assistant-vibe', 'Project posted in preview mode (no remote room available).');
        }
    } catch (e) {
        console.error('Post to community failed', e);
        addMessage('assistant-vibe', 'Failed to post to community. See console.');
        alert('Failed to post to community: ' + (e.message || 'unknown error'));
    }
}

function updatePlayerFollowUI() {
    // Logic removed as per request to remove following feature
}

async function renderIframeFromFiles(iframe, files) {
    // Robust asset mapping for community player: handles data URLs, base64 blobs, and wrapped binaries
    const assetUrlMap = {};

    const extToMime = (p) => {
        const ext = (p.split('.').pop() || '').toLowerCase();
        const map = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
            'webp': 'image/webp', 'svg': 'image/svg+xml', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
            'ogg': 'audio/ogg', 'mp4': 'video/mp4', 'webm': 'video/webm', 'css': 'text/css',
            'js': 'application/javascript', 'html': 'text/html', 'json': 'application/json', 'txt': 'text/plain'
        };
        return map[ext] || 'application/octet-stream';
    };

    for (const [path, file] of Object.entries(files)) {
        try {
            if (file.blobUrl) {
                assetUrlMap[path] = file.blobUrl;
                continue;
            }

            let content = file.content;
            if (typeof content !== 'string') continue;

            // Handle wrapped binary markers used in imports
            if (content.startsWith('/* binary data url */')) {
                content = content.split('\n').slice(1).join('\n').trim();
            }

            // Use data URL directly if already resolved
            if (content.startsWith('data:')) {
                assetUrlMap[path] = content;
                continue;
            }

            // Convert long base64 blocks to usable blobs
            if (/^[A-Za-z0-9+/=]{100,}$/.test(content.replace(/\s/g, ''))) {
                try {
                    const mime = extToMime(path);
                    const b64 = content.replace(/\s/g, '');
                    const byteString = atob(b64);
                    const u8 = new Uint8Array(byteString.length);
                    for (let i = 0; i < byteString.length; i++) u8[i] = byteString.charCodeAt(i);
                    const blob = new Blob([u8], { type: mime });
                    assetUrlMap[path] = URL.createObjectURL(blob);
                    continue;
                } catch (e) { /* fallback to text if base64 decode fails */ }
            }

            // Default: create a text-based blob with proper MIME type
            const mime = extToMime(path);
            const blob = new Blob([content], { type: mime + ';charset=utf-8' });
            assetUrlMap[path] = URL.createObjectURL(blob);
        } catch (err) {
            console.warn('renderIframeFromFiles asset error', path, err);
        }
    }

    // Also map basenames to asset URLs to support HTML that references files by filename only
    // (community posts often reference assets using only the filename or ./filename)
    try {
        Object.entries(assetUrlMap).forEach(([p, u]) => {
            try {
                const base = String(p).split('/').pop();
                if (base) {
                    if (!assetUrlMap[base]) assetUrlMap[base] = u;
                    if (!assetUrlMap['./' + base]) assetUrlMap['./' + base] = u;
                    if (!assetUrlMap['/' + base]) assetUrlMap['/' + base] = u;
                }
            } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }

    // Enhanced asset path replacer for community play content
    function replaceAssetPathsInContent(content) {
        if (typeof content !== 'string') return content;
        let result = content;
        const sortedPaths = Object.keys(assetUrlMap).sort((a, b) => b.length - a.length);
        sortedPaths.forEach(projPath => {
            const url = assetUrlMap[projPath];
            const esc = projPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(['"\`])(?:\\.\\/|\\/)?${esc}\\1`, 'g');
            result = result.replace(regex, `$1${url}$1`);
        });
        return result;
    }

    // Build HTML from index.html (or fallback)
    let html = files['index.html']?.content || '<!doctype html><html><body><h1>No Index Found</h1></body></html>';

    // Inline CSS and JS and replace paths within them
    Object.entries(files).forEach(([path, file]) => {
        const content = String(file.content || '');
        if (path.endsWith('.css')) {
            let cssContent = replaceAssetPathsInContent(content);
            const linkRegex = new RegExp(`<link[^>]*href=["'](?:\\/|\\.\\/)?${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'g');
            html = html.replace(linkRegex, `<style>${cssContent}</style>`);
        } else if (path.endsWith('.js')) {
            let jsContent = replaceAssetPathsInContent(content);
            const scriptRegex = new RegExp(`<script[^>]*src=["'](?:\\/|\\.\\/)?${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*<\\/script>`, 'g');
            html = html.replace(scriptRegex, `<script>${jsContent}<\/script>`);
        }
    });

    // Replace references in HTML (src/href/url(...) etc.) with asset URLs
    for (const [p, url] of Object.entries(assetUrlMap)) {
        const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const srcRegex = new RegExp(`(src=)(["']?)(?:\\/|\\.\\/|\\.\\.\\/)?(${esc})\\2`, 'g');
        const hrefRegex = new RegExp(`(href=)(["']?)(?:\\/|\\.\\/|\\.\\.\\/)?(${esc})\\2`, 'g');
        const cssUrlRegex = new RegExp(`url\\((['"]?)(?:\\/|\\.\\/|\\.\\.\\/)?${esc}\\1\\)`, 'g');

        html = html.replace(srcRegex, `src="${url}"`);
        html = html.replace(hrefRegex, `href="${url}"`);
        html = html.replace(cssUrlRegex, `url("${url}")`);
    }

    // Security: Inject a small runtime shim similar to preview injection that exposes the mapping for dynamic loads.
    const injection = `
    <script>
    (function(){
        window.__vibesim_asset_map = ${JSON.stringify(assetUrlMap)};
        function resolveAssetPath(p){
            if(!p || typeof p !== 'string') return p;
            if(window.__vibesim_asset_map[p]) return window.__vibesim_asset_map[p];
            const normalized = p.replace(/^\\.\\/+/, '').replace(/^[\\/]+/, '');
            if(window.__vibesim_asset_map[normalized]) return window.__vibesim_asset_map[normalized];
            // try last segment
            const last = normalized.split('/').pop();
            for(const k of Object.keys(window.__vibesim_asset_map||{})){
                if(k.endsWith('/'+last) || k===last) return window.__vibesim_asset_map[k];
            }
            return p;
        }

        // Patch Audio constructor
        (function(){
            try {
                const OriginalAudio = window.Audio;
                function PatchedAudio(src) { return new OriginalAudio(resolveAssetPath(src || '')); }
                PatchedAudio.prototype = OriginalAudio.prototype;
                window.Audio = PatchedAudio;
            } catch(e){}
        })();

        // Patch CSS background-image resolution
        (function(){
            try {
                const bgDesc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'backgroundImage') || {};
                if (bgDesc && typeof bgDesc.set === 'function') {
                    Object.defineProperty(CSSStyleDeclaration.prototype, 'backgroundImage', {
                        configurable: true, enumerable: bgDesc.enumerable, get: bgDesc.get,
                        set: function(val) {
                            if (typeof val === 'string' && val.includes('url(')) {
                                val = val.replace(/url\\((['\"]?)(.*?)\\1\\)/g, (_, q, u) => 'url("' + (resolveAssetPath(u) || u) + '")');
                            }
                            return bgDesc.set.call(this, val);
                        }
                    });
                }
                const origSetProperty = CSSStyleDeclaration.prototype.setProperty;
                CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) {
                    if (typeof value === 'string' && value.includes('url(')) {
                        value = value.replace(/url\\((['\"]?)(.*?)\\1\\)/g, (_, q, u) => 'url("' + (resolveAssetPath(u) || u) + '")');
                    }
                    return origSetProperty.call(this, name, value, priority);
                };
            } catch(e){}
        })();

        // Monkeypatch Image.src and element.setAttribute to rewrite simple relative references
        try {
            const ImgProto = HTMLImageElement && HTMLImageElement.prototype;
            if(ImgProto){
                const desc = Object.getOwnPropertyDescriptor(ImgProto, 'src') || {};
                const origSetter = desc && desc.set;
                Object.defineProperty(ImgProto, 'src', {
                    configurable:true,
                    enumerable:true,
                    get: function(){ return this.getAttribute('src'); },
                    set: function(v){
                        try {
                            const r = resolveAssetPath(String(v||''));
                            if(r) {
                                if(origSetter) return origSetter.call(this, r);
                                return this.setAttribute('src', r);
                            }
                        } catch(e){}
                        if(origSetter) return origSetter.call(this, v);
                        return this.setAttribute('src', v);
                    }
                });
            }
            const origSet = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function(name, value){
                try {
                    if((name==='src' || name==='href') && typeof value === 'string'){
                        const r = resolveAssetPath(value);
                        if(r) return origSet.call(this, name, r);
                    }
                } catch(e){}
                return origSet.call(this, name, value);
            };
        } catch(e){}

        // Patch fetch/XHR lightly to remap to blob/data urls when possible
        (function(){
            try {
                const originalFetch = window.fetch;
                window.fetch = function(input, init){
                    try {
                        let url = typeof input === 'string' ? input : (input && input.url ? input.url : null);
                        if(url){
                            const r = resolveAssetPath(url);
                            if(r) input = typeof input === 'string' ? r : new Request(r, input);
                        }
                    } catch(e){}
                    return originalFetch.apply(this, arguments);
                };
                const OriginalXHR = window.XMLHttpRequest;
                function PatchedXHR(){
                    const xhr = new OriginalXHR();
                    const origOpen = xhr.open;
                    xhr.open = function(method, url){
                        try {
                            const r = resolveAssetPath(String(url));
                            if(r) url = r;
                        } catch(e){}
                        return origOpen.apply(this, [method, url].concat(Array.prototype.slice.call(arguments,2)));
                    };
                    return xhr;
                }
                PatchedXHR.prototype = OriginalXHR.prototype;
                window.XMLHttpRequest = PatchedXHR;
            } catch(e){}
        })();

        // report runtime errors to parent
        function send(obj){ try{ parent.postMessage({ __vibesim_runtime_error:true, payload: obj }, '*'); }catch(e){} }
        window.addEventListener('error', function(e){
            send({ type:'error', message:e.message, filename:e.filename||null, lineno:e.lineno||null, colno:e.colno||null, stack: e.error && e.error.stack ? String(e.error.stack) : null });
        });
        window.addEventListener('unhandledrejection', function(ev){
            const r = ev && ev.reason ? ev.reason : ev;
            send({ type:'promise', message: r && r.message ? r.message : String(r), stack: r && r.stack ? String(r.stack) : null });
        });
    })();
    </script>`;

    if (html.includes('</body>')) html = html.replace('</body>', injection);
    else html += injection;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    // Revoke previous preview blob if any
    if (iframe.src && iframe.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(iframe.src); } catch(e){}
    }

    iframe.onload = () => {
        setTimeout(() => {
            try { if (typeof takeScreenshot === 'function') takeScreenshot(); } catch(e){}
        }, 800);
    };
    iframe.src = url;
}

function renderProjectList() {
    const list = document.getElementById('modal-project-list');
    const searchVal = document.getElementById('project-search')?.value?.toLowerCase() || '';
    
    const filteredProjects = Object.entries(state.projects).filter(([id, p]) => {
        return p.name?.toLowerCase().includes(searchVal);
    });

    list.innerHTML = filteredProjects.map(([id, p]) => `
        <div class="websim-card group" data-id="${id}">
            ${p.screenshot ? `<img src="${p.screenshot}" class="websim-card-preview group-hover:scale-105 transition-transform duration-700">` : `<div class="websim-card-preview flex items-center justify-center text-xs text-gray-700 bg-[#050505]">No Preview</div>`}
            <div class="websim-card-content">
                <div class="websim-card-title font-bold">${escapeHtml(p.name)}</div>
                <div class="websim-card-meta mt-2 text-gray-500 font-medium">
                    <span>By you</span>
                    <span style="margin: 0 4px; opacity: 0.3;">•</span>
                    <span>${Object.keys(p.files || {}).length} assets</span>
                </div>
                <div class="websim-card-actions mt-4 pt-4 border-t border-[#1f1f1f] flex gap-2">
                    <button class="export-project btn-secondary px-2 flex-1 text-[10px] font-bold uppercase tracking-wider" data-id="${id}">Export</button>
                    <button class="versions-project btn-secondary px-2 flex-1 text-[10px] font-bold uppercase tracking-wider" data-id="${id}">Versions</button>
                    <button class="delete-project btn-secondary px-2 flex-1 text-[10px] font-bold uppercase tracking-wider text-red-400 hover:text-red-300 border-red-900/20" data-id="${id}">Delete</button>
                </div>
            </div>
        </div>
    `).join('');

    // Search binding
    const searchInput = document.getElementById('project-search');
    if (searchInput && !searchInput._vibesim_bound) {
        searchInput._vibesim_bound = true;
        searchInput.addEventListener('input', () => renderProjectList());
    }

    list.querySelectorAll('.websim-card').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-project') || e.target.closest('.export-project')) return;
            switchProject(item.dataset.id);
            document.getElementById('project-manager-modal').classList.remove('show');
        });
    });

    list.querySelectorAll('.delete-project').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (id === state.currentProjectId) {
                alert("Cannot delete active project.");
                return;
            }
            const confirmed = await showDialog({ title: 'Delete Project', body: 'Are you sure you want to delete this project? This cannot be undone.', cancelText: 'No', confirmText: 'Delete' });
            if (confirmed) {
                delete state.projects[id];
                saveProjectsToStorage();
                // Refresh the Projects view in-place instead of reopening the manager (prevents resetting to Homepage)
                renderProjectList();
            }
        });
    });

    // Export per-project ZIP handler using JSZip for high reliability (with dynamic loader)
    list.querySelectorAll('.export-project').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const proj = state.projects[id];
            if (!proj) return;

            try {
                btn.style.opacity = '0.5';
                try {
                    await ensureJSZip();
                } catch (errLoad) {
                    throw new Error('JSZip library not loaded. ' + errLoad.message);
                }

                const zip = new JSZip();
                Object.entries(proj.files || {}).forEach(([p, f]) => {
                    zip.file(p, f.content);
                });
                const content = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${proj.name || id}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            } catch (err) {
                alert("Export failed: " + err.message);
            } finally {
                btn.style.opacity = '1';
            }
        });
    });

    // Versions button handlers
    list.querySelectorAll('.versions-project').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            openVersionsModal(id);
        });
    });
}

function openVersionsModal(projectId) {
    const project = state.projects[projectId];
    if (!project) {
        alert('Project not found.');
        return;
    }

    // Create modal
    const existing = document.getElementById('project-versions-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'project-versions-modal';
    modal.className = 'modal-overlay show';
    modal.style.zIndex = 5200;
    modal.innerHTML = `
        <div class="project-modal" style="max-width:720px; width: min(92vw,720px);">
            <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
                <span>Versions — ${escapeHtml(project.name || projectId)}</span>
                <button id="versions-close" class="btn-secondary">Close</button>
            </div>
            <div style="padding:16px; color:#cbd5e1; max-height:60vh; overflow:auto">
                <div id="versions-list" style="display:flex;flex-direction:column;gap:10px"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const list = modal.querySelector('#versions-list');
    const versions = project.versions || [];
    if (versions.length === 0) {
        list.innerHTML = `<div style="color:#9aa6b2">No previous versions available.</div>`;
    } else {
        versions.forEach(v => {
            const item = document.createElement('div');
            item.className = 'ai-status-card';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.innerHTML = `
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700">${new Date(v.createdAt).toLocaleString()}</div>
                    <div style="font-size:12px;color:#9aa6b2;margin-top:6px">${Object.keys(v.files || {}).length} assets</div>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn-secondary versions-preview" data-id="${v.id}">Preview</button>
                    <button class="btn-primary versions-restore" data-id="${v.id}">Restore</button>
                </div>
            `;
            list.appendChild(item);
        });

        // handlers
        list.querySelectorAll('.versions-preview').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const vid = btn.dataset.id;
                const v = versions.find(x => x.id === vid);
                if (!v) return;

                // Build a live preview HTML blob for this version's files.
                // Prefer index.html as entrypoint; otherwise create a simple index listing.
                (async () => {
                    const files = v.files || {};
                    let entryHtml = '';
                    if (files['index.html'] && (files['index.html'].content || files['index.html'].blobUrl)) {
                        // Start with index.html content and inline CSS/JS from version files if referenced by exact path.
                        entryHtml = String(files['index.html'].content || '');
                        // inline CSS and JS: replace <link href="path"> and <script src="path"></script> occurrences
                        Object.entries(files).forEach(([path, f]) => {
                            try {
                                if (path.endsWith('.css') && typeof f.content === 'string') {
                                    const css = f.content;
                                    const linkRegex = new RegExp(`<link[^>]*href=["']${escapeRegExp(path)}["'][^>]*>`, 'g');
                                    entryHtml = entryHtml.replace(linkRegex, `<style>${css}</style>`);
                                } else if (path.endsWith('.js') && typeof f.content === 'string') {
                                    const js = f.content;
                                    const scriptRegex = new RegExp(`<script[^>]*src=["']${escapeRegExp(path)}["'][^>]*>\\s*</script>`, 'g');
                                    entryHtml = entryHtml.replace(scriptRegex, `<script>${js}<\/script>`);
                                }
                            } catch (err) {
                                // ignore inlining errors for robustness
                                console.warn('Inlining error for', path, err);
                            }
                        });
                        // Append a small injection so the preview can report runtime errors back to the host like the normal preview does.
                        entryHtml = entryHtml.replace('</body>', `${getPreviewInjectionSnippet()}</body>`);
                        if (!entryHtml.includes('</body>')) entryHtml += getPreviewInjectionSnippet();
                    } else {
                        // generate a simple listing page showing files; link assets if blobUrl present
                        const rows = Object.entries(files).map(([p,f]) => {
                            const status = f.blobUrl ? 'blobUrl' : (f.content ? 'inline' : 'missing');
                            const link = f.blobUrl ? `<a href="${f.blobUrl}" target="_blank" rel="noreferrer">Open</a>` : '';
                            return `<li style="padding:6px 0;border-bottom:1px solid #151515"><strong>${escapeHtml(p)}</strong> — ${status} ${link}</li>`;
                        }).join('');
                        entryHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Version Preview</title></head><body style="background:#07070a;color:#e6eef8;font-family:Inter,system-ui;padding:18px">
                            <h2>Preview — ${escapeHtml(state.projects[state.currentProjectId]?.name || '')} — ${new Date(v.createdAt).toLocaleString()}</h2>
                            <ul style="list-style:none;padding:0;margin-top:12px">${rows}</ul>
                            ${getPreviewInjectionSnippet()}
                        </body></html>`;
                    }

                    // create blob and show in modal with iframe
                    const blob = new Blob([entryHtml], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);

                    const pv = document.createElement('div');
                    pv.className = 'modal-overlay show';
                    pv.style.zIndex = 5300;
                    pv.innerHTML = `<div class="project-modal" style="max-width:900px; width: min(95vw,900px); height: min(90vh,720px); display:flex; flex-direction:column; overflow:hidden;">
                        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
                            <div>Version Preview — ${new Date(v.createdAt).toLocaleString()}</div>
                            <div style="display:flex;gap:8px">
                                <button class="btn-secondary" id="pv-open-new">Open in new tab</button>
                                <button class="btn-secondary" id="pv-close">Close</button>
                            </div>
                        </div>
                        <div style="flex:1; background:#000; display:flex;flex-direction:column;">
                            <iframe id="pv-iframe" src="${url}" style="border:none; width:100%; flex:1; background:white"></iframe>
                        </div>
                    </div>`;
                    document.body.appendChild(pv);

                    // wire actions
                    pv.querySelector('#pv-close').addEventListener('click', () => {
                        try { 
                            const ifr = pv.querySelector('#pv-iframe');
                            if (ifr && ifr.src && ifr.src.startsWith('blob:')) URL.revokeObjectURL(ifr.src);
                        } catch (e) {}
                        pv.remove();
                    });
                    pv.querySelector('#pv-open-new').addEventListener('click', () => {
                        window.open(url, '_blank');
                    });

                    // ensure clicking outside closes
                    pv.addEventListener('click', (ev) => { if (ev.target === pv) { try { const ifr = pv.querySelector('#pv-iframe'); if (ifr && ifr.src && ifr.src.startsWith('blob:')) URL.revokeObjectURL(ifr.src); } catch (e) {} pv.remove(); } });

                })();

                // helper utilities used above
                function escapeRegExp(s) {
                    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                }
                function getPreviewInjectionSnippet() {
                    // small snippet to preserve runtime error reporting behavior in version preview if possible
                    return `<script>
(function(){
  try {
    window.__vibesim_preview = true;
    window.addEventListener('error', function(e){
      parent.postMessage({ __vibesim_runtime_error: true, payload: { type:'error', message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error && e.error.stack ? e.error.stack : null } }, '*');
    });
    window.addEventListener('unhandledrejection', function(ev){
      const r = ev && ev.reason ? ev.reason : ev;
      parent.postMessage({ __vibesim_runtime_error: true, payload: { type:'promise', message: r && r.message ? r.message : String(r), stack: r && r.stack ? r.stack : null } }, '*');
    });
  } catch(e){}
})();
<\/script>`;
                }
            });
        });

        list.querySelectorAll('.versions-restore').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const vid = btn.dataset.id;
                const v = versions.find(x => x.id === vid);
                if (!v) return;
                const ok = await showDialog({ title: 'Restore Version', body: `Restore version from ${new Date(v.createdAt).toLocaleString()}? This will overwrite current project files.`, confirmText: 'Restore', cancelText: 'Cancel' });
                if (!ok) return;
                // Apply version: copy blobUrls/content into project files; prefer blobUrl so preview and assets remain intact
                const restoredFiles = {};
                for (const [p, f] of Object.entries(v.files || {})) {
                    if (f.blobUrl) {
                        restoredFiles[p] = { blobUrl: f.blobUrl, language: getLang(p) };
                    } else if (typeof f.content !== 'undefined') {
                        restoredFiles[p] = { content: f.content, language: getLang(p) };
                    } else {
                        restoredFiles[p] = { content: '', language: getLang(p) };
                    }
                }
                state.projects[projectId].files = restoredFiles;
                // If restoring the active project, also set state.files and refresh UI
                if (state.currentProjectId === projectId) {
                    state.files = restoredFiles;
                    state.tabs = Object.keys(restoredFiles);
                    state.activeTab = state.tabs[0] || null;
                    renderFileTree();
                    renderTabs();
                    openFile(state.activeTab);
                    updatePreview();
                }
                // Save after restore (forceSync=false to keep local snapshot)
                await saveProjectsToStorage(true);
                showSnackbar('Version restored');
                modal.remove();
            });
        });
    }

    modal.querySelector('#versions-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function renderTemplateGrid() {
    // Resolve inner container
    const inner = document.getElementById('template-catalog-inner');
    if (!inner) return;

    // Clear existing content
    inner.innerHTML = '';

    // Sort templates: official first, then by created_at descending if present
    const officialTemplates = (state.templates || []).filter(t => t.username === 'CoponStackos');
    const communityTemplates = (state.templates || []).filter(t => t.username !== 'CoponStackos');

    function createCardElement(t) {
        const previewSrc = (Array.isArray(t.images) && t.images.length) ? DOMPurify.sanitize(t.images[0]) :
                           (t.screenshot ? DOMPurify.sanitize(t.screenshot) : 'https://via.placeholder.com/400x224?text=Template');
        const safeName = DOMPurify.sanitize(t.name || 'Unnamed');
        const safeAuthor = escapeHtml(t.username || 'unknown');
        const safeDesc = t.description ? DOMPurify.sanitize(t.description) : '';

        const card = document.createElement('div');
        card.className = 'template-card';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.cursor = 'pointer';
        card.dataset.id = t.id;

        const img = document.createElement('img');
        img.className = 'template-preview';
        img.src = previewSrc;
        img.alt = safeName;
        img.style.width = '100%';
        img.style.height = '120px';
        img.style.objectFit = 'cover';
        img.style.borderBottom = '1px solid #222';

        const info = document.createElement('div');
        info.className = 'template-info';
        info.style.padding = '10px';
        info.innerHTML = `
            <div class="template-name" style="font-weight:700;color:#fff">${safeName}</div>
            <div class="template-author" style="font-size:12px;color:#8b98a8;margin-top:6px">by @${safeAuthor}</div>
            ${safeDesc ? `<div style="margin-top:8px;font-size:12px;color:#9aa6b2;line-height:1.3">${safeDesc}</div>` : ''}
        `;
        if (t.username === 'CoponStackos') {
            const badge = document.createElement('div');
            badge.className = 'official-badge';
            badge.style.marginTop = '8px';
            badge.textContent = 'OFFICIAL';
            info.appendChild(badge);
        }

        card.appendChild(img);
        card.appendChild(info);

        card.addEventListener('click', async () => {
            try {
                // If clicking a template, ensure the current user has liked the template's source project before creating
                const canUseTemplate = await checkUserLikedStatus();
                if (!canUseTemplate) {
                    await showDialog({
                        title: 'Like Required',
                        body: 'To unlock creating a project from templates, please like the project on Websim first. You can still browse templates, but creation is locked until you like the project.',
                        confirmText: 'OK'
                    });
                    return;
                }
                createNewProject(t);
                const modal = document.getElementById('project-manager-modal');
                if (modal) modal.classList.remove('show');
            } catch (err) {
                console.warn('Template click error', err);
                // fallback to normal behavior if check failed
                createNewProject(t);
                const modal = document.getElementById('project-manager-modal');
                if (modal) modal.classList.remove('show');
            }
        });

        return card;
    }

    const sectionHeader = (title) => {
        const h = document.createElement('div');
        h.style.gridColumn = '1/-1';
        h.style.padding = '8px 12px';
        h.style.color = '#9aa6b2';
        h.style.fontSize = '11px';
        h.style.fontWeight = '700';
        h.style.textTransform = 'uppercase';
        h.textContent = title;
        return h;
    };

    // Build a simple grid layout inside the inner element
    inner.style.display = 'grid';
    inner.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
    inner.style.gap = '12px';

    // Official section
    inner.appendChild(sectionHeader('Official Templates'));
    if (officialTemplates.length === 0) {
        const empty = document.createElement('div');
        empty.style.gridColumn = '1/-1';
        empty.style.color = '#6b7280';
        empty.style.padding = '12px';
        empty.textContent = 'No official templates found.';
        inner.appendChild(empty);
    } else {
        officialTemplates.forEach(t => inner.appendChild(createCardElement(t)));
    }

    // Community section
    inner.appendChild(sectionHeader('Community Templates'));
    if (communityTemplates.length === 0) {
        const empty = document.createElement('div');
        empty.style.gridColumn = '1/-1';
        empty.style.color = '#6b7280';
        empty.style.padding = '12px';
        empty.textContent = 'No community templates found.';
        inner.appendChild(empty);
    } else {
        communityTemplates.forEach(t => inner.appendChild(createCardElement(t)));
    }

    // ensure scrolling inside modal for long lists - size the templates area to fill the modal and make its inner catalog scrollable
    const gridContainer = document.getElementById('modal-template-grid');
    if (gridContainer) {
        // keep layout adjustments but DO NOT override display so the .hidden class can control visibility
        gridContainer.style.flexDirection = 'column';
        gridContainer.style.flex = '1 1 auto';
        gridContainer.style.minHeight = '0';
        gridContainer.style.padding = '20px';
        // the inner catalog (template-catalog-inner) should scroll independently and fill the remaining space
        const innerCatalog = document.getElementById('template-catalog-inner');
        if (innerCatalog) {
            innerCatalog.style.flex = '1 1 auto';
            innerCatalog.style.minHeight = '0';
            innerCatalog.style.overflow = 'auto';
            innerCatalog.style.paddingBottom = '40px'; // breathing room at bottom for scroll
        } else {
            // fallback: ensure the container itself scrolls
            gridContainer.style.overflow = 'auto';
            gridContainer.style.maxHeight = 'calc(100vh - 220px)';
        }
    }
}

async function createNewProject(template = null) {
    const defaultName = template ? `My ${template.name}` : `project-vibe-${Date.now().toString().slice(-4)}`;
    const name = await showDialog({ title: 'New Project', body: 'Enter a name for your project:', input: true });
    if (!name) return;
    const id = `project-${Date.now()}`;
    
    state.projects[id] = {
        name,
        files: template ? JSON.parse(JSON.stringify(template.files)) : {
            'index.html': { content: '<h1>New Project</h1>', language: 'html' }
        },
        tabs: template ? Object.keys(template.files).slice(0, 3) : ['index.html'],
        activeTab: template ? Object.keys(template.files)[0] : 'index.html',
        screenshot: template ? template.screenshot : '',
        modified: true
    };
    
    saveProjectsToStorage();
    switchProject(id);
    document.getElementById('project-manager-modal').classList.remove('show');
}

/* Check whether the current Websim user has liked the current project.
   Returns true if liked, false otherwise. Silently returns false on error. */
async function checkUserLikedStatus() {
    try {
        if (!window.websim || typeof window.websim.getCurrentProject !== 'function' || typeof window.websim.getCurrentUser !== 'function') {
            return false;
        }
        const project = await window.websim.getCurrentProject();
        const user = await window.websim.getCurrentUser();
        if (!project || !user || !user.username || !project.id) return false;

        const response = await fetch(`/api/v1/users/${encodeURIComponent(user.username)}/project/${encodeURIComponent(project.id)}/like`);
        if (!response.ok) return false;
        const data = await response.json();
        // If data.like is null => not liked
        const hasLiked = data && data.like !== null;
        return !!hasLiked;
    } catch (error) {
        console.error("Error checking like status:", error);
        return false;
    }
}

/**
 * If the user hasn't liked the project, show a friendly "Unlock Templates" modal
 * explaining that liking supports the creator and unlocks template creation.
 */
async function showUnlockTemplatesIfNeeded() {
    try {
        // Ensure websim methods exist; if not, bail quietly
        if (!window.websim || typeof window.websim.getCurrentProject !== 'function' || typeof window.websim.getCurrentUser !== 'function') {
            return;
        }

        const project = await window.websim.getCurrentProject();
        const user = await window.websim.getCurrentUser();
        if (!project || !user) return;

        const liked = await checkUserLikedStatus();
        if (liked) return; // already liked, nothing to do

        // Create modal UI only if not already present
        if (document.getElementById('unlock-templates-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'unlock-templates-modal';
        modal.className = 'modal-overlay show';
        modal.style.zIndex = 4500;
        modal.innerHTML = `
            <div class="project-modal" style="max-width:520px">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
                    <span>Unlock Templates</span>
                </div>
                <div style="padding:16px; color:#cbd5e1; font-size:13px; line-height:1.45; text-align:center">
                    <div style="font-size:56px; line-height:1; margin-bottom:12px; filter:drop-shadow(0 6px 20px rgba(0,0,0,0.6))">🫶</div>
                    <p style="margin-bottom:8px">Support the creator to unlock full template creation: liking this project on Websim gives access to create new projects from templates and helps the creator keep making great assets.</p>
                    <p style="font-size:12px;color:#9aa6b2;margin-bottom:12px">You can still browse templates freely; creating projects from them will be unlocked after you like the project on Websim.</p>
                    <div style="display:flex;gap:10px;justify-content:flex-end">
                        <button id="unlock-templates-go-like" class="btn-primary">Verify Like</button>
                        <button id="unlock-templates-dismiss" class="btn-secondary">Maybe Later</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Button handlers
        modal.querySelector('#unlock-templates-close')?.addEventListener('click', () => modal.remove());
        modal.querySelector('#unlock-templates-dismiss')?.addEventListener('click', () => modal.remove());
        modal.querySelector('#unlock-templates-go-like')?.addEventListener('click', async () => {
            const btn = modal.querySelector('#unlock-templates-go-like');
            btn.disabled = true;
            btn.textContent = 'Verifying…';
            try {
                const liked = await checkUserLikedStatus();
                if (liked) {
                    showSnackbar('You have liked this project — templates unlocked.');
                    try { modal.remove(); } catch (e) {}
                    const pm = document.getElementById('project-manager-modal');
                    if (pm) { pm.classList.add('show'); pm.querySelector('.modal-tab-btn[data-tab="templates"]')?.click(); }
                } else {
                    addMessage('assistant-vibe', 'Like not detected yet — please like the project on Websim and try again.');
                    btn.textContent = 'Verify Like';
                    btn.disabled = false;
                }
            } catch (err) {
                console.warn('Verify like failed', err);
                addMessage('assistant-vibe', 'Verification failed. Try again later.');
                btn.textContent = 'Verify Like';
                btn.disabled = false;
            }
        });

        // close if clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // Safety: auto-hide after 2 minutes so it does not block
        setTimeout(() => { if (document.body.contains(modal)) modal.remove(); }, 120000);
    } catch (e) {
        console.warn('showUnlockTemplatesIfNeeded error', e);
    }
}

async function switchProject(id) {
    // Before switching, attempt a quick local save of current project
    if (state.currentProjectId) {
        await saveProjectsToStorage(false);
    }
    
    state.currentProjectId = id;
    const p = state.projects[id];
    
    // Ensure files are hydrated from blobs if this project was cloud-saved
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.style.zIndex = 9999;
    overlay.innerHTML = '<div class="text-white text-xl font-bold animate-pulse">Opening project...</div>';
    document.body.appendChild(overlay);

    try {
        await hydrateProjectFiles(p);
        state.files = p.files;
        state.tabs = p.tabs || Object.keys(p.files).slice(0, 3);
        state.activeTab = p.activeTab || state.tabs[0];
        // Update the UI project title element safely
        const projNameEl = document.getElementById('project-name');
        if (projNameEl) projNameEl.textContent = p.name || projNameEl.textContent;
        
        renderFileTree();
        if (state.activeTab) openFile(state.activeTab);
        updatePreview();
        addMessage('assistant-vibe', `Switched to project: ${p.name}`);
    } finally {
        overlay.remove();
    }
}

window.switchProject = switchProject;

function updateView() {
    const isEditor = state.activeView === 'editor';
    document.getElementById('editor-view').classList.toggle('hidden', !isEditor);
    document.getElementById('preview-view').classList.toggle('hidden', isEditor);
    if (!isEditor) updatePreview();
}

function updateSidebar() {
    elements.sidebar.classList.toggle('collapsed', !state.sidebarOpen);
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.activity-item').forEach(i => i.classList.remove('active'));
    
    if (state.sidebarOpen) {
        document.getElementById(`${state.activePanel}-panel`).classList.add('active');
        document.querySelector(`.activity-item[data-panel="${state.activePanel}"]`).classList.add('active');
        // when Credits panel is opened, render its content
        if (state.activePanel === 'credits') {
            renderCreditsPanel();
        }
    }
}

// AI Message Flow
async function sendMessage() {
    // Prevent using chat when consent not given
    if (!state.consent) {
        alert('AI chat is disabled until you agree to the privacy policy in Settings.');
        // ensure UI enforces restrictions
        enforceConsentRestrictions();
        return;
    }
    const message = elements.chatInput.value.trim();
    if (!message || state.isProcessing) return;

    elements.chatInput.value = '';
    addMessage('user-vibe', message);
    state.conversationHistory.push({ role: 'user', content: message });

    // Count this AI prompt for throttled version snapshots
    try { state.aiPromptsSinceLastVersion = (state.aiPromptsSinceLastVersion || 0) + 1; } catch (e) {}

    state.isProcessing = true;
    state.shouldAbort = false;

    elements.sendBtn.disabled = true;
    elements.abortBtn.classList.remove('hidden');
    elements.abortBtn.disabled = false;
    elements.abortBtn.textContent = 'Stop Generation';

    showGeneratingIndicator(); // show animation while AI is working

    try {
        await runAgenticLoop(message);
    } catch (err) {
        addMessage('assistant-vibe', `Error: ${err.message}`);
    }

    hideGeneratingIndicator(); // hide when done

    // After processing an AI prompt loop, create a version snapshot only every N prompts (throttle = 2)
    try {
        if ((state.aiPromptsSinceLastVersion || 0) >= 2) {
            // createVersion=true will add the version snapshot; forceSync=true keeps previous upload behavior
            await saveProjectsToStorage(true, true);
            state.aiPromptsSinceLastVersion = 0;
        }
    } catch (e) {
        console.warn('Version snapshot after AI prompts failed', e);
    }

    state.isProcessing = false;
    elements.sendBtn.disabled = false;
    elements.abortBtn.classList.add('hidden');
    elements.abortBtn.textContent = 'Stop Generation';
    elements.abortBtn.disabled = false;
}

async function runAgenticLoop(initialPrompt) {
    // This loop will keep prompting the model to "Continue" while agentic mode is on,
    // and will stop when API metadata.agenticComplete === true or tools include task_complete.
    let iterations = 0;
    const maxIterations = 50;
    let history = [];
    let prompt = initialPrompt;

    // push initial user message into conversation history for context
    state.conversationHistory.push({ role: 'user', content: initialPrompt });
    history.push({ role: 'user', content: initialPrompt });

    renderTaskList();

    while (iterations < maxIterations) {
        if (state.shouldAbort) break;
        iterations++;

        const data = await callAI(prompt);

        // show assistant response cleaned
        const assistantText = data.response || '';
        const cleanedResponse = cleanAIResponse(assistantText);
        if (cleanedResponse) {
            addMessage('assistant-vibe', cleanedResponse);
            // place generating indicator right beneath this assistant message
            showGeneratingIndicator();
        }

        // append assistant to histories
        state.conversationHistory.push({ role: 'assistant', content: assistantText });
        history.push({ role: 'assistant', content: assistantText });

        // apply any blocks returned
        const blocks = parseBlocks(assistantText || "");
        // applyBlocks now returns whether any file changes were applied
        const changesApplied = await applyBlocks(blocks);

        // Track consecutive non-agentic no-change responses:
        // Only count when not running in agentic mode. If two non-agentic AI responses in a row
        // performed absolutely no file changes, show the helpful tooltip/snackbar.
        try {
            if (!document.getElementById('agentic-mode')?.checked) {
                state._nonAgenticNoChangeCount = (state._nonAgenticNoChangeCount || 0) + (changesApplied ? 0 : 1);
                if (changesApplied) state._nonAgenticNoChangeCount = 0;
                if ((state._nonAgenticNoChangeCount || 0) >= 2) {
                    // Show a friendly suggestion to clear chat history
                    showSnackbar("Is the AI failing to edit the code in the responses? Clear the chat history using the top right button! LLMs perform better sometimes when not referring to previous chat history.");
                    // reset counter so message isn't repeatedly spammed
                    state._nonAgenticNoChangeCount = 0;
                }
            } else {
                // Reset while agentic
                state._nonAgenticNoChangeCount = 0;
            }
        } catch (e) {
            console.warn('Non-agentic no-change tracking error', e);
        }

        // refresh task list if created/updated
        if (blocks.some(b => b.type === 'create-task-list' || b.type === 'create_task_list')) {
            renderTaskList();
        }

        // Check completion flags in metadata and tools
        const meta = data.metadata || {};
        const tools = Array.isArray(data.tools) ? data.tools : [];
        const hasTaskCompleteTool = tools.some(t => (t.name && t.name === 'task_complete') || (t.tool && t.tool === 'task_complete'));
        const agenticCompleteFlag = !!meta.agenticComplete;

        // If AI signalled completion via metadata or task_complete tool, stop looping
        if (agenticCompleteFlag || hasTaskCompleteTool) {
            addMessage('assistant-vibe', 'Agentic run signalled complete.');
            break;
        }

        // Do NOT pause for generic tools such as create_task_list; continue the agentic loop unless task_complete is returned.
        // (This keeps the agent iterating automatically — external tool execution is not required for create_task_list.)

        // If user disabled agentic or requested abort, stop
        const agenticEnabled = document.getElementById('agentic-mode')?.checked;
        if (!agenticEnabled || state.shouldAbort) break;

        // Prepare the "Continue" user prompt and append to histories
        const continuePromptBase = 'Continue with the next step.';
        let continuePrompt = continuePromptBase;

        // incorporate pending tasks context if available
        const pendingTasks = Array.isArray(state.tasks) ? state.tasks.filter(t => t.status === 'pending') : [];
        if (pendingTasks.length > 0) {
            continuePrompt += `\nRemaining tasks:\n${pendingTasks.map(t => `- [${t.id}] ${t.description} — ${t.status}`).join('\n')}`;
        }

        // include any generation notes (runtime errors / important changes) as things to keep in mind
        if (Array.isArray(state.generationNotes) && state.generationNotes.length > 0) {
            const notesText = state.generationNotes.map((n, i) => `(${i+1}) ${n}`).join('\n');
            continuePrompt += `\n\nKeep in mind these important notes observed during generation:\n${notesText}`;
            // clear notes after including them so they don't repeat endlessly
            state.generationNotes = [];
        }

        // push the continue prompt into conversation history
        state.conversationHistory.push({ role: 'user', content: continuePrompt });
        history.push({ role: 'user', content: continuePrompt });

        // set prompt to the composed continuePrompt for the next iteration
        prompt = continuePrompt;

        // small delay to be polite to the API
        await new Promise(r => setTimeout(r, 300));
    }

    renderTaskList();
}

async function callAI(prompt) {
    const selectedModel = state.currentModel || 'glm-4.7-flash';

    // Composition of documentation based on abilities
    let documentation = "";
    // Attempt to determine the project creator username to pre-fill SDK examples
    let _vibesim_creator = 'your_websim_username';
    try {
        if (window.websim && typeof window.websim.getCreatedBy === 'function') {
            const cb = await window.websim.getCreatedBy();
            if (cb && cb.username) _vibesim_creator = cb.username;
        }
    } catch (e) {
        // ignore — fall back to placeholder
    }

    if (state.abilities.websim_services) {
        documentation += `
## Websim Services (WebsimSocket)
Enables use of Websim features such as AI model helpers, clips, comments, realtime multiplayer and persisted database records.
Initialize: const room = new WebsimSocket(); await room.initialize();
Records: room.collection('type').create({...}), room.collection('type').getList(), room.collection('type').subscribe(cb).
Presence: room.updatePresence({ x,y }), room.subscribePresence(cb).
Room State: room.updateRoomState({ ... }), room.subscribeRoomState(cb).
Realtime events: room.send({ type: 'event', ... }); room.onmessage = (evt) => { ... }.
AI & Media: websim.chat.completions.create({ messages }), websim.imageGen({ prompt }), websim.textToSpeech({ text }).
Clips/Comments: window.websim.postComment({ content, credits, parent_id }).
Note: comments, multiplayer and database features are simulated in the preview for security and will work fully when exported and run on Websim.
`;
    }
    if (state.abilities.ads) {
        documentation += `
## WebSimAdsSDK
Add in-game ads and earn Websim Credits. More info, earning methods and rules at https://websim.com/@CoponStackos/websim-ads-platform-advertise-your-games
Include SDK: <script src="https://6nil2byhncinf415tdqu.c.websim.com/api.js"></script>
Init example (creator pre-filled): const ads = new WebSimAds({ creator: '${_vibesim_creator}' });
Interstitials: ads.showInterstitial({ onStart, onClose }) — use at natural breaks (e.g., level end); respect cooldowns.
Rewarded: ads.showRewarded({ onStart, onReward, onClose }) — for optional player rewards.
Banners: ads.renderBanner('#container') — container recommended to be square (1:1).
`;
    }



    // Build a guarded codebase payload that respects the ~250KB (250 * 1024) data field limit.
    // We cap per-file excerpts and also stop including file content once the aggregated payload nears the limit.
    let body;
    (function buildBodySafely() {
        const MAX_TOTAL_BYTES = 250 * 1024; // 250 KB safe ceiling
        const PER_FILE_SOFT_LIMIT = 8 * 1024; // prefer to send up to 8KB per file when possible
        const PER_FILE_HARD_LIMIT = 16 * 1024; // never send more than 16KB per file
        const encoder = (s) => {
            try { return new Blob([s]).size; } catch (e) { return String(s).length; }
        };

        const filesEntries = Object.entries(state.files || {});
        const filesPayload = [];
        let usedBytes = 0;

        // Reserve some bytes for other fields in the body (prompt, metadata, conversation)
        const reserveForMeta = 32 * 1024; // 32KB reserved
        const allowedBytesForFiles = Math.max(16 * 1024, MAX_TOTAL_BYTES - reserveForMeta);

        for (const [path, f] of filesEntries) {
            const fileObj = { path };
            const raw = (f && typeof f.content !== 'undefined') ? String(f.content) : '';
            // If blobUrl exists and content is absent, include blobUrl instead of content
            if (f && f.blobUrl && (!raw || raw.length < 10)) {
                fileObj.blobUrl = f.blobUrl;
                filesPayload.push(fileObj);
                continue;
            }

            // If content is a data: URL or wrapped data URL, send small placeholder (we won't inline huge binaries)
            if (typeof raw === 'string' && (raw.startsWith('data:') || raw.startsWith('/* binary data url */'))) {
                // send a short note and the actual data will be fetched by the server if needed (or user will upload)
                const preview = raw.slice(0, 120);
                fileObj.content = preview;
                fileObj.truncated = true;
                // account approximate bytes
                usedBytes += encoder(preview);
                filesPayload.push(fileObj);
                if (usedBytes > allowedBytesForFiles) break;
                continue;
            }

            // Determine per-file send size based on remaining budget
            const remainingBudget = Math.max(0, allowedBytesForFiles - usedBytes);
            if (remainingBudget <= 0) {
                // No more budget: include only path and indicate omitted content
                fileObj.content = '';
                fileObj.truncated = true;
                filesPayload.push(fileObj);
                continue;
            }

            const perFileSendLimit = Math.min(PER_FILE_SOFT_LIMIT, remainingBudget, PER_FILE_HARD_LIMIT);
            // Prefer to send up to perFileSendLimit characters; if the file is smaller, send it all.
            let snippet = raw;
            if (encoder(raw) > perFileSendLimit) {
                // Trim smartly: keep head + tail to preserve context
                const approxCharLimit = Math.floor(perFileSendLimit * 0.9); // give margin for multi-byte
                const head = raw.slice(0, Math.ceil(approxCharLimit * 0.6));
                const tail = raw.slice(-Math.floor(approxCharLimit * 0.3));
                snippet = head + "\n\n/* ...TRUNCATED... */\n\n" + tail;
                fileObj.truncated = true;
            } else {
                fileObj.truncated = false;
            }

            // Final size check before appending
            const snippetBytes = encoder(snippet);
            if (usedBytes + snippetBytes > allowedBytesForFiles) {
                // Not enough space to include this snippet; include an empty placeholder and mark truncated
                fileObj.content = '';
                fileObj.truncated = true;
                filesPayload.push(fileObj);
                // break out if budget exhausted
                if (usedBytes >= allowedBytesForFiles) break;
                continue;
            }

            fileObj.content = snippet;
            usedBytes += snippetBytes;
            filesPayload.push(fileObj);

            // If remaining budget is very small, stop adding more file contents
            if ((allowedBytesForFiles - usedBytes) < 512) break;
        }

        // If we couldn't include many files' content, attach a short index/structure to help the model locate files
        const structure = Object.keys(state.files || {}).slice(0, 500).join('\n');

        // Attach the safely-built body to outer scope
        window.__vibesim_last_built_codebase_bytes = usedBytes;
        window.__vibesim_last_built_codebase_files = filesPayload;

        body = {
            prompt: documentation ? `${documentation}\n\nUser Request: ${prompt}` : prompt,
            model: selectedModel,
            agentic: document.getElementById('agentic-mode').checked,
            codebase: {
                files: filesPayload,
                structure
            },
            conversationHistory: state.conversationHistory.slice(-10)
        };
    })();

    // Post directly to the worker chat endpoint (worker base URL + /api/chat)
    const res = await fetch(state.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    // If the request failed at HTTP level, surface a helpful assistant message for server errors
    if (!res.ok) {
        // Handle server-side outages (5xx) with a clear message advising model switch / retry
        if (res.status >= 500) {
            addMessage('assistant-vibe', 'AI model temporarily unavailable (server error). Try switching to a different model or try again later.');
            return { success: false, error: `Server error ${res.status}` };
        }
        // Handle rate-limits / client errors gracefully (429, 403 already handled later)
        if (res.status === 429) {
            addMessage('assistant-vibe', 'Request rate limit reached. Try switching to a different model or try again in a moment.');
            return { success: false, error: 'rate_limited' };
        }
        // For other non-ok statuses we'll attempt to parse the response body below and fall through
    }

    const data = await res.json().catch(() => ({}));

    // Context limit error handling (per new v10.0 docs)
    if (res.status === 400 && data && data.error && /context/i.test(String(data.error))) {
        try {
            const info = data.contextInfo || {};
            const breakdown = info.breakdown || {};
            // Find largest contributor in breakdown
            let largestKey = null;
            let largestVal = 0;
            Object.entries(breakdown).forEach(([k, v]) => {
                const n = Number(v) || 0;
                if (n > largestVal) { largestVal = n; largestKey = k; }
            });

            const parts = [];
            parts.push('The AI worker rejected the request due to exceeding the model context window.');
            parts.push('');
            parts.push(`Model limit: ${info.max ?? 'unknown'} tokens`);
            parts.push(`Estimated used: ${info.used ?? 'unknown'} tokens`);
            parts.push('');
            parts.push('Breakdown:');
            Object.entries(breakdown).forEach(([k, v]) => parts.push(`• ${k}: ${v}`));
            parts.push('');
            parts.push(largestKey ? `It looks like "${largestKey}" is using the most tokens.` : '');
            parts.push('');
            parts.push('You can either switch to a model with a larger context window, or clear the chat (top-right Clear) to reduce context. Alternatively, shorten your codebase or the prompt.');

            // Show dialog with actionable options
            const choice = await showDialog({
                title: 'Context Limit Exceeded',
                body: parts.join('\n'),
                input: false,
                confirmText: 'Switch Model',
                cancelText: 'Clear Chat'
            });

            if (choice) {
                // open model dropdown so user can change model
                const menu = document.getElementById('model-menu');
                if (menu) {
                    menu.classList.add('show');
                    showSnackbar('Select a larger context model from the model menu.');
                } else {
                    showSnackbar('Open the model dropdown to choose a model with larger context.');
                }
            } else {
                // Clear conversation history and UI chat so context reduces
                const clearBtn = document.getElementById('clear-chat');
                if (clearBtn) clearBtn.click();
                showSnackbar('Chat cleared to reduce context. Try again.');
            }
        } catch (e) {
            console.warn('Context limit dialog failed', e);
            addMessage('assistant-vibe', 'Request too large for model context. Try switching to a larger-context model or clearing chat.');
        }
        // Return error object for callers to handle gracefully
        return { success: false, error: data.error || 'Input exceeds maximum context length.' , contextInfo: data.contextInfo || null };
    }

    // v10.0 Soft Delete Handling
    if (res.status === 403 && data.error && data.error.includes('deleted')) {
        localStorage.clear();
        addMessage('assistant-vibe', 'This account has been deleted.');
        const lockout = document.createElement('div');
        lockout.className = 'modal-overlay show';
        lockout.style.zIndex = 7000;
        lockout.innerHTML = `
            <div class="project-modal" style="max-width:500px; padding:24px; text-align:center">
                <h2 style="font-size:20px; font-weight:800; margin-bottom:12px">Account Removed</h2>
                <p style="color:#9aa6b2; margin-bottom:20px">Your account has been deleted per your request. You can no longer access VibeSim features.</p>
                <button class="btn-primary" onclick="window.location.reload()">Reload</button>
            </div>
        `;
        document.body.appendChild(lockout);
        return { success: false };
    }

    // If the API returned a non-empty assistant response, record it and update local balance.
    if (data && data.response && String(data.response).trim().length > 0) {
        state.conversationHistory.push({ role: 'assistant', content: data.response });
        
        // v10.0 Granular Payment & Rate Limit Update
        if (data.metadata && data.metadata.rateLimit) {
            const rl = data.metadata.rateLimit;
            state.balance = (rl.dailyRemaining || 0) + (rl.creditsRemaining || 0);
        } else if (data.metadata && typeof data.metadata.cost === 'number') {
            state.balance = Math.max(0, state.balance - data.metadata.cost);
        }

        const el = document.getElementById('balance-display');
        if (el) el.textContent = `Bal: ${state.balance}`;
        
        return data;
    }

    // If we reach here, the AI returned an empty or missing response.
    // Ensure the UI shows a clear assistant message indicating the failure (instead of silently hiding "Generating").
    try {
        // Hide any generating indicator immediately
        hideGeneratingIndicator();
    } catch (e) { /* ignore */ }

    // Post a visible assistant-style failure message so users know the model didn't respond.
    const failureMsg = 'AI failed to respond (empty response). Please try again.';
    try {
        addMessage('assistant-vibe', failureMsg);
        // Also push a lightweight assistant entry into history so it's clear in context
        state.conversationHistory.push({ role: 'assistant', content: failureMsg });
    } catch (e) {
        console.warn('Failed to inject AI failure message into chat', e);
    }

    // Return the original data so callers can still inspect metadata/errors
    return data;
}

function cleanAIResponse(text) {
    // Render AI-provided content safely while preserving structured "file" blocks and hiding <think> sections.
    if (!text) return '';
    try {
        let raw = String(text);

        // 1) Extract any <think>...</think> blocks and replace them with markers we can restore later as hidden content
        const thoughts = [];
        raw = raw.replace(/<think>([\s\S]*?)<\/think>/gi, function (_, inner) {
            const id = `vibesim_thought_${thoughts.length}`;
            thoughts.push(inner);
            // placeholder will be replaced with a button that opens the hidden thoughts in a modal
            return `[[${id}]]`;
        });

        // 2) Preserve special triple-backtick file blocks so they are not mangled
        const blocks = parseBlocks(raw);
        const tempMarkers = [];
        if (blocks && blocks.length) {
            blocks.forEach((block, idx) => {
                const marker = `__VIBESIM_BLOCK_MARKER_${idx}__`;
                tempMarkers.push({ marker, blockRaw: block.raw || '' });
                const regex = new RegExp('```' + block.type + '\\n[\\s\\S]*?```', 'g');
                raw = raw.replace(regex, marker);
            });
        }

        // 3) Apply lightweight markdown -> HTML conversions for headings, bold/italic, and lists
        // Headings (## or ###)
        raw = raw.replace(/^\s*######\s*(.+)$/gm, '<h6>$1</h6>');
        raw = raw.replace(/^\s*#####\s*(.+)$/gm, '<h5>$1</h5>');
        raw = raw.replace(/^\s*####\s*(.+)$/gm, '<h4>$1</h4>');
        raw = raw.replace(/^\s*###\s*(.+)$/gm, '<h3>$1</h3>');
        raw = raw.replace(/^\s*##\s*(.+)$/gm, '<h2>$1</h2>');
        raw = raw.replace(/^\s*#\s*(.+)$/gm, '<h1>$1</h1>');

        // Bold and italic
        raw = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        raw = raw.replace(/\*(.+?)\*/g, '<em>$1</em>');
        raw = raw.replace(/__(.+?)__/g, '<strong>$1</strong>');
        raw = raw.replace(/_(.+?)_/g, '<em>$1</em>');

        // Simple unordered lists: lines starting with "- " or "* "
        raw = raw.replace(/^(?:\s*[-*]\s+.+(\r?\n|$))+?/gm, function (match) {
            const items = match.trim().split(/\r?\n/).filter(Boolean).map(l => l.replace(/^\s*[-*]\s+/, '').trim());
            if (!items.length) return match;
            return '<ul>' + items.map(it => `<li>${it}</li>`).join('') + '</ul>';
        });

        // 4) Neutralize any remaining generic code fences
        raw = raw.replace(/```[\s\S]*?```/g, '<div class="ai-file-placeholder">[Code omitted]</div>');

        // 5) Restore special preserved blocks as non-executable placeholders (escaped)
        tempMarkers.forEach((m) => {
            const rawEscaped = escapeHtml(m.blockRaw || '');
            const summaryHtml = `<div class="ai-file-placeholder" data-vibesim-raw="${rawEscaped}">[AI file block preserved — open in editor to apply]</div>`;
            raw = raw.replace(m.marker, summaryHtml);
        });

        // 6) Restore thought markers into a safe button + hidden container (escaped content in data attribute)
        if (thoughts.length > 0) {
            thoughts.forEach((t, idx) => {
                const id = `vibesim_thought_${idx}`;
                const escaped = escapeHtml(t);
                // Button that calls global showThoughts with id and the escaped content
                const btnHtml = `<div style="margin:6px 0"><button class="btn-secondary" onclick="showThoughts('${id}')">View Thoughts</button></div><div id="${id}" style="display:none" data-vibesim-thought="${escaped}"></div>`;
                raw = raw.replace(`[[${id}]]`, btnHtml);
            });
        }

        // 7) Sanitize and return safe HTML
        return DOMPurify.sanitize(raw).trim();
    } catch (e) {
        // Fallback: escape HTML and return minimal safe text
        return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    }
}

// Helper to display hidden AI thoughts in a modal
function showThoughts(id) {
    try {
        const el = document.getElementById(id);
        if (!el) return;
        const content = el.getAttribute('data-vibesim-thought') || '';
        const modalId = 'vibesim-thoughts-modal';
        // remove existing
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal-overlay show';
        modal.style.zIndex = 8000;
        modal.innerHTML = `
            <div class="project-modal" style="max-width:720px; width: min(92vw,720px);">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between">
                    <span>AI Thoughts</span>
                    <button id="${modalId}-close" class="btn-secondary">Close</button>
                </div>
                <div style="padding:16px; color:#cbd5e1; font-size:13px; line-height:1.45; max-height:60vh; overflow:auto;">
                    <pre style="white-space:pre-wrap; font-family:JetBrains Mono, monospace; font-size:13px; color:#e6eef8; background:transparent; border:none; padding:0">${content}</pre>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector(`#${modalId}-close`).addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (err) {
        console.warn('showThoughts error', err);
    }
}

function parseBlocks(text) {
    const blocks = [];
    const regex = /```(generate-file|rewrite-file|search-replace|continue-file|generate-image)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const type = match[1];
        const yaml = parsePseudoYAML(match[2]);
        blocks.push({ type, ...yaml });
    }
    return blocks;
}

function parsePseudoYAML(content) {
    const lines = content.split('\n');
    const result = {};
    let currentKey = null;
    let currentValue = [];
    let isMultiline = false;

    for (let line of lines) {
        const keyMatch = line.match(/^([a-z\-]+):\s*(\|)?\s*(.*)$/i);
        if (keyMatch) {
            if (currentKey) result[currentKey] = isMultiline ? currentValue.join('\n').trimEnd() : currentValue.join(' ').trim();
            currentKey = keyMatch[1].toLowerCase().replace(/-([a-z])/g, g => g[1].toUpperCase());
            isMultiline = !!keyMatch[2];
            currentValue = keyMatch[3] ? [keyMatch[3]] : [];
        } else if (currentKey) {
            currentValue.push(isMultiline ? (line.startsWith(' ') ? line.substring(1) : line) : line.trim());
        }
    }
    if (currentKey) result[currentKey] = isMultiline ? currentValue.join('\n').trimEnd() : currentValue.join(' ').trim();
    return result;
}

async function applyBlocks(blocks) {
    // Automatically apply AI-provided file changes and task-list blocks immediately (no manual approval).
    // Returns true if any file changes were applied, false otherwise.
    if (!blocks || blocks.length === 0) return false;

    for (const block of blocks) {
        // Handle create_task_list (or create-task-list) specially to populate state.tasks
        if (block.type === 'create-task-list' || block.type === 'create_task_list') {
            try {
                // Support multiple formats: JSON array, simple "key: value" lines, or YAML-like "tasks:" lists
                let tasks = [];

                // If block.content looks like YAML tasks: - id: ... then parse that
                if (block.content && typeof block.content === 'string' && /^\s*tasks\s*:/i.test(block.content)) {
                    // crude YAML-ish parser for list of task objects
                    const lines = block.content.split('\n');
                    let cur = null;
                    for (let raw of lines) {
                        const line = raw.replace(/\r/g, '');
                        const itemMatch = line.match(/^\s*-\s*(.*)$/);
                        if (itemMatch) {
                            if (cur) tasks.push(cur);
                            cur = {};
                            const rest = itemMatch[1].trim();
                            if (rest) {
                                const kv = rest.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
                                if (kv) cur[kv[1]] = kv[2].replace(/^"|"$/g, '');
                            }
                            continue;
                        }
                        const kv = line.match(/^\s*([a-zA-Z0-9_\-]+):\s*(.*)$/);
                        if (kv && cur) {
                            cur[kv[1]] = kv[2].replace(/^"|"$/g, '');
                        }
                    }
                    if (cur) tasks.push(cur);
                } else if (block.content) {
                    // try JSON parse first
                    try {
                        const parsed = JSON.parse(block.content);
                        if (Array.isArray(parsed)) tasks = parsed;
                        else if (Array.isArray(parsed.tasks)) tasks = parsed.tasks;
                    } catch (e) {
                        // fallback: parse simple list format (lines with - and key:value)
                        const lines = block.content.split('\n').map(l => l.trim()).filter(Boolean);
                        let cur = {};
                        lines.forEach(line => {
                            const m = line.match(/^-?\s*id:\s*["']?([^"']+)["']?/i);
                            if (m) { if (Object.keys(cur).length) tasks.push(cur); cur = { id: m[1] }; return; }
                            const kv = line.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
                            if (kv && cur) {
                                const key = kv[1].trim();
                                const val = kv[2].trim().replace(/^"|"$/g, '');
                                cur[key] = val;
                            }
                        });
                        if (Object.keys(cur).length) tasks.push(cur);
                    }
                }

                // Normalize tasks into state.tasks with expected fields
                state.tasks = (tasks.length ? tasks : state.tasks || []).map((t, idx) => {
                    return {
                        id: String(t.id ?? t.ID ?? (idx + 1)),
                        description: t.description ?? t.desc ?? t.title ?? `Task ${idx + 1}`,
                        status: (t.status ?? 'pending').toLowerCase()
                    };
                });

                // update UI (task panel and visual viewer)
                renderTaskList();
                showCustomTaskViewer(state.tasks);
                addMessage('assistant-vibe', `Task list created/updated with ${state.tasks.length} items.`);
            } catch (e) {
                console.warn('Failed to parse create_task_list block', e);
            }
            continue;
        }

        const path = block.path || 'untitled';
        let action = 'updated';

        // Helper: detect an unfinished content heuristic (AI may have truncated)
        const contentText = (block.content ?? '') + '';
        const looksTruncated = /\.\.\.$/.test(contentText.trim()) || contentText.trim().endsWith('[TRUNCATED]') || contentText.trim().length > 0 && contentText.trim().length < 30 && /\n$/.test(contentText) === false;

        // For file operations, apply whatever content we have and mark incomplete if heuristic triggers
        if (block.type === 'generate-file') {
            // add new file or overwrite if exists
            state.files[path] = { content: block.content || '', language: getLang(path) };
            action = 'added';

            if (looksTruncated) {
                // mark as incomplete and notify: record note and create Continue UI
                const note = `INCOMPLETE_WRITE: ${path}`;
                state.generationNotes = state.generationNotes || [];
                state.generationNotes.push(note);

                // In agentic mode, push a prompt to the conversation history to finish this file automatically
                const agenticEnabled = document.getElementById('agentic-mode')?.checked;
                if (agenticEnabled) {
                    state.conversationHistory.push({ role: 'system', content: `Previous write for file "${path}" was incomplete — please continue writing the rest of "${path}" until complete.` });
                    addMessage('assistant-vibe', `Applied partial content for ${path}; agentic run will be asked to continue.`);
                } else {
                    // Non-agentic: insert a "Continue" card in chat UI so the user can request completion
                    const contDiv = document.createElement('div');
                    contDiv.className = 'ai-status-card';
                    contDiv.style.display = 'flex';
                    contDiv.style.justifyContent = 'space-between';
                    contDiv.style.alignItems = 'center';

                    const left = document.createElement('div');
                    left.style.flex = '1';
                    left.innerHTML = `<div style="font-weight:700;color:#ffd2a6">The code writing for "${escapeHtml(path)}" was not completed.</div>
                                      <div style="font-size:12px;color:#9aa6b2;margin-top:6px">Finish writing the file?</div>`;

                    const right = document.createElement('div');
                    right.style.display = 'flex';
                    right.style.gap = '8px';

                    const continueBtn = document.createElement('button');
                    continueBtn.className = 'btn-primary';
                    continueBtn.textContent = 'Continue';
                    continueBtn.addEventListener('click', async () => {
                        // re-enable error logging and hide prompt, then send a Continue instruction to AI
                        state._suppressErrors = false;
                        continueBtn.disabled = true;
                        continueBtn.textContent = 'Requested';
                        elements.chatInput.value = `Continue writing file: ${path}`;
                        // auto-trigger sending (non-agentic) so user sees result immediately
                        sendMessage();
                        try { contDiv.remove(); } catch (e) {}
                    });

                    // While this prompt exists, suppress error cards so runtime errors won't break the flow
                    state._suppressErrors = true;

                    right.appendChild(continueBtn);
                    contDiv.appendChild(left);
                    contDiv.appendChild(right);
                    elements.chatMessages.appendChild(contDiv);
                    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
                }
            }
        } else if (block.type === 'rewrite-file') {
            // replace file content
            state.files[path] = { content: block.content || '', language: getLang(path) };
            action = 'rewritten';

            if (looksTruncated) {
                const note = `INCOMPLETE_WRITE: ${path}`;
                state.generationNotes = state.generationNotes || [];
                state.generationNotes.push(note);
                const agenticEnabled = document.getElementById('agentic-mode')?.checked;
                if (agenticEnabled) {
                    state.conversationHistory.push({ role: 'system', content: `Previous rewrite for file "${path}" was incomplete — please continue writing the rest of "${path}".` });
                    addMessage('assistant-vibe', `Applied partial rewrite for ${path}; agentic run will be asked to continue.`);
                } else {
                    // create Continue UI as above
                    const contDiv = document.createElement('div');
                    contDiv.className = 'ai-status-card';
                    contDiv.style.display = 'flex';
                    contDiv.style.justifyContent = 'space-between';
                    contDiv.style.alignItems = 'center';

                    const left = document.createElement('div');
                    left.style.flex = '1';
                    left.innerHTML = `<div style="font-weight:700;color:#ffd2a6">The code rewrite for "${escapeHtml(path)}" was not completed.</div>
                                      <div style="font-size:12px;color:#9aa6b2;margin-top:6px">Finish rewriting the file?</div>`;

                    const right = document.createElement('div');
                    right.style.display = 'flex';
                    right.style.gap = '8px';

                    const continueBtn = document.createElement('button');
                    continueBtn.className = 'btn-primary';
                    continueBtn.textContent = 'Continue';
                    continueBtn.addEventListener('click', async () => {
                        state._suppressErrors = false;
                        continueBtn.disabled = true;
                        continueBtn.textContent = 'Requested';
                        elements.chatInput.value = `Continue rewriting file: ${path}`;
                        sendMessage();
                        try { contDiv.remove(); } catch (e) {}
                    });

                    state._suppressErrors = true;

                    right.appendChild(continueBtn);
                    contDiv.appendChild(left);
                    contDiv.appendChild(right);
                    elements.chatMessages.appendChild(contDiv);
                    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
                }
            }
        } else if (block.type === 'search-replace') {
            // apply simple search/replace safely
            if (state.files[path]) {
                try {
                    const search = block.search ?? block.raw?.search ?? '';
                    const replace = block.replace ?? block.raw?.replace ?? '';
                    if (search !== '') {
                        // avoid executing regex from AI; use plain string replacement
                        state.files[path].content = state.files[path].content.split(search).join(replace);
                        action = 'edited';
                    } else if (block.content !== undefined) {
                        // fallback: replace full content if provided
                        state.files[path].content = block.content;
                        action = 'edited';
                    }
                } catch (e) {
                    console.warn('Search/replace failed', e);
                }
            } else {
                state.files[path] = { content: block.content || '', language: getLang(path) };
                action = 'added';
            }
        } else if (block.type === 'continue-file' || block.type === 'continue_file') {
            // Append content after the file's last character (useful when AI returns only continuation)
            try {
                const appendContent = block.content ?? '';
                if (!state.files[path]) {
                    state.files[path] = { content: appendContent, language: getLang(path) };
                    action = 'added';
                } else {
                    state.files[path].content = (state.files[path].content || '') + appendContent;
                    action = 'edited';
                }
            } catch (e) {
                console.warn('Continue-file append failed', e);
                state.files[path] = { content: block.content || '', language: getLang(path) };
                action = 'added';
            }
        } else if (block.type === 'generate-image') {
            // Generate an image asset via websim.imageGen and store its URL as blobUrl in state.files
            try {
                const prompt = block.content || block.prompt || '';
                const removeBgRaw = block.removeBackground ?? block['remove-background'];
                const removeBg = (removeBgRaw === true) || (String(removeBgRaw).toLowerCase() === 'true');

                addMessage('assistant-vibe', `Generating image asset for ${path}…`);
                let genOpts = { prompt: prompt || 'Illustration', transparent: !!removeBg };
                if (block.aspect_ratio) genOpts.aspect_ratio = block.aspect_ratio;
                if (block.width && block.height) { genOpts.width = Number(block.width); genOpts.height = Number(block.height); }

                let resultUrl = null;
                try {
                    if (window.websim && typeof window.websim.imageGen === 'function') {
                        const res = await window.websim.imageGen(genOpts);
                        resultUrl = res && (res.url || res.image_url || res.data) ? (res.url || res.image_url || res.data) : null;
                    } else {
                        resultUrl = removeBg ? 'https://via.placeholder.com/512.png?text=Image+(transparent)' : 'https://via.placeholder.com/512.png?text=Image';
                    }
                } catch (e) {
                    console.warn('imageGen call failed', e);
                    resultUrl = removeBg ? 'https://via.placeholder.com/512.png?text=Image+err' : 'https://via.placeholder.com/512.png?text=Image+err';
                }

                state.files[path] = { content: '', blobUrl: resultUrl, language: 'image' };
                action = 'added';

                addStatusCard('Generated', path);
                addMessage('assistant-vibe', `Image generated and saved to ${path}.`);
            } catch (e) {
                console.warn('generate-image block failed', e);
                addMessage('assistant-vibe', `Image generation failed for ${path}: ${e.message}`);
            }
        } else {
            // unknown block type: store as file if content present
            if (block.content !== undefined) {
                state.files[path] = { content: block.content, language: getLang(path) };
                action = 'added';
            }
        }

        // mark project modified when AI applies changes
        if (!state.projects[state.currentProjectId]) state.projects[state.currentProjectId] = {};
        state.projects[state.currentProjectId].modified = true;

        // update UI immediately
        renderFileTree();
        updatePreview();
        addStatusCard(action.charAt(0).toUpperCase() + action.slice(1), path);
        try { saveProjectsToStorage(); } catch(e){ console.warn('save after applyBlocks failed', e); }

        // record important file change as a generation note so the agent can be reminded in the next "Continue"
        try {
            if (!Array.isArray(state.generationNotes)) state.generationNotes = [];
            const note = `${action.toUpperCase()}: ${path} (${(block && block.type) ? block.type : 'change'})`;
            state.generationNotes.push(note);
        } catch (e) { /* ignore */ }

        // If the applied file is the active tab and monaco is ready, update editor content
        if (state.activeTab && state.files[state.activeTab] && monacoEditor) {
            const model = monacoEditor.getModel();
            if (model) {
                monacoEditor.pushUndoStop();
                monacoEditor.executeEdits('', [{
                    range: model.getFullModelRange(),
                    text: state.files[state.activeTab].content || '',
                    forceMoveMarkers: true
                }]);
                const lang = getLang(state.activeTab);
                monaco.editor.setModelLanguage(model, lang === 'javascript' ? 'javascript' : (lang === 'css' ? 'css' : (lang === 'html' ? 'html' : 'plaintext')));
                monacoEditor.pushUndoStop();
            }
        }
    }

    // ensure task UI refresh after processing all blocks
    renderTaskList();

    // After agentic/processing completes, flush any deferred iframe runtime errors that were buffered
    if (Array.isArray(state._deferredErrors) && state._deferredErrors.length > 0) {
        try {
            state._deferredErrors.forEach(err => {
                createErrorCard(err.brief, err.full);
            });
        } catch (e) {
            console.warn('Failed to flush deferred errors', e);
        } finally {
            state._deferredErrors = [];
        }
    }

    // Return whether any changes were applied during block handling
    return !!(typeof applyBlocks._changesApplied !== 'undefined' ? applyBlocks._changesApplied : true);
}

function addStatusCard(action, path) {
    // Lightweight non-interactive status card showing the action performed by the AI.
    const div = document.createElement('div');
    div.className = 'ai-status-card';
    const colorClass = action.toLowerCase().includes('add') || action.toLowerCase().includes('added') ? 'badge-added' : (action.toLowerCase().includes('edit') || action.toLowerCase().includes('edited') ? 'badge-edited' : '');
    const displayPath = path || 'unknown';
    const label = action || 'Updated';

    div.innerHTML = `
        <div class="ai-status-icon"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6" opacity=".3"/></svg></div>
        <div class="ai-status-text">${displayPath}</div>
        <div style="display:flex;gap:8px;align-items:center">
            <div class="ai-status-badge ${colorClass}" style="margin-right:8px">${label}</div>
        </div>
    `;

    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function addMessage(role, content) {
    if (!content) return;
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `<div class="message-content">${content.replace(/\n/g, '<br>')}</div>`;
    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    // Autosave project state after any chat message is added to ensure chat-modifications persist
    try { saveProjectsToStorage(); } catch (e) { console.warn('Autosave failed after chat message', e); }
}

function logToConsole(type, message) {
    const container = document.getElementById('console-logs');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `console-msg ${type} border-b border-[#222] pb-1`;
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordBreak = 'break-word';

    let color = '#ccc';
    if (type === 'warn') color = '#fbbf24';
    if (type === 'error') color = '#f87171';
    if (type === 'info') color = '#60a5fa';
    if (type === 'command') color = '#9ca3af';

    div.style.color = color;
    if (type === 'command') {
        div.textContent = message;
        div.style.fontStyle = 'italic';
    } else {
        div.textContent = `[${type.toUpperCase()}] ${message}`;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Render a prettier task list UI into the existing task-panel element
function renderTaskList() {
    const panel = document.getElementById('task-panel');
    const listContainer = document.getElementById('task-list');
    if (!panel || !listContainer) return;

    // show the panel when tasks exist
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    if (tasks.length === 0) {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');

    listContainer.innerHTML = '';
    tasks.forEach(t => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.padding = '8px 0';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.03)';

        const left = document.createElement('div');
        left.innerHTML = `<div style="font-weight:600">${escapeHtml(t.description)}</div>
                          <div style="font-size:11px;color:#9aa6b2;margin-top:4px">ID: ${escapeHtml(t.id)}</div>`;

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.gap = '8px';
        right.style.alignItems = 'center';

        const status = document.createElement('div');
        status.textContent = (t.status || 'pending').toUpperCase();
        status.style.fontSize = '11px';
        status.style.padding = '6px 8px';
        status.style.borderRadius = '8px';
        status.style.fontWeight = '700';
        if ((t.status || '').toLowerCase() === 'pending') {
            status.style.background = 'rgba(255,165,0,0.08)';
            status.style.color = '#fbbf24';
        } else if ((t.status || '').toLowerCase() === 'done' || (t.status || '').toLowerCase() === 'completed') {
            status.style.background = 'rgba(34,197,94,0.08)';
            status.style.color = '#22c55e';
        } else {
            status.style.background = 'rgba(59,130,246,0.06)';
            status.style.color = '#93c5fd';
        }

        const actionBtn = document.createElement('button');
        actionBtn.textContent = (t.status || 'pending').toLowerCase() === 'pending' ? 'Mark Done' : 'Reopen';
        actionBtn.className = 'btn-secondary';
        actionBtn.style.padding = '6px 10px';
        actionBtn.style.fontSize = '12px';
        actionBtn.addEventListener('click', () => {
            t.status = (t.status || 'pending').toLowerCase() === 'pending' ? 'done' : 'pending';
            renderTaskList();
            saveProjectsToStorage();
        });

        right.appendChild(status);
        right.appendChild(actionBtn);

        item.appendChild(left);
        item.appendChild(right);
        listContainer.appendChild(item);
    });
}

/* Custom Tasks Viewer: shows a compact floating card with task list and quick toggles */
function showCustomTaskViewer(tasks) {
    // remove existing viewer
    const existing = document.getElementById('custom-tasks-viewer');
    if (existing) existing.remove();

    if (!Array.isArray(tasks) || tasks.length === 0) return;

    const container = document.createElement('div');
    container.id = 'custom-tasks-viewer';
    container.className = 'ai-status-card';
    container.style.position = 'fixed';
    container.style.right = '420px';
    container.style.bottom = '20px';
    container.style.width = '320px';
    container.style.maxHeight = '46vh';
    container.style.overflow = 'auto';
    container.style.zIndex = 1500;
    container.style.flexDirection = 'column';
    container.style.gap = '8px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.innerHTML = `<div style="font-weight:700;color:#e6eef8">AI Task List</div><div style="font-size:11px;color:#9aa6b2">${tasks.length} items</div>`;

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '6px';
    list.style.marginTop = '8px';

    tasks.forEach(t => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '8px';
        row.style.padding = '8px';
        row.style.borderRadius = '8px';
        row.style.background = (t.status === 'done' || t.status === 'completed') ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.01)';

        const left = document.createElement('div');
        left.style.flex = '1';
        left.innerHTML = `<div style="font-weight:600;color:${(t.status === 'done' || t.status === 'completed') ? '#d1f7dd' : '#e6eef8'}">${escapeHtml(t.description)}</div>
                          <div style="font-size:11px;color:#9aa6b2;margin-top:4px">ID: ${escapeHtml(t.id)}</div>`;

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.flexDirection = 'column';
        actions.style.gap = '6px';
        actions.style.minWidth = '86px';

        const toggle = document.createElement('button');
        toggle.className = 'ai-status-badge';
        toggle.style.fontSize = '12px';
        toggle.style.padding = '6px 8px';
        toggle.style.cursor = 'pointer';
        toggle.textContent = (t.status === 'done' || t.status === 'completed') ? 'Reopen' : 'Mark Done';
        toggle.addEventListener('click', () => {
            t.status = (t.status === 'done' || t.status === 'completed') ? 'pending' : 'done';
            // reflect in global state.tasks as well
            const idx = state.tasks.findIndex(x => String(x.id) === String(t.id));
            if (idx >= 0) state.tasks[idx].status = t.status;
            // update UI both small viewer and main task panel
            showCustomTaskViewer(state.tasks);
            renderTaskList();
            saveProjectsToStorage();
        });

        const focusBtn = document.createElement('button');
        focusBtn.className = 'ai-status-badge';
        focusBtn.style.fontSize = '11px';
        focusBtn.style.padding = '6px 8px';
        focusBtn.style.cursor = 'pointer';
        focusBtn.textContent = 'Use';
        focusBtn.addEventListener('click', () => {
            // inject task description into chat input for further details
            elements.chatInput.value = elements.chatInput.value ? elements.chatInput.value + '\n\n' + t.description : t.description;
            elements.chatInput.focus();
            // ensure chat panel is visible
            state.activePanel = 'chat';
            state.sidebarOpen = true;
            updateSidebar();
        });

        actions.appendChild(toggle);
        actions.appendChild(focusBtn);

        row.appendChild(left);
        row.appendChild(actions);
        list.appendChild(row);
    });

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '8px';
    footer.style.marginTop = '8px';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-secondary';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => container.remove());
    const openPanelBtn = document.createElement('button');
    openPanelBtn.className = 'btn-primary';
    openPanelBtn.textContent = 'Open Tasks Panel';
    openPanelBtn.addEventListener('click', () => {
        state.activePanel = 'chat';
        state.sidebarOpen = true;
        renderTaskList();
        updateSidebar();
        container.remove();
    });
    footer.appendChild(openPanelBtn);
    footer.appendChild(closeBtn);

    container.appendChild(header);
    container.appendChild(list);
    container.appendChild(footer);

    document.body.appendChild(container);
}

/* Generating indicator helpers */
function showGeneratingIndicator() {
    // If already present, no-op
    if (document.getElementById('vibesim-generating-overlay')) return;

    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    // Create a container that will be appended after the messages so it sits at the bottom of the chat flow
    const wrapper = document.createElement('div');
    wrapper.id = 'vibesim-generating-overlay';
    wrapper.className = 'vibesim-generating-overlay';
    wrapper.innerHTML = `
        <div class="vibesim-generating-card" role="status" aria-label="Generating">
            <div class="ai-spinner" aria-hidden="true">
                <svg viewBox="0 0 50 50" class="ai-spinner-svg">
                    <circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
                </svg>
            </div>
            <div class="vibesim-generating-text">Generating Project</div>
        </div>
    `;

    // Append below messages so it doesn't cover the chat or input; keep it non-blocking
    chatMessages.appendChild(wrapper);
    // Scroll into view so users see the indicator but it doesn't obscure controls
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideGeneratingIndicator() {
    const el = document.getElementById('vibesim-generating-overlay');
    if (el) el.remove();
}

// UI Rendering Helpers
function renderFileTree() {
    // Render files as a simple indented hierarchy so paths like "assets/image.png" appear in folders.
    const paths = Object.keys(state.files).sort();
    const previewPopup = document.getElementById('asset-preview-popup');

    // Remove any leftover hover listeners from previous renders if necessary
    if (previewPopup) previewPopup.style.display = 'none';

    const rows = paths.map(path => {
        const file = state.files[path];
        const selected = state.activeTab === path ? 'selected' : '';
        const segments = path.split('/');
        const depth = Math.max(0, segments.length - 1);
        const displayName = segments[segments.length - 1];
        const padding = 8 + depth * 12;

        const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
        const isAudio = /\.(mp3|wav|ogg)$/i.test(path);

        // Determine preview type more robustly: prefer blobUrl, then explicit data URLs,
        // and also support the import wrapper "/* binary data url */\n<data...>"
        let previewType = 'none';
        if (isImage) previewType = 'image';
        else if (isAudio) previewType = 'audio';

        return `<div class="file-row ${selected}" data-path="${path}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding-left:${padding}px" 
            data-preview-type="${previewType}">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
                <svg class="file-icon" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6" opacity=".3"/></svg>
                <div class="file-name" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis" title="${escapeHtml(path)}">${escapeHtml(displayName)}</div>
                ${isImage ? '<span style="font-size: 10px; opacity: 0.4;">🖼️</span>' : ''}
                ${isAudio ? '<span style="font-size: 10px; opacity: 0.4;">🔊</span>' : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="explorer-rename" data-path="${escapeHtml(path)}" title="Rename" style="background:transparent;border:1px solid transparent;color:#9aa6b2;padding:6px;border-radius:6px;cursor:pointer">Rename</button>
                <button class="explorer-delete" data-path="${escapeHtml(path)}" title="Delete" style="background:transparent;border:1px solid transparent;color:#f87171;padding:6px;border-radius:6px;cursor:pointer">Delete</button>
            </div>
        </div>`;
    });

    elements.fileTree.innerHTML = rows.join('');
    // Ensure tabs reflect the current file list immediately after rendering the tree,
    // so clicking a file will always show the top file tabs and keep UI state consistent.
    try { renderTabs(); } catch (e) { console.warn('renderTabs call in renderFileTree failed', e); }

    // Asset Preview Logic
    elements.fileTree.querySelectorAll('.file-row').forEach(row => {
        const path = row.dataset.path;
        const type = row.dataset.previewType;
        const file = state.files[path];

        row.addEventListener('mouseenter', (e) => {
            if (type === 'image') {
                previewPopup.style.display = 'block';
                previewPopup.style.left = `${e.clientX + 20}px`;
                previewPopup.style.top = `${e.clientY - 20}px`;

                // Resolve usable src
                let src = null;
                if (file.blobUrl) src = file.blobUrl;
                else if (file.content && String(file.content).startsWith('data:image')) src = file.content;

                if (src) {
                    previewPopup.innerHTML = `<img src="${src}">`;
                } else {
                    previewPopup.style.display = 'none';
                }
            }
        });

        row.addEventListener('mousemove', (e) => {
            if (type === 'none') return;
            previewPopup.style.left = `${e.clientX + 20}px`;
            previewPopup.style.top = `${e.clientY - 20}px`;
        });

        row.addEventListener('mouseleave', () => {
            previewPopup.style.display = 'none';
        });

        // Click to play audio preview
        if (type === 'audio') {
            row.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (btn) return;
                
                const src = file.blobUrl || (file.content?.startsWith('data:audio') ? file.content : null);
                if (src) {
                    const audio = new Audio(src);
                    audio.volume = 0.5;
                    audio.play().catch(err => console.warn("Preview play failed", err));
                    showSnackbar(`Previewing audio: ${path}`);
                }
            });
        }
    });

    // clicking the row (but not the action buttons) opens the file
    elements.fileTree.querySelectorAll('.file-row').forEach(row => {
        row.addEventListener('click', async (e) => {
            const btn = e.target.closest('.explorer-rename') || e.target.closest('.explorer-delete');
            if (btn) return; // action handled separately
            try {
                await openFile(row.dataset.path);
                if (monacoEditor && state.files[row.dataset.path]) {
                    await updateMonacoModel(row.dataset.path, state.files[row.dataset.path]);
                }
            } catch (err) {
                console.warn('File open from explorer failed', err);
            }
        });
    });

    // rename handlers
    elements.fileTree.querySelectorAll('.explorer-rename').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const oldPath = btn.dataset.path;
            const newName = prompt('Rename file to (you can include folders, e.g. assets/new.png):', oldPath);
            if (!newName || newName === oldPath) return;
            if (state.files[newName]) { alert('A file with that name already exists.'); return; }
            state.files[newName] = state.files[oldPath];
            delete state.files[oldPath];
            // Update tabs and activeTab
            state.tabs = state.tabs.map(t => t === oldPath ? newName : t);
            if (state.activeTab === oldPath) state.activeTab = newName;
            renderFileTree();
            renderTabs();
            saveProjectsToStorage();
            addMessage('assistant-vibe', `Renamed ${oldPath} → ${newName}`);
        });
    });

    // delete handlers
    elements.fileTree.querySelectorAll('.explorer-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const p = btn.dataset.path;
            const ok = confirm(`Delete "${p}"? This cannot be undone.`);
            if (!ok) return;
            // remove from files, tabs, and adjust activeTab
            delete state.files[p];
            state.tabs = state.tabs.filter(t => t !== p);
            if (state.activeTab === p) state.activeTab = state.tabs[0] || null;
            renderFileTree();
            renderTabs();
            saveProjectsToStorage();
            addMessage('assistant-vibe', `Deleted ${p}`);
        });
    });
}

/**
 * Detect whether content follows the "/* binary data url *\/\n<data...>" wrapper pattern
 * used elsewhere in the code to store imported binary files as text.
 * Returns true when the content appears to contain a data: URL on the second+ line.
 */
function isImportWrappedDataUrl(content) {
    try {
        if (typeof content !== 'string') return false;
        // common marker used elsewhere in the code
        if (!content.startsWith('/* binary data url */')) return false;
        const rest = content.split('\n').slice(1).join('\n').trim();
        return rest.startsWith('data:');
    } catch (e) {
        return false;
    }
}

async function openFile(path) {
    if (!path || !state.files[path]) return;

    // Remove any previous binary preview overlay immediately
    const existingPreview = document.getElementById('monaco-binary-preview');
    if (existingPreview) existingPreview.remove();

    // Set as active tab and ensure it's in the tabs list
    state.activeTab = path;
    if (!state.tabs.includes(path)) {
        state.tabs.push(path);
    }

    // Ensure the app swaps to the Editor view
    if (state.activeView !== 'editor') {
        state.activeView = 'editor';
        document.querySelectorAll('.view-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'editor');
        });
        updateView();
    }

    // Update UI components
    renderTabs();
    renderFileTree();
    updateBreadcrumb(path);

    const file = state.files[path];

    // HYDRATION: If file content is missing, fetch it
    if (file.blobUrl && !file.content) {
        try {
            const res = await fetch(file.blobUrl);
            if (res.ok) file.content = await res.text();
        } catch (err) {
            console.warn('Hydration failed for', path, err);
        }
    }

    // Helpers to detect binary/non-code files
    const isDataUrl = (val) => typeof val === 'string' && val.trim().startsWith('data:');
    const isBinaryExtension = (p) => /\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg|flac|mp4|mov|zip|woff2?|ttf|pdf|ico|obj|fbx|glb|gltf)$/i.test(p);
    const isTextFile = (p) => /\.(html?|css|js|jsx|ts|tsx|json|md|txt|xml|yaml|yml|toml|sql|php|py|rb|sh|keep)$/i.test(p);
    
    const isText = isTextFile(path);
    const binaryLike = !isText && (file.language === 'binary' || isBinaryExtension(path) || (isDataUrl(file.content) && !isImportWrappedDataUrl(file.content)) || (file.blobUrl && !isText));

    if (binaryLike) {
        showBinaryPreview(path, file);
        return;
    }

    // Open in Monaco
    await updateMonacoModel(path, file);
}

function showBinaryPreview(path, file) {
    const editorArea = document.getElementById('monaco-container');
    if (!editorArea) return;

    const overlay = document.createElement('div');
    overlay.id = 'monaco-binary-preview';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.background = '#0d0d0d';
    overlay.style.zIndex = '10';

    let src = file.blobUrl || (isDataUrl(file.content) ? file.content : null);
    if (!src && isImportWrappedDataUrl(file.content)) {
        src = String(file.content).split('\n').slice(1).join('\n').trim();
    }

    const frame = document.createElement('iframe');
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = 'none';
    frame.style.background = '#000';

    if (src) {
        const isAudio = /\.(mp3|wav|ogg|flac)$/i.test(path);
        if (isAudio) {
            const audioHtml = `<!doctype html><html><body style="background:#000;display:flex;align-items:center;justify-content:center;height:100vh;">
                <audio controls style="width:90%" src="${src}"></audio>
            </body></html>`;
            frame.src = URL.createObjectURL(new Blob([audioHtml], { type: 'text/html' }));
        } else {
            frame.src = src;
        }
    } else {
        frame.srcdoc = `<html><body style="background:#000;color:#888;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
            Binary Preview Unavailable for "${path}"
        </body></html>`;
    }

    const toolbar = document.createElement('div');
    toolbar.style.padding = '8px 16px';
    toolbar.style.background = '#1a1a1a';
    toolbar.style.borderBottom = '1px solid #333';
    toolbar.style.display = 'flex';
    toolbar.style.justifyContent = 'space-between';
    toolbar.style.alignItems = 'center';
    toolbar.innerHTML = `<span style="font-size:12px;color:#aaa;">${path}</span>
                         <a href="${src}" target="_blank" class="btn-secondary" style="font-size:11px;padding:4px 8px;text-decoration:none;">Open in New Tab</a>`;

    overlay.appendChild(toolbar);
    overlay.appendChild(frame);
    editorArea.appendChild(overlay);
}

async function updateMonacoModel(path, file) {
    if (!monacoLoaderReady) await loadMonaco();
    if (!monacoEditor) return;

    const lang = getLang(path);
    const monacoLang = lang === 'javascript' ? 'javascript' : (lang === 'css' ? 'css' : (lang === 'html' ? 'html' : 'plaintext'));

    // More robust model lookup: match by trailing path segment or full uri string to handle differing uri formats.
    let model = null;
    try {
        const models = monaco.editor.getModels();
        model = models.find(m => {
            try {
                const uri = m.uri ? String(m.uri) : '';
                const uriPath = m.uri && m.uri.path ? m.uri.path : '';
                // exact or trailing match
                if (uriPath === '/' + path) return true;
                if (uri.endsWith('/' + path)) return true;
                // also handle cases where model was created with an in-memory scheme
                if (uri.endsWith(path)) return true;
                return false;
            } catch (e) {
                return false;
            }
        });
    } catch (e) { model = null; }

    if (!model) {
        // create a stable file:// URI for the model so future lookups can match reliably
        const uri = monaco.Uri.parse('file:///' + path.replace(/\\/g, '/'));
        model = monaco.editor.createModel(file.content || '', monacoLang, uri);
    } else {
        // If content in state is newer than model (from AI or hydration), update model
        try {
            if (model.getValue() !== (file.content || '')) {
                // perform edit as a single atomic replace to preserve undo stack sanity
                const fullRange = model.getFullModelRange();
                model.pushEditOperations([], [{ range: fullRange, text: file.content || '' }], () => null);
            }
            // Ensure the model language is correct
            monaco.editor.setModelLanguage(model, monacoLang);
        } catch (e) {
            // fallback: setValue if edit approach fails
            try { model.setValue(file.content || ''); } catch (err) { console.warn('Monaco setValue fallback failed', err); }
        }
    }

    monacoEditor.setModel(model);
    monacoEditor.focus();
    updateEditorDisplay();
}

function updateBreadcrumb(path) {
    const segments = path.split('/');

    // Ensure we have a persisted editor options object
    state.editorOptions = state.editorOptions || { minimap: false, wordWrap: 'off' };

    // Detect whether the file is binary/non-text using same heuristics as openFile
    function isDataUrl(val) { return typeof val === 'string' && val.trim().startsWith('data:'); }
    function isBinaryExtension(p) { return /\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg|flac|mp4|mov|zip|woff2?|ttf|pdf|ico|obj|fbx|glb|gltf)$/i.test(p); }
    function isTextFile(p) { return /\.(html?|css|js|jsx|ts|tsx|json|md|txt|xml|yaml|yml|toml|sql|php|py|rb|sh|keep)$/i.test(p); }

    const file = state.files[path] || {};
    const binaryLike = (!isTextFile(path)) && (file.language === 'binary' || isBinaryExtension(path) || (isDataUrl(file.content) && !isImportWrappedDataUrl(file.content)) || (file.blobUrl && !isTextFile(path)));

    // Helper to render the button SVG with active state visuals
    function svgForMinimap(active) {
        return active
            ? `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm4 3h10v2H7V8zm0 4h6v2H7v-2z" /></svg>`
            : `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M7 8h10M7 12h6"/></svg>`;
    }
    function svgForWrap(active) {
        return active
            ? `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zM4 10h10v2H4zM4 14h16v2H4z"/></svg>`
            : `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M4 6h16M4 12h10l4 4M4 18h16"/></svg>`;
    }

    // Only render toolbar when the active file is a text/code file (hide it for binary previews)
    let toolbarHtml = '';
    if (!binaryLike) {
        toolbarHtml = `
            <div class="editor-toolbar ml-auto flex items-center gap-2">
                <button class="toolbar-btn" id="editor-format" title="Format Document" aria-label="Format document">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"/></svg>
                </button>
                <button class="toolbar-btn" id="editor-minimap" title="Toggle Minimap" aria-pressed="${state.editorOptions.minimap}">
                    ${svgForMinimap(state.editorOptions.minimap)}
                </button>
                <button class="toolbar-btn" id="editor-wrap" title="Toggle Word Wrap" aria-pressed="${state.editorOptions.wordWrap === 'on'}">
                    ${svgForWrap(state.editorOptions.wordWrap === 'on')}
                </button>
            </div>
        `;
    }

    elements.breadcrumb.innerHTML = `<span class="opacity-50">project</span> / ${segments.map(s => `<span>${s}</span>`).join(' / ')} ${toolbarHtml}`;

    // If toolbar not rendered (binary), do not attach listeners
    if (binaryLike) return;

    // Wire toolbar buttons with robust toggles and visual updates
    const fmtBtn = document.getElementById('editor-format');
    const miniBtn = document.getElementById('editor-minimap');
    const wrapBtn = document.getElementById('editor-wrap');

    fmtBtn?.addEventListener('click', () => {
        try {
            monacoEditor?.getAction('editor.action.formatDocument')?.run();
            showSnackbar('Formatted document');
        } catch (e) {
            console.warn('Format failed', e);
            showSnackbar('Format not available');
        }
    });

    miniBtn?.addEventListener('click', () => {
        try {
            // Toggle persisted option
            state.editorOptions.minimap = !Boolean(state.editorOptions.minimap);
            // Apply to Monaco if ready
            if (monacoEditor && typeof monacoEditor.updateOptions === 'function') {
                monacoEditor.updateOptions({ minimap: { enabled: state.editorOptions.minimap } });
            }
            // Update button visuals (replace innerHTML and aria-pressed)
            miniBtn.innerHTML = svgForMinimap(state.editorOptions.minimap);
            miniBtn.setAttribute('aria-pressed', String(state.editorOptions.minimap));
            showSnackbar(`Minimap ${state.editorOptions.minimap ? 'enabled' : 'disabled'}`);
        } catch (e) {
            console.warn('Toggle minimap failed', e);
        }
    });

    wrapBtn?.addEventListener('click', () => {
        try {
            const newWrap = state.editorOptions.wordWrap === 'on' ? 'off' : 'on';
            state.editorOptions.wordWrap = newWrap;
            if (monacoEditor && typeof monacoEditor.updateOptions === 'function') {
                monacoEditor.updateOptions({ wordWrap: newWrap });
            }
            wrapBtn.innerHTML = svgForWrap(newWrap === 'on');
            wrapBtn.setAttribute('aria-pressed', String(newWrap === 'on'));
            showSnackbar(`Word wrap ${newWrap === 'on' ? 'on' : 'off'}`);
        } catch (e) {
            console.warn('Toggle wrap failed', e);
        }
    });

    // If Monaco is present but state was not yet synced, hydrate state.editorOptions from actual editor options
    try {
        if (monacoEditor && (!('minimap' in state.editorOptions) || !('wordWrap' in state.editorOptions))) {
            const raw = monacoEditor.getRawOptions ? monacoEditor.getRawOptions() : {};
            state.editorOptions.minimap = raw.minimap ? !!raw.minimap.enabled : !!state.editorOptions.minimap;
            state.editorOptions.wordWrap = raw.wordWrap === 'on' ? 'on' : state.editorOptions.wordWrap || 'off';
            // reflect visuals
            const mBtn = document.getElementById('editor-minimap');
            const wBtn = document.getElementById('editor-wrap');
            if (mBtn) { mBtn.innerHTML = svgForMinimap(state.editorOptions.minimap); mBtn.setAttribute('aria-pressed', String(state.editorOptions.minimap)); }
            if (wBtn) { wBtn.innerHTML = svgForWrap(state.editorOptions.wordWrap === 'on'); wBtn.setAttribute('aria-pressed', String(state.editorOptions.wordWrap === 'on')); }
        }
    } catch (e) {
        console.warn('Hydrating editor options failed', e);
    }
}

function renderTabs() {
    const tabsBar = document.getElementById('tabs-bar');
    if (!tabsBar) return;
    
    tabsBar.innerHTML = state.tabs.map(path => {
        const isActive = state.activeTab === path;
        const ext = path.split('.').pop().toLowerCase();
        let icon = '📄';
        if (ext === 'html') icon = '🌐';
        else if (ext === 'css') icon = '🎨';
        else if (ext === 'js' || ext === 'jsx') icon = '📜';
        else if (ext === 'ts' || ext === 'tsx') icon = '📘';
        else if (ext === 'json') icon = '⚙️';
        else if (['png','jpg','jpeg','gif','webp'].includes(ext)) icon = '🖼️';
        else if (['mp3','wav','ogg'].includes(ext)) icon = '🔊';

        return `
            <div class="tab ${isActive ? 'active' : ''}" data-path="${path}" title="${path}">
                <span class="tab-icon">${icon}</span>
                <span class="tab-label">${path.split('/').pop()}</span>
                <span class="tab-close" data-path="${path}" title="Close">×</span>
            </div>
        `;
    }).join('');

    // Re-attach listeners
    tabsBar.querySelectorAll('.tab').forEach(tabEl => {
        tabEl.addEventListener('click', async (e) => {
            const path = tabEl.dataset.path;
            // Use closest to reliably detect clicks on the close control even when inner elements are clicked
            const closeBtn = e.target.closest && e.target.closest('.tab-close');
            if (closeBtn) {
                // ensure the close button click doesn't trigger the tab open behavior
                e.stopPropagation();
                closeTab(path);
                return;
            }
            // Open file and then ensure Monaco model is explicitly updated to the file's content.
            // openFile handles view switching and binary previews; call updateMonacoModel afterwards to guarantee editor sync.
            try {
                await openFile(path);
                if (monacoEditor && state.files[path]) {
                    // best-effort ensure the editor model matches the file content
                    await updateMonacoModel(path, state.files[path]);
                }
            } catch (err) {
                console.warn('Tab open failed', err);
            }
        });
    });

    // Scroll active tab into view
    const activeTabEl = tabsBar.querySelector('.tab.active');
    if (activeTabEl) {
        activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

function closeTab(path) {
    state.tabs = state.tabs.filter(t => t !== path);
    if (state.activeTab === path) {
        state.activeTab = state.tabs[state.tabs.length - 1] || null;
        if (state.activeTab) {
            openFile(state.activeTab);
        } else {
            // No tabs left, clear editor/preview
            if (monacoEditor) monacoEditor.setModel(null);
            const binaryPrev = document.getElementById('monaco-binary-preview');
            if (binaryPrev) binaryPrev.remove();
            renderTabs();
            renderFileTree();
        }
    } else {
        renderTabs();
    }
}

function updateEditorDisplay() {
    if (!monacoEditor) return;
    const content = monacoEditor.getValue();
    const lines = content.split('\n').length;
    // Monaco shows line numbers itself — we only update the status position
    const pos = monacoEditor.getPosition();
    const ln = pos ? pos.lineNumber : 1;
    const col = pos ? pos.column : 1;
    document.getElementById('status-position').textContent = `Ln ${ln}, Col ${col}`;
}

/* highlight() is no longer used; Monaco provides syntax highlighting */
function highlight(code, lang) {
    return code;
}

function getLang(path) {
    if (!path) return 'plaintext';
    if (path.endsWith('.js')) return 'javascript';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.css')) return 'css';
    return 'plaintext';
}

/* Screenshot Logic */
async function takeScreenshot() {
    if (!elements.previewIframe || !elements.previewIframe.contentDocument) return;
    
    try {
        // We capture the iframe body using html2canvas and compute full page dimensions to avoid cropping
        const doc = elements.previewIframe.contentDocument || elements.previewIframe.contentWindow?.document;
        if (!doc) return;
        const width = Math.max(doc.documentElement.scrollWidth || 1024, doc.body.scrollWidth || 1024);
        const height = Math.max(doc.documentElement.scrollHeight || 768, doc.body.scrollHeight || 768);

        const canvas = await html2canvas(doc.body, {
            scale: 1,
            logging: false,
            useCORS: true,
            backgroundColor: null, // keep original background instead of forcing black
            width,
            height
        });

        // prefer webp with reasonable quality
        const dataUrl = canvas.toDataURL('image/webp', 0.9);

        // Update current project screenshot
        if (state.projects[state.currentProjectId]) {
            state.projects[state.currentProjectId].screenshot = dataUrl;
            saveProjectsToStorage();
        }
        return dataUrl;
    } catch (e) {
        console.warn("Screenshot failed", e);
    }
}

/* Preview Engine (enhanced: inject runtime error reporter and mock websim services into iframe) */
async function updatePreview() {
    // If index.html exists, use its content; otherwise show a helpful recovery message
    const html = state.files['index.html'] && typeof state.files['index.html'].content === 'string'
      ? state.files['index.html'].content
      : `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Project Error</title></head><body style="background:#07070a;color:#e6eef8;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,system-ui">
        <div style="max-width:760px;padding:24px;text-align:center;border-radius:12px;border:1px solid rgba(255,255,255,0.03);background:linear-gradient(180deg,rgba(255,255,255,0.02),transparent)">
          <h1 style="font-size:20px;margin-bottom:8px">Your project broke</h1>
          <p style="color:#9aa6b2;margin-bottom:12px">Look in Versions and attempt to restore to the newest previous version — sorry about that!</p>
          <p style="font-size:12px;color:#888;margin-top:6px">Open Project Manager → Projects → Versions to restore an earlier snapshot.</p>
        </div>
      </body></html>`;
    // Ensure finalHtml is always a string to avoid errors when later calling .replace()
    let finalHtml = (typeof html === 'string') ? html : (html ? String(html) : '');

    // Build a mapping of file path -> usable URL (blob or existing blobUrl/data URL)
    const assetUrlMap = {};
    for (const [path, file] of Object.entries(state.files)) {
        try {
            // Prefer an explicit blobUrl if provided (uploaded assets)
            if (file.blobUrl) {
                assetUrlMap[path] = file.blobUrl;
                continue;
            }

            // If content is a data URL (imported binary), use it
            if (typeof file.content === 'string' && file.content.startsWith('data:')) {
                assetUrlMap[path] = file.content;
                continue;
            }

            // If content is wrapped as "/* binary data url */\n<data...>", extract the data URL
            if (typeof file.content === 'string' && file.content.startsWith('/* binary data url */')) {
                const maybe = String(file.content).split('\n').slice(1).join('\n').trim();
                if (maybe.startsWith('data:')) {
                    assetUrlMap[path] = maybe;
                    continue;
                }
            }

            // For textual assets (css/js/html) we inline below; for other binary-like assets try to create a blob from base64 if possible.
            // Detect a base64 block by heuristic (very long base64-like string)
            if (typeof file.content === 'string' && /^([A-Za-z0-9+/=\\s]{100,})$/.test(file.content.replace(/\s/g, ''))) {
                try {
                    // attempt to convert base64 -> blob
                    const b64 = file.content.replace(/\s/g, '');
                    const binary = atob(b64);
                    const len = binary.length;
                    const u8 = new Uint8Array(len);
                    for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i);
                    const blob = new Blob([u8], { type: 'application/octet-stream' });
                    assetUrlMap[path] = URL.createObjectURL(blob);
                    continue;
                } catch (e) {
                    // fallback to text below
                }
            }
        } catch (e) {
            // ignore mapping errors and fall back to inlining text where appropriate
        }
    }

    // Enhanced asset path replacer for inlined content
    function replaceAssetPathsInContent(content) {
        if (typeof content !== 'string') return content;
        let result = content;
        // Search project for any file path that matches a known asset and replace it with its blob/data URL
        // Sort keys by length descending to avoid partial matches (e.g., 'image.png' before 'img/image.png')
        const sortedPaths = Object.keys(assetUrlMap).sort((a, b) => b.length - a.length);
        
        sortedPaths.forEach(projPath => {
            const url = assetUrlMap[projPath];
            // Match the path if it's inside quotes (common in JS/CSS)
            // e.g., 'asset.png', "./asset.png", "/asset.png"
            const esc = projPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(['"\`])(?:\\.\\/|\\/)?${esc}\\1`, 'g');
            result = result.replace(regex, `$1${url}$1`);
        });
        return result;
    }

    // Inline CSS and JS safely; for references to assets (images, audio) replace src/href pointing to a local path with the blob/data URL from assetUrlMap
    Object.entries(state.files).forEach(([path, file]) => {
        const content = String(file.content || '');
        const suspiciousPattern = /BEGIN_FILE|END_FILE|BEGIN_FILE:/m;
        if (suspiciousPattern.test(content)) {
            if (path.endsWith('.css')) {
                finalHtml = finalHtml.replace(new RegExp(`<link[^>]*href=["']${path}["'][^>]*>`, 'g'), `<!-- Skipped inlining ${path} for safety (contains transfer markers) -->`);
            } else if (path.endsWith('.js')) {
                finalHtml = finalHtml.replace(new RegExp(`<script[^>]*src=["']${path}["'][^>]*></script>`, 'g'), `<!-- Skipped inlining ${path} for safety (contains transfer markers) -->`);
            }
            return;
        }

        if (path.endsWith('.css')) {
            // replace any url(...) inside CSS pointing to local paths with asset URLs
            let cssContent = replaceAssetPathsInContent(content);
            cssContent = cssContent.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, urlPath) => {
                const normalized = urlPath.replace(/^\.\//, '').replace(/^\//, '');
                if (assetUrlMap[normalized]) return `url("${assetUrlMap[normalized]}")`;
                if (assetUrlMap[urlPath]) return `url("${assetUrlMap[urlPath]}")`;
                return m;
            });
            finalHtml = finalHtml.replace(new RegExp(`<link[^>]*href=["']${path}["'][^>]*>`, 'g'), `<style>${cssContent}</style>`);
        } else if (path.endsWith('.js')) {
            let jsContent = replaceAssetPathsInContent(content);
            finalHtml = finalHtml.replace(new RegExp(`<script[^>]*src=["']${path}["'][^>]*></script>`, 'g'), `<script>${jsContent}<\/script>`);
        }
    });

    // Replace resource references in the finalHtml for common tags using assetUrlMap
    try {
        // img, audio, video, source, link rel=icon, script[src] (if any left), and others
        for (const [p, url] of Object.entries(assetUrlMap)) {
            // escape special regex chars in path
            const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Build regex variants so we correctly replace:
            // - src="/path", src='path', src=path (with or without leading slash)
            // - href variations similarly
            // Use non-capturing group for optional leading slash.
            // allow optional leading slash, "./" or "../" so references from subfolders are replaced properly
            const srcRegex = new RegExp(`(src=)(["']?)(?:\\/|\\.\\/|\\.\\.\\/)?(${esc})\\2`, 'g');
            const hrefRegex = new RegExp(`(href=)(["']?)(?:\\/|\\.\\/|\\.\\.\\/)?(${esc})\\2`, 'g');
            const cssUrlRegex = new RegExp(`url\\((['"]?)(?:\\/|\\.\\/|\\.\\.\\/)?${esc}\\1\\)`, 'g');

            finalHtml = finalHtml.replace(srcRegex, `src="${url}"`);
            finalHtml = finalHtml.replace(hrefRegex, `href="${url}"`);
            // also replace occurrences inside CSS url(...), allowing optional leading slash or relative ./ ../ notation
            finalHtml = finalHtml.replace(cssUrlRegex, `url("${url}")`);

            // Additionally, handle plain occurrences in HTML attributes without = (rare), or references like "/path" standalone
            // Replace occurrences of "/path" or "path" inside src/href-like contexts conservatively
            try {
                // e.g., <img src=/assets/img.png> or <img src=/assets/img.png />
                finalHtml = finalHtml.replace(new RegExp(`<(img|audio|video|source)[^>]*\\s(src\\s*=\\s*)(?:["']?)\\/(${esc})(?:["']?)([^>]*)>`, 'g'), (m, tag, attr, matchedPath, rest) => {
                    return m.replace(attr + matchedPath, `src="${url}"`);
                });
            } catch (e) {
                // ignore any edge-case replacement errors
            }
        }
    } catch (e) {
        console.warn('Asset replacement error:', e);
    }

    // Composite injection script (unchanged besides keeping existing preview helpers + added fetch/XHR/canvas interception)
    const injection = `
<script>
(function(){
  // Expose an asset map so previewed runtime JS can resolve paths created dynamically
  try {
    window.__vibesim_asset_map = ${JSON.stringify(assetUrlMap)};
  } catch (e) { window.__vibesim_asset_map = {}; }

  // Console Interception
  (function() {
      const originalLog = console.log;
      const originalWarn = console.warn;
      const originalError = console.error;
      const originalInfo = console.info;

      function sendLog(type, args) {
          try {
              const message = args.map(arg => {
                  if (typeof arg === 'object') {
                      try { return JSON.stringify(arg); } catch(e) { return String(arg); }
                  }
                  return String(arg);
              }).join(' ');
              parent.postMessage({ __vibesim_console: true, type, message }, '*');
          } catch(e) {}
      }

      console.log = function(...args) { sendLog('log', args); originalLog.apply(console, args); };
      console.warn = function(...args) { sendLog('warn', args); originalWarn.apply(console, args); };
      console.error = function(...args) { sendLog('error', args); originalError.apply(console, args); };
      console.info = function(...args) { sendLog('info', args); originalInfo.apply(console, args); };

      window.addEventListener('message', function(e) {
          if (e.data && e.data.__vibesim_exec) {
              try {
                  const res = eval(e.data.code);
                  console.log(res);
              } catch (err) {
                  console.error(err);
              }
          }
      });
  })();

  // Enhanced resolver inside the preview iframe
  function resolveAssetPath(p) {
    if (!p || typeof p !== 'string') return p;
    // Fast skip for data URIs or blob URLs (already resolved)
    if (p.startsWith('data:') || p.startsWith('blob:')) return p;

    // Handle full URLs that might be localhost/same origin but pointing to local paths
    if (p.startsWith('http')) {
        try {
            const u = new URL(p);
            if (u.origin === window.location.origin) {
                p = u.pathname + u.search + u.hash;
            } else {
                return p;
            }
        } catch(e) { return p; }
    }

    const map = window.__vibesim_asset_map || {};
    const normalized = p.replace(/^\\.\\/+/, '').replace(/^[\\/]+/, '');
    
    // 1. Exact or normalized map match
    if (map[p]) return map[p];
    if (map[normalized]) return map[normalized];
    
    // 2. Basename fallback (e.g., "horse.mp3" instead of "assets/horse.mp3")
    const last = normalized.split('/').pop();
    if (map[last]) return map[last];

    // 3. Search suffix matches for deep paths
    for (const key of Object.keys(map)) {
      if (key.endsWith('/' + normalized) || normalized.endsWith('/' + key)) return map[key];
    }
    return p;
  }

  // Patch window.Audio
  (function(){
    try {
      const OriginalAudio = window.Audio;
      function PatchedAudio(src) { return new OriginalAudio(resolveAssetPath(src || '')); }
      PatchedAudio.prototype = OriginalAudio.prototype;
      window.Audio = PatchedAudio;
    } catch(e) {}
  })();

  // Patch CSS background-image
  (function(){
    try {
      const bgDesc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'backgroundImage') || {};
      if (bgDesc && typeof bgDesc.set === 'function') {
        Object.defineProperty(CSSStyleDeclaration.prototype, 'backgroundImage', {
          configurable: true, enumerable: bgDesc.enumerable, get: bgDesc.get,
          set: function(val) {
            if (typeof val === 'string' && val.includes('url(')) {
                val = val.replace(/url\\((['\"]?)(.*?)\\1\\)/g, (_, q, u) => 'url("' + (resolveAssetPath(u) || u) + '")');
            }
            return bgDesc.set.call(this, val);
          }
        });
      }
      const origSetProperty = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) {
        if (typeof value === 'string' && value.includes('url(')) {
          value = value.replace(/url\\((['\"]?)(.*?)\\1\\)/g, (_, q, u) => 'url("' + (resolveAssetPath(u) || u) + '")');
        }
        return origSetProperty.call(this, name, value, priority);
      };
    } catch(e) {}
  })();

  // Monkeypatch Image src assignment and setAttribute to rewrite to blob/data URLs when possible
  (function(){
    try {
      const ImgProto = HTMLImageElement && HTMLImageElement.prototype;
      if (ImgProto) {
        const desc = Object.getOwnPropertyDescriptor(ImgProto, 'src') || {};
        const originalSrcSetter = desc && desc.set ? desc.set : null;
        const originalSrcGetter = desc && desc.get ? desc.get : null;

        Object.defineProperty(ImgProto, 'src', {
          configurable: true,
          enumerable: true,
          get: function() {
            return originalSrcGetter ? originalSrcGetter.call(this) : this.getAttribute('src');
          },
          set: function(val) {
            const resolved = resolveAssetPath(String(val || ''));
            try {
              if (resolved) {
                // use the resolved blob/data URL
                if (originalSrcSetter) return originalSrcSetter.call(this, resolved);
                else return this.setAttribute('src', resolved);
              }
            } catch (e) {}
            // fallback to original behavior
            if (originalSrcSetter) return originalSrcSetter.call(this, val);
            else return this.setAttribute('src', val);
          }
        });

        // Intercept setAttribute for "src" or "href" on elements
        const originalSetAttr = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
          try {
            if ((name === 'src' || name === 'href') && typeof value === 'string') {
              const resolved = resolveAssetPath(value);
              if (resolved) return originalSetAttr.call(this, name, resolved);
            }
          } catch (e) {}
          return originalSetAttr.call(this, name, value);
        };
      }

      // Also override createElement for IMG to ensure initial src passed in createElement('img', {src:...}) or later assignments are handled
      const originalCreateElement = Document.prototype.createElement;
      Document.prototype.createElement = function(tagName, options) {
        const el = originalCreateElement.call(this, tagName, options);
        if (String(tagName).toLowerCase() === 'img') {
          // wrap setAttribute specifically for this instance to be extra-safe
          const origSet = el.setAttribute;
          el.setAttribute = function(name, value) {
            try {
              if ((name === 'src' || name === 'href') && typeof value === 'string') {
                const resolved = resolveAssetPath(value);
                if (resolved) return origSet.call(this, name, resolved);
              }
            } catch (e) {}
            return origSet.call(this, name, value);
          };
        }
        return el;
      };
    } catch (e) {
      // ignore patch failures — best-effort only
      console.warn('vibesim asset shim failed', e);
    }
  })();

  // Intercept fetch and XMLHttpRequest to remap requested resource URLs through resolveAssetPath so scripts/canvases/fetch loads use blob/data URLs
  (function(){
    try {
      // Patch fetch
      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        try {
          let url = (typeof input === 'string') ? input : (input && input.url) ? input.url : null;
          if (url) {
            const resolved = resolveAssetPath(String(url));
            if (resolved) {
              if (typeof input === 'string') input = resolved;
              else if (input && input instanceof Request) {
                input = new Request(resolved, input);
              } else if (typeof input === 'object' && input.url) {
                input = new Request(resolved, input);
              }
            }
          }
        } catch (e) { /* ignore remap errors */ }
        return originalFetch.apply(this, arguments);
      };

      // Patch XHR open to rewrite the url argument
      const OriginalXHR = window.XMLHttpRequest;
      function PatchedXHR() {
        const xhr = new OriginalXHR();
        const origOpen = xhr.open;
        xhr.open = function(method, url) {
          try {
            const resolved = resolveAssetPath(String(url));
            if (resolved) url = resolved;
          } catch (e) {}
          return origOpen.apply(xhr, [method, url].concat(Array.prototype.slice.call(arguments,2)));
        };
        return xhr;
      }
      // keep prototype chain intact
      PatchedXHR.prototype = OriginalXHR.prototype;
      window.XMLHttpRequest = PatchedXHR;
    } catch (e) {
      console.warn('Failed to patch fetch/XHR asset remap', e);
    }
  })();

  // Intercept Canvas drawImage to resolve image element srcs or URL-like args so drawImage loads correctly for images that used local paths
  (function(){
    try {
      const ctxProto = CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
      if (ctxProto) {
        const originalDrawImage = ctxProto.drawImage;
        ctxProto.drawImage = function(image, sx, sy, sw, sh, dx, dy, dw, dh) {
          try {
            // If first arg is an HTMLImageElement, resolve its src and swap to a new Image if needed
            if (image && image.tagName && image.tagName.toLowerCase() === 'img') {
              const resolved = resolveAssetPath(image.getAttribute('src') || image.src || '');
              if (resolved && resolved !== image.src) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = resolved;
                // If the image hasn't loaded yet, draw after it loads (fallback to original with original image)
                if (!img.complete) {
                  img.onload = () => {
                    try {
                      originalDrawImage.apply(this, [img, sx, sy, sw, sh, dx, dy, dw, dh].filter(a => a !== undefined));
                    } catch (e) {}
                  };
                  // return early; original drawImage may still run with stale image but we won't block
                  return;
                } else {
                  image = img;
                }
              }
            } else if (typeof image === 'string') {
              // drawImage may be called with a URL in some contexts; remap it
              const resolved = resolveAssetPath(image);
              if (resolved) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = resolved;
                if (!img.complete) {
                  img.onload = () => {
                    try { originalDrawImage.apply(this, [img, sx, sy, sw, sh, dx, dy, dw, dh].filter(a => a !== undefined)); } catch(e){}
                  };
                  return;
                } else {
                  image = img;
                }
              }
            }
          } catch (e) {
            // ignore resolution errors and fall back to default behavior
          }
          return originalDrawImage.apply(this, arguments);
        };
      }
    } catch (e) {
      console.warn('Failed to patch canvas drawImage', e);
    }
  })();

  // Websim Services Simulation (Local)
  if (${state.abilities.websim_services}) {
    class MockCollection {
      constructor(type) { this.type = type; this.data = []; }
      async create(item) { 
        const record = { id: Math.random().toString(36).substr(2, 9), created_at: new Date().toISOString(), ...item };
        this.data.push(record); 
        console.log('[WebsimSim] Local DB Create:', this.type, record);
        return record;
      }
      getList() { return [...this.data].reverse(); }
      subscribe(cb) { cb(this.getList()); return () => {}; }
      filter() { return this; }
    }

    window.WebsimSocket = class MockWebsimSocket {
      constructor() {
        this.presence = {};
        this.roomState = {};
        this.peers = { 'local-client': { username: 'PreviewUser', avatarUrl: '' } };
        this.clientId = 'local-client';
        this.collections = {};
      }
      async initialize() { console.log('[WebsimSim] Socket Initialized (Local Mode)'); }
      collection(type) { if(!this.collections[type]) this.collections[type] = new MockCollection(type); return this.collections[type]; }
      updatePresence(p) { this.presence[this.clientId] = { ...this.presence[this.clientId], ...p }; }
      updateRoomState(s) { this.roomState = { ...this.roomState, ...s }; }
      subscribePresence(cb) { cb(this.presence); return () => {}; }
      subscribeRoomState(cb) { cb(this.roomState); return () => {}; }
      send(data) { console.log('[WebsimSim] Local Broadcast:', data); if(this.onmessage) this.onmessage({ data }); }
    };

    window.websim = {
      chat: { completions: { create: async () => ({ content: "AI Simulation not available in preview mode. Use agentic mode in editor." }) } },
      imageGen: async (opts) => {
        console.log('[WebsimSim] Local imageGen requested:', opts);
        return { url: "https://via.placeholder.com/512?text=" + encodeURIComponent(opts.prompt || 'Image') };
      },
      textToSpeech: async (opts) => {
        console.log('[WebsimSim] Local TTS requested:', opts);
        return { url: "" };
      },
      postComment: async (c) => { console.log('[WebsimSim] Local Comment:', c); alert('Websim Service: Local Comment Simulated. Features like database, multiplayer and comments are simulation-only in preview.'); },
      upload: async (file) => {
          console.log('[WebsimSim] Local upload simulation:', file.name);
          return URL.createObjectURL(file);
      }
    };
  }

  function send(obj){
    try{ parent.postMessage({ __vibesim_runtime_error: true, payload: obj }, '*'); }catch(e){}
  }
  window.addEventListener('error', function(e){
    send({
      type: 'error',
      message: String(e.message),
      filename: e.filename || null,
      lineno: e.lineno || null,
      colno: e.colno || null,
      stack: e.error && e.error.stack ? String(e.error.stack) : (e.error ? String(e.error) : null)
    });
  });
  window.addEventListener('unhandledrejection', function(ev){
    const r = ev && ev.reason ? ev.reason : ev;
    send({
      type: 'promise',
      message: (r && r.message) ? r.message : String(r),
      stack: r && r.stack ? String(r.stack) : null
    });
  });
  // also provide a manual reporter for tests
  window.__vibesim_report = function(obj){ send(obj); };
})();
<\/script>
</body>`;
    // replace the closing </body> if exists, otherwise append the injection
    if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', injection);
    } else {
        finalHtml += injection;
    }

    const blob = new Blob([finalHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    // Clear old URL if needed (revoke previously created blob URLs for preview HTML)
    if (elements.previewIframe.src && elements.previewIframe.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(elements.previewIframe.src); } catch (e) {}
    }
    
    // Also revoke any asset blob URLs we created earlier when appropriate (keep them alive while preview uses them)
    // We'll store created object URLs on the iframe element to revoke them on next update
    if (!elements.previewIframe._vibesim_assets) elements.previewIframe._vibesim_assets = [];
    // push current asset URLs that are object: scheme so we can revoke them later
    Object.values(assetUrlMap).forEach(u => { if (typeof u === 'string' && u.startsWith('blob:')) elements.previewIframe._vibesim_assets.push(u); });

    elements.previewIframe.onload = () => {
        // Delay slightly to ensure fonts/images in preview have a chance
        setTimeout(takeScreenshot, 1000);
        // schedule revocation of old asset object URLs (keep the ones just added)
        try {
            const old = elements.previewIframe._vibesim_prev_assets || [];
            old.forEach(u => { try { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); } catch (e) {} });
            elements.previewIframe._vibesim_prev_assets = elements.previewIframe._vibesim_assets.slice();
            elements.previewIframe._vibesim_assets = [];
        } catch (e) { /* ignore */ }
    };
    
    elements.previewIframe.src = url;
}

/* Handle messages from iframe about runtime errors */
function handleIframeMessage(e) {
    const raw = e && e.data;

    // Handle console messages
    if (raw && raw.__vibesim_console) {
        logToConsole(raw.type, raw.message);
        return;
    }

    // If the message indicates a blocked external resource, show a small prompt to the user.
    if (raw && raw.__vibesim_resource_blocked) {
        const url = raw.url;
        if (state.externalResourceAllowances.has(url)) return; // Already allowed for this session

        const popup = document.createElement('div');
        popup.className = 'external-resource-popup';
        popup.innerHTML = `
            <h3 class="text-red-400 font-bold mb-2">Resource Blocked</h3>
            <p class="text-xs text-gray-300 mb-4">The project attempted to access an external resource: <br><code class="text-[10px] break-all text-gray-500">${escapeHtml(url)}</code></p>
            <div class="flex gap-2">
                <button class="btn-primary flex-1 py-1" onclick="this.parentElement.parentElement.remove()">Block</button>
                <button class="btn-secondary flex-1 py-1" onclick="alert('Manual allowance not implemented in this demo'); this.parentElement.parentElement.remove()">Allow for session</button>
            </div>
        `;
        document.body.appendChild(popup);
        return;
    }

    // Non-object messages are usually benign (e.g., ResizeObserver noise). Still check and early-exit only known benign cases.
    if (!raw || typeof raw !== 'object') {
        const txt = String(raw || '');
        if (txt.includes('ResizeObserver loop completed with undelivered notifications')) return;
        // For any other non-object message, surface a simple assistant notice so the user is aware of unexpected iframe messages.
        addMessage('assistant-vibe', `Preview sent unexpected message: ${txt.slice(0, 200)}`);
        return;
    }

    // Only handle messages flagged as runtime errors from the iframe shim
    if (!raw.__vibesim_runtime_error) return;
    const payload = raw.payload || {};

    // Ignore the same noisy ResizeObserver message when it's packaged in payload
    if (typeof payload.message === 'string' && payload.message.includes('ResizeObserver loop completed with undelivered notifications')) {
        return;
    }

    // Build a concise summary and a full detailed error string
    const summary = payload.message || 'Runtime error';
    const location = (payload.filename ? ` in ${payload.filename}` : '') + (payload.lineno ? `:${payload.lineno}` : '') + (payload.colno ? `:${payload.colno}` : '');
    const full = [
        `Type: ${payload.type || 'error'}`,
        `Message: ${payload.message || ''}`,
        payload.filename ? `File: ${payload.filename}` : null,
        payload.lineno ? `Line: ${payload.lineno}` : null,
        payload.colno ? `Col: ${payload.colno}` : null,
        payload.stack ? `Stack:\n${payload.stack}` : null
    ].filter(Boolean).join('\n');

    // If an agentic run is active, buffer runtime errors so the agent can see them in context; otherwise create an error card immediately.
    try {
        const agenticEnabled = document.getElementById('agentic-mode')?.checked;
        if (state.isProcessing && agenticEnabled) {
            if (!Array.isArray(state._deferredErrors)) state._deferredErrors = [];
            state._deferredErrors.push({ brief: summary + (location ? location : ''), full: full });
            // Also inform the user that the agent has noted an error
            addMessage('assistant-vibe', `Runtime error detected during agentic run: ${truncate(summary + (location ? location : ''), 120)} — agent will attempt to fix.`);
            return;
        }
    } catch (err) {
        // If buffering fails, surface both the payload and the buffering error so you're always informed.
        createErrorCard(`Error buffering iframe message: ${String(err.message || err)}`, `Buffering failure:\n${String(err && err.stack ? err.stack : err)}\n\nOriginal payload:\n${JSON.stringify(payload, null, 2)}`);
        // rethrow so developers see it during debugging in environments where exceptions are monitored
        throw err;
    }

    // Create a clickable card in the chat area with a FIX button so the user can inject the error into the chat/editor flow
    createErrorCard(summary + (location ? location : ''), full);
}

function createErrorCard(brief, fullErrorText) {
    const agenticEnabled = document.getElementById('agentic-mode')?.checked;
    const isAgenticRunActive = !!(state.isProcessing && agenticEnabled);

    // Always record the error for agent context and deferred processing,
    // but if errors are currently suppressed we'll still show a minimal non-blocking notice.
    try {
        if (!Array.isArray(state._deferredErrors)) state._deferredErrors = [];
        state._deferredErrors.push({ brief, full: fullErrorText });
    } catch (e) {
        console.warn('Failed to queue deferred error', e);
    }

    // If suppression is active, show a lightweight toast and a compact inline note instead of a full card.
    if (state._suppressErrors) {
        // Lightweight non-blocking inline notice in chat area
        try {
            const note = document.createElement('div');
            note.className = 'ai-status-card';
            note.style.display = 'flex';
            note.style.justifyContent = 'space-between';
            note.style.alignItems = 'center';
            note.style.opacity = '0.95';
            note.style.background = 'linear-gradient(90deg, rgba(255, 200, 120, 0.06), rgba(255,255,255,0.02))';
            note.style.border = '1px solid rgba(255,180,80,0.06)';
            note.style.padding = '8px';
            note.innerHTML = `<div style="flex:1"><div style="font-weight:700;color:#ffd2a6">Runtime error detected</div>
                              <div style="font-size:11px;color:#9aa6b2;margin-top:4px">${escapeHtml(truncate(brief, 120))}</div></div>
                              <div style="margin-left:12px"><button class="btn-secondary" style="padding:6px 10px;font-size:11px">Open</button></div>`;
            elements.chatMessages.appendChild(note);
            elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
            // Also show transient snackbar so user is aware
            showSnackbar('Runtime error detected — agent will handle it (or open chat to inspect).');
        } catch (e) {
            console.warn('Failed to render suppressed error notice', e);
        }
        // Don't continue to render the full interactive error card while suppressed, but keep error queued.
        return;
    }

    // Render full interactive error card when not suppressed
    const div = document.createElement('div');
    div.className = 'ai-status-card';
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';

    const left = document.createElement('div');
    left.style.flex = '1';

    if (isAgenticRunActive) {
        left.innerHTML = `<div style="font-weight:600;color:#ffd2a6">There was an error in the code, but the agent AI received it and will fix it now!</div>
                          <div style="font-size:11px;color:#9aa6b2;margin-top:6px">Error summary: ${escapeHtml(truncate(brief, 120))}</div>`;
    } else {
        left.innerHTML = `<div style="font-weight:600;color:#ffd2a6">${escapeHtml(brief)}</div>
                          <div style="font-size:11px;color:#9aa6b2;margin-top:6px;white-space:pre-wrap;max-height:72px;overflow:auto">${escapeHtml(truncate(fullErrorText, 300))}</div>`;
    }

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.flexDirection = 'column';
    controls.style.gap = '8px';
    controls.style.marginLeft = '12px';

    const fixBtn = document.createElement('button');
    fixBtn.textContent = 'FIX';
    fixBtn.className = 'ai-status-badge badge-edited';
    fixBtn.style.cursor = 'pointer';
    fixBtn.addEventListener('click', () => {
        const payload = isAgenticRunActive ? `Agentic-context: ${brief}\n\n(Agent has been notified)` : fullErrorText;
        elements.chatInput.value = elements.chatInput.value ? elements.chatInput.value + '\n\n' + payload : payload;
        elements.chatInput.focus();
        state.activePanel = 'chat';
        state.sidebarOpen = true;
        updateSidebar();
    });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.className = 'ai-status-badge';
    copyBtn.style.cursor = 'pointer';
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(fullErrorText);
            copyBtn.textContent = 'Copied';
            setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
        } catch (e) {
            copyBtn.textContent = 'Err';
            setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
        }
    });

    controls.appendChild(fixBtn);
    controls.appendChild(copyBtn);

    div.appendChild(left);
    div.appendChild(controls);

    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    // record concise runtime error note so agentic 'Continue' prompts include it
    try {
        if (!Array.isArray(state.generationNotes)) state.generationNotes = [];
        const note = isAgenticRunActive ? `Runtime error (agentic): ${brief}` : `Runtime error: ${brief} — ${fullErrorText.slice(0,400)}`;
        state.generationNotes.push(note);
    } catch (e) { /* ignore */ }

    try { saveProjectsToStorage(); } catch (e) { console.warn('Autosave failed after error card', e); }
}

function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function formatContextAsKTokens(n) {
    // Accept numbers or numeric strings; return human-friendly abbreviated form like "200k tokens" or "1.5k tokens"
    if (n === undefined || n === null || n === '—' || n === '') return '—';
    const num = Number(n);
    if (!isFinite(num)) return '—';
    if (num >= 1000) {
        // Show one decimal if needed (e.g., 1500 -> 1.5k)
        const k = num / 1000;
        return `${Number.isInteger(k) ? k.toString() : k.toFixed(1)}k tokens`;
    }
    return `${num} tokens`;
}

function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe).replace(/[&<>"']/g, function (m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
}

/* Credits panel: fetch and render /api/usage and /api/credits */
async function fetchUsage() {
    try {
        const base = new URL(state.apiEndpoint).origin;
        const res = await fetch(`${base}/api/usage`);
        if (!res.ok) throw new Error('Usage request failed');
        return await res.json();
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function fetchCredits() {
    try {
        const base = new URL(state.apiEndpoint).origin;
        const res = await fetch(`${base}/api/credits`);
        if (!res.ok) throw new Error('Credits request failed');
        return await res.json();
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function renderCreditsPanel() {
    const container = document.getElementById('credits-content');
    if (!container) return;

    // Clear container and show compact loading placeholder
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
                <div style="font-size:13px;font-weight:800;color:#e6eef8">Credits & Usage</div>
                <div id="credits-sub-note" style="font-size:12px;color:#9aa6b2;margin-top:6px">Daily allowance resets — Tip credits persist.</div>
            </div>
            <button id="refresh-credits" class="btn-secondary" style="padding:6px 10px">Refresh</button>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap" id="credits-summary-wrap">
            <div style="flex:1;min-width:240px" id="credits-summary-main"></div>
            <div style="width:320px;min-width:240px" id="credits-quick-actions"></div>
        </div>
        <div id="credits-details" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>
        <div id="credits-history" style="margin-top:6px"></div>
    </div>`;

    const summaryMain = document.getElementById('credits-summary-main');
    const quickActions = document.getElementById('credits-quick-actions');
    const details = document.getElementById('credits-details');
    const history = document.getElementById('credits-history');

    summaryMain.innerHTML = `<div class="ai-status-card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:12px">
                <div class="ai-status-icon"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a5 5 0 00-5 5v.5A6.5 6.5 0 006.5 14H12v6l4-2 4 2V9a7 7 0 00-7-7z"/></svg></div>
                <div>
                    <div style="font-size:14px;font-weight:800;color:#e6eef8">Available Credits</div>
                    <div id="credits-linked-note" style="font-size:12px;color:#9aa6b2"></div>
                </div>
            </div>
            <div id="credits-total-num" style="text-align:right">
                <div style="font-size:20px;font-weight:900;color:#7dd3fc">—</div>
                <div style="font-size:11px;color:#9aa6b2">combined</div>
            </div>
        </div>
        <div id="credits-breakdowns" style="display:flex;gap:8px;flex-wrap:wrap"></div>
    </div>`;

    quickActions.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
        <button id="claim-credits-btn" class="btn-primary" style="width:100%">Claim credits from tips</button>
        <button id="buy-credits-btn" class="btn-secondary" style="width:100%">Buy Credits</button>
        <div style="font-size:12px;color:#9aa6b2;padding:8px;border-radius:8px;background:#0b1114;border:1px solid rgba(255,255,255,0.02)">
            Tip credits persist across days and are combined with your daily allowance for use.
        </div>
        <div style="font-size:12px;color:#9aa6b2;padding:6px;border-radius:6px;margin-top:6px;background:transparent;border:1px solid rgba(255,255,255,0.02)">
            Conversion rate: Every 10 credits you tip = 1 Vibesim AI credit.
        </div>
    </div>`;

    // populate initial placeholders
    document.getElementById('credits-total-num').querySelector('div').textContent = 'Loading…';
    document.getElementById('credits-linked-note').textContent = state.prompterId ? `Linked: ${state.prompterId}` : '';

    // Fetch data
    let usage = await fetchUsage();
    let credits = await fetchCredits();

    // Normalize
    const daily = (usage && usage.daily) ? usage.daily : { used: 0, limit: 0, remaining: 0 };
    const tips = (credits && credits.awardedCredits) ? credits.awardedCredits : { remaining: 0, history: [] };

    const dailyRemaining = typeof daily.remaining === 'number' ? daily.remaining : Number(daily.remaining) || 0;
    const dailyLimit = typeof daily.limit === 'number' ? daily.limit : Number(daily.limit) || 0;
    const tipsRemaining = typeof tips.remaining === 'number' ? tips.remaining : Number(tips.remaining) || 0;
    const combined = dailyRemaining + tipsRemaining;

    // Fill summary numbers
    const totalNumEl = document.getElementById('credits-total-num');
    totalNumEl.querySelector('div').textContent = `${combined} credits`;

    // Build breakdown bars (visual)
    const breakdowns = document.getElementById('credits-breakdowns');
    breakdowns.innerHTML = `
        <div style="flex:1;min-width:160px">
            <div style="font-size:12px;color:#9aa6b2;margin-bottom:6px">Daily Remaining</div>
            <div style="background:#0b0b0d;border-radius:8px;padding:6px;border:1px solid rgba(255,255,255,0.02)">
                <div style="height:10px;background:#071022;border-radius:8px;overflow:hidden">
                    <div style="width:${dailyLimit>0?Math.max(0,Math.min(100,(dailyRemaining/dailyLimit)*100)):0}%;height:100%;background:linear-gradient(90deg,#34d399,#60a5fa)"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#9aa6b2;margin-top:6px">
                    <div>${dailyRemaining} remaining</div>
                    <div>Limit: ${dailyLimit}</div>
                </div>
            </div>
        </div>
        <div style="flex:1;min-width:160px">
            <div style="font-size:12px;color:#9aa6b2;margin-bottom:6px">Tip Credits (Persistent)</div>
            <div style="background:#0b0b0d;border-radius:8px;padding:6px;border:1px solid rgba(255,255,255,0.02)">
                <div style="height:10px;background:#071022;border-radius:8px;overflow:hidden">
                    <div style="width:${combined>0?Math.max(0,Math.min(100,(tipsRemaining/Math.max(1,combined))*100)):0}%;height:100%;background:linear-gradient(90deg,#7dd3fc,#60a5fa)"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#9aa6b2;margin-top:6px">
                    <div>${tipsRemaining} tips</div>
                    <div>Persistent</div>
                </div>
            </div>
        </div>
    `;

    // Details: show compact cards for recent usage and tips
    details.innerHTML = '';
    const usageCard = document.createElement('div');
    usageCard.className = 'ai-status-card';
    usageCard.style.padding = '12px';
    usageCard.innerHTML = `<div style="font-weight:700;color:#e6eef8">Usage (Today)</div>
        <div style="font-size:12px;color:#9aa6b2;margin-top:6px">Used: ${daily.used ?? 0} • Remaining: ${dailyRemaining} • Limit: ${dailyLimit}</div>`;
    details.appendChild(usageCard);

    const tipsCard = document.createElement('div');
    tipsCard.className = 'ai-status-card';
    tipsCard.style.padding = '12px';
    tipsCard.innerHTML = `<div style="font-weight:700;color:#e6eef8">Tip Credits</div>
        <div style="font-size:12px;color:#9aa6b2;margin-top:6px">${tipsRemaining} credits available to claim/convert.</div>`;
    details.appendChild(tipsCard);

    // History: compact recent tip events
    history.innerHTML = '';
    const hist = Array.isArray(tips.history) ? tips.history.slice(0, 10) : [];
    if (hist.length === 0) {
        history.innerHTML = `<div style="font-size:13px;color:#9aa6b2">No recent tip activity.</div>`;
    } else {
        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '8px';
        hist.forEach(it => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '8px';
            row.style.borderRadius = '8px';
            row.style.background = '#0b0b0d';
            row.style.border = '1px solid rgba(255,255,255,0.02)';
            const who = it.granted_by ? escapeHtml(String(it.granted_by)) : 'system';
            const when = it.granted_at ? escapeHtml(String(it.granted_at)) : '';
            const amount = escapeHtml(String(it.amount ?? '?'));
            row.innerHTML = `<div style="font-weight:700;color:#e6eef8">${amount} credits</div>
                <div style="font-size:12px;color:#9aa6b2;text-align:right">${who}<div style="font-size:11px;color:#666">${when}</div></div>`;
            list.appendChild(row);
        });
        history.appendChild(list);
    }

    // Wire actions
    document.getElementById('refresh-credits')?.addEventListener('click', () => renderCreditsPanel());
    document.getElementById('claim-credits-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('claim-credits-btn');
        btn.disabled = true;
        btn.textContent = 'Verifying…';
        try {
            const base = new URL(state.apiEndpoint).origin;
            const res = await fetch(`${base}/api/award-credits`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (data && data.success) {
                addMessage('assistant-vibe', 'Tip conversion succeeded; see updated credits.');
                await renderCreditsPanel();
            } else {
                addMessage('assistant-vibe', `Claim failed: ${data && (data.message || data.error) ? (data.message || data.error) : 'unknown'}`);
            }
        } catch (e) {
            addMessage('assistant-vibe', `Claim error: ${e.message}`);
        } finally {
            if (document.body.contains(document.getElementById('claim-credits-btn'))) {
                const b = document.getElementById('claim-credits-btn');
                b.disabled = false;
                b.textContent = 'Verify & Claim';
            }
        }
    });

    document.getElementById('buy-credits-btn')?.addEventListener('click', () => {
        addMessage('assistant-vibe', 'Opening credits purchase flow (preview).');
        // open a stub purchase dialog
        showDialog({ title: 'Buy Credits', body: 'Purchasing flow is only available on the production site.', confirmText: 'OK' });
    });

    // Update linked note
    const linkedNote = document.getElementById('credits-linked-note');
    if (linkedNote) linkedNote.textContent = state.prompterId ? `Linked: ${state.prompterId}` : '';
}

/* Settings panel renderer (was missing; prevents unhandledRejection) */
function renderSettingsPanel() {
    // Simplify settings: consent is enforced/hidden and Settings should only expose Read Policy and Request Data Deletion.
    try {
        const consentToggle = document.getElementById('consent-toggle');
        const settingsLinked = document.getElementById('settings-linked');

        // Ensure consent is set and persisted
        state.consent = true;
        try { localStorage.setItem('vibesim_consent', '1'); } catch (e) {}

        // Informational note about data lifecycle: when this project (VibeSim) is retired, user data will be deleted.
        try {
            const settingsNoteEl = document.getElementById('settings-note');
            if (settingsNoteEl) {
                settingsNoteEl.textContent = (settingsNoteEl.textContent || '') + '\n\nNote: When this project (VibeSim) is retired, all user data will be deleted.';
            }
        } catch (err) { /* ignore DOM issues */ }

        // Hide the consent checkbox from the UI to prevent interaction
        if (consentToggle) {
            consentToggle.checked = true;
            consentToggle.style.display = 'none';
            consentToggle.disabled = true;
        }

        // Show linked account only (if present)
        if (settingsLinked) settingsLinked.textContent = state.prompterId ? `Linked as: ${escapeHtml(state.prompterId)}` : '';

        // Hide the top-level "Save" consent button (we auto-consent)
        const saveBtn = document.getElementById('save-consent');
        if (saveBtn) saveBtn.style.display = 'none';

        // Ensure "Read Policy" (reopen-privacy) remains visible and user can open it
        const reopen = document.getElementById('reopen-privacy');
        if (reopen) {
            reopen.style.display = '';
            reopen.textContent = 'Read Policy';
        }

        // Add "Request Data Deletion" button (idempotent)
        if (!document.getElementById('request-data-deletion-btn')) {
            const wrapper = document.createElement('div');
            wrapper.style.marginTop = '12px';
            wrapper.style.display = 'flex';
            wrapper.style.justifyContent = 'flex-start';
            wrapper.style.gap = '8px';

            const btn = document.createElement('button');
            btn.id = 'request-data-deletion-btn';
            btn.className = 'btn-secondary';
            btn.style.background = '#3b0f0f';
            btn.style.color = '#ffd2d2';
            btn.style.border = '1px solid rgba(248, 113, 113, 0.12)';
            btn.textContent = 'Request Data Deletion';

            wrapper.appendChild(btn);
            const settingsPanel = document.getElementById('settings-panel');
            if (settingsPanel) settingsPanel.querySelector('div[style]')?.appendChild(wrapper);

            btn.addEventListener('click', async () => {
                const ok = await showDialog({
                    title: 'Request Data Deletion',
                    body: 'Warning: Your data deletion will be processed after a minimum of 14 days from this notice. You will lose all credits and access to the app when deletion is completed. For API security and GDPR compliance, please note that technical data (IP addresses used for API requests) may be retained for up to 14 days to support rate limiting and prevent abuse. Do you want to proceed?',
                    input: false,
                    confirmText: 'Yes, request deletion',
                    cancelText: 'Cancel'
                });
                if (!ok) return;

                const commentText = '_I request the deletion of all my data, and my account from your api. @CoponStackos_';
                try {
                    if (window.websim && typeof window.websim.postComment === 'function') {
                        await window.websim.postComment({ content: commentText });
                        addMessage('assistant-vibe', 'Deletion request comment posted.');
                    } else {
                        addMessage('assistant-vibe', 'Deletion request recorded (preview) — comment could not be posted in this environment.');
                    }
                } catch (e) {
                    console.warn('postComment failed for deletion request', e);
                    addMessage('assistant-vibe', 'Failed to post deletion request comment in preview.');
                }

                const now = Date.now();
                localStorage.setItem('vibesim_deletion_requested_at', String(now));
                state.deletionRequestedAt = now;

                await showDialog({
                    title: 'Request Recorded',
                    body: 'Your deletion request has been recorded. Your account will be subject to the deletion process; you will not be able to use the app during processing.',
                    confirmText: 'OK',
                    cancelText: 'Close'
                });

                // Primary non-dismissible lockout modal (existing behavior)
                const modal = document.getElementById('vibesim-deletion-lockout-modal');
                if (!modal) {
                    const m = document.createElement('div');
                    m.id = 'vibesim-deletion-lockout-modal';
                    m.className = 'modal-overlay show';
                    m.style.zIndex = 6000;
                    m.innerHTML = `
                      <div class="project-modal" style="max-width:640px; padding: 20px;">
                        <div class="modal-header">Account Deletion Requested</div>
                        <div style="padding:16px; color:#cbd5e1; font-size:13px; line-height:1.45">
                          <p>You requested deletion; this request is being processed. For at least the next 14 days you may not use the app.</p>
                          <p style="margin-top:12px;color:#f87171;font-weight:700">You will lose all credits and access once deletion proceeds. This action is irreversible and will permanently remove your account. You will lose all access to the app and any associated accounts or data when deletion completes.</p>
                        </div>
                        <div style="padding:16px;color:#9aa6b2;font-size:12px">This screen cannot be dismissed while deletion is being processed.</div>
                      </div>
                    `;
                    document.body.appendChild(m);
                }

                // Extra persistent warning #1: prominent, non-dismissible confirmation
                if (!document.getElementById('vibesim-deletion-warning-1')) {
                    const w1 = document.createElement('div');
                    w1.id = 'vibesim-deletion-warning-1';
                    w1.className = 'modal-overlay show';
                    w1.style.zIndex = 6100;
                    w1.innerHTML = `
                      <div class="project-modal" style="max-width:560px; padding:18px;">
                        <div class="modal-header" style="background:#2b0b0b;color:#ffd2d2">Final Notice — Deletion In Progress</div>
                        <div style="padding:12px; color:#ffdede; font-size:13px; line-height:1.4">
                          <p style="font-weight:700">Important: When deletion completes you will permanently lose access to this application and any accounts tied to it.</p>
                          <p style="margin-top:8px;color:#ffdede">All credits, templates, projects and history will be removed without possibility of recovery. Please ensure you have backed up anything you need before this completes.</p>
                        </div>
                        <div style="padding:10px;color:#ffcfcf;font-size:12px">This warning cannot be dismissed during processing.</div>
                      </div>
                    `;
                    document.body.appendChild(w1);
                }

                // Extra persistent warning #2: additional affirmation and contact instruction
                if (!document.getElementById('vibesim-deletion-warning-2')) {
                    const w2 = document.createElement('div');
                    w2.id = 'vibesim-deletion-warning-2';
                    w2.className = 'modal-overlay show';
                    w2.style.zIndex = 6200;
                    w2.innerHTML = `
                      <div class="project-modal" style="max-width:520px; padding:16px;">
                        <div class="modal-header" style="background:#3a0c0c;color:#ffe7e7">Irreversible Action</div>
                        <div style="padding:12px; color:#ffe6e6; font-size:13px; line-height:1.4">
                          <p style="font-weight:700">You will lose all access — this is irreversible.</p>
                          <p style="margin-top:8px;color:#ffdede">If you believe this was a mistake, contact the project creator immediately (mention your username). Otherwise, the process will continue and your account will be removed.</p>
                        </div>
                        <div style="padding:10px;color:#ffdede;font-size:12px">This message will remain until deletion processing ends.</div>
                      </div>
                    `;
                    document.body.appendChild(w2);
                }

                enforceConsentRestrictions();
            });
        }
    } catch (e) {
        console.warn('renderSettingsPanel error', e);
    }
}

/* Consent enforcement: when user has NOT consented, blur/disable AI features and hide credits */
function enforceConsentRestrictions() {
    try {
        const hasConsent = !!state.consent;

        // Chat area: blur messages, disable input and send button, overlay notice
        const chatMessages = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const abortBtn = document.getElementById('abort-btn');

        // credits panel: blur and overlay
        const creditsPanel = document.getElementById('credits-content');

        // model dropdown: disable selecting cloud models
        const modelTrigger = document.getElementById('model-trigger');

        // Abilities checkbox disable
        const abilityWebsim = document.getElementById('ability-websim');

        // Helper to add overlay
        function addOverlay(target, idSuffix, text) {
            if (!target) return;
            // remove existing
            const existing = target.querySelector(`.consent-overlay-${idSuffix}`);
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.className = `consent-overlay-${idSuffix}`;
            overlay.style.position = 'absolute';
            overlay.style.inset = '0';
            overlay.style.background = 'rgba(5,5,5,0.6)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = 1200;
            overlay.style.color = '#cbd5e1';
            overlay.style.fontSize = '13px';
            overlay.style.backdropFilter = 'blur(4px)';
            overlay.style.padding = '12px';
            overlay.innerText = text;
            // make container position:relative to allow absolute overlay
            if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
            target.appendChild(overlay);
        }

        function removeOverlay(target, idSuffix) {
            if (!target) return;
            const existing = target.querySelector(`.consent-overlay-${idSuffix}`);
            if (existing) existing.remove();
        }

        if (!hasConsent) {
            // Chat: disable input and send
            if (chatInput) {
                chatInput.disabled = true;
                chatInput.style.filter = 'blur(0.6px)';
                chatInput.placeholder = 'AI features disabled — you did not agree to the privacy policy.';
            }
            if (sendBtn) sendBtn.disabled = true;
            if (abortBtn) abortBtn.disabled = true;

            if (chatMessages) {
                chatMessages.style.filter = 'blur(2px)';
                chatMessages.style.pointerEvents = 'none';
                // Add overlay notice inside the chat panel wrapper
                const chatPanel = document.getElementById('chat-panel');
                if (chatPanel) addOverlay(chatPanel, 'chat', 'AI features and chat are disabled because you did not agree to the privacy policy. Go to Settings to enable.');
            }

            // Credits: blur and overlay text
            if (creditsPanel) {
                creditsPanel.style.filter = 'blur(2px)';
                addOverlay(creditsPanel, 'credits', 'Credits hidden — you did not agree to the privacy policy.');
            }

            // Model dropdown and abilities: visually disable and prevent interactions
            if (modelTrigger) {
                modelTrigger.style.pointerEvents = 'none';
                modelTrigger.style.opacity = '0.5';
            }
            if (abilityWebsim) {
                abilityWebsim.disabled = true;
            }

            // Also disable agentic toggle
            const agentCheckbox = document.getElementById('agentic-mode');
            if (agentCheckbox) {
                agentCheckbox.disabled = true;
                agentCheckbox.title = 'Disabled until you agree to the privacy policy.';
            }
        } else {
            // Re-enable controls
            if (chatInput) {
                chatInput.disabled = false;
                chatInput.style.filter = '';
                chatInput.placeholder = 'Describe what you want to build...';
            }
            if (sendBtn) sendBtn.disabled = false;
            if (abortBtn) abortBtn.disabled = false;

            if (chatMessages) {
                chatMessages.style.filter = '';
                chatMessages.style.pointerEvents = '';
                const chatPanel = document.getElementById('chat-panel');
                if (chatPanel) removeOverlay(chatPanel, 'chat');
            }

            if (creditsPanel) {
                creditsPanel.style.filter = '';
                removeOverlay(creditsPanel, 'credits');
            }

            if (modelTrigger) {
                modelTrigger.style.pointerEvents = '';
                modelTrigger.style.opacity = '';
            }
            if (abilityWebsim) {
                abilityWebsim.disabled = false;
            }
            const agentCheckbox = document.getElementById('agentic-mode');
            if (agentCheckbox) {
                agentCheckbox.disabled = false;
                agentCheckbox.title = '';
            }
        }

        // Ensure dropdown options are refreshed too
        setupCustomDropdown();
    } catch (e) {
        console.warn('enforceConsentRestrictions error', e);
    }
}

/* Monaco loader + initialization */
function loadMonaco() {
    return new Promise((resolve) => {
        if (window.monaco) {
            monacoLoaderReady = true;
            createMonacoEditor();
            return resolve();
        }

        // Configure loader base path
        require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.39.0/min/vs' }});
        require(['vs/editor/editor.main'], () => {
            monacoLoaderReady = true;
            createMonacoEditor();
            resolve();
        });
    });
}

function createMonacoEditor() {
    if (!elements.monacoContainer) return;
    // create a single model that will be reused
    const initial = state.files[state.activeTab]?.content || '';
    const language = (getLang(state.activeTab) === 'javascript') ? 'javascript' : (getLang(state.activeTab) === 'css' ? 'css' : (getLang(state.activeTab) === 'html' ? 'html' : 'plaintext'));
    // Create or reuse a model with a stable file:// URI so future lookups reliably match by path,
    // avoiding "model already exists" errors when re-initializing Monaco.
    const uri = monaco.Uri.parse('file:///' + (state.activeTab || ('untitled-' + Date.now())).replace(/\\/g, '/'));
    let model = null;
    try {
        model = monaco.editor.getModel(uri);
    } catch (e) {
        model = null;
    }
    if (model) {
        // Ensure language and content are up-to-date
        try {
            monaco.editor.setModelLanguage(model, language);
            if (model.getValue() !== initial) {
                model.pushEditOperations([], [{ range: model.getFullModelRange(), text: initial }], () => null);
            }
        } catch (e) {
            try { model.setValue(initial); } catch (err) { /* ignore */ }
        }
    } else {
        model = monaco.editor.createModel(initial, language, uri);
    }

    monacoEditor = monaco.editor.create(elements.monacoContainer, {
        model,
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: "JetBrains Mono, Monaco, 'Courier New', monospace",
        fontSize: 13,
        wordWrap: 'off',
    });

    // Sync Monaco changes back into state using the current model's URI to determine the file path.
    // This avoids relying on state.activeTab which could be stale during rapid tab switches.
    monacoEditor.onDidChangeModelContent(() => {
        try {
            const model = monacoEditor.getModel();
            if (!model || !model.uri) return;
            // model.uri.path is like "/path/to/file.ext" so strip leading slash
            const modelPath = (model.uri.path || '').replace(/^\//, '');
            if (!modelPath) return;
            const value = model.getValue();
            // Guard in case model changed to a new path not yet present in state.files
            if (!state.files[modelPath]) state.files[modelPath] = { content: '', language: getLang(modelPath) };
            state.files[modelPath].content = value;
            // mark current project as modified so it will be persisted
            if (!state.projects[state.currentProjectId]) state.projects[state.currentProjectId] = {};
            state.projects[state.currentProjectId].modified = true;
            updateEditorDisplay();
            debouncePreviewUpdate();
            saveProjectsToStorage();
        } catch (e) {
            console.warn('Monaco content sync error', e);
        }
    });

    // Update cursor position status
    monacoEditor.onDidChangeCursorPosition(() => updateEditorDisplay());
}

/* Debounced preview update */
let previewDebounce;
function debouncePreviewUpdate() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(updatePreview, 500);
}

// Search & Replace
function updateSearchResults() {
    const search = document.getElementById('search-input').value.toLowerCase();
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;
    
    if (!search) {
        resultsContainer.innerHTML = '';
        return;
    }

    const matches = Object.entries(state.files).filter(([path, file]) => {
        return (file.content || '').toLowerCase().includes(search) || path.toLowerCase().includes(search);
    });

    resultsContainer.innerHTML = `
        <div class="px-2 py-1 text-[10px] text-gray-500 uppercase font-bold tracking-wider">${matches.length} matches found</div>
        <div class="space-y-1 mt-2">
            ${matches.map(([path, file]) => `
                <div class="search-result-item p-2 hover:bg-[#1a1a1a] rounded cursor-pointer border border-transparent hover:border-[#333]" onclick="openFile('${path}')">
                    <div class="text-xs font-bold text-gray-300 truncate">${path}</div>
                    <div class="text-[10px] text-gray-500 truncate mt-1">
                        ${escapeHtml((file.content || '').toLowerCase().split(search).join(`<strong>${search}</strong>`)).slice(0, 100)}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function handleReplaceAll() {
    const search = document.getElementById('search-input').value;
    const replace = document.getElementById('replace-input').value;
    if (!search) return;

    let count = 0;
    Object.keys(state.files).forEach(path => {
        const content = state.files[path].content;
        if (typeof content === 'string' && content.includes(search)) {
            state.files[path].content = content.replaceAll(search, replace);
            count++;
        }
    });

    if (count > 0) {
        if (state.activeTab) openFile(state.activeTab);
        updatePreview();
        updateSearchResults();
        showSnackbar(`Replaced matches in ${count} files`);
    }
}

document.getElementById('search-input')?.addEventListener('input', updateSearchResults);
window.updateSearchResults = updateSearchResults;

init();
window.playProject = playProject;

// Delegate clicks for dynamically-rendered controls so buttons like "refresh-credits"
// always work even after the credits panel is re-rendered.
document.addEventListener('click', function (e) {
    try {
        const btn = e.target.closest && e.target.closest('#refresh-credits');
        if (!btn) return;
        e.stopPropagation();
        e.preventDefault();
        // Debounce protection: if a refresh is already running, ignore repeated clicks briefly
        if (btn._vibesim_refreshing) return;
        btn._vibesim_refreshing = true;
        try {
            renderCreditsPanel();
        } finally {
            setTimeout(() => { btn._vibesim_refreshing = false; }, 600);
        }
    } catch (err) {
        console.warn('Delegated refresh-credits click handler error', err);
    }
});