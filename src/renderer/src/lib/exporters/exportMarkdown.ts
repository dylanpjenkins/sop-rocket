import type { SOP } from "@shared/types";
import { getInstructionNodes, computeStepLabels } from "@shared/types";

function tiptapJsonToMarkdown(json: string): string {
  try {
    const doc = JSON.parse(json);
    if (!doc?.content) return "";
    return doc.content
      .map((node: any) => blockToMd(node))
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function blockToMd(node: any): string {
  if (node.type === "paragraph") {
    return inlineToMd(node.content) + "\n";
  }
  if (node.type === "bulletList") {
    return (
      (node.content ?? [])
        .map((li: any) => `- ${inlineToMd(li.content?.[0]?.content)}`)
        .join("\n") + "\n"
    );
  }
  if (node.type === "orderedList") {
    return (
      (node.content ?? [])
        .map(
          (li: any, i: number) =>
            `${i + 1}. ${inlineToMd(li.content?.[0]?.content)}`,
        )
        .join("\n") + "\n"
    );
  }
  return "";
}

function inlineToMd(content: any[] | undefined): string {
  if (!content) return "";
  return content
    .map((n: any) => {
      let text = n.text ?? "";
      const marks = n.marks ?? [];
      for (const mark of marks) {
        if (mark.type === "bold") text = `**${text}**`;
        if (mark.type === "italic") text = `*${text}*`;
        if (mark.type === "strike") text = `~~${text}~~`;
        if (mark.type === "link") text = `[${text}](${mark.attrs?.href ?? ""})`;
      }
      return text;
    })
    .join("");
}

export function exportMarkdown(sop: SOP): string {
  const lines: string[] = [];
  lines.push(`# ${sop.title}`);
  if (sop.subtitle) lines.push(`\n*${sop.subtitle}*`);
  lines.push("");

  const nodes = getInstructionNodes(sop);
  const stepLabels = computeStepLabels(nodes);
  for (const node of nodes) {
    if (node.type === "step") {
      const label = stepLabels.get(node.id) ?? "";
      lines.push(`## Step ${label}: ${node.title || "(untitled)"}`);
      if (node.description) {
        const md = tiptapJsonToMarkdown(node.description);
        if (md.trim()) lines.push(md);
      }
      const images = node.imageRows?.flat() ?? node.imageUrls ?? (node.imageUrl ? [node.imageUrl] : []);
      for (const img of images) {
        if (img) lines.push(`![Step ${label}](${img})`);
      }
      lines.push("");
    } else if (node.type === "tip") {
      const prefix =
        node.variant === "warning"
          ? "⚠️"
          : node.variant === "success"
            ? "✅"
            : "ℹ️";
      lines.push(`> ${prefix} **Tip:** ${node.text}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
