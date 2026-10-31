export function registerPwa(onChange) {
  const state = { state: "unsupported", waiting: false, error: null };
  const publish = () => onChange({ ...state });
  if (!("serviceWorker" in navigator) || !globalThis.isSecureContext) { publish(); return; }
  state.state = "registering"; publish();
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url), { updateViaCache: "none" }).then(registration => {
    const update = () => {
      state.state = registration.active ? "active" : "installing";
      state.waiting = Boolean(registration.waiting);
      publish();
    };
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker.addEventListener("statechange", () => {
        if (worker.state === "redundant") { state.state = "error"; state.error = "Shell installation failed"; publish(); }
        else update();
      });
      update();
    });
    update();
  }).catch(cause => { state.state = "error"; state.error = cause.message; publish(); });
}
