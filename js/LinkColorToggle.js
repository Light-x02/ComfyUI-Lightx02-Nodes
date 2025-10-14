// Developed by Light-x02
// https://github.com/Light-x02/ComfyUI-Lightx02-Node

// ----- SECTION: Imports -----
import { app } from "/scripts/app.js";

// ----- SECTION: Register Extension -----
(function () {
    const EXT_NAME = "LinkColors.ContextToggle.IOAwareAttachDetach.Separated";
    const STORAGE_KEY = "linkcolors_enabled";

    // ----- SECTION: State -----
    const State = {
        enabled: (() => { try { return localStorage.getItem(STORAGE_KEY) !== "0"; } catch { return true; } })(),
    };

    // ----- SECTION: Color Helpers -----
    function getOutputType(canvas, link) {
        const g = canvas?.graph; if (!g || !link) return null;
        const on = g.getNodeById(link.origin_id);
        const o = on?.outputs?.[link.origin_slot];
        return o?.type || o?.name || null;
    }
    function getInputType(canvas, link) {
        const g = canvas?.graph; if (!g || !link) return null;
        const tn = g.getNodeById(link.target_id);
        const i = tn?.inputs?.[link.target_slot];
        return i?.type || i?.name || null;
    }
    function isGenericType(t) {
        if (!t) return true;
        const s = String(t).toUpperCase();
        return s === "*" || s === "ANY" || s === "ANYTYPE" || s === "ANY_TYPE" || s === "WILDCARD";
    }
    function getTypeColorFromMap(type) {
        const map = (typeof LGraphCanvas !== "undefined" && LGraphCanvas.link_type_colors) ? LGraphCanvas.link_type_colors : {};
        if (!type) return null;
        if (Object.prototype.hasOwnProperty.call(map, type)) {
            const c = map[type];
            if (c === "") return (typeof LiteGraph !== "undefined" && LiteGraph.LINK_COLOR) ? LiteGraph.LINK_COLOR : "#6f6";
            return c || null;
        }
        return null;
    }
    function getTypeColor(type) {
        return getTypeColorFromMap(type) ?? getTypeColorFromMap("*");
    }
    function parseColor(c) {
        if (!c || typeof c !== "string") return null;
        const s = c.replace(/\s+/g, "");
        if (s[0] === "#") {
            let r, g, b;
            if (s.length === 4) { r = parseInt(s[1] + s[1], 16); g = parseInt(s[2] + s[2], 16); b = parseInt(s[3] + s[3], 16); return [r, g, b]; }
            if (s.length === 7) { r = parseInt(s.slice(1, 3), 16); g = parseInt(s.slice(3, 5), 16); b = parseInt(s.slice(5, 7), 16); return [r, g, b]; }
            return null;
        }
        const m = s.match(/^rgb\((\d+),(\d+),(\d+)\)$/i);
        if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
        return null;
    }
    function toHex([r, g, b]) {
        const h = (n) => n.toString(16).padStart(2, "0");
        return `#${h(Math.max(0, Math.min(255, r)))}${h(Math.max(0, Math.min(255, g)))}${h(Math.max(0, Math.min(255, b)))}`;
    }
    function blendColors(c1, c2) {
        const a = parseColor(c1), b = parseColor(c2);
        if (!a && !b) return null;
        if (!a) return c2;
        if (!b) return c1;
        return toHex([Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2), Math.round((a[2] + b[2]) / 2)]);
    }
    function resolveColor(canvas, link, fallbackColor) {
        const outType = getOutputType(canvas, link) || link?.type || link?.data_type || null;
        const inType = getInputType(canvas, link) || null;

        const outGeneric = isGenericType(outType);
        const inGeneric = isGenericType(inType);

        const outColor = outGeneric ? null : getTypeColor(outType);
        const inColor = inGeneric ? null : getTypeColor(inType);

        if (outColor && inColor) {
            if (outColor === inColor) return outColor;
            const mixed = blendColors(outColor, inColor);
            if (mixed) return mixed;
        }
        if (outColor) return outColor;
        if (inColor) return inColor;

        if (fallbackColor) return fallbackColor;
        return (typeof LiteGraph !== "undefined" && LiteGraph.LINK_COLOR) ? LiteGraph.LINK_COLOR : "#6f6";
    }

    // ----- SECTION: Patch Attach/Detach -----
    let ORIGINAL_RENDER = null;
    function ensureOriginal() {
        if (!ORIGINAL_RENDER) ORIGINAL_RENDER = LiteGraph.LGraphCanvas.prototype.renderLink;
    }
    function attachPatch() {
        ensureOriginal();
        if (LiteGraph.LGraphCanvas.prototype.renderLink.__ioaware_patched__) return;
        const PATCHED = function (ctx, a, b, link, skip_border, flow, color, start_dir, end_dir) {
            const forced = resolveColor(this, link, color);
            return ORIGINAL_RENDER.call(this, ctx, a, b, link, skip_border, flow, forced, start_dir, end_dir);
        };
        PATCHED.__ioaware_patched__ = true;
        LiteGraph.LGraphCanvas.prototype.renderLink = PATCHED;
    }
    function detachPatch() {
        if (!ORIGINAL_RENDER) return;
        LiteGraph.LGraphCanvas.prototype.renderLink = ORIGINAL_RENDER;
    }

    // ----- SECTION: Toggle API -----
    function setEnabled(v) {
        State.enabled = !!v;
        try { localStorage.setItem(STORAGE_KEY, State.enabled ? "1" : "0"); } catch { }
        if (State.enabled) attachPatch(); else detachPatch();
        if (app?.canvas) { app.canvas.setDirty(true, true); app.canvas.draw(true, true); }
    }
    function toggle() { setEnabled(!State.enabled); }

    // ----- SECTION: Context Menu -----
    let ORIGINAL_MENU = null;
    function installCanvasMenu() {
        if (ORIGINAL_MENU) return;
        ORIGINAL_MENU = LiteGraph.LGraphCanvas.prototype.getCanvasMenuOptions;
        LiteGraph.LGraphCanvas.prototype.getCanvasMenuOptions = function () {
            const options = ORIGINAL_MENU ? ORIGINAL_MENU.apply(this, arguments) : [];
            options.push(null);
            options.push({ content: "Lightx02", disabled: true });
            options.push({ content: `${State.enabled ? "✓" : "☐"} 🎨 Link Colors (I/O)`, callback: () => toggle() });
            options.push(null);
            return options;
        };
    }

    // ----- SECTION: Setup -----
    app.registerExtension({
        name: EXT_NAME,
        setup() {
            installCanvasMenu();
            if (State.enabled) attachPatch(); else detachPatch();
        },
    });
})();

