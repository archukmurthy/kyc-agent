"use strict";

const React = require("react");
const ReactDOM = require("react-dom/client");
const { act: legacyAct } = require("react-dom/test-utils");
const { JSDOM } = require("jsdom");
const { UboApplicantJourneyV2 } = require("../UboApplicantJourneyV2");

const act = React.act || legacyAct;

function renderApplicant(journey, props = {}) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://applicant.test/" });
  const names = ["window", "document", "navigator", "HTMLElement", "Element", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]));
  const install = (name, value) => Object.defineProperty(global, name, { value, configurable: true, writable: true });
  install("window", dom.window);
  install("document", dom.window.document);
  install("navigator", dom.window.navigator);
  install("HTMLElement", dom.window.HTMLElement);
  install("Element", dom.window.Element);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root");
  const root = ReactDOM.createRoot(container);
  const baseProps = {
    actorContext: { actorReference: { referenceId: "test-applicant" }, actorCapacity: "AUTHORISED_APPLICANT" },
    onSubmitAction: () => {},
    content: { templates: {}, entityLabels: {} },
    ...props,
  };
  const render = (nextJourney, nextProps = {}) => act(() => root.render(React.createElement(
    UboApplicantJourneyV2,
    { journey: nextJourney, ...baseProps, ...nextProps },
  )));
  render(journey);
  return {
    dom,
    container,
    render,
    click(element) { act(() => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))); },
    async submit(form) {
      await act(async () => {
        form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
    },
    async submit(form) {
      await act(async () => {
        form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
    },
    input(element, value) {
      act(() => {
        const prototype = element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype
          : element.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype
            : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
        element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      });
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

module.exports = { renderApplicant };
