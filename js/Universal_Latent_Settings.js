// ----- SECTION: Imports -----
import { app } from "../../scripts/app.js";

// ----- SECTION: Data -----
const NODE_CLASS = "UniversalLatentSettings";

const FLUX_CHOICES = [
    "1056x2112 (0.5)", "1056x2016 (0.52)", "1152x2016 (0.57)", "1152x1920 (0.6)",
    "1248x1824 (0.68)", "1248x1728 (0.72)", "1344x1728 (0.78)", "1344x1632 (0.82)",
    "1440x1632 (0.88)", "1440x1536 (0.94)", "1536x1536 (1.0)", "1536x1440 (1.07)",
    "1632x1440 (1.13)", "1632x1344 (1.21)", "1728x1344 (1.29)", "1728x1248 (1.38)",
    "1824x1248 (1.46)", "1920x1152 (1.67)", "2016x1152 (1.75)", "2016x1056 (1.91)",
    "2112x1056 (2.0)", "2208x1056 (2.09)", "2304x960 (2.4)", "2400x960 (2.5)",
    "2496x864 (2.89)", "2592x864 (3.0)",
];

const SDXL_CHOICES = [
    "704x1408 (0.5)", "704x1344 (0.52)", "768x1344 (0.57)", "768x1280 (0.6)",
    "832x1216 (0.68)", "832x1152 (0.72)", "896x1152 (0.78)", "896x1088 (0.82)",
    "960x1088 (0.88)", "960x1024 (0.94)", "1024x1024 (1.0)", "1024x960 (1.07)",
    "1088x960 (1.13)", "1088x896 (1.21)", "1152x896 (1.29)", "1152x832 (1.38)",
    "1216x832 (1.46)", "1280x768 (1.67)", "1344x768 (1.75)", "1344x704 (1.91)",
    "1408x704 (2.0)", "1472x704 (2.09)", "1536x640 (2.4)", "1600x640 (2.5)",
    "1664x576 (2.89)", "1728x576 (3.0)",
];

const ZIMAGE_CHOICES = {
    "1024": [
        "1024x1024 ( 1:1 )",
        "1152x896 ( 9:7 )",
        "896x1152 ( 7:9 )",
        "1152x864 ( 4:3 )",
        "864x1152 ( 3:4 )",
        "1248x832 ( 3:2 )",
        "832x1248 ( 2:3 )",
        "1280x720 ( 16:9 )",
        "720x1280 ( 9:16 )",
        "1344x576 ( 21:9 )",
        "576x1344 ( 9:21 )",
    ],
    "1280": [
        "1280x1280 ( 1:1 )",
        "1440x1120 ( 9:7 )",
        "1120x1440 ( 7:9 )",
        "1472x1104 ( 4:3 )",
        "1104x1472 ( 3:4 )",
        "1536x1024 ( 3:2 )",
        "1024x1536 ( 2:3 )",
        "1536x864 ( 16:9 )",
        "864x1536 ( 9:16 )",
        "1680x720 ( 21:9 )",
        "720x1680 ( 9:21 )",
    ],
    "1536": [
        "1536x1536 ( 1:1 )",
        "1728x1344 ( 9:7 )",
        "1344x1728 ( 7:9 )",
        "1728x1296 ( 4:3 )",
        "1296x1728 ( 3:4 )",
        "1872x1248 ( 3:2 )",
        "1248x1872 ( 2:3 )",
        "2048x1152 ( 16:9 )",
        "1152x2048 ( 9:16 )",
        "2016x864 ( 21:9 )",
        "864x2016 ( 9:21 )",
    ],
};

const MODEL_ALIASES = {
    "FLUX": "FLUX",
    "SDXL": "SDXL",
    "Z-image (1024)": "Z-image (1024)",
    "Z-image (1280)": "Z-image (1280)",
    "Z-image (1536)": "Z-image (1536)",
};

// ----- SECTION: Helpers -----
function findWidget(node, name) {
    const ws = node?.widgets || [];
    for (const w of ws) {
        if (w?.name === name) return w;
    }
    return null;
}

function isSeparator(v) {
    const s = String(v || "");
    return s.startsWith("----") && s.endsWith("----");
}

function parseWH(label) {
    const m = String(label || "").match(/(\d+)\s*x\s*(\d+)/);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

function firstSelectable(values) {
    for (const v of values || []) {
        if (!isSeparator(v)) return v;
    }
    return (values && values[0]) || "";
}

// ----- SECTION: Helpers -----
function groupPortraitSquareLandscape(rawList) {
    const portrait = [];
    const square = [];
    const landscape = [];

    for (const item of rawList || []) {
        const wh = parseWH(item);
        if (!wh) continue;
        const w = wh[0];
        const h = wh[1];

        if (h > w) portrait.push({ item, w, h });
        else if (w === h) square.push({ item, w, h });
        else landscape.push({ item, w, h });
    }

    portrait.sort((a, b) => {
        const ra = a.h / a.w;
        const rb = b.h / b.w;
        if (rb !== ra) return rb - ra;
        if (b.h !== a.h) return b.h - a.h;
        return b.w - a.w;
    });

    landscape.sort((a, b) => {
        const ra = a.w / a.h;
        const rb = b.w / b.h;
        if (ra !== rb) return ra - rb;
        if (a.w !== b.w) return a.w - b.w;
        return a.h - b.h;
    });

    square.sort((a, b) => {
        if (b.w !== a.w) return b.w - a.w;
        return b.h - a.h;
    });

    const out = [];

    if (portrait.length) out.push("----PORTRAIT----", ...portrait.map(x => x.item));
    if (square.length) out.push("----SQUARE----", ...square.map(x => x.item));
    if (landscape.length) out.push("----LANDSCAPE----", ...landscape.map(x => x.item));

    return out.length ? out : (rawList || []);
}


function normalizeModel(model) {
    const m = String(model || "Z-image (1024)");
    return MODEL_ALIASES[m] || "Z-image (1024)";
}

function buildResolutionList(modelRaw) {
    const model = normalizeModel(modelRaw);

    if (model === "FLUX") return groupPortraitSquareLandscape(FLUX_CHOICES);
    if (model === "SDXL") return groupPortraitSquareLandscape(SDXL_CHOICES);

    const m = model.match(/\((\d+)\)/);
    const base = m ? m[1] : "1024";
    const list = ZIMAGE_CHOICES[base] || ZIMAGE_CHOICES["1024"];
    return groupPortraitSquareLandscape(list);
}

function setComboValues(node, widget, values) {
    if (!widget || !Array.isArray(values) || values.length === 0) return;

    widget.options = widget.options || {};
    widget.options.values = values.slice(0);

    if (!values.includes(widget.value) || isSeparator(widget.value)) {
        widget.value = firstSelectable(values);
    }

    node.setDirtyCanvas(true, true);
}

function syncResolutionChoices(node) {
    const modelW = findWidget(node, "model_resolution");
    const resW = findWidget(node, "resolution");
    if (!modelW || !resW) return;

    const list = buildResolutionList(modelW.value);
    setComboValues(node, resW, list);
}

function fixSeparatorSelection(node) {
    const resW = findWidget(node, "resolution");
    if (!resW) return;

    const values = resW?.options?.values || [];
    if (!isSeparator(resW.value)) return;

    const idx = values.indexOf(resW.value);

    for (let i = idx + 1; i < values.length; i++) {
        if (!isSeparator(values[i])) {
            resW.value = values[i];
            node.setDirtyCanvas(true, true);
            return;
        }
    }

    for (let i = idx - 1; i >= 0; i--) {
        if (!isSeparator(values[i])) {
            resW.value = values[i];
            node.setDirtyCanvas(true, true);
            return;
        }
    }

    resW.value = firstSelectable(values);
    node.setDirtyCanvas(true, true);
}

function applyVioletTheme(node) {
    node.color = "#553355";
    node.bgcolor = "#553355";
    node.boxcolor = "#3f243f";
}

function enforceModelChoices(node) {
    const modelW = findWidget(node, "model_resolution");
    if (!modelW) return;

    const desired = ["FLUX", "SDXL", "Z-image (1024)", "Z-image (1280)", "Z-image (1536)"];

    modelW.options = modelW.options || {};
    modelW.options.values = desired.slice(0);

    if (!desired.includes(modelW.value)) {
        modelW.value = "Z-image (1024)";
    }
}


// ----- SECTION: Register Extension -----
app.registerExtension({
    name: "lightx02.universal_latent_settings.dynamic_resolutions",
    nodeCreated(node) {
        if (node?.comfyClass !== NODE_CLASS && node?.type !== NODE_CLASS) return;

        applyVioletTheme(node);

        enforceModelChoices(node);

        const modelW = findWidget(node, "model_resolution");
        if (modelW) {
            const prev = modelW.callback;
            modelW.callback = function () {
                if (typeof prev === "function") prev.apply(this, arguments);
                enforceModelChoices(node);
                syncResolutionChoices(node);
            };
        }

        const resW = findWidget(node, "resolution");
        if (resW) {
            const prev = resW.callback;
            resW.callback = function () {
                if (typeof prev === "function") prev.apply(this, arguments);
                fixSeparatorSelection(node);
            };
        }

        syncResolutionChoices(node);
    },
});
