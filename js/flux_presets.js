import { app } from "../../scripts/app.js";

(function () {
    const NODE_CLASS = "FluxSettingsPipe"; // nom public du nœud côté ComfyUI (doit matcher la classe Python)

    const PresetsAPI = (() => {
        let presetCache = []; // [{ name: string, payload: object }]

        async function apiGet(url) {
            const r = await fetch(url, { method: "GET" });
            if (!r.ok) return null; // on renvoie null plutôt qu'une exception, l'appelant gère le fallback
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

        async function fetchPresets() { return await apiGet("/extensions/flux-suite/presets"); }
        async function savePreset(name, payload) { return await apiPost("/extensions/flux-suite/presets/save", { name, payload }); }
        async function deletePreset(name) { return await apiPost("/extensions/flux-suite/presets/delete", { name }); }

        async function refresh() {
            try {
                const data = await fetchPresets();
                // normalise la forme pour éviter de traîner des champs inattendus
                presetCache = (data?.presets || []).map(p => ({ name: p.name, payload: p.payload }));
            } catch {
                presetCache = []; // si l'API n'est pas dispo, on sécurise en vidant proprement
            }
            return presetCache;
        }
        // Renvoie un clone superficiel du cache (immutabilité de l'appelant)
        function list() { return presetCache.slice(); }

        // Prime le cache une première fois (best-effort, non bloquant)
        refresh();

        return { fetchPresets, savePreset, deletePreset, refresh, list };
    })();

    const Utils = (() => {
        function getNodeValues(node) {
            const out = {};
            const widgets = node.widgets || [];
            for (const w of widgets) {
                if (!w) continue;
                if (w.__fluxHeaderMarker) continue;                     // nos headers
                if (w.name === "__hdr_PRESET_FOOTER") continue;         // footer
                if (w.type === "button" && (w.name === "manage_presets")) continue; // bouton UI
                if (typeof w.name !== "string" || !w.name) continue;
                out[w.name] = w.value; // valeur brute sérialisable
            }
            return out;
        }

        function setNodeValues(node, payload) {
            const values = payload?.values ?? payload ?? {};
            const set = (k, v) => {
                const w = node.widgets?.find(w => w.name === k);
                if (!w || v === undefined) return; // ignore clés inconnues
                w.value = v;
                if (typeof w.callback === "function") w.callback(v);
            };
            Object.entries(values).forEach(([k, v]) => set(k, v));
            node.setDirtyCanvas(true, true);
        }

        function textColorFor(bg) {
            const m = /^#?([0-9a-f]{6})$/i.exec(bg || "");
            if (!m) return "#ffffff"; // fallback safe
            const hex = m[1];
            const r = parseInt(hex.slice(0, 2), 16) / 255,
                g = parseInt(hex.slice(2, 4), 16) / 255,
                b = parseInt(hex.slice(4, 6), 16) / 255;
            const srgb = [r, g, b].map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
            const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
            return L > 0.5 ? "#000000" : "#ffffff";
        }

        const LS_SECTION_COLORS = "flux_settings_pipe.section_colors";
        function _colorsLoad() { try { return JSON.parse(localStorage.getItem(LS_SECTION_COLORS)) || {}; } catch { return {}; } }
        function colorsGet(key, fallback) { const map = _colorsLoad(); return map[key] || fallback; }
        function colorsSet(key, color) { const map = _colorsLoad(); map[key] = color; localStorage.setItem(LS_SECTION_COLORS, JSON.stringify(map)); }

        function openColorPicker(startColor, onPick, cx, cy) {
            const inp = document.createElement("input");
            inp.type = "color";
            const norm = /^#?([0-9a-f]{6})$/i.test(startColor || "")
                ? (String(startColor).startsWith('#') ? startColor : "#" + startColor)
                : "#4a5568"; // valeur par défaut (gris)
            inp.value = norm;
            inp.style.position = "fixed";
            inp.style.left = (cx ?? (window.innerWidth / 2)) + "px";
            inp.style.top = (cy ?? (window.innerHeight / 2)) + "px";
            inp.style.opacity = "0"; inp.style.width = "1px"; inp.style.height = "1px"; inp.style.zIndex = 99999;
            document.body.appendChild(inp);
            const cleanup = () => { try { document.body.removeChild(inp); } catch { } };
            inp.addEventListener("input", () => onPick?.(inp.value)); // preview en direct si supporté
            inp.addEventListener("change", () => { onPick?.(inp.value); cleanup(); });
            inp.addEventListener("blur", cleanup);
            inp.click(); // déclenche la palette
        }

        const LS_CURRENT = "flux_settings_pipe.current_preset";
        function loadCurrentPresetName(node) { try { const map = JSON.parse(localStorage.getItem(LS_CURRENT)) || {}; return map[node.id] || null; } catch { return null; } }
        function saveCurrentPresetName(node, name) {
            const map = (() => { try { return JSON.parse(localStorage.getItem(LS_CURRENT)) || {}; } catch { return {}; } })();
            if (name) map[node.id] = name; else delete map[node.id];
            localStorage.setItem(LS_CURRENT, JSON.stringify(map));
        }

        return { getNodeValues, setNodeValues, textColorFor, colorsGet, colorsSet, openColorPicker, loadCurrentPresetName, saveCurrentPresetName };
    })();

    const SectionHeaders = (() => {
        function insertHeader(node, beforeWidgetName, label, bgColor, markerName) {
            const marker = markerName || `__hdr_${beforeWidgetName}`;
            let w = node.widgets?.find(x => x.__fluxHeaderMarker === marker);
            const stored = Utils.colorsGet(marker, (w && w._bg) || bgColor);

            if (!w) {
                w = node.addWidget("button", label, null, () => {
                    // Ouverture de la palette (positionnée au clic si possible)
                    Utils.openColorPicker(w._bg, (val) => {
                        if (!val) return;                      // si annulation
                        w._bg = val;                          // MAJ fond
                        w._fg = Utils.textColorFor(val);      // MAJ contraste texte
                        Utils.colorsSet(marker, val);         // persistance locale
                        node.setDirtyCanvas(true, true);      // repaint
                    });
                }, { serialize: false });
                // 2) Balise interne de reconnaissance (ne pas toucher w.name, c'est le label visible du bouton)
                w.__fluxHeaderMarker = marker;
                // 3) Insertion avant le widget de référence s'il est trouvé
                const idx = node.widgets.findIndex(x => x.name === beforeWidgetName);
                if (idx >= 0) {
                    const last = node.widgets.pop();        // ComfyUI n'a pas d'API d'insertion directe, on fait un swap simple
                    node.widgets.splice(idx, 0, last);
                }
            }

            w._bg = stored; w._fg = Utils.textColorFor(stored);
            w.computeSize = () => [200, 26];            // hauteur fixe pour rester léger et lisible
            w.draw = (ctx, node2, widgetWidth, y) => {
                ctx.save();
                ctx.fillStyle = w._bg;                    // fond plein
                ctx.fillRect(0, y + 2, widgetWidth, 22);
                ctx.fillStyle = w._fg;                    // texte en contraste
                ctx.font = "600 12px sans-serif";        // gras 12px (cohérent UI ComfyUI)
                ctx.textBaseline = "middle";
                const tw = ctx.measureText(label).width, cx = (widgetWidth - tw) / 2;
                ctx.fillText(label, Math.max(8, cx), y + 13);
                ctx.restore();
            };
        }

        function addSectionHeaders(node) {
            if (node.__fluxHeadersAdded) return;         // protège de l'injection multiple

            // 1) En-tête LATENT inséré avant la résolution FLUX
            insertHeader(node, "resolution_flux", "LATENT", "#5A67D8", "__hdr_LATENT");

            // 2) Renommer le widget "use_flux" -> "mode_resolution" et le placer juste sous le header LATENT
            const modeWidget = node.widgets?.find(w => w.name === "use_flux" || w.name === "mode_resolution");
            if (modeWidget) modeWidget.name = "mode_resolution";
            const headerIdx = node.widgets.findIndex(w => w.__fluxHeaderMarker === "__hdr_LATENT");
            const wMode = node.widgets.find(w => w.name === "mode_resolution");
            if (headerIdx >= 0 && wMode) {
                node.widgets = node.widgets.filter(w => w !== wMode);
                node.widgets.splice(headerIdx + 1, 0, wMode);
            }

            // 3) Autres sections
            insertHeader(node, "sampler_name", "Settings", "#2B6CB0", "__hdr_SETTINGS");
            insertHeader(node, "guidance", "Flux Guidance", "#2F855A", "__hdr_GUIDE");
            insertHeader(node, "noise_seed", "Random Noise", "#B7791F", "__hdr_NOISE");

            node.__fluxHeadersAdded = true;
            node.setDirtyCanvas(true, true);
        }

        return { insertHeader, addSectionHeaders };
    })();

    const Footer = (() => {
        function ensureFooter(node) {
            const marker = "__hdr_PRESET_FOOTER";
            if (node.widgets?.some(w => w.name === marker)) return; // déjà présent
            const DEFAULT_BG = "#4A5568";
            const w = node.addWidget("info", "Preset: No preset loaded", "", null, { serialize: false });
            w.name = marker;
            w._bg = DEFAULT_BG; w._fg = Utils.textColorFor(DEFAULT_BG);
            w._presetName = Utils.loadCurrentPresetName(node);
            w.computeSize = () => [200, 26];
            w.draw = (ctx, node2, widgetWidth, y) => {
                const label = w._presetName ? `Preset: ${w._presetName}` : "Preset: No preset loaded";
                ctx.save();
                ctx.fillStyle = w._bg; ctx.fillRect(0, y + 2, widgetWidth, 22);
                ctx.fillStyle = w._fg; ctx.font = "600 12px sans-serif"; ctx.textBaseline = "middle";
                const tw = ctx.measureText(label).width, cx = (widgetWidth - tw) / 2;
                ctx.fillText(label, Math.max(8, cx), y + 13);
                ctx.restore();
            };
            // S'assure que le footer reste en bas du bloc (hack d'ordre des widgets)
            const last = node.widgets.pop(); node.widgets.push(last);
        }

        function setFooterPresetName(node, name) {
            const w = node.widgets?.find(x => x.name === "__hdr_PRESET_FOOTER");
            if (!w) return;
            w._presetName = name || null;
            Utils.saveCurrentPresetName(node, w._presetName);
            node.setDirtyCanvas(true, true);
        }

        return { ensureFooter, setFooterPresetName };
    })();

    const ManageDialog = (() => {
        function downloadJSON(obj, filename) {
            const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
            URL.revokeObjectURL(url);
        }

        function createManageDialog(node) {
            const wrap = document.createElement("div");
            wrap.style.position = "fixed"; wrap.style.left = "0"; wrap.style.top = "0"; wrap.style.right = "0"; wrap.style.bottom = "0";
            wrap.style.background = "rgba(0,0,0,0.45)"; wrap.style.zIndex = 99999;
            document.body.appendChild(wrap);

            const box = document.createElement("div");
            box.style.background = "#1e1e1e"; box.style.color = "#ddd";
            box.style.border = "1px solid #444"; box.style.borderRadius = "8px";
            box.style.width = "420px"; box.style.maxWidth = "90vw";
            box.style.padding = "14px"; box.style.boxShadow = "0 10px 30px rgba(0,0,0,0.6)";
            box.style.position = "fixed"; box.style.left = "50%"; box.style.top = "20%"; box.style.transform = "translateX(-50%)";
            wrap.appendChild(box);

            const title = document.createElement("div");
            title.textContent = "Manage Presets";
            title.style.fontWeight = "700"; title.style.marginBottom = "10px"; title.style.cursor = "move"; title.style.textAlign = "center";
            box.appendChild(title);

            let isDragging = false, startX, startY, startLeft, startTop;
            title.addEventListener("mousedown", (e) => {
                isDragging = true; startX = e.clientX; startY = e.clientY;
                const rect = box.getBoundingClientRect(); startLeft = rect.left; startTop = rect.top;
                box.style.transform = "none"; // évite un offset supplémentaire pendant le drag
                function onMouseMove(ev) { if (!isDragging) return; const dx = ev.clientX - startX; const dy = ev.clientY - startY; box.style.left = (startLeft + dx) + "px"; box.style.top = (startTop + dy) + "px"; }
                function onMouseUp() { isDragging = false; document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); }
                document.addEventListener("mousemove", onMouseMove); document.addEventListener("mouseup", onMouseUp);
                e.preventDefault();
            });

            const row = document.createElement("div"); row.style.display = "flex"; row.style.gap = "8px"; row.style.marginBottom = "8px"; box.appendChild(row);
            const select = document.createElement("select"); select.style.flex = "1"; select.style.background = "#2b2b2b"; select.style.color = "#ddd"; select.style.border = "1px solid #555"; select.style.padding = "6px"; row.appendChild(select);
            const refreshBtn = document.createElement("button"); refreshBtn.textContent = "↻"; refreshBtn.title = "Refresh"; refreshBtn.style.padding = "6px 10px"; row.appendChild(refreshBtn);

            function fillOptions() {
                select.innerHTML = "";
                const cache = PresetsAPI.list();
                if (!cache.length) {
                    const opt = document.createElement("option"); opt.text = "No presets"; opt.value = ""; select.appendChild(opt); select.disabled = true;
                } else {
                    select.disabled = false;
                    cache.forEach(p => { const opt = document.createElement("option"); opt.text = p.name; opt.value = p.name; select.appendChild(opt); });
                    const cur = Utils.loadCurrentPresetName(node);
                    const idx = cache.findIndex(p => p.name === cur);
                    select.selectedIndex = idx >= 0 ? idx : 0;
                }
            }
            fillOptions(); PresetsAPI.refresh().then(fillOptions); // on recharge dès l'ouverture
            refreshBtn.onclick = () => { PresetsAPI.refresh().then(fillOptions); };

            const grid = document.createElement("div"); grid.style.display = "grid"; grid.style.gridTemplateColumns = "1fr 1fr"; grid.style.gap = "8px"; box.appendChild(grid);
            function button(label, handler) { const b = document.createElement("button"); b.textContent = label; b.style.padding = "8px 10px"; b.style.background = "#3a3f44"; b.style.color = "#fff"; b.style.border = "1px solid #555"; b.style.borderRadius = "6px"; b.addEventListener("click", handler); grid.appendChild(b); return b; }

            button("Apply to node", () => {
                const nm = select.value; if (!nm) return;
                const p = PresetsAPI.list().find(x => x.name === nm);
                if (p?.payload) { Utils.setNodeValues(node, p.payload); Footer.setFooterPresetName(node, nm); }
            });

            button("Save (overwrite)", async () => {
                const nm = select.value; if (!nm) return;
                const payload = Utils.getNodeValues(node);
                const res = await PresetsAPI.savePreset(nm, payload);
                if (res?.ok) { await PresetsAPI.refresh(); Footer.setFooterPresetName(node, nm); app.ui?.toast?.("Preset saved"); }
                else alert("Failed to save preset");
            });

            button("Save As…", async () => {
                const nm = prompt("New preset name:"); if (!nm) return;
                const payload = Utils.getNodeValues(node);
                const res = await PresetsAPI.savePreset(nm, payload);
                if (res?.ok) { await PresetsAPI.refresh(); fillOptions(); Footer.setFooterPresetName(node, nm); app.ui?.toast?.("Preset saved"); }
                else alert("Failed to save preset");
            });

            button("Rename…", async () => {
                const old = select.value; if (!old) return;
                const neu = prompt("Rename preset:", old); if (!neu || neu === old) return;
                const found = PresetsAPI.list().find(p => p.name === old); if (!found) return;
                const res1 = await PresetsAPI.savePreset(neu, found.payload); if (!res1?.ok) { alert("Failed to rename (save-as)"); return; }
                const res2 = await PresetsAPI.deletePreset(old); if (!res2?.ok) { alert("Failed to rename (delete old)"); return; }
                await PresetsAPI.refresh(); fillOptions(); Footer.setFooterPresetName(node, neu); app.ui?.toast?.("Preset renamed");
            });

            button("Delete", async () => {
                const nm = select.value; if (!nm) return;
                if (!confirm(`Delete preset "${nm}" ?`)) return;
                const res = await PresetsAPI.deletePreset(nm);
                if (res?.ok) { if (Utils.loadCurrentPresetName(node) === nm) Footer.setFooterPresetName(node, null); await PresetsAPI.refresh(); fillOptions(); app.ui?.toast?.("Preset deleted"); }
                else alert("Failed to delete preset");
            });

            button("Export", () => {
                const nm = select.value; if (!nm) return;
                const p = PresetsAPI.list().find(x => x.name === nm); if (!p) return;
                downloadJSON(p, `flux_preset_${nm}.json`);
            });

            button("Import", () => {
                const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
                inp.onchange = async () => {
                    const file = inp.files?.[0]; if (!file) return;
                    try {
                        const txt = await file.text(); const obj = JSON.parse(txt);
                        // Compat format "Comfy.NodePresets" (presets groupés par nodeType)
                        if (obj?.presets && typeof obj.presets === "object") {
                            const all = [];
                            for (const nodeType in obj.presets) {
                                const arr = obj.presets[nodeType] || [];
                                for (const it of arr) {
                                    if (it?.name && (it?.values || it?.payload)) {
                                        all.push({ name: it.name, payload: it.values || it.payload });
                                    }
                                }
                            }
                            if (!all.length) throw new Error("Empty presets file");
                            for (const it of all) { await PresetsAPI.savePreset(it.name, it.payload); }
                            await PresetsAPI.refresh(); fillOptions(); app.ui?.toast?.("Presets imported");
                        } else {
                            const nm = obj?.name || prompt("Preset name for import:");
                            const payload = obj?.payload || obj; // compat ancien export
                            if (!nm || !payload) { alert("Invalid file"); return; }
                            const res = await PresetsAPI.savePreset(nm, payload);
                            if (res?.ok) { await PresetsAPI.refresh(); fillOptions(); Footer.setFooterPresetName(node, nm); app.ui?.toast?.("Preset imported"); }
                            else alert("Failed to import preset");
                        }
                    } catch { alert("Invalid JSON"); }
                };
                inp.click();
            });

            const closeBar = document.createElement("div"); closeBar.style.display = "flex"; closeBar.style.justifyContent = "flex-end"; closeBar.style.marginTop = "10px"; box.appendChild(closeBar);
            const close = document.createElement("button"); close.textContent = "Close"; close.style.padding = "6px 12px"; close.style.background = "#444"; close.style.color = "#fff"; close.style.border = "1px solid #555"; close.style.borderRadius = "6px"; close.onclick = () => document.body.removeChild(wrap); closeBar.appendChild(close);

            wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) document.body.removeChild(wrap); });
        }

        return { createManageDialog };
    })();

    const Integration = (() => {
        function ensureManageButton(node) {
            const exists = node.widgets?.some(w => w.type === "button" && w.name === "manage_presets");
            if (exists) return;

            const btn = node.addWidget("button", "Manage presets", null, () => ManageDialog.createManageDialog(node), { serialize: false });
            btn.name = "manage_presets";
            const origDraw = btn.draw;
            btn.draw = function (ctx, node2, widgetWidth, y, height) {
                if (origDraw) origDraw.call(btn, ctx, node2, widgetWidth, y, height);
                const h = height || 24;
                ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = "#808080"; ctx.strokeRect(0.5, y + 2.5, widgetWidth - 1, h - 5); ctx.restore();
                ctx.save(); ctx.font = "700 12px sans-serif"; ctx.textBaseline = "middle"; ctx.fillStyle = "#ffffff"; const label = "Manage presets"; const tw = ctx.measureText(label).width; const cx = (widgetWidth - tw) / 2; ctx.fillText(label, Math.max(8, cx), y + h / 2); ctx.restore();
            };
            const last = node.widgets.pop(); node.widgets.push(last);
        }

        function register() {
            app.registerExtension({
                name: "flux_settings.presets_headers_footer_manage",
                async beforeRegisterNodeDef(nodeType, nodeData, appRef) {
                    if (nodeData?.name !== NODE_CLASS) return;

                    const orig = nodeType.prototype.getExtraMenuOptions;
                    nodeType.prototype.getExtraMenuOptions = function (_, options) {
                        if (orig) orig.apply(this, arguments);
                        const names = PresetsAPI.list().map(p => p.name);

                        const saveItem = {
                            content: "Save preset...",
                            callback: async () => {
                                const name = prompt("Preset name:"); if (!name) return;
                                const payload = Utils.getNodeValues(this);
                                const res = await PresetsAPI.savePreset(name, payload);
                                if (!res?.ok) { alert("Failed to save preset"); return; }
                                appRef.ui?.toast?.("Preset saved");
                                await PresetsAPI.refresh();
                                Footer.setFooterPresetName(this, name);
                            }
                        };

                        const loadSub = names.length
                            ? names.map(nm => ({ content: nm, callback: () => { const p = PresetsAPI.list().find(x => x.name === nm); if (p?.payload) { Utils.setNodeValues(this, p.payload); Footer.setFooterPresetName(this, nm); } } }))
                            : [{ content: "No presets", disabled: true }];

                        const delSub = names.length
                            ? names.map(nm => ({ content: nm, callback: async () => { const res = await PresetsAPI.deletePreset(nm); if (!res?.ok) { alert("Failed to delete preset"); return; } appRef.ui?.toast?.("Preset deleted"); await PresetsAPI.refresh(); const cur = Utils.loadCurrentPresetName(this); if (cur === nm) Footer.setFooterPresetName(this, null); } }))
                            : [{ content: "No presets", disabled: true }];

                        options.push(
                            null, // séparateur
                            {
                                content: "Presets", submenu: {
                                    options: [
                                        saveItem,
                                        { content: "Load preset...", submenu: { options: loadSub } },
                                        { content: "Delete preset...", submenu: { options: delSub } },
                                        { content: "Manage…", callback: () => ManageDialog.createManageDialog(this) },
                                    ]
                                }
                            }
                        );
                        return options;
                    };

                    const origCreated = nodeType.prototype.onNodeCreated;
                    nodeType.prototype.onNodeCreated = function () {
                        if (origCreated) origCreated.apply(this, arguments);
                        SectionHeaders.addSectionHeaders(this);
                        Footer.ensureFooter(this);
                        ensureManageButton(this);
                        const cur = Utils.loadCurrentPresetName(this);
                        Footer.setFooterPresetName(this, cur);
                        PresetsAPI.refresh(); // non bloquant
                    };
                },

                nodeCreated(node) {
                    if (node?.comfyClass === NODE_CLASS || node?.type === NODE_CLASS || node?.title === "Flux/Sdxl Settings Pipe") {
                        SectionHeaders.addSectionHeaders(node);
                        Footer.ensureFooter(node);
                        ensureManageButton(node);
                        const cur = Utils.loadCurrentPresetName(node);
                        Footer.setFooterPresetName(node, cur);
                        PresetsAPI.refresh();
                    }
                },
            });
        }

        return { register };
    })();

    Integration.register();
})();
