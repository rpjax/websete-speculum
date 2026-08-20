import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldApplyAttrs } from './applyAttrs';
import type { IsoJournal } from './iso';

function isAboutBlank(href: string): boolean {
  return href === 'about:blank' || href.startsWith('about:blank') || href === '';
}

/** Same-origin iframe: tree iso must enter the nested document; Projected must stay blank. */
export function foldIframeOpen(chassis: LabChassis): LabVerdict[] {
  const verdicts = foldApplyAttrs(chassis);
  const iso = chassis.journal.iso as IsoJournal | undefined;
  if (!chassis.hasClientRelay) {
    verdicts.push({
      id: 'iso.nested',
      status: 'fail',
      reason: 'no DOM client — nested apply unproven',
    });
    return verdicts;
  }

  const nested = chassis.journal.nestedEvidence ?? iso?.nested ?? null;
  const virtualDocs = nested?.virtualDocs ?? 0;
  const clientDocs = nested?.clientDocs ?? 0;
  if (virtualDocs === 0) {
    verdicts.push({
      id: 'iso.nested',
      status: 'fail',
      reason: 'virtual tree has no nested document (light-only snapshot)',
    });
  } else if (clientDocs === 0) {
    verdicts.push({
      id: 'iso.nested',
      status: 'fail',
      reason: 'Projected nested apply never armed (no inner document)',
    });
  } else if (chassis.journal.nestedEvidence && !chassis.journal.nestedEvidence.treeIdenticalWhileNested) {
    verdicts.push({
      id: 'iso.nested',
      status: 'fail',
      reason: `nested tree diverged (${chassis.journal.nestedEvidence.treeDivergencesWhileNested})`,
    });
  } else {
    verdicts.push({
      id: 'iso.nested',
      status: 'pass',
      reason: `virtualDocs=${virtualDocs} clientDocs=${clientDocs}`,
    });
  }

  const hrefs = nested?.clientFrameHrefs ?? [];
  const navigated = hrefs.filter((h) => !isAboutBlank(h));
  if (navigated.length > 0) {
    verdicts.push({
      id: 'iso.nested.blank',
      status: 'fail',
      reason: `Projected navigated live src: ${navigated.join(', ')}`,
    });
  } else if (clientDocs > 0) {
    verdicts.push({
      id: 'iso.nested.blank',
      status: 'pass',
      reason: 'Projected host stayed about:blank',
    });
  }

  const contextIds = chassis.contextIndex.list().filter((id) => id >= 2);
  if (contextIds.length > 0) {
    const contexts = iso?.contexts ?? {};
    for (const id of contextIds) {
      const ctx = contexts[id];
      const tableOk = ctx?.table?.identical === true;
      const treeOk = ctx?.structuralDiff?.identical === true;
      if (!ctx || !tableOk || !treeOk) {
        verdicts.push({
          id: `iso.context.${id}.nested`,
          status: 'fail',
          reason: ctx ? 'table or tree mismatch for nested context' : 'missing iso for nested context',
        });
      } else {
        verdicts.push({
          id: `iso.context.${id}.nested`,
          status: 'pass',
          reason: 'nested context iso ok',
        });
      }
    }
  }

  return verdicts;
}
