# Bug hunt report

Session: `c82ed6e8-30ab-4c06-8304-74726ae71c93` · cold phase: **armed**

## Findings
- **NO_SCROLL_RANGE** (medium): `{"scrollHeight":900,"clientHeight":900}`
- **CDP_DROPPED** (medium): `{"count":1,"reasons":{"anchor_missing":1},"samples":[{"at":"2026-08-09T23:22:18.4669167+00:00","profileId":"91ea302a-b588-422c-b117-970bf1ad0b15","sessionId":"c82ed6e8-30ab-4c06-8304-74726ae71c93","kind":"blur","reason":"anchor_missing","generation":1,"anchor":null,"traceId":null,"clientTimestampMs"`
- **WHEEL_NO_EFFECT** (high): `[{"name":"wheel_down_600","delta":{"scrollTop":0,"htmlLen":28870,"textLen":766,"hrefChanged":false},"desyncAfter":false},{"name":"wheel_up_300","delta":{"scrollTop":0,"htmlLen":296654,"textLen":2543,"hrefChanged":false},"desyncAfter":false}]`
- **ACT_ERRORS** (medium): `[{"name":"click_navish","err":"locator.click: Element is not visible\nCall log:\n  - waiting for locator('[data-speculum-dom-surface] a, [data-speculum-dom-surface] button').filter({ hasText: /promo|cabelo|entrar|buscar|search|categor|perfume|skincare|login|games|steam|sto"}]`

## Metrics
```json
{
  "frontLines": 2000,
  "factCount": 2221,
  "appliedInputs": 27,
  "cdpDropped": 1,
  "scrollEchoHit": 1,
  "programmaticSuppress": 2,
  "generationBumped": 0,
  "softNav": 2,
  "hopCounts": {
    "client_apply": 948,
    "client_recv": 939,
    "lifecycle": 81,
    "client_sent": 27,
    "cssom/sheetList": 2,
    "programmaticSuppress": 2,
    "syncUrl": 1
  },
  "duplicateAnchors": []
}
```

## Acts
- **click_center**: Δscroll=0 Δhtml=-272127 hrefChanged=true desyncAfter=false err=N
- **wheel_down_600**: Δscroll=0 Δhtml=28870 hrefChanged=false desyncAfter=false err=N
- **wheel_up_300**: Δscroll=0 Δhtml=296654 hrefChanged=false desyncAfter=false err=N
- **click_navish**: Δscroll=300 Δhtml=421799 hrefChanged=false desyncAfter=false err=Y
- **search_type**: Δscroll=-300 Δhtml=16476 hrefChanged=false desyncAfter=false err=N
- **search_enter**: Δscroll=0 Δhtml=17204 hrefChanged=false desyncAfter=false err=N