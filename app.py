import base64
import io
from datetime import datetime
from typing import Optional

from flask import Flask, Response, render_template, request
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdf_canvas

from string_art_generator import (
    GenerationConfig,
    generate_string_art,
    image_to_png_bytes,
    render_schema_image,
)

app = Flask(__name__)

LAST_RESULT: Optional[dict] = None


def _safe_int(raw_value: str, default: int, lower: int, upper: int) -> int:
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        value = default
    return max(lower, min(upper, value))


def _instructions_to_txt(instructions):
    lines = []
    for idx, (start, end, color) in enumerate(instructions, start=1):
        lines.append(f"{idx:04d}. Clou {start} -> Clou {end} ({color})")
    return "\n".join(lines)


@app.get("/")
def index():
    return render_template("index.html", config=GenerationConfig())


@app.post("/generate")
def generate():
    global LAST_RESULT

    image = request.files.get("image")
    if not image:
        return render_template("index.html", error="Merci de sélectionner une image.", config=GenerationConfig())

    config = GenerationConfig(
        nails=_safe_int(request.form.get("nails"), 160, 40, 320),
        lines=_safe_int(request.form.get("lines"), 900, 50, 5000),
        size=_safe_int(request.form.get("size"), 700, 300, 1000),
        color_mode=request.form.get("color_mode") == "on",
    )

    try:
        image_bytes = image.read()
        result = generate_string_art(image_bytes, config)
    except ValueError as exc:
        return render_template("index.html", error=str(exc), config=config)

    schema = render_schema_image(result.nail_points, result.instructions, config.size)
    result_b64 = base64.b64encode(image_to_png_bytes(result.image)).decode("utf-8")
    schema_b64 = base64.b64encode(image_to_png_bytes(schema)).decode("utf-8")

    LAST_RESULT = {
        "result": result.image,
        "schema": schema,
        "instructions": result.instructions,
        "nails": result.nail_points,
        "config": config,
        "created_at": datetime.utcnow().isoformat(),
    }

    return render_template(
        "index.html",
        result_b64=result_b64,
        schema_b64=schema_b64,
        instructions=result.instructions[:300],
        total_instructions=len(result.instructions),
        config=config,
    )


@app.get("/download-instructions")
def download_instructions():
    if not LAST_RESULT:
        return Response("Générez d'abord une image.", status=400)

    content = _instructions_to_txt(LAST_RESULT["instructions"]) + "\n"
    return Response(
        content,
        mimetype="text/plain; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=instructions-string-art.txt"},
    )


@app.get("/download-image")
def download_image():
    if not LAST_RESULT:
        return Response("Générez d'abord une image.", status=400)

    return Response(
        image_to_png_bytes(LAST_RESULT["result"]),
        mimetype="image/png",
        headers={"Content-Disposition": "attachment; filename=string-art-result.png"},
    )


@app.get("/export-pdf")
def export_pdf():
    if not LAST_RESULT:
        return Response("Générez d'abord une image.", status=400)

    result = LAST_RESULT
    buffer = io.BytesIO()
    pdf = pdf_canvas.Canvas(buffer, pagesize=A4)
    _, page_height = A4

    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(40, page_height - 40, "String Art - Plan de réalisation")

    pdf.setFont("Helvetica", 10)
    pdf.drawString(40, page_height - 58, f"Clous: {len(result['nails'])}")
    pdf.drawString(150, page_height - 58, f"Fils: {len(result['instructions'])}")
    pdf.drawString(260, page_height - 58, f"Mode couleur: {'Oui' if result['config'].color_mode else 'Non'}")

    schema_img = ImageReader(io.BytesIO(image_to_png_bytes(result["schema"])))
    preview_img = ImageReader(io.BytesIO(image_to_png_bytes(result["result"])))

    pdf.drawImage(schema_img, 40, page_height - 340, width=240, height=240, preserveAspectRatio=True)
    pdf.drawImage(preview_img, 310, page_height - 340, width=240, height=240, preserveAspectRatio=True)

    y = page_height - 370
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(40, y, "Ordre des fils:")
    y -= 16
    pdf.setFont("Helvetica", 9)

    for idx, (start, end, color) in enumerate(result["instructions"], start=1):
        pdf.drawString(40, y, f"{idx:04d}. Clou {start} -> Clou {end} ({color})")
        y -= 12
        if y < 40:
            pdf.showPage()
            y = page_height - 40
            pdf.setFont("Helvetica", 9)

    pdf.save()
    buffer.seek(0)
    return Response(
        buffer.getvalue(),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=string-art-plan.pdf"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
