// Lado TS da paridade da tabela: MESMO roteiro, rodado no ReplicatedTable de produção.
import { readFileSync, writeFileSync } from 'node:fs';
import { ReplicatedTable } from '../../../packages/page-projection/src/core/replicatedTable';
import { ElementNs } from '../../../packages/page-projection/src/core/elementNs';

const OUT = process.env.SPECULUM_OUT ?? '/tmp/speculum-wire';
const script = readFileSync(new URL('./table_script.txt', import.meta.url), 'utf8');

const t = new ReplicatedTable();
const trace: unknown[] = [];

const parseAttr = (tok: string) => {
  const i = tok.indexOf('=');
  return i < 0 ? { name: tok, value: '' } : { name: tok.slice(0, i), value: tok.slice(i + 1) };
};
const restAfter = (line: string, skip: number) => line.split(/\s+/).slice(skip).join(' ');

const lines = script.split('\n');
for (let n = 0; n < lines.length; n++) {
  const line = lines[n]!.replace(/\r$/, '');
  if (line.length === 0 || line.startsWith('#')) continue;
  const tk = line.split(/\s+/).filter(Boolean);
  const cmd = tk[0]!;
  let children: number[] | null = null;

  switch (cmd) {
    case 'seq':
      t.setSequence(Number(tk[1]));
      break;
    case 'elem': {
      const ns = Number(tk[2]) as ElementNs;
      const attrs = tk.slice(4).map(parseAttr);
      t.createElementRow(Number(tk[1]), tk[3]!, attrs, ns,
        ns === ElementNs.Custom ? 'urn:speculum:test' : undefined);
      break;
    }
    case 'leaf':
      t.createLeafRow(Number(tk[1]), Number(tk[2]), restAfter(line, 3));
      break;
    case 'shadow':
      t.createShadowRootRow(Number(tk[1]), Number(tk[2]), Number(tk[3]), Number(tk[4]));
      break;
    case 'attrset':
      t.setAttrs(Number(tk[1]), tk.slice(2).map(parseAttr));
      break;
    case 'attrdel':
      t.delAttrs(Number(tk[1]), tk.slice(2));
      break;
    case 'text':
      t.setValue(Number(tk[1]), restAfter(line, 2));
      break;
    case 'propstr':
      t.setProp(Number(tk[1]), Number(tk[2]), restAfter(line, 3));
      break;
    case 'propbool':
      t.setProp(Number(tk[1]), Number(tk[2]), tk[3] === '1');
      break;
    case 'insert':
      t.insertBatch(Number(tk[1]), Number(tk[2]), tk.slice(3).map(Number));
      break;
    case 'remove':
      t.removeBatch(Number(tk[1]), tk.slice(2).map(Number));
      break;
    case 'drop':
      t.dropSubtree(Number(tk[1]));
      break;
    case 'children':
      children = t.orderedChildIds(Number(tk[1]));
      break;
    default:
      throw new Error(`comando desconhecido na linha ${n + 1}: ${cmd}`);
  }

  trace.push({ line: n + 1, cmd: line, tableHash: t.tableHash.toString(), size: t.size, children });
}

writeFileSync(`${OUT}/table_ts.json`, JSON.stringify(trace, null, 2));
console.log(`table: ${t.size} linhas, tableHash=${t.tableHash}`);
