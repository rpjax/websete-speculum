# domain/session — ciclo de vida da sessão (Fase 2)

Session é a única porta de morte. LinkWriter = um envelope em voo. Router cobre todos os
opcodes inbound do schema. Correlations chaveiam `(HostId, Generation)`.
