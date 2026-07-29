/**
 * The Vide mark above the draft headline.
 *
 * Same geometry as assets/brand/vide-mark.svg, cropped to the glyph and drawn
 * in currentColor so it takes its weight from the surrounding text rather than
 * competing with it. The empty screen is the one place the brand appears at
 * size, so it stays quiet: a mark, not a logo lockup.
 */
export function DraftHeroMark() {
  return (
    <div className="mb-5 flex justify-center" aria-hidden="true">
      <svg
        className="h-9 w-9 text-muted-foreground/35"
        viewBox="301 331 422 362"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M 349 379 L 512 645 L 675 379"
          fill="none"
          stroke="currentColor"
          strokeWidth="82"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
