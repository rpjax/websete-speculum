import type { ConfigStatus } from '@/lib/api'

export const operationalStatus: ConfigStatus = {
  operational: true,
  missing: [],
  hosting: {
    required: false,
    domains: [
      { domain: 'browse.example.com', subdomainMirroringEnabled: true },
      { domain: 'demo.example.com', subdomainMirroringEnabled: false },
    ],
    profiles: [
      {
        domain: 'browse.example.com',
        subdomainMirroringEnabled: true,
        mirroringOperational: false,
        missing: [],
      },
      {
        domain: 'demo.example.com',
        subdomainMirroringEnabled: false,
        mirroringOperational: false,
        missing: [],
      },
    ],
  },
}

export const needsSetupStatus: ConfigStatus = {
  operational: false,
  missing: ['Navigation', 'ResourceManagement'],
  hosting: {
    required: false,
    domains: [
      { domain: 'browse.example.com', subdomainMirroringEnabled: true },
    ],
    profiles: [
      {
        domain: 'browse.example.com',
        subdomainMirroringEnabled: true,
        mirroringOperational: false,
        missing: [],
      },
    ],
  },
}
