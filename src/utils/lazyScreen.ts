import { createElement, lazy, type ComponentProps, type ComponentType } from 'react'

/** Every screen loader registered so far, so they can all be fetched ahead of time. */
const loaders: Array<() => Promise<unknown>> = []

/**
 * React.lazy for a screen: the screen becomes its own download, fetched the first time it is
 * opened (the nearest Suspense shows a loading state meanwhile). Once the code has arrived, by
 * either route or preloadScreens(), the screen renders straight away with no loading state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same constraint React.lazy uses
export function lazyScreen<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let loaded: T | undefined
  const fetchScreen = () =>
    load().then((module) => {
      loaded = module.default
      return module
    })
  loaders.push(fetchScreen)
  const Lazy = lazy(fetchScreen)
  // The lazy version only ever renders while waiting: it suspends until `loaded` is set, so it is
  // never shown and swapped for the loaded one afterwards.
  return function Screen(props: ComponentProps<T>) {
    return createElement((loaded ?? Lazy) as ComponentType<ComponentProps<T>>, props)
  }
}

/**
 * Fetches every registered screen. Tests call it (src/test-setup.ts) so a screen is ready when the
 * test renders it, instead of being compiled on demand while the test waits.
 */
export function preloadScreens() {
  return Promise.all(loaders.map((load) => load()))
}
