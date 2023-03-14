// import {
//   BasicTracerProvider,
//   BatchSpanProcessor,
//   type BufferConfig,
//   SpanExporter,
//   type TracerConfig,
//   type SDKRegistrationConfig,
// } from 'npm:@opentelemetry/sdk-trace-base';
// import { InstrumentationOption, registerInstrumentations } from 'npm:@opentelemetry/instrumentation';
// import { TextMapPropagator } from 'npm:@opentelemetry/api';
// import { AsyncLocalStorageContextManager } from 'npm:@opentelemetry/context-async-hooks';

import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type BufferConfig,
  SpanExporter,
  type TracerConfig,
} from "https://esm.sh/@opentelemetry/sdk-trace-base@1.10.0";
import { InstrumentationOption, registerInstrumentations } from "https://esm.sh/@opentelemetry/instrumentation@0.36.0";
import { TextMapPropagator } from '../api.ts';
import { DenoAsyncHooksContextManager } from "./context-manager.ts";

export class DenoTracerProvider extends BasicTracerProvider {

  constructor(config?: TracerConfig & {
    instrumentations?: InstrumentationOption[];
    propagator?: TextMapPropagator<unknown>;
    batchSpanProcessors?: SpanExporter[];
  }) {
    super(config);

    const ctxMgr = new DenoAsyncHooksContextManager();
    ctxMgr.enable();
    this.register({
      contextManager: ctxMgr,
      propagator: config?.propagator,
    });

    if (config?.instrumentations) {
      registerInstrumentations({
        instrumentations: config.instrumentations,
      });
    }

    for (const processor of config?.batchSpanProcessors ?? []) {
      this.addBatchSpanProcessor(processor);
    }
  }

  addBatchSpanProcessor(exporter: SpanExporter, config?: BufferConfig) {
    this.addSpanProcessor(new BatchSpanProcessor(exporter, config));
  }
}