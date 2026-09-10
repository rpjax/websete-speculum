# 10 — Orquestrador (itens R e N, fechados)

Status: **fechado**. Fecha simultaneamente o item **R** (o que significa "subir um
supervisor") e o item **N** (granularidade de processo), que estavam acoplados.

---

## 1. Decisão

**Um container longo por host, com muitos pares dentro.** O par
`supervisor + Gecko` é um **processo**, não um container.

Existe um componente novo, o **Orquestrador**, que:

- roda no host (um por host), dentro do mesmo container que os pares;
- sobe e derruba supervisores por fork/exec;
- é quem conversa com a **application** (o produto);
- faz a ponte entre a application e as instâncias de supervisor.

Implementação prevista: **.NET**, mesmo stack do supervisor.

Não existe "supervisor de supervisor" escrito por nós acima do Orquestrador. Quem
mantém o Orquestrador vivo é o runtime do host (política de restart do container /
systemd). Esse é o topo da cadeia.

## 2. Topologia

```
Application (produto)
        │  contrato (estratégia de transporte: in-process / socket local / remoto)
        ▼
Orquestrador  ──────────────── host, processo longo, 1 por host
        │  fork/exec + ponte
        ├── Supervisor #1 ── Gecko #1     ┐
        ├── Supervisor #2 ── Gecko #2     │ processos irmãos
        └── Supervisor #N ── Gecko #N     ┘
```

Uma sessão = um processo supervisor + um processo Gecko. Subir sessão = fork/exec,
não `docker run`.

## 3. Por que assim (e não container por sessão)

| | container por sessão | **container por host (escolhido)** |
|---|---|---|
| quem sobe | orquestrador externo (Docker/K8s) | **componente nosso** |
| custo de arranque | container novo por sessão | processo |
| isolamento | máximo (namespace) | nível de processo |
| código nosso | nenhum | **o Orquestrador** |

Aceitamos escrever o Orquestrador e cair para isolamento de processo em troca de
arranque barato e de manter a decisão na nossa mão. Coerente com a linha já
registrada em `05-otimizacao.md`: fazer funcionar primeiro.

## 4. Fronteiras de responsabilidade

**Orquestrador**
- ciclo de vida dos pares (subir, derrubar, reaping de órfão)
- capacidade do host (quantos pares cabem)
- endereçamento: application fala com o Orquestrador, nunca com o supervisor direto
- reporta morte de instância para cima

**Supervisor** (inalterado)
- dono de um Gecko só; marionete (§7.7 de `06-runtime.md`)
- ponte caiu = crash + autodestruição (§7.3). O Orquestrador é quem observa esse
  crash e informa a application. A regra não muda: a morte continua sendo terminal
  e visível, não escondida por reconexão.

**Application / produto**
- pede sessão, usa sessão, devolve sessão
- **não** cria processo, **não** escolhe host

## 5. O que essa decisão altera no que já estava escrito

`06-runtime.md` diz que pool e admissão pertencem ao produto. Isso precisa ser
corrigido: quem tem visão de capacidade do host é o Orquestrador. A divisão passa a
ser **produto pede / Orquestrador aloca ou recusa**. Anotado como correção
pendente no texto de runtime.

## 6. Reaberto por esta decisão

1. **Multi-host.** Com um Orquestrador por host, quem escolhe o host quando existem
   N hosts? Ou o produto conhece a lista, ou entra um roteador acima. Não resolvido —
   fora de escopo enquanto for um host só.
2. **Isolamento entre sessões.** Caindo para processo, cada par precisa de perfil
   Gecko em diretório próprio e, no mínimo, limites por processo. Definir onde e como.
3. **Orquestrador morre.** Os pares ficam órfãos. Definir se são mortos junto
   (process group) ou readotados no restart.
4. ~~Contrato Orquestrador ↔ application.~~ **Resolvido em `11-supervisor-linguagem.md`
   (item Q):** .NET com NativeAOT, SignalR como adaptador padrão para consumidor remoto.
   O supervisor **é** a interface; quem consome é camada de adaptação, e o frame passa por
   ele por necessidade — o consumidor vive em outro container e fala por rede.
5. **Vida da sessao quando o caller cai** (item S). Se o produto perde o link com o
   Orquestrador, a instancia morre ou fica viva esperando reatar? Sem resposta.
