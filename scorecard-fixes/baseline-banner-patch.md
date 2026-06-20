# Patch: provisional baseline banner

Run with `--baseline 60`. These edits make the assumption visible wherever the
scorecard travels.

## 1. Console — add a banner line at the very top of the Headlines block

FIND (line ~310):
```js
console.log(`\nHeadlines:`);
```

REPLACE WITH:
```js
console.log(`\n  [baseline] assumes ${BASELINE} min analyst RESEARCH per entity (SME estimate, provisional — research/data-gathering only, excludes screening/EDD/QC)`);
console.log(`\nHeadlines:`);
```

## 2. HTML — turn the subtitle into a provisional banner

FIND (line ~367):
```js
<p class=sub>${new Date().toISOString().slice(0,16).replace('T',' ')} &middot; ${overall.n} entities &middot; analyst baseline ${baseline} min</p>
```

REPLACE WITH:
```js
<p class=sub>${new Date().toISOString().slice(0,16).replace('T',' ')} &middot; ${overall.n} entities</p>
<p class=baseline-banner>Assumes <b>${baseline} min</b> of analyst <b>research</b> per entity
&mdash; SME estimate, <b>provisional</b>. Research / data-gathering only;
excludes screening adjudication, EDD and QC. Single flat figure across segments;
treat as an average.</p>
```

## 3. HTML — add the banner style (inside the existing <style> block, ~line 354)

Add this rule anywhere in the `<style>`:
```css
.baseline-banner{
  background:#fff7e6; border:1px solid #f0c36d; border-radius:6px;
  padding:8px 12px; margin:8px 0 16px; font-size:12px; color:#7a5b00;
}
```
