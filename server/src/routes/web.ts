import type { AppConfig } from "../types.js";
import { requireStage, type App } from "../workshop-gates.js";

function paymentPanel(config: AppConfig): string {
  if (config.stage < 4) return "";

  return `<section class="panel stage4-panel" id="payments-panel">
        <p id="debug-overlay" style="background: #1a1a2e; color: #00ff88; padding: 4px 8px; font-family: monospace; font-size: 11px; border-radius: 4px; margin: 0 0 8px 0;">debug: pending (no /payment-mode response yet)</p>
        <div class="stage4-head">
          <div>
            <p class="eyebrow">Workshop 4 / x402</p>
            <h2>Gate de pagos</h2>
          </div>
          <label class="toggle">
            <input id="payment-toggle" type="checkbox" />
            <span class="toggle-track"></span>
            <span class="toggle-label">Activar pagos x402</span>
          </label>
        </div>
        <p class="hint">Con pagos apagados, el job corre como demo. Con pagos encendidos, el servidor responde 402 hasta recibir <code>PAYMENT-SIGNATURE</code>.</p>

        <div class="job-grid">
          <div>
            <label for="job-task">Servicio</label>
            <select id="job-task">
              <option value="summarize">summarize</option>
              <option value="mentor">mentor</option>
            </select>
          </div>
          <div>
            <label for="job-input">Input</label>
            <input id="job-input" value="AI x Blockchain Day conecta agentes con identidad, pagos y automatizacion." />
          </div>
        </div>

        <div class="button-row">
          <button id="job-without-payment" type="button">Probar sin firma</button>
          <button id="job-with-payment" type="button">Probar con firma x402</button>
          <button id="job-connect-wallet" type="button" class="primary-action" hidden>Connect wallet</button>
          <button id="job-pay-live" type="button" class="primary-action" hidden>Pagar con x402</button>
          <button id="job-switch-network" type="button" hidden>Switch to Base Sepolia</button>
          <button id="job-disconnect" type="button" hidden>Disconnect</button>
        </div>

        <p class="hint" id="wallet-info" hidden></p>
        <p class="hint" id="agent-wallet-info" hidden></p>
        <p class="hint live-hint" id="live-hint" hidden>
          Modo live: el botón "Pay with x402" usa TU wallet (MetaMask, Coinbase Wallet, Rabby, etc.) para firmar el EIP-3009 y liquidar USDC real en Base Sepolia.
        </p>

        <section class="erc8004-panel" id="erc8004-panel" hidden>
          <h3>ERC-8004 identity</h3>
          <p class="hint">
            Registrá tu wallet como agente onchain en el <code>IdentityRegistry</code> de Base Sepolia. El registro es un NFT ERC-721 con un <code>agentURI</code> que apunta a la metadata de tu agente.
          </p>
          <div class="button-row">
            <button id="erc8004-check" type="button">Check 8004 registration</button>
            <button id="erc8004-register" type="button" class="primary-action" hidden>Register on 8004</button>
          </div>
          <pre class="erc8004-output" id="erc8004-output" hidden></pre>
        </section>

        <section class="activity-log" id="activity-log" aria-live="polite">
          <p class="empty">El log de actividad aparecerá aquí. Cada click registra un evento.</p>
        </section>

        <section class="payment-output" id="payment-output">
          <p class="empty">El estado del gate de pagos aparecerá aquí.</p>
        </section>
      </section>`;
}

function appPage(config: AppConfig): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mentor Agent | AI x Blockchain Day</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #071018;
        --panel: #0d1822;
        --panel-2: #101f2b;
        --line: rgba(169, 187, 196, 0.22);
        --text: #f5f8fb;
        --muted: #a9bbc4;
        --cyan: #42e8e0;
        --magenta: #ff2aa3;
        --warn: #ffd166;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          linear-gradient(rgba(66, 232, 224, 0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(66, 232, 224, 0.05) 1px, transparent 1px),
          var(--bg);
        background-size: 28px 28px;
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(1120px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 40px 0;
      }

      header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: flex-start;
        padding-bottom: 28px;
        border-bottom: 1px solid var(--line);
      }

      .brand {
        margin: 0 0 16px;
        font-size: clamp(34px, 5vw, 72px);
        line-height: 0.92;
        letter-spacing: 0;
      }

      .brand span {
        color: var(--magenta);
      }

      .eyebrow {
        margin: 0 0 12px;
        color: var(--cyan);
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .lede {
        max-width: 680px;
        margin: 0;
        color: var(--muted);
        font-size: 20px;
        line-height: 1.45;
      }

      .stage {
        min-width: 160px;
        padding: 12px 14px;
        border: 1px solid var(--line);
        background: rgba(13, 24, 34, 0.75);
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--cyan);
        font-size: 13px;
      }

      .grid {
        display: grid;
        grid-template-columns: minmax(320px, 0.9fr) minmax(320px, 1.1fr);
        gap: 24px;
        margin-top: 28px;
      }

      section {
        min-width: 0;
      }

      .panel {
        border: 1px solid var(--line);
        background: rgba(13, 24, 34, 0.9);
        padding: 22px;
      }

      label {
        display: block;
        margin: 0 0 8px;
        color: var(--cyan);
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        text-transform: uppercase;
      }

      input,
      textarea,
      select {
        width: 100%;
        border: 1px solid var(--line);
        background: #071018;
        color: var(--text);
        font: inherit;
        font-size: 17px;
        padding: 13px 14px;
        outline: none;
      }

      textarea {
        min-height: 140px;
        resize: vertical;
        line-height: 1.45;
      }

      input:focus,
      textarea:focus,
      select:focus {
        border-color: var(--cyan);
      }

      input[type="checkbox"] {
        width: auto;
      }

      .field {
        margin-bottom: 18px;
      }

      button {
        width: 100%;
        border: 0;
        background: var(--magenta);
        color: white;
        min-height: 48px;
        padding: 12px 16px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      button:disabled {
        cursor: wait;
        opacity: 0.7;
      }

      .hint {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.45;
        margin: 14px 0 0;
      }

      .status-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      .chip {
        border: 1px solid var(--line);
        color: var(--cyan);
        padding: 7px 9px;
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }

      .result {
        min-height: 420px;
      }

      .empty {
        color: var(--muted);
        font-size: 18px;
        line-height: 1.5;
      }

      h2,
      h3 {
        margin: 0 0 12px;
        letter-spacing: 0;
      }

      h2 {
        font-size: 26px;
      }

      h3 {
        color: var(--cyan);
        font-size: 15px;
        text-transform: uppercase;
      }

      .repo {
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
        padding: 16px 0;
        margin: 16px 0;
      }

      .repo p,
      .mentor-text {
        color: var(--muted);
        line-height: 1.5;
        font-size: 17px;
      }

      .mentor-text {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .error {
        color: var(--warn);
      }

      code {
        color: var(--text);
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      .stage4-panel {
        margin-top: 24px;
      }

      .stage4-head,
      .toggle,
      .button-row,
      .job-grid {
        display: flex;
        gap: 16px;
      }

      .stage4-head {
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--line);
        padding-bottom: 16px;
        margin-bottom: 16px;
      }

      .toggle {
        align-items: center;
        color: var(--text);
        cursor: pointer;
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        text-transform: uppercase;
      }

      .toggle input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }

      .toggle-track {
        width: 48px;
        height: 26px;
        border: 1px solid var(--line);
        background: #071018;
        position: relative;
      }

      .toggle-track::after {
        content: "";
        position: absolute;
        width: 18px;
        height: 18px;
        top: 3px;
        left: 4px;
        background: var(--muted);
        transition: transform 140ms ease, background 140ms ease;
      }

      .toggle input:checked + .toggle-track {
        border-color: var(--magenta);
      }

      .toggle input:checked + .toggle-track::after {
        transform: translateX(20px);
        background: var(--magenta);
      }

      .job-grid {
        display: grid;
        grid-template-columns: 220px 1fr;
        margin-top: 18px;
      }

      .button-row {
        margin-top: 16px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .button-row button {
        flex: 1;
        min-width: 140px;
        width: auto;
      }

      .button-row button.primary-action {
        background: var(--magenta);
        color: var(--bg);
        font-weight: 600;
      }

      .button-row button.primary-action:disabled {
        background: var(--line);
        color: var(--muted);
        cursor: not-allowed;
      }

      .activity-log {
        margin-top: 18px;
        padding: 12px 14px;
        background: rgba(7, 16, 24, 0.6);
        border: 1px solid var(--line);
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        max-height: 260px;
        overflow-y: auto;
      }

      .activity-log .log-entry {
        display: grid;
        grid-template-columns: 70px 18px 1fr;
        gap: 8px;
        padding: 2px 0;
        align-items: baseline;
      }

      .activity-log .log-time {
        color: var(--muted);
      }

      .activity-log .log-icon {
        text-align: center;
      }

      .activity-log .log-msg {
        color: var(--text);
        word-break: break-word;
      }

      .activity-log .log-entry.info .log-icon { color: var(--cyan); }
      .activity-log .log-entry.ok .log-icon { color: #6cf09a; }
      .activity-log .log-entry.ok .log-msg { color: #b8f5cd; }
      .activity-log .log-entry.warn .log-icon { color: var(--warn); }
      .activity-log .log-entry.error .log-icon { color: #ff6b6b; }
      .activity-log .log-entry.error .log-msg { color: #ffb3b3; }

      .log-link {
        color: var(--cyan);
        text-decoration: none;
        border-bottom: 1px dotted var(--cyan);
        margin-left: 4px;
      }
      .log-link:hover {
        color: var(--magenta);
        border-bottom-color: var(--magenta);
      }
      .activity-log .log-entry.ok .log-link { color: #6cf09a; border-bottom-color: #6cf09a; }

      .live-hint {
        margin-top: 12px;
        padding: 8px 12px;
        background: rgba(255, 42, 163, 0.08);
        border-left: 2px solid var(--magenta);
        font-size: 13px;
      }

      .erc8004-panel {
        margin-top: 18px;
        padding: 14px 16px;
        background: rgba(0, 212, 255, 0.04);
        border: 1px solid rgba(0, 212, 255, 0.2);
        border-radius: 6px;
      }
      .erc8004-panel h3 {
        margin: 0 0 8px 0;
        font-size: 14px;
        color: var(--cyan);
        font-weight: 600;
      }
      .erc8004-panel .hint {
        font-size: 12px;
        margin: 0 0 10px 0;
        line-height: 1.5;
      }
      .erc8004-panel .hint code {
        background: rgba(255, 255, 255, 0.06);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 11px;
      }
      .erc8004-output {
        margin-top: 10px;
        padding: 10px 12px;
        background: rgba(0, 0, 0, 0.25);
        border-radius: 4px;
        font-size: 12px;
        line-height: 1.5;
        max-height: 200px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .erc8004-output.registered { border-left: 3px solid #6cf09a; }
      .erc8004-output.not-registered { border-left: 3px solid var(--warn); }
      .erc8004-output.error { border-left: 3px solid #ff6b6b; }

      .payment-output {
        border-top: 1px solid var(--line);
        margin-top: 18px;
        padding-top: 16px;
      }

      @media (max-width: 820px) {
        header,
        .grid,
        .job-grid {
          grid-template-columns: 1fr;
        }

        header {
          display: block;
        }

        .stage {
          display: inline-block;
          margin-top: 18px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <p class="eyebrow">AI x Blockchain Day / Mentor Agent</p>
          <h1 class="brand">Mentor <span>Agent</span></h1>
          <p class="lede">Pega un repositorio público de GitHub y define el objetivo. El servicio combina contexto de código con razonamiento para preparar una guía accionable.</p>
        </div>
        <div class="stage">WORKSHOP_STAGE=${config.stage}</div>
      </header>

      <div class="grid">
        <section class="panel">
          <form id="mentor-form">
            <div class="field">
              <label for="repoUrl">Repositorio GitHub</label>
              <input id="repoUrl" name="repoUrl" value="https://github.com/honojs/hono" autocomplete="off" />
            </div>
            <div class="field">
              <label for="goal">Objetivo</label>
              <textarea id="goal" name="goal">Quiero entender cómo este proyecto estructura APIs y cuál sería una primera tarea pequeña para un builder.</textarea>
            </div>
            <button id="submit" type="submit">Analizar con Mentor Agent</button>
            <p class="hint">Pi Coding Agent puede inspeccionar este servicio y ayudarte a modificarlo. Pi no es el servicio final.</p>
          </form>
        </section>

        <section class="panel result" id="result">
          <p class="empty">El resultado aparecerá aquí.</p>
        </section>
      </div>

      ${paymentPanel(config)}
    </main>

    <script>
      const form = document.querySelector("#mentor-form");
      const button = document.querySelector("#submit");
      const result = document.querySelector("#result");

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }

      function render(data) {
        const repo = data.repoContext || {};
        const text = data.result && data.result.text ? data.result.text : "";
        result.innerHTML =
          '<div class="status-row">' +
            '<span class="chip">GitHub: ' + escapeHtml(data.integrations && data.integrations.github) + '</span>' +
            '<span class="chip">Reasoning: ' + escapeHtml(data.integrations && data.integrations.reasoning) + '</span>' +
          '</div>' +
          '<h2>' + escapeHtml(repo.fullName || "Repositorio") + '</h2>' +
          '<div class="repo">' +
            '<p>' + escapeHtml(repo.description || "Sin descripción.") + '</p>' +
            '<p><strong>Lenguaje:</strong> ' + escapeHtml(repo.language || "n/a") + ' · <strong>Stars:</strong> ' + escapeHtml(repo.stars || 0) + '</p>' +
          '</div>' +
          '<h3>Guía del Mentor Agent</h3>' +
          '<div class="mentor-text">' + escapeHtml(text) + '</div>';
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        button.disabled = true;
        button.textContent = "Analizando...";
        result.innerHTML = '<p class="empty">Consultando repositorio y generando guía...</p>';

        try {
          const response = await fetch("/mentor-agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              repoUrl: form.repoUrl.value,
              goal: form.goal.value
            })
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.message || "No se pudo completar la solicitud.");
          }
          render(data);
        } catch (error) {
          result.innerHTML = '<p class="error">' + escapeHtml(error.message || error) + '</p>';
        } finally {
          button.disabled = false;
          button.textContent = "Analizar con Mentor Agent";
        }
      });

      const paymentsPanel = document.querySelector("#payments-panel");
      if (paymentsPanel) {
        const paymentToggle = document.querySelector("#payment-toggle");
        const paymentOutput = document.querySelector("#payment-output");
        const activityLog = document.querySelector("#activity-log");
        const liveHint = document.querySelector("#live-hint");
        const jobTask = document.querySelector("#job-task");
        const jobInput = document.querySelector("#job-input");
        const jobWithoutPayment = document.querySelector("#job-without-payment");
        const jobWithPayment = document.querySelector("#job-with-payment");
        const jobConnectWallet = document.querySelector("#job-connect-wallet");
        const jobPayLive = document.querySelector("#job-pay-live");
        const jobSwitchNetwork = document.querySelector("#job-switch-network");
        const jobDisconnect = document.querySelector("#job-disconnect");
        const walletInfo = document.querySelector("#wallet-info");
        const agentWalletInfo = document.querySelector("#agent-wallet-info");
        const erc8004Panel = document.querySelector("#erc8004-panel");
        const erc8004Check = document.querySelector("#erc8004-check");
        const erc8004Register = document.querySelector("#erc8004-register");
        const erc8004Output = document.querySelector("#erc8004-output");
        const debugOverlay = document.querySelector("#debug-overlay");
        let activePaymentMode = { live: false, ready: false, label: "fixture" };
        // Server's seller wallet address (X402_PAY_TO). Updated by /payment-mode.
        let agentWalletAddress = null;
        // paymentsEnabled mirrors the server's payment-mode switch state.
        // It is true only when the user has flipped "Activar pagos x402" ON
        // AND the server is configured for live x402 (X402_MODE=base-sepolia).
        let paymentsEnabled = false;
        let eventCount = 0;

        function logEvent(level, message, link) {
          if (!activityLog) return;
          eventCount += 1;
          const time = new Date().toTimeString().slice(0, 8);
          const iconMap = { info: "·", warn: "!", error: "✗", ok: "✓" };
          const icon = iconMap[level] || "·";
          if (eventCount === 1) {
            activityLog.innerHTML = "";
          }
          const entry = document.createElement("div");
          entry.className = "log-entry " + level;
          let msgHtml = escapeHtml(message);
          if (link && link.url) {
            const safeUrl = escapeHtml(link.url);
            const linkText = escapeHtml(link.text || link.url);
            msgHtml += ' <a class="log-link" href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + linkText + ' ↗</a>';
          }
          entry.innerHTML =
            '<span class="log-time">' + time + '</span>' +
            '<span class="log-icon">' + icon + '</span>' +
            '<span class="log-msg">' + msgHtml + '</span>';
          activityLog.appendChild(entry);
          activityLog.scrollTop = activityLog.scrollHeight;
        }

        function refreshLiveControls() {
          const live = activePaymentMode.live === true && activePaymentMode.ready === true;
          // These controls are only relevant when the browser wallet bundle is loaded.
          // Without the bundle there is no "Pay with x402" button to update.
          if (window.aixbWallet) {
            if (jobPayLive) {
              jobPayLive.disabled = !live;
              jobPayLive.title = live
                ? "Ejecutar pago x402 real en Base Sepolia"
                : "Disponible solo cuando X402_MODE=base-sepolia y la wallet está lista";
            }
            if (liveHint) {
              liveHint.hidden = !live;
            }
          }
        }

        function refreshWalletControls() {
          // We do NOT early-return when window.aixbWallet is missing.
          // The 'Connect wallet' button must remain visible when the gate
          // is on, even if the bundle is still loading or unavailable.
          // The other buttons (Pay, Switch, Disconnect) check
          // isConnected() and will hide themselves accordingly.
          const isConnected = window.aixbWallet ? window.aixbWallet.isConnected() : false;
          const chainId = window.aixbWallet ? window.aixbWallet.getChainId() : null;
          const isBaseSepolia = chainId === 84532;
          // The wallet UI is gated by the user's switch, not the server's
          // X402_MODE. paymentsEnabled is true only when the user has flipped
          // the "Activar pagos x402" switch ON (the server is also expected
          // to be in X402_MODE=base-sepolia for the flow to actually settle).
          const gateOn = paymentsEnabled === true;
          console.log("[refreshWalletControls] paymentsEnabled=" + paymentsEnabled + " gateOn=" + gateOn + " isConnected=" + isConnected);

          if (jobConnectWallet) {
            // Connect wallet is only relevant when the x402 payment gate is on.
            // Without the switch ON there is no "Pay with x402" button to unlock.
            jobConnectWallet.hidden = isConnected || !gateOn;
            jobConnectWallet.disabled = false;
            console.log("[refreshWalletControls] jobConnectWallet.hidden=" + jobConnectWallet.hidden);
          }
          if (jobPayLive) {
            jobPayLive.hidden = !isConnected || !gateOn;
            jobPayLive.disabled = !isConnected || !isBaseSepolia;
            jobPayLive.textContent = "Pay with x402";
          }
          if (jobSwitchNetwork) {
            jobSwitchNetwork.hidden = !isConnected || isBaseSepolia;
          }
          if (jobDisconnect) {
            // Disconnect follows the same gate as Connect.
            jobDisconnect.hidden = !isConnected || !gateOn;
          }
          if (walletInfo) {
            if (isConnected && window.aixbWallet) {
              const addr = window.aixbWallet.getAddress();
              const short = addr ? (addr.slice(0, 6) + "..." + addr.slice(-4)) : "";
              walletInfo.hidden = false;
              walletInfo.textContent = isBaseSepolia
                ? "Wallet: " + short + " on Base Sepolia ✓"
                : "Wallet: " + short + " (red " + chainId + " — cambiá a Base Sepolia para pagar)";
            } else {
              walletInfo.hidden = true;
            }
          }
          // ERC-8004 identity panel. We only show it when the wallet is
          // connected AND the x402 gate is on (same gate as Pay with x402).
          // Hiding it on disconnect prevents the panel from showing stale
          // data from a previous wallet.
          if (erc8004Panel) {
            erc8004Panel.hidden = !isConnected || !gateOn;
          }
          updateDebugOverlay();
        }

        function updateDebugOverlay() {
          if (!debugOverlay) return;
          const isConnected = window.aixbWallet ? window.aixbWallet.isConnected() : false;
          const chainId = window.aixbWallet ? window.aixbWallet.getChainId() : null;
          const gateOn = paymentsEnabled === true;
          const connectHidden = jobConnectWallet ? jobConnectWallet.hidden : "missing";
          debugOverlay.textContent = "debug: paymentsEnabled=" + paymentsEnabled
            + " gateOn=" + gateOn
            + " bundle=" + Boolean(window.aixbWallet)
            + " isConnected=" + isConnected
            + " chainId=" + chainId
            + " connectBtn.hidden=" + connectHidden
            + " (commit 67bfdb3)";
        }

        function renderPaymentState(data) {
          const previousLive = activePaymentMode.live === true;
          activePaymentMode = data.mode || activePaymentMode;
          paymentsEnabled = data.paymentsEnabled === true;
          agentWalletAddress = data.agentWallet ?? agentWalletAddress;
          paymentToggle.checked = paymentsEnabled;
          jobWithPayment.disabled = activePaymentMode.live === true;
          jobWithPayment.textContent = activePaymentMode.live ? "Pagar desde CLI" : "Probar con firma x402";
          // Show the server's seller wallet (X402_PAY_TO) so the participant
          // can see which onchain address receives the USDC. Read from
          // /payment-mode to avoid exposing the env directly to the client.
          if (agentWalletInfo) {
            if (agentWalletAddress && agentWalletAddress.startsWith("0x") && agentWalletAddress.length === 42) {
              const short = agentWalletAddress.slice(0, 6) + "..." + agentWalletAddress.slice(-4);
              const baseScanUrl = "https://sepolia.basescan.org/address/" + agentWalletAddress;
              agentWalletInfo.innerHTML = 'Agent wallet (seller, X402_PAY_TO): <a href="' + baseScanUrl + '" target="_blank" rel="noopener" class="log-link">' + short + '</a>';
              agentWalletInfo.hidden = false;
            } else {
              agentWalletInfo.textContent = "Agent wallet (seller): no X402_PAY_TO configured";
              agentWalletInfo.hidden = false;
            }
          }
          updateDebugOverlay();
          paymentOutput.innerHTML =
            '<div class="status-row">' +
              '<span class="chip">x402: ' + (data.paymentsEnabled ? 'ON' : 'OFF') + '</span>' +
              '<span class="chip">mode: ' + escapeHtml(activePaymentMode.label || 'fixture') + '</span>' +
              '<span class="chip">fixture: ' + escapeHtml(data.fixturePaymentSignature || 'x402-fixture-paid') + '</span>' +
            '</div>' +
            '<p class="mentor-text">' +
              (activePaymentMode.live
                ? 'Base Sepolia live: el switch activa x402 real. Conectá tu wallet y usá el botón "Pay with x402" para pagar con tu propio USDC.'
                : data.paymentsEnabled
                  ? 'Pagos encendidos: POST /jobs requiere PAYMENT-SIGNATURE.'
                  : 'Pagos apagados: POST /jobs ejecuta como demo sin pago.') +
            '</p>';
          refreshLiveControls();
          refreshWalletControls();
          if (previousLive !== (activePaymentMode.live === true)) {
            logEvent(activePaymentMode.live ? "ok" : "info", "Server mode: " + (activePaymentMode.label || "fixture"));
          }
        }

        async function loadPaymentMode() {
          const response = await fetch("/payment-mode");
          const data = await response.json();
          renderPaymentState(data);
        }

        async function setPaymentMode(enabled) {
          logEvent("info", "Click switch → " + (enabled ? "ON" : "OFF") + ". Sending POST /payment-mode");
          const response = await fetch("/payment-mode", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled })
          });
          const data = await response.json();
          logEvent(response.ok ? "ok" : "error", "POST /payment-mode → " + response.status + " (x402: " + (data.paymentsEnabled ? "ON" : "OFF") + ")");
          renderPaymentState(data);
        }

        async function runJob(withSignature) {
          if (withSignature && activePaymentMode.live) {
            logEvent("warn", "El botón fixture está deshabilitado en live mode. Usá 'Pay with x402' con tu wallet.");
            return;
          }

          logEvent("info", withSignature
            ? "Click 'Probar con firma x402' → POST /jobs con PAYMENT-SIGNATURE: x402-fixture-paid"
            : "Click 'Probar sin firma' → POST /jobs sin header de pago");

          paymentOutput.innerHTML = '<p class="empty">Ejecutando job...</p>';
          const headers = { "content-type": "application/json" };
          if (withSignature) {
            headers["PAYMENT-SIGNATURE"] = "x402-fixture-paid";
          }

          const response = await fetch("/jobs", {
            method: "POST",
            headers,
            body: JSON.stringify({
              task: jobTask.value,
              input: jobInput.value
            })
          });
          const data = await response.json();
          const paymentRequired = response.headers.get("PAYMENT-REQUIRED");
          logEvent(
            response.ok ? "ok" : "warn",
            "POST /jobs → " + response.status + " " + (response.ok ? "executed" : "rejected") +
            (paymentRequired ? " (with PAYMENT-REQUIRED header)" : "")
          );
          if (paymentRequired) {
            try {
              const decoded = atob(paymentRequired);
              const parsed = JSON.parse(decoded);
              const accept = parsed && parsed.accepts && parsed.accepts[0];
              if (accept) {
                logEvent("info", "Decoded 402: scheme=" + accept.scheme + ", amount=" + accept.amount + ", payTo=" + (accept.payTo || "?").slice(0, 10) + "..., network=" + accept.network);
              }
            } catch (e) {
              logEvent("warn", "Could not decode PAYMENT-REQUIRED header");
            }
          }
          if (response.ok) {
            logEvent("ok", "Job completed: " + (data.id || "?") + " (integration=" + (data.integration || "?") + ")");
            if (data.receipt) {
              logEvent("ok", "x402 receipt: verified=" + data.receipt.verified + ", network=" + data.receipt.network);
            }
            if (data.erc8004Feedback) {
              const fb = data.erc8004Feedback;
              logEvent("ok", "ERC-8004 feedback: value=" + fb.value + " tag1=" + fb.tag1 + " tag2=" + fb.tag2);
            }
          }
          paymentOutput.innerHTML =
            '<div class="status-row">' +
              '<span class="chip">HTTP: ' + response.status + '</span>' +
              '<span class="chip">x402: ' + (paymentToggle.checked ? 'ON' : 'OFF') + '</span>' +
              '<span class="chip">PAYMENT-REQUIRED: ' + (paymentRequired ? 'yes' : 'no') + '</span>' +
            '</div>' +
            '<pre class="mentor-text">' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
        }

        async function payWithBrowserWallet() {
          if (!window.aixbWallet) {
            logEvent("error", "Wallet client no cargado. Refrescá la página.");
            return;
          }
          if (!window.aixbWallet.isConnected()) {
            logEvent("error", "Primero hacé click en 'Connect wallet'.");
            return;
          }
          if (window.aixbWallet.getChainId() !== 84532) {
            logEvent("error", "Cambiá a Base Sepolia primero.");
            return;
          }
          jobPayLive.disabled = true;
          jobPayLive.textContent = "Pago en curso...";
          paymentOutput.innerHTML = '<p class="empty">Tu wallet firmará un EIP-3009 y pagará USDC en Base Sepolia...</p>';

          try {
            const result = await window.aixbWallet.payWithX402(jobTask.value, jobInput.value);
            if (result.ok && result.txHash) {
              const baseScanUrl = 'https://sepolia.basescan.org/tx/' + result.txHash;
              paymentOutput.innerHTML =
                '<div class="status-row">' +
                  '<span class="chip">HTTP: ' + result.status + '</span>' +
                  '<span class="chip">x402: SETTLED</span>' +
                  '<span class="chip">tx: ' + result.txHash.slice(0, 12) + '...</span>' +
                '</div>' +
                '<p class="mentor-text">Pago liquidado onchain con TU wallet. Job completado y feedback ERC-8004 emitido.</p>' +
                '<p class="mentor-text"><a class="log-link" href="' + baseScanUrl + '" target="_blank" rel="noopener noreferrer">Ver transacción en BaseScan Sepolia ↗</a></p>' +
                '<pre class="mentor-text">' + escapeHtml(JSON.stringify(result.body, null, 2)) + '</pre>';
            } else {
              paymentOutput.innerHTML = '<p class="error">Pago no liquidado: ' + escapeHtml(result.error || "?") + '</p>';
            }
          } catch (error) {
            logEvent("error", "Error en pago: " + (error.message || error));
            paymentOutput.innerHTML = '<p class="error">' + escapeHtml(error.message || error) + '</p>';
          } finally {
            jobPayLive.disabled = false;
            jobPayLive.textContent = "Pay with x402";
            refreshWalletControls();
          }
        }

        async function connectWalletHandler() {
          if (!window.aixbWallet) {
            logEvent("error", "Wallet client no cargado. Refrescá la página.");
            return;
          }
          jobConnectWallet.disabled = true;
          try {
            await window.aixbWallet.connectWallet();
          } catch (error) {
            logEvent("error", "Connect failed: " + (error.message || error));
          } finally {
            jobConnectWallet.disabled = false;
            refreshWalletControls();
          }
        }

        async function switchNetworkHandler() {
          if (!window.aixbWallet) return;
          try {
            await window.aixbWallet.switchToBaseSepolia();
          } catch (error) {
            logEvent("error", "Switch failed: " + (error.message || error));
          } finally {
            refreshWalletControls();
          }
        }

        function disconnectWalletHandler() {
          if (!window.aixbWallet) return;
          window.aixbWallet.disconnectWallet();
          logEvent("info", "Wallet desconectada");
          refreshWalletControls();
        }

        async function checkErc8004Handler() {
          if (!window.aixbWallet) {
            logEvent("error", "Wallet client no cargado. Refrescá la página.");
            return;
          }
          const addr = window.aixbWallet.getAddress();
          if (!addr) {
            logEvent("error", "Primero conectá tu wallet.");
            return;
          }
          if (erc8004Check) erc8004Check.disabled = true;
          try {
            const result = await window.aixbWallet.lookupAgent8004(addr);
            if (!result.ok) {
              if (erc8004Output) {
                erc8004Output.hidden = false;
                erc8004Output.className = "erc8004-output error";
                erc8004Output.textContent = "Error: " + (result.error || "unknown");
              }
              return;
            }
            if (erc8004Output) {
              erc8004Output.hidden = false;
              if (result.registered) {
                erc8004Output.className = "erc8004-output registered";
                const idText = result.agentId !== null ? "#" + result.agentId : "(agentId no escaneado, ver BaseScan)";
                erc8004Output.textContent =
                  "REGISTRADO\\n" +
                  "  address: " + addr + "\\n" +
                  "  agentId: " + idText + "\\n" +
                  "  agentURI: " + (result.agentURI || "(empty)") + "\\n" +
                  "  BaseScan: " + (result.baseScanToken || "");
              } else {
                erc8004Output.className = "erc8004-output not-registered";
                erc8004Output.textContent =
                  "NO REGISTRADO\\n" +
                  "  address: " + addr + "\\n" +
                  "  Hacé click en 'Register on 8004' para registrar tu wallet onchain.\\n" +
                  "  Vas a firmar una tx que crea un NFT ERC-721 a tu nombre.";
              }
            }
            // Show the Register button only when not registered.
            if (erc8004Register) {
              erc8004Register.hidden = result.registered;
            }
          } finally {
            if (erc8004Check) erc8004Check.disabled = false;
          }
        }

        async function registerErc8004Handler() {
          if (!window.aixbWallet) {
            logEvent("error", "Wallet client no cargado. Refrescá la página.");
            return;
          }
          if (erc8004Register) erc8004Register.disabled = true;
          try {
            const result = await window.aixbWallet.registerAgent8004();
            if (!result.ok) {
              if (erc8004Output) {
                erc8004Output.hidden = false;
                erc8004Output.className = "erc8004-output error";
                erc8004Output.textContent = "Register failed: " + (result.error || "unknown");
              }
              return;
            }
            // Refresh the panel with the new state.
            await checkErc8004Handler();
          } finally {
            if (erc8004Register) erc8004Register.disabled = false;
          }
        }

        paymentToggle.addEventListener("change", () => {
          setPaymentMode(paymentToggle.checked).catch((error) => {
            logEvent("error", "Error en switch: " + (error.message || error));
            paymentOutput.innerHTML = '<p class="error">' + escapeHtml(error.message || error) + '</p>';
          });
        });

        jobWithoutPayment.addEventListener("click", () => {
          runJob(false).catch((error) => {
            logEvent("error", "Error: " + (error.message || error));
            paymentOutput.innerHTML = '<p class="error">' + escapeHtml(error.message || error) + '</p>';
          });
        });

        jobWithPayment.addEventListener("click", () => {
          runJob(true).catch((error) => {
            logEvent("error", "Error: " + (error.message || error));
            paymentOutput.innerHTML = '<p class="error">' + escapeHtml(error.message || error) + '</p>';
          });
        });

        if (jobConnectWallet) {
          jobConnectWallet.addEventListener("click", () => {
            connectWalletHandler().catch((error) => {
              logEvent("error", "Error: " + (error.message || error));
            });
          });
        }

        if (jobPayLive) {
          jobPayLive.addEventListener("click", () => {
            payWithBrowserWallet().catch((error) => {
              logEvent("error", "Error: " + (error.message || error));
            });
          });
        }

        if (jobSwitchNetwork) {
          jobSwitchNetwork.addEventListener("click", () => {
            switchNetworkHandler().catch((error) => {
              logEvent("error", "Error: " + (error.message || error));
            });
          });
        }

        if (jobDisconnect) {
          jobDisconnect.addEventListener("click", () => {
            disconnectWalletHandler();
          });
        }

        if (erc8004Check) {
          erc8004Check.addEventListener("click", () => {
            checkErc8004Handler().catch((error) => {
              logEvent("error", "Check 8004 error: " + (error.message || error));
            });
          });
        }

        if (erc8004Register) {
          erc8004Register.addEventListener("click", () => {
            registerErc8004Handler().catch((error) => {
              logEvent("error", "Register 8004 error: " + (error.message || error));
            });
          });
        }

        // Init: configure el logger del bundle, luego cargá /payment-mode
        if (window.aixbSetLog) {
          window.aixbSetLog(logEvent);
        }
        if (window.aixbWallet) {
          window.aixbWallet.onAccountChanged(() => refreshWalletControls());
          window.aixbWallet.onChainChanged(() => refreshWalletControls());
        }

        loadPaymentMode().then(() => {
          logEvent("info", "Web cargada. Switch " + (paymentToggle.checked ? "ON" : "OFF") + ". Click 'Activar pagos x402' o 'Probar sin firma' para empezar.");
          refreshLiveControls();
          refreshWalletControls();
        }).catch((error) => {
          logEvent("error", "Error cargando /payment-mode: " + (error.message || error));
          paymentOutput.innerHTML = '<p class="error">' + escapeHtml(error.message || error) + '</p>';
        });
      }
    </script>
    <script type="module" src="/x402-client.js?v=3f53e07"></script>
  </body>
</html>`;
}

export function registerWebRoutes(app: App, config: AppConfig): void {
  app.get("/", (c) => {
    const unavailable = requireStage(c, config, 3);
    if (unavailable) return unavailable;

    return c.html(appPage(config));
  });
}
