# Imports the Google Cloud client library
from google.cloud import vision

def run_quickstart():
    client = vision.ImageAnnotatorClient()

    with open("headshot.jpeg", "rb") as f:
        content = f.read()

    image = vision.Image(content=content)
    response = client.label_detection(image=image)

    for label in response.label_annotations:
        print(label.description)

run_quickstart()