!roteiro  1
!schema  019b629d0cc8374708a62af3177a1f22d06dd0b817a22a32db6dd34a61137142
!seed  1
@0
> host.process.attach  p1
> host.viewport.open  v1 f1 800x600
@4
> frame.load.start  f1
@20
> frame.document.install  f1 d1 process=p1
> frame.load.stop  f1 ok
@21
> doc.child.insert  d1 parent=n1 child=n2
> doc.shadow.attach  d1 host=n2 root=n3
> doc.child.insert  d1 parent=n3 child=n4
> doc.shadow.attach  d1 host=n4 root=n5
@30
> doc.child.insert  d1 parent=n5 child=n6
> doc.child.removing  d1 parent=n5 child=n6
