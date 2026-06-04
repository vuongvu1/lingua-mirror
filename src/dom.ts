export function stripIds<T extends Element>(el: T): T {
  if (el.hasAttribute("id")) {
    el.removeAttribute("id");
  }
  for (const node of el.querySelectorAll("[id]")) {
    node.removeAttribute("id");
  }
  return el;
}
