# Developed by Light-x02
# https://github.com/Light-x02/ComfyUI-Lightx02-Node

# === Latent-only node (Flux / SDXL) =========================================
import re
import torch
import comfy.model_management

try:
    from nodes import MAX_RESOLUTION
except Exception:
    MAX_RESOLUTION = 8192

DOWNSAMPLE = 8
LATENT_CHANNELS = 4

def _parse_wh(label: str) -> tuple[int, int]:
    m = re.match(r"\s*(\d+)\s*x\s*(\d+)", str(label or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (1024, 1024)

class LatentSettings:
    def __init__(self):
        self.device = comfy.model_management.intermediate_device()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # --- 1) Toggle d'abord
                "mode_resolution": ("BOOLEAN", {"default": True, "label_on": "Flux", "label_off": "SDXL"}),

                # --- 2) Listes de résolutions
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
                    {"default": "1536x1536 (1.0)"},
                ),
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
                    {"default": "1024x1024 (1.0)"},
                ),

                # --- 3) Options
                "flip_orientation": ("BOOLEAN", {"default": False, "label_on": "Swap W/H", "label_off": "Default"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}),
                "width_override":  ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
                "height_override": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 8}),
            }
        }

    RETURN_TYPES = ("LATENT", "INT", "INT")
    RETURN_NAMES = ("LATENT", "width", "height")
    FUNCTION = "build"
    CATEGORY = "💡Lightx02/latent"

    def build(
        self,
        mode_resolution: bool = True,                 # <-- d'abord dans la signature aussi
        resolution_flux: str = "1536x1536 (1.0)",
        resolution_sdxl: str = "1024x1024 (1.0)",
        flip_orientation: bool = False,
        batch_size: int = 1,
        width_override: int = 0,
        height_override: int = 0,
    ):
        label = resolution_flux if bool(mode_resolution) else resolution_sdxl
        base_w, base_h = _parse_wh(label)

        w = int(width_override) if width_override > 0 else int(base_w)
        h = int(height_override) if height_override > 0 else int(base_h)

        if bool(flip_orientation):
            w, h = h, w

        w = max(8, min(w, MAX_RESOLUTION))
        h = max(8, min(h, MAX_RESOLUTION))

        latent = torch.zeros([int(batch_size), LATENT_CHANNELS, h // DOWNSAMPLE, w // DOWNSAMPLE],
                             device=self.device)
        return ({"samples": latent}, int(w), int(h))


NODE_CLASS_MAPPINGS = {"LatentSettings": LatentSettings}
NODE_DISPLAY_NAME_MAPPINGS = {"LatentSettings": "❌ (OLD) Latent Settings (Flux/SDXL)"}