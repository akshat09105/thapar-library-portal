#!/usr/bin/env python3
"""
Top-View Empty Seat Counter using Custom YOLO Model (best.pt)
Takes 640x640 top-view images and outputs the count of empty/unoccupied seats.
"""

import sys
import os
import argparse
import json
from pathlib import Path

# Silence ultralytics verbose logging
os.environ["YOLO_VERBOSE"] = "False"


def count_empty_seats(image_path, model_path=None, conf_thresh=0.25, imgsz=640, save_annotated=False):
    """
    Runs the custom YOLO model on a top-view image and returns the number of empty seats.

    Args:
        image_path (str): Path to the top-view library image.
        model_path (str, optional): Path to best.pt weights file.
        conf_thresh (float): Confidence threshold (default 0.25).
        imgsz (int): Image dimension for inference (default 640).
        save_annotated (bool): Whether to save the image with bounding boxes drawn.

    Returns:
        dict: Contains 'empty_seats' count and detection details.
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        return {"error": "Ultralytics is not installed. Run: pip install ultralytics"}

    if model_path is None:
        # Default search paths for best.pt
        possible_paths = [
            Path(__file__).parent / "best.pt",
            Path(__file__).parent.parent / "best.pt",
            Path("best.pt"),
            Path("model/best.pt")
        ]
        for p in possible_paths:
            if p.exists():
                model_path = str(p)
                break
        if model_path is None:
            return {"error": "Model weights 'best.pt' not found."}

    # Load custom YOLO model
    model = YOLO(model_path)

    # Run inference at 640x640
    results = model.predict(
        source=image_path,
        imgsz=imgsz,
        conf=conf_thresh,
        verbose=False
    )

    if not results or len(results) == 0:
        return {
            "empty_seats": 0,
            "boxes": [],
            "image": str(image_path)
        }

    res = results[0]
    boxes = res.boxes

    empty_seats_count = len(boxes)

    # Extract bounding box coordinates [x1, y1, x2, y2] and confidence
    detected_boxes = []
    for b in boxes:
        xyxy = [int(v) for v in b.xyxy[0].tolist()]
        conf = float(b.conf[0].item())
        detected_boxes.append({
            "box": xyxy,
            "confidence": round(conf * 100, 1)
        })

    annotated_path = None
    if save_annotated:
        output_dir = Path("annotated_results")
        output_dir.mkdir(exist_ok=True)
        filename = f"empty_{Path(image_path).name}"
        annotated_path = str(output_dir / filename)
        res.save(filename=annotated_path)

    return {
        "success": True,
        "empty_seats": empty_seats_count,
        "boxes": detected_boxes,
        "annotated_image": annotated_path,
        "image": str(image_path)
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Count empty seats from top-view library images")
    parser.add_argument("--image", required=True, help="Path to top-view library image")
    parser.add_argument("--model", default=None, help="Path to best.pt (default: model/best.pt)")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold (default: 0.25)")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size for model (default: 640)")
    parser.add_argument("--save", action="store_true", help="Save annotated image with bounding boxes")
    parser.add_argument("--json", action="store_true", help="Output full JSON instead of just the number")

    args = parser.parse_args()

    result = count_empty_seats(
        image_path=args.image,
        model_path=args.model,
        conf_thresh=args.conf,
        imgsz=args.imgsz,
        save_annotated=args.save
    )

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if "error" in result:
            print(f"Error: {result['error']}", file=sys.stderr)
            sys.exit(1)
        print(f"Empty Seats: {result['empty_seats']}")

