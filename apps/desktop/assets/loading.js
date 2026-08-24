const messages = {
  'starting-service': 'Starting local service',
  'loading-interface': 'Loading interface',
  ready: 'Ready',
  failed: 'Startup needs attention',
}

const parameters = new URLSearchParams(globalThis.location.search)
const stage = parameters.get('stage') ?? 'starting-service'
const version = parameters.get('version') ?? ''
const status = document.querySelector('#status')
const versionLabel = document.querySelector('#version')

document.body.dataset.stage = stage
if (status !== null) status.textContent = messages[stage] ?? messages['starting-service']
if (versionLabel !== null) versionLabel.textContent = version === '' ? '' : `Version ${version}`
