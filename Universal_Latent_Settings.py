# ----- SECTION: Imports -----
import os
import re
import torch
import comfy.model_management

try:
    from nodes import MAX_RESOLUTION
except Exception:
    MAX_RESOLUTION = 8192


# ----- SECTION: Web Directory -----
WEB_DIRECTORY = os.path.join(os.path.dirname(__file__), "web")


# ----- SECTION: Constants -----
DOWNSAMPLE = 8
LATENT_CHANNELS = 4

MODEL_CHOICES = ["FLUX", "SDXL", "Z-image (1024)", "Z-image (1280)", "Z-image (1536)"]

SDXL_CHOICES = [
    "704x1408 (0.5)","704x1344 (0.52)","768x1344 (0.57)","768x1280 (0.6)",
    "832x1216 (0.68)","832x1152 (0.72)","896x1152 (0.78)","896x1088 (0.82)",
    "960x1088 (0.88)","960x1024 (0.94)","1024x1024 (1.0)","1024x960 (1.07)",
    "1088x960 (1.13)","1088x896 (1.21)","1152x896 (1.29)","1152x832 (1.38)",
    "1216x832 (1.46)","1280x768 (1.67)","1344x768 (1.75)","1344x704 (1.91)",
    "1408x704 (2.0)","1472x704 (2.09)","1536x640 (2.4)","1600x640 (2.5)",
    "1664x576 (2.89)","1728x576 (3.0)",
]

FLUX_CHOICES = [
    "1056x2112 (0.5)","1056x2016 (0.52)","1152x2016 (0.57)","1152x1920 (0.6)",
    "1248x1824 (0.68)","1248x1728 (0.72)","1344x1728 (0.78)","1344x1632 (0.82)",
    "1440x1632 (0.88)","1440x1536 (0.94)","1536x1536 (1.0)","1536x1440 (1.07)",
    "1632x1440 (1.13)","1632x1344 (1.21)","1728x1344 (1.29)","1728x1248 (1.38)",
    "1824x1248 (1.46)","1920x1152 (1.67)","2016x1152 (1.75)","2016x1056 (1.91)",
    "2112x1056 (2.0)","2208x1056 (2.09)","2304x960 (2.4)","2400x960 (2.5)",
    "2496x864 (2.89)","2592x864 (3.0)",
]

ZIMAGE_CHOICES = {
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
}

ZIMAGE_ALL = []
for k in ["1024", "1280", "1536"]:
    for v in ZIMAGE_CHOICES.get(k, []):
        if v not in ZIMAGE_ALL:
            ZIMAGE_ALL.append(v)

RES_ALL = []
for v in FLUX_CHOICES + SDXL_CHOICES + ZIMAGE_ALL:
    if v not in RES_ALL:
        RES_ALL.append(v)

DEFAULTS = {
    "FLUX": "1536x1536 (1.0)",
    "SDXL": "1024x1024 (1.0)",
    "Z-image (1024)": "1024x1024 ( 1:1 )",
    "Z-image (1280)": "1280x1280 ( 1:1 )",
    "Z-image (1536)": "1536x1536 ( 1:1 )",
}


# ----- SECTION: Helpers -----
def _parse_wh(label: str) -> tuple[int, int]:
    m = re.match(r"\s*(\d+)\s*x\s*(\d+)", str(label or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (1024, 1024)

def _clamp_int(v: int, lo: int, hi: int) -> int:
    return max(lo, min(int(v), hi))

def _round_down_to_multiple(v: int, m: int) -> int:
    return int(v) - (int(v) % int(m))

def _allowed_for_model(model_resolution: str) -> list[str]:
    m = str(model_resolution or "").strip()
    if m == "FLUX":
        return FLUX_CHOICES
    if m == "SDXL":
        return SDXL_CHOICES
    if m == "Z-image (1024)":
        return ZIMAGE_CHOICES["1024"]
    if m == "Z-image (1280)":
        return ZIMAGE_CHOICES["1280"]
    if m == "Z-image (1536)":
        return ZIMAGE_CHOICES["1536"]
    return ZIMAGE_CHOICES["1024"]


# ----- SECTION: Node -----
class UniversalLatentSettings:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_resolution": (MODEL_CHOICES, {"default": "Z-image (1024)"}),
                "resolution": (RES_ALL, {"default": DEFAULTS["Z-image (1024)"]}),
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
        model_resolution: str = "Z-image (1024)",
        resolution: str = "1024x1024 ( 1:1 )",
        flip_orientation: bool = False,
        batch_size: int = 1,
        width_override: int = 0,
        height_override: int = 0,
    ):
        allowed = _allowed_for_model(model_resolution)

        if resolution in allowed:
            chosen = resolution
        else:
            chosen = DEFAULTS.get(str(model_resolution).strip(), DEFAULTS["Z-image (1024)"])
            if chosen not in allowed and allowed:
                chosen = allowed[0]

        base_w, base_h = _parse_wh(chosen)

        w = int(width_override) if int(width_override) > 0 else int(base_w)
        h = int(height_override) if int(height_override) > 0 else int(base_h)

        if bool(flip_orientation):
            w, h = h, w

        w = _clamp_int(w, 8, MAX_RESOLUTION)
        h = _clamp_int(h, 8, MAX_RESOLUTION)

        w = max(8, _round_down_to_multiple(w, DOWNSAMPLE))
        h = max(8, _round_down_to_multiple(h, DOWNSAMPLE))

        device = comfy.model_management.intermediate_device()
        latent = torch.zeros([int(batch_size), LATENT_CHANNELS, h // DOWNSAMPLE, w // DOWNSAMPLE], device=device)

        return ({"samples": latent}, int(w), int(h))


# ----- SECTION: Mappings -----
NODE_CLASS_MAPPINGS = {"UniversalLatentSettings": UniversalLatentSettings}
NODE_DISPLAY_NAME_MAPPINGS = {"UniversalLatentSettings": "🧱 Universal Latent Settings"}
