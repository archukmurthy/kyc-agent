"use strict";

const React = require("react");
const ReactDOM = require("react-dom/client");
const { act: legacyAct } = require("react-dom/test-utils");
const { JSDOM } = require("jsdom");
const fixtures = require("../fixtures/projections.json");
const { OwnershipGraph } = require("../OwnershipGraph");
const act = React.act || legacyAct;

function projection(fixtureId, stateId = "current") {
  const fixture = fixtures.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);
  return (fixture.states.find((item) => item.id === stateId) || fixture.states[0]).projection;
}

function renderGraph(value, props = {}) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://renderer.test/" });
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
  act(() => root.render(React.createElement(OwnershipGraph, { projection: value, ...props })));
  return {
    dom,
    container,
    root,
    click(element) { act(() => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))); },
    key(element, key) { act(() => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }))); },
    resize(width, height) {
      const viewport = container.querySelector(".ug-canvas-scroll");
      Object.defineProperty(viewport, "clientWidth", { configurable: true, value: width });
      Object.defineProperty(viewport, "clientHeight", { configurable: true, value: height });
      act(() => dom.window.dispatchEvent(new dom.window.Event("resize")));
    },
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

module.exports = { fixtures, projection, renderGraph };
