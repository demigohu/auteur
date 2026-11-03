/** Rows for items that overlap in time, so none hides another on the timeline: each item takes the
 * first row that is free at its start. `spans` may be in any order; rows are returned in the same order. */
export function packLanes(spans: [number, number][]): number[] {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a][0] - spans[b][0] || a - b);
  const rowEnds: number[] = [];
  const lanes = new Array<number>(spans.length);
  for (const i of order) {
    const [start, end] = spans[i];
    let row = rowEnds.findIndex((e) => e <= start + 1e-3);
    if (row === -1) row = rowEnds.push(0) - 1;
    rowEnds[row] = end;
    lanes[i] = row;
  }
  return lanes;
}

export const laneCount = (lanes: number[]) => Math.max(1, ...lanes.map((l) => l + 1));
