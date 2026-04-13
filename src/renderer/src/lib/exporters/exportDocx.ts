import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  ImageRun,
  Packer,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  ShadingType,
  WidthType,
  VerticalAlign,
  type ISectionOptions,
  type IBorderOptions,
} from "docx";
import type { SOP } from "@shared/types";
import { getInstructionNodes, computeStepLabels } from "@shared/types";

function getStepImages(step: any): string[] {
  if (step.imageRows?.length) return step.imageRows.flat();
  if (step.imageUrls?.length) return step.imageUrls;
  return step.imageUrl ? [step.imageUrl] : [];
}

function dataUrlToBuffer(dataUrl: string): { buffer: ArrayBuffer; mime: string } {
  const [header, base64] = dataUrl.split(",");
  const mime = header?.match(/:(.*?);/)?.[1] || "image/png";
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { buffer: bytes.buffer, mime };
}

/** Load a data-URL image and return its natural dimensions. */
function getImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 500, height: 300 });
    img.src = dataUrl;
  });
}

function tiptapJsonToParagraphs(json: string): Paragraph[] {
  try {
    const doc = JSON.parse(json);
    if (!doc?.content) return [];
    return doc.content
      .map((node: any) => {
        if (node.type === "paragraph") {
          const runs = (node.content ?? []).map((n: any) => {
            const marks = n.marks ?? [];
            return new TextRun({
              text: n.text ?? "",
              bold: marks.some((m: any) => m.type === "bold"),
              italics: marks.some((m: any) => m.type === "italic"),
              strike: marks.some((m: any) => m.type === "strike"),
              size: 21,
            });
          });
          return new Paragraph({ children: runs });
        }
        if (node.type === "bulletList" || node.type === "orderedList") {
          return (node.content ?? []).map(
            (li: any, i: number) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${node.type === "orderedList" ? `${i + 1}. ` : "• "}${
                      li.content?.[0]?.content?.map((n: any) => n.text ?? "").join("") ?? ""
                    }`,
                    size: 21,
                  }),
                ],
                indent: { left: 360 },
              }),
          );
        }
        return null;
      })
      .flat()
      .filter(Boolean) as Paragraph[];
  } catch {
    return [];
  }
}

const NONE_BORDER: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const LIGHT_BORDER: IBorderOptions = { style: BorderStyle.SINGLE, size: 1, color: "D4D4D4" };
const MAX_IMG_WIDTH = 480;

export async function exportDocx(sop: SOP): Promise<ArrayBuffer> {
  const nodes = getInstructionNodes(sop);
  const children: ISectionOptions["children"] = [];

  // Title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: sop.title, bold: true, size: 40, font: "Calibri" })],
      spacing: { after: 80 },
    }),
  );

  // Subtitle
  if (sop.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: sop.subtitle, size: 24, color: "666666", font: "Calibri" })],
        spacing: { after: 200 },
      }),
    );
  }

  children.push(new Paragraph({ children: [], spacing: { after: 200 } }));

  const stepLabels = computeStepLabels(nodes);
  for (const node of nodes) {
    if (node.type === "step") {
      const label = stepLabels.get(node.id) ?? "";

      // Build cell content: step number + title row, then description, then images
      const cellChildren: Paragraph[] = [];

      // Step label + title as a single paragraph (mimics the badge + title in PDF)
      cellChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${label}`, bold: true, size: 22, font: "Calibri", color: "333333" }),
            new TextRun({ text: `  ${node.title || "(untitled)"}`, bold: true, size: 24, font: "Calibri" }),
          ],
          spacing: { after: 120 },
        }),
      );

      // Description
      if (node.description) {
        const descParas = tiptapJsonToParagraphs(node.description);
        cellChildren.push(...descParas);
      }

      // Images - preserve aspect ratio, scale to fit width
      const images = getStepImages(node);
      for (const imgUrl of images) {
        if (!imgUrl.startsWith("data:")) continue;
        try {
          const { buffer } = dataUrlToBuffer(imgUrl);
          const size = await getImageSize(imgUrl);
          const scale = Math.min(1, MAX_IMG_WIDTH / size.width);
          const w = Math.round(size.width * scale);
          const h = Math.round(size.height * scale);
          cellChildren.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: buffer,
                  transformation: { width: w, height: h },
                  type: "png",
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: 80 },
            }),
          );
        } catch {
          /* skip broken images */
        }
      }

      // Wrap in a single-cell table to create a card-like border
      const allBorders = {
        top: LIGHT_BORDER,
        bottom: LIGHT_BORDER,
        left: LIGHT_BORDER,
        right: LIGHT_BORDER,
      };
      children.push(
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: cellChildren.length > 0 ? cellChildren : [new Paragraph({ children: [] })],
                  borders: allBorders,
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  margins: { top: 120, bottom: 160, left: 200, right: 200 },
                }),
              ],
            }),
          ],
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
      );

      children.push(new Paragraph({ children: [], spacing: { after: 160 } }));
    } else if (node.type === "tip") {
      const isWarning = node.variant === "warning";
      const isSuccess = node.variant === "success";
      const prefix = isWarning ? "Warning: " : isSuccess ? "Tip: " : "Note: ";
      const bgColor = isWarning ? "FEE2E2" : isSuccess ? "D1FAE5" : "DBEAFE";
      const borderColor = isWarning ? "FCA5A5" : isSuccess ? "6EE7B7" : "93C5FD";
      const textColor = isWarning ? "7F1D1D" : isSuccess ? "064E3B" : "1E3A5F";

      const allBorders = {
        top: { style: BorderStyle.SINGLE, size: 2, color: borderColor } as IBorderOptions,
        bottom: { style: BorderStyle.SINGLE, size: 2, color: borderColor } as IBorderOptions,
        left: { style: BorderStyle.SINGLE, size: 2, color: borderColor } as IBorderOptions,
        right: { style: BorderStyle.SINGLE, size: 2, color: borderColor } as IBorderOptions,
      };

      children.push(
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: prefix, bold: true, size: 21, font: "Calibri", color: textColor }),
                        new TextRun({ text: node.text || "", size: 21, font: "Calibri", color: textColor }),
                      ],
                      alignment: AlignmentType.CENTER,
                    }),
                  ],
                  borders: allBorders,
                  shading: { type: ShadingType.CLEAR, fill: bgColor },
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  margins: { top: 100, bottom: 100, left: 200, right: 200 },
                  verticalAlign: VerticalAlign.CENTER,
                }),
              ],
            }),
          ],
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
      );

      children.push(new Paragraph({ children: [], spacing: { after: 160 } }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 },
        },
      },
      children,
    }],
  });

  return Packer.toArrayBuffer(doc);
}
