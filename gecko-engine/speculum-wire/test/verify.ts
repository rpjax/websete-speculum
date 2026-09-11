import { readFileSync, writeFileSync } from 'node:fs';
import { decodeFramePart, PersistentStringTable } from '../../../packages/page-projection/src/core/decode';
import {
  h64Str, h64U32, hashName, hashValue, hashAttr, hashProp, hashNs, hashShadowInit,
  computeRowHash, TableHashTracker,
} from '../../../packages/page-projection/src/core/rowHash';
import { ElementNs } from '../../../packages/page-projection/src/core/elementNs';
import { NodeKind } from '../../../packages/page-projection/src/core/opcodes';

const bytes = new Uint8Array(readFileSync(process.env.SPECULUM_OUT + '/frame.bin'));
const res = decodeFramePart(bytes, new PersistentStringTable());
if (!res.ok) {
  console.error('DECODE FALHOU:', res.reason, res.message);
  process.exit(1);
}
const part = res.part;

// hashes recomputados com o MESMO codigo do cliente
const contentHtml = (hashNs(ElementNs.Html) + hashName('html') + hashAttr('lang', 'pt-BR')) & 0xffffffffffffffffn;
const t = new TableHashTracker();
t.upsert(2, computeRowHash(2, NodeKind.Element, 1, 0, contentHtml));
const contentText = hashValue('olá \u{1F600} mundo');
t.upsert(4, computeRowHash(4, NodeKind.Text, 3, 0, contentText));

const hashes = {
  h64Str_abc: h64Str('abc').toString(),
  h64U32_305419896: h64U32(305419896).toString(),
  hashName_class: hashName('class').toString(),
  hashValue_utf8: hashValue('olá \u{1F600}').toString(),
  hashAttr: hashAttr('data-x', '1').toString(),
  hashPropStr: hashProp(1, 'valor').toString(),
  hashPropBool: hashProp(2, true).toString(),
  hashNs_svg: hashNs(ElementNs.Svg).toString(),
  hashNs_custom: hashNs(ElementNs.Custom, 'urn:speculum:test').toString(),
  hashShadowInit: hashShadowInit(1, 3).toString(),
  rowHash: computeRowHash(2, 1, 1, 0, contentHtml).toString(),
  tableHash: t.value.toString(),
};

writeFileSync(process.env.SPECULUM_OUT + '/decoded.json', JSON.stringify({
  header: {
    contextId: part.contextId, generation: part.generation, sequence: part.sequence,
    partIndex: part.partIndex, partCount: part.partCount,
    preTableHash: part.preTableHash.toString(), resync: part.flags?.resync ?? null,
  },
  opCount: part.ops.length,
  ops: part.ops,
}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
writeFileSync(process.env.SPECULUM_OUT + '/hashes_ts.json', JSON.stringify(hashes, null, 2));
console.log('decode OK — ops:', part.ops.length);
