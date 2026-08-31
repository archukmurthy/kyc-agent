(function startDemo(React, ReactDOM, UboControlUI) {
  "use strict";
  const h = React.createElement;
  const { OwnershipGraph, DETAIL_LEVEL } = UboControlUI;

  function queryValue(name, fallback) {
    return new URLSearchParams(window.location.search).get(name) || fallback;
  }

  function Demo({ fixtureSet }) {
    const initialFixture = fixtureSet.fixtures.find((item) => item.id === queryValue("fixture", "UI02")) || fixtureSet.fixtures[0];
    const [fixtureId, setFixtureId] = React.useState(initialFixture.id);
    const [stateId, setStateId] = React.useState(queryValue("state", initialFixture.states[0].id));
    const [detailLevel, setDetailLevel] = React.useState(queryValue("detail", "EXPLAIN") === "CUSTOMER" ? DETAIL_LEVEL.CUSTOMER : DETAIL_LEVEL.EXPLAIN);
    const fixture = fixtureSet.fixtures.find((item) => item.id === fixtureId) || fixtureSet.fixtures[0];
    const state = fixture.states.find((item) => item.id === stateId) || fixture.states[0];

    React.useEffect(() => {
      const params = new URLSearchParams({ fixture: fixture.id, state: state.id, detail: detailLevel });
      window.history.replaceState(null, "", `?${params.toString()}`);
      document.title = `${fixture.id} · ${fixture.label} · UBO Control`;
    }, [fixture.id, state.id, detailLevel]);

    const chooseFixture = (id) => {
      const next = fixtureSet.fixtures.find((item) => item.id === id);
      setFixtureId(id);
      setStateId(next.states[0].id);
    };

    return h("div", { className: "demo-page" },
      h("header", { className: "demo-masthead" },
        h("div", null,
          h("p", { className: "demo-kicker" }, "STANDALONE PRODUCT MODULE · G5.1B"),
          h("h1", null, "Ownership, explained."),
          h("p", null, "A provider-neutral visual layer over verified UBO Control projections.")),
        h("div", { className: "demo-contract" },
          h("span", null, "Renderer input"),
          h("strong", null, "ubo-ownership-graph-projection-v1"),
          h("small", null, fixtureSet.generatedBy))),
      h("main", { className: "demo-layout" },
        h("nav", { className: "demo-scenarios", "aria-label": "Renderer scenarios" },
          h("div", { className: "demo-nav-heading" }, h("span", null, "Visual fixtures"), h("b", null, "12")),
          fixtureSet.fixtures.map((item) => h("button", {
            type: "button", key: item.id, className: item.id === fixture.id ? "active" : "", onClick: () => chooseFixture(item.id), "aria-current": item.id === fixture.id ? "page" : undefined,
          }, h("span", null, item.id), h("strong", null, item.label))),
          h("div", { className: "demo-detail-toggle" },
            h("span", null, "Detail level"),
            h("div", null,
              h("button", { type: "button", className: detailLevel === DETAIL_LEVEL.CUSTOMER ? "active" : "", onClick: () => setDetailLevel(DETAIL_LEVEL.CUSTOMER) }, "Customer"),
              h("button", { type: "button", className: detailLevel === DETAIL_LEVEL.EXPLAIN ? "active" : "", onClick: () => setDetailLevel(DETAIL_LEVEL.EXPLAIN) }, "Explain")))),
        h("section", { className: "demo-stage", "aria-labelledby": "fixture-title" },
          h("div", { className: "demo-fixture-header" },
            h("div", null, h("p", null, fixture.id), h("h2", { id: "fixture-title" }, fixture.label), h("span", null, fixture.description)),
            fixture.states.length > 1 && h("div", { className: "demo-state-switch", role: "group", "aria-label": "Evidence state" }, fixture.states.map((item) => h("button", { type: "button", key: item.id, className: item.id === state.id ? "active" : "", onClick: () => setStateId(item.id) }, item.label)))),
          h(OwnershipGraph, { projection: state.projection, detailLevel, key: `${fixture.id}:${state.id}`, height: 560 }))),
      h("footer", { className: "demo-footer" }, "Deterministic fixtures only · No live Discovery · No Evidence Platform · No onboarding state"));
  }

  fetch("/fixtures.json").then((response) => {
    if (!response.ok) throw new Error("Fixture load failed");
    return response.json();
  }).then((fixtureSet) => {
    ReactDOM.createRoot(document.getElementById("root")).render(h(Demo, { fixtureSet }));
  }).catch((error) => {
    document.getElementById("root").textContent = `Unable to load renderer demo: ${error.message}`;
  });
}(window.React, window.ReactDOM, window.UboControlUI));
