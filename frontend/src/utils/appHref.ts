/**
 * Link target for an app route in a plain `<a href>` (used for middle-click / "open in new tab"; normal clicks go
 * through the router). Adds the build's base path, e.g. "/isker" when the interface is published on GitHub Pages.
 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

export function appHref(path: string): string {
  return path.startsWith("/") ? BASE_PATH + path : path;
}
