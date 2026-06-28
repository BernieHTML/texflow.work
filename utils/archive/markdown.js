// ACSA Archive markdown renderer.
// Wraps `marked` to produce article HTML, injects stable heading IDs, and
// extracts a Table of Contents tree — version-independent (post-processes HTML).

import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, '');
}

export function slugify(text) {
  return (
    stripTags(String(text))
      .toLowerCase()
      .trim()
      .replace(/&[a-z]+;/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

// Render markdown body -> { html, toc }.
// toc: [{ level, id, text }]
export function renderMarkdown(body) {
  const rawHtml = marked.parse(body || '');
  const toc = [];
  const used = new Map();

  const html = rawHtml.replace(
    /<h([2-4])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g,
    (match, level, attrs, inner) => {
      const text = stripTags(inner).trim();
      let id = slugify(text);
      if (used.has(id)) {
        const count = used.get(id) + 1;
        used.set(id, count);
        id = `${id}-${count}`;
      } else {
        used.set(id, 0);
      }
      toc.push({ level: Number(level), id, text });
      return `<h${level} id="${id}">${inner}<a class="heading-anchor" href="#${id}" aria-label="Link to ${text}">#</a></h${level}>`;
    }
  );

  return { html, toc };
}
