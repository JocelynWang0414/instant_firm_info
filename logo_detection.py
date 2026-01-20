from google.cloud import vision
from pathlib import Path
def detect_logo_brand(image_path: str):
    client = vision.ImageAnnotatorClient()

    # Read local image
    with open(image_path, "rb") as f:
        content = f.read()

    image = vision.Image(content=content)

    # Call Logo Detection
    response = client.logo_detection(image=image)

    if response.error.message:
        raise RuntimeError(response.error.message)

    logos = response.logo_annotations

    if not logos:
        print("No logo detected.")
        return None

    print("Detected brand(s):")
    for logo in logos:
        print(f"- {logo.description} (confidence: {logo.score:.2f})")

    # Return best guess
    return logos[0].description


brand = detect_logo_brand("logo3.jpg")
print("Brand:", brand)
