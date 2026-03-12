import io
import math
from dataclasses import dataclass
from typing import List, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw


@dataclass
class GenerationConfig:
    nails: int = 200
    lines: int = 1200
    size: int = 800
    line_weight: int = 14
    color_mode: bool = False


@dataclass
class GenerationResult:
    image: Image.Image
    instructions: List[Tuple[int, int, str]]
    nail_points: List[Tuple[int, int]]


def decode_image(image_bytes: bytes, size: int) -> np.ndarray:
    array = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Impossible de lire l'image fournie.")
    return cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)


def create_circle_points(nails: int, size: int) -> List[Tuple[int, int]]:
    center = size // 2
    radius = size // 2 - 12
    points = []

    for i in range(nails):
        angle = 2 * math.pi * i / nails
        x = int(center + radius * math.cos(angle))
        y = int(center + radius * math.sin(angle))
        points.append((x, y))

    return points


def _line_mask(size: int, p1: Tuple[int, int], p2: Tuple[int, int]) -> np.ndarray:
    mask = np.zeros((size, size), dtype=np.uint8)
    cv2.line(mask, p1, p2, 255, 1)
    return mask


def _generate_single_channel(
    target_gray: np.ndarray,
    points: Sequence[Tuple[int, int]],
    lines: int,
    line_weight: int,
    color_name: str,
) -> Tuple[np.ndarray, List[Tuple[int, int, str]]]:
    size = target_gray.shape[0]
    darkness = 255 - target_gray.astype(np.float32)
    canvas = np.ones((size, size), dtype=np.float32) * 255
    instructions: List[Tuple[int, int, str]] = []

    for _ in range(lines):
        residual = np.clip(255 - canvas, 0, 255)
        need = np.clip(darkness - residual, 0, 255)

        best_score = 0.0
        best_pair = None

        for i in range(len(points)):
            for j in range(i + 1, len(points)):
                mask = _line_mask(size, points[i], points[j])
                score = float(np.sum(need * (mask / 255.0)))
                if score > best_score:
                    best_score = score
                    best_pair = (i, j)

        if not best_pair or best_score < 1:
            break

        cv2.line(canvas, points[best_pair[0]], points[best_pair[1]], 255 - line_weight, 1)
        instructions.append((best_pair[0], best_pair[1], color_name))

    return np.clip(canvas, 0, 255).astype(np.uint8), instructions


def generate_string_art(image_bytes: bytes, config: GenerationConfig) -> GenerationResult:
    source = decode_image(image_bytes, config.size)
    points = create_circle_points(config.nails, config.size)

    if not config.color_mode:
        gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
        canvas, steps = _generate_single_channel(
            gray,
            points,
            config.lines,
            config.line_weight,
            "noir",
        )
        result_img = Image.fromarray(canvas).convert("RGB")
        return GenerationResult(result_img, steps, points)

    rgb = cv2.cvtColor(source, cv2.COLOR_BGR2RGB)
    channel_names = ["rouge", "vert", "bleu"]
    channels = [rgb[:, :, idx] for idx in range(3)]
    split_lines = max(1, config.lines // 3)

    rendered_channels: List[np.ndarray] = []
    instructions: List[Tuple[int, int, str]] = []
    for name, channel in zip(channel_names, channels):
        rendered, steps = _generate_single_channel(
            255 - channel,
            points,
            split_lines,
            config.line_weight,
            name,
        )
        rendered_channels.append(255 - rendered)
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
