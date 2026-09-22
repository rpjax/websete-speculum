!roteiro  1
!schema  019b629d0cc8374708a62af3177a1f22d06dd0b817a22a32db6dd34a61137142
!seed  1
@0
> host.process.attach  p1
> host.viewport.open  v1 f1 1280x720
< patch  d1 seq=1 20010000000400040068746d6c
@4
> frame.load.start  f1
@120
> frame.document.install  f1 d1 process=p1
> frame.load.stop  f1 ok
@121
> doc.child.insert  d1 parent=n1 child=n2
@150
< patch  d1 seq=2 200200000001000300646976400100000000000000010002000000
