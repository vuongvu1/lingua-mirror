export function stripIds<T extends Element>(el: T): T {
  if (el.hasAttribute("id")) {
    el.removeAttribute("id");
  }
  for (const node of el.querySelectorAll("[id]")) {
    node.removeAttribute("id");
  }
  return el;
}

export function makeInert<T extends Element>(el: T): T {
  for (const node of el.querySelectorAll("script, noscript")) {
    node.remove();
  }
  const stripHandlers = (node: Element): void => {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
  };
  stripHandlers(el);
  for (const node of el.querySelectorAll("*")) stripHandlers(node);
  for (const media of el.querySelectorAll("video[autoplay], audio[autoplay]")) {
    media.removeAttribute("autoplay");
  }
  return el;
}
