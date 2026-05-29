#!/usr/bin/env python3
"""Genereer een looping MegaMinnie GIF: zijaanzicht, horizontale vlucht, wapperende cape."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import remove
from scipy.ndimage import binary_dilation, convolve, distance_transform_edt, gaussian_filter, map_coordinates


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "images" / "megaminnie-side.png"
CITYSCAPE_BG = ROOT / "public" / "images" / "megaminnie-cityscape-bg.png"
OUTPUT = ROOT / "public" / "images" / "megaminnie-animated.gif"
WEB_OUTPUT = ROOT / "public" / "images" / "megaminnie-animated-web.gif"
WEB_WIDTH = 395

FPS = 30
DURATION_SEC = 2.0
MOTION_BLUR = 8
CAPE_AMP_X = 42.0  # horizontale rimpels
CAPE_AMP_Y = 2.0  # minimaal op/neer
CAPE_SHIFT_X = 16.0  # duidelijke heen/weer-beweging (zichtbaar in GIF)
FLY_SCALE = 0.76
CITY_BG_ZOOM = 1.0  # externe skyline-foto vult het canvas
CUTOUT_CACHE = ROOT / "public" / "images" / "_megaminnie-cutout-cache.png"


def fit_city_background_zoomed(bg: np.ndarray, zoom: float) -> np.ndarray:
    """Zoom stad uit zodat gebouwen kleiner en beter zichtbaar zijn."""
    h, w, _ = bg.shape
    if zoom >= 0.999:
        return bg

    target_w = max(1, int(round(w * zoom)))
    target_h = max(1, int(round(h * zoom)))
    small = np.array(
        Image.fromarray(bg, "RGB").resize((target_w, target_h), Image.Resampling.LANCZOS)
    )

    top = max(8, h // 8)
    sky = np.median(bg[:top], axis=(0, 1)).astype(np.uint8)
    out = np.broadcast_to(sky, (h, w, 3)).copy()
    y0 = h - target_h
    x0 = (w - target_w) // 2
    out[y0 : y0 + target_h, x0 : x0 + target_w] = small
    return out


WEB_SUBJECT_PAD_LEFT = 84
WEB_SUBJECT_PAD_RIGHT = 118
WEB_SUBJECT_PAD_TOP = 58
WEB_SUBJECT_PAD_BOTTOM = 58
LEVEL_ANGLE = -14.0  # bron licht schuin → horizontaal in beeld (geen zijaanzicht-kanteling)
CAPE_PHASE_SPEED = 3.15


def load_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def rgba_to_np(img: Image.Image) -> np.ndarray:
    return np.array(img, dtype=np.uint8)


def prepare_foreground(
    fg: np.ndarray,
    scale: float = FLY_SCALE,
    level_angle: float = LEVEL_ANGLE,
) -> np.ndarray:
    """Schaal en optioneel rechtleggen (vlucht horizontaal, geen kanteling)."""
    img = Image.fromarray(fg, "RGBA")
    w, h = img.size
    if scale != 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    if level_angle != 0.0:
        img = img.rotate(level_angle, resample=Image.Resampling.BICUBIC, expand=True)
    return rgba_to_np(img)


def expand_character_mask(alpha: np.ndarray, *, dilate_px: int = 10) -> np.ndarray:
    """Maskeer ruimer dan het cutout zodat geen bron-silhouet achterblijft."""
    mask = alpha > 20
    if dilate_px > 0:
        mask = binary_dilation(mask, iterations=dilate_px)
    return mask


def synthesize_sky_background(original: np.ndarray, char_mask: np.ndarray) -> np.ndarray:
    """Vervang personage door lucht — strak masker, minimale vervaging."""
    h, w, _ = original.shape
    char = char_mask if char_mask.dtype == bool else char_mask > 0
    if not char.any():
        return original.copy()

    out = original.copy().astype(np.float32)

    top = max(8, h // 8)
    ref_region = np.zeros((h, w), dtype=bool)
    ref_region[:top, :] = True
    ref = ref_region & ~char
    if ref.sum() < 64:
        ref = ~char
    fallback_sky = np.median(original[ref], axis=0) if ref.any() else np.array([132.0, 186.0, 226.0])

    for x in range(w):
        clear_rows = np.where(~char[:, x])[0]
        if clear_rows.size:
            sky_row = clear_rows[0]
            sky_col = original[sky_row, x].astype(np.float32)
        else:
            sky_col = fallback_sky

        for y in range(h):
            if not char[y, x]:
                continue
            grad = 1.0 - 0.1 * (y / max(h - 1, 1))
            out[y, x] = np.clip(sky_col * grad, 0, 255)

    softened = gaussian_filter(char.astype(np.float32), sigma=1.2) > 0.35
    blurred = gaussian_filter(out, sigma=1.5)
    for c in range(3):
        out[:, :, c] = np.where(softened, blurred[:, :, c], out[:, :, c])

    return np.clip(out, 0, 255).astype(np.uint8)


def character_removal_mask(original_rgb: np.ndarray, character_alpha: np.ndarray) -> np.ndarray:
    """Minimaal masker voor scrolltegel — alleen cutout + directe roze/wit sporen."""
    rembg_mask = character_alpha > 20
    if not rembg_mask.any():
        return rembg_mask

    rembg_dilated = binary_dilation(rembg_mask, iterations=3)

    rgb = original_rgb.astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    pink = (r > 135) & (r > g * 1.06) & (g < 195)
    white_suit = (r > 198) & (g > 198) & (b > 198)
    character_colors = binary_dilation(rembg_mask, iterations=2) & (pink | white_suit)

    return rembg_dilated | character_colors


def fill_buildings_from_source_strip(
    original: np.ndarray,
    mask: np.ndarray,
    *,
    strip_start_ratio: float = 0.52,
) -> np.ndarray:
    """Vul masker met levendige gebouw-kleuren uit onderste strook van de bron."""
    h, w, _ = original.shape
    strip_y0 = int(h * strip_start_ratio)
    if strip_y0 >= h - 1:
        return inpaint_background(original, np.where(mask, 255, 0).astype(np.uint8))

    out = original.copy()
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return out

    for x in np.unique(xs):
        col_mask = mask[:, x]
        strip_col = original[strip_y0:, x, :].astype(np.float32)
        if strip_col.size == 0:
            continue

        sr, sg, sb = strip_col[:, 0], strip_col[:, 1], strip_col[:, 2]
        mx = np.maximum(np.maximum(sr, sg), sb)
        mn = np.minimum(np.minimum(sr, sg), sb)
        sat = np.divide(mx - mn, mx, out=np.zeros_like(mx), where=mx > 8)
        vivid = sat >= 0.08
        if vivid.any():
            palette = strip_col[vivid]
            order = np.argsort(-sat[vivid])
            palette = palette[order[: max(12, len(palette) // 3)]]
        else:
            palette = strip_col[:: max(1, len(strip_col) // 6)]

        col_ys = np.where(col_mask)[0]
        for i, y in enumerate(col_ys):
            out[y, x] = palette[i % len(palette)]

    return np.clip(out, 0, 255).astype(np.uint8)


def polish_building_background(bg: np.ndarray) -> np.ndarray:
    """Vervang vlak grijs in onderste helft door gebouw-kleuren uit de kolom."""
    h, w, _ = bg.shape
    y0 = int(h * 0.52)
    out = bg.copy().astype(np.float32)

    for x in range(w):
        col = out[y0:, x, :]
        r, g, b = col[:, 0], col[:, 1], col[:, 2]
        mx = np.maximum(np.maximum(r, g), b)
        mn = np.minimum(np.minimum(r, g), b)
        sat = np.divide(mx - mn, mx, out=np.zeros_like(mx), where=mx > 8)
        vivid = sat >= 0.1
        if not vivid.any():
            continue
        ref = np.median(col[vivid], axis=0)
        gray = sat < 0.09
        for i in np.where(gray)[0]:
            shade = 0.88 + 0.12 * (i / max(len(col) - 1, 1))
            col[i] = ref * shade
        out[y0:, x, :] = col

    return np.clip(out, 0, 255).astype(np.uint8)


def prepare_cityscape_scroll_strip(bg_path: Path, canvas_h: int) -> np.ndarray:
    """Maak naadloze scrollstrook uit externe skyline-foto."""
    img = Image.open(bg_path).convert("RGB")
    iw, ih = img.size
    scale = canvas_h / max(ih, 1)
    strip_w = max(1, int(round(iw * scale)))
    strip = np.array(img.resize((strip_w, canvas_h), Image.Resampling.LANCZOS))
    mirrored = strip[:, ::-1, :]
    return np.concatenate([strip, mirrored], axis=1)


def extract_clean_city_strip(original: np.ndarray, character_alpha: np.ndarray) -> np.ndarray:
    """Stadstrook zonder personagezone — alleen schone gebouwen links/rechts uit bron."""
    h, w, _ = original.shape
    rembg = character_alpha > 20
    if not rembg.any():
        return original.copy()

    xs = np.where(rembg.any(axis=0))[0]
    x_char_min, x_char_max = int(xs.min()), int(xs.max())
    pad = 10
    cut_left = max(0, x_char_min - pad)
    cut_right = min(w, x_char_max + pad + 1)

    left = original[:, :cut_left, :]
    right = original[:, cut_right:, :]

    if left.shape[1] == 0 and right.shape[1] == 0:
        return original.copy()
    if left.shape[1] == 0:
        return right.copy()
    if right.shape[1] == 0:
        return left.copy()

    blend = min(6, left.shape[1], right.shape[1])
    if blend > 1:
        left = left.copy()
        right = right.copy()
        for i in range(blend):
            t = i / max(blend - 1, 1)
            left[:, -(blend - i)] = np.clip(
                left[:, -(blend - i)].astype(np.float32) * (1.0 - t)
                + right[:, i].astype(np.float32) * t,
                0,
                255,
            ).astype(np.uint8)
        right = right[:, blend:, :]

    strip = np.concatenate([left, right], axis=1)
    if strip.shape[1] >= 8:
        mirrored = strip[:, ::-1, :]
        strip = np.concatenate([strip, mirrored], axis=1)
    return strip


def sample_scrolling_city_smooth(strip: np.ndarray, scroll: float, canvas_w: int) -> np.ndarray:
    """Scroll met subpixel-interpolatie voor vloeiende beweging."""
    strip_w = strip.shape[1]
    if strip_w <= 0:
        raise ValueError("Lege stadstrook")

    h = strip.shape[0]
    extended = np.tile(strip, (1, 3, 1))
    origin = strip_w
    scroll_f = float(scroll) % strip_w

    yy, xx = np.mgrid[0:h, 0:canvas_w].astype(np.float32)
    src_x = origin + xx + scroll_f
    out = np.empty((h, canvas_w, 3), dtype=np.float32)
    for c in range(3):
        out[:, :, c] = map_coordinates(
            extended[:, :, c].astype(np.float32),
            [yy, src_x],
            order=1,
            mode="wrap",
        )
    return np.clip(out, 0, 255).astype(np.uint8)


def sample_scrolling_city(strip: np.ndarray, scroll: int, canvas_w: int) -> np.ndarray:
    """Scroll door schone stadstrook; herhaal naadloos voor loop."""
    strip_w = strip.shape[1]
    if strip_w <= 0:
        raise ValueError("Lege stadstrook")
    if strip_w >= canvas_w:
        offset = scroll % strip_w
        if offset + canvas_w <= strip_w:
            return strip[:, offset : offset + canvas_w, :].copy()
        part_a = strip[:, offset:, :]
        part_b = strip[:, : canvas_w - part_a.shape[1], :]
        return np.concatenate([part_a, part_b], axis=1)

    repeats = int(np.ceil((scroll + canvas_w) / strip_w)) + 1
    extended = np.tile(strip, (1, repeats, 1))
    offset = scroll % strip_w
    return extended[:, offset : offset + canvas_w, :].copy()


def inpaint_background(original: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Vul personagegebied met dichtstbijzijnde achtergrondkleur (geen spook)."""
    mask = alpha > 20
    if not mask.any():
        return original.copy()

    inv = ~mask
    if not inv.any():
        return original.copy()

    _, indices = distance_transform_edt(inv, return_indices=True)
    out = original.copy()
    out[mask] = original[indices[0][mask], indices[1][mask]]

    softened = gaussian_filter(mask.astype(np.float32), sigma=4) > 0.08
    blurred = gaussian_filter(out.astype(np.float32), sigma=2)
    for c in range(3):
        out[:, :, c] = np.where(softened, blurred[:, :, c], out[:, :, c])
    return np.clip(out, 0, 255).astype(np.uint8)


def clean_cutout_fringe(fg: np.ndarray) -> np.ndarray:
    """Verwijder grijze rembg-schaduwen en maak alpha hard."""
    out = fg.copy()
    alpha = out[:, :, 3].astype(np.float32)
    rgb = out[:, :, :3].astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    saturation = np.divide(
        mx - mn,
        mx,
        out=np.zeros_like(mx),
        where=mx > 8,
    )

    visible = alpha > 20
    grey_shadow = visible & (saturation < 0.14) & (mx < 175) & (mn < 125)
    out[grey_shadow, 3] = 0
    out[grey_shadow, :3] = 0

    remain = out[:, :, 3] > 0
    out[:, :, 3] = np.where(remain, 255, 0).astype(np.uint8)
    out[~remain, :3] = 0
    return out


def motion_blur_horizontal(rgb: np.ndarray, size: int) -> np.ndarray:
    if size <= 1:
        return rgb
    kernel = np.zeros((1, size), dtype=np.float32)
    kernel[0, :] = 1.0 / size
    out = np.empty_like(rgb, dtype=np.float32)
    for c in range(rgb.shape[2]):
        out[:, :, c] = convolve(rgb[:, :, c].astype(np.float32), kernel, mode="nearest")
    return np.clip(out, 0, 255).astype(np.uint8)


def pink_cape_hint(fg: np.ndarray) -> np.ndarray:
    """Herken roze cape (niet wit pak / blauwe lucht)."""
    rgb = fg[:, :, :3].astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    return (r > 155) & (r > g * 1.15) & (r > b * 0.95) & (g < 175)


def leg_feet_corridor(along: np.ndarray, across: np.ndarray) -> np.ndarray:
    """Benen + voeten + roze laarzen — nooit cape of warp."""
    return (along < 0.50) & (np.abs(across) < 0.54)


def character_masks(fg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Vast lichaam (profiel) + cape op de rug (links achter bij vlucht naar rechts)."""
    h, w = fg.shape[:2]
    alpha = fg[:, :, 3].astype(np.float32) / 255.0
    ys, xs = np.where(alpha > 0.12)
    if len(xs) == 0:
        empty = np.zeros((h, w), dtype=bool)
        return empty, empty

    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()
    bw, bh = x1 - x0 + 1, y1 - y0 + 1

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    along = (xx - x0) / max(bw, 1.0)
    across = (yy - (y0 + y1) / 2.0) / max(bh * 0.5, 1.0)

    visible = alpha > 0.12
    pink = pink_cape_hint(fg)
    legs = leg_feet_corridor(along, across)

    # Kern lichaam inclusief benen, laarzen, torso (roze laarzen ≠ cape)
    core_body = visible & (
        (along > 0.26)
        | legs
        | ((along > 0.10) & (along < 0.52) & (np.abs(across) < 0.50))
    )

    # Cape: alleen roze trail links, boven/onder romp — nooit beengebied
    cape = pink & visible & (along < 0.40) & (np.abs(across) > 0.28) & ~core_body & ~legs
    cape &= ~legs

    body = visible & ~cape
    return body, cape


def warp_layer(
    layer: np.ndarray,
    cape_mask: np.ndarray,
    body_mask: np.ndarray,
    phase: float,
) -> np.ndarray:
    """Warp alleen cape op de rug; lichaam (profiel) blijft vast."""
    h, w = layer.shape[:2]
    alpha = layer[:, :, 3].astype(np.float32) / 255.0
    if alpha.max() <= 0:
        return layer

    if not cape_mask.any():
        return layer

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # Globale vlucht-as (niet alleen cape-bbox) voor consistente golven
    ys_all, xs_all = np.where(alpha > 0.12)
    gx0, gx1 = xs_all.min(), xs_all.max()
    gy0, gy1 = ys_all.min(), ys_all.max()
    gbw, gbh = gx1 - gx0 + 1, gy1 - gy0 + 1
    along = (xx - gx0) / max(gbw, 1.0)
    across = (yy - (gy0 + gy1) / 2.0) / max(gbh * 0.5, 1.0)

    weight = cape_mask.astype(np.float32) * alpha
    weight *= ~leg_feet_corridor(along, across)
    trail = np.clip((0.38 - along) / 0.38, 0.0, 1.0)
    weight *= 0.35 + 0.95 * trail
    flatness = 1.0 - np.clip((np.abs(across) - 0.18) / 0.34, 0.0, 0.65)
    weight *= 0.55 + 0.45 * flatness

    p = phase * CAPE_PHASE_SPEED
    wave_main = np.sin(along * 20.0 - p * 2.9)
    wave_fast = np.sin(along * 28.0 - p * 3.6) * 0.65
    wave_tail = np.cos(p * 2.6 - along * 10.0) * 0.55
    wave_end = np.sin(along * 14.0 - p * 2.1) * trail * 0.5
    ripple = (wave_main + wave_fast + wave_tail + wave_end) * CAPE_AMP_X * weight
    sway_x = np.sin(p) * CAPE_SHIFT_X * weight
    disp_x = ripple + sway_x
    disp_y = np.sin(across * 4.0 + p * 0.9) * 0.08 * CAPE_AMP_Y * weight

    src_y = np.clip(yy - disp_y, 0, h - 1)
    src_x = np.clip(xx - disp_x, 0, w - 1)

    warped = np.zeros_like(layer)
    for c in range(4):
        warped[:, :, c] = map_coordinates(
            layer[:, :, c].astype(np.float32),
            [src_y, src_x],
            order=1,
            mode="nearest",
        ).astype(np.uint8)

    out = warped.copy()
    out[body_mask] = layer[body_mask]
    return out


def harden_foreground_alpha(fg: np.ndarray) -> np.ndarray:
    """Verwijder semi-transparante randen — geen grijs spook bij compositing."""
    out = fg.copy()
    alpha = out[:, :, 3]
    solid = alpha >= 200
    out[:, :, 3] = np.where(solid, 255, 0).astype(np.uint8)
    out[~solid, :3] = 0
    return out


def remnant_pixel_mask(rgb: np.ndarray) -> np.ndarray:
    """Herken rest-sporen van het personage (niet grijze gebouwen)."""
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    pink = (r > 135) & (r > g * 1.06) & (g < 195)
    white_suit = (r > 198) & (g > 198) & (b > 198)
    return pink | white_suit


def gray_halo_mask(rgb: np.ndarray) -> np.ndarray:
    """Herken vlakke grijze halo direct achter MegaMinnie."""
    r, g, b = rgb[:, :, 0].astype(np.float32), rgb[:, :, 1].astype(np.float32), rgb[:, :, 2].astype(np.float32)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.divide(mx - mn, mx, out=np.zeros_like(mx), where=mx > 8)
    flat = np.abs(r - g) < 18.0
    flat &= np.abs(g - b) < 18.0
    flat &= np.abs(r - b) < 18.0
    return (sat < 0.11) & (mx > 38) & (mx < 188) & flat


def scrub_background_remnants_under_foreground(
    bg: np.ndarray,
    fg: np.ndarray,
    x: int,
    y: int,
    *,
    pad: int = 4,
) -> np.ndarray:
    """Verwijder personage-sporen en grijze halo vlak achter fg."""
    canvas_h, canvas_w = bg.shape[:2]
    fg_mask = fg[:, :, 3] > 20
    if not fg_mask.any():
        return bg

    ys, xs = np.where(fg_mask)
    out = bg.copy()
    x0 = max(0, x + int(xs.min()) - pad)
    y0 = max(0, y + int(ys.min()) - pad)
    x1 = min(canvas_w, x + int(xs.max()) + pad + 1)
    y1 = min(canvas_h, y + int(ys.max()) + pad + 1)

    patch = out[y0:y1, x0:x1].astype(np.float32)
    patch_h, patch_w = y1 - y0, x1 - x0
    local_fg = np.zeros((patch_h, patch_w), dtype=bool)
    fg_ys, fg_xs = np.where(fg[:, :, 3] > 20)
    canvas_xs = x + fg_xs
    canvas_ys = y + fg_ys
    in_patch = (canvas_xs >= x0) & (canvas_xs < x1) & (canvas_ys >= y0) & (canvas_ys < y1)
    local_fg[canvas_ys[in_patch] - y0, canvas_xs[in_patch] - x0] = True

    near_fg = binary_dilation(local_fg, iterations=2)
    bad = (remnant_pixel_mask(patch) | gray_halo_mask(patch)) & near_fg
    if not bad.any():
        return out

    inv = ~bad
    if not inv.any():
        return patch_background_under_foreground(bg, fg, x, y, pad=pad)

    _, indices = distance_transform_edt(inv, return_indices=True)
    cleaned = patch.copy()
    for c in range(3):
        cleaned[:, :, c] = np.where(bad, patch[indices[0], indices[1], c], patch[:, :, c])
    out[y0:y1, x0:x1] = np.clip(cleaned, 0, 255).astype(np.uint8)
    return out


def patch_background_under_foreground(
    bg: np.ndarray,
    fg: np.ndarray,
    x: int,
    y: int,
    *,
    pad: int = 24,
) -> np.ndarray:
    """Vul het volledige fg-bounding-box gebied met lucht vóór compositing."""
    canvas_h, canvas_w = bg.shape[:2]
    fg_mask = fg[:, :, 3] > 20
    if not fg_mask.any():
        return bg

    ys, xs = np.where(fg_mask)
    out = bg.copy()
    x0 = max(0, x + int(xs.min()) - pad)
    y0 = max(0, y + int(ys.min()) - pad)
    x1 = min(canvas_w, x + int(xs.max()) + pad + 1)
    y1 = min(canvas_h, y + int(ys.max()) + pad + 1)

    top = max(8, canvas_h // 8)
    ref = np.zeros((canvas_h, canvas_w), dtype=bool)
    ref[:top, :] = True
    sky_col = np.median(out[ref], axis=0).astype(np.float32) if ref.any() else np.array(
        [132.0, 186.0, 226.0],
        dtype=np.float32,
    )

    yy = np.arange(y0, y1, dtype=np.float32)
    grad = (1.0 - 0.08 * (yy / max(canvas_h - 1, 1)))[:, None, None]
    patch = np.clip(sky_col * grad, 0, 255).astype(np.uint8)
    patch = np.broadcast_to(patch, (y1 - y0, x1 - x0, 3)).copy()
    out[y0:y1, x0:x1] = patch

    softened = np.zeros((canvas_h, canvas_w), dtype=bool)
    softened[y0:y1, x0:x1] = True
    blur = gaussian_filter(out.astype(np.float32), sigma=5)
    for c in range(3):
        out[:, :, c] = np.where(softened, blur[:, :, c], out[:, :, c])
    return np.clip(out, 0, 255).astype(np.uint8)


def composite(fg: np.ndarray, bg: np.ndarray, x: int, y: int) -> np.ndarray:
    h, w = fg.shape[:2]
    canvas_h, canvas_w = bg.shape[:2]
    out = bg.copy()

    x0 = max(0, x)
    y0 = max(0, y)
    x1 = min(canvas_w, x + w)
    y1 = min(canvas_h, y + h)

    fx0 = x0 - x
    fy0 = y0 - y
    fx1 = fx0 + (x1 - x0)
    fy1 = fy0 + (y1 - y0)

    fg_slice = fg[fy0:fy1, fx0:fx1].astype(np.float32)
    bg_slice = out[y0:y1, x0:x1].astype(np.float32)
    alpha = fg_slice[:, :, 3:4] / 255.0
    blended = fg_slice[:, :, :3] * alpha + bg_slice[:, :, :3] * (1.0 - alpha)
    out[y0:y1, x0:x1, :3] = np.clip(blended, 0, 255).astype(np.uint8)
    return out


def build_frames(
    source: Path,
    fps: int = FPS,
    duration_sec: float = DURATION_SEC,
    *,
    cityscape_path: Path = CITYSCAPE_BG,
) -> tuple[list[Image.Image], list[Image.Image]]:
    print("Laad bronafbeelding (zijaanzicht)…")
    original = load_rgba(source)
    orig_np = rgba_to_np(original)

    print("Scheid voorgrond (MegaMinnie)…")
    if CUTOUT_CACHE.is_file():
        print(f"  gebruik cache: {CUTOUT_CACHE.name}")
        fg_cutout = load_rgba(CUTOUT_CACHE)
    else:
        fg_cutout = remove(
            original,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=20,
            alpha_matting_erode_size=10,
        )
        Image.fromarray(rgba_to_np(fg_cutout), "RGBA").save(CUTOUT_CACHE)
    fg_np_orig = rgba_to_np(fg_cutout)
    fg_np_orig = clean_cutout_fringe(fg_np_orig)
    fg_np = prepare_foreground(fg_np_orig)
    fg_np = harden_foreground_alpha(fg_np)
    body_mask, cape_mask = character_masks(fg_np)
    cape_px = int(cape_mask.sum())
    print(f"Cape-masker: {cape_px} pixels")
    if cape_px < 5000:
        print("Waarschuwing: weinig cape-pixels — animatie kan onzichtbaar zijn.")

    h, w = orig_np.shape[:2]
    fg_h, fg_w = fg_np.shape[:2]
    base_x = (w - fg_w) // 2
    base_y = (h - fg_h) // 2

    print("Bereid scrollende stad (skyline-foto)…")
    if not cityscape_path.is_file():
        raise SystemExit(f"Achtergrondfoto niet gevonden: {cityscape_path}")
    city_strip = prepare_cityscape_scroll_strip(cityscape_path, h)
    scroll_period = max(city_strip.shape[1] // 2, 1)
    print(f"Skyline-strook: {city_strip.shape[1]} px breed, scroll-periode {scroll_period} px")
    fg_ys, fg_xs = np.where(fg_np[:, :, 3] > 12)
    pad_x, pad_top, pad_bottom = WEB_SUBJECT_PAD_LEFT, WEB_SUBJECT_PAD_TOP, WEB_SUBJECT_PAD_BOTTOM
    pad_right = WEB_SUBJECT_PAD_RIGHT
    subject_box = (
        max(0, base_x + int(fg_xs.min()) - pad_x),
        max(0, base_y + int(fg_ys.min()) - pad_top),
        min(w, base_x + int(fg_xs.max()) + pad_right),
        min(h, base_y + int(fg_ys.max()) + pad_bottom),
    )

    total_frames = max(2, int(round(fps * duration_sec)))
    frames: list[Image.Image] = []
    frames_web: list[Image.Image] = []

    print(f"Render {total_frames} frames @ {fps} fps (scrollende bg rechts->links)…")
    for i in range(total_frames):
        t = i / total_frames
        phase = t * 2.0 * np.pi
        scroll = (i / total_frames) * scroll_period

        bg_scroll = sample_scrolling_city_smooth(city_strip, scroll, w)
        if CITY_BG_ZOOM < 0.999:
            bg_scroll = fit_city_background_zoomed(bg_scroll, CITY_BG_ZOOM)
        bg_scroll = motion_blur_horizontal(bg_scroll, MOTION_BLUR)
        crowd_mask = np.linspace(0.0, 1.0, h)[:, None]
        crowd_mask = np.clip((crowd_mask - 0.45) / 0.55, 0.0, 1.0)[..., None]
        streak = motion_blur_horizontal(bg_scroll, MOTION_BLUR + 8)
        bg_scroll = (
            bg_scroll.astype(np.float32) * (1.0 - crowd_mask * 0.12)
            + streak.astype(np.float32) * (crowd_mask * 0.12)
        ).astype(np.uint8)

        fg_frame = harden_foreground_alpha(warp_layer(fg_np.copy(), cape_mask, body_mask, phase))
        bg_ready = scrub_background_remnants_under_foreground(bg_scroll, fg_frame, base_x, base_y)
        frame_rgb = composite(fg_frame, bg_ready, base_x, base_y)
        frames.append(Image.fromarray(frame_rgb, "RGB"))
        frames_web.append(Image.fromarray(frame_rgb, "RGB"))

        if (i + 1) % 12 == 0 or i + 1 == total_frames:
            print(f"  frame {i + 1}/{total_frames}")

    return frames, frames_web, subject_box


def _gif_palette(frames: list[Image.Image]) -> Image.Image:
    """Palette uit meerdere frames zodat cape-beweging niet weg-kwantiseert."""
    w, h = frames[0].size
    strip = Image.new("RGB", (w * min(6, len(frames)), h))
    step = max(1, len(frames) // 6)
    x = 0
    for i in range(0, len(frames), step):
        strip.paste(frames[i], (x, 0))
        x += w
        if x >= strip.width:
            break
    return strip.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def save_gif(
    frames: list[Image.Image],
    output: Path,
    fps: int,
    *,
    dither: Image.Dither = Image.Dither.FLOYDSTEINBERG,
    optimize: bool = True,
) -> None:
    duration_ms = int(round(1000 / fps))
    print(f"Opslaan GIF ({len(frames)} frames, {duration_ms} ms/frame)…")

    palette_img = _gif_palette(frames)
    quantized = [frame.quantize(palette=palette_img, dither=dither) for frame in frames]

    quantized[0].save(
        output,
        save_all=True,
        append_images=quantized[1:],
        duration=duration_ms,
        loop=0,
        optimize=optimize,
        disposal=2,
    )


def crop_subject(frames: list[Image.Image], box: tuple[int, int, int, int]) -> list[Image.Image]:
    return [f.crop(box) for f in frames]


def crop_landscape(frame: Image.Image, ratio: float = 16 / 10) -> Image.Image:
    w, h = frame.size
    target_h = int(w / ratio)
    if target_h >= h:
        return frame
    top = max(0, (h - target_h) // 2)
    top = min(top, h - target_h)
    return frame.crop((0, top, w, top + target_h))


def save_web_gif(
    frames: list[Image.Image],
    output: Path,
    fps: int,
    width: int,
    subject_box: tuple[int, int, int, int],
) -> None:
    web_frames = frames
    web_fps = fps
    cropped = crop_subject(web_frames, subject_box)
    h0 = cropped[0].height
    w0 = cropped[0].width
    target_h = int(h0 * width / w0)
    resized = [f.resize((width, target_h), Image.Resampling.LANCZOS) for f in cropped]
    print(f"Opslaan web-GIF ({width}×{target_h}, {len(resized)} frames)…")
    duration_ms = int(round(1000 / web_fps))
    resized[0].save(
        output,
        save_all=True,
        append_images=resized[1:],
        duration=duration_ms,
        loop=0,
        optimize=False,
        disposal=2,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Bouw MegaMinnie animated GIF (zijaanzicht)")
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--cityscape", type=Path, default=CITYSCAPE_BG)
    parser.add_argument("--fps", type=int, default=FPS)
    parser.add_argument("--duration", type=float, default=DURATION_SEC)
    args = parser.parse_args()

    if not args.source.is_file():
        raise SystemExit(f"Bronbestand niet gevonden: {args.source}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    frames, frames_web, subject_box = build_frames(
        args.source,
        fps=args.fps,
        duration_sec=args.duration,
        cityscape_path=args.cityscape,
    )
    save_gif(frames, args.output, args.fps)
    save_web_gif(frames_web, WEB_OUTPUT, args.fps, WEB_WIDTH, subject_box)
    size_mb = args.output.stat().st_size / (1024 * 1024)
    web_mb = WEB_OUTPUT.stat().st_size / (1024 * 1024)
    print(f"Klaar: {args.output} ({size_mb:.1f} MB), {WEB_OUTPUT} ({web_mb:.1f} MB)")


if __name__ == "__main__":
    main()
