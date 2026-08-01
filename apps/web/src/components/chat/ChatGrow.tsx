import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The one thing in a turn that opens.
 *
 * A grid row eased from `0fr` to `1fr`, which is how a box can be transitioned to
 * a height nobody measured: the content states how tall it is and the transition
 * still runs. Every disclosure in a turn is this component — a tool group's
 * calls, the changed files, a file's diff — so opening one thing feels like
 * opening any other, and there is one duration to tune rather than four.
 *
 * The content is kept mounted once it has been opened, because a collapse needs
 * something to collapse. It is not mounted before that: a diff nobody has asked
 * for should not be parsed and highlighted on the chance that they will.
 */
export function ChatGrow({
  open,
  className,
  children,
}: {
  readonly open: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const [hasOpened, setHasOpened] = useState(open);
  if (open && !hasOpened) {
    setHasOpened(true);
  }

  return (
    <div className={cn("chat-grow", className)} data-open={open ? "true" : "false"}>
      <div className="chat-grow-clip">{hasOpened ? children : null}</div>
    </div>
  );
}
