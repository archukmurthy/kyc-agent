(function publish(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("react"));
  else root.UboControlUI = factory(root.React);
}(typeof globalThis !== "undefined" ? globalThis : this, function factory(React) {
  "use strict";

  const h = React.createElement;
  const CONTRACT_VERSION = "ubo-ownership-graph-projection-v1";
  const DETAIL_LEVEL = Object.freeze({ CUSTOMER: "CUSTOMER", EXPLAIN: "EXPLAIN" });
  const NW = 196;
  const NH = 92;
  const HG = 64;
  const VG = 154;
  const PAD = 72;

  const RELATIONSHIP_LABELS = Object.freeze({
    ECONOMIC_OWNERSHIP: "Economic ownership",
    VOTING_RIGHTS: "Voting rights",
    BOARD_APPOINTMENT_RIGHT: "Board appointment control",
    MANAGEMENT_APPOINTMENT_RIGHT: "Management appointment control",
    REMOVAL_RIGHT: "Removal control",
    SIGNIFICANT_INFLUENCE_OR_CONTROL: "Significant influence or control",
    OTHER_FORMAL_CONTROL: "Other formal control",
    TRUST_OWNERSHIP: "Trust ownership",
    SETTLOR: "Settlor",
    TRUSTEE: "Trustee",
    BENEFICIARY: "Beneficiary",
    PROTECTOR: "Protector",
    INTERMEDIARY: "Intermediary",
  });

  const BASIS_LABELS = Object.freeze({
    ECONOMIC_OWNERSHIP: "Qualifies through economic ownership",
    VOTING_RIGHTS: "Qualifies through voting control",
    APPOINTMENT_CONTROL: "Qualifies through appointment or removal control",
    SIGNIFICANT_INFLUENCE_OR_CONTROL: "Qualifies through significant influence or control",
    SENIOR_MANAGING_OFFICIAL_FALLBACK: "Senior managing official fallback",
  });

  const ROLE_LABELS = Object.freeze({
    beneficial_owner: "Beneficial owner",
    controller_voting: "Voting controller",
    controller_appointment: "Appointment controller",
    controller_significant_influence: "Significant-control person",
    senior_managing_official_fallback: "Senior managing official fallback",
  });

  const CATEGORIES = Object.freeze({
    NATURAL_PERSON: { icon: "●", label: "Natural person", css: "person" },
    LEGAL_ENTITY: { icon: "▣", label: "Legal entity", css: "entity" },
    TRUST_OR_LEGAL_ARRANGEMENT: { icon: "◇", label: "Trust / legal arrangement", css: "trust" },
    OTHER: { icon: "◆", label: "Other structure", css: "other" },
    UNKNOWN: { icon: "?", label: "Unknown entity", css: "unknown" },
  });

  function humanize(value) {
    return String(value || "").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
  }

  function relationshipLabel(type) {
    return RELATIONSHIP_LABELS[type] || humanize(type || "Relationship");
  }

  function basisLabel(type) {
    return BASIS_LABELS[type] || humanize(type || "Qualifying basis");
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || humanize(role || "Role");
  }

  function assertProjection(projection) {
    if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
      throw new TypeError("OwnershipGraph requires a projection object");
    }
    if (projection.contractVersion !== CONTRACT_VERSION) {
      throw new TypeError(`OwnershipGraph supports only ${CONTRACT_VERSION}`);
    }
    ["nodes", "relationships", "calculations", "qualifications", "unresolved", "conflicts", "reviews"]
      .forEach((field) => {
        if (!Array.isArray(projection[field])) throw new TypeError(`projection.${field} must be an array`);
      });
    if (!projection.subject || typeof projection.subject.entityId !== "string") {
      throw new TypeError("projection.subject must identify the regulated subject");
    }
    return projection;
  }

  function formatMeasurement(measurement, detailed = false) {
    if (!measurement || measurement.type === "UNKNOWN") return "Unknown";
    if (measurement.type === "EXACT") return `${measurement.value}%`;
    if (measurement.type === "RANGE") {
      if (!detailed) return `${measurement.lowerBound}–${measurement.upperBound}%`;
      return `${measurement.lowerInclusive ? "[" : "("}${measurement.lowerBound}%, ${measurement.upperBound}%${measurement.upperInclusive ? "]" : ")"}`;
    }
    return "Unknown";
  }

  function short(value, length) {
    const text = String(value || "Unknown");
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function computeLayout(projection) {
    const nodes = [...projection.nodes].sort((a, b) => a.entityId.localeCompare(b.entityId));
    const relationships = [...projection.relationships].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
    const depth = new Map([[projection.subject.entityId, 0]]);
    let changed = true;
    let pass = 0;
    while (changed && pass <= nodes.length) {
      changed = false;
      pass += 1;
      relationships.forEach((relationship) => {
        if (!depth.has(relationship.targetEntityId)) return;
        const next = depth.get(relationship.targetEntityId) + 1;
        if (!depth.has(relationship.sourceEntityId) || next > depth.get(relationship.sourceEntityId)) {
          depth.set(relationship.sourceEntityId, next);
          changed = true;
        }
      });
    }
    const connectedMax = Math.max(0, ...depth.values());
    nodes.forEach((node) => { if (!depth.has(node.entityId)) depth.set(node.entityId, connectedMax + 1); });
    const maxDepth = Math.max(0, ...depth.values());
    const layers = new Map();
    nodes.forEach((node) => {
      const value = depth.get(node.entityId);
      if (!layers.has(value)) layers.set(value, []);
      layers.get(value).push(node);
    });
    const widest = Math.max(1, ...[...layers.values()].map((items) => items.length));
    const width = Math.max(920, (PAD * 2) + (widest * NW) + ((widest - 1) * HG));
    const height = (PAD * 2) + NH + (maxDepth * VG);
    const positions = new Map();
    [...layers.entries()].forEach(([layer, layerNodes]) => {
      layerNodes.sort((a, b) => a.entityId.localeCompare(b.entityId));
      const layerWidth = (layerNodes.length * NW) + ((layerNodes.length - 1) * HG);
      const startX = (width - layerWidth) / 2;
      layerNodes.forEach((node, index) => positions.set(node.entityId, {
        x: startX + (index * (NW + HG)),
        y: PAD + ((maxDepth - layer) * VG),
      }));
    });
    return { width, height, positions, relationships, nodes };
  }

  function relationshipsForPath(path, projection) {
    return (path.relationshipIds || []).map((id) => projection.relationships.find((item) => item.relationshipId === id)).filter(Boolean);
  }

  function parallelRelationshipOffset(relationship, relationships) {
    const siblings = relationships.filter((item) => item.sourceEntityId === relationship.sourceEntityId
      && item.targetEntityId === relationship.targetEntityId);
    if (siblings.length < 2) return 0;
    const index = siblings.findIndex((item) => item.relationshipId === relationship.relationshipId);
    return (index - ((siblings.length - 1) / 2)) * 52;
  }

  function pathExpression(path, projection) {
    const values = relationshipsForPath(path, projection).map((relationship) => formatMeasurement(relationship.measurement, true));
    return `${values.length ? values.join(" × ") : "Recorded path"} = ${formatMeasurement(path.contribution, true)}`;
  }

  function activeRelationshipIds(selection, projection) {
    if (!selection) return new Set();
    if (selection.kind === "relationship") return new Set([selection.id]);
    if (selection.kind === "path") return new Set(selection.relationshipIds || []);
    if (selection.kind === "conflict") return new Set(projection.conflicts.find((item) => item.conflictId === selection.id)?.relatedRelationshipIds || []);
    if (selection.kind === "review") return new Set(projection.reviews.find((item) => item.reviewId === selection.id)?.relationshipIds || []);
    if (selection.kind === "entity") {
      const calculations = new Set(projection.qualifications.filter((item) => item.entityId === selection.id)
        .flatMap((item) => item.bases || []).map((basis) => basis.calculationId).filter(Boolean));
      const pathIds = projection.calculations.filter((item) => calculations.has(item.calculationId))
        .flatMap((item) => item.paths || []).flatMap((path) => path.relationshipIds || []);
      if (pathIds.length) return new Set(pathIds);
      return new Set(projection.relationships.filter((item) => item.sourceEntityId === selection.id || item.targetEntityId === selection.id)
        .map((item) => item.relationshipId));
    }
    return new Set();
  }

  function badgesFor(node) {
    const output = [];
    const add = (semantic, label, css) => { if (node.semantics.includes(semantic)) output.push({ semantic, label, css }); };
    add("SUBJECT", "Customer", "subject");
    add("QUALIFYING_PERSON", "Qualifying", "qualifying");
    add("UNRESOLVED_ENTITY", "Unresolved", "unresolved");
    add("REVIEW_REQUIRED", "Review", "review");
    add("CONFLICT", "Conflict", "conflict");
    add("SPECIAL_STRUCTURE", "Special structure", "special");
    return output;
  }

  function Summary({ projection }) {
    const summary = projection.summary || {};
    const items = [
      ["Entities", summary.totalEntities ?? projection.nodes.length],
      ["Relationships", summary.totalRelationships ?? projection.relationships.length],
      ["Qualifying people", summary.qualifyingPeople ?? projection.qualifications.length],
      ["Unresolved", summary.unresolvedBranches ?? projection.unresolved.length],
      ["Conflicts", summary.conflicts ?? projection.conflicts.length],
      ["Reviews", summary.reviewRequirements ?? projection.reviews.length],
    ];
    return h("div", { className: "ug-summary", "aria-label": "Graph summary" }, items.map(([label, value]) => h("div", { className: "ug-summary-item", key: label }, h("strong", null, String(value)), h("span", null, label))));
  }

  function PathCard({ path, projection, onSelect }) {
    const names = new Map(projection.nodes.map((node) => [node.entityId, node.displayName]));
    const relationships = relationshipsForPath(path, projection);
    const route = relationships.length
      ? [names.get(relationships[0].sourceEntityId), ...relationships.map((item) => names.get(item.targetEntityId))].filter(Boolean).join(" → ")
      : "Recorded path";
    return h("button", {
      type: "button", className: "ug-path-card",
      onClick: () => onSelect({ kind: "path", id: path.pathId, relationshipIds: path.relationshipIds || [] }),
      "aria-label": `Highlight ${route}: ${pathExpression(path, projection)}`,
    }, h("span", { className: "ug-path-route" }, route), h("span", { className: "ug-path-expression" }, pathExpression(path, projection)), h("span", { className: "ug-path-action" }, "Highlight path"));
  }

  function EntityDetails({ node, projection, detailLevel, onSelect }) {
    const qualification = projection.qualifications.find((item) => item.entityId === node.entityId);
    const calculations = projection.calculations.filter((item) => item.subjectEntityId === node.entityId);
    const unresolved = projection.unresolved.filter((item) => item.entityId === node.entityId);
    const conflicts = projection.conflicts.filter((item) => (item.affectedEntityIds || []).includes(node.entityId));
    const reviews = projection.reviews.filter((item) => (item.entityIds || []).includes(node.entityId));
    const category = CATEGORIES[node.category] || CATEGORIES.UNKNOWN;
    return h(React.Fragment, null,
      h("div", { className: "ug-detail-heading" }, h("span", { className: `ug-detail-icon ${category.css}` }, category.icon), h("div", null,
        h("p", { className: "ug-eyebrow" }, category.label), h("h3", null, node.displayName),
        h("p", { className: "ug-muted" }, [node.jurisdiction, node.entityTypeMetadata?.sourceEntityType].filter(Boolean).join(" · ")))),
      qualification && h("section", { className: "ug-detail-section" }, h("h4", null, "Why this person qualifies"),
        h("div", { className: "ug-role-list" }, qualification.roles.map((role) => h("span", { className: "ug-role-badge", key: role }, roleLabel(role)))),
        (qualification.bases || []).map((basis) => {
          const calculation = basis.calculationId ? projection.calculations.find((item) => item.calculationId === basis.calculationId) : null;
          return h("div", { className: "ug-basis", key: `${basis.assessmentId}:${basis.basisType}` },
            h("strong", null, basisLabel(basis.basisType)),
            calculation && h("p", null, `${calculation.dimension === "VOTING" ? "Effective voting interest" : "Effective economic interest"}: `, h("b", null, formatMeasurement(calculation.result, true))),
            detailLevel === DETAIL_LEVEL.EXPLAIN && h("p", { className: "ug-audit-line" }, `Requirement ${basis.requirementId} · ${basis.rationaleCode}`),
            calculation && (calculation.paths || []).map((path) => h(PathCard, { path, projection, onSelect, key: path.pathId })));
        })),
      calculations.length > 0 && !qualification && h("section", { className: "ug-detail-section" }, h("h4", null, "Recorded effective interests"), calculations.map((calculation) => h("div", { className: "ug-basis", key: calculation.calculationId }, h("strong", null, `${calculation.dimension === "VOTING" ? "Voting" : "Economic"}: ${formatMeasurement(calculation.result, true)}`), (calculation.paths || []).map((path) => h(PathCard, { path, projection, onSelect, key: path.pathId }))))),
      unresolved.length > 0 && h("section", { className: "ug-detail-section unresolved" }, h("h4", null, "Ownership or control remains unresolved"), unresolved.map((item) => h("div", { key: item.unresolvedId, className: "ug-state-detail" }, h("strong", null, humanize(item.concept || "Information required")), h("span", null, `State: ${item.state}`), item.requirementIds?.length > 0 && h("span", null, detailLevel === DETAIL_LEVEL.EXPLAIN ? `Requirements: ${item.requirementIds.join(", ")}` : "Additional ownership/control information is required.")))),
      conflicts.length > 0 && h("section", { className: "ug-detail-section conflict" }, h("h4", null, "Competing facts require resolution"), conflicts.map((item) => h("button", { type: "button", className: "ug-state-link", key: item.conflictId, onClick: () => onSelect({ kind: "conflict", id: item.conflictId }) }, `Inspect conflict (${item.claimIds.length} claims)`))),
      reviews.length > 0 && h("section", { className: "ug-detail-section review" }, h("h4", null, "Internal review"), reviews.map((item) => h("button", { type: "button", className: "ug-state-link", key: item.reviewId, onClick: () => onSelect({ kind: "review", id: item.reviewId }) }, relationshipLabel(item.reviewType || "Review required")))));
  }

  function RelationshipDetails({ relationship, projection, detailLevel }) {
    const entities = new Map(projection.nodes.map((node) => [node.entityId, node]));
    const source = entities.get(relationship.sourceEntityId);
    const target = entities.get(relationship.targetEntityId);
    return h(React.Fragment, null,
      h("p", { className: "ug-eyebrow" }, relationshipLabel(relationship.relationshipType)), h("h3", null, `${source?.displayName || relationship.sourceEntityId} → ${target?.displayName || relationship.targetEntityId}`),
      h("div", { className: "ug-direct-value" }, h("span", null, "Direct relationship value"), h("strong", null, formatMeasurement(relationship.measurement, true))),
      h("dl", { className: "ug-definition-list" }, h("dt", null, "Dimension"), h("dd", null, relationship.dimension || "Non-percentage control"), h("dt", null, "Currentness"), h("dd", null, relationship.temporalState || "Unknown"), h("dt", null, "Supporting claims"), h("dd", null, String(relationship.support?.claimCount || 0))),
      relationship.indicators?.length > 0 && h("div", { className: "ug-role-list" }, relationship.indicators.map((indicator) => h("span", { key: indicator, className: `ug-role-badge ${indicator.toLowerCase()}` }, humanize(indicator)))),
      detailLevel === DETAIL_LEVEL.EXPLAIN && h("section", { className: "ug-detail-section" }, h("h4", null, "Support references"),
        relationship.support?.evidenceReferences?.length
          ? h("ul", { className: "ug-reference-list" }, relationship.support.evidenceReferences.map((reference) => h("li", { key: `${reference.system}:${reference.referenceId}` }, h("strong", null, reference.system), h("span", null, `${reference.referenceType} · ${reference.referenceId}`))))
          : h("p", { className: "ug-muted" }, "No displayable evidence references recorded."),
        relationship.support?.claimIds?.length > 0 && h("p", { className: "ug-audit-line" }, `Claims: ${relationship.support.claimIds.join(", ")}`)));
  }

  function ConflictDetails({ conflict, detailLevel }) {
    return h(React.Fragment, null, h("p", { className: "ug-eyebrow conflict" }, "Unresolved factual conflict"), h("h3", null, "Competing facts exist"), h("p", null, "UBO Control has preserved competing assertions and has not selected a winner."),
      h("dl", { className: "ug-definition-list" }, h("dt", null, "State"), h("dd", null, conflict.state), h("dt", null, "Claims"), h("dd", null, String(conflict.claimIds.length)), h("dt", null, "Evidence references"), h("dd", null, String(conflict.evidenceReferences?.length || 0))),
      detailLevel === DETAIL_LEVEL.EXPLAIN && h("section", { className: "ug-detail-section conflict" }, h("h4", null, "Claim references"), h("ul", { className: "ug-reference-list" }, conflict.claimIds.map((claimId) => h("li", { key: claimId }, claimId)))));
  }

  function ReviewDetails({ review, detailLevel }) {
    return h(React.Fragment, null, h("p", { className: "ug-eyebrow review" }, "Deliberate internal review state"), h("h3", null, relationshipLabel(review.reviewType || "Review required")), h("p", null, "This branch or conclusion requires internal review; the graph is not broken."),
      h("dl", { className: "ug-definition-list" }, h("dt", null, "State"), h("dd", null, review.state || "REVIEW_REQUIRED"), h("dt", null, "Reason"), h("dd", null, review.reasonCode || "Recorded review requirement")),
      detailLevel === DETAIL_LEVEL.EXPLAIN && review.requirementIds?.length > 0 ? h("p", { className: "ug-audit-line" }, `Requirements: ${review.requirementIds.join(", ")}`) : null);
  }

  function EmptyDetails({ projection, onSelect }) {
    return h(React.Fragment, null, h("p", { className: "ug-eyebrow" }, "Ownership and control map"), h("h3", null, projection.subject.displayName), h("p", null, projection.relationships.length ? "Select a person, entity or relationship to inspect its recorded reasoning." : "No safe ownership or control relationships are currently established."),
      projection.unresolved.length > 0 && h("section", { className: "ug-detail-section unresolved" }, h("h4", null, `${projection.unresolved.length} unresolved item${projection.unresolved.length === 1 ? "" : "s"}`), h("p", null, "The subject remains visible while ownership/control information is incomplete."), h("button", { type: "button", className: "ug-state-link", onClick: () => onSelect({ kind: "entity", id: projection.unresolved.find((item) => item.entityId)?.entityId || projection.subject.entityId }) }, "Inspect unresolved state")));
  }

  function DetailPanel({ selection, projection, detailLevel, onSelect, panelRef }) {
    let content = null;
    if (selection?.kind === "entity") {
      const node = projection.nodes.find((item) => item.entityId === selection.id);
      if (node) content = h(EntityDetails, { node, projection, detailLevel, onSelect });
    } else if (selection?.kind === "relationship") {
      const relationship = projection.relationships.find((item) => item.relationshipId === selection.id);
      if (relationship) content = h(RelationshipDetails, { relationship, projection, detailLevel });
    } else if (selection?.kind === "conflict") {
      const conflict = projection.conflicts.find((item) => item.conflictId === selection.id);
      if (conflict) content = h(ConflictDetails, { conflict, detailLevel });
    } else if (selection?.kind === "review") {
      const review = projection.reviews.find((item) => item.reviewId === selection.id);
      if (review) content = h(ReviewDetails, { review, detailLevel });
    } else if (selection?.kind === "path") {
      const calculation = projection.calculations.find((item) => (item.paths || []).some((path) => path.pathId === selection.id));
      const path = calculation?.paths?.find((item) => item.pathId === selection.id);
      if (path) content = h(React.Fragment, null, h("p", { className: "ug-eyebrow" }, "Recorded calculation path"), h("h3", null, pathExpression(path, projection)), h("p", null, "The highlighted relationships are the exact recorded path. The renderer has not performed arithmetic."));
    }
    return h("aside", { className: "ug-detail-panel", ref: panelRef, tabIndex: -1, "aria-label": "Selected graph item details" }, content || h(EmptyDetails, { projection, onSelect }));
  }

  function OwnershipGraph({ projection: supplied, detailLevel = DETAIL_LEVEL.CUSTOMER, onSelectionChange, className = "", height, highlightEntityIds = [], highlightRelationshipIds = [] }) {
    const projection = assertProjection(supplied);
    if (!Object.values(DETAIL_LEVEL).includes(detailLevel)) throw new TypeError("detailLevel must be CUSTOMER or EXPLAIN");
    const layout = React.useMemo(() => computeLayout(projection), [projection]);
    const [selection, setSelection] = React.useState(null);
    const [zoom, setZoom] = React.useState(1);
    const [pan, setPan] = React.useState({ x: 0, y: 0 });
    const drag = React.useRef(null);
    const panelRef = React.useRef(null);
    const markerId = `ug-arrow-${React.useId().replaceAll(":", "")}`;
    const journeyEntityIds = new Set(highlightEntityIds);
    const journeyRelationshipIds = new Set(highlightRelationshipIds);
    const activeIds = activeRelationshipIds(selection, projection);
    const select = React.useCallback((next) => {
      setSelection(next);
      if (typeof onSelectionChange === "function") onSelectionChange(next);
    }, [onSelectionChange]);
    React.useEffect(() => { if (selection && panelRef.current) panelRef.current.focus({ preventScroll: true }); }, [selection]);
    React.useEffect(() => { setSelection(null); setZoom(1); setPan({ x: 0, y: 0 }); }, [projection]);

    const zoomBy = (delta) => setZoom((current) => Math.min(1.8, Math.max(0.55, Number((current + delta).toFixed(2)))));
    const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
    const onWheel = (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
      else setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    const onPointerDown = (event) => {
      if (event.target.closest?.("[data-graph-selectable='true']")) return;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event) => {
      if (!drag.current || drag.current.id !== event.pointerId) return;
      setPan({ x: drag.current.pan.x + event.clientX - drag.current.x, y: drag.current.pan.y + event.clientY - drag.current.y });
    };
    const stopDrag = () => { drag.current = null; };
    const nodesById = new Map(layout.nodes.map((node) => [node.entityId, node]));
    const unresolvedEntities = new Set(projection.unresolved.map((item) => item.entityId).filter(Boolean));
    const graphName = `Ownership and control graph for ${projection.subject.displayName}`;
    const snapshot = String(projection.decision.snapshotHash || projection.decision.snapshotId || "").replace("sha256:", "").slice(0, 10);

    const edges = layout.relationships.map((relationship) => {
      const source = layout.positions.get(relationship.sourceEntityId);
      const target = layout.positions.get(relationship.targetEntityId);
      if (!source || !target) return null;
      const parallelOffset = parallelRelationshipOffset(relationship, layout.relationships);
      const x1 = source.x + (NW / 2) + parallelOffset;
      const y1 = source.y + NH;
      const x2 = target.x + (NW / 2) + parallelOffset;
      const y2 = target.y;
      const midY = y1 + ((y2 - y1) / 2);
      const labelX = ((x1 + x2) / 2) + (parallelOffset * 2);
      const labelY = midY - (parallelOffset === 0 ? 0 : 34);
      const edgeLabel = relationship.dimension === "VOTING" ? `Vote · ${formatMeasurement(relationship.measurement)}` : relationship.measurement ? formatMeasurement(relationship.measurement) : short(relationshipLabel(relationship.relationshipType), 22);
      const labelWidth = Math.max(58, Math.min(136, 26 + (edgeLabel.length * 7)));
      const active = activeIds.has(relationship.relationshipId);
      const journeyLinked = journeyRelationshipIds.has(relationship.relationshipId)
        || journeyEntityIds.has(relationship.sourceEntityId) || journeyEntityIds.has(relationship.targetEntityId);
      const css = ["ug-edge", `type-${relationship.relationshipType.toLowerCase().replaceAll("_", "-")}`, active ? "active" : "", journeyLinked ? "journey-linked" : "", activeIds.size && !active ? "muted" : "", relationship.indicators?.includes("CONFLICT") ? "conflict" : "", relationship.indicators?.includes("REVIEW_REQUIRED") ? "review" : ""].filter(Boolean).join(" ");
      const activate = () => select({ kind: "relationship", id: relationship.relationshipId });
      return h("g", { key: relationship.relationshipId, className: css, role: "button", tabIndex: 0, "data-graph-selectable": "true", "aria-label": `${relationshipLabel(relationship.relationshipType)} from ${nodesById.get(relationship.sourceEntityId)?.displayName} to ${nodesById.get(relationship.targetEntityId)?.displayName}, ${formatMeasurement(relationship.measurement)}`, onClick: activate, onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } } },
        h("path", { d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`, markerEnd: `url(#${markerId})` }),
        h("rect", { className: "ug-edge-label-bg", x: labelX - (labelWidth / 2), y: labelY - 14, width: labelWidth, height: 28, rx: 14 }),
        h("text", { className: "ug-edge-label", x: labelX, y: labelY + 4, textAnchor: "middle" }, edgeLabel));
    });

    const nodes = layout.nodes.map((node) => {
      const position = layout.positions.get(node.entityId);
      const category = CATEGORIES[node.category] || CATEGORIES.UNKNOWN;
      const badges = badgesFor(node);
      const selected = selection?.kind === "entity" && selection.id === node.entityId;
      const connected = activeIds.size === 0 || layout.relationships.some((relationship) => activeIds.has(relationship.relationshipId) && (relationship.sourceEntityId === node.entityId || relationship.targetEntityId === node.entityId));
      const activate = () => select({ kind: "entity", id: node.entityId });
      return h("g", { key: node.entityId, className: ["ug-node", category.css, selected ? "selected" : "", journeyEntityIds.has(node.entityId) ? "journey-linked" : "", connected ? "" : "muted"].filter(Boolean).join(" "), transform: `translate(${position.x} ${position.y})`, role: "button", tabIndex: 0, "data-graph-selectable": "true", "aria-pressed": selected, "aria-label": `${node.displayName}, ${category.label}${badges.length ? `, ${badges.map((badge) => badge.label).join(", ")}` : ""}`, onClick: activate, onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } } },
        h("rect", { className: "ug-node-shape", width: NW, height: NH, rx: node.category === "NATURAL_PERSON" ? 44 : 18 }),
        unresolvedEntities.has(node.entityId) && h("rect", { className: "ug-unresolved-outline", x: -7, y: -7, width: NW + 14, height: NH + 14, rx: node.category === "NATURAL_PERSON" ? 51 : 24 }),
        h("text", { className: "ug-node-icon", x: 20, y: 30 }, category.icon), h("text", { className: "ug-node-name", x: 44, y: 30 }, short(node.displayName, 22)), h("text", { className: "ug-node-type", x: 20, y: 54 }, category.label),
        badges.slice(0, 2).map((badge, index) => h("g", { key: badge.semantic, className: `ug-svg-badge ${badge.css}`, transform: `translate(${20 + (index * 84)} 65)` }, h("rect", { width: 78, height: 19, rx: 9 }), h("text", { x: 39, y: 13, textAnchor: "middle" }, short(badge.label, 13)))));
    });

    const stateButtons = [
      ...projection.conflicts.map((item) => ({ kind: "conflict", id: item.conflictId, label: `Conflict · ${item.claimIds.length} claims`, css: "conflict" })),
      ...projection.reviews.map((item) => ({ kind: "review", id: item.reviewId, label: `Review · ${relationshipLabel(item.reviewType)}`, css: "review" })),
    ];

    return h("section", { className: `ug-shell ${className}`.trim(), "data-contract-version": projection.contractVersion },
      h("header", { className: "ug-header" }, h("div", null, h("p", { className: "ug-kicker" }, "UBO CONTROL · OWNERSHIP EXPLAINER"), h("h2", null, projection.subject.displayName), h("p", { className: "ug-subtitle" }, "Follow relationships downward toward the customer under review.")),
        detailLevel === DETAIL_LEVEL.EXPLAIN && h("div", { className: "ug-snapshot" }, h("span", null, `${projection.decision.checkpoint?.type || "Snapshot"} · ${projection.decision.evaluationTime || "Time unavailable"}`), h("strong", null, snapshot ? `#${snapshot}` : "Snapshot identity unavailable"), h("span", null, projection.decision.terminalOutcome || projection.decision.orchestrationState || "IN PROGRESS"))),
      h(Summary, { projection }),
      h("div", { className: "ug-workspace" },
        h("div", { className: "ug-canvas-card" },
          h("div", { className: "ug-toolbar", role: "toolbar", "aria-label": "Graph navigation controls" }, h("button", { type: "button", onClick: () => zoomBy(0.1), "aria-label": "Zoom in" }, "+"), h("button", { type: "button", onClick: () => zoomBy(-0.1), "aria-label": "Zoom out" }, "−"), h("button", { type: "button", onClick: reset, "aria-label": "Reset and fit graph to view" }, "Fit"), h("span", { "aria-live": "polite" }, `${Math.round(zoom * 100)}%`)),
          h("svg", { className: "ug-canvas", viewBox: `0 0 ${layout.width} ${layout.height}`, style: { height: `${height || Math.min(680, Math.max(400, layout.height))}px` }, role: "img", "aria-label": graphName, onWheel, onPointerDown, onPointerMove, onPointerUp: stopDrag, onPointerCancel: stopDrag },
            h("title", null, graphName), h("desc", null, `${projection.nodes.length} entities, ${projection.relationships.length} relationships, ${projection.qualifications.length} qualifying people, ${projection.unresolved.length} unresolved items.`),
            h("defs", null, h("marker", { id: markerId, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "strokeWidth" }, h("path", { d: "M 0 0 L 8 4 L 0 8 z", className: "ug-arrow-head" }))), h("g", { transform: `translate(${pan.x} ${pan.y}) scale(${zoom})` }, edges, nodes)),
          projection.relationships.length === 0 && h("div", { className: "ug-empty-overlay", role: "status" }, h("strong", null, "Ownership/control unresolved"), h("span", null, "No safe relationship is established yet; the customer subject remains visible.")),
          stateButtons.length > 0 && h("div", { className: "ug-state-strip", "aria-label": "Conflict and review states" }, stateButtons.map((item) => h("button", { type: "button", key: `${item.kind}:${item.id}`, className: item.css, onClick: () => select({ kind: item.kind, id: item.id }) }, item.label)))),
        h(DetailPanel, { selection, projection, detailLevel, onSelect: select, panelRef })),
      h("div", { className: "ug-sr-only" }, h("h3", null, "Text description of ownership and control graph"), h("p", null, `${projection.subject.displayName} is the customer subject. ${projection.qualifications.length} qualifying people are recorded. ${projection.unresolved.length} ownership or control items remain unresolved.`), h("ul", null, projection.relationships.map((relationship) => h("li", { key: relationship.relationshipId }, `${nodesById.get(relationship.sourceEntityId)?.displayName} — ${relationshipLabel(relationship.relationshipType)}, ${formatMeasurement(relationship.measurement, true)} — ${nodesById.get(relationship.targetEntityId)?.displayName}`)))));
  }

  return Object.freeze({ CONTRACT_VERSION, DETAIL_LEVEL, OwnershipGraph, assertProjection, basisLabel, computeLayout, formatMeasurement, parallelRelationshipOffset, pathExpression, relationshipLabel, roleLabel });
}));
