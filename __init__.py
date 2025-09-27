# Auto-discovery of node modules for ComfyUI by Light-x02
# Scans this package directory and imports every .py (except __init__.py)
# Then merges NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS.

import os
import importlib

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Optional: skip some modules by name (without .py)
SKIP_MODULES = set({
    # "experimental_node",  # example
})

def _safe_import(module_name):
    try:
        return importlib.import_module(f"{__name__}.{module_name}")
    except Exception as e:
        print(f"[custom_nodes] Import failed for {module_name}: {e}")
        return None

def _discover_modules():
    pkg_dir = os.path.dirname(__file__)
    mods = []
    for fname in os.listdir(pkg_dir):
        # include plain .py files; ignore __init__.py and hidden/dunder files
        if not fname.endswith(".py"):
            continue
        if fname == "__init__.py":
            continue
        if fname.startswith("_"):
            continue
        mod_name = fname[:-3]
        if mod_name in SKIP_MODULES:
            continue
        mods.append(mod_name)
    # deterministic order
    mods.sort()
    return mods

for mod_name in _discover_modules():
    mod = _safe_import(mod_name)
    if not mod:
        continue
    NODE_CLASS_MAPPINGS.update(getattr(mod, "NODE_CLASS_MAPPINGS", {}))
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(mod, "NODE_DISPLAY_NAME_MAPPINGS", {}))

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
