# Input telemetry diagnosis

## Funnel
```json
{
  "client_sent": 21,
  "DataPlaneReceived": 26,
  "SidecarPushWritten": 26,
  "SidecarAdmitted": 18,
  "Applied": 26,
  "CdpDropped": 5,
  "Rejected": 0,
  "AdmissionDropped": 0,
  "ScrollEchoHit": 1,
  "programmaticSuppress": 0
}
```

## Kind funnel
```json
{
  "blur": {
    "client_sent": 4,
    "dataPlane": 4,
    "applied": 4,
    "admitted": 1,
    "cdpDropped": 2
  },
  "focus": {
    "client_sent": 4,
    "dataPlane": 5,
    "applied": 5,
    "admitted": 3,
    "cdpDropped": 1
  },
  "keydown": {
    "client_sent": 6,
    "dataPlane": 6,
    "applied": 6,
    "admitted": 6,
    "cdpDropped": 0
  },
  "keyup": {
    "client_sent": 6,
    "dataPlane": 6,
    "applied": 6,
    "admitted": 5,
    "cdpDropped": 1
  },
  "input": {
    "client_sent": 1,
    "dataPlane": 1,
    "applied": 1,
    "admitted": 0,
    "cdpDropped": 1
  },
  "mousemove": {
    "client_sent": 0,
    "dataPlane": 1,
    "applied": 1,
    "admitted": 0,
    "cdpDropped": 0
  },
  "mousedown": {
    "client_sent": 0,
    "dataPlane": 1,
    "applied": 1,
    "admitted": 1,
    "cdpDropped": 0
  },
  "mouseup": {
    "client_sent": 0,
    "dataPlane": 1,
    "applied": 1,
    "admitted": 1,
    "cdpDropped": 0
  },
  "scrollViewport": {
    "client_sent": 0,
    "dataPlane": 1,
    "applied": 1,
    "admitted": 1,
    "cdpDropped": 0
  }
}
```

## Scroll
```json
{
  "wheelSent": 0,
  "scrollViewportSent": 0,
  "scrollElementSent": 0,
  "programmaticSuppress": 0,
  "scrollEchoHit": 1,
  "diffScrollOps": 2,
  "echoSamples": [
    {
      "at": "2026-08-08T14:48:43.6251389+00:00",
      "profileId": "b861eb9b-74d8-4b3b-9990-0b8e045e4224",
      "sessionId": "61da7bc4-1159-4584-90b8-4ff4341a4b93",
      "kind": "viewport",
      "generation": 1,
      "anchor": null,
      "scrollX": 0,
      "scrollY": 3972,
      "scrollTop": null,
      "scrollLeft": null
    }
  ],
  "suppressSamples": []
}
```

## Soft-nav
```json
{
  "observed": 3,
  "samples": [
    {
      "url": "https://www.eneba.com/",
      "gen": 1,
      "armed": true
    },
    {
      "url": "https://www.eneba.com/br/",
      "gen": 2,
      "armed": false
    },
    {
      "url": "https://www.eneba.com/br/store/all?text=steam&enb_campaign=Main%20Search&enb_content=search%20dropdown%20-%20input&enb_medium=input&enb_source=https%3A%2F%2Fwww.eneba.com%2F&enb_term=Submit",
      "gen": 2,
      "armed": true
    }
  ]
}
```

## Per-act effects
- **dismiss_overlay_click**: Δscroll=0 Δhtml=11443 textChanged=false hrefChanged=false intents=[mousemove, mousedown, focus, mouseup, scrollViewport]
- **mousemove_then_click_hero**: Δscroll=0 Δhtml=0 textChanged=false hrefChanged=true intents=[mousemove, mousedown, focus, mouseup, scrollViewport, blur, focus]
- **wheel_down_800**: Δscroll=0 Δhtml=239955 textChanged=true hrefChanged=false intents=[mousemove, mousedown, focus, mouseup, scrollViewport, blur, focus, blur]
- **wheel_up_400**: Δscroll=0 Δhtml=233035 textChanged=false hrefChanged=false intents=[mousemove, mousedown, focus, mouseup, scrollViewport, blur, focus, blur]
- **click_categories_nav**: Δscroll=0 Δhtml=-492 textChanged=false hrefChanged=false intents=[mousemove, mousedown, focus, mouseup, scrollViewport, blur, focus, blur, focus]
- **search_focus_type**: Δscroll=0 Δhtml=29344 textChanged=false hrefChanged=false intents=[mousemove, mousedown, focus, mouseup, scrollViewport, blur, focus, blur, focus, blur, focus, keydown, keyup, keydown, keyup, keydown, keyup, keydown, keyup, keydown, keyup]
- **search_enter**: Δscroll=0 Δhtml=-64367 textChanged=false hrefChanged=true intents=[mousemove, mousedown, focus, mouseup, scrollViewport, blur, focus, blur, focus, blur, focus, keydown, keyup, keydown, keyup, keydown, keyup, keydown, keyup, keydown, keyup, keydown, input, keyup, blur]
- **click_productish**: Δscroll=0 Δhtml=13074 textChanged=false hrefChanged=false intents=[blur, focus, blur, focus, blur, focus, keydown, keyup, keydown, keyup, keydown, keyup, keydown, keyup, keydown, keyup, keydown, input, keyup, blur, focus]
- **wheel_after_nav**: Δscroll=0 Δhtml=0 textChanged=false hrefChanged=false intents=[blur, focus, blur, focus, blur, focus, keydown, keyup, keydown, keyup, keydown, keyup, keydown, keyup, keydown, keyup, keydown, input, keyup, blur, focus]

## Findings
- **CDP_DROPPED**: 5 drops; reasons={"anchor_missing":4,"generation_stale":1}

## CdpDropped samples
```json
[
  {
    "kind": "blur",
    "reason": "anchor_missing",
    "gen": 1
  },
  {
    "kind": "focus",
    "reason": "generation_stale",
    "gen": 1
  },
  {
    "kind": "blur",
    "reason": "anchor_missing",
    "gen": 2
  },
  {
    "kind": "input",
    "reason": "anchor_missing",
    "gen": 2
  },
  {
    "kind": "keyup",
    "reason": "anchor_missing",
    "gen": 2
  }
]
```