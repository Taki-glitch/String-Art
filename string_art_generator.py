import io
import math
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


@dataclass
class GenerationConfig:
    nails: int = 160
    lines: int = 900
    size: int = 700
    line_weight: int = 18
    color_mode: bool = False


@dataclass
class GenerationResult:
    image: Image.Image
    instructions: List[Tuple[int, int, str]]
    nail_points: List[Tuple[int, int]]


LineCache = Dict[Tuple[int, int], Tuple[np.ndarray, np.ndarray]]


def decode_image(image_bytes: bytes, size: int) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            img = source.convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    except Exception as exc:
        raise ValueError("Impossible de lire l'image fournie.") from exc

    return np.array(img, dtype=np.uint8)


def create_circle_points(nails: int, size: int) -> List[Tuple[int, int]]:
    if nails < 4:
        raise ValueError("Le nombre de clous doit être supérieur ou égal à 4.")

    center = size // 2
    radius = size // 2 - 12
    points = []
    for i in range(nails):
        angle = 2 * math.pi * i / nails
        x = int(center + radius * math.cos(angle))
        y = int(center + radius * math.sin(angle))
        points.append((x, y))

    return points


def _precompute_line_pixels(points: Sequence[Tuple[int, int]], size: int) -> LineCache:
    cache: LineCache = {}
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            mask_img = Image.new("L", (size, size), 0)
            ImageDraw.Draw(mask_img).line((points[i], points[j]), fill=1, width=1)
            mask = np.array(mask_img, dtype=np.uint8)
            ys, xs = np.where(mask == 1)
            if len(xs) > 0:
                cache[(i, j)] = (ys, xs)
    return cache


def _generate_single_channel(
    target_gray: np.ndarray,
    points: Sequence[Tuple[int, int]],
    lines: int,
    line_weight: int,
    color_name: str,
    line_cache: LineCache,
) -> Tuple[np.ndarray, List[Tuple[int, int, str]]]:
    size = target_gray.shape[0]
    target_darkness = 255 - target_gray.astype(np.float32)
    rendered_darkness = np.zeros((size, size), dtype=np.float32)
    instructions: List[Tuple[int, int, str]] = []
    current_nail = 0
    nail_count = len(points)

    for _ in range(lines):
        need = np.clip(target_darkness - rendered_darkness, 0, 255)

        best_score = 1.0
        best_pair = None
        min_distance = max(2, nail_count // 40)
        for candidate in range(nail_count):
            if candidate == current_nail:
                continue
            circular_distance = abs(candidate - current_nail)
            circular_distance = min(circular_distance, nail_count - circular_distance)
            if circular_distance <= min_distance:
                continue

            pair = (current_nail, candidate) if current_nail < candidate else (candidate, current_nail)
            if pair not in line_cache:
                continue

            ys, xs = line_cache[pair]
            score = float(np.sum(need[ys, xs]))
            score -= float(np.sum(rendered_darkness[ys, xs])) * 0.12
            if score > best_score:
                best_score = score
                best_pair = pair

        if not best_pair:
            break

        ys, xs = line_cache[best_pair]
        rendered_darkness[ys, xs] = np.minimum(255, rendered_darkness[ys, xs] + line_weight)
        instructions.append((best_pair[0], best_pair[1], color_name))
        current_nail = best_pair[1] if best_pair[0] == current_nail else best_pair[0]

    canvas = np.clip(255 - rendered_darkness, 0, 255).astype(np.uint8)
    return canvas, instructions


def generate_string_art(image_bytes: bytes, config: GenerationConfig) -> GenerationResult:
    if config.nails > 320:
        raise ValueError("Pour des raisons de performance, limite actuelle: 320 clous max.")
    if config.lines < 1:
        raise ValueError("Le nombre de fils doit être supérieur à 0.")

    source = decode_image(image_bytes, config.size)
    points = create_circle_points(config.nails, config.size)
    line_cache = _precompute_line_pixels(points, config.size)

    if not config.color_mode:
        gray = np.dot(source[..., :3], [0.299, 0.587, 0.114]).astype(np.uint8)
        canvas, steps = _generate_single_channel(
            gray,
            points,
            config.lines,
            config.line_weight,
            "noir",
            line_cache,
        )
        result_img = render_realistic_string_art(points, steps, config.size)
        return GenerationResult(result_img, steps, points)

    split_lines = max(1, config.lines // 3)
    channels = [("rouge", source[:, :, 0]), ("vert", source[:, :, 1]), ("bleu", source[:, :, 2])]

    rendered_channels: List[np.ndarray] = []
    instructions: List[Tuple[int, int, str]] = []
    for color_name, channel in channels:
        channel_canvas, steps = _generate_single_channel(
            channel,
            points,
            split_lines,
            config.line_weight,
            color_name,
            line_cache,
        )
        rendered_channels.append(channel_canvas)
        instructions.extend(steps)

    result_img = render_realistic_string_art(points, instructions, config.size)
    return GenerationResult(result_img, instructions, points)


def render_realistic_string_art(
    nail_points: Sequence[Tuple[int, int]],
    instructions: Sequence[Tuple[int, int, str]],
    size: int,
) -> Image.Image:
    supersample = 2
    large_size = size * supersample
    scale_points = [(x * supersample, y * supersample) for x, y in nail_points]

    base = Image.new("RGBA", (large_size, large_size), (244, 238, 225, 255))
    thread_layer = Image.new("RGBA", (large_size, large_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(thread_layer, "RGBA")
    color_map = {
        "noir": (20, 20, 20, 18),
        "rouge": (190, 32, 46, 18),
        "vert": (52, 128, 68, 18),
        "bleu": (40, 90, 170, 18),
    }

    for start, end, color in instructions:
        draw.line(
            (scale_points[start], scale_points[end]),
            fill=color_map.get(color, (20, 20, 20, 18)),
            width=max(1, supersample),
        )

    softened = thread_layer.filter(ImageFilter.GaussianBlur(radius=0.8 * supersample))
    combined = Image.alpha_composite(base, softened)
    combined = Image.alpha_composite(combined, thread_layer)

    pin_draw = ImageDraw.Draw(combined, "RGBA")
    for x, y in scale_points:
        pin_draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(60, 60, 60, 255))
        pin_draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(220, 220, 220, 180))

    return combined.resize((size, size), Image.Resampling.LANCZOS).convert("RGB")


def render_schema_image(
    nail_points: Sequence[Tuple[int, int]],
    instructions: Sequence[Tuple[int, int, str]],
    size: int,
) -> Image.Image:
    schema = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(schema)

    for index, (x, y) in enumerate(nail_points):
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill="black")
        draw.text((x + 6, y + 6), str(index), fill="black")

    color_map = {"noir": "black", "rouge": "red", "vert": "green", "bleu": "blue"}
    for start, end, color in instructions:
        draw.line((nail_points[start], nail_points[end]), fill=color_map.get(color, "black"), width=1)

    return schema


def image_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
