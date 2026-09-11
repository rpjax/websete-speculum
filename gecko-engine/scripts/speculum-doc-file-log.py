#!/usr/bin/env python3
from pathlib import Path

p = Path("/root/speculum-gecko/checkout/dom/base/Document.cpp")
text = p.read_text()
old = """    const char* proc = XRE_IsParentProcess() ? "pai" : "conteudo";
    printf_stderr(
        "[SPECULUM-DOC] pid=%d | proc=%s | uri=%s | contentDoc=%d | "
        "chromeShell=%d | bcIsContent=%d | systemPrincipal=%d | hasParentDoc=%d "
        "| root=%d\\n",
        getpid(), proc, uri.get(), IsContentDocument() ? 1 : 0,
        IsInChromeDocShell() ? 1 : 0, bcIsContent,
        NodePrincipal()->IsSystemPrincipal() ? 1 : 0, hasParentDoc ? 1 : 0,
        hasParentDoc ? 0 : 1);
"""
new = """    const char* proc = XRE_IsParentProcess() ? "pai" : "conteudo";
    mkdir("/tmp/speculum-docs", 0777);
    char logPath[128];
    const pid_t pid = getpid();
    snprintf(logPath, sizeof(logPath), "/tmp/speculum-docs/%d.log",
             static_cast<int>(pid));
    if (FILE* fp = fopen(logPath, "a")) {
      fprintf(
          fp,
          "[SPECULUM-DOC] pid=%d | proc=%s | uri=%s | contentDoc=%d | "
          "chromeShell=%d | bcIsContent=%d | systemPrincipal=%d | hasParentDoc=%d "
          "| root=%d\\n",
          static_cast<int>(pid), proc, uri.get(), IsContentDocument() ? 1 : 0,
          IsInChromeDocShell() ? 1 : 0, bcIsContent,
          NodePrincipal()->IsSystemPrincipal() ? 1 : 0, hasParentDoc ? 1 : 0,
          hasParentDoc ? 0 : 1);
      fclose(fp);
    }
"""
if old not in text:
    raise SystemExit("expected printf_stderr block not found")
text = text.replace(old, new, 1)
if "#include <unistd.h>" not in text:
    text = text.replace("#include <cstdio>\n", "#include <cstdio>\n#include <unistd.h>\n", 1)
p.write_text(text)
print("ok")
