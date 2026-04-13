import type { SOP, Step, InstructionNode, StepNode, TipNode } from "@shared/types";

function createStep(title: string, descriptionLines: string[]): Step {
  const desc = descriptionLines.join("\n").trim();
  return {
    id: crypto.randomUUID(),
    title,
    description: desc ? textToTiptapJson(desc) : undefined,
    imageUrl: "",
    annotations: { circles: [], arrows: [], ellipses: [] },
  };
}

function textToTiptapJson(text: string): string {
  const lines = text.split("\n");
  const content: any[] = [];
  for (const line of lines) {
    if (line.startsWith("- ") || line.startsWith("* ")) {
      // Collect consecutive bullet items
      content.push({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: line.replace(/^[-*]\s+/, "") }],
              },
            ],
          },
        ],
      });
    } else if (/^\d+\.\s/.test(line)) {
      content.push({
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: line.replace(/^\d+\.\s+/, "") }],
              },
            ],
          },
        ],
      });
    } else if (line.trim()) {
      content.push({
        type: "paragraph",
        content: parseInlineMarks(line),
      });
    }
  }
  return JSON.stringify({ type: "doc", content });
}

function parseInlineMarks(text: string): any[] {
  // Simple inline parse: bold (**), italic (*), strikethrough (~~)
  const result: any[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|([^*~]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      result.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
    } else if (match[3]) {
      result.push({ type: "text", text: match[3], marks: [{ type: "italic" }] });
    } else if (match[4]) {
      result.push({ type: "text", text: match[4], marks: [{ type: "strike" }] });
    } else if (match[5]) {
      result.push({ type: "text", text: match[5] });
    }
  }
  return result.length > 0 ? result : [{ type: "text", text }];
}

export function importMarkdown(text: string, fileName?: string): SOP {
  const lines = text.split("\n");
  const now = new Date().toISOString();

  let title = fileName?.replace(/\.md$/i, "") || "Imported SOP";
  let subtitle = "";
  const steps: Step[] = [];
  const nodes: InstructionNode[] = [];

  let currentStepTitle: string | null = null;
  let currentDescLines: string[] = [];

  function flushStep() {
    if (currentStepTitle !== null) {
      const step = createStep(currentStepTitle, currentDescLines);
      steps.push(step);
      nodes.push({ type: "step", stepId: step.id } as StepNode);
    }
    currentStepTitle = null;
    currentDescLines = [];
  }

  for (const line of lines) {
    // H1 → title
    if (/^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    // Italic subtitle (e.g., *subtitle text*)
    if (/^\*([^*]+)\*$/.test(line) && steps.length === 0 && currentStepTitle === null) {
      subtitle = line.replace(/^\*|\*$/g, "").trim();
      continue;
    }
    // H2 → step
    if (/^##\s+/.test(line)) {
      flushStep();
      currentStepTitle = line
        .replace(/^##\s+/, "")
        .replace(/^Step\s+\d+:\s*/i, "")
        .trim();
      continue;
    }
    // Blockquote tip
    if (/^>\s+/.test(line)) {
      flushStep();
      const tipText = line.replace(/^>\s+/, "").replace(/^[⚠️✅ℹ️]+\s*\*\*Tip:\*\*\s*/, "").trim();
      const variant = line.includes("⚠️") ? "warning" : line.includes("✅") ? "success" : "neutral";
      nodes.push({
        type: "tip",
        id: crypto.randomUUID(),
        variant,
        text: tipText,
      } as TipNode);
      continue;
    }
    // Content lines
    if (currentStepTitle !== null) {
      currentDescLines.push(line);
    }
  }
  flushStep();

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
