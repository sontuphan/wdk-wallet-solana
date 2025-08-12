import 'bare-wdk-runtime'

export * from './index.js' with { imports: 'bare-wdk-runtime/package' }
export { default } from './index.js' with { imports: 'bare-wdk-runtime/package' }
