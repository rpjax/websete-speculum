# Sessão mínima: abrir viewport, navegar, primeira mutação, um patch.
!roteiro 1
!schema  0000000000000000
!seed    1

@0
> host.process.attach      p1
> link.in                  ViewportOpen  session  extent=1280x720  corr=1
< link.out                 ViewportOpened v1      rootFrame=f1     corr=1
> host.viewport.open       v1 f1 1280x720
< link.out                 FrameAttached  f1      parent=0 viewport=v1

@4
> link.in                  Navigate f1 url="https://example.com" corr=2
> frame.load.start         f1
< link.out                 LoadStateChanged f1 state=Started

@120
> frame.document.install   f1 d1 process=p1
< link.out                 DocumentInstalled f1 document=d1
> frame.load.stop          f1 ok
< link.out                 Navigated f1 url="https://example.com" corr=2
< link.out                 LoadStateChanged f1 state=Stopped

# Primeira mutação arma o relógio; nada sai ainda.
@121
> doc.child.insert         d1 parent=n1 child=n5
< clock.arm                t1 +16

@137
> clock.fire               t1
< patch                    d1 seq=1 0a01050100000003646976

# Halt: mutações acumulam, nada sai. Prova a coalescência.
@140
> link.in                  ClocksHalt f1 scope=Subtree
@141
> doc.child.insert         d1 parent=n5 child=n6
@142
> doc.attr                 d1 n6 ns=0 name=class
@143
> doc.text                 d1 n6

# Um flush, um patch — com as três mutações dentro.
@150
> link.in                  Flush d1
< patch                    d1 seq=2 0a010601050000000373 70616e0b0601050c0601
