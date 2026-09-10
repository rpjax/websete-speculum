# Persona

Fecha o item **D** de `07-decisoes-pendentes.md`.

---

## Quem decide: o consumer. Nao o browser, nao o supervisor.

**A persona chega como args no contrato do supervisor.** E' preocupacao do
**consumer**.

Mesma logica de pool e admissao (`06-runtime.md` §6): quem sabe de identidade e' o
produto. E mesma logica do principio da marionete (§7.7): **o browser aplica, nao
decide.**

## Modelo de identidade — decidido

**Por identidade persistida, com sorteio de lista grande no momento em que o profile
e' forjado.**

- O perfil e' sorteado **uma vez**, quando a identidade nasce
- Fica guardado com a identidade
- E' **reproduzido** em toda sessao daquela identidade

Descartados, e o motivo:

| modelo | por que nao |
|---|---|
| **uma persona para a frota** | mil sessoes com fingerprint identico saindo de IPs diferentes. **Assinatura de fazenda.** |
| **sorteio por instancia** | o usuario que volta troca de computador. Contradicao visivel. |

**Motivo do modelo escolhido:** o pote de cookie e o fingerprint **tem que
concordar**. Identidade que volta com `cf_clearance` valido mas fingerprint diferente
e' um cookie de uma maquina sendo usado por outra.

Usuario real = mesma maquina, mesmos cookies, sempre.

Consequencia: a persona **nao e' sorteada ao subir a sessao**. E' carregada junto com
o estado. `restoreState` / `exportState` do contrato carregam persona junto com cookie,
porque os dois sao a mesma coisa — **a maquina daquele usuario.**

## Forma no contrato: DERIVA, nao ACEITA

Esta e' a unica parte que e' nossa, e ela existe para tornar incoerencia
**inexprimivel**.

Se o contrato aceitar cada valor solto, o consumer consegue passar combinacao
incoerente sem errar de proposito: `outerHeight` igual a `innerHeight`, GPU que nao
existe, DPR que nao fecha com a tela alegada.

**Regra: o contrato recebe o minimo e calcula o resto.**

- recebe modelo de tela, altura de chrome, DPR, plataforma
- **deriva** `outer` / `inner`, `avail` / `total`, `screenX` / `screenY`
- **nao** aceita `outer` e `inner` como campos independentes

**Menos botao = menos jeito de ser incoerente.** E' o mesmo principio de antes — o
problema e' coerencia, nao quantidade de mentira — aplicado a forma do contrato.

Isso tambem protege o sorteio: **a lista grande sorteia PERFIS, nao valores soltos**,
entao cada item da lista nasce coerente por construcao.

## O que a persona cobre

Nao e' so string de `navigator`. Inclui a **relacao entre valores** — ver
`03-embedder.md`, secao de fingerprint como configuracao.

O que importa nao e' cada valor isolado, e' a coerencia entre eles: `outerHeight`
maior que `innerHeight` por ~74 px e' um navegador; por 0 e' um robo; por 3 px e' um
robo mal disfarcado.

## Restricoes que a persona herda de outras decisoes

- **Producao nao tem GPU** (decisao de plataforma). A persona **nao pode alegar GPU**.
  O perfil alegado tem que ser desktop plausivel rodando software rendering — existe e
  e' populacao real (GPU bloqueada, driver ruim).
- **Nao alegar capacidade que a maquina nao tem.** `hardwareConcurrency` alegado tem
  que bater com o container, porque paralelismo e' testavel por comportamento.
- **Nao adicionar API que o Firefox nao tem.** Alegar ser Firefox e expor API que ele
  nao implementa e' auto-denuncia.
- **Sem ruido.** Fingerprint randomizado e' assinatura de ferramenta
  anti-fingerprinting, e isso e' sinal de automacao. O objetivo e' **estavel, coerente
  e plausivel**, nao aleatorio.
