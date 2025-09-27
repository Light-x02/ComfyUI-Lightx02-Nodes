import numpy as np
from PIL import Image, ImageOps
import torch

Image.MAX_IMAGE_PIXELS = None

class CropImage:

    def __init__(self):
        self.crop_top = 0
        self.crop_bottom = 0
        self.crop_left = 0
        self.crop_right = 0
        self.rotation = 0.0

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "crop_top": ("INT", {"default": 0, "min": 0, "max": 5000, "step": 1}),
                "crop_bottom": ("INT", {"default": 0, "min": 0, "max": 5000, "step": 1}),
                "crop_left": ("INT", {"default": 0, "min": 0, "max": 5000, "step": 1}),
                "crop_right": ("INT", {"default": 0, "min": 0, "max": 5000, "step": 1}),
                "rotation": ("FLOAT", {"default": 0, "min": -180, "max": 180, "step": 1}),
            },
            "optional": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = 'auto_crop_images'
    CATEGORY = 'lightx02/utilities'

    def auto_crop_images(self, crop_top, crop_bottom, crop_left, crop_right, rotation, image=None, mask=None):
        def tensor2pil(tensor):
            return Image.fromarray((tensor.squeeze().cpu().numpy() * 255).astype(np.uint8))

        def pil2tensor(pil_img):
            return torch.from_numpy(np.array(pil_img)).float().div(255).unsqueeze(0)

        ret_images = []
        ret_masks = []

        if image is not None:
            for img_tensor in image:
                img_tensor = torch.unsqueeze(img_tensor, 0)
                img = tensor2pil(img_tensor)
                width, height = img.size

                # Crop avec valeurs en pixels
                left = crop_left
                right = width - crop_right
                top = crop_top
                bottom = height - crop_bottom

                img = img.crop((left, top, right, bottom))
                img = img.rotate(-rotation, expand=True, fillcolor=(255, 255, 255))

                ret_images.append(pil2tensor(img))

        if mask is not None:
            for mask_tensor in mask:
                mask_tensor = torch.unsqueeze(mask_tensor, 0)
                mask_img = tensor2pil(mask_tensor)
                width, height = mask_img.size

                left = crop_left
                right = width - crop_right
                top = crop_top
                bottom = height - crop_bottom

                mask_img = mask_img.crop((left, top, right, bottom))
                mask_img = mask_img.rotate(-rotation, expand=True, fillcolor=255)

                ret_masks.append(pil2tensor(mask_img))

        return (
            torch.cat(ret_images, dim=0) if ret_images else None,
            torch.cat(ret_masks, dim=0) if ret_masks else None
        )


NODE_CLASS_MAPPINGS = {
    "CropImage": CropImage
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CropImage": "Crop Image"
}
