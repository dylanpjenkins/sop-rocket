import type { SOP, Step, InstructionNode, StepNode, TipNode } from "@shared/types";

function createStep(title: string, descriptionHtml: string, imageUrls: string[]): Step {
  return {
    id: crypto.randomUUID(),
    title,
    description: descriptionHtml ? htmlToTiptapJson(descriptionHtml) : undefined,
    imageUrl: imageUrls[0] || "",
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    annotations: { circles: [], arrows: [], ellipses: [] },
  };
}

function htmlToTiptapJson(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const content: any[] = [];

  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        content.push({
          type: "paragraph",
          content: [{ type: "text", text }],
        });
      }
    } else if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      if (tag === "p" || tag === "div") {
        const text = node.textContent?.trim();
        if (text) {
          content.push({
            type: "paragraph",
            content: parseInlineNodes(node),
          });
        }
      } else if (tag === "ul") {
        content.push({
          type: "bulletList",
          content: Array.from(node.querySelectorAll("li")).map((li) => ({
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: li.textContent?.trim() || "" }],
              },
            ],
          })),
        });
      } else if (tag === "ol") {
        content.push({
          type: "orderedList",
          content: Array.from(node.querySelectorAll("li")).map((li) => ({
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: li.textContent?.trim() || "" }],
              },
            ],
          })),
        });
      }
    }
  }

  return JSON.stringify({ type: "doc", content });
}

function parseInlineNodes(el: HTMLElement): any[] {
  const result: any[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text) result.push({ type: "text", text });
    } else if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      const text = node.textContent || "";
      const marks: any[] = [];
      if (tag === "strong" || tag === "b") marks.push({ type: "bold" });
      if (tag === "em" || tag === "i") marks.push({ type: "italic" });
      if (tag === "s" || tag === "del" || tag === "strike") marks.push({ type: "strike" });
      if (text) result.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
    }
  }
  return result.length > 0 ? result : [{ type: "text", text: el.textContent || "" }];
}

export function importHTML(html: string, fileName?: string): SOP {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const now = new Date().toISOString();

  // Extract title from <title> or <h1>
  let title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.querySelector("title")?.textContent?.trim() ||
    fileName?.replace(/\.html?$/i, "") ||
    "Imported SOP";

  const subtitleEl = doc.querySelector(".subtitle");
  const subtitle = subtitleEl?.textContent?.trim() || "";

  const steps: Step[] = [];
  const nodes: InstructionNode[] = [];

  // Look for .step divs (our export format)
  const stepDivs = doc.querySelectorAll(".step");
  if (stepDivs.length > 0) {
    for (const div of Array.from(stepDivs)) {
      const stepTitle =
        div.querySelector(".step-title")?.textContent?.trim() || "Untitled Step";
      const descEl = div.querySelector(".desc");
      const descHtml = descEl?.innerHTML || "";
      const images = Array.from(div.querySelectorAll("img"))
        .map((img) => img.getAttribute("src") || "")
        .filter(Boolean);
      const step = createStep(stepTitle, descHtml, images);
      steps.push(step);
      nodes.push({ type: "step", stepId: step.id } as StepNode);
    }
    // Look for .tip divs
    for (const div of Array.from(doc.querySelectorAll(".tip"))) {
      const text = div.querySelector("p")?.textContent?.trim() || div.textContent?.trim() || "";
      nodes.push({
        type: "tip",
        id: crypto.randomUUID(),
        variant: "neutral",
        text,
      } as TipNode);
    }
  } else {
    // Generic HTML: use h2 as step boundaries
    const body = doc.body;
    let currentTitle: string | null = null;
    let currentDescParts: string[] = [];
    let currentImages: string[] = [];

    function flush() {
      if (currentTitle !== null) {
        const step = createStep(currentTitle, currentDescParts.join(""), currentImages);
        steps.push(step);
        nodes.push({ type: "step", stepId: step.id } as StepNode);
      }
      currentTitle = null;
      currentDescParts = [];
      currentImages = [];
    }

    for (const node of Array.from(body.children)) {
      if (node instanceof HTMLElement) {
        const tag = node.tagName.toLowerCase();
        if (tag === "h1") {
          title = node.textContent?.trim() || title;
        } else if (tag === "h2") {
          flush();
          currentTitle = (node.textContent?.trim() || "").replace(/^Step\s+\d+:\s*/i, "");
        } else if (tag === "img") {
          currentImages.push((node as HTMLImageElement).src);
        } else if (currentTitle !== null) {
          currentDescParts.push(node.outerHTML);
        }
      }
    }
    flush();
  }

  return {
    id: crypto.randomUUID(),
    title,
    subtitle: subtitle || undefined,
    steps,
    nodes,
    createdAt: now,
    updatedAt: now,
  };
}
