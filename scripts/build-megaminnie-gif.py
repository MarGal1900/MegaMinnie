#!/usr/bin/env python3
"""Genereer een looping MegaMinnie GIF: horizontaal vliegend, wapperende cape, scrollende achtergrond."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from rembg import remove
from scipy.ndimage import convolve, gaussian_filter, map_coordinates


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "images" / "megaminnie.png"
OUTPUT = ROOT / "public" / "images" / "megaminnie-animated.gif"
WEB_OUTPUT = ROOT / "public" / "images" / "megaminnie-animated-web.gif"
WEB_WIDTH = 395

FPS = 24
DURATION_SEC = 3.5
MOTION_BLUR = 17
CAPE_AMP = 34.0
FLY_ANGLE = -42.0  # horizontale vliegpose (lichaam schuin/horizontaal)
FLY_SCALE = 1.06


def load_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def rgba_to_np(img: Image.Image) -> np.ndarray:
    return np.array(img, dtype=np.uint8)


def orient_horizontal(fg: np.ndarray, angle: float = FLY_ANGLE, scale: float = FLY_SCALE) -> np.ndarray:
    """Kantel MegaMinnie naar horizontale vliegpose."""
    img = Image.fromarray(fg, "RGBA")
    w, h = img.size
    if scale != 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    rotated = img.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    return rgba_to_np(rotated)


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


def character_masks(fg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Splits voorgrond in vast lichaam en wapperende cape."""
    h, w = fg.shape[:2]
    alpha = fg[:, :, 3].astype(np.float32) / 255.0
    ys, xs = np.where(alpha > 0.12)
    if len(xs) == 0:
        empty = np.zeros((h, w), dtype=bool)
        return empty, empty

    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    cx = (x0 + x1) / 2.0

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rel_x = (xx - cx) / max(bw * 0.52, 1.0)
    rel_y = (yy - (y0 + bh * 0.4)) / max(bh * 0.52, 1.0)

    body = alpha > 0.12
    body &= np.abs(rel_x) < 0.48
    body &= yy <= y0 + bh * 0.82
    body |= (yy <= y0 + bh * 0.36) & (alpha > 0.12)

    cape = (alpha > 0.12) & ~body
    # Extra cape-rand meenemen
    cape |= (alpha > 0.12) & (np.abs(rel_x) > 0.38) & (yy > y0 + bh * 0.12)
    cape &= ~body
    return body, cape


def warp_layer(layer: np.ndarray, cape_mask: np.ndarray, phase: float) -> np.ndarray:
    """Warp alleen cape-pixels; lichaam blijft ongemoeid."""
    h, w = layer.shape[:2]
    alpha = layer[:, :, 3].astype(np.float32) / 255.0
    if alpha.max() <= 0:
        return layer

    ys, xs = np.where(cape_mask)
    if len(xs) == 0:
        return layer

    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    cx = (x0 + x1) / 2.0

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rel_x = (xx - cx) / max(bw * 0.55, 1.0)
    rel_y = (yy - (y0 + bh * 0.35)) / max(bh * 0.65, 1.0)

    weight = cape_mask.astype(np.float32) * alpha
    weight *= np.clip((np.abs(rel_x) - 0.02) / 0.98, 0.2, 1.0)
    # Achterliggende cape (links) wappert harder in horizontale vlucht
    trail = np.clip((cx - xx) / max(bw * 0.55, 1.0), 0.0, 1.0)
    weight *= 0.35 + 0.65 * trail

    wave1 = np.sin(rel_y * 9.5 + phase * 1.45)
    wave2 = np.sin(rel_x * 7.0 - phase * 1.85 + rel_y * 5.0) * 0.75
    wave3 = np.sin(phase * 2.2 + rel_x * 11.0) * 0.45
    disp_y = (wave1 + wave2 + wave3) * CAPE_AMP * weight
    disp_x = (
        np.sin(phase * 1.35 + rel_y * 7.5) * 0.7
        + np.cos(phase * 1.9 - rel_x * 4.5) * 0.35
    ) * CAPE_AMP * weight

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

    body_mask = (~cape_mask) & (alpha > 0.12)
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
) -> list[Image.Image]:
    print("Laad bronafbeelding…")
    original = load_rgba(source)
    orig_np = rgba_to_np(original)

    print("Scheid voorgrond (MegaMinnie)…")
    fg_cutout = remove(original)
    fg_np_orig = rgba_to_np(fg_cutout)
    alpha = fg_np_orig[:, :, 3]
    fg_np = orient_horizontal(fg_np_orig)
    body_mask, cape_mask = character_masks(fg_np)

    print("Bereid scrollbare achtergrond voor…")
    bg_clean = inpaint_background(orig_np[:, :, :3], alpha)
    tile = np.concatenate([bg_clean, bg_clean], axis=1)

    h, w = orig_np.shape[:2]
    fg_h, fg_w = fg_np.shape[:2]
    scroll_px = w

    base_x = (w - fg_w) // 2
    base_y = (h - fg_h) // 2 + int(h * 0.02)

    total_frames = max(2, int(round(fps * duration_sec)))
    frames: list[Image.Image] = []

    print(f"Render {total_frames} frames @ {fps} fps…")
    for i in range(total_frames):
        t = i / total_frames
        phase = t * 2.0 * np.pi
        scroll = int(round(t * scroll_px)) % w

        bg_slice = tile[:, scroll : scroll + w, :]
        bg_fast = motion_blur_horizontal(bg_slice, MOTION_BLUR)

        crowd_mask = np.linspace(0.1, 1.0, h)[:, None]
        crowd_mask = np.clip((crowd_mask - 0.3) / 0.7, 0.0, 1.0)[..., None]
        streak = motion_blur_horizontal(bg_fast, MOTION_BLUR + 10)
        bg_fast = (
            bg_fast.astype(np.float32) * (1.0 - crowd_mask * 0.55)
            + streak.astype(np.float32) * (crowd_mask * 0.55)
        ).astype(np.uint8)

        fg_frame = warp_layer(fg_np.copy(), cape_mask, phase)
        frame_rgb = composite(fg_frame, bg_fast, base_x, base_y)

        sharp_fg = fg_frame.copy()
        sharp_fg[:, :, :3] = np.array(
            Image.fromarray(sharp_fg).filter(ImageFilter.UnsharpMask(radius=1.1, percent=95, threshold=2))
        )[:, :, :3]
        frame_rgb = composite(sharp_fg, frame_rgb, base_x, base_y)

        frames.append(Image.fromarray(frame_rgb, "RGB"))

        if (i + 1) % 12 == 0 or i + 1 == total_frames:
            print(f"  frame {i + 1}/{total_frames}")

    return frames


def save_gif(frames: list[Image.Image], output: Path, fps: int) -> None:
    duration_ms = int(round(1000 / fps))
    print(f"Opslaan GIF ({len(frames)} frames, {duration_ms} ms/frame)…")

    palette_img = frames[0].quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    quantized = [
        frame.quantize(palette=palette_img, dither=Image.Dither.FLOYDSTEINBERG)
        for frame in frames
    ]

    quantized[0].save(
        output,
        save_all=True,
        append_images=quantized[1:],
        duration=duration_ms,
        loop=0,
        optimize=True,
        disposal=2,
    )


def crop_landscape(frame: Image.Image, ratio: float = 16 / 10) -> Image.Image:
    w, h = frame.size
    target_h = int(w / ratio)
    if target_h >= h:
        return frame
    top = max(0, (h - target_h) // 2 - int(h * 0.04))
    top = min(top, h - target_h)
    return frame.crop((0, top, w, top + target_h))


def save_web_gif(frames: list[Image.Image], output: Path, fps: int, width: int) -> None:
    cropped = [crop_landscape(f) for f in frames]
    h0 = cropped[0].height
    w0 = cropped[0].width
    target_h = int(h0 * width / w0)
    resized = [f.resize((width, target_h), Image.Resampling.LANCZOS) for f in cropped]
    print(f"Opslaan web-GIF ({width}×{target_h}, {len(resized)} frames)…")
    save_gif(resized, output, fps)


def main() -> None:
    parser = argparse.ArgumentParser(description="Bouw MegaMinnie animated GIF")
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--fps", type=int, default=FPS)
    parser.add_argument("--duration", type=float, default=DURATION_SEC)
    args = parser.parse_args()

    if not args.source.is_file():
        raise SystemExit(f"Bronbestand niet gevonden: {args.source}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    frames = build_frames(args.source, fps=args.fps, duration_sec=args.duration)
    save_gif(frames, args.output, args.fps)
    save_web_gif(frames, WEB_OUTPUT, args.fps, WEB_WIDTH)
    size_mb = args.output.stat().st_size / (1024 * 1024)
    web_mb = WEB_OUTPUT.stat().st_size / (1024 * 1024)
    print(f"Klaar: {args.output} ({size_mb:.1f} MB), {WEB_OUTPUT} ({web_mb:.1f} MB)")


if __name__ == "__main__":
    main()
