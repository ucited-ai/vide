import { MessageCircle, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

/**
 * The annotation floats over the code, which now shares the pane's surface, so
 * it has to step up the ladder to stay a separate object.
 */
const ANNOTATION_CARD_CLASS =
  "mx-3 my-2 rounded-(--radius) border border-border bg-(--surface-raised-1) p-3";

interface LocalCommentAnnotationProps {
  kind: "draft" | "comment";
  rangeLabel: string;
  text: string;
  onCancel: () => void;
  onComment: (text: string) => void;
  onDelete: () => void;
}

export function LocalCommentAnnotation({
  kind,
  rangeLabel,
  text: savedText,
  onCancel,
  onComment,
  onDelete,
}: LocalCommentAnnotationProps) {
  const [text, setText] = useState("");

  if (kind === "comment") {
    return (
      <div
        data-file-comment-annotation
        className={cn(ANNOTATION_CARD_CLASS, "shadow-sm")}
        contentEditable={false}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-muted-foreground" />
          <span className="text-(length:--text-ui) font-medium">Local comment</span>
          <span className="ml-auto text-(length:--text-caption) text-muted-foreground">
            {rangeLabel}
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Delete comment" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-(length:--text-chat) leading-relaxed text-foreground">
          {savedText}
        </p>
      </div>
    );
  }

  return (
    <div
      data-file-comment-annotation
      className={cn(ANNOTATION_CARD_CLASS, "shadow-lg")}
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <MessageCircle className="size-4 text-muted-foreground" />
        <span className="text-(length:--text-ui) font-medium">Local comment</span>
      </div>
      <div className="mt-1 text-(length:--text-caption) text-muted-foreground">
        Comment on lines {rangeLabel}
      </div>
      <Textarea
        autoFocus
        className="mt-3"
        size="sm"
        value={text}
        placeholder="Request change"
        aria-label={`Comment on lines ${rangeLabel}`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && text.trim()) {
            event.preventDefault();
            onComment(text.trim());
          }
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!text.trim()} onClick={() => onComment(text.trim())}>
          Comment
        </Button>
      </div>
    </div>
  );
}
