const svg = document.querySelector("#profileCanvas");
const selectedLabel = document.querySelector("#selectedLabel");
const selectedMeta = document.querySelector("#selectedMeta");
const controlsTitle = document.querySelector("#controlsTitle");
const controlsRoot = document.querySelector("#sectionControls");
const rangeTemplate = document.querySelector("#rangeControlTemplate");
const clayEstimate = document.querySelector("#clayEstimate");
const clayEstimateValue = document.querySelector("#clayEstimateValue");
const shrinkageInput = document.querySelector("#shrinkageInput");
const finishedBasis = document.querySelector("#finishedBasis");
const wetBasis = document.querySelector("#wetBasis");
const uniformWallToggle = document.querySelector("#uniformWallToggle");
const uniformWallControl = document.querySelector("#uniformWallControl");
const outerLineButton = document.querySelector("#outerLineButton");
const innerLineButton = document.querySelector("#innerLineButton");
const pointModeButton = document.querySelector("#pointModeButton");
const segmentModeButton = document.querySelector("#segmentModeButton");
const addPointButton = document.querySelector("#addPointButton");
const deletePointButton = document.querySelector("#deletePointButton");
const bottomInspector = document.querySelector("#bottomInspector");
const inspectorToggle = document.querySelector("#inspectorToggle");
const compactSelectedButton = document.querySelector("#compactSelectedButton");
const compactSelectedLabel = document.querySelector("#compactSelectedLabel");
const compactLineButtons = document.querySelectorAll("[data-compact-line]");
const compactKindButtons = document.querySelectorAll("[data-compact-kind]");
const arQuickLookLink = document.querySelector("#arQuickLookLink");

const baseViewBox = {
  x: 0,
  y: -80,
  width: 588,
  height: 720
};

const canvasView = { ...baseViewBox };
const activePointers = new Map();
const storageKey = "clayform:design:v1";
const persistedStateKeys = [
  "basis",
  "editingLine",
  "selectedKind",
  "selectedPointId",
  "selectedSegmentId",
  "inspectorState",
  "uniformWall",
  "shrinkage",
  "wallThickness",
  "rimThickness",
  "floorThickness",
  "footRingWidth",
  "margin",
  "clayDensity",
  "nextPointId",
  "outerPoints",
  "innerPoints",
  "segmentStyles",
  "segmentCurves",
  "pointJoints"
];

const state = {
  basis: "finished",
  editingLine: "outer",
  selectedKind: "point",
  selectedPointId: "belly",
  selectedSegmentId: "belly-lower",
  inspectorState: "expanded",
  uniformWall: true,
  shrinkage: 12,
  wallThickness: 0.25,
  rimThickness: 0.22,
  floorThickness: 0.42,
  footRingWidth: 0.3,
  margin: 15,
  clayDensity: 0.06,
  nextPointId: 1,
  outerPoints: [
    { id: "rim", label: "Rim", height: 7.25, radius: 1.75, fixed: "top" },
    { id: "shoulder", label: "Shoulder", height: 5.8, radius: 2.1 },
    { id: "belly", label: "Belly", height: 3.65, radius: 2.625 },
    { id: "lower", label: "Lower", height: 1.6, radius: 1.55 },
    { id: "foot", label: "Foot", height: 0.38, radius: 1.125 },
    { id: "base", label: "Base", height: 0, radius: 1.125, fixed: "base" }
  ],
  innerPoints: [],
  segmentStyles: {
    "rim-shoulder": "curve",
    "shoulder-belly": "curve",
    "belly-lower": "curve",
    "lower-foot": "curve",
    "foot-base": "straight"
  },
  segmentCurves: {
    "outer:rim-shoulder": { height: 6.55, radius: 1.78 },
    "outer:shoulder-belly": { height: 4.72, radius: 2.72 },
    "outer:belly-lower": { height: 2.66, radius: 2.42 },
    "outer:lower-foot": { height: 0.96, radius: 1.18 }
  },
  pointJoints: {}
};

const outerOnlyPointIds = new Set(["foot", "base"]);

let dragHandle = null;
let sheetDrag = null;
let panGesture = null;
let pinchGesture = null;
let suppressCanvasClick = false;
let suppressSheetClick = false;
let lastInspectorContext = "";
let persistenceTimer = null;
let arModelUrl = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function snapToStep(value, step) {
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

function shrinkFactor() {
  return Math.max(0.01, 1 - state.shrinkage / 100);
}

function activeSize(finishedValue) {
  return state.basis === "finished" ? finishedValue : finishedValue / shrinkFactor();
}

function inches(value) {
  return `${value.toFixed(2)} in`;
}

function dimensionText(finishedValue) {
  return inches(activeSize(finishedValue));
}

function outputText(finishedValue) {
  return inches(activeSize(finishedValue));
}

function titleCase(text) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function cloneForPersistence(value) {
  return JSON.parse(JSON.stringify(value));
}

function persistedStateSnapshot() {
  return persistedStateKeys.reduce((snapshot, key) => {
    snapshot[key] = cloneForPersistence(state[key]);
    return snapshot;
  }, {});
}

function persistDesignNow() {
  if (persistenceTimer) {
    window.clearTimeout(persistenceTimer);
    persistenceTimer = null;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      state: persistedStateSnapshot(),
      canvasView: cloneForPersistence(canvasView),
      savedAt: new Date().toISOString()
    }));
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

function schedulePersistDesign() {
  if (persistenceTimer) {
    window.clearTimeout(persistenceTimer);
  }

  persistenceTimer = window.setTimeout(persistDesignNow, 120);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function restorePersistedCanvasView(savedCanvasView) {
  if (!isRecord(savedCanvasView)) {
    return;
  }

  const nextView = {
    x: Number(savedCanvasView.x),
    y: Number(savedCanvasView.y),
    width: Number(savedCanvasView.width),
    height: Number(savedCanvasView.height)
  };

  if (Object.values(nextView).every(Number.isFinite)) {
    setCanvasView(nextView);
  }
}

function restorePersistedDesign() {
  try {
    const rawDesign = window.localStorage.getItem(storageKey);

    if (!rawDesign) {
      return;
    }

    const savedDesign = JSON.parse(rawDesign);

    if (!isRecord(savedDesign) || savedDesign.version !== 1 || !isRecord(savedDesign.state)) {
      return;
    }

    if (
      !Array.isArray(savedDesign.state.outerPoints)
      || !Array.isArray(savedDesign.state.innerPoints)
      || !isRecord(savedDesign.state.segmentStyles)
      || !isRecord(savedDesign.state.segmentCurves)
      || !isRecord(savedDesign.state.pointJoints)
    ) {
      return;
    }

    persistedStateKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(savedDesign.state, key)) {
        state[key] = savedDesign.state[key];
      }
    });
    restorePersistedCanvasView(savedDesign.canvasView);
    normalizeState();
  } catch {
    // Ignore corrupted saved data and continue with the built-in starter form.
  }
}

function arScale(value) {
  return activeSize(value) * 0.0254;
}

function sampleProfileForAr(line, points) {
  const samples = [];

  points.slice(0, -1).forEach((point, index) => {
    const nextPoint = points[index + 1];
    const segmentId = segmentKey(point.id, nextPoint.id);
    const style = styleForLineSegment(line, point.id, nextPoint.id);

    if (index === 0) {
      samples.push({ radius: point.radius, height: point.height });
    }

    if (style !== "curve") {
      samples.push({ radius: nextPoint.radius, height: nextPoint.height });
      return;
    }

    const control = ensureCurveControlForLine(line, segmentId, point, nextPoint);
    for (let step = 1; step <= 10; step += 1) {
      const t = step / 10;
      samples.push(quadraticPoint(point, control, nextPoint, t));
    }
  });

  return samples;
}

function compactArProfile(points) {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    const previous = points[index - 1];
    return Math.hypot(point.radius - previous.radius, point.height - previous.height) > 0.002;
  });
}

function arProfileLoop() {
  normalizeState();
  const outerProfile = compactArProfile(sampleProfileForAr("outer", state.outerPoints));
  const innerProfile = compactArProfile(sampleProfileForAr("inner", innerProfilePoints()));
  const outerBase = outerProfile.at(-1);
  const innerFloor = innerProfile.at(-1);

  if (!outerBase || !innerFloor || outerProfile.length < 2 || innerProfile.length < 2) {
    return [];
  }

  return compactArProfile([
    ...outerProfile,
    { radius: 0, height: outerBase.height },
    { radius: 0, height: innerFloor.height },
    ...[...innerProfile].reverse()
  ]);
}

function buildArMesh() {
  const radialSegments = 64;
  const profile = arProfileLoop();
  const points = [];
  const faceVertexCounts = [];
  const faceVertexIndices = [];

  profile.forEach((profilePoint) => {
    const radius = arScale(profilePoint.radius);
    const height = arScale(profilePoint.height);

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      points.push([
        radius * Math.cos(angle),
        height,
        radius * Math.sin(angle)
      ]);
    }
  });

  for (let ring = 0; ring < profile.length; ring += 1) {
    const nextRing = (ring + 1) % profile.length;

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const nextSegment = (segment + 1) % radialSegments;
      const a = ring * radialSegments + segment;
      const b = ring * radialSegments + nextSegment;
      const c = nextRing * radialSegments + nextSegment;
      const d = nextRing * radialSegments + segment;
      faceVertexCounts.push(4);
      faceVertexIndices.push(a, b, c, d);
    }
  }

  const maxRadius = Math.max(...profile.map((point) => arScale(point.radius)));
  const maxHeight = Math.max(...profile.map((point) => arScale(point.height)));

  return { points, faceVertexCounts, faceVertexIndices, maxRadius, maxHeight };
}

function usdNumber(value) {
  return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

function usdArray(values) {
  return values.join(", ");
}

function usdPoint(point) {
  return `(${usdNumber(point[0])}, ${usdNumber(point[1])}, ${usdNumber(point[2])})`;
}

function buildUsdModel() {
  const mesh = buildArMesh();

  return `#usda 1.0
(
    defaultPrim = "ClayFormPot"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "ClayFormPot"
{
    def Mesh "Body"
    {
        uniform bool doubleSided = true
        uniform token subdivisionScheme = "none"
        float3[] extent = [(${usdNumber(-mesh.maxRadius)}, 0, ${usdNumber(-mesh.maxRadius)}), (${usdNumber(mesh.maxRadius)}, ${usdNumber(mesh.maxHeight)}, ${usdNumber(mesh.maxRadius)})]
        point3f[] points = [${mesh.points.map(usdPoint).join(", ")}]
        int[] faceVertexCounts = [${usdArray(mesh.faceVertexCounts)}]
        int[] faceVertexIndices = [${usdArray(mesh.faceVertexIndices)}]
        rel material:binding = </ClayFormPot/ClayMaterial>
    }

    def Material "ClayMaterial"
    {
        token outputs:surface.connect = </ClayFormPot/ClayMaterial/PreviewSurface.outputs:surface>

        def Shader "PreviewSurface"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (0.64, 0.51, 0.35)
            float inputs:roughness = 0.88
            token outputs:surface
        }
    }
}
`;
}

function crc32(bytes) {
  let crc = -1;

  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11)
    | (date.getMinutes() << 5)
    | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9)
    | ((date.getMonth() + 1) << 5)
    | date.getDate();

  return { time, date: dosDate };
}

function writeBytes(target, offset, source) {
  target.set(source, offset);
  return offset + source.length;
}

function zipLocalExtraLength(offset, fileNameLength) {
  const unpaddedOffset = offset + 30 + fileNameLength;
  const padding = (64 - (unpaddedOffset % 64)) % 64;
  return padding >= 4 ? padding : 0;
}

function zipPaddingExtra(length) {
  if (length === 0) {
    return new Uint8Array();
  }

  const extra = new Uint8Array(length);
  const view = new DataView(extra.buffer);
  view.setUint16(0, 0x1986, true);
  view.setUint16(2, length - 4, true);
  return extra;
}

function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const timestamp = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const localExtra = zipPaddingExtra(zipLocalExtraLength(offset, nameBytes.length));
    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    const checksum = crc32(entry.data);
    const localOffset = offset;

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, timestamp.time, true);
    localView.setUint16(12, timestamp.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, localExtra.length, true);

    localParts.push(localHeader, nameBytes, localExtra, entry.data);
    offset += localHeader.length + nameBytes.length + localExtra.length + entry.data.length;

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, timestamp.time, true);
    centralView.setUint16(14, timestamp.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralParts.push(centralHeader, nameBytes);
  });

  const centralDirectoryOffset = offset;
  centralParts.forEach((part) => {
    offset += part.length;
  });
  const centralDirectorySize = offset - centralDirectoryOffset;
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, centralDirectoryOffset, true);
  endView.setUint16(20, 0, true);

  const archive = new Uint8Array(offset + endHeader.length);
  let writeOffset = 0;
  [...localParts, ...centralParts, endHeader].forEach((part) => {
    writeOffset = writeBytes(archive, writeOffset, part);
  });

  return archive;
}

function buildUsdzBlob() {
  const usda = new TextEncoder().encode(buildUsdModel());
  const archive = createStoredZip([{ name: "ClayFormPot.usda", data: usda }]);
  return new Blob([archive], { type: "model/vnd.usdz+zip" });
}

function prepareArQuickLookLink(event) {
  try {
    const blob = buildUsdzBlob();
    if (arModelUrl) {
      URL.revokeObjectURL(arModelUrl);
    }
    arModelUrl = URL.createObjectURL(blob);
    arQuickLookLink.href = arModelUrl;
    arQuickLookLink.download = `clayform-pot-${state.basis}-actual-size.usdz`;
  } catch (error) {
    event.preventDefault();
    console.error("Unable to create AR model", error);
  }
}

function isOuterOnlyPoint(pointOrId) {
  const id = typeof pointOrId === "string" ? pointOrId : pointOrId?.id;
  return outerOnlyPointIds.has(id) || Boolean(pointOrId?.outerOnly);
}

function isOuterOnlySegment(first, second) {
  return isOuterOnlyPoint(first) || isOuterOnlyPoint(second);
}

function footReferencePoint() {
  return state.outerPoints.find((point) => point.id === "foot")
    || state.outerPoints.at(-1)
    || state.outerPoints[0];
}

function sortedPoints(points) {
  return [...points].sort((a, b) => b.height - a.height);
}

function highestOuterPoint() {
  return state.outerPoints.reduce((highest, point) => (
    point.height > highest.height ? point : highest
  ), state.outerPoints[0]);
}

function maxOuterHeight() {
  return highestOuterPoint()?.height || 0;
}

function segmentKey(firstId, secondId) {
  return `${firstId}-${secondId}`;
}

function reverseSegmentKey(segmentId) {
  const [first, second] = segmentId.split("-");
  return segmentKey(second, first);
}

function segmentKeyIncludesPoint(segmentId, pointId) {
  const [firstId, secondId] = segmentId.split("-");
  return firstId === pointId || secondId === pointId;
}

function styleForSegment(firstId, secondId) {
  const style = state.segmentStyles[segmentKey(firstId, secondId)]
    || state.segmentStyles[segmentKey(secondId, firstId)]
    || "curve";

  if (style === "smooth") {
    return "curve";
  }

  if (style === "corner") {
    return "straight";
  }

  return style;
}

function outerSegmentIdForInner(segmentId) {
  const [firstId, secondId] = segmentId.split("-");
  const footId = footReferencePoint()?.id || "foot";
  const mapPointId = (pointId) => (pointId === "floor" ? footId : pointId);

  return segmentKey(mapPointId(firstId), mapPointId(secondId));
}

function segmentStyleKeyForLine(line, segmentId) {
  if (state.uniformWall && line === "inner") {
    return outerSegmentIdForInner(segmentId);
  }

  return segmentId;
}

function styleForLineSegment(line, firstId, secondId) {
  const segmentId = segmentStyleKeyForLine(line, segmentKey(firstId, secondId));
  return styleForSegment(...segmentId.split("-"));
}

function setSegmentStyle(segmentId, style) {
  setSegmentStyleForLine(state.editingLine, segmentId, style);
}

function setSegmentStyleForLine(line, segmentId, style) {
  const styleSegmentId = segmentStyleKeyForLine(line, segmentId);
  state.segmentStyles[styleSegmentId] = style;
  delete state.segmentStyles[reverseSegmentKey(styleSegmentId)];

  if (style === "curve") {
    ensureCurveControlForLine(line, segmentId);
  }
}

function pointIndex(points, pointId) {
  return points.findIndex((point) => point.id === pointId);
}

function activeLinePoints() {
  return state.editingLine === "outer" ? state.outerPoints : innerProfilePoints();
}

function selectedPoint() {
  const points = activeLinePoints();
  return points.find((point) => point.id === state.selectedPointId) || points[0];
}

function selectedSegmentPoints() {
  const points = activeLinePoints();
  const [firstId, secondId] = state.selectedSegmentId.split("-");
  const first = points.find((point) => point.id === firstId);
  const second = points.find((point) => point.id === secondId);

  if (first && second) {
    return [first, second];
  }

  return [points[0], points[1]].filter(Boolean);
}

function selectedSegmentIdForPoint(pointId) {
  const points = activeLinePoints();
  const index = pointIndex(points, pointId);

  if (index >= 0 && index < points.length - 1) {
    return segmentKey(points[index].id, points[index + 1].id);
  }

  if (index > 0) {
    return segmentKey(points[index - 1].id, points[index].id);
  }

  return state.selectedSegmentId;
}

function pointJoint(pointId) {
  return state.pointJoints[pointId] || {
    type: "smooth",
    angle: "free",
    orientation: "prev-horizontal"
  };
}

function setPointJoint(pointId, updates) {
  const current = pointJoint(pointId);
  state.pointJoints[pointId] = {
    ...current,
    ...updates
  };
}

function adjacentPointsForPoint(line, pointId) {
  const points = line === "outer" ? state.outerPoints : innerProfilePoints();
  const index = pointIndex(points, pointId);

  if (index < 0) {
    return { points, index, point: null, previous: null, next: null };
  }

  return {
    points,
    index,
    point: points[index],
    previous: points[index - 1] || null,
    next: points[index + 1] || null
  };
}

function setPointHeight(point, height) {
  if (!point || point.fixed === "base") {
    return;
  }

  point.height = height;
}

function setPointRadius(point, radius) {
  if (!point) {
    return;
  }

  point.radius = radius;
}

function constrainRightAngle(line, pointId) {
  const { point, previous, next } = adjacentPointsForPoint(line, pointId);

  if (!point || !previous || !next) {
    return;
  }

  const joint = pointJoint(pointId);

  if (joint.orientation === "next-horizontal") {
    setPointRadius(previous, point.radius);
    setPointHeight(next, point.height);
    return;
  }

  setPointHeight(previous, point.height);
  setPointRadius(next, point.radius);
}

function applyPointJoint(line, pointId) {
  const joint = state.pointJoints[pointId];

  if (!joint) {
    return;
  }

  const { point, previous, next } = adjacentPointsForPoint(line, pointId);

  if (!point || !previous || !next) {
    return;
  }

  const previousSegmentId = segmentKey(previous.id, point.id);
  const nextSegmentId = segmentKey(point.id, next.id);

  if (joint.type === "smooth") {
    setSegmentStyleForLine(line, previousSegmentId, "curve");
    setSegmentStyleForLine(line, nextSegmentId, "curve");
    return;
  }

  setSegmentStyleForLine(line, previousSegmentId, "straight");
  setSegmentStyleForLine(line, nextSegmentId, "straight");

  if (joint.angle === "right") {
    constrainRightAngle(line, pointId);
  }
}

function applyPointJointsTouchingPoint(line, pointId) {
  const { points, index } = adjacentPointsForPoint(line, pointId);

  [index - 1, index, index + 1].forEach((candidateIndex) => {
    const point = points[candidateIndex];

    if (point) {
      applyPointJoint(line, point.id);
    }
  });
}

function normalizeOuterPoints() {
  state.outerPoints.forEach((point) => {
    point.radius = clamp(point.radius, 0.25, 4);

    if (point.fixed === "base") {
      point.height = 0;
      return;
    }

    point.height = clamp(point.height, 0, 10);
  });
}

function thicknessForPoint(point) {
  return point?.id === "rim" ? state.rimThickness : state.wallThickness;
}

function radialInnerPointFromOuter(point) {
  const thickness = thicknessForPoint(point);

  return {
    id: point.id,
    label: `Inner ${point.label}`,
    height: point.height,
    radius: Math.max(0.12, point.radius - thickness)
  };
}

function inwardNormalForVector(deltaRadius, deltaHeight) {
  const length = Math.hypot(deltaRadius, deltaHeight);

  if (length < 0.001) {
    return { radius: -1, height: 0 };
  }

  let normal = {
    radius: deltaHeight / length,
    height: -deltaRadius / length
  };

  if (normal.radius > 0.001) {
    normal = {
      radius: -normal.radius,
      height: -normal.height
    };
  }

  return normal;
}

function inwardNormalForSegment(first, second) {
  return inwardNormalForVector(
    second.radius - first.radius,
    second.height - first.height
  );
}

function offsetPoint(point, normal, thickness = thicknessForPoint(point)) {
  return {
    height: point.height + normal.height * thickness,
    radius: Math.max(0.12, point.radius + normal.radius * thickness)
  };
}

function curveControlForOuterSegment(first, second) {
  return ensureSegmentCurveControl("outer", segmentKey(first.id, second.id), first, second);
}

function tangentVectorForSegmentEndpoint(first, second, endpoint) {
  if (styleForSegment(first.id, second.id) !== "curve") {
    return {
      radius: second.radius - first.radius,
      height: second.height - first.height
    };
  }

  const control = curveControlForOuterSegment(first, second);
  const tangent = endpoint === "start"
    ? {
      radius: control.radius - first.radius,
      height: control.height - first.height
    }
    : {
      radius: second.radius - control.radius,
      height: second.height - control.height
    };

  if (Math.hypot(tangent.radius, tangent.height) < 0.001) {
    return {
      radius: second.radius - first.radius,
      height: second.height - first.height
    };
  }

  return tangent;
}

function offsetTangentLineForSegmentEndpoint(first, second, endpoint) {
  const sourcePoint = endpoint === "start" ? first : second;
  const tangent = tangentVectorForSegmentEndpoint(first, second, endpoint);
  const normal = inwardNormalForVector(tangent.radius, tangent.height);
  const shiftedPoint = offsetPoint(sourcePoint, normal);

  return {
    start: shiftedPoint,
    end: {
      radius: shiftedPoint.radius + tangent.radius,
      height: shiftedPoint.height + tangent.height
    },
    anchor: shiftedPoint
  };
}

function offsetLineForSegment(first, second) {
  const normal = inwardNormalForSegment(first, second);

  return {
    start: offsetPoint(first, normal),
    end: offsetPoint(second, normal)
  };
}

function lineIntersection(firstLine, secondLine) {
  const x1 = firstLine.start.radius;
  const y1 = firstLine.start.height;
  const x2 = firstLine.end.radius;
  const y2 = firstLine.end.height;
  const x3 = secondLine.start.radius;
  const y3 = secondLine.start.height;
  const x4 = secondLine.end.radius;
  const y4 = secondLine.end.height;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  if (Math.abs(denominator) < 0.0001) {
    return null;
  }

  return {
    radius: ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator,
    height: ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator
  };
}

function pointOnOffsetLineAtHeight(line, height) {
  const heightRange = line.end.height - line.start.height;

  if (Math.abs(heightRange) < 0.001) {
    return {
      height,
      radius: (line.start.radius + line.end.radius) / 2
    };
  }

  const ratio = (height - line.start.height) / heightRange;

  return {
    height,
    radius: line.start.radius + (line.end.radius - line.start.radius) * ratio
  };
}

function uniformOffsetForPoint(point, index, fallbackPoint) {
  const previous = state.outerPoints[index - 1];
  const next = state.outerPoints[index + 1];
  const previousLine = previous
    ? offsetTangentLineForSegmentEndpoint(previous, point, "end")
    : null;
  const nextLine = next
    ? offsetTangentLineForSegmentEndpoint(point, next, "start")
    : null;

  if (previousLine && nextLine) {
    const intersection = lineIntersection(previousLine, nextLine);

    if (intersection) {
      return intersection;
    }
  }

  if (previousLine) {
    return previousLine.anchor;
  }

  if (nextLine) {
    return nextLine.anchor;
  }

  return fallbackPoint;
}

function derivedInnerPoints() {
  normalizeOuterPoints();
  const floorHeight = clamp(state.floorThickness, 0.15, Math.max(0.15, maxOuterHeight() - 0.5));
  const points = [];

  state.outerPoints.forEach((point, index) => {
    if (isOuterOnlyPoint(point) || point.height <= floorHeight + 0.03) {
      return;
    }

    const radialPoint = radialInnerPointFromOuter(point);
    const offset = uniformOffsetForPoint(point, index, radialPoint);

    points.push({
      ...radialPoint,
      height: clamp(offset.height, 0.15, maxOuterHeight()),
      radius: Math.max(0.12, offset.radius)
    });
  });

  const footPoint = footReferencePoint();
  const footIndex = footPoint ? pointIndex(state.outerPoints, footPoint.id) : -1;
  const previousFootPoint = footIndex > 0 ? state.outerPoints[footIndex - 1] : null;
  const footOffsetLine = previousFootPoint
    && footPoint
      ? offsetTangentLineForSegmentEndpoint(previousFootPoint, footPoint, "end")
      : null;
  const floorOffset = footOffsetLine
    ? pointOnOffsetLineAtHeight(footOffsetLine, floorHeight)
    : null;
  const floorRadius = floorOffset
    ? Math.max(0.12, floorOffset.radius)
    : footPoint
      ? Math.max(0.12, footPoint.radius - state.wallThickness)
      : Math.max(0.12, state.outerPoints[0].radius - state.wallThickness);

  points.push({
    id: "floor",
    label: "Interior floor",
    height: floorHeight,
    radius: floorRadius,
    fixed: "floor"
  });

  return points;
}

function ensureCustomInner() {
  if (state.innerPoints.length === 0) {
    state.innerPoints = derivedInnerPoints().map((point) => ({ ...point }));
  }
}

function copyCurrentInnerProfileToCustom() {
  const points = innerProfilePoints().map((point) => ({ ...point }));
  const curveControls = points.slice(0, -1).map((point, index) => {
    const nextPoint = points[index + 1];
    const segmentId = segmentKey(point.id, nextPoint.id);

    if (styleForLineSegment("inner", point.id, nextPoint.id) !== "curve") {
      return null;
    }

    return [
      segmentId,
      { ...ensureCurveControlForLine("inner", segmentId, point, nextPoint) }
    ];
  }).filter(Boolean);

  state.innerPoints = points;

  curveControls.forEach(([segmentId, control]) => {
    state.segmentCurves[curveStorageKey("inner", segmentId)] = control;
    delete state.segmentCurves[curveStorageKey("inner", reverseSegmentKey(segmentId))];
  });
}

function innerProfilePoints() {
  if (state.uniformWall) {
    return derivedInnerPoints();
  }

  ensureCustomInner();
  return state.innerPoints;
}

function normalizeInnerPoints() {
  if (state.uniformWall) {
    return;
  }

  ensureCustomInner();
  const outerById = new Map(state.outerPoints.map((point) => [point.id, point]));
  state.innerPoints = state.innerPoints.filter((point) => {
    if (point.fixed === "floor" || point.id === "floor") {
      return true;
    }

    const outer = outerById.get(point.id);
    return !isOuterOnlyPoint(point) && !isOuterOnlyPoint(outer);
  });

  state.innerPoints.forEach((point) => {
    const outer = outerById.get(point.id);
    const maxRadius = outer ? outer.radius - 0.08 : footReferencePoint().radius - 0.08;
    const maxHeight = Math.max(0.15, maxOuterHeight());
    point.radius = clamp(point.radius, 0.12, Math.max(0.14, maxRadius));

    if (point.fixed === "floor" || point.id === "floor") {
      point.height = clamp(point.height, 0.15, Math.max(0.15, maxHeight - 0.5));
      return;
    }

    point.height = clamp(point.height, 0.15, maxHeight);
  });
}

function normalizeSegmentCurves() {
  Object.entries(state.segmentCurves).forEach(([key, control]) => {
    const { line, segmentId } = curveKeyParts(key);
    const [first, second] = pointsForSegment(line, segmentId);

    if (!first || !second) {
      return;
    }

    control.radius = clamp(control.radius, 0.12, 4);
    control.height = clamp(
      control.height,
      Math.min(first.height, second.height),
      Math.max(first.height, second.height)
    );
  });
}

function normalizeState() {
  if (!isInspectorState(state.inspectorState)) {
    state.inspectorState = "expanded";
  }
  state.shrinkage = clamp(Number(state.shrinkage) || 0, 0, 30);
  state.wallThickness = clamp(state.wallThickness, 0.08, 0.7);
  state.rimThickness = clamp(state.rimThickness, 0.08, 0.7);
  state.floorThickness = clamp(state.floorThickness, 0.15, 1);
  state.footRingWidth = clamp(state.footRingWidth, 0.08, 0.8);
  normalizeOuterPoints();
  normalizeInnerPoints();
  normalizeSegmentCurves();

  if (!activeLinePoints().some((point) => point.id === state.selectedPointId)) {
    state.selectedPointId = activeLinePoints()[0]?.id || "rim";
  }

  if (selectedSegmentPoints().length < 2) {
    state.selectedSegmentId = selectedSegmentIdForPoint(state.selectedPointId);
  }
}

function frustumVolume(height, r1, r2) {
  return (Math.PI * height * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
}

function volumeFromPoints(points) {
  const ascending = [...points].sort((a, b) => a.height - b.height);
  let volume = 0;

  for (let index = 1; index < ascending.length; index += 1) {
    const lower = ascending[index - 1];
    const upper = ascending[index];
    volume += frustumVolume(upper.height - lower.height, lower.radius, upper.radius);
  }

  return volume;
}

function estimateClay() {
  normalizeState();
  const outerVolume = volumeFromPoints(state.outerPoints);
  const innerVolume = volumeFromPoints(innerProfilePoints());
  const finishedClayVolume = Math.max(0, outerVolume - innerVolume);
  const wetClayVolume = finishedClayVolume / Math.pow(shrinkFactor(), 3);
  const withMargin = wetClayVolume * (1 + state.margin / 100);

  return {
    volume: wetClayVolume,
    pounds: withMargin * state.clayDensity
  };
}

function currentZoom() {
  return baseViewBox.width / canvasView.width;
}

function applyCanvasView() {
  svg.setAttribute(
    "viewBox",
    `${canvasView.x} ${canvasView.y} ${canvasView.width} ${canvasView.height}`
  );
}

function setCanvasView(nextView) {
  const aspect = baseViewBox.height / baseViewBox.width;
  const minWidth = baseViewBox.width / 4.5;
  const width = clamp(nextView.width, minWidth, baseViewBox.width);
  const height = width * aspect;
  const maxX = baseViewBox.x + baseViewBox.width - width;
  const maxY = baseViewBox.y + baseViewBox.height - height;

  canvasView.width = width;
  canvasView.height = height;
  canvasView.x = clamp(nextView.x, baseViewBox.x, maxX);
  canvasView.y = clamp(nextView.y, baseViewBox.y, maxY);
  applyCanvasView();
}

function resetCanvasView() {
  Object.assign(canvasView, baseViewBox);
  applyCanvasView();
}

function svgPointFromClient(clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function svgPointFromEvent(event) {
  return svgPointFromClient(event.clientX, event.clientY);
}

function profileGeometry() {
  normalizeState();
  const centerX = 294;
  const bottomY = 606;
  const scaleX = 56;
  const scaleY = 70;

  return {
    centerX,
    bottomY,
    scaleX,
    scaleY,
    xForRadius(radius, side = "right") {
      return side === "right" ? centerX + radius * scaleX : centerX - radius * scaleX;
    },
    yForHeight(height) {
      return bottomY - height * scaleY;
    },
    radiusForX(x) {
      return Math.abs(x - centerX) / scaleX;
    },
    heightForY(y) {
      return (bottomY - y) / scaleY;
    },
    mapPoint(point, side = "right") {
      return {
        ...point,
        x: side === "right" ? centerX + point.radius * scaleX : centerX - point.radius * scaleX,
        y: bottomY - point.height * scaleY
      };
    }
  };
}

function curveStorageKey(line, segmentId) {
  return `${line}:${segmentId}`;
}

function curveKeyParts(key) {
  const [lineOrFirst, rest] = key.split(":");
  const line = rest ? lineOrFirst : "outer";
  const segmentId = rest || key;
  const [firstId, secondId] = segmentId.split("-");

  return { line, segmentId, firstId, secondId };
}

function deleteSegmentCurveControls(segmentId) {
  const reverseKey = reverseSegmentKey(segmentId);

  Object.keys(state.segmentCurves).forEach((key) => {
    const parts = curveKeyParts(key);

    if (parts.segmentId === segmentId || parts.segmentId === reverseKey) {
      delete state.segmentCurves[key];
    }
  });
}

function deleteCurveControlsForPoint(pointId) {
  Object.keys(state.segmentCurves).forEach((key) => {
    const parts = curveKeyParts(key);

    if (parts.firstId === pointId || parts.secondId === pointId) {
      delete state.segmentCurves[key];
    }
  });
}

function deleteSegmentStylesForPoint(pointId) {
  Object.keys(state.segmentStyles).forEach((key) => {
    if (segmentKeyIncludesPoint(key, pointId)) {
      delete state.segmentStyles[key];
    }
  });
}

function segmentControlKey(line, segmentId) {
  const directKey = curveStorageKey(line, segmentId);
  const reverseKey = curveStorageKey(line, reverseSegmentKey(segmentId));

  if (state.segmentCurves[directKey]) {
    return directKey;
  }

  if (state.segmentCurves[reverseKey]) {
    return reverseKey;
  }

  if (state.segmentCurves[segmentId]) {
    state.segmentCurves[directKey] = state.segmentCurves[segmentId];
    delete state.segmentCurves[segmentId];
    return directKey;
  }

  const legacyReverseKey = reverseSegmentKey(segmentId);
  if (state.segmentCurves[legacyReverseKey]) {
    state.segmentCurves[directKey] = state.segmentCurves[legacyReverseKey];
    delete state.segmentCurves[legacyReverseKey];
    return directKey;
  }

  return directKey;
}

function segmentControlFromPoints(first, second) {
  return {
    height: (first.height + second.height) / 2,
    radius: (first.radius + second.radius) / 2
  };
}

function pointsForSegment(line, segmentId) {
  const points = line === "inner" ? innerProfilePoints() : state.outerPoints;
  const [firstId, secondId] = segmentId.split("-");

  return [
    points.find((point) => point.id === firstId),
    points.find((point) => point.id === secondId)
  ];
}

function ensureSegmentCurveControl(line, segmentId, fallbackFirst = null, fallbackSecond = null) {
  const existingKey = segmentControlKey(line, segmentId);

  if (state.segmentCurves[existingKey]) {
    return state.segmentCurves[existingKey];
  }

  const [first, second] = fallbackFirst && fallbackSecond
    ? [fallbackFirst, fallbackSecond]
    : pointsForSegment(line, segmentId);

  if (!first || !second) {
    state.segmentCurves[existingKey] = { height: 1, radius: 1 };
    return state.segmentCurves[existingKey];
  }

  state.segmentCurves[existingKey] = segmentControlFromPoints(first, second);
  return state.segmentCurves[existingKey];
}

function hasUniformCurveLink(line, segmentId) {
  if (!state.uniformWall || line !== "inner") {
    return false;
  }

  const [outerFirst, outerSecond] = pointsForSegment("outer", outerSegmentIdForInner(segmentId));
  const [innerFirst, innerSecond] = pointsForSegment("inner", segmentId);

  return Boolean(outerFirst && outerSecond && innerFirst && innerSecond);
}

function wallOffsetAtSegmentHeight(segmentId, height) {
  const [outerFirst, outerSecond] = pointsForSegment("outer", outerSegmentIdForInner(segmentId));
  const [innerFirst, innerSecond] = pointsForSegment("inner", segmentId);

  if (!outerFirst || !outerSecond || !innerFirst || !innerSecond) {
    return state.wallThickness;
  }

  const firstOffset = Math.max(0, outerFirst.radius - innerFirst.radius);
  const secondOffset = Math.max(0, outerSecond.radius - innerSecond.radius);
  const heightRange = outerSecond.height - outerFirst.height;
  const ratio = Math.abs(heightRange) < 0.001
    ? 0.5
    : clamp((height - outerFirst.height) / heightRange, 0, 1);

  return firstOffset + (secondOffset - firstOffset) * ratio;
}

function quadraticPoint(first, control, second, t) {
  const inverse = 1 - t;

  return {
    radius: inverse * inverse * first.radius
      + 2 * inverse * t * control.radius
      + t * t * second.radius,
    height: inverse * inverse * first.height
      + 2 * inverse * t * control.height
      + t * t * second.height
  };
}

function quadraticTangent(first, control, second, t) {
  const inverse = 1 - t;

  return {
    radius: 2 * (inverse * (control.radius - first.radius) + t * (second.radius - control.radius)),
    height: 2 * (inverse * (control.height - first.height) + t * (second.height - control.height))
  };
}

function controlPointFromQuadraticMidpoint(first, midpoint, second) {
  return {
    radius: 2 * midpoint.radius - (first.radius + second.radius) / 2,
    height: 2 * midpoint.height - (first.height + second.height) / 2
  };
}

function innerControlFromOuter(segmentId, outerControl) {
  const [outerFirst, outerSecond] = pointsForSegment("outer", outerSegmentIdForInner(segmentId));
  const [innerFirst, innerSecond] = pointsForSegment("inner", segmentId);

  if (!outerFirst || !outerSecond || !innerFirst || !innerSecond) {
    const offset = wallOffsetAtSegmentHeight(segmentId, outerControl.height);

    return {
      height: outerControl.height,
      radius: Math.max(0.12, outerControl.radius - offset)
    };
  }

  const midpoint = quadraticPoint(outerFirst, outerControl, outerSecond, 0.5);
  const tangent = quadraticTangent(outerFirst, outerControl, outerSecond, 0.5);
  const normal = inwardNormalForVector(tangent.radius, tangent.height);
  const innerMidpoint = offsetPoint(midpoint, normal, state.wallThickness);
  const control = controlPointFromQuadraticMidpoint(innerFirst, innerMidpoint, innerSecond);

  return {
    height: clamp(
      control.height,
      Math.min(innerFirst.height, innerSecond.height),
      Math.max(innerFirst.height, innerSecond.height)
    ),
    radius: Math.max(0.12, control.radius)
  };
}

function outerControlFromInner(segmentId, innerControl) {
  const [outerFirst, outerSecond] = pointsForSegment("outer", outerSegmentIdForInner(segmentId));

  if (!outerFirst || !outerSecond) {
    const offset = wallOffsetAtSegmentHeight(segmentId, innerControl.height);

    return {
      height: innerControl.height,
      radius: clamp(innerControl.radius + offset, 0.12, 4)
    };
  }

  const outerControl = ensureSegmentCurveControl("outer", outerSegmentIdForInner(segmentId), outerFirst, outerSecond);
  const tangent = quadraticTangent(outerFirst, outerControl, outerSecond, 0.5);
  const normal = inwardNormalForVector(tangent.radius, tangent.height);

  return {
    height: clamp(
      innerControl.height - normal.height * state.wallThickness,
      Math.min(outerFirst.height, outerSecond.height),
      Math.max(outerFirst.height, outerSecond.height)
    ),
    radius: clamp(innerControl.radius - normal.radius * state.wallThickness, 0.12, 4)
  };
}

function ensureCurveControlForLine(line, segmentId, fallbackFirst = null, fallbackSecond = null) {
  if (hasUniformCurveLink(line, segmentId)) {
    const outerSegmentId = outerSegmentIdForInner(segmentId);
    return innerControlFromOuter(segmentId, ensureSegmentCurveControl("outer", outerSegmentId));
  }

  return ensureSegmentCurveControl(line, segmentId, fallbackFirst, fallbackSecond);
}

function setCurveControlForLine(line, segmentId, control) {
  if (hasUniformCurveLink(line, segmentId)) {
    const key = segmentControlKey("outer", outerSegmentIdForInner(segmentId));
    state.segmentCurves[key] = outerControlFromInner(segmentId, control);
    return;
  }

  state.segmentCurves[segmentControlKey(line, segmentId)] = control;
}

function mappedCurveControl(line, segmentId, side = "right", fallbackStart = null, fallbackEnd = null) {
  const g = profileGeometry();
  const key = segmentControlKey(line, segmentId);

  if (!hasUniformCurveLink(line, segmentId) && !state.segmentCurves[key]) {
    if (fallbackStart && fallbackEnd) {
      state.segmentCurves[key] = {
        height: g.heightForY((fallbackStart.y + fallbackEnd.y) / 2),
        radius: g.radiusForX((fallbackStart.x + fallbackEnd.x) / 2)
      };
    } else {
      ensureSegmentCurveControl(line, segmentId);
    }
  }

  const control = ensureCurveControlForLine(line, segmentId);

  return {
    x: g.xForRadius(control.radius, side),
    y: g.yForHeight(control.height)
  };
}

function segmentPath(start, end, style, line = "outer") {
  if (style !== "curve") {
    return `L${end.x} ${end.y}`;
  }

  const side = start.x < profileGeometry().centerX ? "left" : "right";
  const control = mappedCurveControl(line, segmentKey(start.id, end.id), side, start, end);
  return `Q${control.x} ${control.y} ${end.x} ${end.y}`;
}

function continuePathThrough(mappedPoints, line = "outer") {
  let d = "";

  for (let index = 1; index < mappedPoints.length; index += 1) {
    const start = mappedPoints[index - 1];
    const end = mappedPoints[index];
    d += ` ${segmentPath(start, end, styleForLineSegment(line, start.id, end.id), line)}`;
  }

  return d;
}

function pathThrough(mappedPoints, line = "outer") {
  if (mappedPoints.length === 0) {
    return "";
  }

  return `M${mappedPoints[0].x} ${mappedPoints[0].y}${continuePathThrough(mappedPoints, line)}`;
}

function mappedOuter(side) {
  const g = profileGeometry();
  return state.outerPoints.map((point) => g.mapPoint(point, side));
}

function mappedInner(side) {
  const g = profileGeometry();
  return innerProfilePoints().map((point) => g.mapPoint(point, side));
}

function shellPath() {
  const right = mappedOuter("right");
  const leftReverse = mappedOuter("left").reverse();
  return `${pathThrough(right, "outer")} L${leftReverse[0].x} ${leftReverse[0].y}${continuePathThrough(leftReverse, "outer")} Z`;
}

function innerHolePath() {
  const right = mappedInner("right");
  const leftReverse = mappedInner("left").reverse();

  if (right.length < 2 || leftReverse.length < 2) {
    return "";
  }

  return `${pathThrough(right, "inner")} L${leftReverse[0].x} ${leftReverse[0].y}${continuePathThrough(leftReverse, "inner")} Z`;
}

function svgText(x, y, text, className = "svg-label") {
  return `<text x="${x}" y="${y}" class="${className}">${text}</text>`;
}

function svgTextEnd(x, y, text, className = "svg-label") {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="end">${text}</text>`;
}

function handle(point, line, className = "svg-point-control") {
  const g = profileGeometry();
  const mapped = g.mapPoint(point, "right");
  const active = state.selectedKind === "point"
    && state.selectedPointId === point.id
    && state.editingLine === line;
  const locked = line === "inner" && state.uniformWall;
  const radius = active ? 14 : 10;
  const cssClass = locked
    ? active ? "svg-point-locked-active" : "svg-point-locked"
    : active ? "svg-point-active" : className;

  return `<circle class="${cssClass}" data-line="${line}" data-point="${point.id}" data-locked="${locked}" cx="${mapped.x}" cy="${mapped.y}" r="${radius}"/>`;
}

function segmentHitPath(points, line, segmentId, active) {
  const g = profileGeometry();
  const [firstId, secondId] = segmentId.split("-");
  const first = points.find((point) => point.id === firstId);
  const second = points.find((point) => point.id === secondId);

  if (!first || !second) {
    return "";
  }

  const start = g.mapPoint(first, "right");
  const end = g.mapPoint(second, "right");
  const d = `M${start.x} ${start.y} ${segmentPath(start, end, styleForLineSegment(line, first.id, second.id), line)}`;
  const activePath = active
    ? `<path class="svg-segment-active" d="${d}"/>`
    : "";

  return `${activePath}<path class="svg-segment-hit" data-line="${line}" data-segment="${segmentId}" d="${d}"/>`;
}

function renderSegmentHits(points, line) {
  return points.slice(0, -1).map((point, index) => {
    const segmentId = segmentKey(point.id, points[index + 1].id);
    return segmentHitPath(
      points,
      line,
      segmentId,
      state.selectedKind === "segment"
        && state.selectedSegmentId === segmentId
        && state.editingLine === line
    );
  }).join("");
}

function renderCurveControls(points, line) {
  const g = profileGeometry();

  return points.slice(0, -1).map((point, index) => {
    const nextPoint = points[index + 1];
    const segmentId = segmentKey(point.id, nextPoint.id);

    if (styleForLineSegment(line, point.id, nextPoint.id) !== "curve") {
      return "";
    }

    const start = g.mapPoint(point, "right");
    const end = g.mapPoint(nextPoint, "right");
    const control = mappedCurveControl(line, segmentId, "right", start, end);
    const active = state.selectedKind === "segment"
      && state.selectedSegmentId === segmentId
      && state.editingLine === line;
    const radius = active ? 13 : 10;
    const cssClass = active
      ? "svg-curve-control-active"
      : "svg-curve-control";
    const guide = active
      ? `<path class="svg-curve-guide" d="M${start.x} ${start.y} L${control.x} ${control.y} L${end.x} ${end.y}"/>`
      : "";

    return `
      ${guide}
      <circle class="${cssClass}"
        data-line="${line}"
        data-curve="${segmentId}"
        cx="${control.x}"
        cy="${control.y}"
        r="${radius}"/>
    `;
  }).join("");
}

function renderDimensionLabels() {
  const g = profileGeometry();
  const outerRight = mappedOuter("right");
  const outerLeft = mappedOuter("left");
  const highest = highestOuterPoint();
  const selected = selectedPoint();
  const selectedMapped = g.mapPoint(selected, "right");
  const leftX = g.xForRadius(selected.radius, "left");
  const rightX = g.xForRadius(selected.radius, "right");
  const labelY = selectedMapped.y - 22;
  const heightY = g.yForHeight(highest.height);

  return `
    <path class="svg-dimension" d="M544 ${heightY} V${g.bottomY}"/>
    <path class="svg-dimension" d="M532 ${heightY} H556"/>
    <path class="svg-dimension" d="M532 ${g.bottomY} H556"/>
    ${svgTextEnd(534, g.bottomY - 88, outputText(highest.height), "svg-label-small")}

    <path class="svg-dimension" d="M${leftX} ${selectedMapped.y} H${rightX}"/>
    <path class="svg-dimension" d="M${leftX} ${selectedMapped.y - 12} V${selectedMapped.y + 12}"/>
    <path class="svg-dimension" d="M${rightX} ${selectedMapped.y - 12} V${selectedMapped.y + 12}"/>
    ${svgText(Math.max(72, outerLeft[0].x), labelY, dimensionText(selected.radius * 2))}
  `;
}

function renderCanvas() {
  const outerRight = mappedOuter("right");
  const outerLeft = mappedOuter("left");
  const innerRight = mappedInner("right");
  const innerLeft = mappedInner("left");
  const activePoints = activeLinePoints();
  const handles = activePoints.map((point) => handle(point, state.editingLine)).join("");
  const segmentHits = renderSegmentHits(activePoints, state.editingLine);
  const curveControls = renderCurveControls(activePoints, state.editingLine);
  const outerRimRight = outerRight[0];
  const outerRimLeft = outerLeft[0];
  const innerRimRight = innerRight[0];
  const innerRimLeft = innerLeft[0];
  const innerFloorRight = innerRight.at(-1);
  const innerFloorLeft = innerLeft.at(-1);

  svg.innerHTML = `
    <path class="svg-construction" d="M294 -60 V624"/>
    <path class="svg-clay" fill-rule="evenodd" d="${shellPath()} ${innerHolePath()}"/>
    <path class="svg-outer" d="${pathThrough(outerRight, "outer")}"/>
    <path class="svg-outer" d="${pathThrough(outerLeft, "outer")}"/>
    <path class="svg-inner" d="${pathThrough(innerRight, "inner")}"/>
    <path class="svg-inner" d="${pathThrough(innerLeft, "inner")}"/>
    <path class="svg-outer" d="M${outerRimRight.x} ${outerRimRight.y} L${innerRimRight.x} ${innerRimRight.y}"/>
    <path class="svg-outer" d="M${outerRimLeft.x} ${outerRimLeft.y} L${innerRimLeft.x} ${innerRimLeft.y}"/>
    <path class="svg-inner" d="M${innerFloorLeft.x} ${innerFloorLeft.y} L${innerFloorRight.x} ${innerFloorRight.y}"/>
    ${renderDimensionLabels()}
    ${segmentHits}
    ${curveControls}
    ${handles}
  `;

  applyCanvasView();
}

function selectedName() {
  if (state.selectedKind === "segment") {
    const [first, second] = selectedSegmentPoints();
    if (!first || !second) {
      return "Line";
    }
    return `${first.label} to ${second.label}`;
  }

  const point = selectedPoint();
  return point.label.toLowerCase().startsWith("point")
    ? point.label
    : `${point.label} point`;
}

function selectedMetaText() {
  return `${titleCase(state.editingLine)} ${state.selectedKind === "segment" ? "line" : "point"}`;
}

function formatControlValue(value, mode = "dimension") {
  if (mode === "percent") {
    return `${value.toFixed(0)}%`;
  }

  return outputText(value);
}

function makeRangeControl(definition, target = controlsRoot) {
  const fragment = rangeTemplate.content.cloneNode(true);
  const wrapper = fragment.querySelector(".range-control");
  const labelNode = fragment.querySelector(".control-label");
  const input = fragment.querySelector("input");
  const output = fragment.querySelector("output");
  const disabled = Boolean(definition.disabled);
  let activePointerId = null;
  let pendingControlRefresh = false;

  labelNode.textContent = definition.label;
  input.min = definition.min;
  input.max = definition.max;
  input.step = definition.step;
  input.value = definition.get();
  input.disabled = disabled;
  output.value = formatControlValue(definition.get(), definition.mode);
  wrapper.classList.toggle("is-disabled", disabled);
  wrapper.setAttribute("aria-disabled", String(disabled));

  const updateValue = (value, refreshControls = false) => {
    if (disabled) {
      return;
    }

    definition.set(snapToStep(value, Number(definition.step)));
    normalizeState();
    input.value = definition.get();
    output.value = formatControlValue(definition.get(), definition.mode);
    render({ controls: refreshControls });
  };

  input.addEventListener("input", () => {
    updateValue(Number(input.value));
  });

  input.addEventListener("change", () => {
    updateValue(Number(input.value), true);
  });

  const valueFromPointer = (event) => {
    const rect = input.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return Number(definition.min) + ratio * (Number(definition.max) - Number(definition.min));
  };

  input.addEventListener("pointerdown", (event) => {
    if (disabled) {
      return;
    }

    event.preventDefault();
    activePointerId = event.pointerId;
    pendingControlRefresh = true;

    try {
      input.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded mobile browsers do not support range pointer capture.
    }

    updateValue(valueFromPointer(event));
  });

  input.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    pendingControlRefresh = true;
    updateValue(valueFromPointer(event));
  });

  const finishPointerDrag = (event) => {
    if (activePointerId !== event.pointerId && event.type !== "lostpointercapture") {
      return;
    }

    activePointerId = null;

    if (pendingControlRefresh) {
      pendingControlRefresh = false;
      render();
    }
  };

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
    input.addEventListener(type, finishPointerDrag);
  });

  target.appendChild(fragment);
}

function createControlGroup(title) {
  const group = document.createElement("section");
  const heading = document.createElement("h3");
  const body = document.createElement("div");

  group.className = "control-group";
  heading.textContent = title;
  body.className = "control-group-body";
  group.append(heading, body);
  controlsRoot.appendChild(group);

  return body;
}

function renderWallGroup(extraControls = []) {
  const group = createControlGroup("Wall");
  group.appendChild(uniformWallControl);
  extraControls.forEach((control) => makeRangeControl(control, group));
}

function selectedPointControls() {
  const point = selectedPoint();
  const innerUniformLocked = state.editingLine === "inner" && state.uniformWall;
  const controls = [
    {
      label: "Diameter",
      min: 0.5,
      max: 8,
      step: 0.05,
      disabled: innerUniformLocked,
      get: () => point.radius * 2,
      set: (value) => {
        point.radius = value / 2;
      }
    }
  ];

  if (point.fixed !== "base") {
    controls.push({
      label: "Height",
      min: 0,
      max: 10,
      step: 0.05,
      disabled: innerUniformLocked,
      get: () => point.height,
      set: (value) => {
        point.height = value;
      }
    });
  }

  if (state.editingLine === "inner" && state.uniformWall) {
    controls.push({
      label: "Wall thickness",
      min: 0.08,
      max: 0.7,
      step: 0.01,
      get: () => state.wallThickness,
      set: (value) => {
        state.wallThickness = value;
      }
    });
  }

  return controls;
}

function renderSegmentControls(target = controlsRoot) {
  const style = styleForLineSegment(state.editingLine, ...state.selectedSegmentId.split("-"));
  const [first, second] = selectedSegmentPoints();
  const wrapper = document.createElement("div");
  wrapper.className = "line-style-control";
  wrapper.innerHTML = `
    <span>Line shape</span>
    <div class="style-toggle" role="group" aria-label="Line shape">
      <button type="button" data-style="curve">Curve</button>
      <button type="button" data-style="straight">Straight</button>
    </div>
  `;

  wrapper.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.style === style);
    button.addEventListener("click", () => {
      setSegmentStyle(state.selectedSegmentId, button.dataset.style);
      render();
    });
  });

  target.appendChild(wrapper);

  if (style === "curve" && first && second) {
    const line = state.editingLine;
    const segmentId = state.selectedSegmentId;
    const minHeight = Math.min(first.height, second.height);
    const maxHeight = Math.max(first.height, second.height);

    makeRangeControl({
      label: "Curve width",
      min: 0.5,
      max: 8,
      step: 0.05,
      get: () => ensureCurveControlForLine(line, segmentId, first, second).radius * 2,
      set: (value) => {
        const current = ensureCurveControlForLine(line, segmentId, first, second);
        setCurveControlForLine(line, segmentId, {
          ...current,
          radius: value / 2
        });
      }
    }, target);

    makeRangeControl({
      label: "Curve height",
      min: minHeight,
      max: maxHeight,
      step: 0.05,
      get: () => ensureCurveControlForLine(line, segmentId, first, second).height,
      set: (value) => {
        const current = ensureCurveControlForLine(line, segmentId, first, second);
        setCurveControlForLine(line, segmentId, {
          ...current,
          height: value
        });
      }
    }, target);
  }
}

function renderControls() {
  selectedLabel.textContent = selectedName();
  selectedMeta.textContent = selectedMetaText();
  const inspectorContext = state.selectedKind === "segment"
    ? `${state.editingLine}:segment:${state.selectedSegmentId}`
    : `${state.editingLine}:point:${state.selectedPointId}`;
  const selectionChanged = inspectorContext !== lastInspectorContext;
  controlsRoot.replaceChildren();

  if (state.selectedKind === "segment") {
    controlsTitle.textContent = "Controls";
    renderSegmentControls(createControlGroup("Shape"));
    renderWallGroup();
    if (selectionChanged) {
      bottomInspector.scrollTop = 0;
      lastInspectorContext = inspectorContext;
    }
    return;
  }

  controlsTitle.textContent = "Controls";
  const pointControls = selectedPointControls();
  const wallControls = pointControls.filter((control) => control.label === "Wall thickness");
  const sizeControls = pointControls.filter((control) => control.label !== "Wall thickness");
  const sizeGroup = createControlGroup("Size");
  sizeControls.forEach((control) => makeRangeControl(control, sizeGroup));
  renderWallGroup(wallControls);

  if (selectionChanged) {
    bottomInspector.scrollTop = 0;
    lastInspectorContext = inspectorContext;
  }
}

function renderChrome() {
  normalizeState();
  const estimate = estimateClay();
  clayEstimateValue.textContent = `${estimate.pounds.toFixed(1)} lb`;
  clayEstimate.setAttribute(
    "aria-label",
    `Estimated wet clay ${estimate.pounds.toFixed(1)} pounds from ${estimate.volume.toFixed(1)} cubic inches after shrinkage plus ${state.margin} percent margin`
  );

  finishedBasis.classList.toggle("active", state.basis === "finished");
  wetBasis.classList.toggle("active", state.basis === "wet");
  outerLineButton.classList.toggle("active", state.editingLine === "outer");
  innerLineButton.classList.toggle("active", state.editingLine === "inner");
  pointModeButton.classList.toggle("active", state.selectedKind === "point");
  segmentModeButton.classList.toggle("active", state.selectedKind === "segment");
  const inspectorIsExpanded = state.inspectorState === "expanded";
  const inspectorIsCompact = state.inspectorState === "compact";
  const inspectorIsMinimized = state.inspectorState === "minimized";
  bottomInspector.classList.toggle("is-collapsed", inspectorIsCompact);
  bottomInspector.classList.toggle("is-minimized", inspectorIsMinimized);
  inspectorToggle.setAttribute("aria-expanded", String(inspectorIsExpanded));
  inspectorToggle.setAttribute(
    "aria-label",
    inspectorIsExpanded
      ? "Show compact controls"
      : inspectorIsCompact
        ? "Fully minimize controls"
        : "Expand controls"
  );
  compactSelectedLabel.textContent = selectedName();
  compactLineButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.compactLine === state.editingLine);
  });
  compactKindButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.compactKind === state.selectedKind);
  });
  uniformWallToggle.checked = state.uniformWall;
  shrinkageInput.value = state.shrinkage;

  const canDelete = state.selectedKind === "point"
    && state.editingLine === "outer"
    && !selectedPoint().fixed
    && state.outerPoints.length > 3;
  deletePointButton.disabled = !canDelete;
}

function render({ controls = true } = {}) {
  renderChrome();
  renderCanvas();
  if (controls) {
    renderControls();
  }
  schedulePersistDesign();
}

function selectPoint(line, pointId) {
  state.editingLine = line;
  state.selectedKind = "point";
  state.selectedPointId = pointId;
  state.selectedSegmentId = selectedSegmentIdForPoint(pointId);
}

function selectSegment(segmentId, line = state.editingLine) {
  state.editingLine = line;
  state.selectedKind = "segment";
  state.selectedSegmentId = segmentId;
  const [firstId] = segmentId.split("-");
  state.selectedPointId = firstId;
}

function selectPointMode() {
  state.selectedKind = "point";
}

function selectSegmentMode() {
  state.selectedKind = "segment";
  state.selectedSegmentId = selectedSegmentIdForPoint(state.selectedPointId);
}

function setEditingLine(line) {
  state.editingLine = line;

  if (line === "outer") {
    if (!state.outerPoints.some((point) => point.id === state.selectedPointId)) {
      state.selectedPointId = state.outerPoints[0].id;
    }
    return;
  }

  const points = innerProfilePoints();
  if (!points.some((point) => point.id === state.selectedPointId)) {
    state.selectedPointId = points[0].id;
  }
}

function insertPointInSelectedSegment() {
  const points = state.outerPoints;
  const [firstId, secondId] = state.selectedSegmentId.split("-");
  const firstIndex = pointIndex(points, firstId);
  const secondIndex = pointIndex(points, secondId);

  if (firstIndex < 0 || secondIndex < 0 || Math.abs(firstIndex - secondIndex) !== 1) {
    return;
  }

  const insertAt = Math.max(firstIndex, secondIndex);
  const first = points[Math.min(firstIndex, secondIndex)];
  const second = points[Math.max(firstIndex, secondIndex)];
  const newPointIsOuterOnly = isOuterOnlySegment(first, second);
  const newPoint = {
    id: `point${state.nextPointId}`,
    label: `Point ${state.nextPointId}`,
    height: (first.height + second.height) / 2,
    radius: (first.radius + second.radius) / 2,
    outerOnly: newPointIsOuterOnly
  };
  state.nextPointId += 1;

  const oldStyle = styleForSegment(first.id, second.id);
  const oldSegmentId = segmentKey(first.id, second.id);
  const firstSegmentId = segmentKey(first.id, newPoint.id);
  const secondSegmentId = segmentKey(newPoint.id, second.id);
  delete state.segmentStyles[segmentKey(first.id, second.id)];
  delete state.segmentStyles[segmentKey(second.id, first.id)];
  deleteSegmentCurveControls(oldSegmentId);
  state.segmentStyles[firstSegmentId] = oldStyle;
  state.segmentStyles[secondSegmentId] = oldStyle;
  points.splice(insertAt, 0, newPoint);

  if (oldStyle === "curve") {
    state.segmentCurves[curveStorageKey("outer", firstSegmentId)] = segmentControlFromPoints(first, newPoint);
    state.segmentCurves[curveStorageKey("outer", secondSegmentId)] = segmentControlFromPoints(newPoint, second);
  }

  if (!state.uniformWall && state.innerPoints.length > 0 && !newPoint.outerOnly) {
    const innerFirstIndex = pointIndex(state.innerPoints, first.id);
    const innerSecondIndex = pointIndex(state.innerPoints, second.id);
    const innerInsertAt = innerFirstIndex >= 0 && innerSecondIndex >= 0
      ? Math.max(innerFirstIndex, innerSecondIndex)
      : Math.max(0, state.innerPoints.length - 1);
    const innerPoint = {
      id: newPoint.id,
      label: `Inner ${newPoint.label}`,
      height: newPoint.height,
      radius: Math.max(0.12, newPoint.radius - state.wallThickness)
    };
    state.innerPoints.splice(innerInsertAt, 0, innerPoint);

    if (oldStyle === "curve") {
      const innerFirst = state.innerPoints.find((point) => point.id === first.id);
      const innerSecond = state.innerPoints.find((point) => point.id === second.id);

      if (innerFirst) {
        state.segmentCurves[curveStorageKey("inner", firstSegmentId)] = segmentControlFromPoints(innerFirst, innerPoint);
      }

      if (innerSecond) {
        state.segmentCurves[curveStorageKey("inner", secondSegmentId)] = segmentControlFromPoints(innerPoint, innerSecond);
      }
    }
  }

  selectPoint("outer", newPoint.id);
  render();
}

function deleteSelectedPoint() {
  if (state.selectedKind !== "point" || state.editingLine !== "outer") {
    return;
  }

  const index = pointIndex(state.outerPoints, state.selectedPointId);
  const point = state.outerPoints[index];

  if (!point || point.fixed || state.outerPoints.length <= 3) {
    return;
  }

  const previous = state.outerPoints[index - 1];
  const next = state.outerPoints[index + 1];
  const previousStyle = previous && styleForSegment(previous.id, point.id);
  const nextStyle = next && styleForSegment(point.id, next.id);
  state.outerPoints.splice(index, 1);
  state.innerPoints = state.innerPoints.filter((innerPoint) => innerPoint.id !== point.id);

  deleteSegmentStylesForPoint(point.id);
  deleteCurveControlsForPoint(point.id);

  if (previous && next) {
    const mergedSegmentId = segmentKey(previous.id, next.id);
    const mergedStyle = nextStyle || previousStyle || "curve";
    state.segmentStyles[mergedSegmentId] = mergedStyle;

    if (mergedStyle === "curve") {
      state.segmentCurves[curveStorageKey("outer", mergedSegmentId)] = segmentControlFromPoints(previous, next);

      if (!state.uniformWall && state.innerPoints.length > 0) {
        const innerPrevious = state.innerPoints.find((innerPoint) => innerPoint.id === previous.id);
        const innerNext = state.innerPoints.find((innerPoint) => innerPoint.id === next.id);

        if (innerPrevious && innerNext) {
          state.segmentCurves[curveStorageKey("inner", mergedSegmentId)] = segmentControlFromPoints(innerPrevious, innerNext);
        }
      }
    }

    state.selectedSegmentId = mergedSegmentId;
    selectPoint("outer", next.id);
  } else {
    selectPoint("outer", state.outerPoints[Math.max(0, index - 1)].id);
  }

  render();
}

function updatePointFromDrag(line, pointId, svgPoint) {
  if (line === "inner" && state.uniformWall) {
    selectPoint(line, pointId);
    return;
  }

  const points = line === "outer" ? state.outerPoints : state.innerPoints;
  const point = points.find((candidate) => candidate.id === pointId);
  const g = profileGeometry();

  if (!point) {
    return;
  }

  point.radius = g.radiusForX(svgPoint.x);

  if (point.fixed !== "base") {
    point.height = g.heightForY(svgPoint.y);
  }

  selectPoint(line, pointId);
  normalizeState();
}

function updateCurveFromDrag(line, segmentId, svgPoint) {
  const linkedUniformCurve = hasUniformCurveLink(line, segmentId);

  if (line === "inner" && state.uniformWall && !linkedUniformCurve) {
    selectSegment(segmentId, line);
    return;
  }

  const [first, second] = pointsForSegment(line, segmentId);

  if (!first || !second) {
    return;
  }

  const g = profileGeometry();
  const minHeight = Math.min(first.height, second.height);
  const maxHeight = Math.max(first.height, second.height);
  setCurveControlForLine(line, segmentId, {
    height: clamp(g.heightForY(svgPoint.y), minHeight, maxHeight),
    radius: clamp(g.radiusForX(svgPoint.x), 0.12, 4)
  });

  selectSegment(segmentId, line);
  normalizeState();
}

function pointerDistance(first, second) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function pointerMidpoint(first, second) {
  return {
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2
  };
}

function captureCanvasPointer(event) {
  try {
    svg.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture may be unavailable in embedded browsers.
  }
}

function releaseCanvasPointer(event) {
  try {
    svg.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture may already be released.
  }
}

function startCanvasGesture(event) {
  event.preventDefault();
  event.stopPropagation();
  activePointers.set(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY
  });
  captureCanvasPointer(event);

  if (activePointers.size === 1) {
    panGesture = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      view: { ...canvasView },
      moved: false
    };
    return;
  }

  if (activePointers.size === 2) {
    const [first, second] = [...activePointers.values()];
    const midpoint = pointerMidpoint(first, second);
    panGesture = null;
    pinchGesture = {
      distance: pointerDistance(first, second),
      midpoint,
      anchor: svgPointFromClient(midpoint.clientX, midpoint.clientY),
      view: { ...canvasView }
    };
  }
}

function moveCanvasGesture(event) {
  const pointer = activePointers.get(event.pointerId);

  if (!pointer || dragHandle) {
    return;
  }

  pointer.clientX = event.clientX;
  pointer.clientY = event.clientY;

  if (activePointers.size >= 2 && pinchGesture) {
    event.preventDefault();
    const [first, second] = [...activePointers.values()];
    const distance = pointerDistance(first, second);
    const midpoint = pointerMidpoint(first, second);
    const rect = svg.getBoundingClientRect();
    const scale = distance / pinchGesture.distance;
    const width = pinchGesture.view.width / scale;
    const height = pinchGesture.view.height / scale;
    const dx = (midpoint.clientX - pinchGesture.midpoint.clientX) * pinchGesture.view.width / rect.width;
    const dy = (midpoint.clientY - pinchGesture.midpoint.clientY) * pinchGesture.view.height / rect.height;

    setCanvasView({
      x: pinchGesture.anchor.x - width / 2 - dx,
      y: pinchGesture.anchor.y - height / 2 - dy,
      width,
      height
    });
    suppressCanvasClick = true;
    return;
  }

  if (activePointers.size === 1 && panGesture?.pointerId === event.pointerId) {
    event.preventDefault();
    const dx = event.clientX - panGesture.clientX;
    const dy = event.clientY - panGesture.clientY;

    if (Math.hypot(dx, dy) > 4) {
      panGesture.moved = true;
    }

    if (currentZoom() <= 1.04) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    setCanvasView({
      x: panGesture.view.x - dx * panGesture.view.width / rect.width,
      y: panGesture.view.y - dy * panGesture.view.height / rect.height,
      width: panGesture.view.width,
      height: panGesture.view.height
    });
    suppressCanvasClick = true;
  }
}

function endCanvasGesture(event) {
  activePointers.delete(event.pointerId);
  releaseCanvasPointer(event);

  if (activePointers.size < 2) {
    pinchGesture = null;
  }

  if (panGesture?.pointerId === event.pointerId) {
    panGesture = null;
  }
}

function handleWheelZoom(event) {
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0012);
  const point = svgPointFromEvent(event);
  const width = canvasView.width / factor;
  const height = canvasView.height / factor;
  const xRatio = (point.x - canvasView.x) / canvasView.width;
  const yRatio = (point.y - canvasView.y) / canvasView.height;

  setCanvasView({
    x: point.x - width * xRatio,
    y: point.y - height * yRatio,
    width,
    height
  });
}

function preventCanvasNativeGesture(event) {
  event.preventDefault();
}

svg.addEventListener("pointerdown", (event) => {
  const pointId = event.target?.dataset?.point;
  const line = event.target?.dataset?.line;
  const segmentId = event.target?.dataset?.segment;
  const curveSegmentId = event.target?.dataset?.curve;

  if (curveSegmentId && line) {
    event.preventDefault();
    event.stopPropagation();
    captureCanvasPointer(event);
    dragHandle = { type: "curve", line, segmentId: curveSegmentId, pointerId: event.pointerId, moved: false };
    selectSegment(curveSegmentId, line);
    render();
    return;
  }

  if (pointId && line) {
    event.preventDefault();
    event.stopPropagation();
    selectPoint(line, pointId);

    if (line === "inner" && state.uniformWall) {
      render();
      return;
    }

    captureCanvasPointer(event);
    dragHandle = { type: "point", line, pointId, pointerId: event.pointerId, moved: false };
    return;
  }

  if (segmentId) {
    event.preventDefault();
    event.stopPropagation();
    selectSegment(segmentId, line || state.editingLine);
    render();
    return;
  }

  startCanvasGesture(event);
});

svg.addEventListener("pointermove", (event) => {
  if (dragHandle) {
    if (dragHandle.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragHandle.moved = true;

    if (dragHandle.type === "curve") {
      updateCurveFromDrag(dragHandle.line, dragHandle.segmentId, svgPointFromEvent(event));
    } else {
      updatePointFromDrag(dragHandle.line, dragHandle.pointId, svgPointFromEvent(event));
    }

    render();
    return;
  }

  moveCanvasGesture(event);
});

svg.addEventListener("pointerup", (event) => {
  if (dragHandle && dragHandle.pointerId !== event.pointerId) {
    return;
  }

  if (dragHandle && !dragHandle.moved) {
    render();
  }
  releaseCanvasPointer(event);
  dragHandle = null;
  endCanvasGesture(event);
});

svg.addEventListener("pointercancel", (event) => {
  releaseCanvasPointer(event);
  dragHandle = null;
  endCanvasGesture(event);
});

svg.addEventListener("wheel", handleWheelZoom, { passive: false });
svg.addEventListener("touchstart", preventCanvasNativeGesture, { passive: false });
svg.addEventListener("touchmove", preventCanvasNativeGesture, { passive: false });
svg.addEventListener("contextmenu", preventCanvasNativeGesture);
svg.addEventListener("selectstart", preventCanvasNativeGesture);
svg.addEventListener("dragstart", preventCanvasNativeGesture);

svg.addEventListener("click", () => {
  if (suppressCanvasClick) {
    suppressCanvasClick = false;
  }
});

function isInspectorState(value) {
  return value === "expanded" || value === "compact" || value === "minimized";
}

function nextInspectorState() {
  if (state.inspectorState === "expanded") {
    return "compact";
  }
  if (state.inspectorState === "compact") {
    return "minimized";
  }
  return "expanded";
}

function setInspectorState(nextState) {
  if (!isInspectorState(nextState)) {
    return;
  }
  state.inspectorState = nextState;
  render();
  bottomInspector.scrollTop = 0;
}

function suppressNextSheetClick() {
  suppressSheetClick = true;
  window.setTimeout(() => {
    suppressSheetClick = false;
  }, 450);
}

function sheetStateFromSwipe(startState, deltaY, elapsedMs) {
  const distance = Math.abs(deltaY);
  const isQuickSwipe = elapsedMs < 260 && distance > 16;
  if (distance < 30 && !isQuickSwipe) {
    return null;
  }

  if (deltaY < 0) {
    return "expanded";
  }

  return startState === "expanded" ? "compact" : "minimized";
}

function sheetStateFromTap(target) {
  return target === compactSelectedButton ? "expanded" : nextInspectorState();
}

function beginSheetDrag(event) {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  sheetDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    lastY: event.clientY,
    startedAt: performance.now(),
    startState: state.inspectorState,
    target: event.currentTarget,
    moved: false
  };
  bottomInspector.classList.add("is-dragging");
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function updateSheetDrag(event) {
  if (!sheetDrag || sheetDrag.pointerId !== event.pointerId) {
    return;
  }

  sheetDrag.lastY = event.clientY;
  if (Math.abs(sheetDrag.lastY - sheetDrag.startY) > 6) {
    sheetDrag.moved = true;
  }
  event.preventDefault();
  event.stopPropagation();
}

function finishSheetDrag(event) {
  if (!sheetDrag || sheetDrag.pointerId !== event.pointerId) {
    return;
  }

  sheetDrag.lastY = event.clientY;
  const deltaY = sheetDrag.lastY - sheetDrag.startY;
  const elapsedMs = performance.now() - sheetDrag.startedAt;
  const startState = sheetDrag.startState;
  const target = sheetDrag.target;
  const nextState = sheetDrag.moved
    ? sheetStateFromSwipe(startState, deltaY, elapsedMs)
    : sheetStateFromTap(target);

  target.releasePointerCapture?.(event.pointerId);
  sheetDrag = null;
  suppressNextSheetClick();
  bottomInspector.classList.remove("is-dragging");
  event.preventDefault();
  event.stopPropagation();

  if (nextState) {
    setInspectorState(nextState);
  }
}

function cancelSheetDrag(event) {
  if (!sheetDrag || sheetDrag.pointerId !== event.pointerId) {
    return;
  }

  const deltaY = sheetDrag.lastY - sheetDrag.startY;
  const elapsedMs = performance.now() - sheetDrag.startedAt;
  const nextState = sheetDrag.moved
    ? sheetStateFromSwipe(sheetDrag.startState, deltaY, elapsedMs)
    : null;

  sheetDrag.target.releasePointerCapture?.(event.pointerId);
  sheetDrag = null;
  bottomInspector.classList.remove("is-dragging");

  if (nextState) {
    setInspectorState(nextState);
  }
}

function handleSheetButtonClick(event, nextStateFactory) {
  if (suppressSheetClick) {
    suppressSheetClick = false;
    return;
  }

  setInspectorState(nextStateFactory(event.currentTarget));
}

function bindSheetDragTarget(element, nextStateFactory) {
  element.addEventListener("pointerdown", beginSheetDrag);
  element.addEventListener("pointermove", updateSheetDrag);
  element.addEventListener("pointerup", finishSheetDrag);
  element.addEventListener("pointercancel", cancelSheetDrag);
  element.addEventListener("click", (event) => handleSheetButtonClick(event, nextStateFactory));
}

window.addEventListener("pointermove", updateSheetDrag);
window.addEventListener("pointerup", finishSheetDrag);
window.addEventListener("pointercancel", cancelSheetDrag);

pointModeButton.addEventListener("click", () => {
  selectPointMode();
  render();
});

segmentModeButton.addEventListener("click", () => {
  selectSegmentMode();
  render();
});

addPointButton.addEventListener("click", () => {
  if (state.selectedKind !== "segment") {
    state.selectedKind = "segment";
    state.selectedSegmentId = selectedSegmentIdForPoint(state.selectedPointId);
  }
  insertPointInSelectedSegment();
});

deletePointButton.addEventListener("click", deleteSelectedPoint);

outerLineButton.addEventListener("click", () => {
  setEditingLine("outer");
  render();
});

innerLineButton.addEventListener("click", () => {
  setEditingLine("inner");
  render();
});

bindSheetDragTarget(inspectorToggle, () => nextInspectorState());
bindSheetDragTarget(compactSelectedButton, () => "expanded");

compactLineButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setEditingLine(button.dataset.compactLine);
    render();
  });
});

compactKindButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.compactKind === "segment") {
      selectSegmentMode();
    } else {
      selectPointMode();
    }
    render();
  });
});

uniformWallToggle.addEventListener("change", () => {
  const nextUniformWall = uniformWallToggle.checked;
  if (!nextUniformWall && state.uniformWall) {
    copyCurrentInnerProfileToCustom();
  }
  state.uniformWall = nextUniformWall;
  render();
});

finishedBasis.addEventListener("click", () => {
  state.basis = "finished";
  render();
});

wetBasis.addEventListener("click", () => {
  state.basis = "wet";
  render();
});

shrinkageInput.addEventListener("input", () => {
  state.shrinkage = clamp(Number(shrinkageInput.value) || 0, 0, 30);
  render();
});

arQuickLookLink.addEventListener("click", prepareArQuickLookLink);

window.addEventListener("pagehide", persistDesignNow);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    persistDesignNow();
  }
});

try {
  restorePersistedDesign();
  render();
} catch (error) {
  window.__clayFormRenderError = {
    name: error?.name,
    message: error?.message,
    stack: error?.stack
  };
  document.body.dataset.renderError = `${error?.name || "Error"}: ${error?.message || "Unknown render error"}`;
  console.error("ClayForm render failed", error);
}
