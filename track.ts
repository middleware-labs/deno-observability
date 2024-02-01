import { DenoTelemetrySdk,} from "./sdk.ts";
import { logs,SeverityNumber } from "./opentelemetry/api-logs.js";
import { getDenoAutoInstrumentations } from './instrumentation/auto.ts';

interface Config {
  serviceName: string;
  target: string;
  accessToken: string;
}

const configDefault: Config = {
  serviceName: 'Default Service',
  target: 'http://localhost:9319',
  accessToken: '',
};

export function track(config: Config) {
  Object.keys(configDefault).forEach((key) => {
    // @ts-ignore
    configDefault[key] = config[key] ?? configDefault[key];
  });
  return new DenoTelemetrySdk({
    resourceAttrs: {
      'service.name':configDefault.serviceName,
      'mw.account_key':configDefault.accessToken,
      'mw_serverless':1,
    },
    otlpEndpointBase:configDefault.target,
    instrumentations: [
      new getDenoAutoInstrumentations(),
    ],

  });
};

const log = (level: string, message: string): void => {
  const logger = logs.getLogger('middlewareio-deno', '1.0.0');
  const severityNumber = SeverityNumber[level]
  logger.emit({
    severityNumber,
    severityText: level,
    body: message,
  });
};

export function info(message: string): void {
  log('INFO', message);
};

export function warn(message: string): void {
  log('WARN', message);
};

export function debug(message: string): void {
  log('DEBUG', message);
};

export function error(message: string):void {
  log('ERROR', message);
};
