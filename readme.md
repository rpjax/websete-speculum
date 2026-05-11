# Websete.Speculum (W7S)

**Websete.Speculum** é uma engine de isolamento de navegação e espelhamento remoto de alta performance baseada em .NET 9. Diferente do motor W7 original, que opera na interceptação de pacotes, o **Speculum** utiliza um modelo *Headless Browser-to-Stream*.

O projeto renderiza sites em instâncias isoladas do Chromium no servidor e transmite o feed visual em tempo real para o cliente via protocolo **WebRTC**, garantindo bypass total de detecções de rede e uma experiência de usuário fluida através de renderização em `<canvas>`.

---

## 👁️ O Conceito "Speculum"

O nome, vindo do latim para **Espelho**, reflete a arquitetura do sistema: o usuário não interage com o site real, mas sim com um "reflexo" interativo de baixíssima latência.

- **Isolamento Total:** O navegador do cliente nunca toca o domínio alvo.
- **Bypass de Client-Side:** Scripts de detecção de bot e impressões digitais (fingerprinting) veem apenas o ambiente controlado do servidor.
- **Renderização via Canvas:** O feed de vídeo é decodificado e desenhado em um elemento `<canvas>`, permitindo manipulação de frames e ocultação de elementos de UI originais.

---

## 🚀 Arquitetura Técnica

### 1. Browser Stack (.NET + Playwright)
Utiliza **Playwright for .NET** para gerenciar o ciclo de vida dos navegadores.
- **Context Isolation:** Cada sessão de usuário possui seu próprio `BrowserContext`, isolando cookies, cache e armazenamento local.
- **Stealth Injection:** Scripts de evasão são injetados no nível de kernel do browser para mascarar a natureza headless.

### 2. Streaming Pipeline (WebRTC)
A transmissão utiliza o protocolo WebRTC para garantir latência sub-100ms.
- **Signaling Server:** Implementado em ASP.NET Core para troca de SDP (Session Description Protocol) e ICE Candidates.
- **Video Track:** Utiliza o motor nativo do Chromium para codificação (H.264/VP8) otimizada, reduzindo o overhead de CPU da VPS.
- **DataChannel:** Canal de dados bidirecional para o envio de inputs (cliques, movimentos de mouse e teclado) do cliente para o servidor.

### 3. Client-Side (Canvas Renderer)
O frontend recebe o stream de vídeo e o vincula a um elemento `<canvas>` via `requestAnimationFrame`.
- **Sync de Input:** As coordenadas do mouse no Canvas são normalizadas e enviadas de volta para o Playwright para execução precisa das ações.

---

## 📊 Capacidade Estimada (KVM Hostinger)

| Recurso | KVM 1 (1 vCPU / 4GB) | KVM 8 (8 vCPU / 32GB) |
| :--- | :--- | :--- |
| **Usuários Simultâneos** | 2 a 3 | 20 a 25 |
| **FPS Médio** | 15 - 20 FPS | 30 - 60 FPS |
| **Latência Média** | ~150ms | ~60ms |

---

## 🛠️ Configuração e Execução

### Pré-requisitos
- .NET 9.0 SDK
- PowerShell (para scripts de build)
- Certificados SSL (Fullchain e PrivateKey na pasta `/Certificates`)

### Instalação
1. Clone o repositório
2. Instale as dependências do Playwright:
   ```bash
   dotnet build
   playwright install --with-deps chromium