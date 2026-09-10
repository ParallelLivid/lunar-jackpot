import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { selectCatBoxView, type CatView } from "../../domain/selectors";
import { PixelSprite } from "../shared/PixelSprite";
import { useDerived, useDispatch, useGameState } from "../layout";
import { CAT_GAP, CAT_SPRITE_SIZE, catShelfHeight } from "../layout/useLitterboxRows";
import { Panel } from "../shared/Panel";

/**
 * The litterbox: a panel between the machines and the expedition, appearing only
 * once there is a cat to put in it.
 *
 * The panel is called the Litterbox; the things in it are still cats. The file,
 * the component and every piece of state stay named for the cat, because
 * renaming `catsFound` would reach the save schema, the luck modifier and the
 * developer menu to change a word the player never sees.
 *
 * Every cat is a button, because clicking one changes its skin — saved state
 * rather than a local toggle. That makes an accessible name mandatory: twenty
 * adjacent unnamed buttons are twenty identical stops for anyone on a keyboard.
 */

/**
 * How wide one cat is, for counting columns: 12px of sprite at scale 2, plus the
 * shelf's gap. How many rows is not a constant — that budget comes from
 * `useLitterboxRows`, which measures what the casino floor does not need, and
 * this component decides how much of it the cats actually fill.
 */
const CAT_SIZE = CAT_SPRITE_SIZE + CAT_GAP;

function CatButton({
  cat,
  frame,
  cyclable,
  onCycle,
}: {
  cat: CatView;
  frame: number;
  cyclable: boolean;
  onCycle: () => void;
}) {
  const reducedMotion = useGameState().settings.reducedMotion;

  return (
    <button
      type="button"
      className="cat-box__cat"
      onClick={onCycle}
      disabled={!cyclable}
      aria-label={
        cyclable
          ? `Cat ${String(cat.index + 1)}, ${cat.displayName}. Click to change its look.`
          : `Cat ${String(cat.index + 1)}, ${cat.displayName}.`
      }
    >
      <PixelSprite
        scale={2}
        spriteId={
          !reducedMotion && (frame + cat.index) % 4 === 0 ? cat.flickSpriteId : cat.restSpriteId
        }
      />
    </button>
  );
}

export function CatBox({ maximumRows }: { maximumRows: number }) {
  const derived = useDerived();
  const dispatch = useDispatch();
  const view = selectCatBoxView(derived);
  const reducedMotion = derived.state.settings.reducedMotion;

  const shelfRef = useRef<HTMLDivElement | null>(null);
  // Seeded high rather than at one, so a first paint that escaped the layout
  // effect below would show a full shelf narrowing rather than one cat widening.
  const [columns, setColumns] = useState(64);
  const [frame, setFrame] = useState(0);

  const total = view.cats.length;

  /*
   * Columns are measured, rows are budgeted: the shelf's width decides how many
   * cats fit across it, and `useLitterboxRows` decides how far down it may go.
   *
   * A layout effect, so the measurement lands before paint. The preview pane
   * delivers no `ResizeObserver` callbacks at all, so an effect-only version
   * would show the seeded value there and never correct it.
   */
  useLayoutEffect(() => {
    const shelf = shelfRef.current;

    if (shelf === null) {
      return;
    }

    setColumns(Math.max(1, Math.floor(shelf.clientWidth / CAT_SIZE)));
  });

  useEffect(() => {
    const shelf = shelfRef.current;

    if (shelf === null) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setColumns(Math.max(1, Math.floor(shelf.clientWidth / CAT_SIZE)));
    });

    observer.observe(shelf);

    return () => {
      observer.disconnect();
    };
  }, [total]);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, 900);

    return () => {
      clearInterval(timer);
    };
  }, [reducedMotion]);

  // Nothing to show until the first cat, which is a 1-in-1000 meeting.
  if (total === 0) {
    return null;
  }

  // The shelf takes the rows its cats need or the rows there is room for,
  // whichever is fewer, never fewer than one. The `min` is what makes the panel
  // fall as well as rise: the space it declines goes back to the floor above.
  const rowsWanted = Math.max(1, Math.ceil(total / columns));
  const rows = Math.max(1, Math.min(maximumRows, rowsWanted));
  const capacity = columns * rows;

  // The count only appears when it saves room: showing "+1" while hiding one cat
  // costs the same space and reads as a failure to fit.
  const overflow = total > capacity ? total - capacity + 1 : 0;
  const shown = overflow > 0 ? view.cats.slice(0, capacity - 1) : view.cats;

  return (
    <Panel
      className="panel--cats"
      title="Litterbox"
      // What `act.cat` points at. This panel renders only once there is a cat in
      // it and the act opens only once one has been met, so the anchor and what
      // it outlines arrive together; every other non-rail anchor is always there.
      anchorId="litterbox"
      fit
      actions={
        <>
          {/*
            The count, on the heading row.

            It used to sit in a paragraph under the shelf, along with a sentence
            of flavour and a repeat of the cycling hint each cat already carries
            in its own accessible name. The flavour is bound for the help tab;
            the count is the one thing in that paragraph the player could not
            get anywhere else, so it moves rather than going.
          */}
          <span aria-hidden="true">{total} found</span>
          <span className="sr-only">
            {total} {total === 1 ? "cat" : "cats"} found, each adding permanent luck.
          </span>
        </>
      }
    >
      {/*
        The cap and the count come from one number.

        `.cat-box__shelf` used to carry its own `calc(3 * 24px + 2 * 4px)` beside
        a `MAXIMUM_ROWS = 3` in this file, with a comment saying the two had to
        agree. They agree by construction now: the style is derived from the same
        `rows` the rendered count is.
      */}
      <div
        className="cat-box__shelf"
        ref={shelfRef}
        style={{ maxBlockSize: `${String(catShelfHeight(rows))}px` }}
      >
        {shown.map((cat) => (
          <CatButton
            key={cat.index}
            cat={cat}
            frame={frame}
            cyclable={view.ownedSkinCount > 1}
            onCycle={() => {
              dispatch({ type: "CYCLE_CAT_SKIN", index: cat.index });
            }}
          />
        ))}
        {overflow > 0 ? <span className="cat-box__count">+{overflow}</span> : null}
      </div>

      {/*
        What a cat is *for* — permanent luck — is in the help window's "Cats and
        looks" topic. The count is on the heading row and the cycling hint is on
        every cat's accessible name, so nothing here has to say it twice.

        The skins are sold from the Skins window, next to the miner's, rather
        than from a button here: this panel is the shelf, not the till.
      */}
    </Panel>
  );
}
