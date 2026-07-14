import type { ConfigStatus } from '@/lib/api'

export const operationalStatus: ConfigStatus = {
  operational: true,
  missing: [],
  hosting: {
    profiles: [
      {
        domain: 'browse.example.com',
        subdomainMirroringEnabled: true,
        mirroringOperational: true,
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
  missing: ['Forwarding', 'MaxSessions'],
  hosting: {
    profiles: [
      {
        domain: 'browse.example.com',
        subdomainMirroringEnabled: true,
        mirroringOperational: false,
        missing: ['edgeTls.apiToken'],
      },
    ],
  },
}
