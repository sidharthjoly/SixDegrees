// The parts of the Workers runtime this Worker uses, declared here rather than pulling in
// @cloudflare/workers-types for one class.

interface Element {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): Element;
  setInnerContent(content: string, options?: { html?: boolean }): Element;
}

interface ElementHandlers {
  element?(element: Element): void | Promise<void>;
}

declare class HTMLRewriter {
  on(selector: string, handlers: ElementHandlers): HTMLRewriter;
  transform(response: Response): Response;
}
