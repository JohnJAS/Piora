import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";

const data = JSON.parse(document.getElementById("community-config").textContent);
const mount = document.getElementById("community-root");
const error = document.getElementById("community-error");
const { invoke } = window.pioraExtension;
let mounted = false;

function failed(cause) {
  const detail = String(cause instanceof Error ? cause.message : cause).slice(0, 500);
  error.textContent = detail;
  error.hidden = false;
  if (!mounted) void invoke("community.failed", detail).catch(() => {});
}

function installStorage(entries) {
  const saved = new Map(entries);
  const persist = () => {
    if (!data.probe) void invoke("community.storage.write", Array.from(saved)).catch(failed);
  };
  Object.defineProperty(window, "localStorage", { value: Object.freeze({
    getItem: key => saved.get(String(key)) ?? null,
    setItem: (key, value) => { saved.set(String(key), String(value)); persist(); },
    removeItem: key => { if (saved.delete(String(key))) persist(); },
    clear: () => { saved.clear(); persist(); },
  }) });
}

function requireClientModule(name) {
  if (name === "react") return React;
  if (name === "react-dom") return ReactDOM;
  throw new Error("Unsupported browser module: " + name);
}

function CommunityPanel({ views }) {
  React.useEffect(() => {
    if (!mount.firstElementChild) {
      failed("The community client rendered an empty panel");
      return;
    }
    mounted = true;
    void invoke("community.ready", data.version).catch(failed);
  }, []);
  return views.map(({ Component, props, id }) => <Component key={id} {...props} />);
}

async function start() {
  installStorage(await invoke("community.storage.read"));
  let plugin;
  Object.defineProperty(window, "__ModuleLoader__", { value: Object.freeze({
    load(definition) {
      if (plugin || definition.id !== data.package || typeof definition.factory !== "function") {
        throw new Error("Unexpected DSH client module");
      }
      plugin = definition.factory(requireClientModule);
    },
  }) });
  const script = document.createElement("script");
  script.textContent = new TextDecoder().decode(Uint8Array.from(atob(data.source), character => character.charCodeAt(0)));
  document.head.append(script);
  script.remove();
  if (typeof plugin?.apply !== "function") throw new Error("Missing DSH client entry");

  const dictionaries = new Map();
  mount.dataset.package = data.package;
  const bind = namespace => (key, params = {}) => {
    const dictionary = dictionaries.get(namespace);
    const value = dictionary?.[data.locale]?.[key] ?? dictionary?.en?.[key] ?? key;
    return typeof value === "string" ? value.replace(/\{([\w]+)\}/g, (match, parameter) => params[parameter] ?? match) : value;
  };
  const views = [];
  await plugin.apply({
    effect: setup => setup(),
    locale: { bind, register: (namespace, dictionary) => { dictionaries.set(namespace, dictionary); } },
    slots: {
      inject(slot, setup) {
        if (!data.slots.includes(slot)) throw new Error("Unsupported DSH client slot: " + slot);
        setup();
      },
      register(options, Component) {
        if (!data.slots.includes(options.name) || typeof Component !== "function") throw new Error("Invalid DSH client view");
        const { hooks, ...actions } = options.inject?.() ?? {};
        const props = { t: bind(options.locale), ...actions };
        if (data.package === "dsh-pomodoro-box" && hooks?.pomodoro) {
          const { subscribe, getSnapshot } = hooks.pomodoro;
          props.usePomodoro = function usePomodoro(select) {
            return select(React.useSyncExternalStore(subscribe, getSnapshot));
          };
        }
        views.push({ Component, id: options.id, slot: options.name, props });
      },
    },
  });
  if (!data.slots.every(slot => views.some(view => view.slot === slot))) throw new Error("Missing DSH client view");
  createRoot(mount, { onUncaughtError: failed }).render(<CommunityPanel views={views} />);
}

window.addEventListener("error", event => failed(event.error ?? event.message));
void start().catch(failed);
