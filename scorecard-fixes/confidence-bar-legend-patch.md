# Patch: confidence-bar readable legend (fix the invisible orange sliver)

The medium/probable band is ~0.7% in the pilot, so its label is crushed inside a
~3px segment. Fix: suppress in-bar labels for thin segments and print an explicit
legend with all three numbers underneath.

## 1. Replace the bar block (lines ~376–381)

FIND:
```js
<div class=bar>
 <span style="width:${(cf.high||0)*100}%;background:#16a34a">${fp(cf.high)}</span>
 <span style="width:${(cf.med||0)*100}%;background:#d97706">${fp(cf.med)}</span>
 <span style="width:${(cf.low||0)*100}%;background:#dc2626">${fp(cf.low)}</span>
</div>
<p class=sub style="margin-top:6px">High (verified) / Medium (probable) / Low (indicative) across populated fields</p>
```

REPLACE WITH:
```js
${(() => {
  // Only show a label inside a segment if it's wide enough to hold it (>=8%).
  const lbl = (val) => ((val || 0) >= 0.08 ? fp(val) : '');
  return `<div class=bar>
 <span style="width:${(cf.high||0)*100}%;background:#16a34a" title="High ${fp(cf.high)}">${lbl(cf.high)}</span>
 <span style="width:${(cf.med||0)*100}%;background:#d97706" title="Medium ${fp(cf.med)}">${lbl(cf.med)}</span>
 <span style="width:${(cf.low||0)*100}%;background:#dc2626" title="Low ${fp(cf.low)}">${lbl(cf.low)}</span>
</div>
<div class=legend>
 <span><i style="background:#16a34a"></i>High (verified) <b>${fp(cf.high)}</b></span>
 <span><i style="background:#d97706"></i>Medium (probable) <b>${fp(cf.med)}</b></span>
 <span><i style="background:#dc2626"></i>Low (indicative) <b>${fp(cf.low)}</b></span>
</div>`;
})()}
```

## 2. Add the legend style (inside the <style> block, ~line 364)

Add after the `.bar` rule:
```css
 .legend{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 0;font-size:12px;color:#444}
 .legend span{display:flex;align-items:center;gap:6px}
 .legend i{width:11px;height:11px;border-radius:2px;display:inline-block}
 .legend b{font-weight:600;color:#1a1a1a}
```

## Result
- Wide segments (High, Low) keep their in-bar % label.
- The thin Medium sliver no longer tries to print inside itself — its value
  (e.g. 0.7%) is read from the legend below, where all three numbers always show.
- Hovering any segment also shows its exact value via the `title` tooltip.
