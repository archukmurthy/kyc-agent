(function startDemo(React, ReactDOM, UboControlUI) {
  "use strict";
  const h = React.createElement;
  const { OwnershipGraph, UboJourney, DETAIL_LEVEL } = UboControlUI;

  function queryValue(name, fallback) {
    return new URLSearchParams(window.location.search).get(name) || fallback;
  }

  function FixtureNav({ fixtures, fixture, onChoose, title }) {
    return h("nav", { className: "demo-scenarios", "aria-label": `${title} scenarios` },
      h("div", { className: "demo-nav-heading" }, h("span", null, title), h("b", null, String(fixtures.length))),
      fixtures.map((item) => h("button", {
        type: "button", key: item.id, className: item.id === fixture.id ? "active" : "", onClick: () => onChoose(item.id), "aria-current": item.id === fixture.id ? "page" : undefined,
      }, h("span", null, item.id), h("strong", null, item.label))));
  }

  function Demo({ graphSet, journeySet }) {
    const initialMode = queryValue("mode", "journey") === "graph" ? "graph" : "journey";
    const [mode, setMode] = React.useState(initialMode);
    const activeSet = mode === "graph" ? graphSet : journeySet;
    const defaultFixture = mode === "graph" ? "UI02" : "CUI03";
    const requestedFixture = queryValue("fixture", defaultFixture);
    const initialFixture = activeSet.fixtures.find((item) => item.id === requestedFixture) || activeSet.fixtures[0];
    const [fixtureId, setFixtureId] = React.useState(initialFixture.id);
    const [stateId, setStateId] = React.useState(queryValue("state", initialFixture.states[0].id));
    const [detailLevel, setDetailLevel] = React.useState(queryValue("detail", "CUSTOMER") === "EXPLAIN" ? DETAIL_LEVEL.EXPLAIN : DETAIL_LEVEL.CUSTOMER);
    const [lastAction, setLastAction] = React.useState(null);
    const fixture = activeSet.fixtures.find((item) => item.id === fixtureId) || activeSet.fixtures[0];
    const state = fixture.states.find((item) => item.id === stateId) || fixture.states[0];

    React.useEffect(() => {
      const params = new URLSearchParams({ mode, fixture: fixture.id, state: state.id, detail: detailLevel });
      window.history.replaceState(null, "", `?${params.toString()}`);
      document.title = `${fixture.id} · ${fixture.label} · UBO Control`;
    }, [mode, fixture.id, state.id, detailLevel]);

    const chooseFixture = (id) => {
      const next = activeSet.fixtures.find((item) => item.id === id);
      setFixtureId(id);
      setStateId(next.states[0].id);
      setLastAction(null);
    };
    const chooseMode = (nextMode) => {
      const nextSet = nextMode === "graph" ? graphSet : journeySet;
      setMode(nextMode);
      setFixtureId(nextSet.fixtures[0].id);
      setStateId(nextSet.fixtures[0].states[0].id);
      setLastAction(null);
    };
    const onAction = (event) => {
      setLastAction(event);
      if (fixture.id === "CUI17" && state.id === "before" && event.eventType === "CUSTOMER_ACTION_SUBMITTED") setStateId("after");
    };

    return h("div", { className: "demo-page" },
      h("header", { className: "demo-masthead" },
        h("div", null, h("p", { className: "demo-kicker" }, "STANDALONE PRODUCT MODULE · G5.3A"), h("h1", null, mode === "graph" ? "Ownership, explained." : "Ask only what remains."), h("p", null, mode === "graph" ? "A provider-neutral visual layer over verified UBO Control projections." : "An adaptive customer surface driven entirely by public journey and resolution contracts.")),
        h("div", { className: "demo-contract" }, h("span", null, "Renderer input"), h("strong", null, mode === "graph" ? "ubo-ownership-graph-projection-v1" : "ubo-journey-projection-v1 + ubo-resolution-plan-v1"), h("small", null, activeSet.generatedBy))),
      h("div", { className: "demo-mode-tabs", role: "tablist", "aria-label": "Demo product area" },
        h("button", { type: "button", role: "tab", "aria-selected": mode === "journey", className: mode === "journey" ? "active" : "", onClick: () => chooseMode("journey") }, "Customer journeys"),
        h("button", { type: "button", role: "tab", "aria-selected": mode === "graph", className: mode === "graph" ? "active" : "", onClick: () => chooseMode("graph") }, "Graph renderer")),
      h("main", { className: "demo-layout" },
        h(FixtureNav, { fixtures: activeSet.fixtures, fixture, onChoose: chooseFixture, title: mode === "graph" ? "Graph fixtures" : "Journey fixtures" }),
        h("section", { className: "demo-stage", "aria-labelledby": "fixture-title" },
          h("div", { className: "demo-fixture-header" }, h("div", null, h("p", null, fixture.id), h("h2", { id: "fixture-title" }, fixture.label), h("span", null, fixture.description)), fixture.states.length > 1 && h("div", { className: "demo-state-switch", role: "group", "aria-label": "Fixture state" }, fixture.states.map((item) => h("button", { type: "button", key: item.id, className: item.id === state.id ? "active" : "", onClick: () => setStateId(item.id) }, item.label)))),
          mode === "graph"
            ? h(React.Fragment, null, h("div", { className: "demo-detail-toggle inline" }, h("span", null, "Detail level"), h("div", null, h("button", { type: "button", className: detailLevel === DETAIL_LEVEL.CUSTOMER ? "active" : "", onClick: () => setDetailLevel(DETAIL_LEVEL.CUSTOMER) }, "Customer"), h("button", { type: "button", className: detailLevel === DETAIL_LEVEL.EXPLAIN ? "active" : "", onClick: () => setDetailLevel(DETAIL_LEVEL.EXPLAIN) }, "Explain"))), h(OwnershipGraph, { projection: state.projection, detailLevel, key: `${fixture.id}:${state.id}`, height: 560 }))
            : h(React.Fragment, null, h(UboJourney, { journey: state.journey, plan: state.plan, graph: state.graph, onAction, key: `${fixture.id}:${state.id}` }), lastAction && h("details", { className: "demo-event" }, h("summary", null, "Last host-neutral customer action event"), h("pre", null, JSON.stringify(lastAction, null, 2)))))),
      h("footer", { className: "demo-footer" }, "Deterministic public-contract fixtures only · No live Discovery · No upload · No Evidence Platform · No onboarding state"));
  }

  Promise.all([fetch("/fixtures.json"), fetch("/journey-fixtures.json")]).then(async ([graphResponse, journeyResponse]) => {
    if (!graphResponse.ok || !journeyResponse.ok) throw new Error("Fixture load failed");
    return [await graphResponse.json(), await journeyResponse.json()];
  }).then(([graphSet, journeySet]) => {
    ReactDOM.createRoot(document.getElementById("root")).render(h(Demo, { graphSet, journeySet }));
  }).catch((error) => {
    document.getElementById("root").textContent = `Unable to load renderer demo: ${error.message}`;
  });
}(window.React, window.ReactDOM, window.UboControlUI));
