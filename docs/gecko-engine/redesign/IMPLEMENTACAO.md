# Roteiro de implementação

**Para quem vai escrever o código.** Este doc é o ponto de entrada; os outros 47 são a
especificação.

Ele **não** contém o plano de implementação. O plano de cada fase é escrito por quem
implementa, a partir do objetivo, das leituras e das condições de aceite daqui. Plano escrito
por quem não vai executar envelhece antes do primeiro commit.

---

## 0. Antes de qualquer coisa

**Leia primeiro, nesta ordem, e aplique sempre:**

1. [`AGENTS.md`](../../../AGENTS.md) e [`docs/engineering-standards.md`](../../engineering-standards.md) — a constituição do repositório. **Tudo abaixo é subordinado a ela.**
2. [`docs/assert-failure-policy.md`](../../assert-failure-policy.md) — assert que falha não é amolecido para ficar verde.
3. [`README.md`](README.md) deste diretório — a tese e os sete invariantes.
4. [`07-modelo.md`](07-modelo.md) + [`11-identidade.md`](11-identidade.md) — o modelo e o vocabulário.
5. [`contratos/README.md`](contratos/README.md) — o catálogo.

Três leis do repositório que valem aqui com força total:

- **Nada de código ad-hoc. Jamais.** Se o algoritmo desenhado falha, conserta-se o algoritmo.
  Verde obtido por contorno é defeito de produto.
- **Pronto = último salto vivo**, não arquivo em disco. Codificador sem consumidor, porta sem
  chamador, fake verde com o caminho real morto = **incompleto**. Diga incompleto na primeira
  frase.
- **Assert de efeito, nunca fumaça.** `ok: true` não prova nada.

## 1. O que você NÃO pode decidir sozinho

Se a resposta não está nos docs, **pare e pergunte**. Não invente e não deduza. Esta lista é
o que mais estraga um redesenho:

| não decida | onde está decidido |
|---|---|
| mudar formato de mensagem fora do `schema/speculum.wire.toml` | [08](08-fio.md), [schema](schema/README.md) |
| adicionar opcode, campo ou enum sem passar pelo schema | idem |
| escrever codec à mão em qualquer lado | [schema §7](schema/README.md) |
| adicionar operação de porta sem chamador real | [03 §3.7](03-portas.md) |
| `[[noreturn]]` em `domain/` | [fault](contratos/dominio/fault.md) |
| política no C++: retry, escolha de força de resync, saturação, auto-resposta de diálogo | [11 §4.2](11-identidade.md), [12](12-instrumentacao.md) |
| materializar `NodeDescriptor` como struct | [14 §5.1](14-nodedescriptor.md) |
| passagem coalescedora depois do `emit` | [14 §5.3](14-nodedescriptor.md) |
| tolerar entrada malformada em vez de dessincronizar | `frame-protocol.md` P7 |
| qualquer um dos três números de afinação | [05](05-decisoes-abertas.md) |
| tratar `sim` como arnês descartável | [05](05-decisoes-abertas.md) |

**Regra de ouro:** toda dúvida que você resolveria "com bom senso" é uma dúvida que vira
divergência silenciosa três meses depois. Pergunte.

## 2. Como cada fase funciona

1. Você lê o objetivo, as leituras e o aceite da fase.
2. **Você escreve o plano** e o submete antes de codar.
3. Implementa.
4. O aceite é **mecânico**: roda, ou não roda. Nenhum item de aceite é opinião.
5. Nenhuma fase começa com a anterior amarela.
6. **O gate de uma fase é um comando só**, e ele é alvo do w7s ou script de pacote
   versionado. Script de fase ad-hoc (`scripts/phaseN/*`) não é gate: é lista de
   modificação concorrente disfarçada, e foi exatamente o que apodreceu antes.

**Ordem não é sugestão.** Ela existe porque cada fase constrói a rede que torna a seguinte
verificável em vez de aposta.

---

## FASE 1 — Fundação e fio

**Objetivo:** bytes entram e saem, com codec gerado. Zero motor.

**Ler:** [02](02-camadas.md) · [03](03-portas.md) · [06](06-taxonomia.md) · [08](08-fio.md) · [schema/](schema/README.md) · [fault](contratos/dominio/fault.md) · [wire](contratos/dominio/wire.md)

**Entregar:** layout `domain/ ports/ engines/ host/` · regra de camada no CI · `Fault` + tabela
`actionOf` · tipos de id (`ViewportId`, `HostId`, `Generation`, `Ref<Space>` — identidade de
documento é o par `(HostId, Generation)`, sem mint global) ·
gerador TOML→C++/TS/C# · `Cursor`, `Envelope`, `Framer`, `Limits`.

**Aceite:**
- `grep -rlE '"ns[A-Z]|mozilla/|nsI[A-Z]' domain/ ports/` **falha o build** se casar. Teste que prova o portão fechando.
- As 48 mensagens fazem round-trip nas **três** linguagens.
- Cruzado: C++ codifica → TS e C# decodificam, valores idênticos. E as outras duas permutações.
- Vetores dourados versionados, um por mensagem.
- Cada uma das 7 recusas do gerador ([schema §6](schema/README.md)) tem um teste que a provoca.
- **Propriedade do `Framer`:** para todo particionamento do fluxo — 1 byte, primos, aleatório,
  sobre o mesmo corpus — a sequência de envelopes entregues é **idêntica** à entrega inteira.
- Nenhum `[[noreturn]]` em `domain/`, verificado por grep no CI.

**Proibido:** qualquer coisa de motor; qualquer codec escrito à mão; `retired`, `schema = N`
ou negociação de versão ([schema §9.3](schema/README.md)).

---

## FASE 2 — Sessão

**Objetivo:** a sessão sobe, fala, e morre pelo lugar certo.

**Ler:** [session](contratos/dominio/session.md) · [ILink](contratos/portas/ILink.md) · [IClock](contratos/portas/IClock.md) · [04](04-resiliencia.md)

**Entregar:** `ILink` + `ScriptedLink` (fake) · `IClock` + `ManualClock` · `Session` ·
`LinkWriter` · `Router` · `Correlations` · `Heartbeat` · dump de estado na morte.

**Aceite:**
- `Partial` no meio de um envelope ⇒ escrita completada em laço, envelope íntegro no fio.
- `WouldBlock` sob rajada ⇒ `offer` **não bloqueia** e nada é perdido.
- `Broken` no meio de um envelope ⇒ sessão morre, **zero** byte escrito depois, causa
  registrada **uma** vez; segundo `Broken` não muda nada.
- Enquadramento perdido ⇒ fatal, e nenhum envelope entregue depois.
- `pendingCount() == 0` ao fim de sessão limpa.
- Nenhum byte antes de `Ready`; nenhum depois de `Dead`.
- Com `ManualClock`: N intervalos ⇒ **exatamente** N batidas, `monotonicMs` estritamente
  crescente; zero batida em `Terminating`.
- Tabela de roteamento: para cada opcode do schema, o dono correto é chamado uma vez com os
  argumentos corretos. **O conjunto roteado é exatamente o do schema** — sem buraco, sem sobra.
- Morte fatal emite o dump de estado **antes** de morrer.

**Proibido:** fila de saída; thread de saída; qualquer política de saturação
([session](contratos/dominio/session.md)); `abort` fora de `Session`.

---

## FASE 3 — Engine `sim`

**Objetivo:** a sessão inteira roda sem Gecko.

**Ler:** [07](07-modelo.md) · [11](11-identidade.md) · [documents](contratos/dominio/documents.md) · portas `IEngine*`, `IDocument*`, `IHostObserver`, `IEngineObserver`

**Entregar:** `engines/sim/` implementando todas as portas de motor em memória ·
`Viewports` · `Hosts` (árvore) · `Documents` (posse) · `NavigationState` · raiz de composição
em `host/`.

**Aceite:**
- **O mesmo roteiro aplicado à raiz e a um host de terceiro nível produz a mesma sequência de
  efeitos.** É a prova mecânica de que não há caso especial.
- Três viewports simultâneos, com árvores diferentes, pelo mesmo código.
- Matar um processo com três documentos, dois com filhos em processo vivo: três fechamentos,
  **sem duplicata**, subárvore fechada por regra única, ordem `onProcessGone` **depois** dos
  documentos.
- `NavigationState`: as oito linhas da tabela de transição, mais as sequências maldosas —
  STOP da carga anterior depois do START da nova; location sem start; start-stop-start no
  mesmo intervalo; segundo `navigate` antes do primeiro comitar (**correlação anterior
  cancelada e esquecida**, `pendingCount()` fecha).
- Transição fora da tabela é assert, em **um** lugar.
- `checkInvariants()` de `Hosts` e `Documents` verde a cada fronteira de comando.
- Teste da raiz de composição: grafo real montado com `sim`, toda porta ligada, nenhuma nula.

**Proibido:** qualquer `if` que pergunte "é a raiz?"; mint global de documento; `IEngineHost`
com lógica de conteúdo.

---

## FASE 4 — Produtor

**Objetivo:** patches saem, corretos e em lote, sobre o `sim`.

**Ler:** [14](14-nodedescriptor.md) **inteiro** · [projection](contratos/dominio/projection.md) · `docs/page-projection/spec/frame-protocol.md` (**P0–P8 são lei**)

**Entregar:** `NodeDescriptor` (interface) + `LiveDescriptor` + `RowDescriptor` ·
`Identity` · `DirtyLedger` nas duas formas · `emit(prev, curr, mask)` · `PatchClock` ·
`PatchBuilder` · `PatchSequence` · `Digest` · `Resync` · `Snapshot` · `Policy` ·
`IPatchUplink` + fake.

**Aceite:**
- `halt` + N mutações + `resume` ⇒ **exatamente um** patch contendo as N.
- Segurar `isDrained()` por N intervalos ⇒ **um** patch, não N. (A coalescência que substitui a fila.)
- **Pós-condição por campo verde em todo tick**: `table.fieldHash[id][campo]` == hash lido do vivo.
- Corrida de K irmãos novos sob o mesmo pai ⇒ **um** `INSERT`, `before` calculado **uma** vez.
  Custo por op **plano** de K=100 a K=1600 (é o defeito O(N²) do `resolvedBefore`, e ele não
  pode voltar).
- `emit` é função pura: mesmos descritores, mesmos `RowChanges`, sempre. Testado por
  propriedade sobre pares gerados.
- `aplicar(emit(prev,curr))` ⇒ `d(VTR) == curr`. Fuzz sobre pares de descritores.
- Partida a frio e resync usam **o mesmo** `emit` com `prev = nullptr`. Verificado por
  cobertura: não existe ramo de ciclo de vida.
- Dois snapshots consecutivos sem mutação: **byte-idênticos**.
- `Policy`: tabela-verdade **completa**, produto cartesiano.
- `Digest` estável entre C++ e TS sobre o mesmo roteiro.
- Estado derivado (`nextSiblingOf`, `lastChildOf`) conferido por `checkInvariants()` —
  falsificadores de `OPEN-7` e `OPEN-8` como testes de regressão.

**Proibido:** descritor materializado; coalescedor como passagem; lista de filhos no
descritor; marcar nó sujo sem o campo; `emit` emitindo lote diretamente.

---

## FASE 5 — Roteiro

**Objetivo:** bug vira arquivo.

**Ler:** [roteiro/](roteiro/README.md) · [09](09-observabilidade.md)

**Entregar:** gravador decorando **toda** porta · runner `check` e `record` · símbolos
sequenciais · blobs · span de causa.

**Aceite:**
- Roteiro gravado reexecuta **byte-idêntico**.
- Dois roteiros do mesmo cenário são idênticos byte a byte (símbolos, não endereços).
- **Um** arquivo serve `check` e `record` — se precisar de dois formatos, o desenho quebrou.
- As cinco condições de [roteiro §6](roteiro/README.md) verificadas por teste, não por leitura.
- `!schema` divergente ⇒ replay **recusa**.
- Divergência aponta a **primeira** linha `<` que não bate.
- Gravador desligado: bytes de saída idênticos ao de gravador ausente.

**Proibido:** formato binário; arquivos separados de entrada e esperado; evento genérico.

---

## FASE 6 — Oráculo

**Objetivo:** estabelecer o produtor.

**Ler:** [12](12-instrumentacao.md) · [13](13-oraculo-global.md) · [14 §5.4](14-nodedescriptor.md)

**Entregar:** `IStateFreezer` · `IStateCapture` · `IReconstructor` (**puro**) ·
`IProjectionOracle` · sondas · métricas embutidas · toggles por capacidade.

**Aceite:**
- Congelamento parcial ⇒ captura **recusada** com `HaltIncomplete`. Nunca veredito sobre
  retrato inconsistente.
- **Ida:** `d(VN)` fresco × `d(VTR)` armazenado, por nó, sobre todos os hosts.
- **Volta:** reconstrução × varredura ingênua, com os **três** baldes.
- Livro-razão de exclusões impresso e revisável.
- Veredito traz os **cinco**: oráculo, linha+campo, mutação causadora, sequence+generation,
  trecho de roteiro. Booleano é reprovação do próprio oráculo.
- `IReconstructor` compila e é testado **sem nenhuma porta de motor**.
- Defeito injetado deliberadamente (uma linha, um campo) é pego, e o veredito aponta **aquela**
  linha e **aquele** campo.
- Telemetria ligada × desligada: bytes de patch **idênticos**.
- Sonda desabilitada responde `ProbeDisabled`. Nenhuma sonda tem efeito colateral.
- Toda capacidade liga por parâmetro de lançamento, individualmente. Preset imprime a lista.

**Proibido:** comparar tabela com DOM por função semântica; congelar host por host; sonda como
caminho de produto; nível em vez de toggle.

---

## FASE 7 — Fixtures

**Objetivo:** a rede que torna a Fase 8 um refactor e não uma aposta.

**Ler:** [12 §6](12-instrumentacao.md)

**Entregar:** as sete classes de fixture · runner contínuo · relatório.

**Aceite:**
- Todas verdes com **todas** as capacidades de oráculo ligadas.
- O roteiro de cada uma reexecuta byte-idêntico no `sim`.
- As adversárias incluem, nomeadamente: `prepend-stress`, `insert-before-remove`, folha por
  `<link>` sem `RuleAdded`, host nascendo e morrendo no mesmo intervalo, navegação sob carga
  com sujeira pendente.
- **Todo defeito encontrado desta fase em diante vira fixture, permanentemente.** Sem exceção.
- Custo por op **plano** com o tamanho do lote, medido, não afirmado.

**Proibido:** amolecer fixture para ficar verde ([assert-failure-policy](../../assert-failure-policy.md)).

**Entregue:** `tests/phase7/fixtures/` (sete classes + adversárias nomeadas) · `SpecDriver` ·
gate da fase (ver §2).

---

## FASE 8 — Adaptador Gecko

**Objetivo:** o primeiro contato com libxul — com rede embaixo.

**Pré-condição (bloqueante):** `w7s gecko make gecko-binary` fecha do zero, por um comando
só, sem script auxiliar. Verificação: `.w7s/state.json` tem `artifacts.gecko-binary` com
fingerprint; uma segunda corrida reporta *current* sem rebuild forçado; `--dry-run` sobre
`gecko-source` reporta zero escritas; nenhum `scripts/**` e nenhum `*.py` de apply/fix/patch
participa do caminho. **Enquanto isso não estiver verde, a Fase 8 não começa.** O que falha
antes disso é ferramenta de build, não adaptador, e o conserto vai no w7s ou em
`modifications/` — nunca em script de fase.

**Ler:** [ITERACAO-06](iteracoes/ITERACAO-06-gecko-real.md) · [IDocumentView](contratos/portas/IDocumentView.md) · [02 §4](02-camadas.md)

**Entregar:** `engines/gecko/` implementando as mesmas portas.

**Aceite:**
- **Zero referência forte a nó.** Ponteiro cru limpo em `NodeWillBeDestroyed`. Verificado por
  `mach gtest SpeculumPhase8.*` (teardown + cycle collector → `RawNodeMap` vazio; CSSOM/StyleSheet
  limpos no A9), não por leitura.
- Tabela de CSSOM possuída pelo **processo**, nunca pelo documento (A2).
- Shadow root anexado **recursivamente**; fixture `aninhamento/nested-shadow.spec` + A3.
- Nenhuma operação na cola xul (`engines/gecko/xul/*`) menciona APIs de entrada de script —
  gate textual `scripts/ci/assert-observer-no-script.sh` (não grafo transitivo de includes).
- **Incapacidade de política:** `engines/gecko/**` não inclui `domain/producer/Policy.hpp`
  (único header de política em [02 §1](02-camadas.md) sob `producer/`). Mesmo gate textual.
- A suíte da Fase 7 verde sobre `engines/gecko`: `mach gtest SpeculumPhase7.*` (único sítio;
  não há A7 no Phase8).

**Proibido:** lógica no adaptador; `RefPtr` de nó; qualquer atalho "só para subir".

**Entregue:** `engines/gecko/` nas mesmas portas · cola `nsI*` em `engines/gecko/xul/` ·
`RawNodeMap` / `CssomTable` no processo · `MutationBridge` · w7s `modifications/`
(`dom/speculum` + install `dom/moz.build`) · `tests/phase7/FixtureSuite.hpp` (corpo único;
host Sim + gtest Gecko) · gate `gecko-binary` + `mach gtest SpeculumPhase7.*` +
`mach gtest SpeculumPhase8.*`, executado pelo w7s. Sem script de fase.

**Porta =** `ports/*.hpp` (não o markdown visitor).

**Sistema de arquivos:** o w7s recusa aplicar `modifications/` sobre árvore em drive Windows.
Manifesto e árvore vivem em filesystem WSL, com bind-mount real do host WSL — o que exige a
integração WSL do Docker Desktop ligada para a distro. Named volume alimentado por cópia
(`tar`/`rsync`) é contorno e não fecha a fase.

---

## FASE 9 — Paridade e corte

**Objetivo:** os dois motores concordam, e o cliente acompanha.

**Ler:** [01](01-alvo.md) · [10](10-o-que-falta.md)

**Entregar:** oráculo `sim × gecko` · cliente TS sobre o schema gerado · corpus de
comportamento reexecutado.

**Aceite:**
- **Mesmo roteiro ⇒ mesmos bytes em `sim` e `gecko`.** Cada lado ainda passa o oráculo
  (Fase 7 = fidelidade por motor; Fase 9 = acordo + oráculo nos dois — dois errados iguais
  falham). Cenário excluído exige `SPECULUM_PHASE9_ALLOW_EXCLUSIONS=1` e motivo em
  `exclusions.txt`; `compared == 0` ou linha malformada = fail. Gate: `npm run ci:all`
  (`tests/phase9/WireParity.hpp`).
- Cliente TS usa **o codec gerado**, sem uma linha escrita à mão no envelope (`speculum_wire.gen.ts`
  via `packages/page-projection/src/wire/`; `ProjectionClient.ingest` → `decodeSchemaPatchMessage`).
  ISA em `Patch.deltas` permanece o frame-protocol.
- `d(PTR) == d(PN)` no cliente — `checkPtrEqualsPn` / `assertDescriptors` ([14 §3](14-nodedescriptor.md)).
- Paridade de `Digest` C++ × TS: `digest_vectors.json` + `assert-digest-parity.sh` +
  `SpeculumPhase9.DigestVectors`. O gate define `SPECULUM_PHASE9_DIGEST_OUT` (não é opcional
  por memória). Lab/digest exigem `SPECULUM_MONOREPO_ROOT` explícito (sem `../`).
- Lista única de gtest: `modifications/runtime/gtest/moz.build` (+ `TEST_DIRS`); install não
  lista Speculum. `assert-gtest-registration.sh` falha em segundos se `TestPhase*.cpp` e
  `TEST(SpeculumPhaseN,…)` divergirem do expect — antes de qualquer build.
- **Pronto = último salto vivo.** `npm run ci:all` verde + página real com
  `assertDescriptors: true`. Fixture verde sozinha não fecha.

**Entregue:** `tests/phase9/` · `TestPhase9.cpp` · gen no produto · `ci:all` · README do lab.

**Porta =** `ports/*.hpp` (não o markdown visitor).

---

## FASE 10 — Supervisor e cliente sobre o schema

**Objetivo:** as três pontas falam o mesmo fio, geradas da mesma fonte.

**Ler:** [08](08-fio.md) · [schema](schema/README.md) · `gecko-engine/supervisor/README.md` · `docs/page-projection/spec/browser-session.md`

**Entregar:** `Speculum.Supervisor` (.NET) sobre o codec **gerado** · cliente TS sobre o codec
**gerado** · o vocabulário novo (viewport/host/documento) atravessando as três.

**Aceite:**
- **Nenhuma linha de codec escrita à mão em nenhuma das três pontas.** Revisão rejeita.
- Supervisor não tem política dentro do motor: escolha de força de resync, retry de navegação e
  vazão moram nele — e existe teste que prova que o motor não decide nenhuma das três.
- Cliente entra em modo resync, bufferiza, e descarta pelo `builtAt` ([11 §4.1](11-identidade.md)).
  Teste: dessincronizar deliberadamente contra produtor vivo, e o diff estrutural depois do
  swap é **byte-idêntico**.
- `Fault` do motor chega ao supervisor com `code` catalogado e chaves tipadas, e é casado
  programaticamente — nunca lido como texto.
- Sessão fim a fim em lab: `ViewportOpen` → `Navigate` → patches → input → `Shutdown`, com
  contagens exatas de hops (patches recebidos == esperados). O corpo do `Patch` é **opaco**
  para o supervisor por desenho do fio — não há oráculo de conteúdo nesta fase. Verificação
  de conteúdo de patch (ISA / frame-protocol / veredito) pertence às fases 7 e 9, onde há
  produtor real e oráculo de verdade.
- Hash do schema gravado no metadado de build das três pontas; divergência é erro de
  implantação diagnosticável.

**Proibido:** adaptar o supervisor "só para funcionar" com tradução manual; manter o ABI antigo
em paralelo.

---

## FASE 11 — Medição e afinação em hardware alvo

**Objetivo:** trocar os números chutados por números medidos.

**Ler:** [05](05-decisoes-abertas.md) · `docs/page-projection/spec/budgets.md` · log de decisão do `frame-protocol.md`

**Entregar:** os três números de afinação · decisão sobre interning de string · orçamentos
medidos · relatório reprodutível.

**Aceite:**
- Cadência do `PatchClock`, teto de streams e tamanho do scratch: **valor medido, com o número
  e o método no doc**. Palpite é reprovação.
- Interning de string decidido **com** o fixture de vocabulário de marcação realista que o log
  de decisão pede. Sem esse fixture, a decisão não é tomada.
- Medição em **hardware alvo**, nunca laptop de dev — é regra do próprio repositório.
- Sondagem em site real (estático, notícias, e-commerce, SPA): custo do produtor acompanha
  **volume de mutação**, não tamanho de tabela. Se acompanhar tamanho, há defeito de algoritmo.
- Custo por op plano com o tamanho do lote, reconfirmado no motor real.
- Relatório versionado, reexecutável, não um número num commit message.

**Proibido:** escolher número por conveniência; medir só com fixture sintético; declarar
orçamento sem o método junto.

---

## FASE 12 — Endurecimento e corte de produção

**Objetivo:** o programa roda em produção, e o que era de lab não existe lá.

**Ler:** `docs/engineering-standards.md` · `docs/page-projection/spec/acceptance.md` · `docs/gecko-engine/22-w7s.md` · `Refactor/deploy/`

**Entregar:** build do fork via **w7s** · pacote do sidecar · implantação via **dockup** ·
gates de CI · configuração de produção.

**Aceite:**
- **Toda capacidade de oráculo, sonda e telemetria desligada por padrão**, e desligado custa
  zero: mesmo roteiro com tudo ligado e tudo desligado produz **bytes de patch idênticos**, e o
  perfil de CPU não mostra a instrumentação.
- Nenhum caminho de lab alcançável em produção — `FreezeAll`, `CaptureState` e sondas recusam
  quando a capacidade não foi lançada. Teste que prova a recusa.
- **Stealth não regrediu.** O produtor novo não altera superfície detectável: a suíte anti-bot
  do repositório passa no mesmo patamar de antes. Produtor reescrito mexe no que a página
  observa — isto **não** é opcional.
- `make gecko-source` reprodutível: mesma entrada, mesmo produto funcional.
- Gates de CI verdes: unidade, roteiros, fixtures, paridade das três pontas, compose de sessão.
- **Aceite de produto, não de protocolo:** página real projetada **1:1** conforme
  `acceptance.md` — DOM numérico 1:1, CSSOM percebido. Recuperação verde e smoke verde **não**
  provam aceite.
- Falha catalogada com `errorCode` + `phase` em todo caminho de erro publicado.

**Proibido:** ligar capacidade de lab em produção "por enquanto"; declarar pronto com fixture
verde e caminho real morto; amolecer a suíte anti-bot.

---

## 3. Definição de pronto do programa

As doze fases só terminam quando **todas** estas forem verdade ao mesmo tempo:

| # | condição |
|---|---|
| 1 | Sessão real, em produção, projetando site real **1:1** por `acceptance.md` |
| 2 | Três pontas sobre codec **gerado**, hash do schema batendo |
| 3 | Suíte de fixtures verde com todas as capacidades de oráculo ligadas |
| 4 | Mesmo roteiro ⇒ mesmos bytes em `sim` e `gecko` |
| 5 | Instrumentação desligada custa **zero**, provado |
| 6 | Números de afinação medidos em hardware alvo, método publicado |
| 7 | Stealth no mesmo patamar de antes |
| 8 | Build reprodutível via w7s, implantação via dockup, CI verde |
| 9 | Nenhum caminho de lab alcançável em produção |
| 10 | Zero código ad-hoc, zero contorno, zero assert amolecido |

Faltando **uma**, o programa não está pronto — e a primeira frase do relatório diz
**incompleto**.

## 4. Sinais de que o desenho está sendo violado

Se qualquer um aparecer, **pare** — não é otimização, é o modelo quebrando:

- um `if` perguntando "é a raiz?" ou "é o primeiro quadro?";
- um componente de `domain/` que conhece `ILink` sem ser `Session`/`LinkWriter`;
- dois caminhos para a mesma coisa ("anexar cliente" separado de "resync");
- um campo que existe para ficar zerado;
- um teste que afirma "não quebrou" em vez de "quebrou aqui, com este código";
- um número escolhido sem medição;
- tolerância a entrada malformada;
- verde obtido por contorno.
