# Servidor participante

Este es el servidor local que usan los participantes durante los workshops de
AI x Blockchain Day. Está construido con Hono y TypeScript.

La app está dividida por stages para que una persona pueda entrar en cualquier
workshop con el trabajo anterior ya implementado.

En la rama `w04-update`, la guía paso a paso del Workshop 4 (pagos x402 en
vivo en Base Sepolia, browser wallet e identidad ERC-8004 del agente) vive en
[`workshops/04-agente-que-cobra/STEPS.md`](../workshops/04-agente-que-cobra/STEPS.md).

## Validar todo el track

```bash
npm install
npm run check
npm run smoke
```

`npm run smoke` levanta la app para los stages 1-4 y verifica las rutas
principales. No requiere Nebius, GitHub ni wallet real.

## Comandos por workshop

| Workshop | Comando | URL local | Incluye |
|---:|---|---|---|
| 1 | `npm run workshop:1` | `http://localhost:3001` | Brain API, `/stack`, `/reason` |
| 2 | `npm run wallet:create && npm run workshop:2` | `http://localhost:3001` | Workshop 1 + Pi setup, wallet, GitHub y contrato de integraciones |
| 3 | `npm run workshop:3` | `http://localhost:3001` | Workshops 1-2 + web pages y API `/mentor-agent` |
| 4 | `npm run workshop:4` | `http://localhost:3001` | Workshops 1-3 + UI toggle x402 y ERC-8004 |

Todos los stages usan el mismo puerto. Detén el stage anterior con `Ctrl+C`
antes de iniciar el siguiente.

## Estructura

```text
src/
├── app.ts              # composición de la app Hono
├── server.ts           # entrypoint de Node
├── config.ts           # stage, puerto y variables de entorno
├── http.ts             # helpers de respuesta
├── workshop-gates.ts   # bloqueo de rutas por stage
├── routes/             # rutas por workshop
└── integrations/       # Nebius, GitHub y wallet
```

Scripts:

```text
scripts/configure-pi-nebius.ts  # configura Pi para Nebius Token Factory
scripts/create-wallet.ts  # genera wallet fixture local
scripts/smoke-test.ts     # valida stages 1-4
scripts/pay-base-sepolia-job.ts # ejecuta una prueba x402 real en Base Sepolia
```

Para preparar Pi en Workshop 2:

```bash
set -a
source .env
set +a
npm run pi:configure
```

Después valida con:

```bash
pi --no-tools --no-context-files --no-session -p \
  "Di que provider y modelo estas configurado para usar, y detente."
```

## Integraciones live opcionales

El servidor funciona sin credenciales porque usa fixtures explicitos. Si quieres
probar integraciones live, exporta solo lo necesario en la terminal donde
arrancas el servidor.

Nebius:

```bash
export NEBIUS_API_KEY="reemplaza-con-api-key"
export NEBIUS_MODEL="reemplaza-con-modelo"
export NEBIUS_BASE_URL="https://api.tokenfactory.nebius.com/v1"
```

No proyectes secrets durante el workshop.

Base Sepolia x402:

```bash
export X402_MODE=base-sepolia
export X402_NETWORK=eip155:84532
export X402_FACILITATOR_URL=https://x402.org/facilitator
export X402_PRICE_USD='$0.001'
export X402_PAY_TO="0xwallet-vendedora"
```

`X402_MODE` no prende el gate. Solo cambia el driver que se usa cuando la UI
enciende **Activar pagos x402**. Para ejecutar un pago real de prueba, usa una
wallet compradora con USDC en Base Sepolia:

```bash
export X402_BUYER_PRIVATE_KEY="0xprivate-key-de-wallet-testnet"
npm run x402:pay
```

No uses una llave mainnet ni una wallet con fondos reales relevantes.

## Rutas principales

| Ruta | Workshop | Propósito |
|---|---:|---|
| `GET /health` | 1 | Prueba que el servidor está vivo. |
| `GET /stack` | 1 | Muestra el mapa IA x Blockchain. |
| `POST /reason` | 1 | Devuelve razonamiento Nebius o fixture. |
| `GET /integrations` | 2 | Muestra estado de integraciones. |
| `GET /wallet` | 2 | Muestra la wallet fixture. |
| `GET /github/repo/:owner/:repo` | 2 | Lee contexto público de GitHub o fixture. Ejemplo: `https://github.com/honojs/hono` se llama como `/github/repo/honojs/hono`. |
| `GET /` | 3 | Abre las páginas web del Mentor Agent. |
| `POST /mentor-agent` | 3 | API para agentes: genera guía desde URL de GitHub y objetivo. |
| `GET /repo/:owner/:repo` | 3 | Devuelve contexto de repositorio para mentor. |
| `POST /mentor` | 3 | Produce guía para un builder. |
| `GET /.well-known/agent-registration.json` | 4 | Publica metadata ERC-8004 para descubrimiento del agente. |
| `GET /payment-mode` | 4 | Devuelve si el gate x402 está encendido. |
| `POST /payment-mode` | 4 | Prende o apaga el gate x402 desde la UI/API. |
| `GET /services` | 4 | Lista servicios cobrables, requirements x402 y estado del gate. |
| `POST /jobs` | 4 | Ejecuta libre con el gate apagado; con el gate encendido usa fixture o Base Sepolia según `X402_MODE`. |
| `GET /jobs/:id` | 4 | Lee un job en memoria. |

## Reglas

- Hono es el servidor de todos los workshops.
- Las rutas deben quedarse en `src/routes/`.
- Las llamadas externas deben quedarse en `src/integrations/`.
- Toda respuesta debe etiquetar su estado como `live`, `fixture`, `mock`,
  `configured`, `missing` o `not-enabled`.
- No usar mainnet, fondos reales ni secrets commiteados.
