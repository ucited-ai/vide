import { type ApprovalRequestId } from "@vide/contracts";
import { memo, useEffect, useEffectEvent, useRef, useState } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Kbd } from "../ui/kbd";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const onAdvanceRef = useRef(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionLabel: string;
  } | null>(null);

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    if (!activeQuestion || activeQuestion.multiSelect || !optimisticSingleSelect) {
      return;
    }
    if (optimisticSingleSelect.questionId !== activeQuestion.id) {
      setOptimisticSingleSelect(null);
      return;
    }
    if (
      progress.customAnswer.trim().length === 0 &&
      progress.selectedOptionLabels.includes(optimisticSingleSelect.optionLabel)
    ) {
      setOptimisticSingleSelect(null);
    }
  }, [
    activeQuestion,
    optimisticSingleSelect,
    progress.customAnswer,
    progress.selectedOptionLabels,
  ]);

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const handleOptionSelection = useEffectEvent((questionId: string, optionLabel: string) => {
    if (activeQuestion?.multiSelect) {
      onToggleOption(questionId, optionLabel);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionLabel });
    onToggleOption(questionId, optionLabel);
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      onAdvanceRef.current();
    }, 200);
  });

  // Keyboard shortcut: number keys 1-9 select corresponding options when focus is
  // outside editable fields. Multi-select prompts toggle options in place; single-
  // select prompts keep the existing auto-advance behavior.
  useEffect(() => {
    if (!activeQuestion || isResponding) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      handleOptionSelection(activeQuestion.id, option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, isResponding]);

  if (!activeQuestion) {
    return null;
  }

  const customAnswerActive = progress.customAnswer.trim().length > 0;

  /*
   * The question, in the task list's vocabulary.
   *
   * Header caption and count on one baseline, ink by role, selection carried by
   * the ladder's washes. It used to run on ad-hoc alphas — `muted-foreground/55`,
   * `bg-muted/22`, `border-border/45`, `bg-primary/8` — which are not steps on
   * any ladder, and on an uppercase tracked caption that appears nowhere else in
   * the app. `--primary` is `--ink` here, so the "accent" that marked a selected
   * option was already monochrome; it just arrived at its grey by a different
   * route than every other selected row in the app.
   */
  return (
    <div className="px-3 py-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-(length:--text-caption) text-(--ink-tertiary)">
        <span className="min-w-0 truncate">{activeQuestion.header}</span>
        {prompt.questions.length > 1 ? (
          <span className="shrink-0 tabular-nums">
            {questionIndex + 1}/{prompt.questions.length}
          </span>
        ) : null}
      </div>
      <p className="text-(length:--text-ui) text-(--ink)">{activeQuestion.question}</p>
      {activeQuestion.multiSelect ? (
        <p className="mt-1 text-(length:--text-caption) text-(--ink-tertiary)">
          Select one or more options.
        </p>
      ) : null}
      <div className="mt-2.5 space-y-1">
        {activeQuestion.options.map((option, index) => {
          const isOptimisticallySelected =
            optimisticSingleSelect?.questionId === activeQuestion.id &&
            optimisticSingleSelect.optionLabel === option.label;
          const isSelected =
            isOptimisticallySelected ||
            (!customAnswerActive && progress.selectedOptionLabels.includes(option.label));
          const shortcutKey = index < 9 ? index + 1 : null;
          const className = cn(
            "flex w-full items-center gap-2 rounded-(--radius) border px-2 py-1.5 text-left text-(--ink) outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            isSelected
              ? "border-(--edge-strong) bg-(--wash-selected)"
              : "border-(--edge) hover:bg-(--wash-hover)",
            isResponding ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          );
          const content = (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-(length:--text-ui) font-medium">{option.label}</span>
                {option.description && option.description !== option.label ? (
                  <span className="text-(length:--text-caption) text-(--ink-tertiary)">
                    {option.description}
                  </span>
                ) : null}
              </div>
              {isSelected ? (
                <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-(--ink)" />
              ) : shortcutKey !== null ? (
                <Kbd className="shrink-0 tabular-nums">{shortcutKey}</Kbd>
              ) : null}
            </>
          );
          return (
            <button
              key={`${activeQuestion.id}:${option.label}`}
              type="button"
              disabled={isResponding}
              onClick={() => {
                handleOptionSelection(activeQuestion.id, option.label);
              }}
              className={className}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
});
