import * as fs from 'fs';
import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

function resolveProtoPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../proto/browser_session.proto'), // dist/grpc
    path.resolve(__dirname, '../../proto/browser_session.proto'), // grpc (ts-node)
    path.resolve(process.cwd(), '../proto/browser_session.proto'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`browser_session.proto not found. Tried:\n${candidates.join('\n')}`);
}

export type ProtoGrpcType = {
  speculum: {
    sidecar: {
      v1: {
        BrowserSessionService: grpc.ServiceClientConstructor;
      };
    };
  };
};

export function loadBrowserSessionPackage(): ProtoGrpcType {
  const definition = protoLoader.loadSync(resolveProtoPath(), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(definition) as unknown as ProtoGrpcType;
}

export function getBrowserSessionService(): grpc.ServiceDefinition {
  const pkg = loadBrowserSessionPackage();
  const ctor = pkg.speculum.sidecar.v1.BrowserSessionService as grpc.ServiceClientConstructor & {
    service: grpc.ServiceDefinition;
  };
  return ctor.service;
}
