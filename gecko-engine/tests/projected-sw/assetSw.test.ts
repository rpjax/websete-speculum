import {
  ASSET_TOKEN_HEADER,
  assetResponseHeaders,
  classifyFetchDestination,
  stampAssetHeaders,
  swReadyMessage,
} from './assetSw.ts';

function fail(msg: string): never {
  console.error('FALHOU:', msg);
  process.exit(1);
}

const ready = swReadyMessage();
if (ready.type !== 'ready') {
  fail('ready.message');
}

const stamped = stampAssetHeaders({ accept: 'image/png' }, 'tok-1');
if (stamped[ASSET_TOKEN_HEADER] !== 'tok-1') {
  fail(`token header: ${stamped[ASSET_TOKEN_HEADER]}`);
}
if (stamped.accept !== 'image/png') {
  fail('header original perdido');
}

const empty = stampAssetHeaders({}, '');
if (ASSET_TOKEN_HEADER in empty) {
  fail('token vazio não carimba header');
}

if (classifyFetchDestination('image') !== 1) {
  fail('dest image');
}
if (classifyFetchDestination('script') !== 11) {
  fail('dest script');
}
if (classifyFetchDestination('weird') !== 0) {
  fail('dest dúvida');
}

const svgHeaders = assetResponseHeaders('tok-1', 'image/svg+xml');
if (svgHeaders['content-type'] !== 'image/svg+xml') {
  fail(`MIME SVG: ${svgHeaders['content-type']}`);
}
if (svgHeaders[ASSET_TOKEN_HEADER] !== 'tok-1') {
  fail('token sumiu com MIME');
}
const pngHeaders = assetResponseHeaders('', 'image/png');
if (pngHeaders['content-type'] !== 'image/png') {
  fail('PNG sem token perdeu MIME');
}
if (ASSET_TOKEN_HEADER in pngHeaders) {
  fail('token vazio no MIME');
}

console.log('ok: SW projected ready + token em header + MIME');
