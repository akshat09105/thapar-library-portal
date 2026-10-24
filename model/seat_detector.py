#!/usr/bin/env python3
"""
Seat Occupancy Detection Engine (Enhanced from jasminekaur7/smart-library-seating-system)
Optimized for Side-Angled Perspective Library Surveillance Cameras
"""

import os
import sys
import json
import math
import argparse

def calculate_iou(box1, box2):
    """
    Computes Intersection over Union (IoU) between two bounding boxes.
    Box format: [x1, y1, x2, y2]
    """
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    intersection_w = max(0, x2 - x1)
    intersection_h = max(0, y2 - y1)
    intersection_area = intersection_w * intersection_h

    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union_area = area1 + area2 - intersection_area

    if union_area <= 0:
        return 0.0
    return intersection_area / union_area


def calculate_perspective_overlap(chair_box, person_box, angle_factor=0.35):
    """
    For side-angled cameras, students sit with torso above chair seat and legs below desk.
    Calculates weighted IoU giving higher emphasis to horizontal alignment and lower-half overlap.
    """
    standard_iou = calculate_iou(chair_box, person_box)
    
    # Horizontal center alignment
    chair_cx = (chair_box[0] + chair_box[2]) / 2.0
    person_cx = (person_box[0] + person_box[2]) / 2.0
    chair_w = max(1.0, chair_box[2] - chair_box[0])
    center_dist_norm = abs(chair_cx - person_cx) / chair_w
    
    # Vertical overlap: person torso is typically inside or directly above chair
    v_overlap = max(0, min(chair_box[3], person_box[3]) - max(chair_box[1], person_box[1]))
    chair_h = max(1.0, chair_box[3] - chair_box[1])
    v_ratio = v_overlap / chair_h
    
    if center_dist_norm < 0.6 and v_ratio > 0.25:
        # High confidence that person is sitting in this chair
        effective_iou = max(standard_iou, 0.45)
    else:
        effective_iou = standard_iou
        
    return effective_iou


def analyze_seats(chair_boxes, person_boxes, iou_threshold=0.30):
    """
    Determines vacant vs occupied chairs using IoU algorithm.
    Enhanced from seat_detector/detector.py in SeatSight.
    """
    vacant_chairs = []
    occupied_chairs = []
    
    for i, chair in enumerate(chair_boxes):
        is_occupied = False
        max_iou = 0.0
        matching_person_idx = -1
        
        for j, person in enumerate(person_boxes):
            iou = calculate_perspective_overlap(chair, person)
            if iou > max_iou:
                max_iou = iou
            if iou >= iou_threshold:
                is_occupied = True
                matching_person_idx = j
                break
                
        seat_info = {
            "seat_id": f"SEAT-{i+1:02d}",
            "box": chair,
            "iou_with_person": round(max_iou, 3),
            "status": "OCCUPIED" if is_occupied else "VACANT",
            "confidence": round(0.85 + (max_iou * 0.12 if is_occupied else 0.10), 2)
        }
        
        if is_occupied:
            occupied_chairs.append(seat_info)
        else:
            vacant_chairs.append(seat_info)
            
    return {
        "total_seats": len(chair_boxes),
        "empty_seats": len(vacant_chairs),
        "occupied_seats": len(occupied_chairs),
        "occupancy_rate": f"{(len(occupied_chairs) / max(1, len(chair_boxes)) * 100):.1f}%",
        "vacant_list": vacant_chairs,
        "occupied_list": occupied_chairs
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze Empty Seats from Library Camera")
    parser.add_argument("--iou", type=float, default=0.30, help="IoU Threshold")
    args = parser.parse_args()
    
    # Sample side-angled perspective test chairs
    demo_chairs = [
        [120, 280, 220, 420], # Row 1 Near
        [280, 290, 380, 430],
        [440, 300, 540, 440],
        [150, 180, 230, 270], # Row 2 Mid
        [270, 190, 350, 280],
        [390, 200, 470, 290],
        [180, 110, 230, 170], # Row 3 Far
        [260, 115, 310, 175]
    ]
    
    # People sitting in some of the chairs
    demo_people = [
        [130, 250, 215, 410], # sitting in chair 0
        [445, 270, 535, 435], # sitting in chair 2
        [275, 170, 345, 275]  # sitting in chair 4
    ]
    
    result = analyze_seats(demo_chairs, demo_people, iou_threshold=args.iou)
    print("=" * 60)
    print("  LIBRARY CCTV SEAT DETECTION ANALYSIS RESULTS")
    print("=" * 60)
    print(f"Total Seats Detected:   {result['total_seats']}")
    print(f"Empty / Vacant Seats:  {result['empty_seats']}  <-- AVAILABLE")
    print(f"Occupied Seats:        {result['occupied_seats']}")
    print(f"Occupancy Percentage:  {result['occupancy_rate']}")
    print("-" * 60)
    print("DETAILED SEAT MAP:")
    for s in result["vacant_list"]:
        print(f"  [EMPTY]    {s['seat_id']}: Box={s['box']}, Conf={s['confidence']}")
    for s in result["occupied_list"]:
        print(f"  [OCCUPIED] {s['seat_id']}: Box={s['box']}, IoU={s['iou_with_person']}, Conf={s['confidence']}")
    print("=" * 60)
