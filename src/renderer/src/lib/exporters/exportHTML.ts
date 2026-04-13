import type { SOP } from "@shared/types";
import { getInstructionNodes, computeStepLabels } from "@shared/types";
import { generateHTML } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

const extensions = [
  StarterKit.configure({
    heading: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
  }),
  Link.configure({ openOnClick: false }),
];

function renderDescription(description?: string): string {
  if (!description) return "";
  try {
    const json = JSON.parse(description);
    const html = generateHTML(json, extensions);
    return html && html !== "<p></p>" ? `<div class="desc">${html}</div>` : "";
  } catch {
    return "";
  }
}

function getStepImages(step: any): string[] {
  if (step.imageRows?.length) return step.imageRows.flat();
  if (step.imageUrls?.length) return step.imageUrls;
  return step.imageUrl ? [step.imageUrl] : [];
}

export function exportHTMLDocument(sop: SOP): string {
  const nodes = getInstructionNodes(sop);
  const stepLabels = computeStepLabels(nodes);

  const stepsHtml = nodes
    .map((node) => {
      if (node.type === "step") {
        const stepNum = stepLabels.get(node.id) ?? "";
        const images = getStepImages(node);
        const imagesHtml = images
          .map(
            (url: string) =>
              `<img src="${url}" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb;margin:8px 0" />`,
          )
          .join("\n");
        const desc = renderDescription(node.description);
        return `<div class="step">
  <div class="step-header"><span class="step-num">${stepNum}</span> <span class="step-title">${node.title || ""}</span></div>
  ${desc}
  ${imagesHtml}
</div>`;
      }
      if (node.type === "tip") {
        const colors: Record<string, string> = {
          neutral: "#dbeafe",
          success: "#d1fae5",
          warning: "#fee2e2",
        };
        return `<div class="tip" style="background:${colors[node.variant] || colors.neutral};border-radius:8px;padding:12px 16px;margin:12px 0">
  <p>${node.text || ""}</p>
</div>`;
      }
      return "";
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${sop.title}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a1a}
h1{font-size:24px;margin-bottom:4px}
.subtitle{color:#6b7280;margin-bottom:24px}
.step{border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin:16px 0}
.step-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.step-num{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#f3f4f6;font-weight:600;font-size:14px;border:1px solid #e5e7eb}
.step-title{font-weight:600;font-size:16px}
.desc{font-size:14px;margin:8px 0}
.desc ul{list-style:disc;padding-left:20px}
.desc ol{list-style:decimal;padding-left:20px}
.tip p{margin:0;font-size:14px}
</style>
</head>
<body>
<h1>${sop.title}</h1>
${sop.subtitle ? `<p class="subtitle">${sop.subtitle}</p>` : ""}
${stepsHtml}
</body>
</html>`;
}
