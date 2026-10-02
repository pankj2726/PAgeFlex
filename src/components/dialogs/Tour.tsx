import { useState } from "react";
import { Modal, btn, btnPrimary } from "../ui";

const STEPS = [
  { title: "Welcome to the editor", body: "Everything happens in this tab. Your PDF is never uploaded, so you can safely edit contracts, IDs and statements." },
  { title: "Pick a tool", body: "The toolbar on top has text, markup, shapes, images, whiteout, redaction, signatures and form fields. Press V for the select tool at any time." },
  { title: "Manage pages", body: "The thumbnail sidebar lets you drag pages into a new order, rotate, delete, duplicate, insert blank pages or pages from another PDF." },
  { title: "Tools menu", body: "Merge, split, compress, protect, crop, watermark, OCR and more live in the Tools menu. Results flow straight back into your document, no re-upload needed." },
  { title: "Download when you're done", body: "Press Download. The file is rebuilt on your device and re-checked with a second PDF reader before you get it. Ctrl/Cmd+Z undoes anything." },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const done = () => {
    try {
      localStorage.setItem("qf-tour", "done");
    } catch {
      /* ignore */
    }
    onClose();
  };
  return (
    <Modal
      title={`${s.title} (${i + 1}/${STEPS.length})`}
      onClose={done}
      footer={
        <>
          <button className={btn} onClick={done}>
            Skip
          </button>
          {i > 0 && (
            <button className={btn} onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className={btnPrimary} onClick={() => (i === STEPS.length - 1 ? done() : setI(i + 1))}>
            {i === STEPS.length - 1 ? "Start editing" : "Next"}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed">{s.body}</p>
    </Modal>
  );
}
