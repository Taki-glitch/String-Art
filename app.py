import base64
import io
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


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/generate")
def generate():
    global LAST_RESULT
    image = request.files.get("image")
    if not image:
        return render_template("index.html", error="Merci de sélectionner une image.")

    try:
        nails = int(request.form.get("nails", 200))
        lines = int(request.form.get("lines", 1200))
        size = int(request.form.get("size", 700))
    except ValueError:
        return render_template("index.html", error="Paramètres numériques invalides.")

    color_mode = request.form.get("color_mode") == "on"
    config = GenerationConfig(nails=nails, lines=lines, size=size, color_mode=color_mode)

    try:
        result = generate_string_art(image.read(), config)
    except ValueError as exc:
        return render_template("index.html", error=str(exc))

    schema = render_schema_image(result.nail_points, result.instructions, config.size)
    result_b64 = base64.b64encode(image_to_png_bytes(result.image)).decode("utf-8")
    schema_b64 = base64.b64encode(image_to_png_bytes(schema)).decode("utf-8")

    LAST_RESULT = {
        "result": result.image,
        "schema": schema,
        "instructions": result.instructions,
        "nails": result.nail_points,
        "config": config,
    }

    return render_template(
        "index.html",
        result_b64=result_b64,
        schema_b64=schema_b64,
        instructions=result.instructions[:200],
        total_instructions=len(result.instructions),
        config=config,
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
    pdf.drawString(250, page_height - 58, f"Mode couleur: {'Oui' if result['config'].color_mode else 'Non'}")

    schema_img = ImageReader(io.BytesIO(image_to_png_bytes(result["schema"])))
    preview_img = ImageReader(io.BytesIO(image_to_png_bytes(result["result"])))

    pdf.drawImage(schema_img, 40, page_height - 350, width=240, height=240, preserveAspectRatio=True)
    pdf.drawImage(preview_img, 310, page_height - 350, width=240, height=240, preserveAspectRatio=True)

    y = page_height - 380
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(40, y, "Ordre des fils (début):")
    y -= 16
    pdf.setFont("Helvetica", 9)

    for idx, (start, end, color) in enumerate(result["instructions"][:120], start=1):
        pdf.drawString(40, y, f"{idx:03d}. Clou {start} -> Clou {end} ({color})")
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
