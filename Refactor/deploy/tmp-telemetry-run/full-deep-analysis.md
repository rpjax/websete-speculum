# Full Live diagnosis — 477d41f4-6463-452a-adc6-cd8ccc294985

**Verdict:** CLEAN

## Cold paint
```json
{
  "childCount": 5,
  "htmlLen": 620745,
  "text": "English EU\nBRL\nLog in\n | \nRegister\nCategories\nGames -90%\nSoftware\neGift Cards\nNordVPN\nEneba Gift Cards\nFC27\nGame Points ⚡\nSurfshark VPN\nGAME POINTS | AUG 26\nSURFSHARK | AUG 26\nPSN GIFT CARDS | MAY 26\nUP TO -90% CHEAPER\nGames\nGaming eCards\neGift Cards\nE-money\nSteam\nSteam Gift Cards\nPSN\nXbox\nFIFA\nFortnite\nAmazon\nApple\nMobile games\nSpotify\nNetflix\nNintendo\nDLCs\nPre-orders\nCheap games\nRecommended for you \nEneba\nEneba Gift Card 5 EUR GLOBAL\nGLOBAL\nFrom\nR$29.47\nAdd to cart\nView offers\nCASHBACK\nSteam\nHell Clock Steam (PC) Key GLOBAL\nGLOBAL\nFrom R$59.99-94%\nR$3.77\n11% Cashback\nAdd to cart\nView offers\nEneba\nEneba Gift Card 10 EUR GLOBAL\nGLOBAL\nFrom\nR$58.94\nAdd to cart\nView offers\niFood\niFood Gift Card 200 BRL Key BRAZIL\nBRAZIL\nFrom\nR$246.68\nAdd to cart\nView offers\nCASHBACK\nRockstar Games Launcher\nG",
  "cssRuleApprox": 1903,
  "ownedSheets": 2,
  "ownedRules": 1832
}
```

## Journal vs Front
| Metric | Journal | Front |
|--------|---------|-------|
| Diff FR / recv | 1631 | 866 |
| WireDelivered | 1024 | — |
| Resync req | 0 | 0 |
| Resync apply/served | 0 | 0 |
| SoftNavObserved | 3 | — |
| ScrollEchoHit | 0 | — |
| Desync | — | 0 |
| Drop | — | 0 |
| Input Applied | 46 | — |
| GenerationBumped | 0 | — |
| QueueDropped | 2 | — |

## QueueDropped by stage
```json
{
  "byStage": {
    "api_fanout_pipe_closed": 2
  },
  "samples": [
    {
      "at": "2026-08-08T11:41:05.4403817+00:00",
      "stage": "api_fanout_pipe_closed",
      "droppedCount": 1,
      "capacity": 1024,
      "keptSequence": 1025,
      "generation": 1,
      "plane": "dom",
      "operation": "patch",
      "lowest": 1025,
      "highest": 1025
    },
    {
      "at": "2026-08-08T11:41:05.4418244+00:00",
      "stage": "api_fanout_pipe_closed",
      "droppedCount": 1,
      "capacity": 1024,
      "keptSequence": 1025,
      "generation": 1,
      "plane": "dom",
      "operation": "patch",
      "lowest": 1025,
      "highest": 1025
    }
  ]
}
```

## Boot
- First FR: `dom/document@seq1/gen1 → cssom/install@seq2/gen1 → dom/childList@seq3/gen1 → dom/childList@seq4/gen1 → dom/childList@seq5/gen1`
- First WD: `dom/document@seq1/gen1 → cssom/install@seq2/gen1 → dom/childList@seq3/gen1 → dom/childList@seq4/gen1 → dom/childList@seq5/gen1`
- Live before document: **0**
- Gen0 resync: **0**

## Bugs
- (none)

## Resync timeline (correlated)

## Soft-nav / urlAheadOfDom (observe-only)
```json
{
  "softNav": {
    "observed": 3,
    "samples": [
      {
        "at": "2026-08-08T11:40:44.8819575+00:00",
        "url": "https://www.eneba.com/",
        "generation": 1,
        "documentEpoch": "ex1winhp0mskaygg4",
        "liveArmed": true
      },
      {
        "at": "2026-08-08T11:40:52.0031225+00:00",
        "url": "https://www.eneba.com/promo/game-points?itm_source=eneba&itm_medium=banner&itm_campaign=Game_Points",
        "generation": 1,
        "documentEpoch": "ex1winhp0mskaygg4",
        "liveArmed": true
      },
      {
        "at": "2026-08-08T11:40:57.1545949+00:00",
        "url": "https://www.eneba.com/store/all?text=fulldiag&enb_campaign=Main%20Search&enb_content=search%20dropdown%20-%20input&enb_medium=input&enb_source=https%3A%2F%2Fwww.eneba.com%2Fpromo%2Fgame-points&enb_term=Submit",
        "generation": 1,
        "documentEpoch": "ex1winhp0mskaygg4",
        "liveArmed": true
      }
    ]
  },
  "urlAheadOfDom": {
    "syncUrlEntries": 2,
    "desyncedAtSyncUrl": 0,
    "softNavWithoutGenBump": true,
    "samples": []
  }
}
```

## CSSOM
```json
{
  "installFrames": 1,
  "installTelemetry": [
    {
      "seq": 2,
      "gen": 1,
      "sheets": 2,
      "rules": 2,
      "seeded": 2
    }
  ],
  "frontCssomApply": 0,
  "frontCssomHops": {
    "cssom/sheetList": 1
  }
}
```

## Input / scroll echo
```json
{
  "applied": [
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousedown",
    "focus",
    "mouseup",
    "blur",
    "wheel",
    "wheel",
    "mousemove",
    "mousedown",
    "focus",
    "mouseup",
    "keydown",
    "keyup",
    "keydown",
    "keyup",
    "keydown",
    "keyup",
    "keydown",
    "keyup",
    "keydown",
    "keyup",
    "keydown",
    "scrollViewport",
    "keyup",
    "keydown",
    "scrollViewport",
    "scrollViewport",
    "keyup",
    "scrollViewport",
    "keydown",
    "keyup",
    "keydown",
    "input",
    "keyup",
    "scrollElement",
    "scrollElement",
    "scrollElement"
  ],
  "dataPlane": [
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousemove",
    "mousedown",
    "focus",
    "mouseup",
    "blur",
    "wheel",
    "wheel",
    "mousemove",
    "mousedown",
    "focus",
    "mouseup",
    "keydown",
    "keyup",
    "keydown",
    "keyup",
    "keydown",
    "keyup",
    "keydown",
    "keyup",
    "keydown",
    "keyup",
    "keydown",
    "scrollViewport",
    "keyup",
    "keydown",
    "scrollViewport",
    "scrollViewport",
    "keyup",
    "scrollViewport",
    "keydown",
    "keyup",
    "keydown",
    "input",
    "keyup",
    "scrollElement",
    "scrollElement",
    "scrollElement"
  ],
  "rejected": [],
  "scrollEchoHit": 0,
  "scrollEchoKinds": [],
  "scrollIntentSent": 9,
  "scrollDiffApply": 5,
  "programmaticSuppress": 0
}
```

## Front hop histogram
```json
{
  "client_recv": 866,
  "client_apply": 953,
  "client_sent": 46,
  "lifecycle": 132,
  "syncUrl": 2,
  "cssom/sheetList": 1
}
```

## Primary desync hypothesis
```json
null
```