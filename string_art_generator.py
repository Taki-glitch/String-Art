import io
import math
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps


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
            rgb = source.convert("RGB")
            square = ImageOps.fit(rgb, (size, size), method=Image.Resampling.LANCZOS)
            enhanced = ImageOps.autocontrast(square, cutoff=1)
    except Exception as exc:
        raise ValueError("Impossible de lire l'image fournie.") from exc

    return np.array(enhanced, dtype=np.uint8)


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


def _bresenham_pixels(start: Tuple[int, int], end: Tuple[int, int]) -> Tuple[np.ndarray, np.ndarray]:
    x0, y0 = start
    x1, y1 = end

    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy

    xs: List[int] = []
    ys: List[int] = []

    while True:
        xs.append(x0)
        ys.append(y0)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy

    return np.array(ys, dtype=np.int32), np.array(xs, dtype=np.int32)


def _precompute_line_pixels(points: Sequence[Tuple[int, int]], size: int, min_jump: int) -> LineCache:
    cache: LineCache = {}
    nail_count = len(points)

    for i in range(nail_count):
        for j in range(i + 1, nail_count):
            ring_dist = abs(j - i)
            ring_dist = min(ring_dist, nail_count - ring_dist)
            if ring_dist <= min_jump:
                continue

            ys, xs = _bresenham_pixels(points[i], points[j])
            if xs.size > 0:
                cache[(i, j)] = (ys, xs)

    return cache


def _map_range(value: float, in_min: float, in_max: float, out_min: float, out_max: float) -> float:
    if in_max == in_min:
        return out_min
    mapped = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min
    return max(min(mapped, max(out_min, out_max)), min(out_min, out_max))


def _generate_single_channel(
    target_gray: np.ndarray,
    points: Sequence[Tuple[int, int]],
    lines: int,
    line_weight: int,
    color_name: str,
    line_cache: LineCache,
) -> Tuple[np.ndarray, List[Tuple[int, int, str]]]:
    target = np.clip(target_gray, 0, 255).astype(np.float32)
    current_canvas = np.full_like(target, 255, dtype=np.float32)
    instructions: List[Tuple[int, int, str]] = []
    current_nail = 0
    nail_count = len(points)
    used_pairs: Dict[Tuple[int, int], int] = {}
    previous_nail = None

    current_nail = 0
    nail_count = len(points)
    previous_nail = -1
    previous_connections: Dict[int, set] = {}

    fade = _map_range(line_weight, 5, 50, 0.03, 0.22)
    min_jump = max(2, nail_count // 42)

    current_nail = 0
    nail_count = len(points)
    previous_nail = -1
    previous_connections: Dict[int, set] = {}

    min_jump = max(2, nail_count // 42)

    current_nail = 0
    nail_count = len(points)
    previous_nail = -1
    previous_connections: Dict[int, set] = {}
    edge_last_used: Dict[Tuple[int, int], int] = {}

    min_jump = max(2, nail_count // 42)
    edge_reuse_gap = max(12, nail_count // 3)

    for step_idx in range(lines):
        max_gain = 0.0
        best_candidate = -1
        best_pixels = None
        best_line_fade = None

        for candidate in range(nail_count):
            if candidate == current_nail or candidate == previous_nail:
                continue

            ring_dist = abs(candidate - current_nail)
            ring_dist = min(ring_dist, nail_count - ring_dist)
            if ring_dist <= min_jump:
                continue

            key = (current_nail, candidate) if current_nail < candidate else (candidate, current_nail)
            if key not in line_cache:
                continue

            if previous_connections.get(current_nail) and candidate in previous_connections[current_nail]:
                continue

            last_used = edge_last_used.get(key)
            if last_used is not None and step_idx - last_used < edge_reuse_gap:
                continue

            ys, xs = line_cache[key]
            if len(xs) == 0:
                continue

            old_vals = current_canvas[ys, xs]

            contrast = float(np.mean((255.0 - target[ys, xs]) / 255.0))
            base_fade = _map_range(line_weight, 5, 50, 0.05, 0.20)
            fade = float(np.clip(base_fade * (0.75 + contrast * 0.7), 0.04, 0.28))

            new_vals = np.clip(old_vals - (fade * (255.0 - target[ys, xs])), 0.0, 255.0)
            delta = old_vals - target[ys, xs]
            new_delta = new_vals - target[ys, xs]
            gain = float(np.sum(delta * delta - new_delta * new_delta))

            if gain > max_gain:
                max_gain = gain
                best_candidate = candidate
                best_pixels = (ys, xs)
                best_line_fade = fade

        if best_candidate < 0 or best_pixels is None or best_line_fade is None or max_gain <= 0:
            break

        ys, xs = best_pixels
        current_canvas[ys, xs] = np.clip(
            current_canvas[ys, xs] - (best_line_fade * (255.0 - target[ys, xs])),
            0.0,
            255.0,
        )

        previous_connections.setdefault(current_nail, set()).add(best_candidate)
        previous_connections.setdefault(best_candidate, set()).add(current_nail)
        edge_key = (current_nail, best_candidate) if current_nail < best_candidate else (best_candidate, current_nail)
        edge_last_used[edge_key] = step_idx

        instructions.append((current_nail, best_candidate, color_name))
        previous_nail = current_nail
        current_nail = best_candidate

    return np.clip(current_canvas, 0, 255).astype(np.uint8), instructions


def generate_string_art(image_bytes: bytes, config: GenerationConfig) -> GenerationResult:
    if config.nails > 320:
        raise ValueError("Pour des raisons de performance, limite actuelle: 320 clous max.")
    if config.lines < 1:
        raise ValueError("Le nombre de fils doit être supérieur à 0.")

    source = decode_image(image_bytes, config.size)
    points = create_circle_points(config.nails, config.size)
    min_jump = max(2, config.nails // 42)
    line_cache = _precompute_line_pixels(points, config.size, min_jump)

    if not config.color_mode:
        gray = np.dot(source[..., :3], [0.299, 0.587, 0.114]).astype(np.float32)
        gray = np.clip(gray, 0, 255).astype(np.uint8)
        _, steps = _generate_single_channel(
            gray,
            points,
            config.lines,
            config.line_weight,
            "noir",
            line_cache,
        )
        result_img = render_realistic_string_art(points, steps, config.size, config.line_weight)
        return GenerationResult(result_img, steps, points)

    split_lines = max(1, config.lines // 3)
    channels = [("rouge", source[:, :, 0]), ("vert", source[:, :, 1]), ("bleu", source[:, :, 2])]

    channel_steps: List[List[Tuple[int, int, str]]] = []
    for color_name, channel in channels:
        _, steps = _generate_single_channel(
            channel,
            points,
            split_lines,
            config.line_weight,
            color_name,
            line_cache,
        )
        channel_steps.append(steps)

    instructions: List[Tuple[int, int, str]] = []
    channel_index = 0
    while any(channel_steps):
        current_steps = channel_steps[channel_index]
        if current_steps:
            instructions.append(current_steps.pop(0))
        channel_index = (channel_index + 1) % len(channel_steps)

    result_img = render_realistic_string_art(points, instructions, config.size, config.line_weight)
    return GenerationResult(result_img, instructions, points)


def render_realistic_string_art(
    nail_points: Sequence[Tuple[int, int]],
    instructions: Sequence[Tuple[int, int, str]],
    size: int,
    line_weight: int = 18,
) -> Image.Image:
    supersample = 3
    large_size = size * supersample
    scale_points = [(x * supersample, y * supersample) for x, y in nail_points]

    base = Image.new("RGBA", (large_size, large_size), (244, 238, 225, 255))
    thread_layer = Image.new("RGBA", (large_size, large_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(thread_layer, "RGBA")
    color_map = {
        "noir": (20, 20, 20),
        "rouge": (190, 32, 46),
        "vert": (52, 128, 68),
        "bleu": (40, 90, 170),
    }

    base_alpha = int(np.clip(_map_range(size, 300, 1400, 46, 24), 20, 52))
    weight_alpha = _map_range(line_weight, 5, 50, -5, 8)
    density_alpha = _map_range(len(instructions), 100, 4000, -3, 8)
    line_alpha = int(np.clip(base_alpha + weight_alpha + density_alpha, 18, 72))

    for start, end, color in instructions:
        rgb = color_map.get(color, (20, 20, 20))
        draw.line(
            (scale_points[start], scale_points[end]),
            fill=(*rgb, line_alpha),
            width=max(1, supersample),
        )

    softened = thread_layer.filter(ImageFilter.GaussianBlur(radius=0.7 * supersample))
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
