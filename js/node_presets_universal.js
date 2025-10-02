import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

(function () {
    const EXT_NAME = "NodePresets.Context.SingleFilePerNodeType";
    const STORAGE_ROOT = "preset_nodes"; // sous /userdata
    const LS_CURRENT = "nodepresets.current_by_nodeid"; // nom du preset appliqué (cosmétique)

    // -----------------------
    // Utils
    // -----------------------
    const Utils = {
        nodeTypeOf(node) {
            return node?.type || node?.comfyClass || "UnknownNode";
        },
        safeName(name) {
            const cleaned = String(name)
                .trim()
                .replace(/[\\\/:*?"<>|]/g, "_")
                .replace(/\s+/g, " ")
                .replace(/^\.+/, ""); // enlève les points initiaux

            const capped = cleaned.slice(0, 128);
            return capped || "preset";
        },
        filePathFor(nodeType) {
            const t = encodeURIComponent(nodeType || "UnknownNode");
            return `${STORAGE_ROOT}/${t}.json`;
        },
        getNodeValues(node) {
            const out = {};
            const widgets = node.widgets || [];
            for (const w of widgets) {
                if (!w || !w.name || typeof w.name !== "string") continue;
                const type = String(w.type || "").toLowerCase();
                if (type === "button" || type === "info" || type === "separator" || type === "label") continue;
                if (w.options && w.options.serialize === false) continue;
                out[w.name] = w.value;
            }
            return out;
        },
        setNodeValues(node, values) {
            if (!values || typeof values !== "object") return;
            const widgets = node.widgets || [];
            for (const [k, v] of Object.entries(values)) {
                const w = widgets.find((ww) => ww && ww.name === k);
                if (!w) continue;
                try {
                    w.value = v;
                    if (typeof w.callback === "function") w.callback(v);
                } catch { }
            }
            node.setDirtyCanvas?.(true, true);
        },
        getCurrentPresetName(nodeId) {
            try {
                return (JSON.parse(localStorage.getItem(LS_CURRENT) || "{}") || {})[nodeId] || null;
            } catch {
                return null;
            }
        },
        setCurrentPresetName(nodeId, name) {
            try {
                const map = JSON.parse(localStorage.getItem(LS_CURRENT) || "{}") || {};
                if (name) map[nodeId] = name;
                else delete map[nodeId];
                localStorage.setItem(LS_CURRENT, JSON.stringify(map));
            } catch { }
        },
        toast(msg) {
            app.ui?.toast?.(msg) || console.log("[Presets] " + msg);
        },
    };

    // -----------------------
    // Local fallback
    // -----------------------
    const Local = {
        key(path) {
            return "UD:" + path;
        },
        read(path) {
            try {
                const s = localStorage.getItem(Local.key(path));
                return s ? JSON.parse(s) : null;
            } catch {
                return null;
            }
        },
        write(path, obj) {
            try {
                localStorage.setItem(Local.key(path), JSON.stringify(obj ?? {}));
                return true;
            } catch {
                return false;
            }
        },
    };

    // -----------------------
    // Server (userdata)
    // -----------------------
    const Server = {
        async read(path) {
            try {
                const res = await api.getUserData(path);
                if (res.status === 200) return await res.json();
                if (res.status === 404) return null;
                console.error("read error", res.status, res.statusText);
                return null;
            } catch (e) {
                console.error(e);
                return null;
            }
        },
        async write(path, obj) {
            try {
                const json = JSON.stringify(obj ?? {}, null, 2);
                await api.storeUserData(path, json, { stringify: false });
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        },
    };

    // -----------------------
    // Store unifié (1 fichier par NodeType)
    // -----------------------
    const Store = {
        async _readFile(nodeType) {
            const path = Utils.filePathFor(nodeType);
            if (app.storageLocation === "server") return (await Server.read(path)) || null;
            return Local.read(path);
        },
        async _writeFile(nodeType, data) {
            const path = Utils.filePathFor(nodeType);
            if (app.storageLocation === "server") return await Server.write(path, data);
            return Local.write(path, data);
        },

        async _ensureFile(nodeType) {
            const cur = (await this._readFile(nodeType)) || null;
            if (cur && Array.isArray(cur.presets)) return cur;
            const fresh = { nodeType, version: 1, presets: [] };
            await this._writeFile(nodeType, fresh);
            return fresh;
        },

        async list(nodeType) {
            const file = (await this._readFile(nodeType)) || { presets: [] };
            return Array.isArray(file.presets) ? file.presets : [];
        },

        async save(nodeType, name, values) {
            name = Utils.safeName(name);
            const file = await this._ensureFile(nodeType);
            const i = file.presets.findIndex((p) => p.name === name);
            const preset = { name, values };
            if (i >= 0) file.presets[i] = preset;
            else file.presets.push(preset);
            const ok = await this._writeFile(nodeType, file);
            return { ok };
        },

        async load(nodeType, name) {
            const file = await this._readFile(nodeType);
            if (!file || !Array.isArray(file.presets)) return null;
            return file.presets.find((p) => p.name === name) || null;
        },

        async rename(nodeType, oldName, newName) {
            newName = Utils.safeName(newName);
            const file = await this._readFile(nodeType);
            if (!file || !Array.isArray(file.presets)) return { ok: false, error: "missing file" };
            const i = file.presets.findIndex((p) => p.name === oldName);
            if (i < 0) return { ok: false, error: "not found" };
            if (file.presets.some((p, idx) => idx !== i && p.name === newName)) {
                return { ok: false, error: "name exists" };
            }
            file.presets[i].name = newName;
            const ok = await this._writeFile(nodeType, file);
            return { ok };
        },

        async del(nodeType, name) {
            const file = await this._readFile(nodeType);
            if (!file || !Array.isArray(file.presets)) return { ok: true };
            const before = file.presets.length;
            file.presets = file.presets.filter((p) => p.name !== name);
            const ok = await this._writeFile(nodeType, file);
            return { ok: ok && file.presets.length < before };
        },
    };

    // -----------------------
    // Manage Dialog (léger)
    // -----------------------
    function openManageDialog(node) {
        const nodeType = Utils.nodeTypeOf(node);

        const wrap = document.createElement("div");
        Object.assign(wrap.style, {
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 99999,
        });

        const box = document.createElement("div");
        Object.assign(box.style, {
            position: "fixed",
            left: "50%",
            top: "18%",
            transform: "translateX(-50%)",
            width: "460px",
            maxWidth: "92vw",
            background: "#1f1f1f",
            color: "#e8e8e8",
            border: "1px solid #3a3a3a",
            borderRadius: "10px",
            boxShadow: "0 12px 34px rgba(0,0,0,0.55)",
            padding: "14px",
        });
        wrap.appendChild(box);

        const title = document.createElement("div");
        title.textContent = `Presets — ${nodeType}`;
        Object.assign(title.style, {
            fontWeight: "800",
            textAlign: "center",
            marginBottom: "10px",
            cursor: "move",
        });
        box.appendChild(title);

        const row = document.createElement("div");
        Object.assign(row.style, { display: "flex", gap: "8px", marginBottom: "8px" });
        const select = document.createElement("select");
        Object.assign(select.style, {
            flex: 1,
            background: "#2b2b2b",
            color: "#eee",
            border: "1px solid #555",
            padding: "6px",
        });
        const refreshBtn = document.createElement("button");
        refreshBtn.textContent = "↻";
        refreshBtn.title = "Refresh";
        refreshBtn.style.padding = "6px 10px";
        row.appendChild(select);
        row.appendChild(refreshBtn);
        box.appendChild(row);

        const grid = document.createElement("div");
        Object.assign(grid.style, {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
        });
        box.appendChild(grid);

        const mkBtn = (label, cb) => {
            const b = document.createElement("button");
            b.textContent = label;
            Object.assign(b.style, {
                padding: "8px 10px",
                background: "#3a3f44",
                color: "#fff",
                border: "1px solid #555",
                borderRadius: "8px",
            });
            b.addEventListener("click", cb);
            grid.appendChild(b);
            return b;
        };

        let cache = [];
        async function refill() {
            cache = await Store.list(nodeType);
            select.innerHTML = "";
            if (!cache.length) {
                const opt = document.createElement("option");
                opt.text = "No presets";
                opt.value = "";
                select.appendChild(opt);
                select.disabled = true;
            } else {
                select.disabled = false;
                cache.forEach((p) => {
                    const opt = document.createElement("option");
                    opt.text = p.name;
                    opt.value = p.name;
                    select.appendChild(opt);
                });
            }
        }
        refreshBtn.onclick = refill;
        refill();

        mkBtn("Apply to node", async () => {
            const nm = select.value;
            if (!nm) return;
            const data = await Store.load(nodeType, nm);
            if (data?.values) {
                Utils.setNodeValues(node, data.values);
                Utils.setCurrentPresetName(node.id, nm);
                Utils.toast("Preset applied");
            } else alert("Failed to read preset.");
        });

        mkBtn("Save (overwrite)", async () => {
            const nm = select.value;
            if (!nm) return;
            const values = Utils.getNodeValues(node);
            const res = await Store.save(nodeType, nm, values);
            if (res.ok) {
                await refill();
                Utils.setCurrentPresetName(node.id, nm);
                Utils.toast("Preset saved");
            } else alert("Save failed");
        });

        mkBtn("Save As…", async () => {
            const nm = prompt("New preset name:");
            if (!nm) return;
            const values = Utils.getNodeValues(node);
            const res = await Store.save(nodeType, nm, values);
            if (res.ok) {
                await refill();
                Utils.setCurrentPresetName(node.id, nm);
                Utils.toast("Preset saved");
            } else alert("Save failed");
        });

        mkBtn("Rename…", async () => {
            const old = select.value;
            if (!old) return;
            const neu = prompt("Rename preset:", old);
            if (!neu || neu === old) return;
            const r = await Store.rename(nodeType, old, Utils.safeName(neu));
            if (r.ok) {
                await refill();
                Utils.setCurrentPresetName(node.id, neu);
                Utils.toast("Preset renamed");
            } else alert("Rename failed");
        });

        mkBtn("Delete", async () => {
            const nm = select.value;
            if (!nm) return;
            if (!confirm(`Delete "${nm}" ?`)) return;
            const r = await Store.del(nodeType, nm);
            if (r.ok) {
                await refill();
                if (Utils.getCurrentPresetName(node.id) === nm) Utils.setCurrentPresetName(node.id, null);
                Utils.toast("Preset deleted");
            } else alert("Delete failed");
        });

        mkBtn("Export (selected)", async () => {
            const nm = select.value;
            if (!nm) return;
            const data = await Store.load(nodeType, nm);
            if (!data) return alert("Cannot read preset");
            const blob = new Blob([JSON.stringify({ presets: [data] }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${nodeType}__${nm}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });

        mkBtn("Export (all)", async () => {
            const list = await Store.list(nodeType);
            if (!list.length) return alert("No presets");
            const blob = new Blob([JSON.stringify({ nodeType, presets: list }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${nodeType}__all_presets.json`;
            a.click();
            URL.revokeObjectURL(url);
        });

        mkBtn("Import", async () => {
            const inp = document.createElement("input");
            inp.type = "file";
            inp.accept = ".json,application/json";
            inp.onchange = async () => {
                const f = inp.files?.[0];
                if (!f) return;
                try {
                    const txt = await f.text();
                    const obj = JSON.parse(txt);
                    const toAdd = [];
                    if (Array.isArray(obj?.presets)) {
                        toAdd.push(...obj.presets);
                    } else if (obj?.name && (obj.values || obj.payload)) {
                        toAdd.push({ name: obj.name, values: obj.values || obj.payload });
                    } else if (obj?.presets && typeof obj.presets === "object") {
                        const arr = obj.presets[nodeTypeName];
                        if (Array.isArray(arr)) toAdd.push(...arr);
                    }
                    if (!toAdd.length) return alert("Invalid file");
                    for (const p of toAdd) {
                        if (!p?.name || !(p.values || p.payload)) continue;
                        await Store.save(nodeType, p.name, p.values || p.payload);
                    }
                    await refill();
                    Utils.toast("Presets imported");
                } catch (e) {
                    alert("Invalid JSON: " + e.message);
                }
            };
            inp.click();
        });

        const closeBar = document.createElement("div");
        Object.assign(closeBar.style, { display: "flex", justifyContent: "flex-end", marginTop: "10px" });
        const close = document.createElement("button");
        close.textContent = "Close";
        Object.assign(close.style, { padding: "6px 12px", background: "#444", color: "#fff", border: "1px solid #555", borderRadius: "6px" });
        close.onclick = () => document.body.removeChild(wrap);
        closeBar.appendChild(close);
        box.appendChild(closeBar);

        wrap.addEventListener("mousedown", (e) => {
            if (e.target === wrap) document.body.removeChild(wrap);
        });
        document.body.appendChild(wrap);
    }

    // -----------------------
    // Intégration : menu contextuel sur tous les nœuds
    // -----------------------
    app.registerExtension({
        name: EXT_NAME,
        async beforeRegisterNodeDef(nodeType) {
            if (nodeType.prototype.__nodepresets_singlefile_patched) return;
            nodeType.prototype.__nodepresets_singlefile_patched = true;

            const origMenu = nodeType.prototype.getExtraMenuOptions;
            nodeType.prototype.getExtraMenuOptions = function (_, options) {
                if (origMenu) origMenu.apply(this, arguments);
                const node = this;
                const nodeTypeName = Utils.nodeTypeOf(node);

                const submenu = { options: [] };

                // Save preset…
                submenu.options.push({
                    content: "Save preset…",
                    callback: async () => {
                        const name = prompt("Preset name:");
                        if (!name) return;
                        const values = Utils.getNodeValues(node);
                        const res = await Store.save(nodeTypeName, name, values);
                        if (res.ok) {
                            Utils.setCurrentPresetName(node.id, name);
                            Utils.toast("Preset saved");
                        } else alert("Save failed");
                    },
                });

                // Load preset…
                const loadSub = { options: [] };
                submenu.options.push({ content: "Load preset…", submenu: loadSub });
                (async () => {
                    const list = await Store.list(nodeTypeName);
                    if (!list.length) loadSub.options.push({ content: "No presets", disabled: true });
                    else
                        list.forEach((p) => {
                            loadSub.options.push({
                                content: p.name,
                                callback: async () => {
                                    const data = await Store.load(nodeTypeName, p.name);
                                    if (data?.values) {
                                        Utils.setNodeValues(node, data.values);
                                        Utils.setCurrentPresetName(node.id, p.name);
                                        Utils.toast(`Loaded "${p.name}"`);
                                    } else alert("Failed to read preset.");
                                },
                            });
                        });
                })();

                // Delete preset…
                const delSub = { options: [] };
                submenu.options.push({ content: "Delete preset…", submenu: delSub });
                (async () => {
                    const list = await Store.list(nodeTypeName);
                    if (!list.length) delSub.options.push({ content: "No presets", disabled: true });
                    else
                        list.forEach((p) => {
                            delSub.options.push({
                                content: p.name,
                                callback: async () => {
                                    if (!confirm(`Delete "${p.name}" ?`)) return;
                                    const r = await Store.del(nodeTypeName, p.name);
                                    if (r.ok) Utils.toast("Preset deleted");
                                    else alert("Delete failed");
                                },
                            });
                        });
                })();

                // Manage (dialog)
                submenu.options.push({ content: "Manage…", callback: () => openManageDialog(node) });

                options.push(null, { content: "Presets", submenu });
                return options;
            };
        },
    });
})();