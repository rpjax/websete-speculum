import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';

function actOk(chassis: LabChassis, name: string): boolean | null {
  const act = chassis.journal.acts?.find((a) => a.name === name);
  return act ? act.ok : null;
}

/** PP-CSP-SINGLE-TAB — locale popup folded; CSP widened; loopback plane accepts scroll. */
export function foldCspNavLocale(chassis: LabChassis): LabVerdict[] {
  const verdicts: LabVerdict[] = [];

  const landed = actOk(chassis, 'assert-br-title');
  verdicts.push({
    id: 'singleTab.landed',
    status: landed === true ? 'pass' : landed === false ? 'fail' : 'skipped',
    reason:
      landed === true
        ? 'target=_blank folded to BR on primary tab'
        : landed === false
          ? (chassis.journal.acts?.find((a) => a.name === 'assert-br-title')?.error ??
            'still on EN or wrong document')
          : 'assert-br-title not run',
  });

  const csp = actOk(chassis, 'assert-csp-widened');
  verdicts.push({
    id: 'csp.connectSrc',
    status: csp === true ? 'pass' : csp === false ? 'fail' : 'skipped',
    reason:
      csp === true
        ? 'connect-src widened after popup nav'
        : csp === false
          ? (chassis.journal.acts?.find((a) => a.name === 'assert-csp-widened')?.error ??
            'connect-src still blocks loopback WS')
          : 'assert-csp-widened not run',
  });

  const scrollDispatch = actOk(chassis, 'scroll:#scroll-box');
  verdicts.push({
    id: 'plane.scroll',
    status: scrollDispatch === true ? 'pass' : scrollDispatch === false ? 'fail' : 'skipped',
    reason:
      scrollDispatch === true
        ? 'resolveAndScrollElement dispatched (data plane open)'
        : scrollDispatch === false
          ? (chassis.journal.acts?.find((a) => a.name === 'scroll:#scroll-box')?.error ??
            'scroll input rejected')
          : 'scroll-plane not run',
  });

  const scrollApplied = actOk(chassis, 'assert-scroll');
  verdicts.push({
    id: 'plane.scrollApplied',
    status: scrollApplied === true ? 'pass' : scrollApplied === false ? 'fail' : 'skipped',
    reason:
      scrollApplied === true
        ? 'Virtual scrollTop applied on #scroll-box'
        : scrollApplied === false
          ? (chassis.journal.acts?.find((a) => a.name === 'assert-scroll')?.error ??
            'scroll not applied on Virtual')
          : 'assert-scroll not run',
  });

  return verdicts;
}
