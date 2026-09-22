!roteiro  1
!schema  019b629d0cc8374708a62af3177a1f22d06dd0b817a22a32db6dd34a61137142
!seed  1
@0
> host.process.attach  p1
> host.viewport.open  v1 f1 1280x720
@4
> frame.load.start  f1
@120
> frame.document.install  f1 d1 process=p1
> frame.load.stop  f1 ok
@121
> doc.child.insert  d1 parent=n1 child=n2
> doc.attr  d1 n2 name=class value=a
> doc.child.insert  d1 parent=n1 child=n3
> doc.text  d1 n3
