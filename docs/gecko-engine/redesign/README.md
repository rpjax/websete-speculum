# Redesign da implementação C++ — índice

**Status:** EM DESENHO. Nada aqui está implementado.
**Natureza:** refactor do zero da implementação C++ do fork. Não é conserto incremental
do que existe; é o desenho de como a coisa nasce certa.

Os docs `00-decisao.md` … `22-w7s.md` descrevem o **sistema** — viabilidade, fork, ABI,
vida da sessão, protocolo. Eles continuam valendo: o fio é o mesmo, a semântica é a mesma,
o vocabulário de controle é o mesmo. O que muda é **como o C++ está organizado por dentro**.

Onde este redesign contradiz um doc antigo, a contradição está nomeada no lugar. Não há
contradição silenciosa.

| doc | assunto |
|---|---|
| **[IMPLEMENTACAO.md](IMPLEMENTACAO.md)** | **comece aqui se vai escrever código** — leitura obrigatória, o que não decidir sozinho, e as 12 fases com aceite mecânico |
| [01-alvo.md](01-alvo.md) | o alvo, os critérios de aceite, o oráculo |
| [02-camadas.md](02-camadas.md) | camadas, regra de dependência, vocabulário, tempo de vida, thread |
| [03-portas.md](03-portas.md) | catálogo de portas, forma, granularidade |
| [04-resiliencia.md](04-resiliencia.md) | o que fica robusto por causa de interface pequena — e onde para de ajudar |
| [05-decisoes-abertas.md](05-decisoes-abertas.md) | as bifurcações ainda não fechadas |
| [06-taxonomia.md](06-taxonomia.md) | contrato vs componente, template obrigatório, regras de assinatura |
| [07-modelo.md](07-modelo.md) | **multi-documento primeiro**: viewport, documento, árvore; processo como objeto |
| [08-fio.md](08-fio.md) | o fio redesenhado: um schema, três lados gerados |
| [09-observabilidade.md](09-observabilidade.md) | gravar e reexecutar, span de causa, dump na morte, invariante executável |
| [11-identidade.md](11-identidade.md) | **`hostId` + `generation`**; sincronia é do cliente, produtor indexa |
| [12-instrumentacao.md](12-instrumentacao.md) | **três formas de telemetria, sondas, e os três oráculos** |
| [13-oraculo-global.md](13-oraculo-global.md) | **congelar tudo, ida e volta**: o que estabelece o produtor |
| [14-nodedescriptor.md](14-nodedescriptor.md) | **a forma normal**: quatro fontes, um tipo; emissão como função pura |
| [10-o-que-falta.md](10-o-que-falta.md) | **o desenho não está fechado**: lacunas, apostas do que quebra, e a fatia vertical |
| [contratos/](contratos/README.md) | **o catálogo**: 9 contratos + 7 módulos de domínio |
| [iteracoes/](iteracoes/) | passes de refino sobre o desenho, com o que mudou e por quê |

---

## A tese, em uma frase

> **Compartimentalização por incapacidade:** um componente não erra porque não recebeu
> a capacidade de errar. O sink de mutação não emite porque não tem transporte. O
> transporte não decide morrer porque não conhece a sessão. O produtor não navega porque
> não tem navegador.

Interface pequena não é estética. É o mecanismo pelo qual a classe inteira de erro deixa de
ser **escrevível**. "Erro fácil de perceber" é o segundo prêmio; o primeiro é erro
impossível de digitar.

## Os três invariantes

1. **`domain/` e `ports/` não incluem header de engine.** Verificado por grep no CI, não
   por disciplina.
2. **Notificação não chama pra fora.** O sink só marca — e não pode fazer mais porque a porta
   não tem método que produza saída.
3. **Domínio não é dono de nada do engine.** Handle opaco, nunca ponteiro com posse.
4. **Não existe documento especial.** Raiz é posição na árvore, não tipo — logo o código nunca
   pergunta "isto é a raiz?".
5. **Posse é o mecanismo de limpeza.** Processo possui seus documentos; frame possui seu
   observador; documento possui o seu e a projeção. Nada morre por rotina que alguém possa
   esquecer.
6. **Frame é o slot, documento é o conteúdo.** Navegar troca o documento do host — logo o
   teardown é destruição de objeto, e `generation` não precisa existir.
7. **Nada alcançável de uma notificação roda script.** O motor proíbe; o grafo de injeção prova.

> **O sistema inteiro numa frase:** a sessão tem viewports; um viewport tem uma árvore de
> frames; um host tem um documento, e navegar troca o documento do host; um documento vive
> num processo, que o possui; a projeção lê o documento, é avisada dele, e publica patches
> para cima.

Cada um está desenvolvido no doc correspondente.
