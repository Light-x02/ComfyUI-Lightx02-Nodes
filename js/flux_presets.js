// Minimal UI for saving/loading/deleting presets from node context menu
import { app } from "../../scripts/app.js";

const NODE_CLASS = "FluxSettingsPipe"; // must match Python class name

async function apiGet(url) {
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) return null;
    return await r.json();
}
async function apiPost(url, body) {
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
    });
    if (!r.ok) return null;
    return await r.json();
}

async function fetchPresets() {
    return await apiGet("/extensions/flux-suite/presets");
}
async function savePreset(name, payload) {
    return await apiPost("/extensions/flux-suite/presets/save", { name, payload });
}
async function deletePreset(name) {
    return await apiPost("/extensions/flux-suite/presets/delete", { name });
}

function getNodeValues(node) {
    const get = (k) => node.widgets?.find(w => w.name === k)?.value;
    return {
        resolution: get("resolution"),
        flip_orientation: get("flip_orientation"),
        batch_size: get("batch_size"),
        width_override: get("width_override"),
        height_override: get("height_override"),
        sampler_name: get("sampler_name"),
        scheduler: get("scheduler"),
        steps: get("steps"),
        denoise: get("denoise"),
        guidance: get("guidance"),
        noise_seed: get("noise_seed"),
        // model and conditioning are links, we do not serialize them
    };
}
function setNodeValues(node, payload) {
    const set = (k, v) => {
        const w = node.widgets?.find(w => w.name === k);
        if (!w || v === undefined) return;
        w.value = v;
        if (typeof w.callback === "function") w.callback(v);
    };
    Object.entries(payload || {}).forEach(([k, v]) => set(k, v));
    node.setDirtyCanvas(true, true);
}

app.registerExtension({
    name: "flux_settings.presets",
    async beforeRegisterNodeDef(nodeType, nodeData, appRef) {
        if (nodeData?.name !== NODE_CLASS) return;

        const orig = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            if (orig) orig.apply(this, arguments);

            options.push(null);

            options.push({
                content: "Save preset...",
                callback: async () => {
                    const name = prompt("Preset name:");
                    if (!name) return;
                    const payload = getNodeValues(this);
                    const res = await savePreset(name, payload);
                    if (!res?.ok) alert("Failed to save preset"); else appRef.ui?.toast?.("Preset saved");
                }
            });

            options.push({
                content: "Load preset...",
                has_submenu: true,
                callback: async (value, opts, e, menu) => {
                    const data = await fetchPresets();
                    const names = (data?.presets || []).map(p => p.name);
                    if (!names.length) { appRef.ui?.toast?.("No presets"); return; }
                    new LiteGraph.ContextMenu(names, {
                        event: e,
                        parentMenu: menu,
                        callback: (name) => {
                            const p = data.presets.find(x => x.name === name);
                            if (p?.payload) setNodeValues(this, p.payload);
                        }
                    });
                }
            });

            options.push({
                content: "Delete preset...",
                has_submenu: true,
                callback: async (value, opts, e, menu) => {
                    const data = await fetchPresets();
                    const names = (data?.presets || []).map(p => p.name);
                    if (!names.length) { appRef.ui?.toast?.("No presets"); return; }
                    new LiteGraph.ContextMenu(names, {
                        event: e,
                        parentMenu: menu,
                        callback: async (name) => {
                            const res = await deletePreset(name);
                            if (!res?.ok) alert("Failed to delete preset"); else appRef.ui?.toast?.("Preset deleted");
                        }
                    });
                }
            });
        };
    },
});
