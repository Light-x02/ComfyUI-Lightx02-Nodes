// Presets + colored section headers + footer + Manage dialog for FluxSettingsPipe
import { app } from "../../scripts/app.js";

const NODE_CLASS = "FluxSettingsPipe";

/* ------------ Presets API ------------ */
async function apiGet(url) { const r = await fetch(url, { method: "GET" }); if (!r.ok) return null; return await r.json(); }
async function apiPost(url, body) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); if (!r.ok) return null; return await r.json(); }
async function fetchPresets() { return await apiGet("/extensions/flux-suite/presets"); }
async function savePreset(name, payload) { return await apiPost("/extensions/flux-suite/presets/save", { name, payload }); }
async function deletePreset(name) { return await apiPost("/extensions/flux-suite/presets/delete", { name }); }

/* ------------ Cache côté client ------------ */
let presetCache = []; // [{name,payload}]
async function refreshPresetsCache() {
    try {
        const data = await fetchPresets();
        presetCache = (data?.presets || []).map(p => ({ name: p.name, payload: p.payload }));
    } catch { presetCache = []; }
}
refreshPresetsCache();

/* ------------ Helpers values ------------ */
function getNodeValues(node) {
    const get = k => node.widgets?.find(w => w.name === k)?.value;
    return {
        resolution: get("resolution"), flip_orientation: get("flip_orientation"),
        batch_size: get("batch_size"), width_override: get("width_override"), height_override: get("height_override"),
        sampler_name: get("sampler_name"), scheduler: get("scheduler"), steps: get("steps"), denoise: get("denoise"),
        guidance: get("guidance"), noise_seed: get("noise_seed"),
    };
}
function setNodeValues(node, payload) {
    const set = (k, v) => { const w = node.widgets?.find(w => w.name === k); if (!w || v === undefined) return; w.value = v; if (typeof w.callback === "function") w.callback(v); };
    Object.entries(payload || {}).forEach(([k, v]) => set(k, v));
    node.setDirtyCanvas(true, true);
}

/* ------------ Contrast (auto text color) ------------ */
function textColorFor(bg) {
    const m = /^#?([0-9a-f]{6})$/i.exec(bg || "");
    if (!m) return "#ffffff";
    const hex = m[1];
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const srgb = [r, g, b].map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    return L > 0.5 ? "#000000" : "#ffffff";
}

/* ------------ Static headers ------------ */
function insertHeader(node, beforeWidgetName, label, bgColor, markerName) {
    const marker = markerName || `__hdr_${beforeWidgetName}`;
    if (node.widgets?.some(w => w.name === marker)) return;

    const w = node.addWidget("info", label, "", null, { serialize: false });
    w.name = marker;
    w._bg = bgColor; w._fg = textColorFor(bgColor);
    w.computeSize = () => [200, 26];
    w.draw = (ctx, node2, widgetWidth, y) => {
        ctx.save();
        ctx.fillStyle = w._bg; ctx.fillRect(0, y + 2, widgetWidth, 22);
        ctx.fillStyle = w._fg; ctx.font = "600 12px sans-serif"; ctx.textBaseline = "middle";
        const tw = ctx.measureText(label).width; const cx = (widgetWidth - tw) / 2;
        ctx.fillText(label, Math.max(8, cx), y + 13); ctx.restore();
    };

    const idx = node.widgets.findIndex(x => x.name === beforeWidgetName);
    if (idx >= 0) { const last = node.widgets.pop(); node.widgets.splice(idx, 0, last); }
}

function addSectionHeaders(node) {
    if (node.__fluxHeadersAdded) return;
    insertHeader(node, "resolution", "LATENT", "#5A67D8", "__hdr_LATENT");
    insertHeader(node, "sampler_name", "Settings", "#2B6CB0", "__hdr_SETTINGS");
    insertHeader(node, "guidance", "Flux Guidance", "#2F855A", "__hdr_GUIDE");
    insertHeader(node, "noise_seed", "Random Noise", "#B7791F", "__hdr_NOISE");
    node.__fluxHeadersAdded = true;
    node.setDirtyCanvas(true, true);
}

/* ------------ Footer: current preset (persisted) ------------ */
const LS_CURRENT = "flux_settings_pipe.current_preset"; // { "<node_id>": "<name>" }
function loadCurrentPresetName(node) { try { const map = JSON.parse(localStorage.getItem(LS_CURRENT)) || {}; return map[node.id] || null; } catch { return null; } }
function saveCurrentPresetName(node, name) { const map = (() => { try { return JSON.parse(localStorage.getItem(LS_CURRENT)) || {}; } catch { return {}; } })(); if (name) map[node.id] = name; else delete map[node.id]; localStorage.setItem(LS_CURRENT, JSON.stringify(map)); }
function ensureFooter(node) {
    const marker = "__hdr_PRESET_FOOTER";
    if (node.widgets?.some(w => w.name === marker)) return;
    const DEFAULT_BG = "#4A5568";
    const w = node.addWidget("info", "Preset: No preset loaded", "", null, { serialize: false });
    w.name = marker; w._bg = DEFAULT_BG; w._fg = textColorFor(DEFAULT_BG); w._presetName = loadCurrentPresetName(node);
    w.computeSize = () => [200, 26];
    w.draw = (ctx, node2, widgetWidth, y) => {
        const label = w._presetName ? `Preset: ${w._presetName}` : "Preset: No preset loaded";
        ctx.save(); ctx.fillStyle = w._bg; ctx.fillRect(0, y + 2, widgetWidth, 22);
        ctx.fillStyle = w._fg; ctx.font = "600 12px sans-serif"; ctx.textBaseline = "middle";
        const tw = ctx.measureText(label).width; const cx = (widgetWidth - tw) / 2;
        ctx.fillText(label, Math.max(8, cx), y + 13); ctx.restore();
    };
    const last = node.widgets.pop(); node.widgets.push(last);
}
function setFooterPresetName(node, name) { const w = node.widgets?.find(x => x.name === "__hdr_PRESET_FOOTER"); if (!w) return; w._presetName = name || null; saveCurrentPresetName(node, w._presetName); node.setDirtyCanvas(true, true); }

/* ------------ Manage dialog ------------ */
function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function createManageDialog(node) {
    const wrap = document.createElement("div");
    wrap.style.position = "fixed"; wrap.style.inset = "0";
    wrap.style.background = "rgba(0,0,0,0.5)"; wrap.style.zIndex = 99999;
    wrap.style.display = "flex"; wrap.style.alignItems = "center"; wrap.style.justifyContent = "center";

    const box = document.createElement("div");
    box.style.background = "#1e1e1e"; box.style.color = "#ddd";
    box.style.border = "1px solid #444"; box.style.borderRadius = "8px";
    box.style.width = "420px"; box.style.maxWidth = "90vw";
    box.style.padding = "14px"; box.style.boxShadow = "0 10px 30px rgba(0,0,0,0.6)";
    wrap.appendChild(box);

    const title = document.createElement("div");
    title.textContent = "Manage Presets";
    title.style.fontWeight = "700"; title.style.marginBottom = "10px";
    box.appendChild(title);

    const row = document.createElement("div");
    row.style.display = "flex"; row.style.gap = "8px"; row.style.marginBottom = "8px";
    box.appendChild(row);

    const select = document.createElement("select");
    select.style.flex = "1"; select.style.background = "#2b2b2b";
    select.style.color = "#ddd"; select.style.border = "1px solid #555"; select.style.padding = "6px";
    row.appendChild(select);

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "↻"; refreshBtn.title = "Refresh";
    refreshBtn.style.padding = "6px 10px"; row.appendChild(refreshBtn);

    function fillOptions() {
        select.innerHTML = "";
        if (!presetCache.length) {
            const opt = document.createElement("option");
            opt.text = "No presets"; opt.value = ""; select.appendChild(opt);
            select.disabled = true;
        } else {
            select.disabled = false;
            presetCache.forEach(p => {
                const opt = document.createElement("option");
                opt.text = p.name; opt.value = p.name; select.appendChild(opt);
            });
            const cur = loadCurrentPresetName(node);
            const idx = presetCache.findIndex(p => p.name === cur);
            select.selectedIndex = idx >= 0 ? idx : 0;
        }
    }
    fillOptions();

    const grid = document.createElement("div");
    grid.style.display = "grid"; grid.style.gridTemplateColumns = "1fr 1fr";
    grid.style.gap = "8px"; box.appendChild(grid);

    function button(label, handler, titleTxt) {
        const b = document.createElement("button");
        b.textContent = label; if (titleTxt) b.title = titleTxt;
        b.style.padding = "8px 10px"; b.style.background = "#3a3f44";
        b.style.color = "#fff"; b.style.border = "1px solid #555"; b.style.borderRadius = "6px";
        b.addEventListener("click", handler); grid.appendChild(b); return b;
    }

    // NEW: Apply to node
    button("Apply to node", () => {
        const nm = select.value; if (!nm) return;
        const p = presetCache.find(x => x.name === nm);
        if (p?.payload) {
            setNodeValues(node, p.payload);
            setFooterPresetName(node, nm);
        }
    });

    button("Load", async () => {
        const nm = select.value; if (!nm) return;
        const p = presetCache.find(x => x.name === nm);
        if (p?.payload) {
            setNodeValues(node, p.payload);
            setFooterPresetName(node, nm);
        }
    });

    button("Save (overwrite)", async () => {
        const nm = select.value; if (!nm) return;
        const payload = getNodeValues(node);
        const res = await savePreset(nm, payload);
        if (res?.ok) {
            const i = presetCache.findIndex(p => p.name === nm);
            if (i >= 0) presetCache[i].payload = payload;
            setFooterPresetName(node, nm);
            app.ui?.toast?.("Preset saved");
        } else alert("Failed to save preset");
    });

    button("Save As…", async () => {
        const nm = prompt("New preset name:"); if (!nm) return;
        const payload = getNodeValues(node);
        const res = await savePreset(nm, payload);
        if (res?.ok) {
            presetCache.push({ name: nm, payload });
            fillOptions();
            setFooterPresetName(node, nm);
            app.ui?.toast?.("Preset saved");
        } else alert("Failed to save preset");
    });

    button("Rename…", async () => {
        const old = select.value; if (!old) return;
        const neu = prompt("Rename preset:", old); if (!neu || neu === old) return;
        const found = presetCache.find(p => p.name === old);
        if (!found) return;
        const res1 = await savePreset(neu, found.payload);
        if (!res1?.ok) { alert("Failed to rename (save-as)"); return; }
        const res2 = await deletePreset(old);
        if (!res2?.ok) { alert("Failed to rename (delete old)"); return; }
        presetCache = presetCache.filter(x => x.name !== old);
        presetCache.push({ name: neu, payload: found.payload });
        fillOptions();
        setFooterPresetName(node, neu);
        app.ui?.toast?.("Preset renamed");
    });

    button("Delete", async () => {
        const nm = select.value; if (!nm) return;
        if (!confirm(`Delete preset "${nm}" ?`)) return;
        const res = await deletePreset(nm);
        if (res?.ok) {
            const cur = loadCurrentPresetName(node);
            if (cur === nm) setFooterPresetName(node, null);
            presetCache = presetCache.filter(x => x.name !== nm);
            fillOptions();
            app.ui?.toast?.("Preset deleted");
        } else alert("Failed to delete preset");
    });

    button("Export", () => {
        const nm = select.value; if (!nm) return;
        const p = presetCache.find(x => x.name === nm);
        if (!p) return;
        downloadJSON(p, `flux_preset_${nm}.json`);
    });

    const importBtn = button("Import", () => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".json,application/json";
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            try {
                const txt = await file.text();
                const obj = JSON.parse(txt);
                const nm = obj?.name || prompt("Preset name for import:");
                const payload = obj?.payload || obj;
                if (!nm || !payload) { alert("Invalid file"); return; }
                const res = await savePreset(nm, payload);
                if (res?.ok) {
                    const i = presetCache.findIndex(p => p.name === nm);
                    if (i >= 0) presetCache[i].payload = payload; else presetCache.push({ name: nm, payload });
                    fillOptions();
                    setFooterPresetName(node, nm);
                    app.ui?.toast?.("Preset imported");
                } else alert("Failed to import preset");
            } catch (e) { alert("Invalid JSON"); }
        };
        inp.click();
    });

    const closeBar = document.createElement("div");
    closeBar.style.display = "flex"; closeBar.style.justifyContent = "flex-end"; closeBar.style.marginTop = "10px";
    box.appendChild(closeBar);

    const close = document.createElement("button");
    close.textContent = "Close";
    close.style.padding = "6px 12px"; close.style.background = "#444"; close.style.color = "#fff";
    close.style.border = "1px solid #555"; close.style.borderRadius = "6px";
    close.onclick = () => document.body.removeChild(wrap);
    closeBar.appendChild(close);

    refreshPresetsCache().then(fillOptions);
    document.body.appendChild(wrap);
}

/* ------------ Manage button widget (fixed label) ------------ */
function ensureManageButton(node) {
    // Cherche un bouton nommé "manage_presets" pour éviter les doublons
    const exists = node.widgets?.some(w => w.type === "button" && w.name === "manage_presets");
    if (exists) return;

    const btn = node.addWidget("button", "Manage presets…", null, () => {
        createManageDialog(node);
    }, { serialize: false });

    // IMPORTANT: garder name = identifiant logique, le libellé est le 2e paramètre ("Manage presets…")
    btn.name = "manage_presets";

    // Toujours en tout dernier
    const last = node.widgets.pop();
    node.widgets.push(last);
}

/* ------------ Register extension ------------ */
app.registerExtension({
    name: "flux_settings.presets_headers_footer_manage",
    async beforeRegisterNodeDef(nodeType, nodeData, appRef) {
        if (nodeData?.name !== NODE_CLASS) return;

        // context menu with native submenus
        const orig = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            if (orig) orig.apply(this, arguments);
            const names = presetCache.map(p => p.name);

            const saveItem = {
                content: "Save preset...",
                callback: async () => {
                    const name = prompt("Preset name:"); if (!name) return;
                    const payload = getNodeValues(this);
                    const res = await savePreset(name, payload);
                    if (!res?.ok) { alert("Failed to save preset"); return; }
                    appRef.ui?.toast?.("Preset saved");
                    const i = presetCache.findIndex(p => p.name === name);
                    if (i >= 0) presetCache[i].payload = payload; else presetCache.push({ name, payload });
                    setFooterPresetName(this, name);
                }
            };

            const loadSub = names.length
                ? names.map(nm => ({
                    content: nm, callback: () => {
                        const p = presetCache.find(x => x.name === nm);
                        if (p?.payload) { setNodeValues(this, p.payload); setFooterPresetName(this, nm); }
                    }
                }))
                : [{ content: "No presets", disabled: true }];

            const delSub = names.length
                ? names.map(nm => ({
                    content: nm, callback: async () => {
                        const res = await deletePreset(nm);
                        if (!res?.ok) { alert("Failed to delete preset"); return; }
                        appRef.ui?.toast?.("Preset deleted");
                        presetCache = presetCache.filter(x => x.name !== nm);
                        const cur = loadCurrentPresetName(this);
                        if (cur === nm) setFooterPresetName(this, null);
                    }
                }))
                : [{ content: "No presets", disabled: true }];

            options.push(null,
                {
                    content: "Presets", submenu: {
                        options: [
                            saveItem,
                            { content: "Load preset...", submenu: { options: loadSub } },
                            { content: "Delete preset...", submenu: { options: delSub } },
                            { content: "Manage…", callback: () => createManageDialog(this) },
                        ]
                    }
                }
            );
            return options;
        };

        // create headers/footer/manage on node creation
        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origCreated) origCreated.apply(this, arguments);
            addSectionHeaders(this);
            ensureFooter(this);
            ensureManageButton(this);
            const cur = loadCurrentPresetName(this);
            setFooterPresetName(this, cur);
            refreshPresetsCache();
        };
    },

    // ensure UI on reopen / paste
    nodeCreated(node) {
        if (node?.comfyClass === NODE_CLASS || node?.type === NODE_CLASS || node?.title === "Flux Settings Pipe") {
            addSectionHeaders(node);
            ensureFooter(node);
            ensureManageButton(node);
            const cur = loadCurrentPresetName(node);
            setFooterPresetName(node, cur);
            refreshPresetsCache();
        }
    },
});
