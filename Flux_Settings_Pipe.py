import os
import json
import torch
import comfy.model_management
import comfy.samplers
import comfy.sample
import node_helpers
try:
    from nodes import MAX_RESOLUTION
except Exception:
    MAX_RESOLUTION = 8192  # safe fallback if import fails

# Optional server imports (for presets API)
try:
    from aiohttp import web
    from server import PromptServer
except Exception:
    web = None
    PromptServer = None


class _NoiseRandom:
    def __init__(self, seed: int):
        self.seed = seed

    def generate_noise(self, input_latent):
        latent_image = input_latent["samples"]
        batch_inds = input_latent.get("batch_index", None)
        return comfy.sample.prepare_noise(latent_image, self.seed, batch_inds)


class FluxSettingsPipe:
    """Core settings pipe for Flux/SDXL. If this module fails to import, check server logs.
    """
    def __init__(self):
        self.device = comfy.model_management.intermediate_device()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # FLUX (Flux) square-ish/defaults
                "resolution_flux": (
                    [
                        "1056x2112 (0.5)","1056x2016 (0.52)","1152x2016 (0.57)","1152x1920 (0.6)",
                        "1248x1824 (0.68)","1248x1728 (0.72)","1344x1728 (0.78)","1344x1632 (0.82)",
                        "1440x1632 (0.88)","1440x1536 (0.94)","1536x1536 (1.0)","1536x1440 (1.07)",
                        "1632x1440 (1.13)","1632x1344 (1.21)","1728x1344 (1.29)","1728x1248 (1.38)",
                        "1824x1248 (1.46)","1920x1152 (1.67)","2016x1152 (1.75)","2016x1056 (1.91)",
                        "2112x1056 (2.0)","2208x1056 (2.09)","2304x960 (2.4)","2400x960 (2.5)",
                        "2496x864 (2.89)","2592x864 (3.0)",
                    ],
                    {"default": "1536x1536 (1.0)"}
                ),
                # Toggle Flux/SDXL (True->Flux, False->SDXL)
                "mode_resolution": ("BOOLEAN", {"default": True, "label_on": "Flux", "label_off": "SDXL"}),

                # SDXL typical set
                "resolution_sdxl": (
                    [
                        "704x1408 (0.5)","704x1344 (0.52)","768x1344 (0.57)","768x1280 (0.6)",
                        "832x1216 (0.68)","832x1152 (0.72)","896x1152 (0.78)","896x1088 (0.82)",
                        "960x1088 (0.88)","960x1024 (0.94)","1024x1024 (1.0)","1024x960 (1.07)",
                        "1088x960 (1.13)","1088x896 (1.21)","1152x896 (1.29)","1152x832 (1.38)",
                        "1216x832 (1.46)","1280x768 (1.67)","1344x768 (1.75)","1344x704 (1.91)",
                        "1408x704 (2.0)","1472x704 (2.09)","1536x640 (2.4)","1600x640 (2.5)",
                        "1664x576 (2.89)","1728x576 (3.0)",
                    ],
                    {"default": "1024x1024 (1.0)"}
                ),

                "flip_orientation": ("BOOLEAN", {"default": False, "label_on": "Swap W/H", "label_off": "Default"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}),
                "width_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
                "height_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
                "sampler_name": (comfy.samplers.SAMPLER_NAMES, ),
                "scheduler": (comfy.samplers.SCHEDULER_NAMES, ),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "guidance": ("FLOAT", {"default": 3.5, "min": 0.0, "max": 100.0, "step": 0.1}),
                "cfg": ("FLOAT", {"default": 4.5, "min": 0.0, "max": 30.0, "step": 0.1}),
                "noise_seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "model": ("MODEL", ),
                "conditioning": ("CONDITIONING", ),
            }
        }

    # Added cfg in outputs too
    RETURN_TYPES = ("FLUX_PIPE", "LATENT", "INT", "INT", "SAMPLER", "SIGMAS", "NOISE", "INT", "FLOAT", "CONDITIONING",)
    RETURN_NAMES  = ("pipe",      "LATENT","width","height","sampler","sigmas","noise","seed","cfg","conditioning",)
    FUNCTION = "execute"
    CATEGORY = "lightx02/utilities"

    def execute(
        self,
        resolution_flux,
        mode_resolution=True,   # True -> Flux, False -> SDXL
        resolution_sdxl="1024x1024 (1.0)",
        flip_orientation=False,
        batch_size=1,
        width_override=0,
        height_override=0,
        sampler_name="euler",
        scheduler="karras",
        steps=20,
        denoise=1.0,
        guidance=3.5,
        cfg=4.5,
        model=None,
        conditioning=None,
        noise_seed=0,
    ):
        # Pick active resolution by mode
        selected = resolution_flux if bool(mode_resolution) else resolution_sdxl
        width_str, height_str = selected.split(" ")[0].split("x")

        # Apply overrides
        width = width_override if width_override > 0 else int(width_str)
        height = height_override if height_override > 0 else int(height_str)

        # Flip orientation (swap W/H)
        if flip_orientation:
            width, height = height, width

        # Clamp
        width  = max(8, min(width,  MAX_RESOLUTION))
        height = max(8, min(height, MAX_RESOLUTION))

        # Empty latent
        latent = torch.zeros([batch_size, 4, height // 8, width // 8], device=self.device)

        # Sampler object
        sampler = comfy.samplers.sampler_object(sampler_name)

        # Scheduler sigmas
        sigmas = torch.FloatTensor([])
        if model is not None:
            total_steps = steps if denoise >= 1.0 else int(steps / denoise) if denoise > 0 else 0
            if total_steps > 0:
                model_sampling = model.get_model_object("model_sampling")
                sigmas = comfy.samplers.calculate_sigmas(model_sampling, scheduler, total_steps).cpu()
                if sigmas.shape[-1] >= (steps + 1):
                    sigmas = sigmas[-(steps + 1):]
        # Attach metadata to sigmas so it can be unpacked later (only what’s useful elsewhere)
        try:
            sigmas_out = sigmas.clone() if torch.is_tensor(sigmas) else torch.FloatTensor([])
            setattr(sigmas_out, "_meta", {
                "steps": int(steps),
                "denoise": float(denoise),
            })
        except Exception:
            sigmas_out = sigmas

        # Noise (for SamplerCustom*) and seed (for native KSampler)
        noise = _NoiseRandom(noise_seed)
        seed_out = int(noise_seed)

        # Flux guidance on conditioning (keep 'guidance' in cond values)
        if conditioning is not None:
            conditioning_out = node_helpers.conditioning_set_values(conditioning, {"guidance": float(guidance)})
        else:
            conditioning_out = conditioning

        # Bundle in pipe
        pipe = {
            "latent": {"samples": latent},
            "width": width,
            "height": height,
            "sampler": sampler,
            "sigmas": sigmas_out,
            "noise": noise,
            "seed": seed_out,
            "conditioning": conditioning_out,
            "cfg": float(cfg),
            "mode": ("FLUX" if bool(mode_resolution) else "SDXL"),
        }

        return (pipe, {"samples": latent}, width, height, sampler, sigmas_out, noise, seed_out, float(cfg), conditioning_out)


class FluxPipeUnpack:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"pipe": ("FLUX_PIPE",)}}

    RETURN_TYPES = ("FLUX_PIPE","LATENT","INT","INT","SAMPLER","SIGMAS","NOISE","INT","FLOAT","CONDITIONING",)
    RETURN_NAMES  = ("pipe","LATENT","width","height","sampler","sigmas","noise","seed","cfg","conditioning",)
    FUNCTION = "unpack"
    CATEGORY = "lightx02/utilities"

    def unpack(self, pipe):
        latent = pipe.get("latent", {"samples": torch.zeros([1,4,64,64])})
        width = int(pipe.get("width", 0))
        height = int(pipe.get("height", 0))
        sampler = pipe.get("sampler", None)
        sigmas = pipe.get("sigmas", torch.FloatTensor([]))
        noise = pipe.get("noise", None)
        seed = int(pipe.get("seed", 0))
        cfg = float(pipe.get("cfg", 0.0))
        conditioning = pipe.get("conditioning", None)
        return (pipe, latent, width, height, sampler, sigmas, noise, seed, cfg, conditioning)


# ---- Node mappings
NODE_CLASS_MAPPINGS = {
    "FluxSettingsPipe": FluxSettingsPipe,
    "FluxPipeUnpack": FluxPipeUnpack,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FluxSettingsPipe": "⚙️ Flux/Sdxl Settings Pipe",
    "FluxPipeUnpack": "📤 Settings Pipe Unpack",
}


# -------------------------------
# Presets API
# -------------------------------
import re

PRESET_DIR = os.path.join(os.path.dirname(__file__), "presets")
LEGACY_FILE = os.path.join(PRESET_DIR, "flux_presets.json")  # ancien format "tout-en-un"

def _ensure_preset_dir():
    os.makedirs(PRESET_DIR, exist_ok=True)

def _safe_name(name: str) -> str:
    # garde lettres/chiffres/espace/_-. ; remplace le reste par _
    name = (name or "").strip()
    name = re.sub(r"[^A-Za-z0-9 _.-]", "_", name)
    return name or "preset"

def _preset_path(name: str) -> str:
    _ensure_preset_dir()
    return os.path.join(PRESET_DIR, f"{_safe_name(name)}.json")

def _list_presets():
    _ensure_preset_dir()
    items = []
    for fn in os.listdir(PRESET_DIR):
        if not fn.lower().endswith(".json"):
            continue
        if fn == "flux_presets.json":  # ignorer l'ancien conteneur
            continue
        path = os.path.join(PRESET_DIR, fn)
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            payload = {}
        name = os.path.splitext(fn)[0]
        items.append({"name": name, "payload": payload})
    items.sort(key=lambda x: x["name"].lower())
    return items

def _save_preset(name: str, payload: dict):
    path = _preset_path(name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

def _delete_preset(name: str):
    path = _preset_path(name)
    if os.path.exists(path):
        os.remove(path)

def _migrate_legacy_file_if_any():
    """Si un ancien flux_presets.json (avec {name: payload}) existe,
    on migre chaque entrée dans son propre fichier, puis on renomme l'ancien."""
    try:
        if os.path.exists(LEGACY_FILE):
            with open(LEGACY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                for k, v in data.items():
                    if isinstance(v, dict):
                        _save_preset(k, v)
            # archiver l'ancien fichier pour ne plus le recharger
            os.rename(LEGACY_FILE, LEGACY_FILE + ".migrated.bak")
            print("[FluxSettingsPipe] migrated legacy flux_presets.json -> individual files")
    except Exception as e:
        print("[FluxSettingsPipe] legacy migration error:", e)

# Enregistrer les routes HTTP
if PromptServer and web and hasattr(PromptServer, "instance"):
    routes = PromptServer.instance.routes

    # Migration à l'import
    _ensure_preset_dir()
    _migrate_legacy_file_if_any()

    @routes.get("/extensions/flux-suite/presets")
    async def flux_list_presets(request):
        return web.json_response({"presets": _list_presets()})

    @routes.post("/extensions/flux-suite/presets/save")
    async def flux_save_preset(request):
        data = await request.json()
        name = data.get("name")
        payload = data.get("payload")
        if not name or not isinstance(payload, dict):
            return web.json_response({"ok": False, "error": "invalid payload"}, status=400)
        _save_preset(name, payload)
        return web.json_response({"ok": True})

    @routes.post("/extensions/flux-suite/presets/delete")
    async def flux_delete_preset(request):
        data = await request.json()
        name = data.get("name")
        if not name:
            return web.json_response({"ok": False, "error": "missing name"}, status=400)
        _delete_preset(name)
        return web.json_response({"ok": True})

