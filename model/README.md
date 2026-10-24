# AI Library Camera Vision: Side-Angled Empty Seat Detection (Prototype)

## Overview
This module enables automated empty seat detection in university library study halls using side-angled and perspective CCTV surveillance camera feeds.

Based on the research and methodology from [jasminekaur7/smart-library-seating-system](https://github.com/jasminekaur7/smart-library-seating-system), this implementation extends the concept specifically for **angled and perspective ceiling/corner library camera angles**.

---

## 1. Computer Vision & IoU Algorithm

In overhead and side-angled camera feeds, students sit with their head/torso overlapping the chair seat while their legs may extend beneath desk surfaces. To solve perspective distortion:

1. **Chair & Desk Detection:** Identifies physical chair boundary coordinates $[x_1, y_1, x_2, y_2]$.
2. **Person & Student Detection:** Identifies student torso and head coordinates.
3. **Perspective IoU (Intersection over Union):**
   $$\text{IoU} = \frac{\text{Area}(\text{Chair} \cap \text{Person})}{\text{Area}(\text{Chair} \cup \text{Person})}$$
4. **Classification Rule:**
   - If $\text{IoU} \ge \text{Threshold}$ (default $0.30$): **OCCUPIED** (Rendered in Red/Rose with overlap metric)
   - If $\text{IoU} < \text{Threshold}$: **VACANT / EMPTY SEAT** (Rendered in Emerald Green, incrementing the live empty count)

---

## 2. Model Trained From Scratch (`PerspectiveSeatNet v2.4`)

We provide full neural network code written from scratch in PyTorch:

- **Architecture:** [`model/model_architecture.py`](model_architecture.py)
  - Multi-Scale Residual Backbone with Feature Pyramid Network (FPN) heads:
    - $P_3$ Scale: Detects small, distant perspective desks in the background.
    - $P_4$ Scale: Midground desks and seated students.
    - $P_5$ Scale: Closest foreground seats.
- **Training Pipeline:** [`model/train_seat_model.py`](train_seat_model.py)
  - Synthetic library perspective dataset generator simulating CCTV angle skew, desk rows, and student occupancy.
  - Custom loss: Complete IoU (CIoU) loss for spatial bounding box localization + Binary Cross-Entropy with Logits for objectness + Focal Cross-Entropy for class imbalance.
  - AdamW optimizer with Cosine Annealing learning rate schedule.
- **Inference Engine:** [`model/seat_detector.py`](seat_detector.py)
  - Standalone command-line detector:
    ```bash
    python model/seat_detector.py --iou 0.30
    ```

---

## 3. Web Prototype Features on Front Page (`index.html`)

- **Drag-and-Drop Image Uploader:** Upload any side-angled library photo from your camera or computer.
- **3 Built-in Camera Presets:**
  - `Cam 01: Central Reading Hall (35° Side Angle)`
  - `Cam 02: Quiet Study Pods (45° Elevated CCTV)`
  - `Cam 03: Computer Lab Row Perspective (55° High Ceiling)`
- **Dynamic HUD Visualizer:** Real-time canvas overlay rendering green boxes on vacant seats and red boxes on occupied desks with 3D perspective guidelines.
- **IoU Slider & Angle Calibrator:** Adjust sensitivity in real-time (0.10 to 0.75).
- **Live Sync Button:** Synchronizes detected empty seat count directly with the Thapar Library Student Reservation floor plan.
- **API Endpoints:**
  - `GET /api/ai/model-info`: Specs and accuracy metrics.
  - `POST /api/ai/detect-seats`: Backend analysis endpoint.
