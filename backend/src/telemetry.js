/**
 * telemetry.js — OpenTelemetry SDK initialisation
 *
 * MUST be require()'d as the very first line of src/index.js so that
 * auto-instrumentation patches are applied before any other module loads.
 *
 * Auto-instruments:
 *   - Express (route-level spans)
 *   - HTTP client calls (covers Claude API + webhook fetch calls)
 *   - DNS resolution
 *
 * Export target: OTLP/HTTP configured via OTEL_EXPORTER_OTLP_ENDPOINT.
 * If the env var is absent, the SDK is initialised with a no-op exporter
 * so traces are silently discarded — zero runtime overhead.
 *
 * Service name: OTEL_SERVICE_NAME env var (defaults to 'agentguard-backend').
 */
'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const serviceName = process.env.OTEL_SERVICE_NAME || 'agentguard-backend';

// Configure the exporter. If no endpoint is set, OTLPTraceExporter will fail
// silently (no connection = no-op) — perfectly acceptable in dev.
const traceExporter = new OTLPTraceExporter(
  otlpEndpoint ? { url: `${otlpEndpoint}/v1/traces` } : {}
);

const sdk = new NodeSDK({
  serviceName,
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy file system instrumentation
      '@opentelemetry/instrumentation-fs': { enabled: false },
      // DNS spans can be very chatty; keep them for production debugging
      '@opentelemetry/instrumentation-dns': { enabled: true },
    }),
  ],
});

// Start SDK synchronously (patches all require()'d modules after this point)
sdk.start();
if (otlpEndpoint) {
  console.log(`[OTel] Tracing enabled → ${otlpEndpoint} (service: ${serviceName})`);
} else {
  console.log('[OTel] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing running in no-op mode');
}

// Flush remaining spans on shutdown
process.on('SIGTERM', async () => {
  try {
    await sdk.shutdown();
  } catch (e) {
    // Non-fatal — main shutdown handler takes care of the rest
  }
});

module.exports = sdk;
