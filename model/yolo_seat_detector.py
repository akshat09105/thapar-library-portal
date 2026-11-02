#!/usr/bin/env python3
"""
Real AI Library Seat Detector using YOLOv8
Processes actual CCTV / Side-Angle library images.
Detects real chairs, persons, and belongings (laptops/backpacks) with spatial IoU matching.
Includes Non-Maximum Suppression (NMS) and containment deduplication to prevent multiple boxes on one chair.
"""

import sys
import os
import json
import argparse
from pathlib import Path

# Silence ultralytics verbose logs
os.environ["YOLO_VERBOSE"] = "False"


def calculate_spatial_overlap(chair_box, person_box):
    """
    Computes spatial overlap and perspective torso alignment between a chair and a person.
    Box format: [x1, y1, x2, y2]
    """
    cx1 = max(chair_box[0], person_box[0])
    cy1 = max(chair_box[1], person_box[1])
    cx2 = min(chair_box[2], person_box[2])
    cy2 = min(chair_box[3], person_box[3])

    inter_w = max(0, cx2 - cx1)
    inter_h = max(0, cy2 - cy1)
    inter_area = inter_w * inter_h

    area_chair = max(1, (chair_box[2] - chair_box[0]) * (chair_box[3] - chair_box[1]))
    area_person = max(1, (person_box[2] - person_box[0]) * (person_box[3] - person_box[1]))

    union_area = area_chair + area_person - inter_area
    standard_iou = inter_area / union_area if union_area > 0 else 0

    # Chair coverage ratio (how much of chair is covered by person)
    chair_coverage = inter_area / area_chair

    # Horizontal center alignment (person sitting centered above/on chair)
    chair_center_x = (chair_box[0] + chair_box[2]) / 2.0
    person_center_x = (person_box[0] + person_box[2]) / 2.0
    chair_w = max(1, chair_box[2] - chair_box[0])
    horiz_offset = abs(chair_center_x - person_center_x) / chair_w

    # In side-angle/front perspective, person torso sits directly on or slightly above the seat
    if horiz_offset < 0.75 and (chair_coverage > 0.20 or standard_iou > 0.15):
        return max(standard_iou, chair_coverage, 0.55)

    return standard_iou


def deduplicate_boxes(boxes_with_conf, iou_thresh=0.35, containment_thresh=0.55):
    """
    Eliminates duplicate overlapping bounding boxes on the same physical chair.
    Uses IoU, relative containment, and horizontal center alignment.
    """
    if not boxes_with_conf:
        return []

    # Sort descending by confidence score
    sorted_boxes = sorted(boxes_with_conf, key=lambda b: b.get("conf", b.get("confidence", 0)), reverse=True)
    kept_boxes = []

    for item in sorted_boxes:
        box_a = item["box"]
        area_a = max(1, (box_a[2] - box_a[0]) * (box_a[3] - box_a[1]))
        is_duplicate = False

        for kept in kept_boxes:
            box_b = kept["box"]
            area_b = max(1, (box_b[2] - box_b[0]) * (box_b[3] - box_b[1]))

            # Intersection
            inter_x1 = max(box_a[0], box_b[0])
            inter_y1 = max(box_a[1], box_b[1])
            inter_x2 = min(box_a[2], box_b[2])
            inter_y2 = min(box_a[3], box_b[3])

            inter_w = max(0, inter_x2 - inter_x1)
            inter_h = max(0, inter_y2 - inter_y1)
            inter_area = inter_w * inter_h

            if inter_area <= 0:
                continue

            union_area = area_a + area_b - inter_area
            iou = inter_area / union_area if union_area > 0 else 0
            containment = inter_area / min(area_a, area_b)

            # Center distance relative to chair width
            center_a_x = (box_a[0] + box_a[2]) / 2.0
            center_b_x = (box_b[0] + box_b[2]) / 2.0
            min_w = max(1, min(box_a[2] - box_a[0], box_b[2] - box_b[0]))
            center_dist_x = abs(center_a_x - center_b_x) / min_w

            # If two boxes heavily overlap or their centers align on the same physical seat
            if iou > iou_thresh or containment > containment_thresh or (containment > 0.40 and center_dist_x < 0.35):
                is_duplicate = True
                break

        if not is_duplicate:
            kept_boxes.append(item)

    return kept_boxes


def analyze_image(image_path, iou_thresh=0.25, conf_thresh=0.25):
    try:
        from ultralytics import YOLO
    except ImportError:
        return {"error": "Ultralytics is not installed. Run: pip install ultralytics"}

    # Locate yolov8n.pt
    model_path = Path(__file__).parent.parent / "yolov8n.pt"
    if not model_path.exists():
        model_path = "yolov8n.pt"

    model = YOLO(str(model_path))

    # Run inference with class-agnostic NMS enabled
    # classes in COCO: 0: person, 24: backpack, 26: handbag, 56: chair, 57: couch, 63: laptop, 73: book
    target_classes = [0, 24, 26, 56, 57, 63, 73]
    results = model.predict(
        source=image_path,
        conf=conf_thresh,
        iou=0.40,
        agnostic_nms=True,
        classes=target_classes,
        verbose=False
    )

    if not results or len(results) == 0:
        return {"totalSeats": 0, "emptySeats": 0, "occupiedSeats": 0, "occupancyRate": "0%", "seats": []}

    res = results[0]
    boxes = res.boxes
    orig_w, orig_h = res.orig_shape[1], res.orig_shape[0]

    raw_chair_detections = []
    person_detections = []
    belonging_detections = []

    for box in boxes:
        cls_id = int(box.cls[0].item())
        conf = float(box.conf[0].item())
        xyxy = [int(v) for v in box.xyxy[0].tolist()]

        if cls_id in [56, 57]:  # chair or couch
            raw_chair_detections.append({"box": xyxy, "conf": round(conf * 100)})
        elif cls_id == 0:  # person
            person_detections.append({"box": xyxy, "conf": round(conf * 100)})
        elif cls_id in [24, 26, 63, 73]:  # belongings
            label = "laptop" if cls_id == 63 else ("backpack" if cls_id == 24 else "belonging")
            belonging_detections.append({"box": xyxy, "conf": round(conf * 100), "type": label})

    # Deduplicate chair detections so each physical chair only has 1 box
    chair_detections = deduplicate_boxes(raw_chair_detections, iou_thresh=0.35, containment_thresh=0.55)

    # Sort chairs horizontally (left to right)
    chair_detections.sort(key=lambda c: c["box"][0])

    matched_persons = set()
    seats = []

    for idx, chair in enumerate(chair_detections):
        c_box = chair["box"]
        seat_id = f"S-{idx + 1}"
        is_occupied = False
        occupant_type = "none"
        max_iou = 0.0

        # Check person overlap
        for p_idx, person in enumerate(person_detections):
            score = calculate_spatial_overlap(c_box, person["box"])
            if score > max_iou:
                max_iou = score
            if score >= iou_thresh:
                is_occupied = True
                occupant_type = "person"
                matched_persons.add(p_idx)

        # If no person, check if belongings (laptop/bag) are placed on the chair
        if not is_occupied:
            for item in belonging_detections:
                score = calculate_spatial_overlap(c_box, item["box"])
                if score >= 0.20:
                    is_occupied = True
                    occupant_type = item["type"]
                    max_iou = max(max_iou, score)
                    break

        row_label = "Foreground Desk" if c_box[1] > orig_h * 0.55 else ("Midground Desk" if c_box[1] > orig_h * 0.35 else "Far Perspective Desk")

        seats.append({
            "id": seat_id,
            "box": c_box,
            "row": row_label,
            "status": "OCCUPIED" if is_occupied else "VACANT",
            "confidence": chair["conf"],
            "occupantType": occupant_type,
            "iou": round(max_iou, 2)
        })

    # For any person that was NOT matched to an existing chair (e.g. chair back occluded by body):
    for p_idx, person in enumerate(person_detections):
        if p_idx not in matched_persons:
            p_box = person["box"]
            p_w = p_box[2] - p_box[0]
            p_h = p_box[3] - p_box[1]
            synth_box = [
                max(0, p_box[0] - int(p_w * 0.08)),
                min(orig_h, p_box[1] + int(p_h * 0.30)),
                min(orig_w, p_box[2] + int(p_w * 0.08)),
                min(orig_h, p_box[3] + int(p_h * 0.10))
            ]
            seats.append({
                "id": f"S-{len(seats) + 1}",
                "box": synth_box,
                "row": "Desk Seating",
                "status": "OCCUPIED",
                "confidence": person["conf"],
                "occupantType": "person",
                "iou": 0.85
            })

    # Final safety deduplication across all seats (prefers OCCUPIED over VACANT if overlapping)
    unique_seats = []
    # Sort OCCUPIED first, then by confidence
    seats.sort(key=lambda s: (1 if s["status"] == "OCCUPIED" else 0, s["confidence"]), reverse=True)
    for seat in seats:
        box_a = seat["box"]
        area_a = max(1, (box_a[2] - box_a[0]) * (box_a[3] - box_a[1]))
        dup = False
        for kept in unique_seats:
            box_b = kept["box"]
            area_b = max(1, (box_b[2] - box_b[0]) * (box_b[3] - box_b[1]))
            inter_x1 = max(box_a[0], box_b[0])
            inter_y1 = max(box_a[1], box_b[1])
            inter_x2 = min(box_a[2], box_b[2])
            inter_y2 = min(box_a[3], box_b[3])
            inter_area = max(0, inter_x2 - inter_x1) * max(0, inter_y2 - inter_y1)
            if inter_area > 0:
                iou = inter_area / (area_a + area_b - inter_area)
                containment = inter_area / min(area_a, area_b)
                if iou > 0.35 or containment > 0.55:
                    dup = True
                    break
        if not dup:
            unique_seats.append(seat)

    seats = unique_seats

    # Sort final seats left to right
    seats.sort(key=lambda s: s["box"][0])
    for i, s in enumerate(seats):
        s["id"] = f"S-{i + 1}"

    total_seats = len(seats)
    occupied_count = sum(1 for s in seats if s["status"] == "OCCUPIED")
    empty_count = total_seats - occupied_count
    rate = f"{(occupied_count / max(1, total_seats) * 100):.0f}%"

    return {
        "success": True,
        "totalSeats": total_seats,
        "emptySeats": empty_count,
        "occupiedSeats": occupied_count,
        "occupancyRate": rate,
        "seats": seats,
        "persons": [p["box"] for p in person_detections],
        "belongings": belonging_detections,
        "imageDimensions": {"width": orig_w, "height": orig_h}
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YOLO Library Seat Detector")
    parser.add_argument("--image", required=True, help="Path to input image")
    parser.add_argument("--iou", type=float, default=0.25, help="IoU Occupancy Threshold")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    args = parser.parse_args()

    result = analyze_image(args.image, iou_thresh=args.iou, conf_thresh=args.conf)
    print(json.dumps(result))
