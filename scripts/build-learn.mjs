#!/usr/bin/env node
/* Build the static Learn pages.
   Usage:  node scripts/build-learn.mjs
   Reads learn/app.js (topic data + renderer), writes one indexable page per
   topic at learn/<id>/index.html, pre-renders the landing list into
   learn/index.html between the learn:landing markers, and adds any missing
   /learn/<id>/ URLs to sitemap.xml. Re-run after editing a topic. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://p14m.com';
const TODAY = '2026-09-22';

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'learn/app.js'), 'utf8'), { filename: 'learn/app.js' });
const L = globalThis.P14M_LEARN;
if (!L) throw new Error('learn/app.js did not expose P14M_LEARN');

const shell = fs.readFileSync(path.join(ROOT, 'learn/index.html'), 'utf8');
const header = shell.slice(shell.indexOf('<a class="skip-link"'), shell.indexOf('</header>') + '</header>'.length);
const footer = shell.slice(shell.indexOf('<footer class="site-footer">'), shell.indexOf('</footer>') + '</footer>'.length);
const themeBoot = shell.slice(shell.indexOf('<body>') + '<body>'.length, shell.indexOf('<a class="skip-link"')).trim();

const GA = `<!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-JTNTDY1XRQ"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-JTNTDY1XRQ');</script>`;

const strip = s => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/&(?![a-z#0-9]+;)/g, '&amp;').replace(/"/g, '&quot;');
const firstSentence = s => { const t = strip(s); const m = t.match(/^(.+?[.!?])(\s|$)/); return m ? m[1] : t; };

function description(topic) {
  let d = strip(topic.shortDescription);
  if (d.length < 100 && topic.content && topic.content.problem) {
    const longer = (d.replace(/\.$/, '') + '. ' + firstSentence(topic.content.problem)).trim();
    if (longer.length <= 155) d = longer;
  }
  if (d.length > 155) d = d.slice(0, 152).replace(/\s+\S*$/, '') + '...';
  return d;
}

function page(topic) {
  const cat = L.CATEGORIES[topic.category];
  const url = `${SITE}/learn/${topic.id}/`;
  const titleText = strip(topic.title);
  const title = `${titleText}: ${cat ? cat.name : 'Learn'} | p14m`;
  const desc = description(topic);
  const og = `${SITE}/og/learn.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'LearningResource', name: titleText, description: desc, url,
        educationalLevel: 'College', learningResourceType: 'Explanation', isAccessibleForFree: true,
        inLanguage: 'en', image: og, about: cat ? cat.name : undefined,
        author: { '@type': 'Person', name: 'Peter Moses', url: SITE + '/' },
        isPartOf: { '@type': 'CollectionPage', '@id': SITE + '/learn/', name: 'Learn computer architecture' } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'p14m', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Learn', item: SITE + '/learn/' },
        { '@type': 'ListItem', position: 3, name: titleText, item: url } ] },
    ],
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="author" content="Peter Moses">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#F4F5F7">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="p14m">
  <meta property="og:locale" content="en_US">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${og}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Learn on p14m.com">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${og}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
  <link rel="apple-touch-icon" href="/favicon-48.png">
  <link rel="preload" href="/fonts/mona-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/monaspace-neon-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/shared.css">
  <link rel="stylesheet" href="/learn/learn.css">
  <script src="/lib/site.js" defer></script>
  <script src="/lib/feedback.js" defer></script>
  <script src="/learn/app.js" defer></script>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
  ${GA}
</head>
<body>
${themeBoot}
${header}
<main id="main" class="container">
  <div class="learn-topic">
${L.renderTopicHTML(topic)}
  </div>
</main>
${footer}
</body>
</html>
`;
}

let n = 0;
for (const topic of L.TOPICS) {
  const dir = path.join(ROOT, 'learn', topic.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(topic));
  n++;
}

// Pre-render the landing list into learn/index.html so the index is crawlable without JS.
const START = '<!-- learn:landing -->', END = '<!-- /learn:landing -->';
let idx = shell;
const landing = `${START}\n${L.landingHTML(null)}\n${END}`;
if (idx.includes(START)) idx = idx.replace(new RegExp(START + '[\\s\\S]*?' + END), landing);
else idx = idx.replace('<div id="content"></div>', `<div id="content">${landing}</div>`);
fs.writeFileSync(path.join(ROOT, 'learn/index.html'), idx);

// Sitemap: add any missing topic URLs.
const smPath = path.join(ROOT, 'sitemap.xml');
let sm = fs.readFileSync(smPath, 'utf8');
let added = 0;
for (const topic of L.TOPICS) {
  const loc = `${SITE}/learn/${topic.id}/`;
  if (sm.includes(`<loc>${loc}</loc>`)) continue;
  sm = sm.replace('</urlset>', `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <priority>0.6</priority>\n  </url>\n</urlset>`);
  added++;
}
fs.writeFileSync(smPath, sm);
console.log(`learn: wrote ${n} topic pages, ${added} sitemap entries added`);
