import { useRef, useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getContrastTextColor } from "@/lib/utils";
import type {
  SOP,
  Step,
  StepNode,
  CircleAnnotation,
  ArrowAnnotation,
  EllipseAnnotation,
  BlurAnnotation,
  InstructionNode,
  TipVariant,
} from "@shared/types";
import { getInstructionNodes, computeStepLabels } from "@shared/types";
import { RichTextReadonly } from "@/components/RichTextReadonly";

function getStepImages(step: Step): string[] {
  if (step.imageRows?.length) return step.imageRows.flat();
  if (step.imageUrls?.length) return step.imageUrls;
  return step.imageUrl ? [step.imageUrl] : [];
}

function getStepImageRows(step: Step): string[][] {
  if (step.imageRows?.length) return step.imageRows;
  const flat = getStepImages(step);
  return flat.length ? [flat] : [];
}

interface SOPPrintViewProps {
  sop: SOP;
  brandColors?: { primary?: string; accent?: string };
  stepBackgroundColor?: string;
  /** Background color for step number badge (PDF/print). Text color is chosen automatically for contrast. */
  stepNumberIconBgColor?: string;
  /** Data URL of brand logo; shown in top-right of the page */
  brandLogoUrl?: string | null;
  onReady?: () => void;
}

const DEFAULT_CIRCLE_COLOR = "rgba(59, 130, 246, 0.9)";

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return "rgba(59, 130, 246, 0.15)";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Content width for print (210mm ≈ 794px minus horizontal padding). Use full width for large, sharp images. */
const PRINT_CONTENT_WIDTH_PX = 700;

/** Renders image + canvas overlay for circles, arrows and ellipses so html2canvas captures them reliably, with slight fill. */
function AnnotatedImage({
  imageUrl,
  circles,
  arrows = [],
  ellipses = [],
  blurs = [],
  width = PRINT_CONTENT_WIDTH_PX,
}: {
  imageUrl: string;
  circles: CircleAnnotation[];
  arrows?: ArrowAnnotation[];
  ellipses?: EllipseAnnotation[];
  blurs?: BlurAnnotation[];
  width?: number;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: width, h: 300 });
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    null,
  );

  const measureImg = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;
    setMeasured((prev) => (prev?.w === w && prev?.h === h ? prev : { w, h }));
  }, []);

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img?.naturalWidth) return;
    const w = width;
    const h = (img.naturalHeight / img.naturalWidth) * w;
    setSize({ w, h });
    setMeasured(null);
    requestAnimationFrame(measureImg);
  }, [width, measureImg]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth) onImgLoad();
  }, [imageUrl, onImgLoad]);

  useEffect(() => {
    const img = imgRef.current;
    const wrapper = wrapperRef.current;
    if (!img || !wrapper) return;
    const ro = new ResizeObserver(() => measureImg());
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [measureImg]);

  const canvasSize = measured ?? size;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.w <= 0 || canvasSize.h <= 0) return;
    const cssW = Math.round(canvasSize.w);
    const cssH = Math.round(canvasSize.h);
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scaleMin = Math.min(cssW, cssH);
    ctx.clearRect(0, 0, cssW, cssH);
    circles.forEach((c) => {
      const cx = c.cx <= 1 ? c.cx * cssW : c.cx;
      const cy = c.cy <= 1 ? c.cy * cssH : c.cy;
      const r = c.r <= 1 ? c.r * scaleMin : c.r;
      const color = c.color || DEFAULT_CIRCLE_COLOR;
      const strokeW = c.strokeWidth ?? 4;
      const fillColor = color.startsWith("rgba")
        ? color.replace(/[\d.]+\)$/, "0.15)")
        : color.startsWith("#")
          ? hexToRgba(color, 0.15)
          : "rgba(59, 130, 246, 0.15)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.stroke();
    });
    arrows.forEach((a) => {
      const x1 = a.x1 <= 1 ? a.x1 * cssW : a.x1;
      const y1 = a.y1 <= 1 ? a.y1 * cssH : a.y1;
      const x2 = a.x2 <= 1 ? a.x2 * cssW : a.x2;
      const y2 = a.y2 <= 1 ? a.y2 * cssH : a.y2;
      const color = a.color || DEFAULT_CIRCLE_COLOR;
      const strokeW = a.strokeWidth ?? 3;
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.min(12, Math.hypot(x2 - x1, y2 - y1) * 0.3);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle - 0.4),
        y2 - headLen * Math.sin(angle - 0.4),
      );
      ctx.lineTo(
        x2 - headLen * Math.cos(angle + 0.4),
        y2 - headLen * Math.sin(angle + 0.4),
      );
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
    });
    ellipses.forEach((el) => {
      const cx = el.cx <= 1 ? el.cx * cssW : el.cx;
      const cy = el.cy <= 1 ? el.cy * cssH : el.cy;
      const rx = Math.max(1, el.rx <= 1 ? el.rx * cssW : el.rx);
      const ry = Math.max(1, el.ry <= 1 ? el.ry * cssH : el.ry);
      const color = el.color || DEFAULT_CIRCLE_COLOR;
      const strokeW = el.strokeWidth ?? 4;
      const fillColor = color.startsWith("rgba")
        ? color.replace(/[\d.]+\)$/, "0.15)")
        : color.startsWith("#")
          ? hexToRgba(color, 0.15)
          : "rgba(59, 130, 246, 0.15)";
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.stroke();
    });
    // Redact annotations
    blurs.forEach((b) => {
      const bx = b.x <= 1 ? b.x * cssW : b.x;
      const by = b.y <= 1 ? b.y * cssH : b.y;
      const bw = b.w <= 1 ? b.w * cssW : b.w;
      const bh = b.h <= 1 ? b.h * cssH : b.h;
      ctx.fillStyle = b.color || "#000000";
      ctx.fillRect(bx, by, bw, bh);
    });
  }, [circles, arrows, ellipses, blurs, canvasSize]);

  return (
    <div
      ref={wrapperRef}
      className="relative inline-block overflow-hidden rounded-lg border border-gray-200"
      style={{ width: size.w }}>
      <img
        ref={imgRef}
        src={imageUrl}
        alt=""
        className="block w-full h-auto"
        style={{ maxWidth: "100%", verticalAlign: "top" }}
        onLoad={onImgLoad}
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 pointer-events-none"
        style={{
          width: canvasSize.w,
          height: canvasSize.h,
          left: 0,
          top: 0,
        }}
      />
    </div>
  );
}

/** Row of images with widths proportional to aspect ratios for print/PDF */
function PrintStepImagesRow({
  imageUrls,
  circles,
  arrows = [],
  ellipses = [],
  blurs = [],
  totalWidth = PRINT_CONTENT_WIDTH_PX,
}: {
  imageUrls: string[];
  circles: CircleAnnotation[];
  arrows?: ArrowAnnotation[];
  ellipses?: EllipseAnnotation[];
  blurs?: BlurAnnotation[];
  totalWidth?: number;
}) {
  const [ratios, setRatios] = useState<number[]>([]);

  useEffect(() => {
    if (imageUrls.length === 0) {
      setRatios([]);
      return;
    }
    let cancelled = false;
    const loads = imageUrls.map((url) => {
      return new Promise<number>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
        img.onerror = () => resolve(1);
        img.src = url;
      });
    });
    Promise.all(loads).then((r) => {
      if (!cancelled) setRatios(r);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrls]);

  if (imageUrls.length === 0) return null;
  const total = ratios.length ? ratios.reduce((a, b) => a + b, 0) : 1;
  const widths = ratios.map((r) =>
    total ? (r / total) * totalWidth : totalWidth / imageUrls.length,
  );

  return (
    <div className="flex w-full gap-3 justify-center">
      {imageUrls.map((url, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-lg border border-gray-200"
          style={{ width: widths[i] }}>
          {i === 0 ? (
            <AnnotatedImage
              imageUrl={url}
              circles={circles}
              arrows={arrows}
              ellipses={ellipses}
              blurs={blurs}
              width={widths[i]}
            />
          ) : (
            <img
              src={url}
              alt=""
              className="block w-full h-auto"
              style={{ maxWidth: "100%", verticalAlign: "top" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

const TIP_VARIANT_PRINT_CLASSES: Record<TipVariant, string> = {
  neutral: "bg-blue-100 text-blue-900 border-blue-300",
  success: "bg-emerald-100 text-emerald-900 border-emerald-300",
  warning: "bg-red-100 text-red-900 border-red-300",
};

function renderPrintTipIcon(variant: TipVariant) {
  const commonProps = {
    className: "h-5 w-5 text-current",
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  } as const;
  if (variant === "success") {
    return (
      <svg {...commonProps}>
        <circle
          cx="12"
          cy="12"
          r="10"
          style={{ fill: "currentColor", opacity: 0.12 }}
        />
        <path
          d="M8.5 12.5 11 15l4.5-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (variant === "warning") {
    return (
      <svg {...commonProps}>
        <path
          d="M12 4 3.5 19h17L12 4z"
          style={{ fill: "currentColor", opacity: 0.12 }}
        />
        <path
          d="M12 9.5v4.5M12 17h.01"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // neutral
  return (
    <svg {...commonProps}>
      <circle
        cx="12"
        cy="12"
        r="10"
        style={{ fill: "currentColor", opacity: 0.12 }}
      />
      <path
        d="M12 9.25v5M12 7h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const DEFAULT_STEP_ICON_BG = "#ffffff";

export function SOPPrintView({
  sop,
  brandColors,
  stepBackgroundColor = "#f7f7f7",
  stepNumberIconBgColor = DEFAULT_STEP_ICON_BG,
  brandLogoUrl,
  onReady,
}: SOPPrintViewProps) {
  const stepNumberIconTextColor = getContrastTextColor(stepNumberIconBgColor);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onReady?.();
  }, [onReady, sop, brandColors, brandLogoUrl]);

  const primary = brandColors?.primary;
  const accent = brandColors?.accent;

  return (
    <div
      ref={ref}
      dir={sop.dir || 'ltr'}
      className="bg-background text-foreground py-8 px-14 max-w-[210mm] mx-auto overflow-visible"
      style={
        {
          "--primary": primary || undefined,
          "--accent": accent || undefined,
          caretColor: "transparent",
          backgroundColor: "#FFFFFF",
        } as React.CSSProperties
      }
      tabIndex={-1}>
      <div className="flex items-start justify-between gap-4 mb-[40px]">
        <div className="min-w-0 flex-1">
          <h1
            className={`text-2xl font-semibold min-w-0 ${brandLogoUrl ? "max-w-[60%]" : ""}`}
            style={primary ? { color: primary } : undefined}>
            {sop.title}
          </h1>
          {sop.subtitle != null && sop.subtitle.trim() !== "" && (
            <p className="mt-1 text-base font-normal text-muted-foreground">
              {sop.subtitle}
            </p>
          )}
        </div>
        {brandLogoUrl && (
          <img
            src={brandLogoUrl}
            alt=""
            className="h-10 w-auto max-w-[180px] object-contain shrink-0"
            aria-hidden
          />
        )}
      </div>
      <div className="space-y-6 px-3">
        {(() => {
          const nodes = getInstructionNodes(sop);
          const stepLabels = computeStepLabels(nodes);
          let stepIndex = 0;
          let nodeIndex = 0;
          return nodes.map((node: InstructionNode) => {
            if (node.type === "step") {
              const step = node as StepNode;
              const currentStepIndex = stepIndex++;
              const currentNodeIndex = nodeIndex++;
              const label = stepLabels.get(step.id) ?? String(currentStepIndex + 1);
              const indentLevel = step.indent ?? 0;
              return (
                <Card
                  key={step.id}
                  className="break-inside-avoid border border-border shadow-none overflow-visible"
                  style={indentLevel > 0 ? { marginLeft: indentLevel * 24 } : undefined}
                  data-step-index={currentStepIndex}
                  data-node-item={currentNodeIndex}>
                  <CardHeader
                    className="relative pt-2 pb-5 pl-12 pr-6 space-y-0 overflow-visible"
                    data-step-header>
                    <span
                      className="absolute left-4 top-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold border border-border shadow-sm"
                      style={{
                        backgroundColor: stepNumberIconBgColor,
                        color: stepNumberIconTextColor,
                      }}
                      aria-hidden
                      data-step-badge="">
                      <span
                        className="inline-flex items-center justify-center leading-[1] mb-4"
                        style={{ paddingTop: "1px" }}>
                        {label}
                      </span>
                    </span>
                    <div className="relative z-10 min-w-0 flex-1 overflow-visible pt-0.5 ml-3 min-h-[1.5em]">
                      <span
                        className="block text-base font-semibold"
                        style={{
                          lineHeight: 1.5,
                          paddingBottom: 6,
                          ...(accent && step.title ? { color: accent } : {}),
                        }}>
                        {step.title || "\u00A0"}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {step.description && (
                      <RichTextReadonly content={step.description} />
                    )}
                    {(() => {
                      const rows = getStepImageRows(step);
                      if (rows.length === 0) return null;
                      const mainRowIndex =
                        rows.length <= 1
                          ? 0
                          : Math.floor((rows.length - 1) / 2);
                      if (rows.length === 1 && rows[0].length === 1) {
                        return (
                          <div className="flex justify-center">
                            <AnnotatedImage
                              imageUrl={rows[0][0]}
                              circles={step.annotations?.circles ?? []}
                              arrows={step.annotations?.arrows ?? []}
                              ellipses={step.annotations?.ellipses ?? []}
                              blurs={step.annotations?.blurs ?? []}
                            />
                          </div>
                        );
                      }
                      if (rows.length === 1) {
                        return (
                          <PrintStepImagesRow
                            imageUrls={rows[0]}
                            circles={step.annotations?.circles ?? []}
                            arrows={step.annotations?.arrows ?? []}
                            ellipses={step.annotations?.ellipses ?? []}
                            blurs={step.annotations?.blurs ?? []}
                          />
                        );
                      }
                      return (
                        <div className="flex flex-col gap-4">
                          {rows.map((rowUrls, rowIdx) => (
                            <PrintStepImagesRow
                              key={rowIdx}
                              imageUrls={rowUrls}
                              circles={
                                rowIdx === mainRowIndex
                                  ? (step.annotations?.circles ?? [])
                                  : []
                              }
                              arrows={
                                rowIdx === mainRowIndex
                                  ? (step.annotations?.arrows ?? [])
                                  : []
                              }
                              ellipses={
                                rowIdx === mainRowIndex
                                  ? (step.annotations?.ellipses ?? [])
                                  : []
                              }
                              blurs={
                                rowIdx === mainRowIndex
                                  ? (step.annotations?.blurs ?? [])
                                  : []
                              }
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              );
            }
            if (node.type === "tip") {
              const variantClasses = TIP_VARIANT_PRINT_CLASSES[node.variant];
              const currentNodeIndex = nodeIndex++;
              return (
                <div
                  key={node.id}
                  data-node-item={currentNodeIndex}
                  className={`break-inside-avoid rounded-lg border-2 pt-1 pb-5 px-4 text-center ${variantClasses}`}>
                  <div className="flex items-center gap-3 justify-center text-left">
                    <div className="shrink-0">
                      {renderPrintTipIcon(node.variant)}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">
                      {node.text || "\u00A0"}
                    </p>
                  </div>
                </div>
              );
            }
            return null;
          });
        })()}
      </div>
    </div>
  );
}
