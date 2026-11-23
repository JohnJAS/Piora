"""Bake corresponding arm cross sections and one distance field per painted cel."""

from itertools import combinations

import cv2
import numpy as np
from PIL import Image


DISTANCE_RANGE = 20


def triangles(count):
    return [[a, a + 1, a + 3] for a in range(0, count * 2 - 2, 2)] + [
        [a, a + 3, a + 2] for a in range(0, count * 2 - 2, 2)
    ]


def areas(points, indices):
    a, b, c = np.moveaxis(points[indices], 1, 0)
    u, v = b - a, c - a
    return u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]


def minimum_area(poses, indices):
    """Find each triangle's minimum signed double area over the blend simplex."""
    pure = np.array([areas(pose, indices) for pose in poses]).T
    quadratic = np.zeros((len(indices), len(poses), len(poses)))
    for i in range(len(poses)):
        quadratic[:, i, i] = pure[:, i]
        for j in range(i):
            midpoint = areas((poses[i] + poses[j]) * 0.5, indices)
            coefficient = 2 * midpoint - (pure[:, i] + pure[:, j]) * 0.5
            quadratic[:, i, j] = quadratic[:, j, i] = coefficient
    minimum = float(pure.min())
    for matrix in quadratic:
        for count in range(2, len(poses) + 1):
            for subset in combinations(range(len(poses)), count):
                system = np.ones((count + 1, count + 1))
                system[:-1, :-1] = matrix[np.ix_(subset, subset)]
                system[-1, -1] = 0
                rhs = np.zeros(count + 1)
                rhs[-1] = 1
                try:
                    weights = np.linalg.solve(system, rhs)[:-1]
                except np.linalg.LinAlgError:
                    continue
                if weights.min() >= 0:
                    minimum = min(minimum, float(weights @ system[:-1, :-1] @ weights))
    return minimum


def correspondence(hands, attachment):
    source = np.array([spec["crossSections"] for spec in hands], dtype=float)
    if source.shape != (4, 10, 2, 2):
        raise ValueError("Each arm cel needs ten pairs of corresponding points")
    source = source.reshape(4, -1, 2)
    stage = source.copy().reshape(4, -1, 2, 2)
    offset = np.array(attachment) - stage[:, 0]
    for row, share in enumerate((1, 0.64, 0.17)):
        stage[:, row] += offset * share
    for index, spec in enumerate(hands):
        if "stageOffsets" in spec:
            stage[index] += np.array(spec["stageOffsets"])[:, None, :]
    stage = stage.reshape(source.shape)
    indices = np.array(triangles(source.shape[1] // 2))
    source_area = float(min(areas(pose, indices).min() for pose in source))
    blend_area = minimum_area(stage, indices)
    if min(source_area, blend_area) <= 0:
        raise ValueError(f"Folded arm triangle (source: {source_area:.2f}, blended: {blend_area:.2f})")
    return {
        "source": source.tolist(),
        "stage": np.round(stage, 3).tolist(),
    }, {"minSourceTriangleDoubleArea": source_area, "minBlendTriangleDoubleArea": blend_area}


def distance_texture(art, matte=None):
    """Use distance for coverage and extend the closest painted colour across an edge."""
    pixels = np.array(art)
    coverage = pixels[:, :, 3] >= 128
    if matte is not None:
        coverage &= matte
    _, labels, sizes, _ = cv2.connectedComponentsWithStats(coverage.astype(np.uint8), connectivity=8)
    coverage = labels == (1 + np.argmax(sizes[1:, cv2.CC_STAT_AREA]))
    inside = cv2.distanceTransform(coverage.astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    outside, nearest = cv2.distanceTransformWithLabels(
        (~coverage).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL
    )
    color = np.zeros((nearest.max() + 1, 3), dtype=np.uint8)
    color[nearest[coverage]] = pixels[coverage, :3]
    pixels[:, :, :3] = color[nearest]
    signed = np.where(coverage, inside - 0.5, 0.5 - outside)
    alpha = np.round(np.clip(0.5 + signed / (2 * DISTANCE_RANGE), 0, 1) * 255).astype(np.uint8)
    pixels[:, :, 3] = alpha
    pixels[alpha == 0] = 0
    return Image.fromarray(pixels), int(coverage.sum())


def preview_pose(field, rect, source, stage):
    """Draw a baked endpoint with the same triangles and coverage as the GPU."""
    width, height = rect[2:]
    origin = np.array(rect[:2])
    image = np.array(field)
    out = np.zeros_like(image)
    source = np.array(source, dtype=np.float32) - origin
    stage = np.array(stage, dtype=np.float32) - origin
    for triangle in triangles(len(source) // 2):
        dest = stage[triangle].astype(np.float32)
        mapped = cv2.warpAffine(
            image, cv2.getAffineTransform(source[triangle].astype(np.float32), dest), (width, height),
            flags=cv2.INTER_LINEAR
        )
        mask = cv2.fillConvexPoly(np.zeros((height, width), dtype=np.uint8), np.round(dest).astype(np.int32), 1)
        out[mask != 0] = mapped[mask != 0]
    distance = (out[:, :, 3].astype(np.float32) / 255 - 0.5) * (2 * DISTANCE_RANGE)
    alpha = np.clip(0.5 + distance / 1.7, 0, 1)
    out[:, :, 3] = np.round(alpha * 255).astype(np.uint8)
    return Image.fromarray(out)
