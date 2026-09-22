# IEngineProcess

**Tipo:** contrato/dirigida · **Escopo:** processo · **Thread:** main · **Camada:** ports

## Responsabilidade
Um processo de conteúdo vivo, como **objeto que possui** os documentos que vivem nele.

## Não é responsável por
- a árvore — ela é de frames e vive no processo pai; aqui só mora posse
- reiniciar-se
- aparecer no fio: processo é detalhe do motor, e o supervisor fala documento

## Contrato
```cpp
struct IEngineProcess {
  virtual ProcessId  id() const = 0;
  virtual uint32_t   documentCount() const = 0;
  virtual DocumentId documentAt(uint32_t) const = 0;  // DocumentId = {HostId, Generation}
  virtual ~IEngineProcess() = default;
};
```

## Semântica
- **A posse é o mecanismo.** Este handle é dono dos seus documentos. Ele ser destruído destrói
  os documentos dele — não há rotina de limpeza que alguém possa esquecer de chamar, e não há
  ordem de limpeza que alguém possa errar.
- Isso troca um invariante testado por um fato do tipo:

  > Antes: *"morte de processo destrói seus documentos exatamente uma vez"*, que exige teste.
  >
  > Agora: os documentos eram dele. Morreram.

- `documentAt` fora do intervalo devolve `DocumentId` inválido: o documento pode ter acabado de fechar.
- Um documento cujo host pai está em outro processo continua sendo **deste** processo.
  Posse e estrutura são eixos separados, e este handle só responde por posse.
- **Os adaptadores de leitura vivem aqui, não no documento do motor.** Objeto do motor nunca é
  possuído por algo que o motor possua, senão a coleta de ciclos não enxerga a aresta e a
  árvore vaza inteira, calada (iteração 6).

## Falhas
Nenhuma por valor. `documentAt` inválido é resposta, não erro.

## Invariantes
1. Todo documento pertence a exatamente um processo.
2. Depois do processo destruído, nenhum documento dele permanece.
3. Nenhum handle de documento sobrevive ao seu processo.
4. Não há caminho para um documento que não passe pelo seu processo.

## Testabilidade
O `sim` mata um processo com três documentos, dos quais dois têm filhos em outro processo. O
teste afirma: os três somem, os filhos em outro processo viram órfãos por regra explícita, e
nenhum handle solto sobrevive. Hoje esse cenário não tem como ser escrito.

## Colabora com
[IEngineDocument](IEngineDocument.md) · [IEngineObserver](IEngineObserver.md)
