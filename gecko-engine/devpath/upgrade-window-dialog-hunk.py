#!/usr/bin/env python3
"""Upgrade the old SpeculumAskAndWait window hunk to SpeculumTryAskDialog."""
from pathlib import Path
import sys

p = Path(sys.argv[1])
t = p.read_text()
if "SpeculumTryAskDialog" in t:
    print("window dialog hunk already applied")
    sys.exit(0)

old_alert = """void nsGlobalWindowInner::Alert(const nsAString& aMessage,
                                nsIPrincipal& aSubjectPrincipal,
                                ErrorResult& aError) {
  if (mozilla::dom::BrowsingContext* bc = GetBrowsingContext()) {
    const uint32_t ctx = bc->GetSpeculumContextId();
    if (ctx) {
      nsAutoCString desc;
      CopyUTF16toUTF8(aMessage, desc);
      nsAutoCString ans;
      (void)SpeculumAskAndWait(ctx, SpeculumAskKind::Dialog, desc, ans);
      return;
    }
  }
  FORWARD_TO_OUTER_OR_THROW(AlertOuter, (aMessage, aSubjectPrincipal, aError),
                            aError, );
}"""
new_alert = """void nsGlobalWindowInner::Alert(const nsAString& aMessage,
                                nsIPrincipal& aSubjectPrincipal,
                                ErrorResult& aError) {
  nsAutoCString ans;
  if (SpeculumTryAskDialog(GetBrowsingContext(), aMessage, ans)) {
    return;
  }
  FORWARD_TO_OUTER_OR_THROW(AlertOuter, (aMessage, aSubjectPrincipal, aError),
                            aError, );
}"""
old_confirm = """bool nsGlobalWindowInner::Confirm(const nsAString& aMessage,
                                  nsIPrincipal& aSubjectPrincipal,
                                  ErrorResult& aError) {
  if (mozilla::dom::BrowsingContext* bc = GetBrowsingContext()) {
    const uint32_t ctx = bc->GetSpeculumContextId();
    if (ctx) {
      nsAutoCString desc;
      CopyUTF16toUTF8(aMessage, desc);
      nsAutoCString ans;
      if (!SpeculumAskAndWait(ctx, SpeculumAskKind::Dialog, desc, ans)) {
        return false;
      }
      return ans.EqualsLiteral("1") || ans.EqualsLiteral("ok") ||
             ans.EqualsLiteral("true") || ans.EqualsLiteral("allow");
    }
  }
  FORWARD_TO_OUTER_OR_THROW(ConfirmOuter, (aMessage, aSubjectPrincipal, aError),
                            aError, false);
}"""
new_confirm = """bool nsGlobalWindowInner::Confirm(const nsAString& aMessage,
                                  nsIPrincipal& aSubjectPrincipal,
                                  ErrorResult& aError) {
  nsAutoCString ans;
  if (SpeculumTryAskDialog(GetBrowsingContext(), aMessage, ans)) {
    return ans.EqualsLiteral("1") || ans.EqualsLiteral("ok") ||
           ans.EqualsLiteral("true") || ans.EqualsLiteral("allow");
  }
  FORWARD_TO_OUTER_OR_THROW(ConfirmOuter, (aMessage, aSubjectPrincipal, aError),
                            aError, false);
}"""
old_prompt = """void nsGlobalWindowInner::Prompt(const nsAString& aMessage,
                                 const nsAString& aInitial, nsAString& aReturn,
                                 nsIPrincipal& aSubjectPrincipal,
                                 ErrorResult& aError) {
  if (mozilla::dom::BrowsingContext* bc = GetBrowsingContext()) {
    const uint32_t ctx = bc->GetSpeculumContextId();
    if (ctx) {
      nsAutoCString desc;
      CopyUTF16toUTF8(aMessage, desc);
      nsAutoCString ans;
      if (SpeculumAskAndWait(ctx, SpeculumAskKind::Dialog, desc, ans)) {
        CopyUTF8toUTF16(ans, aReturn);
      }
      return;
    }
  }
  FORWARD_TO_OUTER_OR_THROW(
      PromptOuter, (aMessage, aInitial, aReturn, aSubjectPrincipal, aError),
      aError, );
}"""
new_prompt = """void nsGlobalWindowInner::Prompt(const nsAString& aMessage,
                                 const nsAString& aInitial, nsAString& aReturn,
                                 nsIPrincipal& aSubjectPrincipal,
                                 ErrorResult& aError) {
  nsAutoCString ans;
  if (SpeculumTryAskDialog(GetBrowsingContext(), aMessage, ans)) {
    CopyUTF8toUTF16(ans, aReturn);
    return;
  }
  FORWARD_TO_OUTER_OR_THROW(
      PromptOuter, (aMessage, aInitial, aReturn, aSubjectPrincipal, aError),
      aError, );
}"""

for name, old, new in (
    ("Alert", old_alert, new_alert),
    ("Confirm", old_confirm, new_confirm),
    ("Prompt", old_prompt, new_prompt),
):
    if old not in t:
        sys.stderr.write(f"FALHOU: hunk antigo de {name} nao encontrado\n")
        sys.exit(1)
    t = t.replace(old, new, 1)
p.write_text(t)
print("window dialog hunk upgraded to SpeculumTryAskDialog")
