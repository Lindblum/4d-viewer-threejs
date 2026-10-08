import * as THREE from 'three';
import { Polytope } from './polytope.js';

export const SHAPES = [
  { id: '33', name: 'Tetrahedron', schlafli: '{3,3}' },
  { id: '34', name: 'Octahedron', schlafli: '{3,4}' },
  { id: '43', name: 'Cube', schlafli: '{4,3}' },
  { id: '35', name: 'Icosahedron', schlafli: '{3,5}' },
  { id: '53', name: 'Dodecahedron', schlafli: '{5,3}' },
  { id: '333', name: '5-cell', schlafli: '{3,3,3}' },
  { id: '334', name: '16-cell', schlafli: '{3,3,4}' },
  { id: '343', name: '24-cell', schlafli: '{3,4,3}' },
  { id: '433', name: 'Tesseract', schlafli: '{4,3,3}' },
  { id: '335', name: '600-cell', schlafli: '{3,3,5}' },
  { id: '533', name: '120-cell', schlafli: '{5,3,3}' },
];

export const DEFAULT_SHAPE_INDEX = 8;

// Rotation planes as [axisA, axisB, direction], matching the original viewer's
// spin. 3D shapes only turn in the xyz planes; 4D shapes also turn through w.
const PLANES_3D = [[1, 2, 1], [0, 2, -1], [0, 1, 1]];
const PLANES_4D = [[2, 3, -1], [1, 3, -1], [0, 3, -1]];

const _plane = new THREE.Matrix4();

function planeRotation(a, b, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const e = _plane.identity().elements; // column-major
  e[a * 4 + a] = c;
  e[b * 4 + a] = -s;
  e[a * 4 + b] = s;
  e[b * 4 + b] = c;
  return _plane;
}

/** Incremental 4D rotation for one frame, as a 4x4 matrix acting on (x,y,z,w). */
export function spinMatrix(dimension, angle, target = new THREE.Matrix4()) {
  target.identity();
  const planes = dimension >= 4 ? [...PLANES_3D, ...PLANES_4D] : PLANES_3D;
  for (const [a, b, dir] of planes) target.multiply(planeRotation(a, b, dir * angle));
  return target;
}

function directionColor(v) {
  const d = new THREE.Vector3(v.x, v.y, v.z);
  if (d.lengthSq() > 1e-12) d.normalize();
  return new THREE.Color().setRGB((d.x + 1) / 2, (d.y + 1) / 2, (d.z + 1) / 2, THREE.SRGBColorSpace);
}

/**
 * Builds render buffers for a regular polytope. Every face is fanned into
 * triangles around its centre, once per cell it bounds, and tinted by that
 * cell's direction. Positions are projected to 3D by dropping w.
 */
export function buildPolytope(index, radius = 1) {
  const shape = SHAPES[index];
  const poly = new Polytope();
  poly[`initPoly${shape.id}`]();

  const nVerts = poly.verts.length;
  const faceCenters = poly.faces.map((face) =>
    face.reduce((sum, v) => sum.add(poly.verts[v]), new THREE.Vector4()).divideScalar(face.length),
  );
  const scale = radius / poly.verts[0].length();
  // 4D rest positions: vertices followed by face centres
  const rest = [...poly.verts, ...faceCenters].map((v) => v.clone().multiplyScalar(scale));

  const singleCell = poly.cellFaces.length === 1;
  const source = [];
  const colors = [];
  const uvs = [];
  poly.cellFaces.forEach((cellFaces, c) => {
    const cellColor = directionColor(poly.cellCenters[c]);
    for (const f of cellFaces) {
      const face = poly.faces[f];
      // a lone 3D cell has no direction of its own, so tint by face instead
      const color = singleCell ? directionColor(faceCenters[f]) : cellColor;
      for (let q = 0; q < face.length; q++) {
        source.push(nVerts + f, face[q], face[(q + 1) % face.length]);
        // centre at v=0, rim at v=1: the alpha map brightens toward the edges
        uvs.push(0, 0, 0, 1, 1, 1);
        for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
      }
    }
  });

  const faceGeometry = new THREE.BufferGeometry();
  const facePositions = new THREE.BufferAttribute(new Float32Array(source.length * 3), 3);
  facePositions.setUsage(THREE.DynamicDrawUsage);
  faceGeometry.setAttribute('position', facePositions);
  faceGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  faceGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  faceGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);

  const current = rest.map((v) => v.clone());
  const rotation = new THREE.Matrix4();
  const step = new THREE.Matrix4();

  function writePositions() {
    const fp = facePositions.array;
    for (let i = 0; i < source.length; i++) {
      const v = current[source[i]];
      fp[i * 3] = v.x;
      fp[i * 3 + 1] = v.y;
      fp[i * 3 + 2] = v.z;
    }
    facePositions.needsUpdate = true;
  }
  writePositions();

  return {
    shape,
    dimension: poly.dimension,
    counts: {
      vertices: nVerts,
      edges: poly.edges.length,
      faces: poly.faces.length,
      cells: poly.dimension >= 4 ? poly.cellFaces.length : null,
    },
    // denser polytopes get fainter faces so the interior stays readable
    faceOpacity: Math.min(1, 3 / Math.sqrt(poly.faces.length)),
    faceGeometry,
    /** Advance the 4D rotation by `angle` radians per plane. */
    rotate(angle) {
      rotation.premultiply(spinMatrix(poly.dimension, angle, step));
      // rotate from the rest pose each frame so vertices never accumulate drift
      for (let i = 0; i < rest.length; i++) current[i].copy(rest[i]).applyMatrix4(rotation);
      writePositions();
    },
    dispose() {
      faceGeometry.dispose();
    },
  };
}
