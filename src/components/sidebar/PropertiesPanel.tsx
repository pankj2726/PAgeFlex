import { useEffect, useRef } from "react";
import { deleteObjects, duplicateObjects, reorderZ, updateObjects } from "../../lib/model/commands";
import { useEditor } from "../../lib/model/docState";
import type { FieldKind, FontFamily, PdfObject } from "../../lib/model/objects";
import { unsupportedChars } from "../../lib/fonts/fontMap";
import { fitHeight } from "../viewer/textLayout";
import { btn, input, Label } from "../ui";
import { cn } from "../../utils/cn";

const NAMES: Record<string, string> = {
  text: "Text box",
  textedit: "Edited text",
  highlight: "Highlight",
  underline: "Underline",
  strike: "Strikethrough",
  draw: "Freehand",
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  image: "Image / signature",
  note: "Sticky note",
  whiteout: "Whiteout",
  redact: "Redaction",
  field: "Form field",
};

const TIPS: Record<string, string> = {
  select: "Click an object to select it. Drag to move, use the handles to resize or rotate. Shift-click selects several.",
  hand: "Drag the page to pan around.",
  edittext: "Click any highlighted piece of existing text to replace it. The old text is covered, not deleted – use Redact to remove it permanently.",
  text: "Click on the page to place a text box, then type in the box below.",
  note: "Click to drop a sticky note, then type its text.",
  highlight: "Drag over text to highlight it.",
  underline: "Drag across text to underline it.",
  strike: "Drag across text to strike it through.",
  draw: "Press and drag to draw freehand.",
  rect: "Drag to draw a rectangle.",
  ellipse: "Drag to draw an ellipse.",
  line: "Drag to draw a line.",
  arrow: "Drag to draw an arrow.",
  eraser: "Click (or drag across) an object to delete it.",
  whiteout: "Drag a box to cover content with a solid colour. Covered content is still in the file – use Redact for sensitive data.",
  redact: "Drag boxes over sensitive content. On download the page is rebuilt so the covered text and images are removed.",
  field: "Drag a box to add a form field, then choose its type here.",
};

export function PropertiesPanel() {
  const doc = useEditor((s) => s.doc)!;
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const st = useEditor.getState;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const objs = doc.objects.filter((o) => selection.includes(o.id));
  const o = objs.length === 1 ? objs[0] : undefined;

  useEffect(() => {
    const f = () => {
      taRef.current?.focus();
      taRef.current?.select();
    };
    window.addEventListener("qf-focus-text", f);
    return () => window.removeEventListener("qf-focus-text", f);
  }, []);

  if (!objs.length) {
    return (
      <div className="p-4 text-sm text-slate-600 dark:text-slate-300">
        <h3 className="mb-2 font-semibold">Properties</h3>
        <p>{TIPS[tool] ?? "Pick a tool from the toolbar."}</p>
        <p className="mt-3 text-xs text-slate-500">Shortcuts: V select · T text · H hand · E edit text · Ctrl+Z undo · Ctrl+Shift+Z redo · Delete remove · Ctrl+D duplicate</p>
      </div>
    );
  }

  const ids = objs.map((x) => x.id);
  /** live=true coalesces many changes (typing, dragging a slider) into a single undo step. */
  const patch = (p: Partial<PdfObject>, live = false) => {
    if (live) {
      st().liveUpdate((d) => ({
        ...d,
        objects: d.objects.map((x) => {
          if (!ids.includes(x.id)) return x;
          const next = { ...x, ...p };
          return next.type === "text" && ("text" in p || "fontSize" in p || "family" in p || "bold" in p || "italic" in p) ? { ...next, h: Math.max(x.h > fitHeight(x) + 40 ? x.h : 0, fitHeight(next)) } : next;
        }),
      }));
    } else {
      const n = { ...(o ?? {}), ...p } as PdfObject;
      st().exec(updateObjects(ids, o?.type === "text" && ("fontSize" in p || "family" in p || "bold" in p || "italic" in p) ? { ...p, h: fitHeight(n) } : p));
    }
  };
  const liveProps = { onFocus: () => st().beginGesture(), onBlur: () => st().endGesture("Edit properties") };
  const type = o?.type;
  const missing = o && (o.type === "text" || o.type === "textedit") ? unsupportedChars(o.text ?? "") : [];
  const hasStroke = type && ["rect", "ellipse", "line", "arrow", "draw", "underline", "strike"].includes(type);
  const hasFill = type === "rect" || type === "ellipse";

  return (
    <div className="space-y-3 p-4 text-sm">
      <h3 className="font-semibold">{o ? NAMES[o.type] : `${objs.length} objects selected`}</h3>

      {o && (o.type === "text" || o.type === "textedit" || o.type === "note") && (
        <div>
          <Label>{o.type === "note" ? "Note text" : "Text"}</Label>
          <textarea ref={taRef} className={cn(input, "min-h-24 font-mono")} value={o.text ?? ""} {...liveProps} onChange={(e) => patch({ text: e.target.value }, true)} aria-label="Object text" />
          {o.type === "textedit" && (
            <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
              <span className="truncate">Original: “{o.origText}”</span>
              <button className="text-indigo-600 underline" onClick={() => patch({ text: o.origText })}>
                Reset
              </button>
            </div>
          )}
          {missing.length > 0 && (
            <p role="alert" className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Missing-glyph warning: {missing.slice(0, 8).join(" ")} can't be embedded as text with the built-in fonts. This {o.type === "text" ? "box" : "edit"} will be saved as an image so it still looks right (not selectable).
            </p>
          )}
        </div>
      )}

      {o && (o.type === "text" || o.type === "textedit") && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Font</Label>
              <select className={input} value={o.family} onChange={(e) => patch({ family: e.target.value as FontFamily })}>
                <option value="sans">Sans (Helvetica)</option>
                <option value="serif">Serif (Times)</option>
                <option value="mono">Mono (Courier)</option>
              </select>
            </div>
            <div>
              <Label>Size (pt)</Label>
              <input className={input} type="number" min={4} max={200} step={0.5} value={Math.round((o.fontSize ?? 12) * 10) / 10} {...liveProps} onChange={(e) => patch({ fontSize: Math.max(4, Number(e.target.value) || 12) }, true)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={cn(btn, o.bold && "!bg-indigo-100 dark:!bg-indigo-900")} aria-pressed={!!o.bold} onClick={() => patch({ bold: !o.bold })}>
              <b>B</b>
            </button>
            <button className={cn(btn, o.italic && "!bg-indigo-100 dark:!bg-indigo-900")} aria-pressed={!!o.italic} onClick={() => patch({ italic: !o.italic })}>
              <i>I</i>
            </button>
            {o.type === "text" &&
              (["left", "center", "right"] as const).map((a) => (
                <button key={a} className={cn(btn, o.align === a && "!bg-indigo-100 dark:!bg-indigo-900")} aria-pressed={o.align === a} onClick={() => patch({ align: a })} aria-label={`Align ${a}`}>
                  {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
                </button>
              ))}
            <input type="color" aria-label="Text colour" value={o.color} {...liveProps} onChange={(e) => patch({ color: e.target.value }, true)} className="h-8 w-10 rounded border" />
          </div>
          {o.type === "textedit" && <p className="text-xs text-slate-500">Cover-and-replace: the original words are covered with the sampled background ({o.bg}). Complex layouts or subset fonts may not match exactly.</p>}
        </>
      )}

      {hasStroke && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Colour</Label>
            <input type="color" className="h-8 w-full rounded border" value={o!.color} {...liveProps} onChange={(e) => patch({ color: e.target.value }, true)} aria-label="Stroke colour" />
          </div>
          <div>
            <Label>Width</Label>
            <input type="range" min={0.5} max={16} step={0.5} className="w-full" value={o!.strokeWidth} {...liveProps} onChange={(e) => patch({ strokeWidth: Number(e.target.value) }, true)} aria-label="Stroke width" />
          </div>
        </div>
      )}
      {hasFill && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!o!.fill} onChange={(e) => patch({ fill: e.target.checked ? "#fde68a" : null })} /> Fill
          </label>
          {o!.fill && <input type="color" aria-label="Fill colour" className="h-8 w-12 rounded border" value={o!.fill} {...liveProps} onChange={(e) => patch({ fill: e.target.value }, true)} />}
        </div>
      )}
      {(type === "highlight" || type === "whiteout") && (
        <div>
          <Label>Colour</Label>
          <input type="color" className="h-8 w-20 rounded border" value={o!.fill ?? "#facc15"} {...liveProps} onChange={(e) => patch({ fill: e.target.value, color: e.target.value }, true)} aria-label="Fill colour" />
        </div>
      )}
      {type === "note" && (
        <div>
          <Label>Note colour</Label>
          <input type="color" className="h-8 w-20 rounded border" value={o!.fill ?? "#fde047"} {...liveProps} onChange={(e) => patch({ fill: e.target.value }, true)} aria-label="Note colour" />
        </div>
      )}

      {o?.type === "field" && (
        <div className="space-y-2">
          <div>
            <Label>Field type</Label>
            <select className={input} value={o.fieldKind} onChange={(e) => patch({ fieldKind: e.target.value as FieldKind })}>
              <option value="text">Text</option>
              <option value="date">Date</option>
              <option value="checkbox">Checkbox</option>
              <option value="radio">Radio button</option>
              <option value="dropdown">Dropdown</option>
            </select>
          </div>
          <div>
            <Label hint={o.fieldKind === "radio" ? "Radio buttons sharing a name form one group." : undefined}>Field name</Label>
            <input className={input} value={o.fieldName ?? ""} {...liveProps} onChange={(e) => patch({ fieldName: e.target.value }, true)} />
          </div>
          {o.fieldKind === "radio" && (
            <div>
              <Label>Choice label</Label>
              <input className={input} value={o.label ?? ""} {...liveProps} onChange={(e) => patch({ label: e.target.value }, true)} />
            </div>
          )}
          {o.fieldKind === "dropdown" && (
            <div>
              <Label hint="One option per line">Options</Label>
              <textarea className={cn(input, "min-h-20")} value={(o.options ?? []).join("\n")} {...liveProps} onChange={(e) => patch({ options: e.target.value.split("\n") }, true)} />
            </div>
          )}
          {o.fieldKind === "date" && <p className="text-xs text-slate-500">Saved as a text field (PDF scripts are never written, so there is no date picker).</p>}
        </div>
      )}

      {type === "redact" && <p className="rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">On download this page is rebuilt as an image with this area burned in black; text and images beneath are removed, and text objects you added under it are dropped.</p>}
      {type === "image" && o!.label === "signature" && <p className="text-xs text-slate-500">Visual signature: an image of your signature, not a certified digital signature.</p>}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Opacity</Label>
          <input type="range" min={0.05} max={1} step={0.05} className="w-full" value={objs[0].opacity} {...liveProps} onChange={(e) => patch({ opacity: Number(e.target.value) }, true)} aria-label="Opacity" />
        </div>
        {o && o.type !== "textedit" && (
          <div>
            <Label>Rotation (°)</Label>
            <input className={input} type="number" step={5} value={Math.round(o.rotation)} {...liveProps} onChange={(e) => patch({ rotation: ((Number(e.target.value) % 360) + 360) % 360 }, true)} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <button className={btn} onClick={() => { const r = duplicateObjects(ids); st().exec(r.cmd); useEditor.setState({ selection: r.newIds }); }}>Duplicate</button>
        <button className={btn} onClick={() => { st().exec(deleteObjects(ids)); useEditor.setState({ selection: [] }); }}>Delete</button>
        <button className={btn} onClick={() => st().exec(reorderZ(ids, "front"))} title="Bring to front">⤒</button>
        <button className={btn} onClick={() => st().exec(reorderZ(ids, "forward"))} title="Bring forward">↑</button>
        <button className={btn} onClick={() => st().exec(reorderZ(ids, "backward"))} title="Send backward">↓</button>
        <button className={btn} onClick={() => st().exec(reorderZ(ids, "back"))} title="Send to back">⤓</button>
      </div>
    </div>
  );
}
