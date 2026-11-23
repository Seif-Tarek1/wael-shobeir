"""Generates the Android launcher icons, notification icon and splash resources.

Run from the project root:  python scripts/make_icons.py
Requires Pillow (only for the legacy PNG icons and the web/download-page icon).
"""
import math
import os
import glob

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

GREEN = "#1E4D3B"
GREEN_DARK = "#163A2C"
IVORY = "#F6F3EC"
GOLD = "#D4A63E"
GOLD_DEEP = "#B8862A"

# Geometry in the 108x108 adaptive-icon coordinate space (safe zone = centred 66 diameter).
BODY = (31, 35, 77, 79, 7)          # x0, y0, x1, y1, radius
HEADER_BOTTOM = 48
RINGS = [(41, 29.5, 45, 40, 2), (63, 29.5, 67, 40, 2)]
STAR_C, STAR_R, STAR_r = (54, 63.5), 10.5, 4.4


def star_points(cx, cy, R, r):
    pts = []
    for i in range(10):
        ang = math.radians(-90 + i * 36)
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    return pts


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def rrect_path(x0, y0, x1, y1, r):
    return (f"M{f(x0 + r)},{f(y0)} H{f(x1 - r)} A{f(r)},{f(r)} 0 0 1 {f(x1)},{f(y0 + r)} "
            f"V{f(y1 - r)} A{f(r)},{f(r)} 0 0 1 {f(x1 - r)},{f(y1)} H{f(x0 + r)} "
            f"A{f(r)},{f(r)} 0 0 1 {f(x0)},{f(y1 - r)} V{f(y0 + r)} A{f(r)},{f(r)} 0 0 1 {f(x0 + r)},{f(y0)} Z")


def header_path():
    x0, y0, x1, _, r = BODY
    return (f"M{f(x0)},{HEADER_BOTTOM} V{f(y0 + r)} A{f(r)},{f(r)} 0 0 1 {f(x0 + r)},{f(y0)} "
            f"H{f(x1 - r)} A{f(r)},{f(r)} 0 0 1 {f(x1)},{f(y0 + r)} V{HEADER_BOTTOM} Z")


def star_path():
    pts = star_points(*STAR_C, STAR_R, STAR_r)
    return "M" + " L".join(f"{f(x)},{f(y)}" for x, y in pts) + " Z"


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def vector(paths, size_dp=108, viewport=108):
    body = "\n".join(
        f'    <path android:fillColor="{c}"{" android:fillType=\"evenOdd\"" if eo else ""} android:pathData="{d}" />'
        for c, d, eo in paths)
    return (f'<?xml version="1.0" encoding="utf-8"?>\n'
            f'<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            f'    android:width="{size_dp}dp" android:height="{size_dp}dp"\n'
            f'    android:viewportWidth="{viewport}" android:viewportHeight="{viewport}">\n{body}\n</vector>\n')


def make_vectors():
    rings = " ".join(rrect_path(*r) for r in RINGS)
    fg = vector([
        (IVORY, rrect_path(*BODY), False),
        (GOLD, header_path(), False),
        (IVORY, rings, False),
        (GOLD_DEEP, star_path(), False),
    ])
    write(os.path.join(RES, "drawable", "ic_launcher_fg.xml"), fg)

    mono = vector([
        ("#FFFFFFFF", rrect_path(*BODY) + " " + star_path(), True),
        ("#FFFFFFFF", rings, False),
    ])
    write(os.path.join(RES, "drawable", "ic_launcher_mono.xml"), mono)

    notify = vector([
        ("#FFFFFFFF", "M12,2.8 L14.7,8.4 L20.8,9.2 L16.3,13.4 L17.4,19.5 L12,16.6 L6.6,19.5 L7.7,13.4 L3.2,9.2 L9.3,8.4 Z", False),
    ], size_dp=24, viewport=24)
    write(os.path.join(RES, "drawable", "ic_stat_notify.xml"), notify)

    adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@color/ic_launcher_background" />\n'
                '    <foreground android:drawable="@drawable/ic_launcher_fg" />\n'
                '    <monochrome android:drawable="@drawable/ic_launcher_mono" />\n'
                '</adaptive-icon>\n')
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        write(os.path.join(RES, "mipmap-anydpi-v26", name), adaptive)

    write(os.path.join(RES, "values", "ic_launcher_background.xml"),
          '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
          f'    <color name="ic_launcher_background">{GREEN}</color>\n'
          f'    <color name="splash_background">{GREEN}</color>\n'
          f'    <color name="colorPrimary">{GREEN}</color>\n'
          f'    <color name="colorPrimaryDark">{GREEN_DARK}</color>\n'
          f'    <color name="colorAccent">{GOLD}</color>\n'
          '</resources>\n')


def draw_icon(px, shape):
    """Legacy (pre-Android 8) launcher icon, drawn at 4x and downsampled for smooth edges."""
    S = px * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = S * 0.04
    if shape == "round":
        d.ellipse([m, m, S - m, S - m], fill=GREEN)
    elif shape == "square":
        d.rounded_rectangle([m, m, S - m, S - m], radius=S * 0.22, fill=GREEN)
    else:  # full bleed (web / download page)
        d.rounded_rectangle([0, 0, S, S], radius=S * 0.22, fill=GREEN)
    scale = S / 72.0                     # show the 18..90 region of the 108 grid
    T = lambda x, y: ((x - 18) * scale, (y - 18) * scale)
    x0, y0, x1, y1, r = BODY
    d.rounded_rectangle([*T(x0, y0), *T(x1, y1)], radius=r * scale, fill=IVORY)
    d.rounded_rectangle([*T(x0, y0), *T(x1, HEADER_BOTTOM + r)], radius=r * scale, fill=GOLD)
    d.rectangle([*T(x0, HEADER_BOTTOM), *T(x1, HEADER_BOTTOM + r + 1)], fill=IVORY)
    for rx0, ry0, rx1, ry1, rr in RINGS:
        d.rounded_rectangle([*T(rx0, ry0), *T(rx1, ry1)], radius=rr * scale, fill=IVORY)
    d.polygon([T(x, y) for x, y in star_points(*STAR_C, STAR_R, STAR_r)], fill=GOLD_DEEP)
    return img.resize((px, px), Image.LANCZOS)


def make_pngs():
    sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for dpi, px in sizes.items():
        folder = os.path.join(RES, f"mipmap-{dpi}")
        os.makedirs(folder, exist_ok=True)
        draw_icon(px, "square").save(os.path.join(folder, "ic_launcher.png"), optimize=True)
        draw_icon(px, "round").save(os.path.join(folder, "ic_launcher_round.png"), optimize=True)
        stale = os.path.join(folder, "ic_launcher_foreground.png")
        if os.path.exists(stale):
            os.remove(stale)
    docs = os.path.join(ROOT, "docs")
    os.makedirs(docs, exist_ok=True)
    draw_icon(512, "full").save(os.path.join(docs, "icon.png"), optimize=True)


def remove_template_art():
    # Capacitor's default splash images and launcher art are replaced by the resources above.
    for p in glob.glob(os.path.join(RES, "drawable*", "splash.png")):
        os.remove(p)
    for p in (os.path.join(RES, "drawable-v24", "ic_launcher_foreground.xml"),
              os.path.join(RES, "drawable", "ic_launcher_background.xml")):
        if os.path.exists(p):
            os.remove(p)
    for folder in glob.glob(os.path.join(RES, "drawable-*")):
        if os.path.isdir(folder) and not os.listdir(folder):
            os.rmdir(folder)


if __name__ == "__main__":
    remove_template_art()
    make_vectors()
    make_pngs()
    print("Icons generated.")
