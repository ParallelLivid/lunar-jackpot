/**
 * The casino floor and the litterbox, in one cell of the dashboard grid. One
 * area rather than two rows: it makes the machine panel beside them exactly as
 * tall as the pair by construction, since a collapsed row still costs a row gap,
 * and it confines the shelf to this column so a hundred cats cannot shorten the
 * expedition panel.
 *
 * The split within the column is `useLitterboxRows`: the floor asks for what it
 * needs and the shelf takes what is left, down to one row.
 */

import { CasinoFloor } from "../casino/CasinoFloor";
import { CatBox } from "../cats/CatBox";
import { useLitterboxRows } from "./useLitterboxRows";

export function CasinoColumn({ onRename }: { onRename: () => void }) {
  const { columnRef, maximumRows } = useLitterboxRows();

  return (
    <div className="casino-column" ref={columnRef}>
      <CasinoFloor onRename={onRename} />
      <CatBox maximumRows={maximumRows} />
    </div>
  );
}
