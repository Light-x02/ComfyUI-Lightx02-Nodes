# -*- coding: utf-8 -*-

import os
import json
import torch
import comfy.model_management
import comfy.samplers
import comfy.sample
import node_helpers
from nodes import MAX_RESOLUTION

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
    """
    Flux Settings Pipe
    Produces both individual outputs and a bundled 'pipe' object.
    Field order in the middle UI:
    resolution, flip_orientation, batch_size, width_override, height_override,
    sampler_name, scheduler, steps, denoise, guidance, noise_seed
    Optional: model, conditioning
    """
    def __init__(self):
        self.device = comfy.model_management.intermediate_device()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "resolution": (
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
                "flip_orientation": ("BOOLEAN", {"default": False, "label_on": "Landscape", "label_off": "Portrait"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}),
                "width_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
                "height_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
                "sampler_name": (comfy.samplers.SAMPLER_NAMES, ),
                "scheduler": (comfy.samplers.SCHEDULER_NAMES, ),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "guidance": ("FLOAT", {"default": 3.5, "min": 0.0, "max": 100.0, "step": 0.1}),
                "noise_seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "model": ("MODEL", ),
                "conditioning": ("CONDITIONING", ),
            }
        }

    RETURN_TYPES = ("FLUX_PIPE", "LATENT", "INT", "INT", "SAMPLER", "SIGMAS", "NOISE", "INT", "CONDITIONING",)
    RETURN_NAMES  = ("pipe",      "LATENT","width","height","sampler","sigmas","noise","seed","conditioning",)
    FUNCTION = "execute"
    CATEGORY = "flux/utilities"

    def execute(
        self,
        resolution,
        flip_orientation=False,
        batch_size=1,
        width_override=0,
        height_override=0,
        sampler_name="euler",
        scheduler="karras",
        steps=20,
        denoise=1.0,
        guidance=3.5,
        model=None,
        conditioning=None,
        noise_seed=0,
    ):
        # Resolution
        width_str, height_str = resolution.split(" ")[0].split("x")
        width = width_override if width_override > 0 else int(width_str)
        height = height_override if height_override > 0 else int(height_str)
        if flip_orientation:
            width, height = height, width
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

        # Noise (for SamplerCustom*) and seed (for native KSampler)
        noise = _NoiseRandom(noise_seed)
        seed_out = int(noise_seed)

        # Flux guidance on conditioning
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
            "sigmas": sigmas,
            "noise": noise,
            "seed": seed_out,
            "conditioning": conditioning_out,
        }

        return (pipe, {"samples": latent}, width, height, sampler, sigmas, noise, seed_out, conditioning_out)


class FluxPipeUnpack:
    """
    Flux Pipe Unpack
    Unpacks a FLUX_PIPE into individual outputs in the same order:
    LATENT, width, height, SAMPLER, SIGMAS, NOISE, seed, CONDITIONING
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"pipe": ("FLUX_PIPE",)}}

    RETURN_TYPES = ("LATENT","INT","INT","SAMPLER","SIGMAS","NOISE","INT","CONDITIONING",)
    RETURN_NAMES  = ("LATENT","width","height","sampler","sigmas","noise","seed","conditioning",)
    FUNCTION = "unpack"
    CATEGORY = "flux/utilities"

    def unpack(self, pipe):
        latent = pipe.get("latent", {"samples": torch.zeros([1,4,64,64])})
        width = int(pipe.get("width", 0))
        height = int(pipe.get("height", 0))
        sampler = pipe.get("sampler", None)
        sigmas = pipe.get("sigmas", torch.FloatTensor([]))
        noise = pipe.get("noise", None)
        seed = int(pipe.get("seed", 0))
        conditioning = pipe.get("conditioning", None)
        return (latent, width, height, sampler, sigmas, noise, seed, conditioning)


# ---- Node mappings
NODE_CLASS_MAPPINGS = {
    "FluxSettingsPipe": FluxSettingsPipe,
    "FluxPipeUnpack": FluxPipeUnpack,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FluxSettingsPipe": "⚙️ Flux Settings Pipe",
    "FluxPipeUnpack": "📤 Flux Pipe Unpack",
}


# -------------------------------
# Presets API (JSON on disk)
# -------------------------------
PRESET_DIR = os.path.join(os.path.dirname(__file__), "presets")
PRESET_FILE = os.path.join(PRESET_DIR, "flux_presets.json")

def _ensure_preset_file():
    os.makedirs(PRESET_DIR, exist_ok=True)
    if not os.path.exists(PRESET_FILE):
        with open(PRESET_FILE, "w", encoding="utf-8") as f:
            json.dump({}, f, ensure_ascii=False, indent=2)

def _load_presets():
    _ensure_preset_file()
    with open(PRESET_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def _save_presets(data: dict):
    _ensure_preset_file()
    with open(PRESET_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# Register HTTP routes if available
if PromptServer and web and hasattr(PromptServer, "instance"):
    routes = PromptServer.instance.routes

    @routes.get("/extensions/flux-suite/presets")
    async def flux_list_presets(request):
        presets = _load_presets()
        items = [{"name": k, "payload": v} for k, v in presets.items()]
        return web.json_response({"presets": items})

    @routes.post("/extensions/flux-suite/presets/save")
    async def flux_save_preset(request):
        data = await request.json()
        name = data.get("name")
        payload = data.get("payload")
        if not name or not isinstance(payload, dict):
            return web.json_response({"ok": False, "error": "invalid payload"}, status=400)
        presets = _load_presets()
        presets[name] = payload
        _save_presets(presets)
        return web.json_response({"ok": True})

    @routes.post("/extensions/flux-suite/presets/delete")
    async def flux_delete_preset(request):
        data = await request.json()
        name = data.get("name")
        if not name:
            return web.json_response({"ok": False, "error": "missing name"}, status=400)
        presets = _load_presets()
        if name in presets:
            del presets[name]
            _save_presets(presets)
        return web.json_response({"ok": True})
