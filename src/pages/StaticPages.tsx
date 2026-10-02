import type { ReactNode } from "react";
import { SiteLayout } from "../components/Layout";
import { SITE } from "../lib/config";
import { useSeo } from "../lib/seo";

function Page({ title, description, path, children }: { title: string; description: string; path: string; children: ReactNode }) {
  useSeo({ title: `${title} – ${SITE.name}`, description, path });
  return (
    <SiteLayout>
      <article className="animate-fade-up mx-auto max-w-3xl space-y-4 px-4 py-10 leading-relaxed [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_code]:rounded [&_code]:bg-slate-200 [&_code]:px-1 [&_code]:dark:bg-slate-800">
        <h1 className="text-3xl font-extrabold">{title}</h1>
        {children}
        <p className="pt-4 text-xs text-slate-500">Last updated {SITE.updated}.</p>
      </article>
    </SiteLayout>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy policy" description={`${SITE.name} processes files only on your device. Here is exactly what is and isn't stored or sent.`} path="/privacy">
      <p><strong>Short version:</strong> your PDFs are opened, edited, converted and saved entirely inside your browser. We do not upload them, and there is no server that could store them.</p>
      <h2>What stays on your device</h2>
      <ul>
        <li>Your documents, passwords you type, signatures you draw and every edit. They live in browser memory while you work.</li>
        <li><strong>Autosave:</strong> to recover from a refresh or crash, the open document may be saved in your browser's IndexedDB. Passwords are never saved. You can turn this off (⚙ menu in the editor) and wipe it any time with <em>Clear my data</em>, which deletes the database and all <code>qf-*</code> settings.</li>
        <li>Preferences (dark mode, language, tour seen, autosave choice) are kept in localStorage.</li>
      </ul>
      <h2>What leaves your device</h2>
      <ul>
        <li>The page itself is fetched from our host when you visit (standard web server logs may record your IP address and the pages requested, as with any website).</li>
        <li>pdf.js may download public font-mapping files (character maps / standard fonts) from the jsDelivr CDN when a PDF needs them. Those requests contain only the file names of those public resources, never your document.</li>
        <li>If you run OCR, the public Tesseract language data for the language you pick is downloaded from the jsDelivr CDN. Your pages are not sent.</li>
      </ul>
      <h2>Cookies, analytics and trackers</h2>
      <p>We set no cookies and run no third-party trackers or advertising scripts. This build contains no analytics. If cookie-less, privacy-friendly analytics are added in future they will never include document content, file names or file sizes, and this page will be updated first.</p>
      <h2>Errors</h2>
      <p>If something crashes you see a friendly error screen. Error details stay in your browser console; nothing is sent automatically.</p>
      <h2>Verify it yourself</h2>
      <p>Open your browser's developer tools → Network tab, then open and edit a PDF. You will see no request that carries your file.</p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of use" description={`The terms for using ${SITE.name}: free, as-is, and no file ever stored by us.`} path="/terms">
      <p>By using this website you agree to these terms.</p>
      <h2>The service</h2>
      <p>{SITE.name} is a free tool that runs in your browser. No account is needed and output files are not watermarked.</p>
      <h2>Your files, your responsibility</h2>
      <ul>
        <li>You must have the right to process the documents you open.</li>
        <li>Because processing is local, we cannot recover lost files, edits or passwords. Keep backups of originals.</li>
        <li>Always check the result before sharing. In particular, only the Redact tool removes content; whiteout, text replacement and cropping merely cover or hide it.</li>
      </ul>
      <h2>No warranty</h2>
      <p>The software is provided “as is”, without warranty of any kind. To the extent permitted by law, {SITE.operator} are not liable for losses arising from its use, including incorrect output.</p>
      <h2>Signatures</h2>
      <p>Signatures added with this tool are images. They are not certified digital signatures and may not satisfy legal requirements for your document.</p>
      <h2>Open-source components</h2>
      <p>This site uses permissively licensed libraries including pdf.js (Apache-2.0), pdf-lib (MIT), JSZip (MIT), Tesseract.js (Apache-2.0), React (MIT) and Zustand (MIT).</p>
    </Page>
  );
}

export function About() {
  return (
    <Page title={`About ${SITE.name}`} description={`${SITE.name}: ${SITE.tagline} ${SITE.description}`} path="/about">
      <p className="text-lg font-medium">{SITE.tagline}</p>
      <p>{SITE.description}</p>
      <p>{SITE.name} exists because most online PDF tools make you upload sensitive documents, sign up, or pay to remove a watermark. We wanted a tool where none of that is true.</p>
      <h2>How it works</h2>
      <p>The page renders with pdf.js and edits are written with pdf-lib inside a Web Worker. Every file we produce is re-opened with a second PDF reader before you download it, so we can warn you if something is wrong.</p>
      <h2>Honest limitations</h2>
      <ul>
        <li>Editing existing text is cover-and-replace, not true reflow.</li>
        <li>Signatures are images, not certified digital signatures.</li>
        <li>No Word/Excel/PowerPoint conversion – that needs a server.</li>
        <li>Very large files are limited by your device memory.</li>
        <li>OCR accuracy depends on scan quality and language.</li>
      </ul>
      <p>The name, logo and copy are original; no third-party branding is used. The colour palette is inspired by Anthropic's Claude.</p>
    </Page>
  );
}

export function Contact() {
  return (
    <Page title="Contact" description={`How to reach the ${SITE.name} team with questions, bugs or privacy requests.`} path="/contact">
      <p>Questions, bug reports or privacy requests: email <a className="text-indigo-600 underline underline-offset-4" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.</p>
      <p>Please <strong>do not attach confidential documents</strong>. Because we never receive your files, we can't look at your document anyway – a description of the steps that led to the problem (and your browser and version) is the most useful thing you can send.</p>
      <h2>Privacy requests</h2>
      <p>We hold no personal data about you beyond ordinary web-server logs. To erase everything stored locally, use <em>Clear my data</em> in the editor's ⚙ menu.</p>
    </Page>
  );
}
