import type { CharacterWallpaperRig, Region } from "./character-wallpaper-rigs";

function ease(t: number) {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
}

function regionWeight(x: number, y: number, [cx, cy, rx, ry]: Region) {
  const distance = Math.hypot((x - cx) / rx, (y - cy) / ry);
  // The central part of a feature follows one rigid transform.
  return ease((1 - distance) / 0.42);
}

export function createCharacterMesh(width: number, height: number, rig: CharacterWallpaperRig) {
  // The large area to the left of the portrait has no deformers. Cover it
  // with one column of quads, keeping small triangles around the subject.
  const regions = [rig.head, rig.chest, ...rig.sway];
  const left = Math.max(0, Math.floor(Math.min(...regions.map(([x, , rx]) => x - rx))) - 12);
  const columns = Math.min(254, Math.ceil((width - left) / 10));
  const rows = Math.min(255, Math.ceil(height / 10));
  const stepX = (width - left) / columns;
  const stepY = height / rows;
  const cellDiagonal = Math.hypot(stepX, stepY);
  const gutter = left > 0 ? 1 : 0;
  const stride = columns + gutter + 1;
  const vertices = new Float32Array(stride * (rows + 1) * 6);
  const indices = new Uint16Array((stride - 1) * rows * 6);
  let vertex = 0;
  let index = 0;
  for (let row = 0; row <= rows; row++) {
    const y = row * stepY;
    for (let column = 0; column < stride; column++) {
      const x = column < gutter ? 0 : left + (column - gutter) * stepX;
      vertices[vertex++] = x;
      vertices[vertex++] = y;
      const edgeDistance = Math.min(x, y, width - x, height - y);
      const face = rig.rigidFace;
      const faceFree = face
        ? ease((Math.hypot((x - face[0]) / face[2], (y - face[1]) / face[3]) - 1) / 0.42)
        : 1;
      // A cheek or lip resting on another object must keep that contact even
      // when an adjacent strand of hair has a nonzero secondary weight.
      let pinDistance = rig.headContact
        ? Math.hypot(x - rig.headContact[0], y - rig.headContact[1]) - cellDiagonal - 6
        : Infinity;
      for (const [ax, ay, bx, by, radius] of rig.pins) {
        const dx = bx - ax;
        const dy = by - ay;
        const fraction = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const distance = Math.hypot(x - ax - fraction * dx, y - ay - fraction * dy);
        // Pin all three vertices of any triangle touching a protected pixel,
        // then blend back into the moving fabric outside that boundary.
        pinDistance = Math.min(pinDistance, distance - radius - cellDiagonal);
      }
      // Head rotation travels farther from its pivot than breathing moves a
      // shirt. Ease it over a wider band next to a hand or the frame edge.
      const headFree = faceFree * ease(Math.min(edgeDistance, pinDistance) / 58);
      const free = faceFree * ease(Math.min(edgeDistance, pinDistance) / 28);
      const head = regionWeight(x, y, rig.head);
      const chest = (1 - head) * regionWeight(x, y, rig.chest);
      vertices[vertex++] = headFree * head;
      // Carry the whole painted face slightly with the torso's breath. A
      // uniform translation preserves eye, nose, mouth and jaw spacing.
      vertices[vertex++] = free * chest + (1 - faceFree) * 0.26;
      vertices[vertex++] = free * (1 - head) * regionWeight(x, y, rig.sway[0]);
      vertices[vertex++] = free * (1 - head) * regionWeight(x, y, rig.sway[1]);
      if (column + 1 < stride && row < rows) {
        const i = row * stride + column;
        indices[index++] = i;
        indices[index++] = i + stride;
        indices[index++] = i + 1;
        indices[index++] = i + 1;
        indices[index++] = i + stride;
        indices[index++] = i + stride + 1;
      }
    }
  }
  return { vertices, indices };
}
