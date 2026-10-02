import type { ToolId } from "./model/docState";
import { SITE } from "./config";

const B = SITE.name;

export type PanelId =
  | "merge"
  | "split"
  | "compress"
  | "protect"
  | "unlock"
  | "crop"
  | "resize"
  | "watermark"
  | "stamp"
  | "metadata"
  | "toImage"
  | "fromImage"
  | "toText"
  | "ocr"
  | "forms";

export interface ToolDef {
  slug: string;
  name: string;
  icon: string;
  /** panel shown on the landing page / in the editor tools menu */
  panel?: PanelId;
  /** editor tool to preselect when the landing page hands over to the editor */
  editorTool?: ToolId;
  title: string;
  description: string;
  intro: string;
  steps: [string, string, string];
  faq: { q: string; a: string }[];
  related: string[];
  multi?: boolean; // accepts several files
  accept?: "pdf" | "image";
}

export const TOOLS: ToolDef[] = [
  {
    slug: "edit-pdf",
    name: "Edit PDF",
    icon: "✏️",
    editorTool: "select",
    title: `Edit PDF Online Free – Add Text, Shapes & Images | ${B}`,
    description: "Edit a PDF in your browser: add text, highlight, draw, insert images and change existing wording. No sign-up, no watermark, files stay on your device.",
    intro: "Open any PDF and mark it up with text boxes, highlights, freehand ink, shapes, sticky notes and images, or click existing words to replace them. Everything is processed locally in your browser, so confidential documents never touch a server.",
    steps: ["Drop your PDF onto the page.", "Pick a tool and click or drag on the page.", "Download the edited PDF – undo any step first if you change your mind."],
    faq: [
      { q: "Can I change text that is already in the PDF?", a: "Yes. The Edit text tool covers the old words with a sampled background colour and writes the new text on top. It replaces rather than reflows, so complex layouts may not match exactly." },
      { q: "Will my edited file have a watermark?", a: "No. Output is never watermarked and no account is required." },
      { q: "Is the file uploaded anywhere?", a: "No. Parsing, editing and saving all run inside your browser using Web Workers." },
    ],
    related: ["redact-pdf", "sign-pdf", "organize-pages"],
  },
  {
    slug: "merge-pdf",
    name: "Merge PDF",
    icon: "🧩",
    panel: "merge",
    multi: true,
    title: `Merge PDF Files Online – Combine PDFs Free | ${B}`,
    description: "Combine several PDFs into one document, reorder them first, and download the result. Free, private, and entirely in your browser.",
    intro: "Add two or more PDFs, drag them into the order you want, and join them into a single file. Because merging happens on your device, even very sensitive contracts or statements stay private.",
    steps: ["Add the PDFs you want to combine.", "Reorder or remove files with the arrows.", "Press Merge and download – or keep editing the merged document."],
    faq: [
      { q: "Is there a limit on how many files I can merge?", a: "There is no fixed limit; the practical limit is your device memory." },
      { q: "Do form fields survive a merge?", a: "Pages are copied faithfully but interactive form fields and bookmarks from the inputs are not carried over. Flatten forms first if you need their appearance." },
      { q: "Can I merge password-protected files?", a: "Unlock them first with the Unlock PDF tool, then merge." },
    ],
    related: ["split-pdf", "organize-pages", "compress-pdf"],
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    icon: "✂️",
    panel: "split",
    title: `Split PDF by Page Range – Extract Pages Free | ${B}`,
    description: "Split a PDF into parts by page range, every N pages, or a selection. Get a ZIP of separate files without uploading anything.",
    intro: "Pull out chapters, separate invoices, or cut a long scan into equal pieces. Choose exact ranges such as 1-3, 7, 10- or let the tool split every N pages automatically.",
    steps: ["Open the PDF you want to split.", "Choose ranges or a fixed number of pages per file.", "Download the parts as a ZIP (or a single file when there is one part)."],
    faq: [
      { q: "How do I write page ranges?", a: "Use commas and dashes: 1-3, 5, 8- means pages 1 to 3, page 5, and page 8 to the end." },
      { q: "Does splitting reduce quality?", a: "No. Pages are copied as-is without re-rendering." },
      { q: "Can I keep one range per file?", a: "Yes – choose 'Each range becomes its own file'." },
    ],
    related: ["merge-pdf", "organize-pages", "compress-pdf"],
  },
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    icon: "🗜️",
    panel: "compress",
    title: `Compress PDF – Reduce File Size Online Free | ${B}`,
    description: "Shrink PDF size with light, balanced or strong presets. See the before and after size. Runs locally so your file is never uploaded.",
    intro: "Large scans and photo-heavy PDFs are easy to shrink for email. Pick a preset, and the tool downsamples JPEG images, strips metadata and cleans up unused objects, then shows exactly how much was saved.",
    steps: ["Open your PDF.", "Choose Light, Balanced or Strong.", "Compare sizes and download."],
    faq: [
      { q: "What actually gets smaller?", a: "JPEG images are resampled and re-encoded, metadata is removed, and unreachable objects are dropped. Already-optimised files may not shrink – you are told so and keep the original." },
      { q: "Will text stay sharp?", a: "Yes. Text and vector artwork are not rasterised." },
      { q: "Which preset should I use?", a: "Balanced suits most documents; Strong is best for scans you only need to read on screen." },
    ],
    related: ["pdf-to-image", "split-pdf", "protect-pdf"],
  },
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    icon: "🔒",
    panel: "protect",
    title: `Password Protect PDF – AES-256 Encryption Online | ${B}`,
    description: "Add an open password and restrict printing, copying or editing using AES-256. Encryption happens in your browser, never on a server.",
    intro: "Lock a PDF with a password before sharing it. Optionally restrict printing, copying and editing. The password never leaves your device, which also means we cannot recover it for you.",
    steps: ["Open the PDF.", "Type a password and choose permissions.", "Download the protected copy and test it."],
    faq: [
      { q: "Which encryption is used?", a: "AES-256 (PDF 2.0 security handler)." },
      { q: "Are permissions enforced everywhere?", a: "Many viewers honour them, but permission flags are advisory – use an open password for real confidentiality." },
      { q: "What if I forget the password?", a: "It cannot be recovered. Keep an unprotected original." },
    ],
    related: ["unlock-pdf", "edit-metadata", "redact-pdf"],
  },
  {
    slug: "unlock-pdf",
    name: "Unlock PDF",
    icon: "🔓",
    panel: "unlock",
    title: `Unlock PDF – Remove a Known Password Online | ${B}`,
    description: "Remove the password from a PDF you own when you know it. Processed locally in your browser, nothing is uploaded.",
    intro: "If you have the password and are tired of typing it, save an unprotected copy. This tool does not crack or guess passwords – you must know the open password.",
    steps: ["Open the protected PDF and enter its password.", "Press Unlock.", "Download the unprotected copy."],
    faq: [
      { q: "Can you unlock a PDF I forgot the password to?", a: "No. This tool only removes protection when you already know the password." },
      { q: "Is the content changed?", a: "No, only the encryption layer is removed." },
      { q: "Is my password sent anywhere?", a: "No. It is used inside your browser tab only." },
    ],
    related: ["protect-pdf", "merge-pdf", "edit-pdf"],
  },
  {
    slug: "organize-pages",
    name: "Organize pages",
    icon: "🗂️",
    editorTool: "select",
    title: `Reorder, Rotate & Delete PDF Pages Online | ${B}`,
    description: "Drag pages into a new order, rotate, duplicate, delete, insert blank pages or pages from another PDF. Private and free.",
    intro: "A thumbnail sidebar lets you rearrange a document visually. Select one or many pages, rotate them, remove the ones you don't need, add a blank page, or pull in pages from a second PDF.",
    steps: ["Open the PDF – thumbnails appear on the left.", "Drag to reorder; use the buttons to rotate, duplicate or delete.", "Download the rearranged file."],
    faq: [
      { q: "Can I undo a deleted page?", a: "Yes. Every change goes through the undo stack (Ctrl/Cmd+Z)." },
      { q: "Can I insert pages from another PDF?", a: "Yes, use 'Insert from PDF' in the page toolbar." },
      { q: "Are the removed pages really gone from the file?", a: "Yes. Unreachable objects are dropped when the file is saved." },
    ],
    related: ["merge-pdf", "split-pdf", "crop-pdf"],
  },
  {
    slug: "crop-pdf",
    name: "Crop PDF",
    icon: "📐",
    panel: "crop",
    title: `Crop or Resize PDF Pages Online | ${B}`,
    description: "Trim margins from PDF pages or resize them to A4 or Letter. Applies to all pages or a selection, entirely in your browser.",
    intro: "Remove scanner borders or tighten margins by entering how much to trim from each side, or fit pages to a standard paper size without distorting the content.",
    steps: ["Open the PDF.", "Enter margins to trim, or pick a paper size.", "Apply and download."],
    faq: [
      { q: "Is cropped content deleted?", a: "Cropping sets the visible page box. Use Redact if hidden content must be permanently removed." },
      { q: "Does it work on rotated pages?", a: "Yes. Margins are always applied as you see them on screen." },
      { q: "Will resizing stretch my pages?", a: "No. Content is scaled proportionally and centred." },
    ],
    related: ["organize-pages", "watermark-pdf", "page-numbers"],
  },
  {
    slug: "watermark-pdf",
    name: "Add watermark",
    icon: "💧",
    panel: "watermark",
    title: `Add Watermark to PDF – Text or Image | ${B}`,
    description: "Stamp text or an image across your PDF with adjustable opacity, angle and tiling. Free and processed offline in your browser.",
    intro: "Mark documents as DRAFT or CONFIDENTIAL, or brand them with a logo. Control size, opacity, rotation and whether the mark repeats across the page.",
    steps: ["Open the PDF.", "Type the text or choose an image and tune opacity and angle.", "Apply and download."],
    faq: [
      { q: `Does ${B} add its own watermark?`, a: "Never. Only the watermark you create is added." },
      { q: "Can I tile the watermark?", a: "Yes, turn on Repeat across page." },
      { q: "Can I remove a watermark later?", a: "Use Undo in the editor session; once downloaded it is part of the page." },
    ],
    related: ["page-numbers", "protect-pdf", "crop-pdf"],
  },
  {
    slug: "page-numbers",
    name: "Page numbers & Bates",
    icon: "🔢",
    panel: "stamp",
    title: `Add Page Numbers, Headers, Footers & Bates Numbers | ${B}`,
    description: "Number the pages of a PDF, add headers or footers, or apply sequential Bates numbering for legal documents. Local and free.",
    intro: "Insert page numbers like 'Page 3 of 12', add a header or footer to each page, or stamp Bates identifiers with a prefix and padded counter for legal discovery.",
    steps: ["Open the PDF.", "Choose the text for header and footer zones – use {n}, {total} and {bates}.", "Apply and download."],
    faq: [
      { q: "What are Bates numbers?", a: "Sequential identifiers such as ACME000123 stamped on every page so each page can be cited uniquely." },
      { q: "Can numbering start at a different number?", a: "Yes, set the first number." },
      { q: "Does it work on landscape or rotated pages?", a: "Yes. Text is placed as the page appears on screen." },
    ],
    related: ["watermark-pdf", "merge-pdf", "crop-pdf"],
  },
  {
    slug: "edit-metadata",
    name: "Edit metadata",
    icon: "🏷️",
    panel: "metadata",
    title: `Edit PDF Metadata – Title, Author, Keywords | ${B}`,
    description: "View and change a PDF's title, author, subject and keywords, or wipe all metadata before sharing. Private and free.",
    intro: "Documents often carry author names and software details you may not want to share. Review the properties, correct them, or strip everything in a click.",
    steps: ["Open the PDF.", "Edit the fields or choose Clear all.", "Apply and download."],
    faq: [
      { q: "Does this remove hidden text?", a: "No. Metadata only covers the document properties. Use Redact for page content." },
      { q: "Is XMP metadata removed too?", a: "Yes, the XMP packet is dropped so viewers show the values you set." },
      { q: "Can I leave a field empty?", a: "Yes, empty fields are removed." },
    ],
    related: ["protect-pdf", "compress-pdf", "redact-pdf"],
  },
  {
    slug: "pdf-to-image",
    name: "PDF to image",
    icon: "🖼️",
    panel: "toImage",
    title: `Convert PDF to PNG or JPG Online – Free | ${B}`,
    description: "Turn PDF pages into PNG or JPG images at 72–300 DPI. Multi-page files download as a ZIP. Nothing leaves your browser.",
    intro: "Export every page, or just a range, as images for slides, social posts or sharing. Choose resolution and format; multiple pages are bundled in a ZIP.",
    steps: ["Open the PDF.", "Choose format, DPI and pages.", "Download the image or ZIP."],
    faq: [
      { q: "What DPI should I use?", a: "150 is good for screens, 300 for print. Very high DPI on large pages uses a lot of memory." },
      { q: "PNG or JPG?", a: "PNG is lossless and best for text; JPG is smaller for photos." },
      { q: "Can I convert only some pages?", a: "Yes, enter a range such as 1-3, 7." },
    ],
    related: ["image-to-pdf", "compress-pdf", "pdf-to-text"],
  },
  {
    slug: "image-to-pdf",
    name: "Image to PDF",
    icon: "📷",
    panel: "fromImage",
    multi: true,
    accept: "image",
    title: `Convert Images to PDF – JPG, PNG, WebP | ${B}`,
    description: "Combine photos or scans into a single PDF with page size, margin and orientation options. Local processing, no upload.",
    intro: "Drop JPG, PNG, WebP, GIF or BMP images, order them, and produce a clean PDF. Phone photos with EXIF rotation are straightened automatically.",
    steps: ["Add your images.", "Order them and choose page size and margins.", "Create and download the PDF."],
    faq: [
      { q: "Which formats are supported?", a: "JPG, PNG, WebP, GIF and BMP (anything your browser can decode)." },
      { q: "Will the images be recompressed?", a: "JPG and PNG are embedded as-is; other formats are converted to PNG." },
      { q: "Can I make a scan searchable?", a: "Yes – continue with the OCR tool afterwards." },
    ],
    related: ["ocr-pdf", "pdf-to-image", "merge-pdf"],
  },
  {
    slug: "pdf-to-text",
    name: "PDF to text",
    icon: "📄",
    panel: "toText",
    title: `Extract Text from PDF – PDF to TXT Online | ${B}`,
    description: "Pull the plain text out of a PDF and download it as a .txt file. Scans need OCR first. Processed locally.",
    intro: "Copy all selectable text from a PDF into a plain text file, page by page. If the PDF is a scan with no text layer, run OCR first.",
    steps: ["Open the PDF.", "Press Extract text.", "Preview, copy or download the .txt file."],
    faq: [
      { q: "Why is the result empty?", a: "The PDF is probably an image scan. Use the OCR tool to add a text layer first." },
      { q: "Is layout preserved?", a: "Reading order is approximated; tables and columns may need tidying." },
      { q: "Does it support non-Latin scripts?", a: "Yes, any text the PDF embeds can be extracted." },
    ],
    related: ["ocr-pdf", "pdf-to-image", "redact-pdf"],
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    icon: "🔍",
    panel: "ocr",
    title: `OCR PDF – Make Scanned PDFs Searchable | ${B}`,
    description: "Recognise text in scanned PDFs and add an invisible searchable layer. Runs in your browser with downloadable language packs.",
    intro: "Turn image-only scans into PDFs you can search and copy from. Pick a language, watch progress, and cancel any time. Recognition runs locally; only the language data file is downloaded.",
    steps: ["Open the scanned PDF.", "Choose language and pages.", "Run OCR and download the searchable PDF."],
    faq: [
      { q: "Are my pages uploaded for recognition?", a: "No. Recognition runs in your browser. Only the public language data file is fetched from a CDN." },
      { q: "How accurate is it?", a: "It depends on scan quality and language; clean 300 DPI scans work best." },
      { q: "Does it change how the page looks?", a: "No. The recognised text is added invisibly." },
    ],
    related: ["pdf-to-text", "image-to-pdf", "compress-pdf"],
  },
  {
    slug: "redact-pdf",
    name: "Redact PDF",
    icon: "⬛",
    editorTool: "redact",
    title: `Redact PDF – Permanently Remove Sensitive Text | ${B}`,
    description: "Black out names, numbers and images and permanently remove the underlying content, then verify the text is no longer extractable.",
    intro: "Drawing a black box is not redaction. This tool burns the boxes into the page and rebuilds it so the covered text and image data are gone, then re-extracts the text to prove it.",
    steps: ["Open the PDF and choose the Redact tool.", "Drag boxes over sensitive content.", "Download – the app re-parses the file and reports whether anything is still extractable."],
    faq: [
      { q: "How is this different from whiteout?", a: "Whiteout only covers content. Redaction rasterises the page and removes the original text and image data." },
      { q: "What's the trade-off?", a: "Redacted pages become images with an invisible text layer for the remaining words, so their fonts and vector sharpness are not preserved." },
      { q: "Is metadata redacted?", a: "No. Use Edit metadata to clear document properties." },
    ],
    related: ["edit-metadata", "edit-pdf", "protect-pdf"],
  },
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    icon: "🖊️",
    editorTool: "signature",
    title: `Sign PDF Online – Draw, Type or Upload a Signature | ${B}`,
    description: "Add a visual signature by drawing, typing or uploading an image. Place and resize it on any page. No account needed.",
    intro: "Create a signature with your mouse, finger or keyboard, or upload a scan, then drop it on the page. This is a visual signature image, not a certified digital signature.",
    steps: ["Open the PDF and choose Sign.", "Draw, type or upload your signature.", "Place, resize and download."],
    faq: [
      { q: "Is this legally binding?", a: "Rules differ by country and document type. It is an image of your signature, not a cryptographic certificate (PKI signatures are out of scope)." },
      { q: "Is my signature stored?", a: "Only inside your open session, which you can clear at any time." },
      { q: "Can I reuse it on other pages?", a: "Yes, duplicate the signature object." },
    ],
    related: ["fill-pdf-form", "edit-pdf", "protect-pdf"],
  },
  {
    slug: "fill-pdf-form",
    name: "Fill PDF form",
    icon: "📝",
    panel: "forms",
    title: `Fill & Flatten PDF Forms Online | ${B}`,
    description: "Fill existing PDF form fields, add text, checkbox, radio and dropdown fields, and flatten forms so values stick everywhere.",
    intro: "Detects interactive fields, lets you type answers, and writes them back so they show in Chrome, Firefox, Preview and Acrobat. Flatten to lock the answers into the page.",
    steps: ["Open the form PDF.", "Fill in the detected fields.", "Apply and optionally flatten, then download."],
    faq: [
      { q: "Can I add fields to a PDF without any?", a: "Yes – in the editor use the Field tool to place text, checkbox, radio and dropdown fields." },
      { q: "What does flatten do?", a: "It turns fields into plain page content so they can no longer be edited." },
      { q: "Do you run PDF JavaScript?", a: "Never. PDF scripts are not executed." },
    ],
    related: ["sign-pdf", "edit-pdf", "protect-pdf"],
  },
];

export const toolBySlug = (slug: string) => TOOLS.find((t) => t.slug === slug);
