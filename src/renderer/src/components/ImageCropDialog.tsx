import { useState, useRef, useCallback } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ImageCropDialogProps {
  imageUrl: string;
  open: boolean;
  onSave: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

function getCroppedCanvas(
  image: HTMLImageElement,
  crop: PixelCrop,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  canvas.width = Math.floor(crop.width * scaleX);
  canvas.height = Math.floor(crop.height * scaleY);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

export function ImageCropDialog({
  imageUrl,
  open,
  onSave,
  onCancel,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);

  const handleSave = useCallback(() => {
    if (!completedCrop || !imgRef.current) return;
    const canvas = getCroppedCanvas(imgRef.current, completedCrop);
    onSave(canvas.toDataURL("image/png"));
  }, [completedCrop, onSave]);

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle>Crop Image</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="flex-1 overflow-auto flex items-center justify-center min-h-0">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}>
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop preview"
              style={{ maxHeight: "60vh", maxWidth: "100%" }}
            />
          </ReactCrop>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSave}
            disabled={
              !completedCrop || completedCrop.width < 1 || completedCrop.height < 1
            }>
            Crop &amp; Save
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
