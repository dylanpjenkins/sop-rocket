import { useState, useCallback, useRef, useEffect } from "react";
import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, Trash2, GripVertical, Circle, Square, ChevronDown, Download, IndentIncrease, IndentDecrease } from "lucide-react";
import { StepImageWithAnnotations } from "@/components/StepImageWithAnnotations";
import { SOPPrintView } from "@/components/SOPPrintView";
import { StepHeader } from "@/components/StepHeader";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { exportDocx } from "@/lib/exporters/exportDocx";
import type {
  SOP,
  Step,
  StepNode,
  ArrowAnnotation,
  EllipseAnnotation,
  InstructionNode,
  TipNode,
  TipVariant,
} from "@shared/types";
import {
  getInstructionNodes,
  getStepsFromNodes,
  isStepNode,
  createTipNode,
  computeStepLabels,
} from "@shared/types";

const SOP_EXT = ".sop.json";

const UNDO_HISTORY_MAX = 50;

/** Deep-clone SOP for undo history (nodes/steps, annotations, imageUrls, imageRows). */
function cloneSOP(sop: SOP): SOP {
  const nodes = getInstructionNodes(sop);
  const clonedNodes: InstructionNode[] = nodes.map((node) => {
    if (node.type === "step") {
      return {
        ...node,
        imageUrls: node.imageUrls ? [...node.imageUrls] : undefined,
        imageRows: node.imageRows?.map((row) => [...row]) ?? undefined,
        annotations: {
          circles: (node.annotations?.circles ?? []).map((c) => ({ ...c })),
          arrows: (node.annotations?.arrows ?? []).map((a) => ({ ...a })),
          ellipses: (node.annotations?.ellipses ?? []).map((e) => ({ ...e })),
          blurs: (node.annotations?.blurs ?? []).map((b) => ({ ...b })),
        },
      };
    }
    return { ...node };
  });
  return {
    ...sop,
    steps: getStepsFromNodes({ ...sop, nodes: clonedNodes }),
    nodes: clonedNodes,
  };
}

/** Returns normalized image list; supports legacy imageUrl-only steps */
function getStepImages(step: Step): string[] {
  if (step.imageRows?.length) return step.imageRows.flat();
  if (step.imageUrls?.length) return step.imageUrls;
  return step.imageUrl ? [step.imageUrl] : [];
}

/** Returns step images as rows; main row first. Used for stacked layout. */
function getStepImageRows(step: Step): string[][] {
  if (step.imageRows?.length) return step.imageRows;
  const flat = getStepImages(step);
  return flat.length ? [flat] : [];
}

function createStep(title = ""): StepNode {
  return {
    type: "step",
    id: crypto.randomUUID(),
    title,
    imageUrl: "",
    annotations: { circles: [], arrows: [], ellipses: [] },
  };
}

/** Ensures sop has nodes derived from steps when missing. Returns a new SOP (does not mutate). */
function normalizeSOP(sop: SOP): SOP {
  if (sop.nodes != null) {
    return { ...sop, steps: getStepsFromNodes(sop) };
  }
  const nodes: InstructionNode[] = sop.steps.map((step) => ({
    ...step,
    type: "step" as const,
  }));
  return { ...sop, nodes };
}

function createSOP(): SOP {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    steps: [],
    nodes: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface SortableStepCardProps {
  step: Step;
  index: number;
  /** Node index in the instruction list (for paste/drop targeting) */
  nodeIndex: number;
  imageRows: string[][];
  onUpdate: (patch: Partial<Step>) => void;
  onRemove: () => void;
  onDropImage: (imageUrl: string, append?: boolean) => void;
  onOpenPasteMenu?: (e: React.MouseEvent) => void;
  stepBackgroundColor?: string;
  stepNumberIconBgColor?: string;
  isPasteTarget?: boolean;
  isPlusPasteTarget?: boolean;
  /** Which plus position is currently hovered (for highlight) */
  activePastePosition?: PastePosition;
  onPasteTargetEnter?: (position: PastePosition) => void;
  onPasteTargetLeave?: () => void;
  onAddImageClick?: (position?: PastePosition) => void;
  onAddStepAfter?: () => void;
  onCropImage?: (imageIndex: number) => void;
  stepLabel?: string;
  indent?: number;
  onIndent?: () => void;
  onOutdent?: () => void;
}

type PastePosition = false | "left" | "right" | "above" | "below";

/** Row of images with widths proportional to aspect ratios */
function StepImagesRow({
  imageUrls,
  annotations,
  onAnnotationsChange,
  onArrowsChange,
  onEllipsesChange,
  onBlursChange,
  onReorderImages,
  onRemoveImage,
  onCropImage,
  className = "",
}: {
  imageUrls: string[];
  annotations: Step["annotations"];
  onAnnotationsChange: (circles: Step["annotations"]["circles"]) => void;
  onArrowsChange?: (arrows: ArrowAnnotation[]) => void;
  onEllipsesChange?: (ellipses: EllipseAnnotation[]) => void;
  onBlursChange?: (blurs: import("@shared/types").BlurAnnotation[]) => void;
  onReorderImages?: (newUrls: string[]) => void;
  onRemoveImage?: (index: number) => void;
  onCropImage?: (index: number) => void;
  className?: string;
}) {
  const [ratios, setRatios] = useState<number[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const canReorder = imageUrls.length >= 2 && onReorderImages;
  const canRemove = onRemoveImage != null;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!canReorder) return;
    setDragIndex(index);
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (!canReorder || dragIndex == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  };

  const handleDragLeave = () => {
    setDropIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromStr = e.dataTransfer.getData("text/plain");
    const fromIndex = fromStr === "" ? null : parseInt(fromStr, 10);
    setDragIndex(null);
    setDropIndex(null);
    if (
      !canReorder ||
      fromIndex == null ||
      fromIndex === toIndex ||
      Number.isNaN(fromIndex)
    )
      return;
    const next = [...imageUrls];
    const [removed] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, removed);
    onReorderImages(next);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

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
  const basisPcts = ratios.map((r) =>
    total ? (r / total) * 100 : 100 / imageUrls.length,
  );

  return (
    <div
      ref={containerRef}
      className={`flex w-full gap-3 overflow-hidden rounded-md border bg-muted/50 ${className}`}>
      {imageUrls.map((url, i) => (
        <div
          key={i}
          draggable={!!canReorder}
          onDragStart={(e) => handleDragStart(e, i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
          className={`relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 ${canReorder ? "cursor-grab active:cursor-grabbing" : ""} ${dragIndex === i ? "opacity-50" : ""} ${dropIndex === i ? "ring-2 ring-primary/40 ring-offset-1 rounded" : ""}`}
          style={{ flexBasis: `${basisPcts[i]}%` }}>
          {i === 0 ? (
            <StepImageWithAnnotations
              imageUrl={url}
              circles={annotations?.circles ?? []}
              onCirclesChange={onAnnotationsChange}
              arrows={annotations?.arrows ?? []}
              onArrowsChange={onArrowsChange ?? (() => {})}
              ellipses={annotations?.ellipses ?? []}
              onEllipsesChange={onEllipsesChange ?? (() => {})}
              blurs={annotations?.blurs ?? []}
              onBlursChange={onBlursChange ?? (() => {})}
              className="max-h-[280px] w-full"
            />
          ) : (
            <img
              src={url}
              alt=""
              className="max-h-[280px] max-w-full object-contain pointer-events-none"
            />
          )}
          {onCropImage && (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute left-2 bottom-2 h-7 w-7 rounded-full opacity-80 hover:opacity-100 shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                onCropImage(i);
              }}
              aria-label="Crop image">
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}
          {canRemove && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute right-2 bottom-2 h-7 w-7 rounded-full opacity-80 hover:opacity-100 shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveImage(i);
              }}
              aria-label="Remove image">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function SortableStepCard({
  step,
  index,
  nodeIndex,
  imageRows,
  onUpdate,
  onRemove,
  onDropImage,
  onOpenPasteMenu,
  stepBackgroundColor,
  stepNumberIconBgColor,
  isPasteTarget,
  isPlusPasteTarget,
  activePastePosition,
  onPasteTargetEnter,
  onPasteTargetLeave,
  onAddImageClick,
  onAddStepAfter,
  onCropImage,
  stepLabel,
  indent = 0,
  onIndent,
  onOutdent,
}: SortableStepCardProps) {
  const [cardHovered, setCardHovered] = useState(false);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const leftPlusRef = useRef<HTMLButtonElement>(null);
  const rightPlusRef = useRef<HTMLButtonElement>(null);
  const abovePlusRef = useRef<HTMLButtonElement>(null);
  const belowPlusRef = useRef<HTMLButtonElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: step.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const hasImages = imageRows.length > 0 && imageRows.some((r) => r.length > 0);
  const flatImages = imageRows.flat();
  const mainRowIndex =
    imageRows.length <= 1 ? 0 : Math.floor((imageRows.length - 1) / 2);
  const showPlus = cardHovered && onAddImageClick && hasImages;

  const setRows = (newRows: string[][]) => {
    onUpdate({
      imageRows: newRows,
      imageUrls: newRows.flat(),
      imageUrl: newRows[0]?.[0] ?? "",
    });
  };

  const handleReorderInRow = (rowIndex: number, newUrls: string[]) => {
    const next = imageRows.map((row, i) => (i === rowIndex ? newUrls : row));
    setRows(next);
  };

  const handleRemoveInRow = (rowIndex: number, imgIndex: number) => {
    const row = imageRows[rowIndex];
    const nextRow = row.filter((_, i) => i !== imgIndex);
    const next =
      nextRow.length === 0
        ? imageRows.filter((_, i) => i !== rowIndex)
        : imageRows.map((r, i) => (i === rowIndex ? nextRow : r));
    setRows(next);
  };

  const plusButtonClass = (pos: PastePosition) =>
    `absolute flex h-9 w-9 items-center justify-center rounded-full border bg-background/95 shadow-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all duration-150 opacity-90 hover:opacity-100 ${activePastePosition === pos ? "ring-1 ring-primary/30 ring-offset-1" : "border-border"}`;

  return (
    <Card
      ref={setNodeRef}
      style={{ ...style, ...(indent > 0 ? { marginLeft: indent * 32 } : {}) }}
      data-step-id={step.id}
      className={`flex flex-row border border-border ${isDragging ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-center self-stretch w-10 shrink-0 border-r border-border/50 bg-muted/30">
        <button
          type="button"
          className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground p-1 rounded hover:bg-muted/50"
          {...attributes}
          {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <CardHeader className="px-4 py-2 flex flex-row items-center gap-3 space-y-0">
          <StepHeader
            index={index}
            title={step.title}
            editable
            onTitleChange={(value) => onUpdate({ title: value })}
            onEnterKey={onAddStepAfter}
            stepNumberIconBgColor={stepNumberIconBgColor}
            displayLabel={stepLabel}
          />
          <div className="ml-auto shrink-0 flex items-center gap-0.5">
            {onOutdent && indent > 0 && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOutdent} title="Outdent">
                <IndentDecrease className="h-3.5 w-3.5" />
              </Button>
            )}
            {onIndent && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onIndent} title="Indent (make sub-step)">
                <IndentIncrease className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <RichTextEditor
            content={step.description}
            onChange={(json) => onUpdate({ description: json })}
            placeholder="Describe this step..."
          />
          <div
            ref={contentWrapperRef}
            className="relative min-h-[80px] outline-none"
            data-step-index={nodeIndex}
            tabIndex={-1}
            onMouseEnter={() => {
              setCardHovered(true);
              onPasteTargetEnter?.(false);
            }}
            onMouseMove={(e) => {
              if (!showPlus) return;
              const target = e.target as Node;
              if (leftPlusRef.current?.contains(target))
                onPasteTargetEnter?.("left");
              else if (rightPlusRef.current?.contains(target))
                onPasteTargetEnter?.("right");
              else if (abovePlusRef.current?.contains(target))
                onPasteTargetEnter?.("above");
              else if (belowPlusRef.current?.contains(target))
                onPasteTargetEnter?.("below");
            }}
            onMouseLeave={(e) => {
              setCardHovered(false);
              const related = e.relatedTarget;
              if (
                !related ||
                !(related instanceof Node) ||
                !contentWrapperRef.current?.contains(related)
              ) {
                onPasteTargetLeave?.();
              }
            }}>
            {imageRows.length >= 2 ? (
              <div
                className={`min-h-[120px] flex flex-col gap-3 transition-all duration-150 ${isPasteTarget && !isPlusPasteTarget ? "ring-1 ring-primary/25 ring-offset-1 rounded-md" : ""}`}
                onMouseEnter={() => onPasteTargetEnter?.(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const f = e.dataTransfer.files[0];
                  if (f?.type.startsWith("image/")) {
                    const r = new FileReader();
                    r.onload = () => onDropImage(r.result as string, false);
                    r.readAsDataURL(f);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}>
                {imageRows.map((rowUrls, rowIdx) => (
                  <StepImagesRow
                    key={rowIdx}
                    imageUrls={rowUrls}
                    annotations={
                      rowIdx === mainRowIndex
                        ? step.annotations
                        : { circles: [], arrows: [], ellipses: [] }
                    }
                    onAnnotationsChange={
                      rowIdx === mainRowIndex
                        ? (circles) =>
                            onUpdate({
                              annotations: { ...step.annotations, circles },
                            })
                        : () => {}
                    }
                    onArrowsChange={
                      rowIdx === mainRowIndex
                        ? (arrows) =>
                            onUpdate({
                              annotations: { ...step.annotations, arrows },
                            })
                        : undefined
                    }
                    onEllipsesChange={
                      rowIdx === mainRowIndex
                        ? (ellipses) =>
                            onUpdate({
                              annotations: { ...step.annotations, ellipses },
                            })
                        : undefined
                    }
                    onBlursChange={
                      rowIdx === mainRowIndex
                        ? (blurs) =>
                            onUpdate({
                              annotations: { ...step.annotations, blurs },
                            })
                        : undefined
                    }
                    onReorderImages={
                      rowUrls.length >= 2
                        ? (newUrls) => handleReorderInRow(rowIdx, newUrls)
                        : undefined
                    }
                    onRemoveImage={(i) => handleRemoveInRow(rowIdx, i)}
                    onCropImage={onCropImage ? (i) => {
                      const flatIdx = imageRows.slice(0, rowIdx).reduce((acc, r) => acc + r.length, 0) + i;
                      onCropImage(flatIdx);
                    } : undefined}
                  />
                ))}
              </div>
            ) : flatImages.length >= 2 ? (
              <div
                className={`min-h-[120px] transition-all duration-150 ${isPasteTarget && !isPlusPasteTarget ? "ring-1 ring-primary/25 ring-offset-1 rounded-md" : ""}`}
                onMouseEnter={() => onPasteTargetEnter?.(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const f = e.dataTransfer.files[0];
                  if (f?.type.startsWith("image/")) {
                    const r = new FileReader();
                    r.onload = () => onDropImage(r.result as string, false);
                    r.readAsDataURL(f);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}>
                <StepImagesRow
                  imageUrls={imageRows[0]}
                  annotations={step.annotations}
                  onAnnotationsChange={(circles) =>
                    onUpdate({ annotations: { ...step.annotations, circles } })
                  }
                  onArrowsChange={(arrows) =>
                    onUpdate({ annotations: { ...step.annotations, arrows } })
                  }
                  onEllipsesChange={(ellipses) =>
                    onUpdate({ annotations: { ...step.annotations, ellipses } })
                  }
                  onBlursChange={(blurs) =>
                    onUpdate({ annotations: { ...step.annotations, blurs } })
                  }
                  onReorderImages={(newUrls) => setRows([newUrls])}
                  onRemoveImage={(i) => handleRemoveInRow(0, i)}
                  onCropImage={onCropImage}
                />
              </div>
            ) : hasImages ? (
              <div
                className={`relative border rounded-md overflow-hidden bg-muted/50 min-h-[120px] flex items-center justify-center p-2 transition-all duration-150 ${isPasteTarget && !isPlusPasteTarget ? "ring-1 ring-primary/25 ring-offset-1" : ""}`}
                onMouseEnter={() => onPasteTargetEnter?.(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const f = e.dataTransfer.files[0];
                  if (f?.type.startsWith("image/")) {
                    const r = new FileReader();
                    r.onload = () => onDropImage(r.result as string, false);
                    r.readAsDataURL(f);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}>
                <StepImageWithAnnotations
                  imageUrl={imageRows[0][0]}
                  circles={step.annotations?.circles ?? []}
                  onCirclesChange={(circles) =>
                    onUpdate({ annotations: { ...step.annotations, circles } })
                  }
                  arrows={step.annotations?.arrows ?? []}
                  onArrowsChange={(arrows) =>
                    onUpdate({ annotations: { ...step.annotations, arrows } })
                  }
                  ellipses={step.annotations?.ellipses ?? []}
                  onEllipsesChange={(ellipses) =>
                    onUpdate({ annotations: { ...step.annotations, ellipses } })
                  }
                  blurs={step.annotations?.blurs ?? []}
                  onBlursChange={(blurs) =>
                    onUpdate({ annotations: { ...step.annotations, blurs } })
                  }
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute right-2 bottom-2 h-7 w-7 rounded-full opacity-80 hover:opacity-100 shadow-md z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRows([]);
                  }}
                  aria-label="Remove image">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div
                className={`border-2 border-dashed rounded-md p-8 text-center text-muted-foreground text-sm transition-all duration-150 ${isPasteTarget && !isPlusPasteTarget ? "ring-1 ring-primary/25 ring-offset-1 border-primary/20" : ""}`}
                onClick={() => onAddImageClick?.(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const f = e.dataTransfer.files[0];
                  if (f?.type.startsWith("image/")) {
                    const r = new FileReader();
                    r.onload = () => onDropImage(r.result as string);
                    r.readAsDataURL(f);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onOpenPasteMenu?.(e);
                }}
                style={{ cursor: 'pointer' }}>
                Drop screenshot here, paste from clipboard, or click to upload
              </div>
            )}

            {showPlus && (
              <>
                <button
                  ref={abovePlusRef}
                  type="button"
                  data-step-index={nodeIndex}
                  data-paste-position="above"
                  className={`absolute left-1/2 top-2 -translate-x-1/2 ${plusButtonClass("above")}`}
                  onMouseEnter={(e) => {
                    e.stopPropagation();
                    onPasteTargetEnter?.("above");
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddImageClick?.("above");
                  }}
                  title="Add image above"
                  aria-label="Add image above">
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  ref={belowPlusRef}
                  type="button"
                  data-step-index={nodeIndex}
                  data-paste-position="below"
                  className={`absolute left-1/2 bottom-2 -translate-x-1/2 ${plusButtonClass("below")}`}
                  onMouseEnter={(e) => {
                    e.stopPropagation();
                    onPasteTargetEnter?.("below");
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddImageClick?.("below");
                  }}
                  title="Add image below"
                  aria-label="Add image below">
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  ref={leftPlusRef}
                  type="button"
                  data-step-index={nodeIndex}
                  data-paste-position="left"
                  className={`absolute left-2 top-1/2 -translate-y-1/2 ${plusButtonClass("left")}`}
                  onMouseEnter={(e) => {
                    e.stopPropagation();
                    onPasteTargetEnter?.("left");
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddImageClick?.("left");
                  }}
                  title="Add image to the left"
                  aria-label="Add image left">
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  ref={rightPlusRef}
                  type="button"
                  data-step-index={nodeIndex}
                  data-paste-position="right"
                  className={`absolute right-2 top-1/2 -translate-y-1/2 ${plusButtonClass("right")}`}
                  onMouseEnter={(e) => {
                    e.stopPropagation();
                    onPasteTargetEnter?.("right");
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddImageClick?.("right");
                  }}
                  title="Add image to the right"
                  aria-label="Add image right">
                  <Plus className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

const TIP_VARIANT_CLASSES: Record<TipVariant, string> = {
  neutral: "bg-blue-50 text-blue-900 border-blue-200",
  success: "bg-emerald-50 text-emerald-900 border-emerald-200",
  warning: "bg-red-50 text-red-900 border-red-200",
};

interface SortableTipCardProps {
  node: TipNode;
  onUpdate: (patch: Partial<TipNode>) => void;
  onRemove: () => void;
}

function SortableTipCard({ node, onUpdate, onRemove }: SortableTipCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const variantClasses = TIP_VARIANT_CLASSES[node.variant];

  const renderVariantIcon = () => {
    const commonProps = {
      className: "h-5 w-5 text-current",
      viewBox: "0 0 24 24",
      "aria-hidden": true,
    } as const;
    if (node.variant === "success") {
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
    if (node.variant === "warning") {
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
  };
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`flex flex-row overflow-hidden border-2 ${variantClasses} ${isDragging ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-center self-stretch w-10 shrink-0 border-r border-inherit bg-black/5">
        <button
          type="button"
          className="touch-none cursor-grab active:cursor-grabbing text-current opacity-70 p-1 rounded hover:bg-black/10"
          {...attributes}
          {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-w-0 flex flex-col py-2 px-3">
        <div className="flex items-center gap-2 mb-2">
          {(["success", "neutral", "warning"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onUpdate({ variant: v })}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                node.variant === v
                  ? v === "neutral"
                    ? "bg-blue-200 border-blue-400"
                    : v === "success"
                      ? "bg-emerald-200 border-emerald-400"
                      : "bg-red-200 border-red-400"
                  : "bg-transparent border-current opacity-60 hover:opacity-100"
              }`}>
              {v === "neutral"
                ? "Neutral"
                : v === "success"
                  ? "Tip"
                  : "Warning"}
            </button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto shrink-0 h-7 w-7"
            onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <div className="shrink-0">{renderVariantIcon()}</div>
          <Textarea
            placeholder="Tip or callout text..."
            value={node.text}
            onChange={(e) => onUpdate({ text: e.target.value })}
            className="min-h-[60px] resize-y border-0 bg-transparent shadow-none focus-visible:ring-0 placeholder:text-muted-foreground text-sm"
          />
        </div>
      </div>
    </Card>
  );
}

interface EditorViewProps {
  initialSOP: SOP | null;
  initialPath: string | null;
  onClose: () => void;
  onSOPSaved?: (path: string) => void;
  onSOPChange?: (sop: SOP) => void;
}

export function EditorView({
  initialSOP,
  initialPath,
  onClose,
  onSOPSaved,
  onSOPChange,
}: EditorViewProps) {
  const [sop, setSop] = useState<SOP>(() =>
    normalizeSOP(initialSOP ?? createSOP()),
  );
  const [path, setPath] = useState<string | null>(initialPath);
  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [cropImage, setCropImage] = useState<{
    nodeIndex: number;
    imageIndex: number;
    url: string;
  } | null>(null);
  const [brandColors, setBrandColors] = useState<{
    primary?: string;
    accent?: string;
  }>({});
  const [stepBackgroundColor, setStepBackgroundColor] =
    useState<string>("#f7f7f7");
  const [stepNumberIconBgColor, setStepNumberIconBgColor] =
    useState<string>("#ffffff");
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  const [showPrintView, setShowPrintView] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    onPasteImage: () => void;
  } | null>(null);
  const [pasteTargetIndex, setPasteTargetIndex] = useState<number | null>(null);
  const [pasteTargetAppend, setPasteTargetAppend] =
    useState<PastePosition>(false);
  const pasteTargetIndexRef = useRef<number | null>(null);
  const pasteTargetAppendRef = useRef<PastePosition>(false);
  const sopRef = useRef<SOP>(sop);
  const [addImageTargetIndex, setAddImageTargetIndex] = useState<number | null>(
    null,
  );
  const [addImageTargetPosition, setAddImageTargetPosition] =
    useState<PastePosition>("right");
  const [hoveredInsertAt, setHoveredInsertAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPasteHandledAt = useRef<number>(0);
  const printRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);
  const undoPastRef = useRef<SOP[]>([]);
  const undoFutureRef = useRef<SOP[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const captureUnsubscribeRef = useRef<(() => void) | null>(null);
  const addStepWithImageRef = useRef<(imageDataUrl: string, normalizedClickX?: number, normalizedClickY?: number) => void>(() => {});

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen]);


  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(40, el.scrollHeight)}px`;
  }, [sop.title]);

  useEffect(() => {
    const el = subtitleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(32, el.scrollHeight)}px`;
  }, [sop.subtitle]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.config?.get) {
      window.config
        .get()
        .then((c) => {
          setBrandColors(
            (c?.brandColors as { primary?: string; accent?: string }) ?? {},
          );
          setStepBackgroundColor(
            (c?.stepBackgroundColor as string) ?? "#f7f7f7",
          );
          setStepNumberIconBgColor(
            (c?.stepNumberIconBgColor as string) ?? "#ffffff",
          );
        })
        .catch(() => {});
    }
  }, []);

  const saveRef = useRef<(() => void | Promise<void>) | null>(null);
  const exportRef = useRef<(() => void | Promise<void>) | null>(null);

  const pushUndoPast = useCallback((snapshot: SOP) => {
    undoPastRef.current = [
      ...undoPastRef.current.slice(-(UNDO_HISTORY_MAX - 1)),
      cloneSOP(snapshot),
    ];
    undoFutureRef.current = [];
  }, []);

  const undo = useCallback((): boolean => {
    if (undoPastRef.current.length === 0) return false;
    const prev = undoPastRef.current.pop()!;
    undoFutureRef.current = [cloneSOP(sop), ...undoFutureRef.current];
    setSop(prev);
    return true;
  }, [sop]);

  const redo = useCallback((): boolean => {
    if (undoFutureRef.current.length === 0) return false;
    const next = undoFutureRef.current.shift()!;
    undoPastRef.current = [...undoPastRef.current, cloneSOP(sop)];
    setSop(next);
    return true;
  }, [sop]);

  const updateSOP = useCallback(
    (updater: (draft: SOP) => void) => {
      setSop((prev) => {
        pushUndoPast(prev);
        const next = { ...prev, updatedAt: new Date().toISOString() };
        updater(next);
        return next;
      });
    },
    [pushUndoPast],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        saveRef.current?.();
      }
      if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        exportRef.current?.();
      }
      if (e.ctrlKey && e.key === "y") {
        if (redo()) e.preventDefault();
      }
      if (e.ctrlKey && e.key === "z") {
        if (e.shiftKey) {
          if (redo()) e.preventDefault();
        } else {
          if (undo()) e.preventDefault();
        }
      }
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, undo, redo]);

  const addStep = () => {
    updateSOP((d) => {
      const nodes = getInstructionNodes(d);
      d.nodes = [...nodes, createStep()];
      d.steps = getStepsFromNodes(d);
    });
  };

  const addStepAfterNode = (nodeIndex: number) => {
    updateSOP((d) => {
      const nodes = getInstructionNodes(d);
      const newStep = createStep();
      nodes.splice(nodeIndex + 1, 0, newStep);
      d.nodes = nodes;
      d.steps = getStepsFromNodes(d);
    });
  };

  const removeNodeAtIndex = (nodeIndex: number) => {
    updateSOP((d) => {
      const nodes = getInstructionNodes(d);
      d.nodes = nodes.filter((_, i) => i !== nodeIndex);
      d.steps = getStepsFromNodes(d);
    });
  };

  const insertNodeAtIndex = (index: number, node: InstructionNode) => {
    updateSOP((d) => {
      const nodes = getInstructionNodes(d);
      d.nodes = [...nodes.slice(0, index), node, ...nodes.slice(index)];
      d.steps = getStepsFromNodes(d);
    });
  };

  const insertStepAtIndex = (index: number) => {
    insertNodeAtIndex(index, createStep());
  };

  const updateNode = (
    nodeIndex: number,
    patch: Partial<StepNode> | Partial<TipNode>,
  ) => {
    updateSOP((d) => {
      const nodes = getInstructionNodes(d);
      const node = nodes[nodeIndex];
      if (!node) return;
      if (node.type === "step") {
        const step = node;
        if ("imageRows" in patch && patch.imageRows) {
          step.imageRows = patch.imageRows;
          step.imageUrls = patch.imageRows.flat();
          step.imageUrl = patch.imageRows[0]?.[0] ?? "";
        }
        Object.assign(step, patch);
      } else if (node.type === "tip") {
        const tip = node;
        if ("text" in patch) tip.text = patch.text ?? tip.text;
        if ("variant" in patch) tip.variant = patch.variant ?? tip.variant;
      }
      d.steps = getStepsFromNodes(d);
    });
  };

  const updateStep = (nodeIndex: number, patch: Partial<Step>) => {
    updateNode(nodeIndex, patch);
  };

  const setStepImages = useCallback(
    (nodeIndex: number, imageUrl: string, position: PastePosition) => {
      updateSOP((d) => {
        const nodes = getInstructionNodes(d);
        const step = nodes[nodeIndex];
        if (!step || step.type !== "step") return;
        let rows = getStepImageRows(step);
        const mainRowIndex =
          rows.length <= 1 ? 0 : Math.floor((rows.length - 1) / 2);
        const syncFromRows = () => {
          step.imageRows = rows.filter((r) => r.length > 0);
          step.imageUrls = step.imageRows.flat();
          step.imageUrl = step.imageRows[0]?.[0] ?? "";
        };
        if (position === "left") {
          if (rows.length === 0) rows = [[imageUrl]];
          else {
            if (rows[mainRowIndex][0] === imageUrl) return;
            rows = [...rows];
            rows[mainRowIndex] = [imageUrl, ...rows[mainRowIndex]];
          }
          syncFromRows();
        } else if (position === "right") {
          if (rows.length === 0) rows = [[imageUrl]];
          else {
            const main = rows[mainRowIndex];
            if (main[main.length - 1] === imageUrl) return;
            rows = [...rows];
            rows[mainRowIndex] = [...main, imageUrl];
          }
          syncFromRows();
        } else if (position === "above") {
          if (rows.length > 0 && rows[0][0] === imageUrl) return;
          rows = [[imageUrl], ...rows];
          syncFromRows();
        } else if (position === "below") {
          if (
            rows.length > 0 &&
            rows[rows.length - 1]?.[rows[rows.length - 1].length - 1] ===
              imageUrl
          )
            return;
          rows = [...rows, [imageUrl]];
          syncFromRows();
        } else {
          step.imageUrl = imageUrl;
          step.imageUrls = [imageUrl];
          step.imageRows = [[imageUrl]];
        }
      });
    },
    [updateSOP],
  );

  const addStepWithImage = useCallback((imageDataUrl: string, normalizedClickX?: number, normalizedClickY?: number) => {
    setCaptureError(null);
    const newStep = createStep("");
    newStep.imageUrl = imageDataUrl;
    newStep.imageUrls = [imageDataUrl];
    newStep.imageRows = [[imageDataUrl]];
    const cx = typeof normalizedClickX === 'number' ? normalizedClickX : 0.5;
    const cy = typeof normalizedClickY === 'number' ? normalizedClickY : 0.5;
    newStep.annotations = {
      circles: [
        {
          cx,
          cy,
          r: 0.068,
          strokeWidth: 3,
          color: "rgba(59, 130, 246, 0.9)",
        },
      ],
      arrows: [],
      ellipses: [],
    };
    updateSOP((d) => {
      const n = getInstructionNodes(d);
      d.nodes = [...n, newStep];
      d.steps = getStepsFromNodes(d);
    });
  }, [updateSOP]);

  addStepWithImageRef.current = addStepWithImage;

  const startRecording = useCallback(async () => {
    if (!window.capture?.startRecording || !window.capture?.onAddStepWithImage) return;
    setCaptureError(null);
    const result = await window.capture.startRecording();
    if (!result.ok) {
      setCaptureError(result.error ?? "Could not start recording.");
      return;
    }
    setIsRecording(true);
    const addStepByPath = async (imagePath: string) => {
      try {
        window.capture?.log?.('[capture] addStepByPath start').catch(() => {});
        const dataUrl = window.capture?.readCapturedImage
          ? await window.capture.readCapturedImage(imagePath)
          : null;
        window.capture?.log?.('[capture] readCapturedImage ' + (dataUrl ? 'ok' : 'null')).catch(() => {});
        if (dataUrl) {
          window.capture?.log?.('[capture] calling addStepWithImageRef').catch(() => {});
          addStepWithImageRef.current(dataUrl);
        }
      } catch (err) {
        console.error("[capture] addStepByPath error:", err);
        window.capture?.log?.('[capture] addStepByPath error: ' + (err instanceof Error ? err.message : String(err))).catch(() => {});
      }
    };
    // Register with preload so main's executeJavaScript can trigger via window.capture.triggerAddStepByPath (same context as injected script)
    window.capture?.setAddStepPathHandler?.(path => addStepByPath(path));
    window.capture?.setAddStepDataUrlHandler?.((dataUrl, nx, ny) => addStepWithImageRef.current(dataUrl, nx, ny));
    window.capture?.log?.('[capture] EditorView registered setAddStepPathHandler').catch(() => {});
    const drainCaptureQueue = async () => {
      if (!window.capture?.getNextCapturePath) return
      let path: string | null
      while ((path = await window.capture.getNextCapturePath()) != null) {
        window.capture?.log?.('[capture] drain from main queue: ' + path).catch(() => {})
        addStepByPath(path)
      }
    }
    const onFocusDrain = () => { drainCaptureQueue() }
    window.addEventListener('focus', onFocusDrain)
    // Poll and drain whenever the timer fires (no focus check - interval may be throttled when backgrounded)
    const pollInterval = setInterval(() => { drainCaptureQueue() }, 500)
    const onCaptureAddStepPath = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (typeof path === "string") addStepByPath(path);
    };
    window.addEventListener("capture-add-step-path", onCaptureAddStepPath);
    const unsubAdd = window.capture.onAddStepWithImage(async (data: { imageDataUrl?: string; imagePath?: string }) => {
      window.capture?.log?.('[capture] onAddStepWithImage IPC received').catch(() => {});
      try {
        let dataUrl: string | null = null
        if (data?.imagePath && window.capture?.readCapturedImage) {
          dataUrl = await window.capture.readCapturedImage(data.imagePath)
        } else if (typeof data?.imageDataUrl === "string" && data.imageDataUrl.length > 0) {
          dataUrl = data.imageDataUrl
        }
        if (dataUrl) addStepWithImageRef.current(dataUrl)
      } catch (err) {
        console.error("[capture] addStepWithImage error:", err)
        setCaptureError(err instanceof Error ? err.message : "Failed to add step")
      }
    });
    const unsubErr = window.capture.onCaptureError?.((message: string) => {
      setCaptureError(message);
    }) ?? (() => {});
    captureUnsubscribeRef.current = () => {
      clearInterval(pollInterval)
      window.removeEventListener('focus', onFocusDrain);
      window.capture?.setAddStepPathHandler?.(null);
      window.capture?.setAddStepDataUrlHandler?.(null);
      window.removeEventListener("capture-add-step-path", onCaptureAddStepPath);
      unsubAdd();
      unsubErr();
    };
  }, []);

  const stopRecording = useCallback(() => {
    captureUnsubscribeRef.current?.();
    captureUnsubscribeRef.current = null;
    window.capture?.stopRecording?.();
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      if (captureUnsubscribeRef.current) {
        captureUnsubscribeRef.current();
        captureUnsubscribeRef.current = null;
      }
      window.capture?.stopRecording?.();
    };
  }, []); // empty: cleanup only on unmount; do not depend on isRecording or we clear handlers when it becomes true

  const save = async () => {
    setSaving(true);
    setSavedJustNow(false);
    try {
      const hadPath = path != null;
      const folder =
        path != null && path.includes("/")
          ? path.replace(/[/\\][^/\\]+$/, "")
          : "";
      const sanitizedTitle =
        sop.title.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled SOP";
      const fileName = `${sanitizedTitle}${SOP_EXT}`;
      const desiredPath = folder ? `${folder}/${fileName}` : fileName;
      const pathToSave = path ?? desiredPath;
      const toSave = {
        ...sop,
        title: sop.title,
        steps: getStepsFromNodes(sop),
      };
      if (path != null && desiredPath !== path) {
        await window.storage.saveSOP(desiredPath, toSave);
        await window.storage.deleteSOP(path);
        setPath(desiredPath);
        onSOPSaved?.(desiredPath);
      } else {
        await window.storage.saveSOP(pathToSave, toSave);
        setPath(pathToSave);
        if (!hadPath) onSOPSaved?.(pathToSave);
      }
      setSavedJustNow(true);
      setTimeout(() => setSavedJustNow(false), 2500);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const exportPDF = async () => {
    setExporting(true);
    setShowPrintView(true);
  };

  const exportWord = async () => {
    setExporting(true);
    setExportMenuOpen(false);
    try {
      const buffer = await exportDocx(sop);
      const defaultName = `${sop.title.replace(/[/\\?%*:|"<>]/g, "-")}.docx`;
      const filePath = await window.dialogApi.showSaveDialogFiltered(defaultName, [
        { name: "Word Document", extensions: ["docx"] },
      ]);
      if (filePath) {
        await window.pdfApi.write(filePath, buffer);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to export Word document.");
    } finally {
      setExporting(false);
    }
  };

  saveRef.current = save;
  exportRef.current = exportPDF;

  useEffect(() => {
    onSOPChange?.(sop);
  }, [sop, onSOPChange]);

  // Focus title when opening a new (unsaved) SOP so user can type the name immediately
  useEffect(() => {
    if (initialPath != null) return;
    const t = setTimeout(() => {
      titleRef.current?.focus();
    }, 150);
    return () => clearTimeout(t);
  }, [initialPath]);

  const initialMount = useRef(true);
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    // Don't auto-save new (unsaved) docs — user must press Enter in title or click Save
    if (path == null) return;
    const t = setTimeout(() => {
      saveRef.current?.();
    }, 800);
    return () => clearTimeout(t);
  }, [sop, path]);

  useEffect(() => {
    if (!showPrintView) return;
    const run = async () => {
      await new Promise((r) => setTimeout(r, 150));
      const el = printRef.current;
      if (!el) {
        setExporting(false);
        setShowPrintView(false);
        return;
      }
      try {
        const config =
          typeof window !== "undefined" && window.config?.get
            ? await window.config.get()
            : { brandColors: {} };
        const cfg = config as {
          brandColors?: { primary?: string; accent?: string };
          stepBackgroundColor?: string;
          stepNumberIconBgColor?: string;
        };
        const colors = cfg?.brandColors ?? {};
        const exportStepBg = cfg?.stepBackgroundColor ?? "#f7f7f7";
        const exportStepIconBg = cfg?.stepNumberIconBgColor ?? "#ffffff";
        setBrandColors(colors);
        setStepBackgroundColor(exportStepBg);
        setStepNumberIconBgColor(exportStepIconBg);
        const logo = await window.config.getBrandLogo();
        setBrandLogoUrl(logo);
        await new Promise((r) => setTimeout(r, 50));
        const imgs = el.querySelectorAll("img");
        await Promise.all(
          Array.from(imgs).map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete && img.naturalWidth) return resolve();
                img.onload = () => resolve();
                img.onerror = () => resolve();
                setTimeout(resolve, 3000);
              }),
          ),
        );
        await new Promise((r) => setTimeout(r, 200));
        (document.activeElement as HTMLElement)?.blur?.();
        const containerRect = el.getBoundingClientRect();
        // Full card/tip rects for node-aware page breaks (steps + tips)
        const nodeItems = el.querySelectorAll("[data-node-item]");
        const stepRects = Array.from(nodeItems).map((card) => {
          const r = card.getBoundingClientRect();
          const top = r.top - containerRect.top + (el.scrollTop || 0);
          return { top, bottom: top + r.height, height: r.height };
        });
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }
        const canvas = await html2canvas(el, {
          scale: 5,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
          imageTimeout: 0,
          windowWidth: el.scrollWidth,
          windowHeight: el.scrollHeight,
        });
        // A4 in mm (for layout math) and in points (for pdf-lib)
        const pdfWmm = 210;
        const pdfHmm = 297;
        const pdfWpt = 595.28;
        const pdfHpt = 841.89;
        const marginTopMm = 15;
        const marginBottomMm = 15;
        const effectivePdfH = pdfHmm - marginTopMm - marginBottomMm;
        const pageHeightInCanvasPx = canvas.width * (effectivePdfH / pdfWmm);

        // Convert step rects to canvas Y coordinates
        const scrollHeight = el.scrollHeight || 1;
        const stepTopCanvas = stepRects.map(
          (r) => (r.top / scrollHeight) * canvas.height,
        );
        const stepBottomCanvas = stepRects.map(
          (r) => (r.bottom / scrollHeight) * canvas.height,
        );

        // Build page breaks: never split a node (move whole node to next page if it doesn't fit).
        // If a node is taller than one page, allow it to span multiple pages (add full-page breaks inside it).
        // Use a small buffer (canvas px) when breaking at a node top so the next page slice includes the
        // node's top edge (avoids 1-2 px cut-off from rounding or border/shadow).
        // Page 1 has no top margin (contentY=0), so it can hold more content than subsequent pages.
        const stepTopBufferPx = 4;
        const marginTopCanvasPx =
          (marginTopMm / pdfHmm) * (canvas.width * (pdfHmm / pdfWmm));
        const page1Height = pageHeightInCanvasPx + marginTopCanvasPx;
        const breaks: number[] = [0];
        let currentBreak = 0;
        for (let i = 0; i < stepTopCanvas.length; i++) {
          const stop = stepTopCanvas[i]!;
          const sbot = stepBottomCanvas[i]!;
          const stepHeight = sbot - stop;
          const currentPageHeight =
            breaks.length === 1 ? page1Height : pageHeightInCanvasPx;
          const pageBottom = currentBreak + currentPageHeight;
          if (sbot <= pageBottom) {
            // Node fits entirely on current page; no new break needed.
            continue;
          }
          if (stepHeight <= pageHeightInCanvasPx) {
            // Whole node should move to the next page so it is not split.
            const breakAt = Math.max(0, stop - stepTopBufferPx);
            breaks.push(breakAt);
            currentBreak = breakAt;
          } else {
            // Node is taller than a page: end current page before this node (if needed),
            // then add full-page breaks inside the node.
            if (stop > currentBreak) {
              const breakAt = Math.max(currentBreak, stop - stepTopBufferPx);
              breaks.push(breakAt);
              currentBreak = breakAt;
            }
            while (currentBreak + pageHeightInCanvasPx < sbot) {
              currentBreak += pageHeightInCanvasPx;
              breaks.push(currentBreak);
            }
          }
        }
        breaks.push(canvas.height);
        const numPages = breaks.length - 1;

        // Full page size in canvas pixels (same aspect as A4)
        const fullPageHeightPx = canvas.width * (pdfHmm / pdfWmm);
        const marginTopPx = (marginTopMm / pdfHmm) * fullPageHeightPx;

        const pageImages: string[] = [];
        for (let p = 0; p < numPages; p++) {
          const sy = breaks[p]!;
          const sliceH = breaks[p + 1]! - sy;
          // Create a full-page canvas: fill with white, draw content (top margin only on pages after the first)
          const fullPageCanvas = document.createElement("canvas");
          fullPageCanvas.width = canvas.width;
          fullPageCanvas.height = fullPageHeightPx;
          const pctx = fullPageCanvas.getContext("2d")!;
          pctx.fillStyle = "#ffffff";
          pctx.fillRect(0, 0, fullPageCanvas.width, fullPageCanvas.height);
          const contentY = p === 0 ? 0 : marginTopPx;
          pctx.drawImage(
            canvas,
            0,
            sy,
            canvas.width,
            sliceH,
            0,
            contentY,
            canvas.width,
            sliceH,
          );
          pageImages.push(fullPageCanvas.toDataURL("image/jpeg", 0.98));
        }

        const pdfDoc = await PDFDocument.create();
        for (let p = 0; p < pageImages.length; p++) {
          const page = pdfDoc.addPage([pdfWpt, pdfHpt]);
          const dataUrl = pageImages[p]!;
          const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
          const image = await pdfDoc.embedJpg(bytes);
          page.drawImage(image, { x: 0, y: 0, width: pdfWpt, height: pdfHpt });
        }
        const pdfBytes = await pdfDoc.save();
        const arrayBuffer = pdfBytes.buffer.slice(
          pdfBytes.byteOffset,
          pdfBytes.byteOffset + pdfBytes.byteLength,
        );

        const defaultName = `${sop.title.replace(/[/\\?%*:|"<>]/g, "-")}.pdf`;
        const filePath = await window.dialogApi.showSaveDialog(defaultName);
        if (filePath) {
          await window.pdfApi.write(filePath, arrayBuffer as ArrayBuffer);
        }
      } catch (e) {
        console.error(e);
        const anyErr = e as any;
        const code = anyErr?.code;
        if (code === "EBUSY") {
          alert(
            "Couldn't overwrite the PDF because it is currently open. Close it in your PDF viewer or Explorer, then export again.",
          );
        } else {
          alert(
            "Couldn't overwrite the PDF because it is currently open. Close it in your PDF viewer or Explorer, then export again.",
          );
        }
      } finally {
        setShowPrintView(false);
        setExporting(false);
      }
    };
    run();
  }, [showPrintView]);

  const handleDrop = (e: React.DragEvent, index?: number) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    const nodes = getInstructionNodes(sop);
    const insertIndex = index ?? nodes.length;
    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = () => {
        const imageUrl = reader.result as string;
        const newStep = createStep();
        newStep.imageUrl = imageUrl;
        newStep.title =
          file.name.replace(/\.[^.]+$/, "") || `Step ${insertIndex + i + 1}`;
        updateSOP((d) => {
          const n = getInstructionNodes(d);
          d.nodes = [
            ...n.slice(0, insertIndex + i),
            newStep,
            ...n.slice(insertIndex + i),
          ];
          d.steps = getStepsFromNodes(d);
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const pasteImageFromClipboard = useCallback(
    (clipboardData: DataTransfer) => {
      const items = clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              const newStep = createStep();
              newStep.imageUrl = reader.result as string;
              newStep.title = `Pasted image`;
              updateSOP((d) => {
                d.nodes = [...getInstructionNodes(d), newStep];
                d.steps = getStepsFromNodes(d);
              });
            };
            reader.readAsDataURL(file);
          }
          return;
        }
      }
    },
    [updateSOP],
  );

  const pasteImageIntoStepFromClipboard = useCallback(
    (
      clipboardData: DataTransfer,
      nodeIndex: number,
      position: PastePosition,
    ) => {
      const items = clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              setStepImages(nodeIndex, reader.result as string, position);
            };
            reader.readAsDataURL(file);
          }
          return;
        }
      }
    },
    [setStepImages],
  );

  useEffect(() => {
    pasteTargetIndexRef.current = pasteTargetIndex;
    pasteTargetAppendRef.current = pasteTargetAppend;
  }, [pasteTargetIndex, pasteTargetAppend]);

  useEffect(() => {
    sopRef.current = sop;
  }, [sop]);

  useEffect(() => {
    const onDocPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          hasImage = true;
          break;
        }
      }
      if (!hasImage) return;

      const target = e.target as HTMLElement;
      const inInput =
        target?.closest?.("input, textarea") || target?.isContentEditable;

      // Resolve paste target: refs (from hover) first, then fallback from focused element (e.g. clicked plus or drop area)
      let index: number | null = pasteTargetIndexRef.current;
      let position: PastePosition = pasteTargetAppendRef.current;
      if (index == null && target?.closest) {
        const stepEl = target.closest("[data-step-index]");
        if (stepEl) {
          const idx = parseInt(
            stepEl.getAttribute("data-step-index") ?? "",
            10,
          );
          if (!Number.isNaN(idx)) {
            index = idx;
            const pos = stepEl.getAttribute(
              "data-paste-position",
            ) as PastePosition | null;
            position =
              pos === "left" ||
              pos === "right" ||
              pos === "above" ||
              pos === "below"
                ? pos
                : false;
          }
        }
      }
      const hasStepTarget = index !== null;

      if (inInput && !hasStepTarget) return;

      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now - lastPasteHandledAt.current < 150) return;
      lastPasteHandledAt.current = now;

      if (index !== null) {
        const nodes = getInstructionNodes(sopRef.current);
        const node = nodes[index];
        if (node?.type === "step") {
          pasteImageIntoStepFromClipboard(e.clipboardData, index, position);
        } else {
          pasteImageFromClipboard(e.clipboardData);
        }
      } else {
        pasteImageFromClipboard(e.clipboardData);
      }
    };
    document.addEventListener("paste", onDocPaste, true);
    return () => document.removeEventListener("paste", onDocPaste, true);
  }, [pasteImageFromClipboard, pasteImageIntoStepFromClipboard]);

  const readClipboardImageAndAddStep = useCallback(async () => {
    try {
      const dataUrl =
        typeof window !== "undefined" && window.clipboardApi?.readImage
          ? await window.clipboardApi.readImage()
          : null;
      if (dataUrl) {
        const newStep = createStep();
        newStep.imageUrl = dataUrl;
        newStep.title = "Pasted image";
        updateSOP((d) => {
          d.nodes = [...getInstructionNodes(d), newStep];
          d.steps = getStepsFromNodes(d);
        });
      }
    } catch (_) {
      // Clipboard read failed
    }
  }, [updateSOP]);

  const readClipboardImageAtPosition = useCallback(
    async (insertIndex: number) => {
      try {
        const dataUrl =
          typeof window !== "undefined" && window.clipboardApi?.readImage
            ? await window.clipboardApi.readImage()
            : null;
        if (dataUrl) {
          const newStep = createStep();
          newStep.imageUrl = dataUrl;
          newStep.title = "Pasted image";
          insertNodeAtIndex(insertIndex, newStep);
        }
      } catch (_) {
        // Clipboard read failed
      }
    },
    [insertNodeAtIndex],
  );

  const pasteImageIntoStepAtIndex = useCallback(
    async (nodeIndex: number, position: PastePosition) => {
      try {
        const dataUrl =
          typeof window !== "undefined" && window.clipboardApi?.readImage
            ? await window.clipboardApi.readImage()
            : null;
        if (dataUrl) {
          setStepImages(nodeIndex, dataUrl, position);
        }
      } catch (_) {
        // Clipboard read failed
      }
    },
    [setStepImages],
  );

  const handleAddImageFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nodeIndex = addImageTargetIndex;
      const position = addImageTargetPosition;
      setAddImageTargetIndex(null);
      const files = e.target.files;
      if (nodeIndex == null || !files?.length) return;
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      const nodes = getInstructionNodes(sop);
      const step = nodes[nodeIndex];
      const hadImages =
        step && isStepNode(step)
          ? getStepImageRows(step).flat().length > 0
          : false;
      imageFiles.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = () => {
          setStepImages(
            nodeIndex,
            reader.result as string,
            hadImages || i > 0 ? position : false,
          );
        };
        reader.readAsDataURL(file);
      });
      e.target.value = "";
    },
    [addImageTargetIndex, addImageTargetPosition, sop, setStepImages],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close, true);
    window.addEventListener("contextmenu", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close, true);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const handleClearAll = () => {
    const nodes = getInstructionNodes(sop);
    if (nodes.length === 0) return;
    if (
      window.confirm("Delete all steps and content? This cannot be undone.")
    ) {
      updateSOP((d) => {
        d.nodes = [];
        d.steps = [];
      });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const nodes = getInstructionNodes(sop);
      const oldIndex = nodes.findIndex((n) => n.id === active.id);
      const newIndex = nodes.findIndex((n) => n.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      pushUndoPast(sop);
      setSop((prev) => {
        const n = getInstructionNodes(prev);
        const next = { ...prev, updatedAt: new Date().toISOString() };
        next.nodes = arrayMove(n, oldIndex, newIndex);
        next.steps = getStepsFromNodes(next);
        return next;
      });
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  return (
    <div className="p-6 max-w-4xl mx-auto min-h-[400px]">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0 mt-1">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <Textarea
              ref={titleRef}
              value={sop.title}
              onChange={(e) =>
                updateSOP((d) => {
                  d.title = e.target.value;
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              onBlur={() => {
                if (path != null) save();
              }}
              placeholder="SOP title"
              rows={1}
              autoFocus={initialPath == null}
              className="min-h-[2.5rem] resize-none overflow-hidden text-xl font-semibold border-0 bg-transparent shadow-none focus-visible:ring-0 min-w-0 flex-1 py-2"
            />
            <Textarea
              ref={subtitleRef}
              value={sop.subtitle ?? ""}
              onChange={(e) =>
                updateSOP((d) => {
                  d.subtitle = e.target.value || undefined;
                })
              }
              placeholder="Add a subtitle..."
              rows={1}
              className="min-h-[2rem] resize-none overflow-hidden text-base font-normal text-muted-foreground border-0 bg-transparent shadow-none focus-visible:ring-0 py-1"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!isRecording ? (
            <Button
              variant="outline"
              size="icon"
              className="gap-1.5 rounded-full"
              onClick={startRecording}
              disabled={!window.capture?.startRecording}
              title="Record mode">
              <Circle className="h-4 w-4 text-red-600" fill="currentColor" />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
              onClick={stopRecording}
              title="Stop recording">
              <Square className="h-4 w-4" />
            </Button>
          )}
          {captureError && (
            <span className="text-xs text-destructive max-w-[200px]" title={captureError}>
              {captureError}
            </span>
          )}
          <div className="relative" ref={exportMenuRef}>
            <Button
              variant="outline"
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={exporting}
              className="min-w-[7.5rem] gap-1.5">
              <Download className="h-4 w-4" />
              {exporting ? "Exporting..." : "Export"}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
            {exportMenuOpen && !exporting && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[10rem] rounded-md border bg-popover p-1 shadow-md">
                <button
                  className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground"
                  onClick={() => { setExportMenuOpen(false); exportPDF(); }}>
                  PDF
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground"
                  onClick={exportWord}>
                  Word (.docx)
                </button>
              </div>
            )}
          </div>
          <Button
            variant="outline"
            onClick={handleClearAll}
            disabled={getInstructionNodes(sop).length === 0}
            className="text-destructive hover:text-destructive hover:bg-destructive/10">
            Clear
          </Button>
          <Button onClick={save} disabled={saving} className="min-w-[5.5rem]">
            {saving ? "Saving..." : savedJustNow ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      {/* Print view for PDF export - off-screen so html2canvas gets full dimensions */}
      {showPrintView && (
        <div
          ref={printRef}
          className="fixed -left-[9999px] top-0 w-[210mm] bg-white"
          style={{
            overflow: "visible",
            caretColor: "transparent",
            backgroundColor: "#FFFFFF",
          }}
          aria-hidden
          tabIndex={-1}>
          <SOPPrintView
            sop={sop}
            brandColors={brandColors}
            stepBackgroundColor={stepBackgroundColor}
            stepNumberIconBgColor={stepNumberIconBgColor}
            brandLogoUrl={brandLogoUrl}
          />
        </div>
      )}

      <div
        className="space-y-4"
        dir={sop.dir || 'ltr'}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleDrop(e)}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}>
          <SortableContext items={getInstructionNodes(sop).map((n) => n.id)}>
            <div className="space-y-4">
              {(() => {
                const allNodes = getInstructionNodes(sop);
                const stepLabels = computeStepLabels(allNodes);
                return allNodes.map((node, nodeIndex) => {
                const stepIndex = allNodes
                  .slice(0, nodeIndex)
                  .filter(isStepNode).length;
                return (
                  <div key={node.id} className="space-y-4">
                    {node.type === "step" ? (
                      <SortableStepCard
                        step={node}
                        index={stepIndex}
                        nodeIndex={nodeIndex}
                        imageRows={getStepImageRows(node)}
                        onUpdate={(patch) => updateStep(nodeIndex, patch)}
                        onRemove={() => removeNodeAtIndex(nodeIndex)}
                        onDropImage={(imageUrl, append) =>
                          setStepImages(
                            nodeIndex,
                            imageUrl,
                            append ? "right" : false,
                          )
                        }
                        stepBackgroundColor={stepBackgroundColor}
                        stepNumberIconBgColor={stepNumberIconBgColor}
                        isPasteTarget={pasteTargetIndex === nodeIndex}
                        isPlusPasteTarget={
                          pasteTargetIndex === nodeIndex && !!pasteTargetAppend
                        }
                        activePastePosition={
                          pasteTargetIndex === nodeIndex
                            ? pasteTargetAppend
                            : undefined
                        }
                        onPasteTargetEnter={(position) => {
                          setPasteTargetIndex(nodeIndex);
                          setPasteTargetAppend(position);
                          pasteTargetIndexRef.current = nodeIndex;
                          pasteTargetAppendRef.current = position;
                        }}
                        onPasteTargetLeave={() => {
                          setPasteTargetIndex(null);
                          pasteTargetIndexRef.current = null;
                        }}
                        onAddImageClick={(position) => {
                          setAddImageTargetIndex(nodeIndex);
                          setAddImageTargetPosition(position ?? "right");
                          setTimeout(() => fileInputRef.current?.click(), 0);
                        }}
                        onOpenPasteMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            onPasteImage: () =>
                              pasteImageIntoStepAtIndex(nodeIndex, false),
                          });
                        }}
                        onAddStepAfter={() => addStepAfterNode(nodeIndex)}
                        onCropImage={(imageIndex) => {
                          const images = getStepImages(node);
                          if (images[imageIndex]) {
                            setCropImage({ nodeIndex, imageIndex, url: images[imageIndex] });
                          }
                        }}
                        stepLabel={stepLabels.get(node.id)}
                        indent={node.indent ?? 0}
                        onIndent={() => {
                          updateNode(nodeIndex, { indent: Math.min((node.indent ?? 0) + 1, 3) });
                        }}
                        onOutdent={() => {
                          updateNode(nodeIndex, { indent: Math.max((node.indent ?? 0) - 1, 0) });
                        }}
                      />
                    ) : node.type === "tip" ? (
                      <SortableTipCard
                        node={node}
                        onUpdate={(patch) => updateNode(nodeIndex, patch)}
                        onRemove={() => removeNodeAtIndex(nodeIndex)}
                      />
                    ) : null}
                    <div
                      className="flex items-center justify-center w-full h-11 rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 hover:bg-muted/30 transition-colors"
                      onMouseEnter={() => setHoveredInsertAt(nodeIndex + 1)}
                      onMouseLeave={() => setHoveredInsertAt(null)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          onPasteImage: () =>
                            readClipboardImageAtPosition(nodeIndex + 1),
                        });
                      }}
                      title="+ Step or tip (hover to choose)">
                      {hoveredInsertAt === nodeIndex + 1 ? (
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-8"
                            onClick={() => {
                              insertNodeAtIndex(nodeIndex + 1, createStep());
                              setHoveredInsertAt(null);
                            }}>
                            <Plus className="h-3.5 w-3.5" />
                            Step
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-8"
                            onClick={() => {
                              insertNodeAtIndex(nodeIndex + 1, createTipNode());
                              setHoveredInsertAt(null);
                            }}>
                            <Plus className="h-3.5 w-3.5" />
                            Tip
                          </Button>
                        </div>
                      ) : (
                        <Plus className="h-5 w-5" />
                      )}
                    </div>
                  </div>
                );
              });
              })()}
            </div>
          </SortableContext>
        </DndContext>

        {getInstructionNodes(sop).length === 0 && (
          <div
            className="flex items-center justify-center w-full h-11 rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 hover:bg-muted/30 transition-colors cursor-pointer"
            onMouseEnter={() => setHoveredInsertAt(0)}
            onMouseLeave={() => setHoveredInsertAt(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, 0)}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              addStep();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                onPasteImage: readClipboardImageAndAddStep,
              });
            }}
            title="+ Step or tip (hover to choose)">
            {hoveredInsertAt === 0 ? (
              <div
                className="flex items-center justify-center gap-2"
                onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1 h-8"
                  onClick={() => {
                    insertNodeAtIndex(0, createStep());
                    setHoveredInsertAt(null);
                  }}>
                  <Plus className="h-3.5 w-3.5" />
                  Step
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-8"
                  onClick={() => {
                    insertNodeAtIndex(0, createTipNode());
                    setHoveredInsertAt(null);
                  }}>
                  <Plus className="h-3.5 w-3.5" />
                  Tip
                </Button>
              </div>
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            type="button"
            className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
            onClick={(e) => {
              e.stopPropagation();
              const fn = contextMenu.onPasteImage;
              setContextMenu(null);
              fn();
            }}>
            Paste image
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleAddImageFileChange}
      />
      {cropImage && (
        <ImageCropDialog
          open
          imageUrl={cropImage.url}
          onSave={(croppedUrl) => {
            updateSOP((d) => {
              const nodes = getInstructionNodes(d);
              const node = nodes[cropImage.nodeIndex];
              if (node?.type === "step") {
                const images = getStepImages(node);
                images[cropImage.imageIndex] = croppedUrl;
                node.imageUrl = images[0] || "";
                node.imageUrls = [...images];
                node.imageRows = [images];
              }
              d.nodes = nodes;
              d.steps = getStepsFromNodes(d);
            });
            setCropImage(null);
          }}
          onCancel={() => setCropImage(null)}
        />
      )}
    </div>
  );
}
