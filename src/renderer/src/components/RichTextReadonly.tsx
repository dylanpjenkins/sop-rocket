import { generateHTML } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useMemo } from "react";

interface RichTextReadonlyProps {
  content: string;
  className?: string;
}

const extensions = [
  StarterKit.configure({
    heading: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
  }),
  Link.configure({
    openOnClick: false,
  }),
];

export function RichTextReadonly({
  content,
  className = "",
}: RichTextReadonlyProps) {
  const html = useMemo(() => {
    try {
      const json = JSON.parse(content);
      return generateHTML(json, extensions);
    } catch {
      return "";
    }
  }, [content]);

  if (!html || html === "<p></p>") return null;

  return (
    <div
      className={`prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-primary [&_a]:underline text-sm ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
