const svg = document.querySelector("#profileCanvas");
const selectedLabel = document.querySelector("#selectedLabel");
const controlsTitle = document.querySelector("#controlsTitle");
const controlsRoot = document.querySelector("#sectionControls");
const rangeTemplate = document.querySelector("#rangeControlTemplate");
const clayEstimate = document.querySelector("#clayEstimate");
const clayEstimateValue = document.querySelector("#clayEstimateValue");
const shrinkageInput = document.querySelector("#shrinkageInput");
const finishedBasis = document.querySelector("#finishedBasis");
const wetBasis = document.querySelector("#wetBasis");
const resetViewButton = document.querySelector("#fullViewButton");
const uniformWallToggle = document.querySelector("#uniformWallToggle");
const outerLineButton = document.querySelector("#outerLineButton");
const innerLineButton = document.querySelector("#innerLineButton");
const pointModeButton = document.querySelector("#pointModeButton");
const segmentModeButton = document.querySelector("#segmentModeButton");
const addPointButton = document.querySelector("#addPointButton");
const deletePointButton = document.querySelector("#deletePointButton");

const baseViewBox = {
  x: 0,
  y: -80,
  width: 588,
  height: 720
};

const canvasView = { ...baseViewBox };
const activePointers = new Map();

const state = {
  basis: "finished",
  editingLine: "outer",
  selectedKind: "point",
  selectedPointId: "belly",
  selectedSegmentId: "belly-lower",
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
  }
};

const outerOnlyPointIds = new Set(["foot", "base"]);

let dragHandle = null;
let panGesture = null;
let pinchGesture = null;
let suppressCanvasClick = false;

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

function setSegmentStyle(segmentId, style) {
  state.segmentStyles[segmentId] = style;
  delete state.segmentStyles[reverseSegmentKey(segmentId)];

  if (style === "curve") {
    ensureCurveControlForLine(state.editingLine, segmentId);
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

function normalizeOuterPoints() {
  const minGap = 0.22;

  state.outerPoints.forEach((point, index) => {
    point.radius = clamp(point.radius, 0.25, 4);

    if (point.fixed === "base") {
      point.height = 0;
      return;
    }

    const maxHeight = index === 0 ? 10 : state.outerPoints[index - 1].height - minGap;
    const minHeight = index === state.outerPoints.length - 1
      ? 0
      : state.outerPoints[index + 1].height + minGap;

    point.height = clamp(point.height, minHeight, maxHeight);
  });

  state.outerPoints[0].height = clamp(
    state.outerPoints[0].height,
    state.outerPoints[1].height + minGap,
    10
  );
}

function derivedInnerPoints() {
  normalizeOuterPoints();
  const floorHeight = clamp(state.floorThickness, 0.15, state.outerPoints[0].height - 0.5);
  const points = [];

  state.outerPoints.forEach((point) => {
    if (isOuterOnlyPoint(point) || point.height <= floorHeight + 0.03) {
      return;
    }

    const thickness = point.id === "rim" ? state.rimThickness : state.wallThickness;
    points.push({
      id: point.id,
      label: `Inner ${point.label}`,
      height: point.height,
      radius: Math.max(0.12, point.radius - thickness)
    });
  });

  const footPoint = footReferencePoint();
  const floorRadius = footPoint
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
  const minGap = 0.18;
  const outerById = new Map(state.outerPoints.map((point) => [point.id, point]));
  state.innerPoints = state.innerPoints.filter((point) => {
    if (point.fixed === "floor" || point.id === "floor") {
      return true;
    }

    const outer = outerById.get(point.id);
    return !isOuterOnlyPoint(point) && !isOuterOnlyPoint(outer);
  });

  state.innerPoints.forEach((point, index) => {
    const outer = outerById.get(point.id);
    const maxRadius = outer ? outer.radius - 0.08 : footReferencePoint().radius - 0.08;
    point.radius = clamp(point.radius, 0.12, Math.max(0.14, maxRadius));

    if (point.fixed === "floor" || point.id === "floor") {
      point.height = clamp(point.height, 0.15, state.outerPoints[0].height - 0.5);
      return;
    }

    const maxHeight = index === 0 ? state.outerPoints[0].height : state.innerPoints[index - 1].height - minGap;
    const minHeight = index === state.innerPoints.length - 1
      ? 0.15
      : state.innerPoints[index + 1].height + minGap;
    point.height = clamp(point.height, minHeight, maxHeight);
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

  const [outerFirst, outerSecond] = pointsForSegment("outer", segmentId);
  const [innerFirst, innerSecond] = pointsForSegment("inner", segmentId);

  return Boolean(outerFirst && outerSecond && innerFirst && innerSecond);
}

function wallOffsetAtSegmentHeight(segmentId, height) {
  const [outerFirst, outerSecond] = pointsForSegment("outer", segmentId);
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

function innerControlFromOuter(segmentId, outerControl) {
  const offset = wallOffsetAtSegmentHeight(segmentId, outerControl.height);

  return {
    height: outerControl.height,
    radius: Math.max(0.12, outerControl.radius - offset)
  };
}

function outerControlFromInner(segmentId, innerControl) {
  const offset = wallOffsetAtSegmentHeight(segmentId, innerControl.height);

  return {
    height: innerControl.height,
    radius: clamp(innerControl.radius + offset, 0.12, 4)
  };
}

function ensureCurveControlForLine(line, segmentId, fallbackFirst = null, fallbackSecond = null) {
  if (hasUniformCurveLink(line, segmentId)) {
    return innerControlFromOuter(segmentId, ensureSegmentCurveControl("outer", segmentId));
  }

  return ensureSegmentCurveControl(line, segmentId, fallbackFirst, fallbackSecond);
}

function setCurveControlForLine(line, segmentId, control) {
  if (hasUniformCurveLink(line, segmentId)) {
    const key = segmentControlKey("outer", segmentId);
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
    d += ` ${segmentPath(start, end, styleForSegment(start.id, end.id), line)}`;
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
  const radius = active ? 14 : 10;
  const cssClass = active ? "svg-point-active" : className;

  return `<circle class="${cssClass}" data-line="${line}" data-point="${point.id}" cx="${mapped.x}" cy="${mapped.y}" r="${radius}"/>`;
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
  const d = `M${start.x} ${start.y} ${segmentPath(start, end, styleForSegment(first.id, second.id), line)}`;
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

    if (styleForSegment(point.id, nextPoint.id) !== "curve") {
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
  const rim = state.outerPoints[0];
  const selected = selectedPoint();
  const selectedMapped = g.mapPoint(selected, "right");
  const leftX = g.xForRadius(selected.radius, "left");
  const rightX = g.xForRadius(selected.radius, "right");
  const labelY = selectedMapped.y - 22;
  const heightY = g.yForHeight(rim.height);

  return `
    <path class="svg-dimension" d="M544 ${heightY} V${g.bottomY}"/>
    <path class="svg-dimension" d="M532 ${heightY} H556"/>
    <path class="svg-dimension" d="M532 ${g.bottomY} H556"/>
    ${svgTextEnd(534, g.bottomY - 88, outputText(rim.height), "svg-label-small")}

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
      return "Segment";
    }
    return `${first.label} to ${second.label}`;
  }

  const point = selectedPoint();
  return point.label.toLowerCase().startsWith("point")
    ? point.label
    : `${point.label} point`;
}

function formatControlValue(value, mode = "dimension") {
  if (mode === "percent") {
    return `${value.toFixed(0)}%`;
  }

  return outputText(value);
}

function makeRangeControl(definition) {
  const fragment = rangeTemplate.content.cloneNode(true);
  const labelNode = fragment.querySelector(".control-label");
  const input = fragment.querySelector("input");
  const output = fragment.querySelector("output");
  let activePointerId = null;

  labelNode.textContent = definition.label;
  input.min = definition.min;
  input.max = definition.max;
  input.step = definition.step;
  input.value = definition.get();
  output.value = formatControlValue(definition.get(), definition.mode);

  const updateValue = (value) => {
    definition.set(snapToStep(value, Number(definition.step)));
    normalizeState();
    input.value = definition.get();
    output.value = formatControlValue(definition.get(), definition.mode);
    render();
  };

  input.addEventListener("input", () => {
    updateValue(Number(input.value));
  });

  input.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    activePointerId = event.pointerId;
    try {
      input.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded mobile browsers do not support range pointer capture.
    }
    const rect = input.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    updateValue(Number(definition.min) + ratio * (Number(definition.max) - Number(definition.min)));
  });

  input.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const rect = input.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    updateValue(Number(definition.min) + ratio * (Number(definition.max) - Number(definition.min)));
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
    input.addEventListener(type, (event) => {
      if (activePointerId === event.pointerId || type === "lostpointercapture") {
        activePointerId = null;
      }
    });
  });

  controlsRoot.appendChild(fragment);
}

function selectedPointControls() {
  const point = selectedPoint();
  const controls = [
    {
      label: "Diameter",
      min: 0.5,
      max: 8,
      step: 0.05,
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

function renderSegmentControls() {
  const style = styleForSegment(...state.selectedSegmentId.split("-"));
  const [first, second] = selectedSegmentPoints();
  const wrapper = document.createElement("div");
  wrapper.className = "line-style-control";
  wrapper.innerHTML = `
    <span>Line style</span>
    <div class="style-toggle" role="group" aria-label="Segment line style">
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

  controlsRoot.appendChild(wrapper);

  if (style === "curve" && first && second) {
    const line = state.editingLine;
    const segmentId = state.selectedSegmentId;
    const minHeight = Math.min(first.height, second.height);
    const maxHeight = Math.max(first.height, second.height);

    makeRangeControl({
      label: "Control diameter",
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
    });

    makeRangeControl({
      label: "Control height",
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
    });
  }
}

function renderControls() {
  selectedLabel.textContent = selectedName();
  controlsRoot.replaceChildren();

  if (state.selectedKind === "segment") {
    controlsTitle.textContent = "Segment controls";
    renderSegmentControls();
    return;
  }

  controlsTitle.textContent = `${titleCase(state.editingLine)} point controls`;
  selectedPointControls().forEach(makeRangeControl);
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
  uniformWallToggle.checked = state.uniformWall;
  shrinkageInput.value = state.shrinkage;

  const canDelete = state.selectedKind === "point"
    && state.editingLine === "outer"
    && !selectedPoint().fixed
    && state.outerPoints.length > 3;
  deletePointButton.disabled = !canDelete;
}

function render() {
  renderChrome();
  renderCanvas();
  renderControls();
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
    ensureCustomInner();
    state.uniformWall = false;
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
    ensureCustomInner();
    state.uniformWall = false;
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
    captureCanvasPointer(event);
    dragHandle = { type: "point", line, pointId, pointerId: event.pointerId, moved: false };
    selectPoint(line, pointId);
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

pointModeButton.addEventListener("click", () => {
  state.selectedKind = "point";
  render();
});

segmentModeButton.addEventListener("click", () => {
  state.selectedKind = "segment";
  state.selectedSegmentId = selectedSegmentIdForPoint(state.selectedPointId);
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
  state.editingLine = "outer";
  if (!state.outerPoints.some((point) => point.id === state.selectedPointId)) {
    state.selectedPointId = state.outerPoints[0].id;
  }
  render();
});

innerLineButton.addEventListener("click", () => {
  state.editingLine = "inner";
  const points = innerProfilePoints();
  if (!points.some((point) => point.id === state.selectedPointId)) {
    state.selectedPointId = points[0].id;
  }
  render();
});

uniformWallToggle.addEventListener("change", () => {
  state.uniformWall = uniformWallToggle.checked;
  if (!state.uniformWall) {
    ensureCustomInner();
  }
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

resetViewButton.addEventListener("click", () => {
  resetCanvasView();
});

shrinkageInput.addEventListener("input", () => {
  state.shrinkage = clamp(Number(shrinkageInput.value) || 0, 0, 30);
  render();
});

try {
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
