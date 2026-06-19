"""Generate PWA app icons for 邪王真翔的背单词小工具"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = "static/icons"
os.makedirs(OUT_DIR, exist_ok=True)

SIZES = {
    "icon-72.png": 72,
    "icon-96.png": 96,
    "icon-128.png": 128,
    "icon-144.png": 144,
    "icon-152.png": 152,
    "icon-192.png": 192,
    "icon-384.png": 384,
    "icon-512.png": 512,
    "apple-touch-icon.png": 180,
    "apple-touch-icon-120.png": 120,
    "apple-touch-icon-152.png": 152,
    "apple-touch-icon-167.png": 167,
}


def create_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded rect background - dark gradient approximation
    # Outer dark bg
    margin = size // 16
    r = size // 5

    # Draw rounded rectangle background
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=r,
        fill=(15, 15, 35, 255)
    )

    # Inner gradient accent circle
    cx, cy = size // 2, size // 2
    inner_r = size // 3
    # Draw radial gradient approximation with concentric circles
    for i in range(inner_r, 0, -1):
        ratio = i / inner_r
        r_val = int(99 + (15 - 99) * ratio)
        g_val = int(102 + (15 - 102) * ratio)
        b_val = int(241 + (35 - 241) * ratio)
        alpha = int(255 * (1 - ratio * 0.5))
        draw.ellipse(
            [cx - i, cy - i, cx + i, cy + i],
            fill=(r_val, g_val, b_val, alpha)
        )

    # Draw "词" character in the center
    font_size = size // 3
    try:
        # Try system fonts
        for font_name in [
            "C:\\Windows\\Fonts\\msyh.ttc",
            "C:\\Windows\\Fonts\\simhei.ttf",
            "C:\\Windows\\Fonts\\simsun.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        ]:
            if os.path.exists(font_name):
                font = ImageFont.truetype(font_name, font_size)
                break
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "词", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = cx - tw // 2
    ty = cy - th // 2 - size // 20
    draw.text((tx, ty), "词", fill=(255, 255, 255, 255), font=font)

    # Small decorative dots
    dot_r = max(2, size // 40)
    for angle_deg in [30, 150, 270]:
        import math
        angle = math.radians(angle_deg)
        dx = int((inner_r + size // 10) * math.cos(angle))
        dy = int((inner_r + size // 10) * math.sin(angle))
        draw.ellipse(
            [cx + dx - dot_r, cy + dy - dot_r, cx + dx + dot_r, cy + dy + dot_r],
            fill=(129, 140, 248, 200)
        )

    return img


for filename, size in SIZES.items():
    print(f"Generating {filename} ({size}x{size})...")
    icon = create_icon(size)
    icon.save(os.path.join(OUT_DIR, filename), "PNG")
    print(f"  Saved")

print("\nAll icons generated in static/icons/")

# Also create a favicon.ico (32x32)
favicon = create_icon(32)
favicon.save(os.path.join("static", "favicon.ico"), "ICO", sizes=[(32, 32)])
print("Saved favicon.ico")
