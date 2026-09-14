# 17 — Runtime de projeção

**Status:** ESTABELECIDO. Fecha a forma do lado browser e da ponte com o supervisor.
Substitui, onde divergir, o arranjo descrito em `16-multiprocesso.md` §3.

---

## 1. O modelo

```
caller  ──sobe──>  supervisor
                       │
                    sobe o processo do browser e espera a conexão de controle
                       │
browser sobe  ──abre a ponte──>  socket local
                       │
   ponte = link vital, independente de navegação. Ela cai, tudo cai.
                       │
   TODA comunicação passa por ela: controle, frames, input.
                       │
   No browser, tudo converge para UM ponto: o runtime de projeção,
   instalado no processo base. Os frames sobem até ele; ele coordena o
   algoritmo no browser e é o único ponto de contato com o supervisor.
```

O princípio que sustenta cada fronteira: **cada lado pode ser trocado sem o outro
saber.** O supervisor não conhece o Gecko; o Gecko não conhece .NET; o consumidor
não conhece nenhum dos dois.

---

## 2. Socket, não interop

Nada de P/Invoke, ponteiro compartilhado ou interop de qualquer espécie entre o
supervisor e o browser.

Interop soldaria o .NET ao ABI do Gecko: acoplamento de build, de versão, de ciclo
de vida e de falha. Um segfault no browser derrubaria o supervisor — e a regra
"caiu = morre" (`15-vida-da-sessao.md`) viraria frase vazia, porque não haveria
queda observável, haveria memória corrompida.

Com socket a fronteira é explícita, observável e testável. O supervisor nunca
inclui header do Gecko; o browser nunca carrega runtime .NET. É também o que
permite ao lab ser consumidor de verdade da mesma interface que o Live consome,
em vez de arnês paralelo.

Unix domain socket ou loopback TCP é indiferente — o que importa é ser socket.

---

## 3. A ponte é vital e independente de navegação

A vida da sessão é a vida da ponte, não a da página.

Se a ponte dependesse de navegação, cada carregamento seria evento de ciclo de
vida, e não haveria onde pôr o controle que precisa existir **antes** de existir
conteúdo — que é exatamente o `ContextCreate`.

Consequência dura: a ponte é estabelecida na inicialização do processo base,
antes de qualquer contexto. Falhar em estabelecê-la é fatal para o browser: um
browser vivo sem supervisor é o estado órfão que `15-vida-da-sessao.md` proíbe.

Erro real cometido e corrigido: a ponte conectava preguiçosamente, na primeira
emissão de frame. Isso é circular — o primeiro frame só existe depois de um
`ContextCreate`, que só chega pela ponte. O nome do componente
(`SpeculumFrameSink`) foi o que produziu a decisão errada; renomeado para
`SpeculumSupervisorLink`.

---

## 4. Um canal só

Controle, frames e input trafegam pela mesma ponte.

Dois canais seriam dois domínios de falha e um problema de ordenação entre eles.
Um canal só dá uma ordem, uma queda, e um lugar para observar e medir.

Isso impõe que o transporte seja otimizado para alta vazão — `Input` sozinho é
60–120 msg/s (`12-ponte-controle-vocabulario.md` §1), e latência de input é a
qualidade percebida da projeção inteira. Daí o controle ser **binário**, não
texto (ver `18-abi-controle.md`).

---

## 5. Um ponto de convergência

Processo de conteúdo é plural e efêmero. Identidade, sequência e política não
podem morar lá.

O runtime no processo base é o que faz o supervisor falar com **uma** coisa em vez
de com N produtores, e é o que torna o lado browser substituível. É a mesma
inversão do `NodeSource`: o motor não sabe que está sendo projetado; um componente
sabe.

---

## 6. O que o runtime possui

`SpeculumProjectionRuntime`, singleton do processo base:

- a ponte com o supervisor (transporte + codec)
- o registro de contextos: `contextId ->` janela chrome + BrowsingContext de
  conteúdo viva. O `contextId` da aba projetada **mora no campo sincronizado
  `SpeculumContextId` da BrowsingContext**, carimbado no `ContextCreate`. Não há
  mapa paralelo por processo nem replay IPDL: qualquer processo que hospedar a
  aba — inclusive o que nasce numa troca, e a BrowsingContext **nova** que o
  Gecko cria no `ReplacedBy` (bfcache, remoteness, COOP) — lê o mesmo campo.
- a escuta de progresso da aba (`nsIWebProgress` da Canonical): `ContextCreated`
  quando a aba está quieta, `Navigated` no commit da carga pedida (START+STOP,
  não o STOP da carga anterior), `LoadStateChanged` no vai-e-vem da rede
- a entrada de frames vindos dos processos de conteúdo
- o vocabulário de controle nos dois sentidos (`12-ponte-controle-vocabulario.md`)
- o ciclo de vida da sessão

Tudo o mais é chamador fino: `ContentParent::RecvSpeculumFrame` entrega ao runtime
e nada mais. O produtor, no processo de conteúdo, lê `GetSpeculumContextId()` no
topo da aba e não julga documento nenhum.

### Identidade

O `contextId` aparece no envelope e no prefixo do frame. Não são duas verdades:
o runtime é a fonte única e carimba as duas cópias. O envelope existe porque o
supervisor precisa rotear sem abrir o frame (`11-supervisor-linguagem.md` §9); o
prefixo existe porque o cliente precisa do id. Resolve-se por posse, não por
deleção.

---

## 7. Custo conhecido

O ponto de convergência é ponto de serialização: todo frame de todo processo de
conteúdo passa por uma agulha. É onde o volume vai aparecer primeiro.

Isto não muda o desenho — a alternativa acopla tudo — mas está registrado para que
a medição do item **O** (backlog de `07-decisoes-pendentes.md`) inclua
explicitamente essa agulha.

---

## 8. Descartados

**8.1 Interop / P/Invoke entre supervisor e browser.** §2.

**8.2 Canal separado para frames.** Fere §4 e reintroduz o problema de ordenação
entre planos.

**8.3 Ponte estabelecida sob demanda (na primeira emissão de frame).** Circular,
§3.

**8.4 Produtor decidindo o que projetar.** O C++ não julga documento; ele consulta
um registro que alguém preencheu. Fechado em `12-ponte-controle-vocabulario.md` e
reafirmado aqui.

**8.5 Bandeira de modo no supervisor (ex. manter-se vivo entre sessões para
facilitar o lab).** Ramificação faz o lab exercitar um supervisor diferente do de
produção — lab que testa outro binário é falso positivo por construção. Nenhuma
variável de ambiente muda comportamento; todas são parâmetro de lançamento.

---

## 9. Correções de rota

Decisões tomadas durante a implementação sem consulta, e o que aconteceu com elas.
Registradas para não serem reabertas nem repetidas.

| # | Decisão | Veredito |
|---|---------|----------|
| 1 | Controle em JSON UTF-8 | **Revertida.** Alta vazão com input no mesmo canal exige binário. Ver `18-abi-controle.md`. |
| 2 | Supervisor sobe o browser | **Mantida.** É o modelo. Quando o orquestrador existir, ele sobe o par; o supervisor continua sendo pai do browser. |
| 3 | Supervisor espera um consumidor atado antes de lançar o browser | **Revertida.** O supervisor espera a **ponte de controle**, não consumidor. A corrida de bootstrap se resolve com resync, não atrasando o lançamento. |
| 4 | `contextId` no envelope além do prefixo | **Mantida.** §6 — posse, não duplicação. |
| 5 | Bandeira `SPECULUM_SUPERVISOR_KEEPALIVE` | **Removida.** §8.5. |
| 6 | Conectar a ponte na primeira emissão de frame | **Revertida.** §3. |
| 7 | Reaproveitar o cliente projetado do lab TypeScript sem cópia nem fork | **Mantida.** O lab .NET fala o lab protocol v1 e serve o mesmo artefato. |
