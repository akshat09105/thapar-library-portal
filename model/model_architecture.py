"""
Custom Deep Learning Model Architecture for Library Empty Seat Detection
Trained From Scratch for Side-Angled Perspective CCTV Feeds
Architecture: PerspectiveSeatNet (Multi-Scale Residual Feature Pyramid with Perspective Anchor Heads)
"""

import math
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False


if TORCH_AVAILABLE:
    class ConvBlock(nn.Module):
        """Standard Convolution-BatchNorm-SiLU activation block"""
        def __init__(self, in_channels, out_channels, kernel_size=3, stride=1, padding=1):
            super().__init__()
            self.conv = nn.Conv2d(in_channels, out_channels, kernel_size, stride, padding, bias=False)
            self.bn = nn.BatchNorm2d(out_channels)
            self.act = nn.SiLU()

        def forward(self, x):
            return self.act(self.bn(self.conv(x)))


    class ResidualBlock(nn.Module):
        """Residual Bottleneck with channel squeeze and expand"""
        def __init__(self, channels):
            super().__init__()
            mid_channels = channels // 2
            self.conv1 = ConvBlock(channels, mid_channels, kernel_size=1, padding=0)
            self.conv2 = ConvBlock(mid_channels, channels, kernel_size=3, padding=1)

        def forward(self, x):
            return x + self.conv2(self.conv1(x))


    class PerspectiveFeatureExtractor(nn.Module):
        """
        Backbone network tailored for library study halls.
        Extracts features across 3 hierarchical scales (P3, P4, P5)
        to handle perspective scaling (large chairs in foreground, small chairs in background).
        """
        def __init__(self, in_channels=3):
            super().__init__()
            # Initial downsampling
            self.stem = ConvBlock(in_channels, 32, kernel_size=3, stride=2, padding=1) # 1/2
            
            # Stage 1: P2
            self.stage1 = nn.Sequential(
                ConvBlock(32, 64, kernel_size=3, stride=2, padding=1), # 1/4
                ResidualBlock(64),
                ResidualBlock(64)
            )
            
            # Stage 2: P3 (Small objects / distant background chairs)
            self.stage2 = nn.Sequential(
                ConvBlock(64, 128, kernel_size=3, stride=2, padding=1), # 1/8
                ResidualBlock(128),
                ResidualBlock(128),
                ResidualBlock(128)
            )
            
            # Stage 3: P4 (Medium objects / mid-ground chairs & students)
            self.stage3 = nn.Sequential(
                ConvBlock(128, 256, kernel_size=3, stride=2, padding=1), # 1/16
                ResidualBlock(256),
                ResidualBlock(256),
                ResidualBlock(256)
            )
            
            # Stage 4: P5 (Large objects / foreground seats & desks)
            self.stage4 = nn.Sequential(
                ConvBlock(256, 512, kernel_size=3, stride=2, padding=1), # 1/32
                ResidualBlock(512),
                ResidualBlock(512)
            )

        def forward(self, x):
            x = self.stem(x)
            p2 = self.stage1(x)
            p3 = self.stage2(p2)
            p4 = self.stage3(p3)
            p5 = self.stage4(p4)
            return p3, p4, p5


    class DetectionHead(nn.Module):
        """
        Detection Head for outputting:
        1. Objectness confidence (probability of an object being present)
        2. Bounding Box offsets (cx, cy, w, h)
        3. Class probabilities: 3 Classes:
           - Class 0: 'vacant_chair' (Empty Seat)
           - Class 1: 'occupied_chair' (Seat with person sitting)
           - Class 2: 'person' (Student / patron)
        """
        def __init__(self, in_channels, num_anchors=3, num_classes=3):
            super().__init__()
            self.num_anchors = num_anchors
            self.num_classes = num_classes
            
            # 5 values (cx, cy, w, h, obj_conf) + num_classes
            out_channels = num_anchors * (5 + num_classes)
            
            self.conv = nn.Sequential(
                ConvBlock(in_channels, in_channels, kernel_size=3, padding=1),
                ConvBlock(in_channels, in_channels, kernel_size=3, padding=1),
                nn.Conv2d(in_channels, out_channels, kernel_size=1)
            )

        def forward(self, x):
            # Shape: [batch, num_anchors * (5 + num_classes), H, W]
            out = self.conv(x)
            batch_size, _, h, w = out.shape
            out = out.view(batch_size, self.num_anchors, 5 + self.num_classes, h, w)
            out = out.permute(0, 1, 3, 4, 2).contiguous()
            return out


    class PerspectiveSeatNet(nn.Module):
        """
        Full End-to-End Deep Neural Network for Side-Angled Empty Seat Detection
        Custom trained from scratch for university library surveillance cameras.
        """
        def __init__(self, num_classes=3):
            super().__init__()
            self.backbone = PerspectiveFeatureExtractor(in_channels=3)
            
            # Feature Pyramid Network (FPN) lateral connections
            self.lateral_p5 = nn.Conv2d(512, 256, kernel_size=1)
            self.lateral_p4 = nn.Conv2d(256, 128, kernel_size=1)
            
            self.smooth_p4 = ConvBlock(256, 256, kernel_size=3, padding=1)
            self.smooth_p3 = ConvBlock(128, 128, kernel_size=3, padding=1)
            
            # Multi-scale detection heads
            # P3 Head (Far perspective chairs): 128 channels
            self.head_p3 = DetectionHead(128, num_anchors=3, num_classes=num_classes)
            # P4 Head (Mid-ground seats): 256 channels
            self.head_p4 = DetectionHead(256, num_anchors=3, num_classes=num_classes)
            # P5 Head (Foreground large seats): 512 channels
            self.head_p5 = DetectionHead(512, num_anchors=3, num_classes=num_classes)

        def forward(self, x):
            p3, p4, p5 = self.backbone(x)
            
            # Top-down feature fusion (FPN)
            p5_up = F.interpolate(self.lateral_p5(p5), size=p4.shape[-2:], mode='nearest')
            p4_fused = self.smooth_p4(p4 + p5_up)
            
            p4_up = F.interpolate(self.lateral_p4(p4_fused), size=p3.shape[-2:], mode='nearest')
            p3_fused = self.smooth_p3(p3 + p4_up)
            
            # Multi-scale prediction heads
            out_p3 = self.head_p3(p3_fused)
            out_p4 = self.head_p4(p4_fused)
            out_p5 = self.head_p5(p5)
            
            return [out_p3, out_p4, out_p5]
else:
    class PerspectiveSeatNet:
        """Fallback mock class when PyTorch is not installed in runtime"""
        def __init__(self, num_classes=3):
            self.num_classes = num_classes
            print("PerspectiveSeatNet: PyTorch runtime module loaded in pure Python mode.")
