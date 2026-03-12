import cv2
import numpy as np
import math
from PIL import Image, ImageDraw

# paramètres
NAILS = 200
LINES = 1500
SIZE = 800

def load_image(path):
    img = cv2.imread(path, 0)
    img = cv2.resize(img, (SIZE, SIZE))
    return img

def create_circle_points(nails):
    center = SIZE // 2
    radius = SIZE // 2 - 10
    points = []

    for i in range(nails):
        angle = 2 * math.pi * i / nails
        x = int(center + radius * math.cos(angle))
        y = int(center + radius * math.sin(angle))
        points.append((x, y))

    return points

def draw_line(img, p1, p2):
    line = np.zeros_like(img)
    cv2.line(line, p1, p2, 255, 1)
    return line

def string_art(image_path):
    img = load_image(image_path)
    points = create_circle_points(NAILS)

    canvas = np.ones_like(img) * 255
    result = []

    for _ in range(LINES):
        best_score = 0
        best_pair = None

        for i in range(NAILS):
            for j in range(i+1, NAILS):

                line = draw_line(canvas, points[i], points[j])
                score = np.sum((255 - img) * line)

                if score > best_score:
                    best_score = score
                    best_pair = (i, j)

        if best_pair:
            p1 = points[best_pair[0]]
            p2 = points[best_pair[1]]

            cv2.line(canvas, p1, p2, 0, 1)
            result.append(best_pair)

    return canvas, result

canvas, instructions = string_art("image.jpg")

cv2.imwrite("result.png", canvas)

with open("instructions.txt", "w") as f:
    for i,j in instructions:
        f.write(f"{i} -> {j}\n")
