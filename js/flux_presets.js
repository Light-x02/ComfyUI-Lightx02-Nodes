// Presets + static colored section headers + footer with current preset for FluxSettingsPipe
import { app } from "../../scripts/app.js";

const NODE_CLASS = "FluxSettingsPipe";

/* ------------ Presets API ------------ */
async function apiGet(url) { const r = await fetch(url, { method: "GET" }); if (!r.ok) return null; return await r.json(); }
async function apiPost(url, body) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); if (!r.ok) return null; return await r.json(); }
async function fetchPresets() { return await apiGet("/extensions/flux-suite/presets"); }
async function savePreset(name, payload) { return await apiPost("/extensions/flux-suite/presets/save", { name, payload }); }
async function deletePreset(name) { return await apiPost("/extensions/flux-suite/presets/delete", { name }); }

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

/* ------------ Static headers (no mouse handler) ------------ */
function insertHeader(node, beforeWidgetName, label, bgColor, markerName) {
    const marker = markerName || `__hdr_${beforeWidgetName}`;
    if (node.widgets?.some(w => w.name === marker)) return;

    const w = node.addWidget("info", label, "", null, { serialize: false });
    w.name = marker;

    w._bg = bgColor;
    w._fg = textColorFor(bgColor);

    w.computeSize = () => [200, 26];
    w.draw = (ctx, node2, widgetWidth, y) => {
        ctx.save();
        ctx.fillStyle = w._bg;
        ctx.fillRect(0, y + 2, widgetWidth, 22);
        ctx.fillStyle = w._fg;
        ctx.font = "600 12px sans-serif";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(label).width;
        const cx = (widgetWidth - tw) / 2;
        ctx.fillText(label, Math.max(8, cx), y + 13);
        ctx.restore();
    };

    const idx = node.widgets.findIndex(x => x.name === beforeWidgetName);
    if (idx >= 0) {
        const last = node.widgets.pop();
        node.widgets.splice(idx, 0, last);
    }
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

function loadCurrentPresetName(node) {
    try {
        const map = JSON.parse(localStorage.getItem(LS_CURRENT)) || {};
        return map[node.id] || null;
    } catch { return null; }
}
function saveCurrentPresetName(node, name) {
    const map = (() => { try { return JSON.parse(localStorage.getItem(LS_CURRENT)) || {}; } catch { return {}; } })();
    if (name) map[node.id] = name; else delete map[node.id];
    localStorage.setItem(LS_CURRENT, JSON.stringify(map));
}

function ensureFooter(node) {
    const marker = "__hdr_PRESET_FOOTER";
    if (node.widgets?.some(w => w.name === marker)) return;

    const DEFAULT_BG = "#4A5568"; // slate gray
    const w = node.addWidget("info", "Preset: No preset loaded", "", null, { serialize: false });
    w.name = marker;
    w._bg = DEFAULT_BG;
    w._fg = textColorFor(DEFAULT_BG);
    // keep current name in widget state (for draw)
    w._presetName = loadCurrentPresetName(node);

    w.computeSize = () => [200, 26];
    w.draw = (ctx, node2, widgetWidth, y) => {
        const label = w._presetName ? `Preset: ${w._presetName}` : "Preset: No preset loaded";
        ctx.save();
        ctx.fillStyle = w._bg;
        ctx.fillRect(0, y + 2, widgetWidth, 22);
        ctx.fillStyle = w._fg;
        ctx.font = "600 12px sans-serif";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(label).width;
        const cx = (widgetWidth - tw) / 2;
        ctx.fillText(label, Math.max(8, cx), y + 13);
        ctx.restore();
    };

    // put footer at the very end
    const last = node.widgets.pop();
    node.widgets.push(last); // append footer at end
}

function setFooterPresetName(node, name) {
    const w = node.widgets?.find(x => x.name === "__hdr_PRESET_FOOTER");
    if (!w) return;
    w._presetName = name || null;
    saveCurrentPresetName(node, w._presetName);
    node.setDirtyCanvas(true, true);
}

/* ------------ Register extension ------------ */
app.registerExtension({
    name: "flux_settings.presets_headers_footer",
    async beforeRegisterNodeDef(nodeType, nodeData, appRef) {
        if (nodeData?.name !== NODE_CLASS) return;

        // context menu presets
        const orig = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            if (orig) orig.apply(this, arguments);
            options.push(null);
            options.push({
                content: "Save preset...", callback: async () => {
                    const name = prompt("Preset name:"); if (!name) return;
                    const payload = getNodeValues(this);
                    const res = await savePreset(name, payload);
                    if (!res?.ok) { alert("Failed to save preset"); return; }
                    appRef.ui?.toast?.("Preset saved");
                    setFooterPresetName(this, name);
                }
            });
            options.push({
                content: "Load preset...", has_submenu: true, callback: async (v, opts, e, menu) => {
                    const data = await fetchPresets(); const names = (data?.presets || []).map(p => p.name);
                    if (!names.length) { appRef.ui?.toast?.("No presets"); return; }
                    new LiteGraph.ContextMenu(names, {
                        event: e, parentMenu: menu, callback: (nm) => {
                            const p = data.presets.find(x => x.name === nm);
                            if (p?.payload) {
                                setNodeValues(this, p.payload);
                                setFooterPresetName(this, nm);
                            }
                        }
                    });
                }
            });
            options.push({
                content: "Delete preset...", has_submenu: true, callback: async (v, opts, e, menu) => {
                    const data = await fetchPresets(); const names = (data?.presets || []).map(p => p.name);
                    if (!names.length) { appRef.ui?.toast?.("No presets"); return; }
                    new LiteGraph.ContextMenu(names, {
                        event: e, parentMenu: menu, callback: async (nm) => {
                            const res = await deletePreset(nm);
                            if (!res?.ok) { alert("Failed to delete preset"); return; }
                            appRef.ui?.toast?.("Preset deleted");
                            // clear footer if current was deleted
                            const cur = loadCurrentPresetName(this);
                            if (cur === nm) setFooterPresetName(this, null);
                        }
                    });
                }
            });
        };

        // add headers + footer on creation
        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origCreated) origCreated.apply(this, arguments);
            addSectionHeaders(this);
            ensureFooter(this);
            // show persisted current preset if any
            const cur = loadCurrentPresetName(this);
            setFooterPresetName(this, cur);
        };
    },

    // ensure UI when graph reopened or pasted
    nodeCreated(node) {
        if (node?.comfyClass === NODE_CLASS || node?.type === NODE_CLASS || node?.title === "Flux Settings Pipe") {
            addSectionHeaders(node);
            ensureFooter(node);
            const cur = loadCurrentPresetName(node);
            setFooterPresetName(node, cur);
        }
    },
});
