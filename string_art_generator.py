import io
import math
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw


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
    array = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Impossible de lire l'image fournie.")
    return cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)


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
            mask = np.zeros((size, size), dtype=np.uint8)
            cv2.line(mask, points[i], points[j], 1, 1)
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

    for _ in range(lines):
        need = np.clip(target_darkness - rendered_darkness, 0, 255)

        best_score = 0.0
        best_pair = None
        for pair, (ys, xs) in line_cache.items():
            score = float(np.sum(need[ys, xs]))
            if score > best_score:
                best_score = score
                best_pair = pair

        if not best_pair or best_score < 1:
            break

        ys, xs = line_cache[best_pair]
        rendered_darkness[ys, xs] = np.minimum(255, rendered_darkness[ys, xs] + line_weight)
        instructions.append((best_pair[0], best_pair[1], color_name))

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
        gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
        canvas, steps = _generate_single_channel(
            gray,
            points,
            config.lines,
            config.line_weight,
            "noir",
            line_cache,
        )
        result_img = Image.fromarray(canvas).convert("RGB")
        return GenerationResult(result_img, steps, points)

    rgb = cv2.cvtColor(source, cv2.COLOR_BGR2RGB)
    split_lines = max(1, config.lines // 3)
    channels = [("rouge", rgb[:, :, 0]), ("vert", rgb[:, :, 1]), ("bleu", rgb[:, :, 2])]

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

    composite = np.stack(rendered_channels, axis=2)
    result_img = Image.fromarray(np.clip(composite, 0, 255).astype(np.uint8), mode="RGB")
    return GenerationResult(result_img, instructions, points)


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
