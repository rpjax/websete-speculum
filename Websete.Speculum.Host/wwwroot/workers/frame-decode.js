'use strict';

let latestSeq = 0;

self.onmessage = (ev) => {
  const { seq, jpeg } = ev.data;
  if (typeof seq !== 'number' || !(jpeg instanceof ArrayBuffer)) return;
  if (seq < latestSeq) return;
  latestSeq = seq;

  createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
    .then((bitmap) => {
      self.postMessage({ seq, bitmap }, [bitmap]);
    })
    .catch((err) => {
      self.postMessage({ seq, error: String(err) });
    });
};

self.onmessageerror = () => {};
