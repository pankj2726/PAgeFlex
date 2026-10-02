import { useMemo } from "react";
import { pageMatrix, type PageGeo } from "../../lib/model/coords";
import { useFind } from "../../lib/text/find";

/** Highlights every match on this page (one rectangle per line); the current match is outlined. */
export function FindHighlights({ pageId, geo, zoom, width, height }: { pageId: string; geo: PageGeo; zoom: number; width: number; height: number }) {
  const matches = useFind((s) => s.matches);
  const current = useFind((s) => s.current);
  const mine = useMemo(() => matches.map((m, i) => ({ m, i })).filter(({ m }) => m.pageId === pageId), [matches, pageId]);
  if (!mine.length) return null;
  const mx = pageMatrix(geo, zoom);
  return (
    <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true" data-testid="find-highlights">
      <g transform={`matrix(${mx.join(" ")})`}>
        {mine.map(({ m, i }) =>
          m.rects.map((r, k) => (
            <rect key={`${i}-${k}`} data-match={i} x={r.x - 0.5} y={r.y - 0.5} width={r.w + 1} height={r.h + 1} fill={i === current ? "rgba(249,115,22,0.45)" : "rgba(250,204,21,0.45)"} stroke={i === current ? "#ea580c" : "none"} strokeWidth={1} />
          ))
        )}
      </g>
    </svg>
  );
}
