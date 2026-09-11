import { createElement, lazy, useState, type ComponentType } from 'react';

/** A warmed module renders synchronously instead of suspending on a resolved import. */
export function preloadableWorkspace<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let resolved: ComponentType<P> | undefined;
  let pending: Promise<{ default: ComponentType<P> }> | undefined;
  const preload = () => pending ??= load().then(module => {
    resolved = module.default;
    return module;
  }, error => { pending = undefined; throw error; });
  const Deferred = lazy(preload);
  function Workspace(props: P) {
    // Keep the mounted component identity stable if a cold import finishes later.
    const [Selected] = useState(() => resolved ?? Deferred);
    return createElement(Selected, props);
  }
  return { Component: Workspace, preload };
}
