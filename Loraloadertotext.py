# ----- SECTION: Imports -----
import hashlib
import json
import os
from typing import Any, Dict, List, Optional, Tuple

import folder_paths


# ----- SECTION: Constants -----
HASH_PREFIX_LEN = 10
METADATA_FILENAME = "lora_gallery_metadata.json"

_METADATA_PATH_CACHE: Optional[str] = None
_METADATA_CACHE: Optional[Dict[str, Any]] = None
_LORA_INDEX_CACHE: Optional[Dict[str, str]] = None


# ----- SECTION: Helpers -----
def _find_metadata_file() -> Optional[str]:
    global _METADATA_PATH_CACHE
    if _METADATA_PATH_CACHE is not None:
        return _METADATA_PATH_CACHE

    base = getattr(folder_paths, "base_path", None)
    if not base:
        _METADATA_PATH_CACHE = None
        return None

    custom_nodes_dir = os.path.join(base, "custom_nodes")
    if not os.path.isdir(custom_nodes_dir):
        _METADATA_PATH_CACHE = None
        return None

    for root, _dirs, files in os.walk(custom_nodes_dir):
        if METADATA_FILENAME in files:
            _METADATA_PATH_CACHE = os.path.join(root, METADATA_FILENAME)
            return _METADATA_PATH_CACHE

    _METADATA_PATH_CACHE = None
    return None


def _load_metadata() -> Dict[str, Any]:
    global _METADATA_CACHE
    if _METADATA_CACHE is not None:
        return _METADATA_CACHE

    path = _find_metadata_file()
    if not path or not os.path.exists(path):
        _METADATA_CACHE = {}
        return _METADATA_CACHE

    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        data = json.loads(content) if content else {}
        _METADATA_CACHE = data if isinstance(data, dict) else {}
    except Exception:
        _METADATA_CACHE = {}

    return _METADATA_CACHE


def _save_metadata(metadata: Dict[str, Any]) -> None:
    path = _find_metadata_file()
    if not path:
        return
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=4, ensure_ascii=False)
    except Exception:
        return


def _strip_ext(name: str) -> str:
    n = (name or "").strip()
    if not n:
        return ""
    base = os.path.basename(n.replace("\\", "/"))
    base_no_ext, _ = os.path.splitext(base)
    return base_no_ext.strip()


def _format_strength(v: Any) -> str:
    try:
        x = float(v)
    except Exception:
        x = 1.0
    s = f"{x:.6f}".rstrip("0").rstrip(".")
    return s if s else "0"


def calculate_sha256_prefix(filepath: str) -> Optional[str]:
    if not os.path.exists(filepath):
        return None
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            sha256_hash.update(chunk)
    return sha256_hash.hexdigest()[:HASH_PREFIX_LEN]


def _build_lora_index() -> Dict[str, str]:
    global _LORA_INDEX_CACHE
    if _LORA_INDEX_CACHE is not None:
        return _LORA_INDEX_CACHE

    idx: Dict[str, str] = {}
    try:
        files = folder_paths.get_filename_list("loras")
    except Exception:
        files = []

    for fn in files:
        base = _strip_ext(fn).lower()
        if base and base not in idx:
            idx[base] = fn

    _LORA_INDEX_CACHE = idx
    return _LORA_INDEX_CACHE


def _resolve_lora_filename(lora_name: str) -> Optional[str]:
    if not lora_name:
        return None

    direct = folder_paths.get_full_path("loras", lora_name)
    if direct:
        return lora_name

    base = _strip_ext(lora_name).lower()
    if not base:
        return None

    idx = _build_lora_index()
    mapped = idx.get(base)
    if mapped:
        return mapped

    return None


def _hash_from_metadata_entry(entry: Any) -> str:
    if not isinstance(entry, dict):
        return ""
    h = entry.get("hash")
    if not isinstance(h, str) or not h.strip():
        return ""
    hs = h.strip()
    if len(hs) >= HASH_PREFIX_LEN:
        return hs[:HASH_PREFIX_LEN].upper()
    return hs.upper()


def _lookup_hash(metadata: Dict[str, Any], lora_name: str) -> str:
    if not isinstance(metadata, dict) or not lora_name:
        return ""

    candidates: List[str] = []
    candidates.append(lora_name)
    candidates.append(_strip_ext(lora_name))

    resolved = _resolve_lora_filename(lora_name)
    if resolved:
        candidates.append(resolved)
        candidates.append(_strip_ext(resolved))

    for key in candidates:
        entry = metadata.get(key)
        h = _hash_from_metadata_entry(entry)
        if h:
            return h

    return ""


def _get_or_compute_hash(metadata: Dict[str, Any], lora_name: str) -> str:
    existing = _lookup_hash(metadata, lora_name)
    if existing:
        return existing

    resolved = _resolve_lora_filename(lora_name)
    if not resolved:
        return ""

    full_path = folder_paths.get_full_path("loras", resolved)
    if not full_path:
        return ""

    computed = calculate_sha256_prefix(full_path)
    if not computed:
        return ""

    computed_store = computed
    computed_out = computed.upper()

    if isinstance(metadata, dict):
        entry_key = resolved
        if entry_key not in metadata or not isinstance(metadata.get(entry_key), dict):
            metadata[entry_key] = {}
        metadata[entry_key]["hash"] = computed_store
        _save_metadata(metadata)

    return computed_out


def _get_node(prompt: Dict[str, Any], node_id: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(prompt, dict):
        return None
    return prompt.get(str(node_id))


def _get_upstream_node_id_from_model_input(prompt: Dict[str, Any], this_node_id: Any) -> Optional[str]:
    node = _get_node(prompt, this_node_id)
    if not node:
        return None
    inputs = node.get("inputs") or {}
    model_in = inputs.get("model")
    if isinstance(model_in, (list, tuple)) and len(model_in) >= 1:
        return str(model_in[0])
    return None


def _is_rgthree_power_lora_loader(class_type: str) -> bool:
    ct = (class_type or "").strip()
    if not ct:
        return False
    lowered = ct.lower()
    if lowered == "rgthreepowerloraloader":
        return True
    if lowered == "power lora loader":
        return True
    if "power" in lowered and "lora" in lowered and "loader" in lowered:
        return True
    return False


def _extract_configs_from_rgthree_node(prompt_node: Dict[str, Any]) -> List[Dict[str, Any]]:
    inputs = prompt_node.get("inputs") or {}
    result: List[Dict[str, Any]] = []

    for name, value in inputs.items():
        if not isinstance(name, str):
            continue
        if not name.startswith("lora_"):
            continue
        if not isinstance(value, dict):
            continue
        if not value.get("on", False):
            continue
        if "lora" not in value or "strength" not in value:
            continue

        lora_name = value.get("lora")
        if not isinstance(lora_name, str) or not lora_name.strip():
            continue

        strength = value.get("strength", 1.0)
        result.append(
            {
                "on": True,
                "lora": lora_name.strip(),
                "strength": float(strength) if isinstance(strength, (int, float, str)) else 1.0,
            }
        )

    return result


def _extract_selection_data_from_local_lora_gallery(prompt_node: Dict[str, Any]) -> str:
    inputs = prompt_node.get("inputs") or {}
    sel = inputs.get("selection_data")
    if isinstance(sel, str) and sel.strip():
        return sel
    return "[]"


def _extract_loras_from_upstream(prompt: Dict[str, Any], node_id: str) -> List[Dict[str, Any]]:
    node = _get_node(prompt, node_id)
    if not node:
        return []

    class_type = str(node.get("class_type") or "")

    if class_type in {"LocalLoraGallery", "LocalLoraGalleryModelOnly"}:
        selection_data = _extract_selection_data_from_local_lora_gallery(node)
        try:
            configs = json.loads(selection_data) if selection_data else []
        except Exception:
            configs = []
        return configs if isinstance(configs, list) else []

    if _is_rgthree_power_lora_loader(class_type):
        return _extract_configs_from_rgthree_node(node)

    inputs = node.get("inputs") or {}
    nxt = inputs.get("model")
    if isinstance(nxt, (list, tuple)) and len(nxt) >= 1:
        return _extract_loras_from_upstream(prompt, str(nxt[0]))

    return []


# ----- SECTION: Node -----
class Loraloadertotext:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "prompt": "PROMPT",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "extract"
    CATEGORY = "💡Lightx02/Metadata"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def extract(self, model, unique_id=None, prompt=None) -> Tuple[str]:
        if not isinstance(prompt, dict) or unique_id is None:
            return ("",)

        upstream_id = _get_upstream_node_id_from_model_input(prompt, unique_id)
        if not upstream_id:
            return ("",)

        configs = _extract_loras_from_upstream(prompt, upstream_id)
        if not isinstance(configs, list):
            configs = []

        metadata = _load_metadata()

        out_lines: List[str] = []
        for cfg in configs:
            if not isinstance(cfg, dict):
                continue
            if not cfg.get("on", True):
                continue

            lora_name = cfg.get("lora") or cfg.get("name")
            if not isinstance(lora_name, str) or not lora_name.strip():
                continue

            strength = _format_strength(cfg.get("strength", 1.0))
            if strength in {"0", "0.0"}:
                continue

            h = _get_or_compute_hash(metadata, lora_name) or "UNKNOWN"
            display_name = _strip_ext(lora_name)
            out_lines.append(f"{display_name}: {h}:{strength},")

        return ("\n".join(out_lines),)


# ----- SECTION: Registration -----
NODE_CLASS_MAPPINGS = {
    "Loraloadertotext": Loraloadertotext,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Loraloadertotext": "📄 LoRA Loader → Selected LoRAs (Text)",
}