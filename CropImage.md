# Crop Image

`CropImage` is a **ComfyUI** node that allows cropping an image (and optionally its mask) using **pixel values**.

## Features

- Crop from all 4 sides: `crop_top`, `crop_bottom`, `crop_left`, `crop_right`  
- Values are given directly in **pixels**  
- Supports images and masks  
- Optional **rotation** with automatic white fill (255 for masks)  
- No automatic resizing → output keeps the exact cropped size  

## Parameters

- **crop_top**: pixels to crop from the top  
- **crop_bottom**: pixels to crop from the bottom  
- **crop_left**: pixels to crop from the left  
- **crop_right**: pixels to crop from the right  
- **rotation**: rotation angle in degrees (clockwise), with expansion and white fill

## Returns

- **image**: the cropped (and rotated) image  
- **mask**: the cropped mask (if provided)

## Example usage

Crop an image of 2600×1104 to keep only the area `x=1352, y=136, width=1248, height=832`:  
- `crop_left = 1352`  
- `crop_right = 0`  
- `crop_top = 136`  
- `crop_bottom = 136`  

The output will be **1248×832 pixels**.

---

✦ Category: `lightx02`  
✦ Display name in ComfyUI: **Crop Image**

![Node preview](assets/CropImage.png)
