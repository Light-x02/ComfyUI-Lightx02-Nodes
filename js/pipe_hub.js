// web/js/pipe_hub.js — Pipe Hub UI v7.4
// - Entrées: any (*) ; Sorties: any (*)  ➜ compatible avec AnyType("*") côté Python
// - Auto-extend/retract propre, labels uniques (IMAGE, IMAGE_1, ...)
// - Traversée EXHAUSTIVE de l’aval: multi-liens, Reroute & co, Set ➜ tous les Get
// - Bouton "Fix" + entrée de menu: met à jour tout le sous-réseau connecté, même après Set/Get

import { app } from "/scripts/app.js";

(function () {
    const HUB_CLASS = "PipeHub";
    const TITLE = "🔗 Pipe Hub";
    const MAX = 30;

    const INPUT_ANY = "*";
    const OUTPUT_ANY = "*";

    const PASS_THROUGH_CLASSES = new Set(["Reroute"]);

    // -------- utils ports
    const findIn = (n, name) => (n.inputs || []).findIndex((s) => s.name === name);
    const findOut = (n, name) => (n.outputs || []).findIndex((s) => s.name === name);

    const isHub = (n) => n && n.comfyClass === HUB_CLASS;
    const looks1in1out = (n) => n && (n.inputs?.length || 0) === 1 && (n.outputs?.length || 0) === 1;
    const isPassThrough = (n) => n && !isHub(n) && (looks1in1out(n) || PASS_THROUGH_CLASSES.has(n.comfyClass));

    // -------- détection robuste Set/Get
    function normKey(v) {
        try { return JSON.stringify(v ?? "").toString(); } catch { return String(v ?? ""); }
    }
    function widgetValue(node, idx) {
        const w = node.widgets?.[idx];
        if (!w) return node.widgets_values?.[idx];
        return typeof w.value !== "undefined" ? w.value : node.widgets_values?.[idx];
    }
    function bestKeyWidgetIndex(node) {
        const ws = node.widgets || [];
        let best = -1;
        for (let i = 0; i < ws.length; i++) {
            const nm = String(ws[i].name || ws[i].label || "").toLowerCase();
            if (nm.includes("key") || nm.includes("name") || nm.includes("constant") || nm.includes("id")) { best = i; break; }
        }
        if (best === -1 && ws.length) best = 0;
        return best;
    }
    function keyOf(node) {
        const i = bestKeyWidgetIndex(node);
        if (i < 0) return null;
        return normKey(widgetValue(node, i));
    }
    function isLikelySetNode(n) {
        // un Set a au moins 1 input, 0 ou N outputs; clé présente
        return n && (n.inputs?.length || 0) >= 1 && keyOf(n) != null;
    }
    function isLikelyGetNode(n) {
        // un Get a 0 input, >=1 outputs; clé présente
        return n && (n.inputs?.length || 0) === 0 && (n.outputs?.length || 0) >= 1 && keyOf(n) != null;
    }
    function findAllSetsByKey(graph, key) {
        const out = [];
        (graph?._nodes || graph.nodes || []).forEach((n) => { if (isLikelySetNode(n) && keyOf(n) === key) out.push(n); });
        return out;
    }
    function findAllGetsByKey(graph, key) {
        const out = [];
        (graph?._nodes || graph.nodes || []).forEach((n) => { if (isLikelyGetNode(n) && keyOf(n) === key) out.push(n); });
        return out;
    }

    // -------- remonter l’origine réelle d’un link (Get→Set→source, reroute, etc.)
    function ultimateOriginOut(graph, linkId) {
        let L = graph?.links?.[linkId];
        if (!L) return null;
        let node = graph.getNodeById(L.origin_id);
        const seen = new Set();

        while (node && !seen.has(node.id)) {
            seen.add(node.id);

            if (isLikelyGetNode(node)) {
                const k = keyOf(node);
                const sets = findAllSetsByKey(graph, k);
                const wiredSet = sets.find((s) => (s.inputs?.[0]?.link != null));
                if (!wiredSet) break;
                const inL = wiredSet.inputs[0].link;
                L = graph.links[inL];
                if (!L) break;
                node = graph.getNodeById(L.origin_id);
                continue;
            }

            if (isPassThrough(node)) {
                const in0 = node.inputs?.[0];
                if (!in0 || in0.link == null) break;
                L = graph.links[in0.link];
                if (!L) break;
                node = graph.getNodeById(L.origin_id);
                continue;
            }

            break;
        }

        if (!node || !L) return null;
        const out = node.outputs?.[L.origin_slot];
        return { node, out, link: L };
    }

    // -------- hub amont direct (via pipe_in)
    function upstreamHub(node) {
        const g = node.graph; if (!g) return null;
        const i = findIn(node, "pipe_in"); if (i < 0) return null;
        const s = node.inputs[i]; if (!s || s.link == null) return null;
        const u = ultimateOriginOut(g, s.link);
        if (!u) return null;
        const src = g.getNodeById(u.link.origin_id);
        return isHub(src) ? src : null;
    }

    // -------- suivre EXHAUSTIVEMENT les sorties d’un link jusqu’aux hubs (multi-liens + Set/Get)
    function followToHubsFromLink(graph, startLinkId, accHubs, seenNodes, seenLinks) {
        const L0 = graph?.links?.[startLinkId];
        if (!L0) return;

        const localSeenN = seenNodes || new Set();
        const localSeenL = seenLinks || new Set();
        if (localSeenL.has(startLinkId)) return;
        localSeenL.add(startLinkId);

        const tgt = graph.getNodeById(L0.target_id);
        if (!tgt || localSeenN.has(tgt.id)) return;
        localSeenN.add(tgt.id);

        if (isHub(tgt)) { accHubs.push(tgt); return; }

        if (isPassThrough(tgt)) {
            const out0 = tgt.outputs?.[0];
            (out0?.links || []).forEach((lid) => followToHubsFromLink(graph, lid, accHubs, localSeenN, localSeenL));
            return;
        }

        if (isLikelySetNode(tgt)) {
            const k = keyOf(tgt);
            const gets = findAllGetsByKey(graph, k);
            for (const gNode of gets) {
                const go = gNode.outputs?.[0];
                (go?.links || []).forEach((lid) => followToHubsFromLink(graph, lid, accHubs, localSeenN, localSeenL));
            }
            return;
        }
        // sinon: stop
    }

    function immediateDownstreamHubs(node) {
        const g = node.graph; if (!g) return [];
        const o = findOut(node, "pipe"); if (o < 0) return [];
        const out = node.outputs[o]; if (!out) return [];
        const acc = [];
        const seenN = new Set(), seenL = new Set();
        (out.links || []).forEach((lid) => followToHubsFromLink(g, lid, acc, seenN, seenL));
        // unique
        const uniq = []; const seenIds = new Set();
        for (const h of acc) if (!seenIds.has(h.id)) { seenIds.add(h.id); uniq.push(h); }
        return uniq;
    }

    // -------- usage / meta / labels
    function usageLevel(node) {
        let used = 0;
        for (let k = 1; k <= MAX; k++) {
            const ii = findIn(node, `in${k}`), io = findOut(node, `out${k}`);
            if (ii < 0 || io < 0) break;
            const inUsed = node.inputs[ii]?.link != null;
            const outUsed = (node.outputs[io]?.links?.length || 0) > 0;
            if (inUsed || outUsed) used = k;
        }
        return used;
    }
    function metaLevel(node) {
        let lvl = 0;
        const meta = node.__pairMeta || {};
        for (let k = 1; k <= MAX; k++) if (meta[k] && (meta[k].label || meta[k].type)) lvl = k;
        return lvl;
    }
    const advertisedLevel = (n) => Math.max(usageLevel(n), metaLevel(n));
    const upstreamAdvertisedLvl = (n) => { const up = upstreamHub(n); return up ? advertisedLevel(up) : 0; };
    const isPipeInConnected = (n) => { const i = findIn(n, "pipe_in"); return i >= 0 && n.inputs[i]?.link != null; };

    function setSlotUILabel(slot, label) { slot.label = label; slot._display_name = label; }
    function resetSlotUILabel(slot) { slot.label = null; delete slot._display_name; }
    function isPairFree(node, idx) {
        const ii = findIn(node, `in${idx}`), io = findOut(node, `out${idx}`);
        if (ii < 0 || io < 0) return true;
        const inFree = node.inputs[ii]?.link == null;
        const outFree = (node.outputs[io]?.links?.length || 0) === 0;
        return inFree && outFree;
    }
    function resetPairLabels(node, idx) {
        const ii = findIn(node, `in${idx}`), io = findOut(node, `out${idx}`);
        if (ii >= 0) resetSlotUILabel(node.inputs[ii]);
        if (io >= 0) resetSlotUILabel(node.outputs[io]);
        if (node.__pairMeta) delete node.__pairMeta[idx];
    }
    function getSourceLabel(graph, linkId) {
        const u = ultimateOriginOut(graph, linkId);
        if (!u) return null;
        const label = u.out?.label || u.out?.name || "slot";
        const type = u.out?.type || u.link?.type || "";
        return { label, type };
    }
    function rememberPairMeta(node, idx, data) {
        node.__pairMeta = node.__pairMeta || {};
        node.__pairMeta[idx] = { ...(node.__pairMeta[idx] || {}), ...data };
    }
    function dedupeLabels(node) {
        const count = currentPairCount(node);
        const seen = Object.create(null);
        for (let k = 1; k <= count; k++) {
            const m = node.__pairMeta?.[k];
            const base = (m?.label || m?.type || "").toString().trim();
            const ii = findIn(node, `in${k}`), io = findOut(node, `out${k}`);
            if (!base) { if (ii >= 0) resetSlotUILabel(node.inputs[ii]); if (io >= 0) resetSlotUILabel(node.outputs[io]); continue; }
            seen[base] = (seen[base] || 0) + 1;
            const n = seen[base];
            const disp = n === 1 ? base : `${base}_${n - 1}`;
            if (ii >= 0) setSlotUILabel(node.inputs[ii], disp);
            if (io >= 0) setSlotUILabel(node.outputs[io], disp);
            rememberPairMeta(node, k, { labelDisplay: disp });
        }
        node.setDirtyCanvas(true, true);
    }
    function applyPairLabels(node, pairIdx) {
        const g = node.graph;
        const ii = findIn(node, `in${pairIdx}`), io = findOut(node, `out${pairIdx}`);
        if (ii < 0 || io < 0) return;

        let base = null, typ = null;
        const inSlot = node.inputs[ii];

        if (inSlot?.link != null && g) {
            const info = getSourceLabel(g, inSlot.link);
            if (info) { base = info.label; typ = info.type; }
        }
        if (!base && node.__inheritedMeta?.[pairIdx]) {
            const m = node.__inheritedMeta[pairIdx];
            base = m.labelDisplay || m.label || m.type || null;
            typ = m.type || null;
        }
        if (!base) { resetPairLabels(node, pairIdx); node.setDirtyCanvas(true, true); return; }

        rememberPairMeta(node, pairIdx, { label: base, type: (typ || base).toUpperCase() });
        dedupeLabels(node);
    }

    // -------- entretien des ports
    function sweepPorts(node) {
        const seenIn = new Set();
        for (let i = (node.inputs?.length || 0) - 1; i >= 0; i--) {
            const s = node.inputs[i];
            const m = s?.name?.match?.(/^in(\d+)$/);
            if (!m) continue;
            if (seenIn.has(s.name) && s.link == null) node.removeInput(i);
            else seenIn.add(s.name);
        }
        const seenOut = new Set();
        for (let i = (node.outputs?.length || 0) - 1; i >= 0; i--) {
            const s = node.outputs[i];
            const m = s?.name?.match?.(/^out(\d+)$/);
            if (!m) continue;
            if (seenOut.has(s.name) && ((s.links?.length || 0) === 0)) node.removeOutput(i);
            else seenOut.add(s.name);
        }
        node.setSize(node.computeSize());
        node.setDirtyCanvas(true, true);
    }

    // -------- sizing / héritage
    function refreshInheritedMeta(node) {
        const up = upstreamHub(node);
        node.__inheritedMeta = up?.__pairMeta ? JSON.parse(JSON.stringify(up.__pairMeta)) : {};
    }
    function currentPairCount(node) {
        let c = 0;
        for (let k = 1; k <= MAX; k++) {
            const ii = findIn(node, `in${k}`), io = findOut(node, `out${k}`);
            if (ii < 0 || io < 0) break;
            c++;
        }
        return c;
    }
    function addPairs(node, target) {
        const have = currentPairCount(node);
        if (target <= have) return;
        for (let n = have + 1; n <= Math.min(MAX, target); n++) {
            if (findIn(node, `in${n}`) < 0) node.addInput(`in${n}`, INPUT_ANY);
            if (findOut(node, `out${n}`) < 0) node.addOutput(`out${n}`, OUTPUT_ANY);
            resetPairLabels(node, n);
        }
        node.setSize(node.computeSize());
        node.setDirtyCanvas(true, true);
    }
    function removeLastPairIfEmpty(node) {
        const last = currentPairCount(node);
        if (last <= 2) return false;
        if (!isPairFree(node, last)) return false;
        resetPairLabels(node, last);
        const ii = findIn(node, `in${last}`), io = findOut(node, `out${last}`);
        if (io >= 0) node.removeOutput(io);
        if (ii >= 0) node.removeInput(ii);
        node.setSize(node.computeSize());
        node.setDirtyCanvas(true, true);
        return true;
    }
    function desiredTarget(node) {
        const base = Math.max(usageLevel(node), metaLevel(node), upstreamAdvertisedLvl(node));
        return Math.max(2, Math.min(MAX, base ? base + 1 : currentPairCount(node)));
    }
    function ensurePairCount(node) {
        sweepPorts(node);
        const target = desiredTarget(node);
        let cur = currentPairCount(node);
        if (cur < target) {
            addPairs(node, target);
            if (isPipeInConnected(node)) { refreshInheritedMeta(node); applyAllInheritedLabels(node); }
            else { dedupeLabels(node); }
            return;
        }
        while (cur > target) {
            if (!removeLastPairIfEmpty(node)) break;
            cur = currentPairCount(node);
        }
        dedupeLabels(node);
    }
    function applyAllInheritedLabels(node) {
        const use = upstreamAdvertisedLvl(node);
        const count = currentPairCount(node);
        for (let k = 1; k <= Math.min(count, use); k++) {
            const m = node.__inheritedMeta?.[k];
            if (m) rememberPairMeta(node, k, { label: (m.labelDisplay || m.label || m.type || ""), type: (m.type || "") });
        }
        for (let k = use + 1; k <= count; k++) if (isPairFree(node, k)) resetPairLabels(node, k);
        dedupeLabels(node);
    }

    // -------- cascade aval (multi-niveaux, Set/Get inclus)
    function broadcastDownstreamCascade(node) {
        const seen = new Set();
        let frontier = [node];
        const step = () => {
            const next = [];
            for (const src of frontier) {
                const kids = immediateDownstreamHubs(src);
                for (const dn of kids) {
                    if (seen.has(dn.id)) continue;
                    seen.add(dn.id);
                    refreshInheritedMeta(dn);
                    applyAllInheritedLabels(dn);
                    ensurePairCount(dn);
                    next.push(dn);
                }
            }
            if (next.length) { frontier = next; setTimeout(step, 0); }
        };
        setTimeout(step, 0);
    }

    // -------- FIX global (composante connexe)
    function collectConnectedHubs(root) {
        const set = new Set([root.id]);
        const q = [root];
        while (q.length) {
            const n = q.shift();
            const up = upstreamHub(n);
            if (up && !set.has(up.id)) { set.add(up.id); q.push(up); }
            immediateDownstreamHubs(n).forEach((k) => { if (!set.has(k.id)) { set.add(k.id); q.push(k); } });
        }
        return [...set].map((id) => root.graph.getNodeById(id)).filter(Boolean);
    }
    function topoOrder(hubs) {
        const id2 = new Map(hubs.map((h) => [h.id, h]));
        const indeg = new Map(hubs.map((h) => [h.id, 0]));
        const adj = new Map(hubs.map((h) => [h.id, []]));
        for (const h of hubs) {
            const dn = immediateDownstreamHubs(h).filter((k) => id2.has(k.id));
            adj.get(h.id).push(...dn.map((k) => k.id));
            dn.forEach((k) => indeg.set(k.id, indeg.get(k.id) + 1));
        }
        const q = []; indeg.forEach((v, id) => { if (v === 0) q.push(id); });
        const order = [];
        while (q.length) {
            const id = q.shift(); order.push(id2.get(id));
            for (const v of adj.get(id)) { const nv = indeg.get(v) - 1; indeg.set(v, nv); if (nv === 0) q.push(v); }
        }
        return order.length ? order : hubs;
    }
    function runFixFrom(root) {
        try {
            const hubs = collectConnectedHubs(root);
            const ordered = topoOrder(hubs);
            for (const h of ordered) sweepPorts(h);
            for (const h of ordered) { if (isPipeInConnected(h)) refreshInheritedMeta(h); applyAllInheritedLabels(h); ensurePairCount(h); }
            for (const h of ordered) { sweepPorts(h); dedupeLabels(h); h.setDirtyCanvas(true, true); }
        } catch (e) { console.warn("[PipeHub/Fix] error:", e); }
    }

    // -------- extension
    app.registerExtension({
        name: "Lightx02.PipeHub.UI.anyIO.v7.4",
        beforeRegisterNodeDef(nodeType, nodeData) {
            if (nodeData?.name !== HUB_CLASS) return;

            const onCreated = nodeType.prototype.onNodeCreated;
            const onConn = nodeType.prototype.onConnectionsChange;
            const onDraw = nodeType.prototype.onDrawForeground;
            const onMenu = nodeType.prototype.getExtraMenuOptions;

            nodeType.prototype.onNodeCreated = function () {
                this.title = TITLE;
                this.__pairMeta = this.__pairMeta || {};
                this.__inheritedMeta = this.__inheritedMeta || {};

                // bouton Fix
                this.addWidget?.("button", "Fix", null, () => runFixFrom(this));

                setTimeout(() => {
                    sweepPorts(this);
                    // purge visuelle > in2/out2 si vides
                    for (let k = MAX; k >= 3; k--) {
                        const iO = findOut(this, `out${k}`); if (iO >= 0 && ((this.outputs[iO]?.links?.length || 0) === 0)) this.removeOutput(iO);
                        const iI = findIn(this, `in${k}`); if (iI >= 0 && this.inputs[iI]?.link == null) this.removeInput(iI);
                    }
                    this.setSize(this.computeSize());
                    this.setDirtyCanvas(true, true);
                    ensurePairCount(this);
                }, 0);

                // cold start: quelques secondes pour rescanner (graph rechargé/F5, Set/Get déjà là)
                this.__coldTries = 7;
                this.__coldTimer = setInterval(() => {
                    if (!this.graph) { clearInterval(this.__coldTimer); return; }
                    if (isPipeInConnected(this)) { refreshInheritedMeta(this); applyAllInheritedLabels(this); ensurePairCount(this); }
                    const hasMeta = !!Object.keys(this.__pairMeta || {}).length;
                    if (--this.__coldTries <= 0 || hasMeta) clearInterval(this.__coldTimer);
                }, 450);

                if (onCreated) onCreated.apply(this, arguments);
            };

            nodeType.prototype.onRemoved = function () {
                if (this.__coldTimer) clearInterval(this.__coldTimer);
            };

            nodeType.prototype.getExtraMenuOptions = function (_, options) {
                options.push({ content: "Fix Pipe Network", callback: () => runFixFrom(this) });
                if (onMenu) onMenu.apply(this, arguments);
            };

            nodeType.prototype.onConnectionsChange = function (type, slotIndex) {
                const ret = onConn ? onConn.apply(this, arguments) : undefined;

                setTimeout(() => {
                    if (type === LiteGraph.INPUT) {
                        const s = this.inputs?.[slotIndex];
                        if (s?.name === "pipe_in") {
                            if (isPipeInConnected(this)) { refreshInheritedMeta(this); applyAllInheritedLabels(this); }
                            else { this.__inheritedMeta = {}; }
                            ensurePairCount(this);
                            // IMPORTANT: always cascade — Set/Get et multi-liens compris
                            broadcastDownstreamCascade(this);
                            return;
                        }
                    }

                    let idx = null;
                    if (type === LiteGraph.INPUT) {
                        const s = this.inputs?.[slotIndex]; const m = s?.name?.match?.(/^in(\d+)$/); if (m) idx = Number(m[1]);
                    } else if (type === LiteGraph.OUTPUT) {
                        const s = this.outputs?.[slotIndex]; const m = s?.name?.match?.(/^out(\d+)$/); if (m) idx = Number(m[1]);
                    }
                    if (idx != null) applyPairLabels(this, idx);

                    ensurePairCount(this);
                    broadcastDownstreamCascade(this);
                }, 0);

                return ret;
            };

            nodeType.prototype.onDrawForeground = function (ctx) {
                if (onDraw) onDraw.apply(this, arguments);
                const meta = this.__pairMeta || {};
                ctx.save();
                ctx.font = "12px sans-serif";
                for (let i = 0; i < (this.inputs?.length || 0); i++) {
                    const s = this.inputs[i]; const m = s?.name?.match?.(/^in(\d+)$/); if (!m) continue;
                    const idx = Number(m[1]); const info = meta[idx]; const label = info?.labelDisplay || info?.label;
                    if (!label) continue;
                    const p = this.getConnectionPos(true, i);
                    ctx.fillStyle = "rgba(32,33,36,0.8)";
                    ctx.fillRect(p[0] + 10, p[1] - 8, 140, 16);
                    ctx.fillStyle = "#e8eaed";
                    ctx.fillText(label, p[0] + 12, p[1] + 4);
                }
                for (let i = 0; i < (this.outputs?.length || 0); i++) {
                    const s = this.outputs[i]; const m = s?.name?.match?.(/^out(\d+)$/); if (!m) continue;
                    const idx = Number(m[1]); const info = meta[idx]; const label = info?.labelDisplay || info?.label;
                    if (!label) continue;
                    const p = this.getConnectionPos(false, i);
                    const tw = ctx.measureText(label).width;
                    ctx.fillStyle = "rgba(32,33,36,0.8)";
                    ctx.fillRect(p[0] - tw - 14, p[1] - 8, tw + 8, 16);
                    ctx.fillStyle = "#e8eaed";
                    ctx.fillText(label, p[0] - tw - 12, p[1] + 4);
                }
                ctx.restore();
            };
        },
    });

    // Sweep auto après chargement (F5)
    let bootDone = false;
    const boot = setInterval(() => {
        const g = app.graph;
        if (!g || !(g._nodes || g.nodes)) return;
        clearInterval(boot);
        if (bootDone) return;
        bootDone = true;
        setTimeout(() => {
            const hubs = (g._nodes || g.nodes || []).filter((n) => n && n.comfyClass === HUB_CLASS);
            hubs.forEach((h) => {
                try { // Fix depuis chaque hub (réseau local)
                    const list = (function collect(root) {
                        const seen = new Set([root.id]); const q = [root]; const acc = [];
                        while (q.length) {
                            const n = q.shift(); acc.push(n);
                            const up = upstreamHub(n); if (up && !seen.has(up.id)) { seen.add(up.id); q.push(up); }
                            immediateDownstreamHubs(n).forEach(k => { if (!seen.has(k.id)) { seen.add(k.id); q.push(k); } });
                        } return acc;
                    })(h);
                    const uniq = new Map(list.map(n => [n.id, n]));
                    const ordered = (function topo(nodes) {
                        const id2 = new Map(nodes.map(n => [n.id, n])); const indeg = new Map(nodes.map(n => [n.id, 0])); const adj = new Map(nodes.map(n => [n.id, []]));
                        for (const x of nodes) { const dn = immediateDownstreamHubs(x).filter(k => id2.has(k.id)); adj.get(x.id).push(...dn.map(k => k.id)); dn.forEach(k => indeg.set(k.id, indeg.get(k.id) + 1)); }
                        const q = []; indeg.forEach((v, id) => { if (v === 0) q.push(id); }); const order = []; while (q.length) { const id = q.shift(); order.push(id2.get(id)); for (const v of adj.get(id)) { const nv = indeg.get(v) - 1; indeg.set(v, nv); if (nv === 0) q.push(v); } }
                        return order.length ? order : nodes;
                    })([...uniq.values()]);
                    ordered.forEach(x => { sweepPorts(x); if (isPipeInConnected(x)) refreshInheritedMeta(x); applyAllInheritedLabels(x); ensurePairCount(x); sweepPorts(x); x.setDirtyCanvas(true, true); });
                } catch (e) { }
            });
        }, 700);
    }, 300);
})();
