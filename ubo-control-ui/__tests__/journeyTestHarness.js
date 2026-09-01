"use strict";

const React = require("react");
const ReactDOM = require("react-dom/client");
const { act: legacyAct } = require("react-dom/test-utils");
const { JSDOM } = require("jsdom");
const fixtures = require("../fixtures/journeys.json");
const { UboJourney } = require("../UboJourney");
const act = React.act || legacyAct;

function journeyState(fixtureId, stateId = "current") {
  const fixture = fixtures.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) throw new Error(`Unknown journey fixture ${fixtureId}`);
  return fixture.states.find((item) => item.id === stateId) || fixture.states[0];
}

function renderJourney(state, props = {}) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://journey.test/" });
  const names = ["window", "document", "navigator", "HTMLElement", "SVGElement", "Element", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]));
  const install = (name, value) => Object.defineProperty(global, name, { value, configurable: true, writable: true });
  install("window", dom.window);
  install("document", dom.window.document);
  install("navigator", dom.window.navigator);
  install("HTMLElement", dom.window.HTMLElement);
  install("SVGElement", dom.window.SVGElement);
  install("Element", dom.window.Element);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root");
  const root = ReactDOM.createRoot(container);
  const render = (next) => act(() => root.render(React.createElement(UboJourney, { journey: next.journey, plan: next.plan, graph: next.graph, ...props })));
  render(state);
  return {
    dom,
    container,
    root,
    render,
    click(element) { act(() => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))); },
    input(element, value) { act(() => { const prototype = element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); },
    cleanup() {
      act(() => root.unmount());
      dom.window.close();
      names.forEach((name) => {
        const descriptor = previous.get(name);
        if (descriptor) Object.defineProperty(global, name, descriptor);
        else delete global[name];
      });
    },
  };
}

module.exports = { fixtures, journeyState, renderJourney };
