// @vitest-environment happy-dom
/**
 * Regressietests voor de fileDropzone click-handler in app.js.
 *
 * De handler zit in module-level side-effect code in app.js (geen exports),
 * dus we testen de logica in isolatie met dezelfde DOM-structuur en dezelfde
 * handler-implementatie.
 *
 * Kern-invariant: de <label> omhult de <input type="file">. Zonder
 * e.preventDefault() opent de browser de file dialog tweemaal — eenmaal via
 * de native label→input forwarding en eenmaal via fileInput.click() in de
 * handler. De fix is precies één e.preventDefault() die de native forwarding
 * onderdrukt.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — bouwen dezelfde DOM-structuur als in public/index.html
// ---------------------------------------------------------------------------
function buildDropzoneDom() {
  const label = document.createElement("label");
  label.id = "file-dropzone";

  const input = document.createElement("input");
  input.type = "file";
  input.id = "file-input";
  input.hidden = true;

  label.appendChild(input);
  document.body.appendChild(label);
  return { label, input };
}

// Dezelfde handler-implementatie als in app.js (na de fix).
// Bij een refactor van app.js moet deze mee-updaten.
function attachHandler(
  fileDropzone: HTMLElement,
  fileInput: HTMLInputElement,
) {
  fileDropzone.addEventListener("click", (e) => {
    e.preventDefault();
    if (
      (e.target as Element).closest(
        "#btn-invoer, #btn-conversation, #btn-manual, #btn-cancel-drop, .input-hub__drop-busy, .test-recordings, button, a",
      )
    ) {
      return;
    }
    if (fileDropzone.classList.contains("is-processing")) return;
    fileInput.click();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
// Dispatch een klik op een element zonder native label→input forwarding te activeren.
// label.click() in happy-dom triggert ook de native forwarding; dispatchEvent met
// een gewone MouseEvent alleen de event listeners.
function fireClick(el: HTMLElement): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe("fileDropzone click-handler", () => {
  let label: HTMLLabelElement;
  let input: HTMLInputElement;
  let inputClickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    ({ label, input } = buildDropzoneDom() as {
      label: HTMLLabelElement;
      input: HTMLInputElement;
    });
    // Spy op de .click() methode: intercepteert de programmatische aanroep
    // zonder zelf opnieuw een click-event te dispatchen (voorkomt infinite loop).
    inputClickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
    attachHandler(label, input);
  });

  it("roept preventDefault aan zodat de native label→input forwarding onderdrukt wordt", () => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    label.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalledOnce();
  });

  it("roept fileInput.click() precies één keer aan bij een gewone klik", () => {
    fireClick(label);
    expect(inputClickSpy).toHaveBeenCalledTimes(1);
  });

  it("opent de dialog NIET als een knop in de dropzone geklikt wordt", () => {
    const btn = document.createElement("button");
    label.appendChild(btn);
    fireClick(btn);
    expect(inputClickSpy).not.toHaveBeenCalled();
  });

  it("opent de dialog NIET als een <a> in de dropzone geklikt wordt", () => {
    const anchor = document.createElement("a");
    label.appendChild(anchor);
    fireClick(anchor);
    expect(inputClickSpy).not.toHaveBeenCalled();
  });

  it("opent de dialog NIET als is-processing actief is", () => {
    label.classList.add("is-processing");
    fireClick(label);
    expect(inputClickSpy).not.toHaveBeenCalled();
  });

  it("opent de dialog WEL nadat is-processing verwijderd is", () => {
    label.classList.add("is-processing");
    label.classList.remove("is-processing");
    fireClick(label);
    expect(inputClickSpy).toHaveBeenCalledTimes(1);
  });

  it("opent de dialog NIET als geklikt wordt op .input-hub__drop-busy", () => {
    const busy = document.createElement("div");
    busy.className = "input-hub__drop-busy";
    label.appendChild(busy);
    fireClick(busy);
    expect(inputClickSpy).not.toHaveBeenCalled();
  });
});
