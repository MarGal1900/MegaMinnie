#!/usr/bin/env python3
"""Genereer een looping MegaMinnie GIF: zijaanzicht, horizontale vlucht, wapperende cape."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from rembg import remove
from scipy.ndimage import convolve, gaussian_filter, map_coordinates


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "images" / "megaminnie-side.png"
OUTPUT = ROOT / "public" / "images" / "megaminnie-animated.gif"
WEB_OUTPUT = ROOT / "public" / "images" / "megaminnie-animated-web.gif"
WEB_WIDTH = 395

FPS = 24
DURATION_SEC = 2.0
MOTION_BLUR = 17
CAPE_AMP_X = 42.0  # horizontale rimpels
CAPE_AMP_Y = 2.0  # minimaal op/neer
CAPE_SHIFT_X = 16.0  # duidelijke heen/weer-beweging (zichtbaar in GIF)
FLY_SCALE = 1.0
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


def inpaint_background(original: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Vul het personagegebied op met een zachte achtergrond."""
    mask = alpha > 20
    dilated = gaussian_filter(mask.astype(np.float32), sigma=6) > 0.08
    blurred = gaussian_filter(original.astype(np.float32), sigma=14)
    out = original.astype(np.float32).copy()
    for c in range(3):
        out[:, :, c] = np.where(dilated, blurred[:, :, c], out[:, :, c])
    return np.clip(out, 0, 255).astype(np.uint8)


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
) -> tuple[list[Image.Image], list[Image.Image]]:
    print("Laad bronafbeelding (zijaanzicht)…")
    original = load_rgba(source)
    orig_np = rgba_to_np(original)

    print("Scheid voorgrond (MegaMinnie)…")
    fg_cutout = remove(original)
    fg_np_orig = rgba_to_np(fg_cutout)
    alpha = fg_np_orig[:, :, 3]
    fg_np = prepare_foreground(fg_np_orig)
    body_mask, cape_mask = character_masks(fg_np)
    cape_px = int(cape_mask.sum())
    print(f"Cape-masker: {cape_px} pixels")
    if cape_px < 5000:
        print("Waarschuwing: weinig cape-pixels — animatie kan onzichtbaar zijn.")

    print("Bereid achtergrond voor…")
    bg_clean = inpaint_background(orig_np[:, :, :3], alpha)
    tile = np.concatenate([bg_clean, bg_clean], axis=1)
    h, w = orig_np.shape[:2]
    bg_static = motion_blur_horizontal(bg_clean, MOTION_BLUR)

    fg_h, fg_w = fg_np.shape[:2]
    scroll_px = w
    base_x = (w - fg_w) // 2
    base_y = (h - fg_h) // 2

    fg_ys, fg_xs = np.where(fg_np[:, :, 3] > 12)
    pad_x, pad_y = 48, 36
    subject_box = (
        max(0, base_x + int(fg_xs.min()) - pad_x),
        max(0, base_y + int(fg_ys.min()) - pad_y),
        min(w, base_x + int(fg_xs.max()) + pad_x),
        min(h, base_y + int(fg_ys.max()) + pad_y),
    )

    total_frames = max(2, int(round(fps * duration_sec)))
    frames: list[Image.Image] = []
    frames_web: list[Image.Image] = []

    print(f"Render {total_frames} frames @ {fps} fps (web = statische bg, alleen cape)…")
    for i in range(total_frames):
        t = i / total_frames
        phase = t * 2.0 * np.pi
        scroll = int(round(t * scroll_px)) % w

        bg_slice = tile[:, scroll : scroll + w, :]
        bg_scroll = motion_blur_horizontal(bg_slice, MOTION_BLUR)
        crowd_mask = np.linspace(0.1, 1.0, h)[:, None]
        crowd_mask = np.clip((crowd_mask - 0.3) / 0.7, 0.0, 1.0)[..., None]
        streak = motion_blur_horizontal(bg_scroll, MOTION_BLUR + 10)
        bg_scroll = (
            bg_scroll.astype(np.float32) * (1.0 - crowd_mask * 0.55)
            + streak.astype(np.float32) * (crowd_mask * 0.55)
        ).astype(np.uint8)

        fg_frame = warp_layer(fg_np.copy(), cape_mask, body_mask, phase)
        sharp_fg = fg_frame.copy()
        sharp_fg[:, :, :3] = np.array(
            Image.fromarray(sharp_fg).filter(ImageFilter.UnsharpMask(radius=1.1, percent=95, threshold=2))
        )[:, :, :3]

        for bg_fast, target in ((bg_scroll, frames), (bg_static, frames_web)):
            frame_rgb = composite(fg_frame, bg_fast, base_x, base_y)
            frame_rgb = composite(sharp_fg, frame_rgb, base_x, base_y)
            target.append(Image.fromarray(frame_rgb, "RGB"))

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
    # Elke 2e frame = duidelijkere cape-stappen; statische achtergrond
    web_frames = frames[::2]
    web_fps = max(12, fps // 2)
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
    parser.add_argument("--fps", type=int, default=FPS)
    parser.add_argument("--duration", type=float, default=DURATION_SEC)
    args = parser.parse_args()

    if not args.source.is_file():
        raise SystemExit(f"Bronbestand niet gevonden: {args.source}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    frames, frames_web, subject_box = build_frames(
        args.source, fps=args.fps, duration_sec=args.duration
    )
    save_gif(frames, args.output, args.fps)
    save_web_gif(frames_web, WEB_OUTPUT, args.fps, WEB_WIDTH, subject_box)
    size_mb = args.output.stat().st_size / (1024 * 1024)
    web_mb = WEB_OUTPUT.stat().st_size / (1024 * 1024)
    print(f"Klaar: {args.output} ({size_mb:.1f} MB), {WEB_OUTPUT} ({web_mb:.1f} MB)")


if __name__ == "__main__":
    main()
